"""Dependencias de autenticación/autorización compartidas por las rutas.

El backend se conecta a Postgres directamente con un rol equivalente a
`service_role`: **no pasa por PostgREST, así que las políticas RLS de la
migración no aplican acá**. Toda la autorización de este módulo hacia abajo
es la única que protege la API.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NotAuthenticated, PermissionDenied
from app.core.security import InvalidTokenError, decode_access_token
from app.db.models import Profile, UserRole
from app.db.session import get_session

logger = logging.getLogger("app")

# auto_error=False en ambas: se traduce el fallo a NotAuthenticated (401) con
# el mismo formato de error que el resto de la API, en vez del 403 genérico
# que tira HTTPBearer con auto_error=True cuando falta el header.
_bearer = HTTPBearer(auto_error=False)
_optional_bearer = HTTPBearer(auto_error=False)


def _subject_from_token(token: str) -> uuid.UUID:
    try:
        payload = decode_access_token(token)
    except InvalidTokenError as exc:
        raise NotAuthenticated("Token inválido o expirado") from exc

    sub = payload.get("sub")
    if not sub:
        raise NotAuthenticated("Token sin subject")
    try:
        return uuid.UUID(sub)
    except ValueError as exc:
        raise NotAuthenticated("Token con subject inválido") from exc


async def get_current_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> Profile:
    """Requiere sesión válida. Devuelve 401 si falta, es inválida o el perfil no existe."""
    if credentials is None:
        raise NotAuthenticated("Falta el header Authorization")

    user_id = _subject_from_token(credentials.credentials)
    profile = await session.get(Profile, user_id)
    if profile is None or not profile.is_active:
        logger.warning(
            "auth_profile_lookup_failed",
            extra={"user_id": str(user_id), "found": profile is not None},
        )
        raise NotAuthenticated("Perfil inexistente o inactivo")
    return profile


async def get_optional_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
    session: AsyncSession = Depends(get_session),
) -> Profile | None:
    """Como `get_current_profile`, pero sin sesión devuelve None en vez de 401.

    Usado en endpoints que aceptan tanto reservas de invitado como de un
    cliente logueado (ej. crear turno).
    """
    if credentials is None:
        return None

    user_id = _subject_from_token(credentials.credentials)
    profile = await session.get(Profile, user_id)
    if profile is None or not profile.is_active:
        return None
    return profile


def require_roles(*roles: UserRole):
    """Factory de dependencia: exige sesión con uno de los roles dados."""

    async def _checker(profile: Profile = Depends(get_current_profile)) -> Profile:
        if profile.role not in roles:
            raise PermissionDenied(
                "No tenés permisos para realizar esta acción",
                required_roles=[r.value for r in roles],
            )
        return profile

    return _checker


def has_full_access(profile: Profile) -> bool:
    """El owner, y las cuentas puntuales en `full_calendar_access_emails`,
    tienen acceso total al salón (turnos, horarios, servicios) aunque su rol
    sea staff. El resto del staff tiene acceso de solo lectura: puede ver la
    agenda pero no crear/editar turnos, cambiar sus servicios ni su horario."""
    if profile.role is UserRole.owner:
        return True
    email = (profile.email or "").strip().lower()
    return email in get_settings().full_calendar_access_email_set()


async def require_full_access(profile: Profile = Depends(get_current_profile)) -> Profile:
    """Como `require_roles`, pero para acciones reservadas a un admin del
    salón (ver `has_full_access`) en vez de a un rol fijo."""
    if not has_full_access(profile):
        raise PermissionDenied("Solo un admin del salón puede realizar esta acción")
    return profile

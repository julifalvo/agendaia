"""Conexión y sincronización de Google Calendar (una sola cuenta por salón).

Separado de `admin.py` porque el callback de OAuth tiene un modelo de auth
distinto al resto de las rutas admin: lo llama el navegador redirigido por
Google, sin header `Authorization` — se autoriza con el `state` firmado en
vez de con la sesión (ver `google_calendar.decode_state`).
"""

from __future__ import annotations

import datetime as dt
import hmac

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import has_full_access, require_roles
from app.core.config import get_settings
from app.core.errors import BookingError, NotAuthenticated
from app.db.models import Profile, UserRole
from app.db.session import get_session
from app.schemas.google_calendar import (
    GoogleCalendarBlockOut,
    GoogleCalendarConnectOut,
    GoogleCalendarStatusOut,
    GoogleCalendarSyncRequest,
    GoogleCalendarSyncResultOut,
)
from app.services import google_calendar

router = APIRouter(prefix="/admin/google-calendar", tags=["google-calendar"])

_STAFF_ROLES = (UserRole.owner, UserRole.staff)

#: Conectar/sincronizar Google Calendar queda reservado al owner del salón
#: (no a un email global fijo — eso bloqueaba a cualquier salón que no fuera
#: el primero). El resto del staff ni siquiera debe ver esta sección.
_require_google_calendar_admin = require_roles(UserRole.owner)


@router.get("/status", response_model=GoogleCalendarStatusOut)
async def get_status(
    profile: Profile = Depends(_require_google_calendar_admin),
    session: AsyncSession = Depends(get_session),
) -> GoogleCalendarStatusOut:
    connection = await google_calendar.get_connection(session, profile.salon_id)
    if connection is None:
        return GoogleCalendarStatusOut(connected=False)
    return GoogleCalendarStatusOut(
        connected=True,
        calendar_id=connection.calendar_id,
        connected_at=connection.connected_at,
        last_synced_at=connection.last_synced_at,
    )


@router.get("/connect", response_model=GoogleCalendarConnectOut)
async def connect(
    profile: Profile = Depends(_require_google_calendar_admin),
) -> GoogleCalendarConnectOut:
    url = google_calendar.build_authorization_url(profile.salon_id, profile.id)
    return GoogleCalendarConnectOut(authorization_url=url)


@router.get("/callback")
async def callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    """Redirige el navegador de vuelta al panel — nunca devuelve JSON: es una
    navegación de nivel superior disparada por Google, no un fetch del SPA."""
    frontend = get_settings().frontend_base_url.rstrip("/")
    target = f"{frontend}/admin/calendar"

    if error or not code or not state:
        return RedirectResponse(f"{target}?google=error")

    try:
        salon_id, profile_id = google_calendar.decode_state(state)
        await google_calendar.exchange_code(session, salon_id, profile_id, code)
    except BookingError:
        return RedirectResponse(f"{target}?google=error")

    return RedirectResponse(f"{target}?google=connected")


@router.delete("/connection", status_code=204)
async def disconnect(
    profile: Profile = Depends(_require_google_calendar_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    await google_calendar.disconnect(session, profile.salon_id)


@router.post("/sync", response_model=GoogleCalendarSyncResultOut)
async def sync_now(
    payload: GoogleCalendarSyncRequest,
    profile: Profile = Depends(_require_google_calendar_admin),
    session: AsyncSession = Depends(get_session),
) -> GoogleCalendarSyncResultOut:
    now = dt.datetime.now(dt.UTC)
    date_from = payload.date_from or now
    date_to = payload.date_to or (now + dt.timedelta(days=30))
    result = await google_calendar.sync_incoming_events(
        session, profile.salon_id, date_from, date_to
    )
    return GoogleCalendarSyncResultOut(
        connected=result.connected,
        upserted=result.upserted,
        pruned=result.pruned,
        error=result.error,
    )


@router.get("/blocks", response_model=list[GoogleCalendarBlockOut])
async def list_blocks(
    date_from: dt.datetime | None = Query(default=None),
    date_to: dt.datetime | None = Query(default=None),
    profile: Profile = Depends(require_roles(*_STAFF_ROLES)),
    session: AsyncSession = Depends(get_session),
) -> list[GoogleCalendarBlockOut]:
    """Owner o staff: la agenda compartida necesita mostrar estos bloqueos en
    todas las columnas, no solo al owner — pero el título real del evento de
    Google (`summary`) es personal de quien conectó el calendario. Se lo
    devolvemos tal cual solo a quien tiene acceso completo (`has_full_access`)
    o al propio profesional bloqueado; al resto del staff les llega el bloqueo
    (para que la franja siga apareciendo como ocupada) pero sin el texto —
    el frontend ya cae a un genérico "Bloqueado (Google)" cuando `summary` es
    `None`."""
    rows = await google_calendar.list_blocks(session, profile.salon_id, date_from, date_to)
    can_see_summaries = has_full_access(profile)
    result = []
    for row in rows:
        out = GoogleCalendarBlockOut.model_validate(row)
        if not can_see_summaries and row.staff_id != profile.id:
            out.summary = None
        result.append(out)
    return result


def _require_internal_sync_token(
    x_internal_sync_token: str | None = Header(default=None),
) -> None:
    """Guarda del cron externo (GitHub Actions) que reemplaza al botón
    "Sincronizar ahora" — no hay sesión de admin acá, solo un secreto
    compartido. `compare_digest` evita timing attacks; vacío en settings
    deshabilita el endpoint entero (mismo criterio "vacío = deshabilitado"
    que el resto de la integración), nunca lo deja abierto."""
    expected = get_settings().internal_sync_token
    if not expected or not x_internal_sync_token:
        raise NotAuthenticated("Falta o no está configurado el token de sync interno")
    if not hmac.compare_digest(x_internal_sync_token, expected):
        raise NotAuthenticated("Token de sync interno inválido")


@router.post(
    "/internal/sync-all",
    response_model=dict[str, GoogleCalendarSyncResultOut],
    dependencies=[Depends(_require_internal_sync_token)],
)
async def sync_all(
    session: AsyncSession = Depends(get_session),
) -> dict[str, GoogleCalendarSyncResultOut]:
    """Dispara `sync_incoming_events` para todos los salones conectados.
    Pensado para un cron externo (GitHub Actions, no hay job runner propio en
    este proyecto) cada 15 min — ver .github/workflows/sync-google-calendar.yml."""
    results = await google_calendar.sync_all_connections(session)
    return {
        str(salon_id): GoogleCalendarSyncResultOut(
            connected=result.connected,
            upserted=result.upserted,
            pruned=result.pruned,
            error=result.error,
        )
        for salon_id, result in results.items()
    }

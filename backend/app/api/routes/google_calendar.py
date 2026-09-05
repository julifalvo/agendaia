"""Conexión y sincronización de Google Calendar (una sola cuenta por salón).

Separado de `admin.py` porque el callback de OAuth tiene un modelo de auth
distinto al resto de las rutas admin: lo llama el navegador redirigido por
Google, sin header `Authorization` — se autoriza con el `state` firmado en
vez de con la sesión (ver `google_calendar.decode_state`).
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.core.config import get_settings
from app.core.errors import BookingError, PermissionDenied
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


def _require_google_calendar_admin(
    profile: Profile = Depends(require_roles(UserRole.owner)),
) -> Profile:
    """Conectar/sincronizar Google Calendar queda reservado a una única
    cuenta (ver `google_calendar_allowed_email`) — el resto de owners y
    staff del salón ni siquiera debe ver esta sección."""
    allowed_email = get_settings().google_calendar_allowed_email.strip().lower()
    if not profile.email or profile.email.strip().lower() != allowed_email:
        raise PermissionDenied("No tenés permisos para gestionar Google Calendar")
    return profile


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
    todas las columnas, no solo al owner."""
    rows = await google_calendar.list_blocks(session, profile.salon_id, date_from, date_to)
    return [GoogleCalendarBlockOut.model_validate(r) for r in rows]

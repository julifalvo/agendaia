"""Integración con Google Calendar: una sola cuenta de Google por salón
(no una por profesional), sync bidireccional.

Se pega directo a la REST API de Google en vez de sumar el SDK oficial,
mismo criterio que `services/payments.py`/`services/supabase_admin.py`: solo
hacen falta un puñado de llamadas (OAuth, crear/actualizar/borrar evento,
listar eventos).

Dos direcciones, con contratos distintos a propósito:
  - **Push** (booking → Google): se llama desde `services/bookings.py` en el
    medio de la creación/edición/cancelación de un turno real. Nunca debe
    propagar una excepción — un problema con Google jamás puede tumbar una
    reserva. Mismo contrato que `services/notifications.notify`.
  - **Pull** (Google → booking): se llama on-demand (botón "Sincronizar
    ahora" o al abrir el calendario admin). No hay job runner en este
    proyecto, así que no hay cron. Tampoco propaga: devuelve un
    `SyncResult` con el error adentro, para que la vista de calendario no se
    rompa si Google está caído o el token expiró — pero sí se puede mostrar
    al owner en la UI.

Convención de "vacío = deshabilitado": si `google_client_id`/`google_client_secret`/
`google_calendar_token_key` no están seteados, todo acá es no-op (push) o
`SyncResult(connected=False)` (pull) — mismo criterio que Mercado Pago/Resend.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import httpx
import jwt
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ConflictError, UpstreamError
from app.db.models import Appointment, GoogleCalendarBlock, GoogleCalendarConnection, Profile, UserRole

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 10.0
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_API_BASE = "https://www.googleapis.com/calendar/v3"
_SCOPE = "https://www.googleapis.com/auth/calendar"
#: Clave dentro de `extendedProperties.private` que marca un evento como
#: creado por esta app — el pull-sync lo usa para no traerse como "bloqueo
#: externo" un evento que en realidad empujamos nosotros.
_APP_TAG_KEY = "agendaia_appointment_id"
#: Tag opcional al inicio del título de un evento creado a mano en Google
#: ("[Fulana] vacaciones") para indicar que bloquea solo a esa profesional en
#: vez de a todo el salón. Best-effort, sin tag = bloquea todo el salón.
_STAFF_TAG_RE = re.compile(r"^\[([^\]]+)\]")

_STAFF_ROLES = (UserRole.owner, UserRole.staff)


class GoogleCalendarNotConfigured(RuntimeError):
    pass


@dataclass
class SyncResult:
    connected: bool
    upserted: int = 0
    pruned: int = 0
    error: str | None = None


def _is_configured() -> bool:
    settings = get_settings()
    return bool(
        settings.google_client_id
        and settings.google_client_secret
        and settings.google_calendar_token_key
    )


def _require_configured() -> None:
    if not _is_configured():
        raise GoogleCalendarNotConfigured(
            "Google Calendar no está configurado en este backend "
            "(faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALENDAR_TOKEN_KEY)"
        )


def _fernet() -> Fernet:
    return Fernet(get_settings().google_calendar_token_key.encode())


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


# --- OAuth -------------------------------------------------------------------


def build_authorization_url(salon_id: uuid.UUID, profile_id: uuid.UUID) -> str:
    """Arma la URL a la que se redirige al owner para autorizar el acceso.

    El `state` es un JWT corto (10 min) firmado con la misma clave que cifra
    el refresh_token — evita tener que abrir una tabla de nonces solo para
    proteger el callback contra CSRF.
    """
    _require_configured()
    settings = get_settings()
    state = jwt.encode(
        {
            "salon_id": str(salon_id),
            "profile_id": str(profile_id),
            "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=10),
        },
        settings.google_calendar_token_key,
        algorithm="HS256",
    )
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": _SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    query = httpx.QueryParams(params)
    return f"{_AUTH_URL}?{query}"


def decode_state(state: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Valida el `state` del callback y devuelve `(salon_id, profile_id)`."""
    settings = get_settings()
    try:
        payload = jwt.decode(state, settings.google_calendar_token_key, algorithms=["HS256"])
        return uuid.UUID(payload["salon_id"]), uuid.UUID(payload["profile_id"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise ConflictError("El enlace de conexión con Google venció o es inválido") from exc


async def exchange_code(
    session: AsyncSession, salon_id: uuid.UUID, profile_id: uuid.UUID, code: str
) -> GoogleCalendarConnection:
    """Intercambia el código de OAuth por tokens y guarda la única conexión
    del salón (upsert: `salon_id` es la PK)."""
    _require_configured()
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
    except httpx.HTTPError as exc:
        raise UpstreamError("No se pudo contactar a Google para conectar el calendario") from exc

    if response.status_code >= 400:
        raise UpstreamError(
            "Google rechazó la autorización del calendario", detail=response.text
        )

    data = response.json()
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        # Pasa si el owner ya había autorizado antes sin revocar el acceso:
        # Google solo manda refresh_token la primera vez que se consiente.
        raise ConflictError(
            "Google no devolvió un refresh_token. Revocá el acceso previo de la "
            "app en https://myaccount.google.com/permissions y volvé a conectar."
        )

    connection = await session.get(GoogleCalendarConnection, salon_id)
    if connection is None:
        connection = GoogleCalendarConnection(salon_id=salon_id)
        session.add(connection)

    connection.refresh_token_encrypted = _encrypt(refresh_token)
    connection.connected_by = profile_id
    connection.connected_at = dt.datetime.now(dt.UTC)
    await session.commit()
    await session.refresh(connection)
    return connection


async def get_connection(
    session: AsyncSession, salon_id: uuid.UUID
) -> GoogleCalendarConnection | None:
    return await session.get(GoogleCalendarConnection, salon_id)


async def disconnect(session: AsyncSession, salon_id: uuid.UUID) -> None:
    connection = await session.get(GoogleCalendarConnection, salon_id)
    if connection is None:
        return
    await session.delete(connection)
    await session.commit()


async def _access_token(connection: GoogleCalendarConnection) -> str:
    """Pide un access token fresco con el refresh_token guardado.

    No se persiste ningún access token: se pide de nuevo en cada uso, así no
    hay que rastrear vencimientos — el costo es una llamada HTTP extra por
    push/sync, aceptable dado el volumen (todo esto es on-demand, no de alto
    tráfico).
    """
    settings = get_settings()
    refresh_token = _decrypt(connection.refresh_token_encrypted)

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        response = await client.post(
            _TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "grant_type": "refresh_token",
            },
        )
    if response.status_code >= 400:
        raise UpstreamError(
            "Google rechazó la renovación del token del calendario", detail=response.text
        )
    return response.json()["access_token"]


# --- Push (best-effort, nunca propaga) ---------------------------------------


def _event_body(appointment: Appointment, service_name: str) -> dict:
    client_label = appointment.guest_name or "Cliente"
    return {
        "summary": f"{service_name} — {client_label}",
        "description": "Turno reservado en MC Nails Studio.",
        "start": {"dateTime": appointment.start_time.isoformat()},
        "end": {"dateTime": appointment.end_time.isoformat()},
        "extendedProperties": {"private": {_APP_TAG_KEY: str(appointment.id)}},
    }


async def _push(
    session: AsyncSession,
    appointment: Appointment,
    body_factory: Callable[[], dict] | None,
    *,
    delete: bool = False,
) -> None:
    """Núcleo común de create/update/delete de evento — atrapa TODO (no solo
    `httpx.HTTPError`): un token corrupto, `Fernet` fallando al descifrar,
    un turno con algún campo inesperado, cualquier cosa, nunca debe tumbar la
    operación de negocio que lo llamó. Por eso `body_factory` es perezoso:
    ni siquiera se arma el body si no está configurado o no hay conexión."""
    if not _is_configured():
        return
    try:
        connection = await get_connection(session, appointment.salon_id)
        if connection is None:
            return
        access_token = await _access_token(connection)
        headers = {"Authorization": f"Bearer {access_token}"}
        base = f"{_API_BASE}/calendars/{connection.calendar_id}/events"

        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            if delete:
                if not appointment.google_event_id:
                    return
                resp = await client.delete(f"{base}/{appointment.google_event_id}", headers=headers)
                # 410/404 = ya no existe del lado de Google; no es un error real acá.
                if resp.status_code not in (200, 204, 404, 410):
                    resp.raise_for_status()
                return

            body = body_factory() if body_factory else {}
            if appointment.google_event_id:
                resp = await client.patch(
                    f"{base}/{appointment.google_event_id}", headers=headers, json=body
                )
            else:
                resp = await client.post(base, headers=headers, json=body)
            resp.raise_for_status()
            appointment.google_event_id = resp.json()["id"]
            await session.commit()
    except Exception:  # noqa: BLE001 — best-effort a propósito, ver docstring.
        logger.exception(
            "No se pudo sincronizar el turno %s con Google Calendar", appointment.id
        )


async def push_appointment_created(
    session: AsyncSession, appointment: Appointment, service_name: str
) -> None:
    await _push(session, appointment, lambda: _event_body(appointment, service_name))


async def push_appointment_updated(
    session: AsyncSession, appointment: Appointment, service_name: str
) -> None:
    await _push(session, appointment, lambda: _event_body(appointment, service_name))


async def push_appointment_cancelled(session: AsyncSession, appointment: Appointment) -> None:
    await _push(session, appointment, None, delete=True)


# --- Pull (on-demand, sin cron) ----------------------------------------------


def _infer_staff_id(summary: str, staff_by_name: dict[str, uuid.UUID]) -> uuid.UUID | None:
    match = _STAFF_TAG_RE.match(summary or "")
    if not match:
        return None
    return staff_by_name.get(match.group(1).strip().lower())


def _parse_event_datetime(value: dict) -> dt.datetime | None:
    """`dateTime` = evento con hora puntual (lo que nos interesa). `date`
    (evento de todo el día) se ignora a propósito — no over-engineering: es
    un caso raro para bloqueos reales y requeriría resolver el timezone del
    salón acá, que este módulo no conoce."""
    raw = value.get("dateTime")
    if not raw:
        return None
    return dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))


async def list_blocks(
    session: AsyncSession,
    salon_id: uuid.UUID,
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
) -> list[GoogleCalendarBlock]:
    stmt = select(GoogleCalendarBlock).where(GoogleCalendarBlock.salon_id == salon_id)
    if date_from is not None:
        stmt = stmt.where(GoogleCalendarBlock.ends_at > date_from)
    if date_to is not None:
        stmt = stmt.where(GoogleCalendarBlock.starts_at < date_to)
    stmt = stmt.order_by(GoogleCalendarBlock.starts_at)
    return list((await session.scalars(stmt)).all())


async def sync_incoming_events(
    session: AsyncSession,
    salon_id: uuid.UUID,
    date_from: dt.datetime,
    date_to: dt.datetime,
) -> SyncResult:
    if not _is_configured():
        return SyncResult(connected=False)

    connection = await get_connection(session, salon_id)
    if connection is None:
        return SyncResult(connected=False)

    try:
        access_token = await _access_token(connection)
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{_API_BASE}/calendars/{connection.calendar_id}/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "timeMin": date_from.isoformat(),
                    "timeMax": date_to.isoformat(),
                    "singleEvents": "true",
                    "maxResults": 250,
                },
            )
            response.raise_for_status()
        events = response.json().get("items", [])
    except Exception as exc:  # noqa: BLE001 — se reporta en SyncResult, no se propaga.
        logger.exception("Falló la sincronización con Google Calendar del salón %s", salon_id)
        return SyncResult(connected=True, error=str(exc))

    staff_rows = await session.scalars(
        select(Profile).where(
            Profile.salon_id == salon_id,
            Profile.role.in_(_STAFF_ROLES),
            Profile.is_active.is_(True),
        )
    )
    staff_by_name = {p.full_name.strip().lower(): p.id for p in staff_rows}

    seen_event_ids: set[str] = set()
    upserted = 0
    for event in events:
        if event.get("status") == "cancelled":
            continue
        ext_props = event.get("extendedProperties", {}).get("private", {}) or {}
        if _APP_TAG_KEY in ext_props:
            continue  # es un evento nuestro (push), no un bloqueo externo.

        starts_at = _parse_event_datetime(event.get("start", {}))
        ends_at = _parse_event_datetime(event.get("end", {}))
        if starts_at is None or ends_at is None:
            continue

        event_id = event["id"]
        seen_event_ids.add(event_id)
        summary = event.get("summary") or ""
        staff_id = _infer_staff_id(summary, staff_by_name)

        existing = await session.scalar(
            select(GoogleCalendarBlock).where(
                GoogleCalendarBlock.salon_id == salon_id,
                GoogleCalendarBlock.google_event_id == event_id,
            )
        )
        if existing is None:
            session.add(
                GoogleCalendarBlock(
                    salon_id=salon_id,
                    google_event_id=event_id,
                    staff_id=staff_id,
                    summary=summary,
                    starts_at=starts_at,
                    ends_at=ends_at,
                )
            )
        else:
            existing.staff_id = staff_id
            existing.summary = summary
            existing.starts_at = starts_at
            existing.ends_at = ends_at
        upserted += 1

    # Prune: bloqueos ya guardados en esta ventana que Google ya no devuelve
    # (el evento se borró o se movió fuera del rango consultado).
    stale_rows = await session.scalars(
        select(GoogleCalendarBlock).where(
            GoogleCalendarBlock.salon_id == salon_id,
            GoogleCalendarBlock.starts_at < date_to,
            GoogleCalendarBlock.ends_at > date_from,
        )
    )
    pruned = 0
    for row in stale_rows:
        if row.google_event_id not in seen_event_ids:
            await session.delete(row)
            pruned += 1

    connection.last_synced_at = dt.datetime.now(dt.UTC)
    await session.commit()
    return SyncResult(connected=True, upserted=upserted, pruned=pruned)

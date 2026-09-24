"""Notificaciones salientes (WhatsApp/Email) vía webhook.

ARCHITECTURE.md pide integrar WhatsApp/Email por webhooks. Integrar
directamente contra la API de WhatsApp Business requiere verificación de
negocio y plantillas pre-aprobadas — fuera de alcance de este backend. En su
lugar, el backend dispara un webhook genérico con la info del turno; del otro
lado (Zapier, Make, n8n, una Cloud Function propia) se decide a qué canal
mandarlo y con qué texto.

La URL es por salón (`Salon.notifications_webhook_url`), no una sola global:
cada salón manda sus turnos (con nombre/teléfono de la clienta incluidos) a
su propio Zapier/WhatsApp, nunca al de otro salón.

Una notificación que falla **nunca** debe tirar abajo la operación de negocio
que la disparó: se loguea y se sigue. Por eso ningún método de este módulo
propaga excepciones.
"""

from __future__ import annotations

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Appointment, Salon

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0


def _payload(event: str, appointment: Appointment, **extra: object) -> dict:
    return {
        "event": event,
        "appointment_id": str(appointment.id),
        "salon_id": str(appointment.salon_id),
        "staff_id": str(appointment.staff_id),
        "service_id": str(appointment.service_id),
        "client_id": str(appointment.client_id) if appointment.client_id else None,
        "guest_name": appointment.guest_name,
        "guest_phone": appointment.guest_phone,
        "start_time": appointment.start_time.isoformat(),
        "end_time": appointment.end_time.isoformat(),
        "status": appointment.status.value,
        **extra,
    }


async def notify(
    session: AsyncSession, event: str, appointment: Appointment, **extra: object
) -> None:
    """Dispara el webhook del salón del turno. No-op si el salón no configuró uno."""
    salon = await session.get(Salon, appointment.salon_id)
    webhook_url = salon.notifications_webhook_url if salon else None
    if not webhook_url:
        logger.debug(
            "salon %s sin notifications_webhook_url configurado; se omite %s",
            appointment.salon_id,
            event,
        )
        return

    payload = _payload(event, appointment, **extra)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(webhook_url, json=payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Falló el webhook de notificaciones (%s): %s", event, exc)

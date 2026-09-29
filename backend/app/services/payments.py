"""Cliente delgado de la API de Mercado Pago (Checkout Pro).

Se pega directo a la API REST en vez de sumar el SDK oficial: solo hacen
falta dos llamadas (crear preferencia, consultar un pago), mismo criterio que
`services/supabase_admin.py`.

El webhook (`app.services.bookings.confirm_mercadopago_payment`) nunca confía
en el cuerpo de la notificación: siempre vuelve a pedirle el pago a la API acá
con nuestro propio access token antes de dar una seña por acreditada.
"""

from __future__ import annotations

import httpx

from app.core.config import get_settings
from app.core.errors import UpstreamError
from app.db.models import Appointment

_TIMEOUT_SECONDS = 10.0
_BASE_URL = "https://api.mercadopago.com"


class MercadoPagoNotConfigured(RuntimeError):
    pass


def _access_token() -> str:
    token = get_settings().mercadopago_access_token
    if not token:
        raise MercadoPagoNotConfigured(
            "MERCADOPAGO_ACCESS_TOKEN no está configurado en el backend"
        )
    return token


async def create_preference(appointment: Appointment, description: str) -> dict:
    """Crea una preferencia de pago (Checkout Pro) para la seña de `appointment`.

    Devuelve el JSON de Mercado Pago tal cual: se usan `id` (para guardar en
    `mp_preference_id`) e `init_point` (URL a la que se redirige al cliente).
    """
    settings = get_settings()
    token = _access_token()
    frontend = settings.frontend_base_url.rstrip("/")
    backend = settings.backend_public_url.rstrip("/")

    body = {
        "items": [
            {
                "title": description,
                "quantity": 1,
                "unit_price": float(appointment.deposit_amount),
                "currency_id": "ARS",
            }
        ],
        # Vínculo con el turno: es lo único en lo que confía el webhook,
        # el resto del cuerpo de la notificación se descarta.
        "external_reference": str(appointment.id),
        "notification_url": f"{backend}/api/v1/webhooks/mercadopago",
        "back_urls": {
            "success": f"{frontend}/?pago=exito",
            "pending": f"{frontend}/?pago=pendiente",
            "failure": f"{frontend}/?pago=error",
        },
    }
    # Mercado Pago rechaza la preferencia entera (400 invalid_auto_return) si
    # `back_url.success` no es una URL https públicamente resoluble. En dev
    # `FRONTEND_BASE_URL` suele ser localhost, así que ahí se omite: la
    # preferencia igual se crea (el cliente solo pierde el auto-redirect al
    # aprobarse el pago).
    if frontend.startswith("https://"):
        body["auto_return"] = "approved"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{_BASE_URL}/checkout/preferences",
                json=body,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        raise UpstreamError("No se pudo contactar Mercado Pago") from exc

    if response.status_code >= 400:
        raise UpstreamError(
            "Mercado Pago rechazó la creación de la preferencia de pago",
            detail=response.text,
        )

    return response.json()


async def get_payment(payment_id: str) -> dict:
    """Recupera el pago autoritativo desde Mercado Pago.

    Se usa siempre antes de confirmar una seña: el cuerpo del webhook nunca
    es la fuente de verdad, solo indica qué `payment_id` consultar acá.
    """
    token = _access_token()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{_BASE_URL}/v1/payments/{payment_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        raise UpstreamError("No se pudo contactar Mercado Pago") from exc

    if response.status_code >= 400:
        raise UpstreamError(
            "Mercado Pago rechazó la consulta del pago", detail=response.text
        )

    return response.json()

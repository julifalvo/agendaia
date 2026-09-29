"""Cliente delgado de la API de Mercado Pago (Checkout Pro).

Se pega directo a la API REST en vez de sumar el SDK oficial: solo hacen
falta dos llamadas (crear preferencia, consultar un pago), mismo criterio que
`services/supabase_admin.py`.

El webhook (`app.services.bookings.confirm_mercadopago_payment`) nunca confía
en el cuerpo de la notificación: siempre vuelve a pedirle el pago a la API acá
con nuestro propio access token antes de dar una seña por acreditada.

El access token es por-salón (`Salon.mercadopago_access_token_encrypted`, ver
`resolve_access_token`), no una única env var global: cada salón puede tener
su propia cuenta de Mercado Pago, editable desde el panel de administración
(`PATCH /salon/payment-settings`). `Settings.mercadopago_access_token` sigue
existiendo solo como fallback global para el salón que todavía no configuró
el suyo.
"""

from __future__ import annotations

import httpx
from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.core.errors import BackendNotConfigured, UpstreamError
from app.db.models import Appointment, Salon

_TIMEOUT_SECONDS = 10.0
_BASE_URL = "https://api.mercadopago.com"


class MercadoPagoNotConfigured(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = get_settings().google_calendar_token_key
    if not key:
        raise BackendNotConfigured(
            "GOOGLE_CALENDAR_TOKEN_KEY no está configurado en el backend: "
            "no se puede guardar un token de Mercado Pago por salón todavía"
        )
    return Fernet(key.encode())


def encrypt_access_token(raw_token: str) -> str:
    """Cifra un token de Mercado Pago antes de guardarlo en
    `Salon.mercadopago_access_token_encrypted`. Reusa la misma clave Fernet
    que `app.services.google_calendar` (`GOOGLE_CALENDAR_TOKEN_KEY`): es una
    clave simétrica genérica para secretos por-salón, no algo exclusivo del
    calendario — evita pedir una env var nueva para esto."""
    return _fernet().encrypt(raw_token.encode()).decode()


def _decrypt_access_token(encrypted_token: str) -> str:
    return _fernet().decrypt(encrypted_token.encode()).decode()


def resolve_access_token(salon: Salon | None) -> str | None:
    """El token propio del salón si lo configuró, si no el default global del
    backend (o `None` si tampoco existe ese default)."""
    if salon is not None and salon.mercadopago_access_token_encrypted:
        return _decrypt_access_token(salon.mercadopago_access_token_encrypted)
    return get_settings().mercadopago_access_token or None


def resolve_deposit_amount(salon: Salon | None):
    """El monto de seña propio del salón si lo configuró, si no el default
    global del backend."""
    if salon is not None and salon.booking_deposit_amount is not None:
        return salon.booking_deposit_amount
    return get_settings().booking_deposit_amount


def _validate_token(access_token: str | None) -> str:
    if not access_token:
        raise MercadoPagoNotConfigured(
            "Este salón no tiene un access token de Mercado Pago configurado"
        )
    return access_token


async def create_preference(
    appointment: Appointment, description: str, *, access_token: str | None
) -> dict:
    """Crea una preferencia de pago (Checkout Pro) para la seña de `appointment`.

    Devuelve el JSON de Mercado Pago tal cual: se usan `id` (para guardar en
    `mp_preference_id`) e `init_point` (URL a la que se redirige al cliente).
    """
    settings = get_settings()
    token = _validate_token(access_token)
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
        # `salon_id` en la query: el webhook todavía no sabe a qué turno
        # corresponde el pago (recién lo sabe al leer `external_reference`
        # de la respuesta de Mercado Pago), pero necesita el access token del
        # salón correcto ANTES de poder pedirle ese pago a la API — ver
        # `app.services.bookings.confirm_mercadopago_payment`.
        "notification_url": (
            f"{backend}/api/v1/webhooks/mercadopago?salon_id={appointment.salon_id}"
        ),
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


async def get_payment(payment_id: str, *, access_token: str | None) -> dict:
    """Recupera el pago autoritativo desde Mercado Pago.

    Se usa siempre antes de confirmar una seña: el cuerpo del webhook nunca
    es la fuente de verdad, solo indica qué `payment_id` consultar acá.
    """
    token = _validate_token(access_token)
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

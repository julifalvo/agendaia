"""Link público "ver mi turno" — HMAC sobre el id del turno, sin tabla ni
estado propio: no hay nada que guardar ni limpiar, y no caduca (reprogramar
un turno conserva el id, ver `services/bookings.py`, así que el link sigue
siendo válido después de reagendar).

Convención de "vacío = deshabilitado" de siempre: sin `booking_link_secret`
seteado, no se genera el link para el mail y el endpoint público rechaza
cualquier token.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid

from app.core.config import get_settings


def _digest(appointment_id: uuid.UUID) -> str:
    secret = get_settings().booking_link_secret.encode()
    return hmac.new(secret, appointment_id.bytes, hashlib.sha256).hexdigest()


def generate_token(appointment_id: uuid.UUID) -> str | None:
    """None si la feature no está configurada — nunca un token "falso" que
    después nadie puede verificar."""
    if not get_settings().booking_link_secret:
        return None
    return _digest(appointment_id)


def verify_token(appointment_id: uuid.UUID, token: str) -> bool:
    if not get_settings().booking_link_secret or not token:
        return False
    return hmac.compare_digest(_digest(appointment_id), token)


def build_url(appointment_id: uuid.UUID) -> str | None:
    """URL lista para pegar en el mail de confirmación. None si la feature
    no está configurada — `email.send_booking_confirmation` simplemente no
    agrega la sección del link en ese caso."""
    token = generate_token(appointment_id)
    if token is None:
        return None
    base = get_settings().frontend_base_url.rstrip("/")
    return f"{base}/mi-turno/{appointment_id}?t={token}"

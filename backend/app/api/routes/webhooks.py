from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.services import bookings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/mercadopago")
async def mercadopago_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Recibe la notificación de pago de Mercado Pago.

    Mercado Pago manda tanto el formato nuevo (JSON: `{"type": "payment",
    "data": {"id": "..."}}`) como el legado (query string: `?topic=payment&
    id=...`). Se soportan los dos. El cuerpo es de un tercero no confiable —
    si no viene bien formado, se ignora en vez de romper (MP reintenta
    notificaciones fallidas, así que un 200 "ignorado" es preferible a un 500
    que dispare reintentos infinitos de un payload que nunca va a parsear).

    No hay validación de firma acá a propósito: `bookings.confirm_mercadopago_payment`
    nunca confía en este cuerpo, siempre vuelve a pedirle el pago a la API de
    Mercado Pago con nuestro propio access token antes de tocar un turno.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    event_type = (
        body.get("type") or request.query_params.get("type") or request.query_params.get("topic")
    )
    payment_id = (
        (body.get("data") or {}).get("id")
        or request.query_params.get("data.id")
        or request.query_params.get("id")
    )

    if event_type != "payment" or not payment_id:
        return {"status": "ignored"}

    await bookings.confirm_mercadopago_payment(session, str(payment_id))
    return {"status": "ok"}

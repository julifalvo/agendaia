from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.models import AppointmentStatus, PaymentMethod, PaymentStatus


class SalonPublicOut(BaseModel):
    """Datos de marca del salón para pintar el sitio público — sin nada
    operativo (horarios, políticas), eso ya viaja implícito en `/availability`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    theme_color: str | None
    logo_url: str | None
    transfer_alias: str | None
    transfer_cvu: str | None
    transfer_account_name: str | None
    #: Monto de la seña, ya resuelto (propio del salón o el default global del
    #: backend) — ver `payments.resolve_deposit_amount`. Nunca el token de
    #: Mercado Pago ni nada operativo, esto sigue siendo público.
    booking_deposit_amount: Decimal


class SlotOut(BaseModel):
    start: dt.datetime
    end: dt.datetime
    staff_ids: list[uuid.UUID]


class AvailabilityOut(BaseModel):
    salon_id: uuid.UUID
    service_id: uuid.UUID
    date: dt.date
    slots: list[SlotOut]


class BookingCreate(BaseModel):
    salon_id: uuid.UUID
    service_id: uuid.UUID
    #: Debe incluir offset (ej. "2026-09-01T14:00:00-03:00"). Se normaliza a UTC.
    start_time: dt.datetime
    staff_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    guest_name: str | None = Field(default=None, max_length=120)
    guest_phone: str | None = Field(default=None, max_length=40)
    #: Opcional. Si viene, la confirmación ofrece sumar el turno al
    #: calendario del invitado. Sin validación de formato estricta (misma
    #: laxitud que guest_phone) — igual lo tipea el usuario en un <input>.
    guest_email: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=1000)
    payment_method: PaymentMethod | None = None

    @model_validator(mode="after")
    def _require_tz(self) -> "BookingCreate":
        # La identidad del cliente (client_id vs. guest_name) se resuelve en
        # la ruta según haya o no sesión, y la valida app.services.bookings
        # como último resguardo. Acá solo se exige tz-aware.
        if self.start_time.tzinfo is None:
            raise ValueError("start_time debe incluir zona horaria (offset ISO 8601)")
        return self


class BookingReschedule(BaseModel):
    start_time: dt.datetime
    staff_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _require_tz(self) -> "BookingReschedule":
        if self.start_time.tzinfo is None:
            raise ValueError("start_time debe incluir zona horaria (offset ISO 8601)")
        return self


class BookingCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BookingStatusUpdate(BaseModel):
    status: AppointmentStatus
    reason: str | None = Field(default=None, max_length=500)


class PaymentStatusUpdate(BaseModel):
    payment_status: PaymentStatus


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    salon_id: uuid.UUID
    client_id: uuid.UUID | None
    #: Nombre del cliente registrado, resuelto server-side (join sobre
    #: profiles). None para invitados: ahí el nombre está en `guest_name`.
    client_name: str | None = None
    guest_name: str | None
    guest_email: str | None = None
    staff_id: uuid.UUID
    service_id: uuid.UUID
    start_time: dt.datetime
    end_time: dt.datetime
    duration_minutes: int
    price: Decimal
    currency: str
    status: AppointmentStatus
    notes: str | None
    created_at: dt.datetime
    payment_method: PaymentMethod | None = None
    payment_status: PaymentStatus = PaymentStatus.unpaid
    deposit_amount: Decimal | None = None
    #: URL de checkout de Mercado Pago. Solo viene poblada en la respuesta de
    #: `POST /bookings` justo después de crear el turno; no es una columna.
    mp_init_point: str | None = None


class ErrorOut(BaseModel):
    code: str
    message: str
    context: dict = {}

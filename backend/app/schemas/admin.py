from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db.models import UserRole


# --- Categorías de servicios -----------------------------------------------


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = Field(default=0)


class CategoryUpdate(BaseModel):
    """Actualización parcial: solo se tocan los campos presentes."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    salon_id: uuid.UUID
    name: str
    sort_order: int


# --- Services ------------------------------------------------------------


class ServiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category_id: uuid.UUID | None = None
    duration_minutes: int = Field(ge=5, le=600)
    buffer_minutes: int = Field(default=0, ge=0, le=120)
    price: Decimal = Field(ge=0)
    currency: str = Field(default="ARS", min_length=3, max_length=3)
    sort_order: int = Field(default=0)


class ServiceUpdate(BaseModel):
    """Actualización parcial: solo se tocan los campos presentes."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category_id: uuid.UUID | None = Field(default=None)
    duration_minutes: int | None = Field(default=None, ge=5, le=600)
    buffer_minutes: int | None = Field(default=None, ge=0, le=120)
    price: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_active: bool | None = None
    sort_order: int | None = None


class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    salon_id: uuid.UUID
    category_id: uuid.UUID | None
    #: Nombre de la categoría, resuelto por app.services.admin — no es una
    #: columna real de `services`, se completa a mano antes de serializar.
    category_name: str | None = None
    name: str
    description: str | None
    duration_minutes: int
    buffer_minutes: int
    price: Decimal
    currency: str
    is_active: bool
    sort_order: int


# --- Staff -----------------------------------------------------------------


class StaffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    salon_id: uuid.UUID
    full_name: str
    email: str | None
    phone: str | None
    role: UserRole
    is_active: bool
    color: str | None


class StaffActiveUpdate(BaseModel):
    is_active: bool


class StaffColorUpdate(BaseModel):
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class PublicStaffOut(BaseModel):
    """Vista pública mínima: solo lo necesario para mostrar "con Fulana" en
    la UI de reservas. Sin email/phone/role — eso sigue siendo privado."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str


class StaffServicesUpdate(BaseModel):
    """Reemplaza por completo el conjunto de servicios que presta el profesional."""

    service_ids: list[uuid.UUID]


class StaffInviteCreate(BaseModel):
    """Alta de un owner/staff. Reemplaza el insert manual en Supabase que
    documentaba `frontend/README.md`."""

    email: str = Field(min_length=3, max_length=320)
    full_name: str = Field(min_length=1, max_length=200)
    role: Literal["owner", "staff"]

    @model_validator(mode="after")
    def _basic_email_shape(self) -> "StaffInviteCreate":
        if "@" not in self.email or self.email.startswith("@") or self.email.endswith("@"):
            raise ValueError("email inválido")
        return self


class StaffInviteOut(StaffOut):
    """Igual que StaffOut, con la contraseña temporal que la dueña tiene que
    pasarle al staff a mano. Solo viaja en la respuesta del alta — no se
    guarda en ningún lado de este lado."""

    temporary_password: str


class StaffPasswordResetOut(BaseModel):
    """Respuesta de `POST /staff/{id}/reset-password`: la contraseña
    temporal nueva, para pasarle al staff a mano igual que en el alta."""

    temporary_password: str


# --- Horarios laborales ------------------------------------------------------
#
# Por fecha puntual del calendario (no recurrente semana a semana). Ver
# StaffScheduleDate en app/db/models.py.


class ScheduleBlockIn(BaseModel):
    start_time: dt.time
    end_time: dt.time

    @model_validator(mode="after")
    def _order(self) -> "ScheduleBlockIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time debe ser posterior a start_time")
        return self


class ScheduleDateReplace(BaseModel):
    """Reemplaza todos los bloques de una fecha puntual de una vez."""

    blocks: list[ScheduleBlockIn]


class ScheduleBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: dt.date
    start_time: dt.time
    end_time: dt.time


# --- Ausencias ---------------------------------------------------------------


class TimeOffCreate(BaseModel):
    starts_at: dt.datetime
    ends_at: dt.datetime
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _validate(self) -> "TimeOffCreate":
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("starts_at/ends_at deben incluir zona horaria")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at debe ser posterior a starts_at")
        return self


class TimeOffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    staff_id: uuid.UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    reason: str | None


# --- Bloqueo de agenda (salón entero) -----------------------------------------


class SalonClosureCreate(BaseModel):
    starts_at: dt.datetime
    ends_at: dt.datetime
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _validate(self) -> "SalonClosureCreate":
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError("starts_at/ends_at deben incluir zona horaria")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at debe ser posterior a starts_at")
        return self


class SalonClosureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    salon_id: uuid.UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    reason: str | None


# --- Configuración de pagos (seña / Mercado Pago) ---------------------------


class SalonPaymentSettingsUpdate(BaseModel):
    """Actualización parcial: `None` en cualquier campo significa "no tocar".

    Para `mercadopago_access_token`: mandar `""` (string vacío) borra el
    token guardado (el salón vuelve a depender del default global del
    backend, si existe); un string no vacío lo reemplaza; `None` lo deja como
    está.
    """

    booking_deposit_amount: Decimal | None = Field(default=None, gt=0)
    mercadopago_access_token: str | None = Field(default=None, max_length=500)


class SalonPaymentSettingsOut(BaseModel):
    #: Valor efectivo ya aplicado (el propio del salón, o el default global
    #: del backend si el salón no configuró el suyo).
    booking_deposit_amount: Decimal
    #: No se devuelve el token en ningún momento, ni cifrado: solo si hay uno
    #: cargado (propio de este salón o el default global del backend).
    mercadopago_configured: bool
    #: Distingue "tiene su propio token" de "depende del default global", así
    #: el panel puede avisarle al owner si está compartiendo cuenta con otro
    #: salón del mismo backend.
    mercadopago_uses_salon_token: bool

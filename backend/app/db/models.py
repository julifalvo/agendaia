"""Mapeo SQLAlchemy del schema definido en supabase/migrations/.

Las columnas generadas (`time_range`, `period`) no se mapean a propósito: las
calcula Postgres y mapearlas rompería los INSERT.
"""

from __future__ import annotations

import datetime as dt
import enum
import uuid
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    owner = "owner"
    staff = "staff"
    client = "client"


class AppointmentStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"
    no_show = "no_show"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    mercadopago = "mercadopago"
    #: Transferencia bancaria directa. Única opción ofrecida en la reserva
    #: pública desde 20260815100000_transfer_payment_method.sql — 'cash' y
    #: 'mercadopago' quedan por compatibilidad con turnos históricos.
    transfer = "transfer"


class PaymentStatus(str, enum.Enum):
    unpaid = "unpaid"
    pending = "pending"
    paid = "paid"


#: Estados que ocupan agenda. Debe coincidir con el WHERE del EXCLUDE constraint
#: `appointments_no_double_booking` en la migración.
#: Es una tupla y no un set porque se pasa directo a `Column.in_()`.
ACTIVE_STATUSES: tuple[AppointmentStatus, ...] = (
    AppointmentStatus.pending,
    AppointmentStatus.confirmed,
)

_role_enum = Enum(UserRole, name="user_role", schema="public", create_type=False)
_status_enum = Enum(
    AppointmentStatus, name="appointment_status", schema="public", create_type=False
)
_payment_method_enum = Enum(
    PaymentMethod, name="payment_method", schema="public", create_type=False
)
_payment_status_enum = Enum(
    PaymentStatus, name="payment_status", schema="public", create_type=False
)


class Salon(Base):
    __tablename__ = "salons"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    name: Mapped[str] = mapped_column(Text)
    slug: Mapped[str] = mapped_column(Text, unique=True)
    timezone: Mapped[str] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    min_lead_minutes: Mapped[int] = mapped_column(Integer)
    max_advance_days: Mapped[int] = mapped_column(Integer)
    slot_step_minutes: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    salon_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("salons.id")
    )
    role: Mapped[UserRole] = mapped_column(_role_enum)
    full_name: Mapped[str] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    #: Color hex (#RRGGBB) en el calendario admin. NULL para role=client. Se
    #: asigna en app/services/admin.invite_staff por rotación de paleta.
    color: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (UniqueConstraint("id", "salon_id"),)


class ServiceCategory(Base):
    __tablename__ = "service_categories"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("salons.id")
    )
    name: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (UniqueConstraint("id", "salon_id"),)


class Service(Base):
    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("salons.id")
    )
    #: Sector del catálogo (p. ej. "Uñas", "Peluquería"). NULL = sin
    #: categorizar. FK compuesta con salon_id, ver __table_args__.
    category_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    buffer_minutes: Mapped[int] = mapped_column(Integer)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["category_id", "salon_id"],
            ["service_categories.id", "service_categories.salon_id"],
        ),
    )

    @property
    def occupied_minutes(self) -> int:
        """Minutos de agenda que consume el servicio, incluyendo el buffer."""
        return self.duration_minutes + self.buffer_minutes


class StaffService(Base):
    __tablename__ = "staff_services"

    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    staff_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    service_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StaffSchedule(Base):
    """Horario semanal recurrente. Deprecado desde
    20260819120000_staff_schedule_dates_and_closures.sql: el motor de
    disponibilidad y el admin ya no lo leen ni lo escriben, reemplazado por
    `StaffScheduleDate` (fecha puntual, no recurrente). Se mantiene la clase
    y la tabla sin dropear para no perder horarios ya cargados.
    """

    __tablename__ = "staff_schedules"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    staff_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    #: 0 = lunes ... 6 = domingo (igual que `date.weekday()`).
    weekday: Mapped[int] = mapped_column(SmallInteger)
    start_time: Mapped[dt.time] = mapped_column(Time)
    end_time: Mapped[dt.time] = mapped_column(Time)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StaffScheduleDate(Base):
    """Horario laboral anclado a una fecha puntual del calendario (no se
    repite semana a semana). Fuente de verdad actual del motor de
    disponibilidad, en reemplazo de `StaffSchedule`."""

    __tablename__ = "staff_schedule_dates"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    staff_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    date: Mapped[dt.date] = mapped_column(Date)
    start_time: Mapped[dt.time] = mapped_column(Time)
    end_time: Mapped[dt.time] = mapped_column(Time)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TimeOff(Base):
    __tablename__ = "time_off"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    staff_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SalonClosure(Base):
    """Bloqueo de agenda a nivel salón (feriado, vacaciones): ningún
    profesional del salón queda disponible durante el rango, sin tener que
    tocar el horario de cada uno."""

    __tablename__ = "salon_closures"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    client_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    guest_name: Mapped[str | None] = mapped_column(Text)
    guest_phone: Mapped[str | None] = mapped_column(Text)
    #: Solo para reservas de invitado, ver 20260814150000_guest_email.sql.
    guest_email: Mapped[str | None] = mapped_column(Text)
    staff_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    service_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    start_time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[AppointmentStatus] = mapped_column(_status_enum)
    notes: Mapped[str | None] = mapped_column(Text)
    cancelled_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    #: Seña: método elegido, estado de pago (independiente de `status`) y
    #: monto congelado al momento de reservar. Ver 20260814130000_payment_fields.sql.
    payment_method: Mapped[PaymentMethod | None] = mapped_column(_payment_method_enum)
    payment_status: Mapped[PaymentStatus] = mapped_column(_payment_status_enum)
    deposit_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    mp_preference_id: Mapped[str | None] = mapped_column(Text)
    mp_payment_id: Mapped[str | None] = mapped_column(Text)
    #: id del evento en Google Calendar si se pudo empujar (push best-effort,
    #: ver app/services/google_calendar.py). NULL si Google no está conectado
    #: o el push falló.
    google_event_id: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class GoogleCalendarConnection(Base):
    """Conexión OAuth única por salón a una cuenta de Google compartida (no
    una por profesional). `salon_id` es la PK: eso mismo impone que exista a
    lo sumo una fila por salón. Sin access_token/expires_at a propósito: el
    access token se vuelve a pedir con el refresh_token en cada uso, ver
    app/services/google_calendar.py."""

    __tablename__ = "google_calendar_connections"

    salon_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("salons.id"), primary_key=True
    )
    calendar_id: Mapped[str] = mapped_column(Text, default="primary")
    #: Cifrado con Fernet (settings.google_calendar_token_key) antes de
    #: guardar — nunca en texto plano.
    refresh_token_encrypted: Mapped[str] = mapped_column(Text)
    connected_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    connected_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_synced_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class GoogleCalendarBlock(Base):
    """Eventos creados directamente en el Google Calendar conectado (no por
    esta app), sincronizados on-demand y tratados como agenda ocupada por el
    motor de disponibilidad (ver app/services/availability.busy_intervals).
    `staff_id` NULL bloquea todo el salón (como SalonClosure); con valor
    bloquea solo a ese profesional — se infiere de un tag opcional "[Nombre]"
    al inicio del título del evento en Google."""

    __tablename__ = "google_calendar_blocks"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    google_event_id: Mapped[str] = mapped_column(Text)
    staff_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    summary: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class IdempotencyKey(Base):
    """Reserva del header `Idempotency-Key` de POST /bookings.

    `appointment_id` empieza NULL: se completa recién cuando `create_booking`
    termina con éxito. Ver `app/services/bookings.create_booking_idempotent`.
    """

    __tablename__ = "idempotency_keys"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    salon_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True))
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

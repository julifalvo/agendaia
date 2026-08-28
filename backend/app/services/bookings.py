"""Lógica principal del servicio de reservas.

El punto crítico del sistema es `create_booking`. La estrategia frente al
double-booking es *optimista*: no se toman locks ni se serializan transacciones.
Se intenta el INSERT y se deja que el EXCLUDE constraint de Postgres arbitre.

    Request A ──┐
                ├─► INSERT ─► uno commitea, el otro recibe SQLSTATE 23P01
    Request B ──┘

Esto es correcto bajo READ COMMITTED (el default), escala sin puntos de
contención y no puede degradarse por un bug de la capa de aplicación: aunque
alguien saltee las validaciones de `availability`, la base rechaza el solape.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import (
    ConflictError,
    InvalidBookingWindow,
    InvalidStateTransition,
    OutsideWorkingHours,
    ResourceNotFound,
    SlotUnavailable,
    StaffCannotPerformService,
    UpstreamError,
)
from app.db.models import (
    ACTIVE_STATUSES,
    Appointment,
    AppointmentStatus,
    IdempotencyKey,
    PaymentMethod,
    PaymentStatus,
    Profile,
    Salon,
    Service,
)
from app.services import availability, email, google_calendar, notifications, payments
from app.services.availability import SlotTakenLocally
from app.services.payments import MercadoPagoNotConfigured

logger = logging.getLogger(__name__)

#: Constraints de la migración que representan una colisión de agenda.
_OVERLAP_CONSTRAINTS = {
    "appointments_no_double_booking": (
        "Ese horario acaba de ser reservado por otra persona. "
        "Elegí otro de los disponibles."
    ),
    "appointments_client_no_overlap": (
        "Ya tenés otro turno agendado que se superpone con este horario."
    ),
}

#: Nombre del evento de webhook para cada estado destino en `transition_status`.
_STATUS_EVENTS: dict[AppointmentStatus, str] = {
    AppointmentStatus.confirmed: "booking.confirmed",
    AppointmentStatus.completed: "booking.completed",
    AppointmentStatus.cancelled: "booking.cancelled",
    AppointmentStatus.no_show: "booking.no_show",
}

#: Transiciones de estado permitidas.
_ALLOWED_TRANSITIONS: dict[AppointmentStatus, set[AppointmentStatus]] = {
    AppointmentStatus.pending: {
        AppointmentStatus.confirmed,
        AppointmentStatus.cancelled,
    },
    AppointmentStatus.confirmed: {
        AppointmentStatus.completed,
        AppointmentStatus.cancelled,
        AppointmentStatus.no_show,
    },
    AppointmentStatus.completed: set(),
    AppointmentStatus.cancelled: set(),
    AppointmentStatus.no_show: set(),
}


@dataclass
class BookingRequest:
    salon_id: uuid.UUID
    service_id: uuid.UUID
    start_time: dt.datetime
    staff_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    guest_name: str | None = None
    guest_phone: str | None = None
    guest_email: str | None = None
    notes: str | None = None
    created_by: uuid.UUID | None = None
    #: Confirmar de una en vez de dejar en 'pending' (reservas cargadas por el salón).
    auto_confirm: bool = False
    #: Seña elegida por el cliente. None para turnos cargados por el salón
    #: sin política de seña (ej. walk-ins).
    payment_method: PaymentMethod | None = None


def _integrity_error_to_domain(exc: IntegrityError) -> Exception:
    """Traduce una violación de constraint a un error de dominio."""
    detail = str(getattr(exc, "orig", exc))

    for constraint, message in _OVERLAP_CONSTRAINTS.items():
        if constraint in detail:
            return SlotUnavailable(message, constraint=constraint)

    if "appointments_staff_offers_service" in detail or "no presta el servicio" in detail:
        return StaffCannotPerformService(
            "El profesional seleccionado no presta este servicio"
        )

    # Constraint inesperado: se propaga como 500 para que quede en los logs.
    return exc


async def _resolve_staff(
    session: AsyncSession,
    request: BookingRequest,
    salon: Salon,
    service: Service,
    now: dt.datetime,
) -> tuple[uuid.UUID, availability.Interval | None]:
    """Elige profesional y, si ya lo validó, devuelve el intervalo resultante.

    Si el cliente eligió uno, solo se valida que pueda prestar el servicio y se
    devuelve `None` como intervalo: la disponibilidad la chequea `create_booking`,
    así se distingue "no presta este servicio" de "está ocupado".

    Si no eligió, se prueban los candidatos en orden y se toma el primero que
    pueda tomar exactamente ese horario. No se usa la grilla de slots a
    propósito: el horario pedido puede no coincidir con `slot_step_minutes`.
    """
    if request.staff_id is not None:
        await availability.eligible_staff_ids(
            session, request.service_id, request.staff_id
        )
        return request.staff_id, None

    candidates = await availability.eligible_staff_ids(session, request.service_id)
    last_error: Exception | None = None

    for candidate_id in candidates:
        try:
            interval = await availability.assert_slot_bookable(
                session,
                salon=salon,
                service=service,
                staff_id=candidate_id,
                start=request.start_time,
                now=now,
            )
            return candidate_id, interval
        except SlotTakenLocally as exc:
            last_error = exc
        except OutsideWorkingHours as exc:
            last_error = exc
        except InvalidBookingWindow:
            # No depende del profesional: falla igual para todos.
            raise

    if last_error is None:
        raise SlotUnavailable(
            "No hay profesionales habilitados para este servicio",
            service_id=str(request.service_id),
        )
    raise SlotUnavailable(
        "Ningún profesional está disponible en ese horario",
        start_time=request.start_time.isoformat(),
    )


async def create_booking(
    session: AsyncSession,
    request: BookingRequest,
    now: dt.datetime | None = None,
) -> Appointment:
    """Crea un turno de forma segura frente a reservas concurrentes.

    Flujo:
      1. Cargar y validar salón / servicio / cliente (integridad + 404 claros).
      2. Resolver el profesional.
      3. Pre-validar el slot (horario laboral, lead time) -> errores legibles.
      4. INSERT. Si el constraint de exclusión salta, alguien ganó la carrera:
         se traduce a 409 en vez de 500.
    """
    now = now or dt.datetime.now(dt.UTC)

    salon = await availability.load_salon(session, request.salon_id)
    service = await availability.load_service(
        session, request.salon_id, request.service_id
    )

    if request.client_id is not None:
        client = await session.get(Profile, request.client_id)
        if client is None or client.salon_id != request.salon_id:
            raise ResourceNotFound(
                "Cliente inexistente en este salón", client_id=str(request.client_id)
            )
    elif not (request.guest_name and request.guest_name.strip()):
        raise ResourceNotFound(
            "Se requiere un cliente registrado o el nombre del invitado"
        )

    staff_id, interval = await _resolve_staff(session, request, salon, service, now)

    deposit_amount = (
        get_settings().booking_deposit_amount
        if request.payment_method is not None
        else None
    )

    if interval is None:
        # El cliente eligió profesional: recién acá se valida su disponibilidad.
        try:
            interval = await availability.assert_slot_bookable(
                session,
                salon=salon,
                service=service,
                staff_id=staff_id,
                start=request.start_time,
                now=now,
            )
        except SlotTakenLocally:
            raise SlotUnavailable(
                _OVERLAP_CONSTRAINTS["appointments_no_double_booking"]
            ) from None

    appointment = Appointment(
        salon_id=salon.id,
        client_id=request.client_id,
        guest_name=request.guest_name,
        guest_phone=request.guest_phone,
        guest_email=request.guest_email,
        staff_id=staff_id,
        service_id=service.id,
        start_time=interval.start,
        end_time=interval.end,
        # Se congela la duración ocupada (servicio + buffer) y el precio vigente:
        # el histórico no debe cambiar si mañana se edita el servicio.
        duration_minutes=service.occupied_minutes,
        price=service.price,
        currency=service.currency,
        status=(
            AppointmentStatus.confirmed
            if request.auto_confirm
            else AppointmentStatus.pending
        ),
        notes=request.notes,
        created_by=request.created_by,
        payment_method=request.payment_method,
        # Con seña elegida arranca 'pending' (transferencia/Mercado Pago
        # esperando confirmación); sin seña (created_by staff sin política de
        # seña) arranca 'unpaid', no hay nada que confirmar.
        payment_status=(
            PaymentStatus.pending
            if request.payment_method is not None
            else PaymentStatus.unpaid
        ),
        deposit_amount=deposit_amount,
    )
    session.add(appointment)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        domain_error = _integrity_error_to_domain(exc)
        if isinstance(domain_error, SlotUnavailable):
            logger.info(
                "Carrera de reserva resuelta por la base: staff=%s start=%s",
                staff_id,
                interval.start.isoformat(),
            )
        raise domain_error from exc

    await session.refresh(appointment)
    await notifications.notify("booking.created", appointment)
    await email.send_booking_confirmation(appointment, service.name)
    await google_calendar.push_appointment_created(session, appointment, service.name)
    await attach_client_name(session, appointment)

    # `mp_init_point` no es una columna: es la URL de checkout que el
    # frontend necesita para redirigir, generada acá mismo así el cliente no
    # tiene que hacer un segundo request. Se deja en None si Mercado Pago no
    # está configurado o rechaza la preferencia: el turno igual queda
    # reservado (ver comentario más abajo) y el salón coordina la seña a mano.
    appointment.mp_init_point = None
    if request.payment_method is PaymentMethod.mercadopago:
        try:
            preference = await payments.create_preference(
                appointment, description=f"Seña de turno — {service.name}"
            )
        except (UpstreamError, MercadoPagoNotConfigured):
            logger.exception(
                "No se pudo crear la preferencia de Mercado Pago para el turno %s",
                appointment.id,
            )
        else:
            appointment.mp_preference_id = preference["id"]
            appointment.payment_status = PaymentStatus.pending
            await session.commit()
            await session.refresh(appointment)
            appointment.mp_init_point = preference["init_point"]

    return appointment


async def attach_client_name(session: AsyncSession, appointment: Appointment) -> Appointment:
    """Resuelve `client_name` desde `profiles` para armar el BookingOut.

    El turno solo guarda `client_id`; el nombre para mostrar se busca acá en
    vez de desnormalizarlo en la tabla, así no queda desactualizado si el
    cliente cambia su nombre después.
    """
    if appointment.client_id is None:
        appointment.client_name = None
        return appointment

    profile = await session.get(Profile, appointment.client_id)
    appointment.client_name = profile.full_name if profile else None
    return appointment


async def create_booking_idempotent(
    session: AsyncSession,
    request: BookingRequest,
    idempotency_key: str | None = None,
    now: dt.datetime | None = None,
) -> Appointment:
    """Como `create_booking`, pero a prueba de reintentos de red.

    Si el cliente manda el mismo `Idempotency-Key` dos veces (timeout que
    reintenta, doble click, un proxy que reenvía), la segunda llamada
    devuelve el turno que ya se creó en vez de intentar crear uno nuevo.

    La key se reserva ANTES de tocar la agenda, insertando una fila
    placeholder con `appointment_id = NULL`. Así, si dos requests con la
    misma key llegan en simultáneo, la segunda choca contra la PK de
    `idempotency_keys` (no contra el EXCLUDE de `appointments`) y nunca
    llega a intentar un segundo INSERT de turno — el mismo patrón optimista
    que el resto del módulo, aplicado un paso antes.
    """
    if not idempotency_key:
        return await create_booking(session, request, now=now)

    session.add(IdempotencyKey(key=idempotency_key, salon_id=request.salon_id))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return await _resolve_idempotent_result(session, idempotency_key)

    try:
        appointment = await create_booking(session, request, now=now)
    except Exception:
        # No dejamos la key "quemada" por un intento que falló: un reintento
        # legítimo con la misma key debe poder evaluarse de cero, no chocar
        # para siempre contra un turno que nunca se creó.
        await session.execute(
            delete(IdempotencyKey).where(IdempotencyKey.key == idempotency_key)
        )
        await session.commit()
        raise

    await session.execute(
        IdempotencyKey.__table__.update()
        .where(IdempotencyKey.key == idempotency_key)
        .values(appointment_id=appointment.id)
    )
    await session.commit()
    return appointment


async def _resolve_idempotent_result(
    session: AsyncSession, idempotency_key: str
) -> Appointment:
    row = await session.get(IdempotencyKey, idempotency_key)
    if row is None or row.appointment_id is None:
        # Ventana angosta: la otra request todavía no terminó de guardar el
        # resultado. Es un caso borde raro (microsegundos); se le pide al
        # cliente reintentar en vez de devolver un resultado a medio confirmar.
        raise ConflictError(
            "Esta reserva ya se está procesando, reintentá en un instante"
        )
    return await get_booking(session, row.appointment_id)


async def get_booking(
    session: AsyncSession, appointment_id: uuid.UUID
) -> Appointment:
    appointment = await session.get(Appointment, appointment_id)
    if appointment is None:
        raise ResourceNotFound("Turno inexistente", appointment_id=str(appointment_id))
    await attach_client_name(session, appointment)
    return appointment


async def transition_status(
    session: AsyncSession,
    appointment_id: uuid.UUID,
    new_status: AppointmentStatus,
    reason: str | None = None,
) -> Appointment:
    """Cambia el estado de un turno respetando la máquina de estados.

    Cancelar libera el horario automáticamente: el EXCLUDE constraint solo
    aplica a los estados activos, así que no hace falta borrar nada.
    """
    appointment = await get_booking(session, appointment_id)

    allowed = _ALLOWED_TRANSITIONS[appointment.status]
    if new_status not in allowed:
        raise InvalidStateTransition(
            f"No se puede pasar de '{appointment.status.value}' a "
            f"'{new_status.value}'",
            current=appointment.status.value,
            requested=new_status.value,
        )

    appointment.status = new_status
    if new_status is AppointmentStatus.cancelled:
        appointment.cancelled_at = dt.datetime.now(dt.UTC)
        appointment.cancellation_reason = reason
    else:
        # El CHECK de la base exige cancelled_at NULL fuera del estado cancelado.
        appointment.cancelled_at = None
        appointment.cancellation_reason = None

    await session.commit()
    await session.refresh(appointment)
    await notifications.notify(
        _STATUS_EVENTS[new_status], appointment, reason=reason
    )
    if new_status is AppointmentStatus.cancelled:
        # completed/no_show no tocan el calendario: el evento ya pasó, no hay
        # nada que sincronizar.
        await google_calendar.push_appointment_cancelled(session, appointment)
    return appointment


async def cancel_booking(
    session: AsyncSession, appointment_id: uuid.UUID, reason: str | None = None
) -> Appointment:
    return await transition_status(
        session, appointment_id, AppointmentStatus.cancelled, reason=reason
    )


async def confirm_mercadopago_payment(session: AsyncSession, payment_id: str) -> None:
    """Reconcilia una notificación de pago del webhook de Mercado Pago.

    Nunca confía en el cuerpo de la notificación: siempre vuelve a pedirle el
    pago a la API de Mercado Pago con nuestro propio access token antes de
    tocar el turno. Es idempotente — un mismo `payment_id` notificado dos
    veces (reintentos de Mercado Pago) no dispara el aviso de confirmación
    dos veces ni rompe si el turno ya no está en 'pending'.
    """
    try:
        payment = await payments.get_payment(payment_id)
    except (UpstreamError, MercadoPagoNotConfigured):
        logger.warning("No se pudo verificar el pago %s en Mercado Pago", payment_id)
        return

    external_reference = payment.get("external_reference")
    if not external_reference:
        logger.warning("Pago de Mercado Pago %s sin external_reference", payment_id)
        return

    try:
        appointment_id = uuid.UUID(str(external_reference))
    except ValueError:
        logger.warning(
            "external_reference inválido en el pago %s: %s",
            payment_id,
            external_reference,
        )
        return

    appointment = await session.get(Appointment, appointment_id)
    if appointment is None:
        logger.warning(
            "El pago %s de Mercado Pago referencia un turno inexistente (%s)",
            payment_id,
            appointment_id,
        )
        return

    if appointment.payment_status is PaymentStatus.paid:
        return  # ya procesado; reintento del webhook.

    appointment.mp_payment_id = str(payment.get("id") or payment_id)

    if payment.get("status") != "approved":
        await session.commit()
        return

    appointment.payment_status = PaymentStatus.paid
    await session.commit()
    await session.refresh(appointment)

    if appointment.status is AppointmentStatus.pending:
        await transition_status(session, appointment.id, AppointmentStatus.confirmed)


async def set_payment_status(
    session: AsyncSession, appointment_id: uuid.UUID, payment_status: PaymentStatus
) -> Appointment:
    """Fija a mano el estado de la seña de un turno (transferencia verificada
    -o desmarcada por error- contra el resumen bancario del salón — no hay
    forma automática de saberlo, a diferencia del webhook de Mercado Pago).

    Idempotente. Solo marcar 'paid' tiene efecto sobre el turno (lo confirma
    si seguía 'pending', mismo criterio que `confirm_mercadopago_payment`):
    deshacer un pago no revierte el turno, son cosas separadas — si ya se
    avisó al cliente que quedó confirmado, no tiene sentido volver atrás solo
    porque se corrige un tilde en la seña.
    """
    appointment = await get_booking(session, appointment_id)
    if appointment.payment_status is payment_status:
        return appointment

    appointment.payment_status = payment_status
    await session.commit()
    await session.refresh(appointment)

    if payment_status is PaymentStatus.paid and appointment.status is AppointmentStatus.pending:
        return await transition_status(
            session, appointment.id, AppointmentStatus.confirmed
        )
    return await attach_client_name(session, appointment)


async def reschedule_booking(
    session: AsyncSession,
    appointment_id: uuid.UUID,
    new_start: dt.datetime,
    new_staff_id: uuid.UUID | None = None,
    now: dt.datetime | None = None,
) -> Appointment:
    """Mueve un turno activo a otro horario y/o profesional.

    Se actualiza en lugar de cancelar+crear para no perder el id (los recordatorios
    y links enviados al cliente lo referencian). El EXCLUDE constraint también
    cubre los UPDATE, así que la reprogramación es igual de segura que el alta.
    """
    now = now or dt.datetime.now(dt.UTC)
    appointment = await get_booking(session, appointment_id)

    if appointment.status not in ACTIVE_STATUSES:
        raise InvalidStateTransition(
            f"Solo se pueden reprogramar turnos activos (actual: "
            f"'{appointment.status.value}')",
            current=appointment.status.value,
        )

    salon = await availability.load_salon(session, appointment.salon_id)
    service = await availability.load_service(
        session, appointment.salon_id, appointment.service_id
    )
    staff_id = new_staff_id or appointment.staff_id

    if new_staff_id is not None and new_staff_id != appointment.staff_id:
        await availability.eligible_staff_ids(
            session, appointment.service_id, new_staff_id
        )

    try:
        interval = await availability.assert_slot_bookable(
            session,
            salon=salon,
            service=service,
            staff_id=staff_id,
            start=new_start,
            now=now,
            exclude_appointment_id=appointment.id,
        )
    except SlotTakenLocally:
        raise SlotUnavailable(
            _OVERLAP_CONSTRAINTS["appointments_no_double_booking"]
        ) from None

    previous_start = appointment.start_time
    appointment.staff_id = staff_id
    appointment.start_time = interval.start
    appointment.end_time = interval.end
    appointment.duration_minutes = service.occupied_minutes

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _integrity_error_to_domain(exc) from exc

    await session.refresh(appointment)
    await notifications.notify(
        "booking.rescheduled", appointment, previous_start=previous_start.isoformat()
    )
    await google_calendar.push_appointment_updated(session, appointment, service.name)
    return appointment


async def list_bookings(
    session: AsyncSession,
    salon_id: uuid.UUID,
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
    staff_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    statuses: list[AppointmentStatus] | None = None,
    limit: int = 100,
) -> list[Appointment]:
    stmt = select(Appointment).where(Appointment.salon_id == salon_id)

    if date_from is not None:
        stmt = stmt.where(Appointment.end_time > date_from)
    if date_to is not None:
        stmt = stmt.where(Appointment.start_time < date_to)
    if staff_id is not None:
        stmt = stmt.where(Appointment.staff_id == staff_id)
    if client_id is not None:
        stmt = stmt.where(Appointment.client_id == client_id)
    if statuses:
        stmt = stmt.where(Appointment.status.in_(statuses))

    stmt = stmt.order_by(Appointment.start_time).limit(limit)
    appointments = list((await session.scalars(stmt)).all())
    await _attach_client_names_bulk(session, appointments)
    return appointments


async def _attach_client_names_bulk(
    session: AsyncSession, appointments: list[Appointment]
) -> None:
    """Versión en lote de `attach_client_name`, para no hacer N queries al listar."""
    client_ids = {a.client_id for a in appointments if a.client_id is not None}
    if not client_ids:
        for a in appointments:
            a.client_name = None
        return

    rows = await session.execute(
        select(Profile.id, Profile.full_name).where(Profile.id.in_(client_ids))
    )
    names = dict(rows.all())
    for a in appointments:
        a.client_name = names.get(a.client_id) if a.client_id else None

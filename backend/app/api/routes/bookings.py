from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_profile, get_optional_profile, require_roles
from app.core.errors import PermissionDenied, ResourceNotFound
from app.db.models import Appointment, AppointmentStatus, Profile, UserRole
from app.db.session import get_session
from app.schemas.booking import (
    AvailabilityOut,
    BookingCancel,
    BookingCreate,
    BookingOut,
    BookingReschedule,
    BookingStatusUpdate,
    PaymentStatusUpdate,
    SlotOut,
)
from app.services import availability, bookings
from app.services.bookings import BookingRequest

router = APIRouter(tags=["reservas"])

_STAFF_ROLES = (UserRole.owner, UserRole.staff)


def _authorize_access(profile: Profile, appointment: Appointment) -> None:
    """Un cliente solo ve lo suyo; staff/owner ven lo de su salón.

    Se devuelve 404 en vez de 403 ante un turno ajeno para no confirmarle a
    un atacante que el id que probó existe.
    """
    if profile.role in _STAFF_ROLES:
        if appointment.salon_id == profile.salon_id:
            return
    elif appointment.client_id == profile.id:
        return

    raise ResourceNotFound("Turno inexistente", appointment_id=str(appointment.id))


def _authorize_mutation(profile: Profile, appointment: Appointment) -> None:
    """Como `_authorize_access`, pero además exige que un staff (no owner) sea
    el profesional asignado para poder modificar el turno.

    El owner tiene el mismo alcance que antes (todo el salón); un staff ahora
    solo puede cancelar/reprogramar/cambiar estado o seña de sus propios
    turnos, no los de otro profesional. Se usa solo en las rutas que mutan un
    turno existente — la lectura (`get_booking`, `list_bookings`) sigue
    salón-completo para staff, porque la agenda compartida necesita que vean
    todas las columnas.
    """
    _authorize_access(profile, appointment)
    if profile.role is UserRole.staff and appointment.staff_id != profile.id:
        raise PermissionDenied(
            "Solo el profesional asignado o el dueño del salón pueden modificar este turno"
        )


@router.get("/availability", response_model=AvailabilityOut)
async def check_availability(
    salon_id: uuid.UUID,
    service_id: uuid.UUID,
    date: dt.date,
    staff_id: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> AvailabilityOut:
    """Horarios ofrecibles para un servicio en una fecha.

    Público a propósito: hace falta antes de que el visitante inicie sesión
    para poder mostrarle la grilla en la página de reservas. La respuesta es
    solo informativa — un slot listado acá puede haber sido tomado para
    cuando llegue el POST, y el cliente debe manejar el 409.
    """
    slots = await availability.get_available_slots(
        session,
        salon_id=salon_id,
        service_id=service_id,
        day=date,
        staff_id=staff_id,
    )
    return AvailabilityOut(
        salon_id=salon_id,
        service_id=service_id,
        date=date,
        slots=[
            SlotOut(start=s.start, end=s.end, staff_ids=s.staff_ids) for s in slots
        ],
    )


@router.post(
    "/bookings", response_model=BookingOut, status_code=status.HTTP_201_CREATED
)
async def create_booking(
    payload: BookingCreate,
    profile: Profile | None = Depends(get_optional_profile),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> BookingOut:
    """Crea un turno.

    Tres flujos posibles:
    - **Invitado sin sesión**: solo puede cargar `guest_name`/`guest_phone`.
      No puede pasar `client_id` (evita adjudicarle el turno a otra persona).
    - **Cliente logueado**: el `client_id` lo pone el backend a partir del
      token, ignorando lo que venga en el body. Solo puede reservar en el
      salón al que pertenece su perfil.
    - **Staff/owner**: puede cargar un turno para un cliente registrado o un
      invitado, solo dentro de su propio salón.

    Devuelve 409 si el horario fue tomado (incluso por una carrera de
    milisegundos), 422 si el horario es inválido para las reglas del salón.

    Si el cliente manda el header `Idempotency-Key`, un reintento con la
    misma key devuelve el turno ya creado en vez de duplicarlo — pensado
    para el botón "Confirmar reserva" del frontend, que puede reintentar
    solo ante un timeout de red.
    """
    if profile is None:
        if payload.client_id is not None:
            raise PermissionDenied(
                "Iniciá sesión para reservar como cliente registrado"
            )
        # El WhatsApp es obligatorio solo acá (invitado self-service): es el
        # único canal de contacto que tiene el salón para confirmar el turno
        # sin cuenta. Staff/owner cargando un turno a mano (más abajo) puede
        # omitirlo, ej. un walk-in que no lo quiso dar.
        if not (payload.guest_phone and payload.guest_phone.strip()):
            raise ResourceNotFound(
                "Se requiere un número de WhatsApp para reservar como invitado"
            )
        client_id, guest_name, guest_phone, guest_email, created_by = (
            None,
            payload.guest_name,
            payload.guest_phone,
            payload.guest_email,
            None,
        )
    elif profile.role is UserRole.client:
        if payload.salon_id != profile.salon_id:
            raise PermissionDenied("Este salón no corresponde a tu perfil")
        # El cliente registrado ya tiene su email en el profile: no hace
        # falta pedirlo ni guardarlo de nuevo en el turno.
        client_id, guest_name, guest_phone, guest_email, created_by = (
            profile.id,
            None,
            None,
            None,
            profile.id,
        )
    else:  # owner / staff cargando el turno
        if payload.salon_id != profile.salon_id:
            raise PermissionDenied("No podés cargar turnos para otro salón")
        client_id, guest_name, guest_phone, guest_email, created_by = (
            payload.client_id,
            payload.guest_name,
            payload.guest_phone,
            payload.guest_email,
            profile.id,
        )

    appointment = await bookings.create_booking_idempotent(
        session,
        BookingRequest(
            salon_id=payload.salon_id,
            service_id=payload.service_id,
            start_time=payload.start_time,
            staff_id=payload.staff_id,
            client_id=client_id,
            guest_name=guest_name,
            guest_phone=guest_phone,
            guest_email=guest_email,
            notes=payload.notes,
            created_by=created_by,
            payment_method=payload.payment_method,
        ),
        idempotency_key=idempotency_key,
    )
    return BookingOut.model_validate(appointment)


@router.get("/bookings", response_model=list[BookingOut])
async def list_bookings(
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
    staff_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    status_in: list[AppointmentStatus] | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> list[BookingOut]:
    """Lista turnos. El alcance lo decide el perfil, no la query string.

    Un cliente jamás puede pedir los turnos de otro: `client_id` se ignora y
    se fuerza a su propio id. `salon_id` nunca viene del caller: siempre es
    el del perfil autenticado, así que no hay forma de leer otro salón
    cambiando un parámetro.
    """
    effective_client_id = profile.id if profile.role is UserRole.client else client_id

    rows = await bookings.list_bookings(
        session,
        salon_id=profile.salon_id,
        date_from=date_from,
        date_to=date_to,
        staff_id=staff_id,
        client_id=effective_client_id,
        statuses=status_in,
        limit=limit,
    )
    return [BookingOut.model_validate(r) for r in rows]


@router.get("/bookings/{appointment_id}", response_model=BookingOut)
async def get_booking(
    appointment_id: uuid.UUID,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> BookingOut:
    appointment = await bookings.get_booking(session, appointment_id)
    _authorize_access(profile, appointment)
    return BookingOut.model_validate(appointment)


@router.post("/bookings/{appointment_id}/cancel", response_model=BookingOut)
async def cancel_booking(
    appointment_id: uuid.UUID,
    payload: BookingCancel,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> BookingOut:
    appointment = await bookings.get_booking(session, appointment_id)
    _authorize_mutation(profile, appointment)
    updated = await bookings.cancel_booking(
        session, appointment_id, reason=payload.reason
    )
    return BookingOut.model_validate(updated)


@router.patch("/bookings/{appointment_id}/status", response_model=BookingOut)
async def update_status(
    appointment_id: uuid.UUID,
    payload: BookingStatusUpdate,
    profile: Profile = Depends(require_roles(*_STAFF_ROLES)),
    session: AsyncSession = Depends(get_session),
) -> BookingOut:
    """Confirmar / completar / marcar ausente. Reservado al salón (no al cliente)."""
    appointment = await bookings.get_booking(session, appointment_id)
    _authorize_mutation(profile, appointment)
    updated = await bookings.transition_status(
        session, appointment_id, payload.status, reason=payload.reason
    )
    return BookingOut.model_validate(updated)


@router.patch("/bookings/{appointment_id}/payment-status", response_model=BookingOut)
async def update_payment_status(
    appointment_id: uuid.UUID,
    payload: PaymentStatusUpdate,
    profile: Profile = Depends(require_roles(*_STAFF_ROLES)),
    session: AsyncSession = Depends(get_session),
) -> BookingOut:
    """Fijar a mano el estado de la seña (transferencia) de un turno —
    marcarla recibida, o deshacerlo si fue un error. Reservado al salón: no
    hay forma automática de saberlo, alguien lo tiene que chequear contra el
    resumen bancario."""
    appointment = await bookings.get_booking(session, appointment_id)
    _authorize_mutation(profile, appointment)
    updated = await bookings.set_payment_status(
        session, appointment_id, payload.payment_status
    )
    return BookingOut.model_validate(updated)


@router.post("/bookings/{appointment_id}/reschedule", response_model=BookingOut)
async def reschedule_booking(
    appointment_id: uuid.UUID,
    payload: BookingReschedule,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> BookingOut:
    appointment = await bookings.get_booking(session, appointment_id)
    _authorize_mutation(profile, appointment)
    updated = await bookings.reschedule_booking(
        session,
        appointment_id,
        new_start=payload.start_time,
        new_staff_id=payload.staff_id,
    )
    return BookingOut.model_validate(updated)

"""Motor de disponibilidad.

Responde "¿qué horarios puedo ofrecer?" y "¿este horario puntual es válido?".

Diseño deliberado: este módulo **no** garantiza la ausencia de double-booking.
Todo lo que calcula acá es una foto que puede quedar obsoleta entre el GET de
slots y el POST de la reserva. La garantía real la da el EXCLUDE constraint de
Postgres (`appointments_no_double_booking`); ver `app/services/bookings.py`.

Su trabajo es el opuesto: mostrar solo horarios plausibles y dar mensajes de
error entendibles antes de llegar a la base.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    InvalidBookingWindow,
    OutsideWorkingHours,
    ResourceNotFound,
    StaffCannotPerformService,
)
from app.db.models import (
    ACTIVE_STATUSES,
    Appointment,
    GoogleCalendarBlock,
    Profile,
    Salon,
    SalonClosure,
    Service,
    StaffScheduleDate,
    StaffService,
    TimeOff,
)


@dataclass(frozen=True)
class Interval:
    """Intervalo semiabierto [start, end) en UTC."""

    start: dt.datetime
    end: dt.datetime

    def overlaps(self, other: "Interval") -> bool:
        return self.start < other.end and other.start < self.end

    def contains(self, other: "Interval") -> bool:
        return self.start <= other.start and other.end <= self.end


class SlotTakenLocally(Exception):
    """Uso interno: solapamiento detectado antes del INSERT.

    `bookings.py` lo traduce a `SlotUnavailable` con el mismo mensaje que usa
    para la violación del constraint, de modo que el cliente vea una única
    respuesta consistente gane quien gane la carrera.
    """

    def __init__(self, interval: Interval, staff_id: uuid.UUID):
        super().__init__("slot ocupado")
        self.interval = interval
        self.staff_id = staff_id


@dataclass
class Slot:
    """Un horario ofrecible, con los profesionales que pueden tomarlo."""

    start: dt.datetime
    end: dt.datetime
    staff_ids: list[uuid.UUID] = field(default_factory=list)


async def load_salon(session: AsyncSession, salon_id: uuid.UUID) -> Salon:
    salon = await session.get(Salon, salon_id)
    if salon is None or not salon.is_active:
        raise ResourceNotFound("Salón inexistente o inactivo", salon_id=str(salon_id))
    return salon


async def load_service(
    session: AsyncSession, salon_id: uuid.UUID, service_id: uuid.UUID
) -> Service:
    service = await session.get(Service, service_id)
    if service is None or service.salon_id != salon_id or not service.is_active:
        raise ResourceNotFound(
            "Servicio inexistente o inactivo", service_id=str(service_id)
        )
    return service


async def eligible_staff_ids(
    session: AsyncSession,
    service_id: uuid.UUID,
    only_staff_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Profesionales activos habilitados para prestar el servicio."""
    stmt = (
        select(StaffService.staff_id)
        .join(Profile, Profile.id == StaffService.staff_id)
        .where(StaffService.service_id == service_id, Profile.is_active.is_(True))
    )
    if only_staff_id is not None:
        stmt = stmt.where(StaffService.staff_id == only_staff_id)

    ids = list((await session.scalars(stmt)).all())
    if only_staff_id is not None and not ids:
        raise StaffCannotPerformService(
            "El profesional seleccionado no presta este servicio",
            staff_id=str(only_staff_id),
            service_id=str(service_id),
        )
    return ids


async def _working_windows(
    session: AsyncSession,
    staff_ids: list[uuid.UUID],
    day: dt.date,
    tz: ZoneInfo,
) -> dict[uuid.UUID, list[Interval]]:
    """Bloques laborales de cada profesional para `day`, convertidos a UTC.

    Los horarios se guardan como `time` local, así que se anclan al día concreto
    en la zona del salón. Esto hace que el horario "09:00–18:00" siga siendo
    09:00–18:00 locales aunque haya cambio de huso horario en el medio.
    """
    if not staff_ids:
        return {}

    rows = await session.scalars(
        select(StaffScheduleDate).where(
            StaffScheduleDate.staff_id.in_(staff_ids),
            StaffScheduleDate.date == day,
        )
    )

    windows: dict[uuid.UUID, list[Interval]] = {}
    for sched in rows:
        start_local = dt.datetime.combine(day, sched.start_time, tzinfo=tz)
        end_local = dt.datetime.combine(day, sched.end_time, tzinfo=tz)
        windows.setdefault(sched.staff_id, []).append(
            Interval(start_local.astimezone(dt.UTC), end_local.astimezone(dt.UTC))
        )

    for intervals in windows.values():
        intervals.sort(key=lambda i: i.start)
    return windows


async def busy_intervals(
    session: AsyncSession,
    staff_ids: list[uuid.UUID],
    window: Interval,
    salon_id: uuid.UUID,
    exclude_appointment_id: uuid.UUID | None = None,
) -> dict[uuid.UUID, list[Interval]]:
    """Turnos activos + ausencias + cierres de agenda del salón que pisan
    `window`, por profesional."""
    busy: dict[uuid.UUID, list[Interval]] = {sid: [] for sid in staff_ids}
    if not staff_ids:
        return busy

    appt_stmt = select(Appointment).where(
        Appointment.staff_id.in_(staff_ids),
        Appointment.status.in_(ACTIVE_STATUSES),
        Appointment.start_time < window.end,
        Appointment.end_time > window.start,
    )
    if exclude_appointment_id is not None:
        # Al reprogramar, el propio turno no debe bloquearse a sí mismo.
        appt_stmt = appt_stmt.where(Appointment.id != exclude_appointment_id)

    for appt in await session.scalars(appt_stmt):
        busy[appt.staff_id].append(Interval(appt.start_time, appt.end_time))

    off_stmt = select(TimeOff).where(
        TimeOff.staff_id.in_(staff_ids),
        TimeOff.starts_at < window.end,
        TimeOff.ends_at > window.start,
    )
    for off in await session.scalars(off_stmt):
        busy[off.staff_id].append(Interval(off.starts_at, off.ends_at))

    # Cierre de agenda del salón entero (feriado, vacaciones): bloquea a
    # todos los profesionales por igual, no hace falta cargarlo por staff.
    closure_stmt = select(SalonClosure).where(
        SalonClosure.salon_id == salon_id,
        SalonClosure.starts_at < window.end,
        SalonClosure.ends_at > window.start,
    )
    closures = [
        Interval(c.starts_at, c.ends_at) for c in await session.scalars(closure_stmt)
    ]
    for sid in staff_ids:
        busy[sid].extend(closures)

    # Bloqueos traídos de Google Calendar (sync on-demand, ver
    # app/services/google_calendar.py): staff_id NULL bloquea a todos los
    # profesionales por igual (como SalonClosure); con valor bloquea solo a
    # ese profesional.
    google_block_stmt = select(GoogleCalendarBlock).where(
        GoogleCalendarBlock.salon_id == salon_id,
        GoogleCalendarBlock.starts_at < window.end,
        GoogleCalendarBlock.ends_at > window.start,
    )
    for block in await session.scalars(google_block_stmt):
        interval = Interval(block.starts_at, block.ends_at)
        if block.staff_id is None:
            for sid in staff_ids:
                busy[sid].append(interval)
        elif block.staff_id in busy:
            busy[block.staff_id].append(interval)

    for intervals in busy.values():
        intervals.sort(key=lambda i: i.start)
    return busy


def _bookable_range(salon: Salon, now: dt.datetime) -> Interval:
    """Ventana temporal en la que el salón acepta reservas."""
    return Interval(
        start=now + dt.timedelta(minutes=salon.min_lead_minutes),
        end=now + dt.timedelta(days=salon.max_advance_days),
    )


async def get_available_slots(
    session: AsyncSession,
    salon_id: uuid.UUID,
    service_id: uuid.UUID,
    day: dt.date,
    staff_id: uuid.UUID | None = None,
    now: dt.datetime | None = None,
) -> list[Slot]:
    """Grilla de horarios libres para un servicio en un día dado.

    Un slot entra en la respuesta si, para al menos un profesional habilitado:
      - cae completo dentro de un bloque laboral,
      - no pisa turnos activos ni ausencias,
      - respeta la ventana de reserva del salón (lead time / anticipación máxima).
    """
    now = now or dt.datetime.now(dt.UTC)
    salon = await load_salon(session, salon_id)
    service = await load_service(session, salon_id, service_id)
    tz = ZoneInfo(salon.timezone)

    staff_ids = await eligible_staff_ids(session, service_id, staff_id)
    if not staff_ids:
        return []

    windows = await _working_windows(session, staff_ids, day, tz)
    if not windows:
        return []

    # Rango de consulta: el día local completo, con margen para turnos que
    # arrancan el día anterior y se estiran hasta la madrugada.
    day_start = dt.datetime.combine(day, dt.time.min, tzinfo=tz).astimezone(dt.UTC)
    day_end = day_start + dt.timedelta(days=1)
    query_window = Interval(day_start - dt.timedelta(hours=12), day_end)

    busy = await busy_intervals(session, staff_ids, query_window, salon.id)
    bookable = _bookable_range(salon, now)

    duration = dt.timedelta(minutes=service.occupied_minutes)
    step = dt.timedelta(minutes=salon.slot_step_minutes)

    # Clave = instante de inicio, para agrupar profesionales que comparten slot.
    by_start: dict[dt.datetime, Slot] = {}

    for sid in staff_ids:
        for window in windows.get(sid, []):
            cursor = window.start
            while cursor + duration <= window.end:
                candidate = Interval(cursor, cursor + duration)
                cursor += step

                if not bookable.contains(candidate):
                    continue
                if any(candidate.overlaps(b) for b in busy[sid]):
                    continue

                slot = by_start.get(candidate.start)
                if slot is None:
                    slot = Slot(start=candidate.start, end=candidate.end)
                    by_start[candidate.start] = slot
                slot.staff_ids.append(sid)

    return [by_start[k] for k in sorted(by_start)]


async def assert_slot_bookable(
    session: AsyncSession,
    salon: Salon,
    service: Service,
    staff_id: uuid.UUID,
    start: dt.datetime,
    now: dt.datetime | None = None,
    exclude_appointment_id: uuid.UUID | None = None,
) -> Interval:
    """Valida un horario puntual y devuelve el intervalo que ocupará.

    Chequea reglas que la base no modela (horario laboral, lead time). El
    solapamiento se revalida acá solo para poder devolver un 409 con mensaje
    útil; la garantía dura la sigue dando el constraint al hacer INSERT.
    """
    now = now or dt.datetime.now(dt.UTC)
    tz = ZoneInfo(salon.timezone)

    if start.tzinfo is None:
        raise InvalidBookingWindow("start_time debe incluir zona horaria")
    start = start.astimezone(dt.UTC)

    candidate = Interval(start, start + dt.timedelta(minutes=service.occupied_minutes))

    bookable = _bookable_range(salon, now)
    if candidate.start < bookable.start:
        raise InvalidBookingWindow(
            f"Se debe reservar con al menos {salon.min_lead_minutes} minutos "
            "de anticipación",
            min_lead_minutes=salon.min_lead_minutes,
        )
    if candidate.end > bookable.end:
        raise InvalidBookingWindow(
            f"No se pueden reservar turnos con más de {salon.max_advance_days} "
            "días de anticipación",
            max_advance_days=salon.max_advance_days,
        )

    # El turno puede cruzar medianoche local: se valida contra los bloques
    # laborales del día local de inicio y del siguiente.
    local_day = candidate.start.astimezone(tz).date()
    windows: list[Interval] = []
    for offset in (0, 1):
        day_windows = await _working_windows(
            session, [staff_id], local_day + dt.timedelta(days=offset), tz
        )
        windows.extend(day_windows.get(staff_id, []))

    if not any(w.contains(candidate) for w in windows):
        raise OutsideWorkingHours(
            "El horario solicitado cae fuera del horario laboral del profesional",
            staff_id=str(staff_id),
            start_time=candidate.start.isoformat(),
        )

    busy = await busy_intervals(
        session,
        [staff_id],
        candidate,
        salon.id,
        exclude_appointment_id=exclude_appointment_id,
    )
    if any(candidate.overlaps(b) for b in busy[staff_id]):
        raise SlotTakenLocally(candidate, staff_id)

    return candidate

"""Gestión del catálogo del salón: servicios, staff, horarios y ausencias.

Todo acá se filtra por `salon_id` explícito en cada consulta (nunca "traé por
id y confiá") para que un id adivinado o filtrado de otro salón nunca sea
alcanzable, ni por accidente.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ResourceNotFound, UpstreamError
from app.db.models import (
    Appointment,
    Profile,
    SalonClosure,
    Service,
    ServiceCategory,
    StaffScheduleDate,
    StaffService,
    TimeOff,
    UserRole,
)
from app.schemas.admin import (
    CategoryCreate,
    CategoryUpdate,
    ScheduleBlockIn,
    ServiceCreate,
    ServiceUpdate,
    StaffInviteCreate,
)
from app.services import supabase_admin

_STAFF_ROLES = (UserRole.owner, UserRole.staff)


# --- Categorías de servicios ---------------------------------------------


async def list_categories(
    session: AsyncSession, salon_id: uuid.UUID
) -> list[ServiceCategory]:
    stmt = (
        select(ServiceCategory)
        .where(ServiceCategory.salon_id == salon_id)
        .order_by(ServiceCategory.sort_order, ServiceCategory.name)
    )
    return list((await session.scalars(stmt)).all())


async def _load_category(
    session: AsyncSession, salon_id: uuid.UUID, category_id: uuid.UUID
) -> ServiceCategory:
    category = await session.get(ServiceCategory, category_id)
    if category is None or category.salon_id != salon_id:
        raise ResourceNotFound("Categoría inexistente", category_id=str(category_id))
    return category


async def create_category(
    session: AsyncSession, salon_id: uuid.UUID, data: CategoryCreate
) -> ServiceCategory:
    category = ServiceCategory(salon_id=salon_id, **data.model_dump())
    session.add(category)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "service_categories_salon_name_key" in str(getattr(exc, "orig", exc)):
            raise ConflictError(
                f"Ya existe una categoría llamada '{data.name}' en este salón"
            ) from exc
        raise
    await session.refresh(category)
    return category


async def update_category(
    session: AsyncSession,
    salon_id: uuid.UUID,
    category_id: uuid.UUID,
    data: CategoryUpdate,
) -> ServiceCategory:
    category = await _load_category(session, salon_id, category_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(category, field, value)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "service_categories_salon_name_key" in str(getattr(exc, "orig", exc)):
            raise ConflictError("Ya existe una categoría con ese nombre") from exc
        raise
    await session.refresh(category)
    return category


async def delete_category(
    session: AsyncSession, salon_id: uuid.UUID, category_id: uuid.UUID
) -> None:
    """Borrado real: los servicios que la usaban quedan sin categoría
    (`services.category_id` es `ON DELETE SET NULL`), no hay historial que
    proteger como con servicios/staff."""
    category = await _load_category(session, salon_id, category_id)
    await session.delete(category)
    await session.commit()


# --- Services ----------------------------------------------------------------


async def _category_names(
    session: AsyncSession, salon_id: uuid.UUID
) -> dict[uuid.UUID, str]:
    rows = await session.execute(
        select(ServiceCategory.id, ServiceCategory.name).where(
            ServiceCategory.salon_id == salon_id
        )
    )
    return dict(rows.all())


async def _attach_category_names(
    session: AsyncSession, salon_id: uuid.UUID, services: list[Service]
) -> list[Service]:
    """`ServiceOut.category_name` no es una columna real: se resuelve acá con
    un solo query extra y se cuelga como atributo transitorio antes de
    serializar (evita un join por cada listado de servicios)."""
    if not services:
        return services
    names = await _category_names(session, salon_id)
    for service in services:
        service.category_name = names.get(service.category_id)  # type: ignore[attr-defined]
    return services


async def list_services(
    session: AsyncSession, salon_id: uuid.UUID, include_inactive: bool = False
) -> list[Service]:
    stmt = select(Service).where(Service.salon_id == salon_id)
    if not include_inactive:
        stmt = stmt.where(Service.is_active.is_(True))
    stmt = stmt.order_by(Service.name)
    services = list((await session.scalars(stmt)).all())
    return await _attach_category_names(session, salon_id, services)


async def _load_service(
    session: AsyncSession, salon_id: uuid.UUID, service_id: uuid.UUID
) -> Service:
    service = await session.get(Service, service_id)
    if service is None or service.salon_id != salon_id:
        raise ResourceNotFound("Servicio inexistente", service_id=str(service_id))
    return service


async def _validate_category(
    session: AsyncSession, salon_id: uuid.UUID, category_id: uuid.UUID | None
) -> None:
    if category_id is None:
        return
    await _load_category(session, salon_id, category_id)


async def create_service(
    session: AsyncSession, salon_id: uuid.UUID, data: ServiceCreate
) -> Service:
    await _validate_category(session, salon_id, data.category_id)
    service = Service(salon_id=salon_id, **data.model_dump())
    session.add(service)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "services_salon_name_key" in str(getattr(exc, "orig", exc)):
            raise ConflictError(
                f"Ya existe un servicio llamado '{data.name}' en este salón"
            ) from exc
        raise
    await session.refresh(service)
    await _attach_category_names(session, salon_id, [service])
    return service


async def update_service(
    session: AsyncSession,
    salon_id: uuid.UUID,
    service_id: uuid.UUID,
    data: ServiceUpdate,
) -> Service:
    service = await _load_service(session, salon_id, service_id)
    updates = data.model_dump(exclude_unset=True)
    if "category_id" in updates:
        await _validate_category(session, salon_id, updates["category_id"])
    for field, value in updates.items():
        setattr(service, field, value)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "services_salon_name_key" in str(getattr(exc, "orig", exc)):
            raise ConflictError("Ya existe un servicio con ese nombre") from exc
        raise
    await session.refresh(service)
    await _attach_category_names(session, salon_id, [service])
    return service


async def deactivate_service(
    session: AsyncSession, salon_id: uuid.UUID, service_id: uuid.UUID
) -> Service:
    """Baja lógica: los turnos históricos referencian el servicio con
    `ON DELETE RESTRICT`, así que un DELETE físico fallaría en cuanto exista
    al menos un turno. Desactivar es la operación real de "borrar" acá.
    """
    service = await _load_service(session, salon_id, service_id)
    service.is_active = False
    await session.commit()
    await session.refresh(service)
    await _attach_category_names(session, salon_id, [service])
    return service


async def delete_service_permanently(
    session: AsyncSession, salon_id: uuid.UUID, service_id: uuid.UUID
) -> None:
    """Borrado real. Solo posible si el servicio nunca tuvo turnos (la FK de
    `appointments` es `ON DELETE RESTRICT`); si tiene historial, se pide
    desactivarlo en su lugar en vez de dejar que el INSERT/DELETE explote."""
    service = await _load_service(session, salon_id, service_id)

    has_bookings = (
        await session.scalar(
            select(Appointment.id).where(Appointment.service_id == service_id).limit(1)
        )
    ) is not None
    if has_bookings:
        raise ConflictError(
            "Este servicio ya tiene turnos asociados: no se puede eliminar. "
            "Desactivalo en su lugar."
        )

    await session.delete(service)
    await session.commit()


# --- Staff ---------------------------------------------------------------

#: Paleta de colores para diferenciar profesionales en el calendario admin.
#: Debe coincidir con la paleta de backfill en la migración
#: 20260827100000_google_calendar_and_staff_color.sql — viven duplicadas a
#: propósito (SQL vs. Python no comparten código), pero conceptualmente hay
#: una sola paleta.
_STAFF_COLOR_PALETTE = [
    "#F2B8C6", "#B8C6F2", "#C6F2B8", "#F2E1B8",
    "#B8F2E1", "#E1B8F2", "#F2B8E1", "#C6B8F2",
]


async def _next_staff_color(session: AsyncSession, salon_id: uuid.UUID) -> str:
    """Rota la paleta según la cantidad de staff ya existente en el salón."""
    count = await session.scalar(
        select(func.count()).select_from(Profile).where(
            Profile.salon_id == salon_id, Profile.role.in_(_STAFF_ROLES)
        )
    )
    return _STAFF_COLOR_PALETTE[(count or 0) % len(_STAFF_COLOR_PALETTE)]


async def invite_staff(
    session: AsyncSession, salon_id: uuid.UUID, data: StaffInviteCreate
) -> Profile:
    """Crea el usuario en Supabase Auth (manda mail de invitación) y le
    asigna el rol real. El trigger de alta siempre crea el profile con
    `role = 'client'` (ver la migración que endurece `handle_new_user`); acá
    lo corregimos con un UPDATE de confianza hecho por el backend, que no
    pasa por RLS.
    """
    user = await supabase_admin.invite_user(data.email, data.full_name, salon_id)
    try:
        profile_id = uuid.UUID(user["id"])
    except (KeyError, ValueError, TypeError) as exc:
        raise UpstreamError(
            "La respuesta del servicio de autenticación no trae un id válido"
        ) from exc

    profile = await session.get(Profile, profile_id)
    if profile is None or profile.salon_id != salon_id:
        raise UpstreamError(
            "El usuario se creó pero el profile no apareció en este salón",
            profile_id=str(profile_id),
        )

    profile.role = UserRole(data.role)
    profile.color = await _next_staff_color(session, salon_id)
    await session.commit()
    await session.refresh(profile)
    return profile


async def list_staff(session: AsyncSession, salon_id: uuid.UUID) -> list[Profile]:
    stmt = (
        select(Profile)
        .where(Profile.salon_id == salon_id, Profile.role.in_(_STAFF_ROLES))
        .order_by(Profile.full_name)
    )
    return list((await session.scalars(stmt)).all())


async def load_staff_profile(
    session: AsyncSession, salon_id: uuid.UUID, staff_id: uuid.UUID
) -> Profile:
    profile = await session.get(Profile, staff_id)
    if (
        profile is None
        or profile.salon_id != salon_id
        or profile.role not in _STAFF_ROLES
    ):
        raise ResourceNotFound(
            "Profesional inexistente en este salón", staff_id=str(staff_id)
        )
    return profile


async def list_public_staff_for_service(
    session: AsyncSession, salon_id: uuid.UUID, service_id: uuid.UUID
) -> list[Profile]:
    """Staff activo habilitado para un servicio, para mostrar en la UI de
    reservas ("con Fulana"). Público: no expone email/phone/role."""
    stmt = (
        select(Profile)
        .join(StaffService, StaffService.staff_id == Profile.id)
        .where(
            StaffService.service_id == service_id,
            Profile.salon_id == salon_id,
            Profile.is_active.is_(True),
        )
        .order_by(Profile.full_name)
    )
    return list((await session.scalars(stmt)).all())


async def set_staff_active(
    session: AsyncSession, salon_id: uuid.UUID, staff_id: uuid.UUID, is_active: bool
) -> Profile:
    profile = await load_staff_profile(session, salon_id, staff_id)
    profile.is_active = is_active
    await session.commit()
    await session.refresh(profile)
    return profile


async def set_staff_color(
    session: AsyncSession, salon_id: uuid.UUID, staff_id: uuid.UUID, color: str
) -> Profile:
    profile = await load_staff_profile(session, salon_id, staff_id)
    profile.color = color
    await session.commit()
    await session.refresh(profile)
    return profile


async def delete_staff_permanently(
    session: AsyncSession, salon_id: uuid.UUID, staff_id: uuid.UUID
) -> None:
    """Borrado real. Solo posible si el profesional nunca tuvo turnos (la FK
    de `appointments` es `ON DELETE RESTRICT`); si tiene historial, se pide
    desactivarlo en su lugar.

    Se borra desde la Admin API de Supabase Auth (no con un DELETE directo a
    `profiles`): borrar ahí cascadea al profile, staff_services, horarios y
    ausencias, y además elimina la cuenta de auth.users para que no quede un
    login fantasma sin profile.
    """
    profile = await load_staff_profile(session, salon_id, staff_id)

    has_bookings = (
        await session.scalar(
            select(Appointment.id).where(Appointment.staff_id == staff_id).limit(1)
        )
    ) is not None
    if has_bookings:
        raise ConflictError(
            "Este profesional ya tiene turnos asociados: no se puede eliminar. "
            "Desactivalo en su lugar."
        )

    await supabase_admin.delete_user(profile.id)
    session.expire(profile)


async def get_staff_services(
    session: AsyncSession, salon_id: uuid.UUID, staff_id: uuid.UUID
) -> list[uuid.UUID]:
    """Servicios asignados a un profesional, para precargar el checklist en
    el admin. A diferencia de `list_public_staff_for_service` no depende de
    que el servicio esté activo — si no, una asignación a un servicio dado
    de baja desaparecería del checklist sin haberse desasignado."""
    await load_staff_profile(session, salon_id, staff_id)
    rows = await session.scalars(
        select(StaffService.service_id).where(StaffService.staff_id == staff_id)
    )
    return list(rows)


async def set_staff_services(
    session: AsyncSession,
    salon_id: uuid.UUID,
    staff_id: uuid.UUID,
    service_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    await load_staff_profile(session, salon_id, staff_id)

    unique_ids = list(dict.fromkeys(service_ids))  # preserva orden, sin duplicados
    if unique_ids:
        owned = set(
            await session.scalars(
                select(Service.id).where(
                    Service.id.in_(unique_ids), Service.salon_id == salon_id
                )
            )
        )
        missing = set(unique_ids) - owned
        if missing:
            raise ResourceNotFound(
                "Alguno de los servicios no pertenece a este salón",
                service_ids=[str(i) for i in missing],
            )

    await session.execute(
        delete(StaffService).where(StaffService.staff_id == staff_id)
    )
    for service_id in unique_ids:
        session.add(
            StaffService(salon_id=salon_id, staff_id=staff_id, service_id=service_id)
        )
    await session.commit()
    return unique_ids


# --- Horarios laborales --------------------------------------------------
# Por fecha puntual del calendario (no recurrente), ver StaffScheduleDate.


async def get_staff_schedule(
    session: AsyncSession,
    salon_id: uuid.UUID,
    staff_id: uuid.UUID,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
) -> list[StaffScheduleDate]:
    await load_staff_profile(session, salon_id, staff_id)
    stmt = select(StaffScheduleDate).where(StaffScheduleDate.staff_id == staff_id)
    if date_from is not None:
        stmt = stmt.where(StaffScheduleDate.date >= date_from)
    if date_to is not None:
        stmt = stmt.where(StaffScheduleDate.date <= date_to)
    stmt = stmt.order_by(StaffScheduleDate.date, StaffScheduleDate.start_time)
    return list((await session.scalars(stmt)).all())


async def replace_staff_schedule_date(
    session: AsyncSession,
    salon_id: uuid.UUID,
    staff_id: uuid.UUID,
    date: dt.date,
    blocks: list[ScheduleBlockIn],
) -> list[StaffScheduleDate]:
    """Reemplaza todos los bloques de una fecha puntual de una vez: borra los
    bloques actuales de ese día e inserta los nuevos en la misma transacción.
    """
    await load_staff_profile(session, salon_id, staff_id)

    await session.execute(
        delete(StaffScheduleDate).where(
            StaffScheduleDate.staff_id == staff_id, StaffScheduleDate.date == date
        )
    )
    rows = [
        StaffScheduleDate(
            salon_id=salon_id,
            staff_id=staff_id,
            date=date,
            start_time=b.start_time,
            end_time=b.end_time,
        )
        for b in blocks
    ]
    session.add_all(rows)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "staff_schedule_dates_no_overlap" in str(getattr(exc, "orig", exc)):
            raise ConflictError(
                "Hay bloques de horario que se superponen ese día"
            ) from exc
        raise

    return await get_staff_schedule(session, salon_id, staff_id, date_from=date, date_to=date)


# --- Ausencias -------------------------------------------------------------


async def list_time_off(
    session: AsyncSession,
    salon_id: uuid.UUID,
    staff_id: uuid.UUID,
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
) -> list[TimeOff]:
    await load_staff_profile(session, salon_id, staff_id)
    stmt = select(TimeOff).where(TimeOff.staff_id == staff_id)
    if date_from is not None:
        stmt = stmt.where(TimeOff.ends_at > date_from)
    if date_to is not None:
        stmt = stmt.where(TimeOff.starts_at < date_to)
    stmt = stmt.order_by(TimeOff.starts_at)
    return list((await session.scalars(stmt)).all())


async def create_time_off(
    session: AsyncSession,
    salon_id: uuid.UUID,
    staff_id: uuid.UUID,
    starts_at: dt.datetime,
    ends_at: dt.datetime,
    reason: str | None,
) -> TimeOff:
    await load_staff_profile(session, salon_id, staff_id)

    time_off = TimeOff(
        salon_id=salon_id,
        staff_id=staff_id,
        starts_at=starts_at,
        ends_at=ends_at,
        reason=reason,
    )
    session.add(time_off)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "time_off_no_overlap" in str(getattr(exc, "orig", exc)):
            raise ConflictError(
                "Ya existe una ausencia cargada que se superpone con este rango"
            ) from exc
        raise
    await session.refresh(time_off)
    return time_off


async def delete_time_off(
    session: AsyncSession, salon_id: uuid.UUID, time_off_id: uuid.UUID
) -> None:
    time_off = await session.get(TimeOff, time_off_id)
    if time_off is None or time_off.salon_id != salon_id:
        raise ResourceNotFound(
            "Ausencia inexistente en este salón", time_off_id=str(time_off_id)
        )
    await session.delete(time_off)
    await session.commit()


# --- Bloqueo de agenda (salón entero) -----------------------------------------


async def list_salon_closures(
    session: AsyncSession,
    salon_id: uuid.UUID,
    date_from: dt.datetime | None = None,
    date_to: dt.datetime | None = None,
) -> list[SalonClosure]:
    stmt = select(SalonClosure).where(SalonClosure.salon_id == salon_id)
    if date_from is not None:
        stmt = stmt.where(SalonClosure.ends_at > date_from)
    if date_to is not None:
        stmt = stmt.where(SalonClosure.starts_at < date_to)
    stmt = stmt.order_by(SalonClosure.starts_at)
    return list((await session.scalars(stmt)).all())


async def create_salon_closure(
    session: AsyncSession,
    salon_id: uuid.UUID,
    starts_at: dt.datetime,
    ends_at: dt.datetime,
    reason: str | None,
) -> SalonClosure:
    closure = SalonClosure(
        salon_id=salon_id, starts_at=starts_at, ends_at=ends_at, reason=reason
    )
    session.add(closure)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if "salon_closures_no_overlap" in str(getattr(exc, "orig", exc)):
            raise ConflictError(
                "Ya existe un cierre de agenda que se superpone con este rango"
            ) from exc
        raise
    await session.refresh(closure)
    return closure


async def delete_salon_closure(
    session: AsyncSession, salon_id: uuid.UUID, closure_id: uuid.UUID
) -> None:
    closure = await session.get(SalonClosure, closure_id)
    if closure is None or closure.salon_id != salon_id:
        raise ResourceNotFound(
            "Cierre de agenda inexistente en este salón", closure_id=str(closure_id)
        )
    await session.delete(closure)
    await session.commit()

"""Tests del motor de disponibilidad.

Se aíslan las consultas a la base (se stubbean los loaders) para ejercitar lo
que realmente tiene lógica: el recorrido de la grilla, el recorte contra
horarios laborales, ocupaciones y la ventana de reserva del salón.
"""

import datetime as dt
import uuid
from types import SimpleNamespace

import pytest

from app.core.errors import InvalidBookingWindow, OutsideWorkingHours
from app.services import availability
from app.services.availability import Interval, SlotTakenLocally

TZ = "America/Argentina/Buenos_Aires"
UTC = dt.UTC

SALON_ID = uuid.uuid4()
SERVICE_ID = uuid.uuid4()
STAFF_A = uuid.uuid4()
STAFF_B = uuid.uuid4()

DAY = dt.date(2026, 9, 1)  # martes


def make_salon(**overrides):
    base = dict(
        id=SALON_ID,
        timezone=TZ,
        is_active=True,
        min_lead_minutes=60,
        max_advance_days=60,
        slot_step_minutes=30,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def make_service(duration=60, buffer=0):
    return SimpleNamespace(
        id=SERVICE_ID,
        salon_id=SALON_ID,
        is_active=True,
        duration_minutes=duration,
        buffer_minutes=buffer,
        occupied_minutes=duration + buffer,
        price=1000,
        currency="ARS",
    )


def local(hour, minute=0, day=DAY):
    """Instante UTC correspondiente a una hora local del salón."""
    from zoneinfo import ZoneInfo

    return dt.datetime.combine(
        day, dt.time(hour, minute), tzinfo=ZoneInfo(TZ)
    ).astimezone(UTC)


@pytest.fixture
def patched(monkeypatch):
    """Instala stubs configurables para los accesos a base."""
    state = {
        "salon": make_salon(),
        "service": make_service(),
        "staff": [STAFF_A],
        "windows": {},
        "busy": {},
    }

    async def load_salon(session, salon_id):
        return state["salon"]

    async def load_service(session, salon_id, service_id):
        return state["service"]

    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        ids = state["staff"]
        if only_staff_id is not None:
            return [i for i in ids if i == only_staff_id]
        return list(ids)

    async def working_windows(session, staff_ids, day, tz):
        return {
            sid: list(state["windows"].get((sid, day), []))
            for sid in staff_ids
            if state["windows"].get((sid, day))
        }

    async def busy_intervals(
        session, staff_ids, window, salon_id, exclude_appointment_id=None
    ):
        return {sid: list(state["busy"].get(sid, [])) for sid in staff_ids}

    monkeypatch.setattr(availability, "load_salon", load_salon)
    monkeypatch.setattr(availability, "load_service", load_service)
    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "_working_windows", working_windows)
    monkeypatch.setattr(availability, "busy_intervals", busy_intervals)
    return state


# --- Interval ----------------------------------------------------------------


def test_intervals_semiabiertos_no_se_solapan_al_tocarse():
    a = Interval(local(9), local(10))
    b = Interval(local(10), local(11))
    assert not a.overlaps(b)
    assert not b.overlaps(a)


def test_overlap_parcial():
    assert Interval(local(9), local(10)).overlaps(Interval(local(9, 30), local(10, 30)))


# --- get_available_slots -----------------------------------------------------


@pytest.mark.asyncio
async def test_grilla_completa_sin_ocupaciones(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]
    now = local(0)  # mucho antes del lead time

    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=now
    )

    # 09:00-12:00, servicio de 60', paso de 30' -> 09:00, 09:30, 10:00, 10:30, 11:00
    assert [s.start for s in slots] == [
        local(9),
        local(9, 30),
        local(10),
        local(10, 30),
        local(11),
    ]
    # El último slot termina justo en el cierre, no lo excede.
    assert slots[-1].end == local(12)


@pytest.mark.asyncio
async def test_turno_existente_bloquea_solo_los_slots_que_pisa(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]
    patched["busy"][STAFF_A] = [Interval(local(10), local(11))]

    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=local(0)
    )

    starts = [s.start for s in slots]
    assert starts == [local(9), local(11)]
    assert local(9, 30) not in starts  # 09:30-10:30 pisa el turno


@pytest.mark.asyncio
async def test_lead_time_descarta_los_slots_demasiado_proximos(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]
    # Son las 09:00 locales y el salón exige 60' de anticipación.
    now = local(9)

    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=now
    )

    assert [s.start for s in slots] == [local(10), local(10, 30), local(11)]


@pytest.mark.asyncio
async def test_slots_compartidos_agrupan_a_los_profesionales(patched):
    patched["staff"] = [STAFF_A, STAFF_B]
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(11))]
    patched["windows"][(STAFF_B, DAY)] = [Interval(local(10), local(12))]

    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=local(0)
    )

    by_start = {s.start: s.staff_ids for s in slots}
    assert by_start[local(9)] == [STAFF_A]
    assert sorted(by_start[local(10)]) == sorted([STAFF_A, STAFF_B])
    assert by_start[local(11)] == [STAFF_B]


@pytest.mark.asyncio
async def test_buffer_del_servicio_ocupa_agenda(patched):
    patched["service"] = make_service(duration=45, buffer=15)
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(10))]

    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=local(0)
    )

    # 45' + 15' de buffer = 60': entra exactamente un slot en la ventana.
    assert len(slots) == 1
    assert slots[0].end == local(10)


@pytest.mark.asyncio
async def test_sin_horario_laboral_no_hay_slots(patched):
    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=local(0)
    )
    assert slots == []


@pytest.mark.asyncio
async def test_bloques_disjuntos_no_generan_slots_en_el_corte(patched):
    # Mañana y tarde con corte de 12 a 16.
    patched["windows"][(STAFF_A, DAY)] = [
        Interval(local(9), local(12)),
        Interval(local(16), local(19)),
    ]

    slots = await availability.get_available_slots(
        None, SALON_ID, SERVICE_ID, DAY, now=local(0)
    )

    starts = [s.start for s in slots]
    assert local(12) not in starts
    assert local(15, 30) not in starts
    assert local(16) in starts


# --- assert_slot_bookable ----------------------------------------------------


@pytest.mark.asyncio
async def test_rechaza_horario_fuera_del_horario_laboral(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]

    with pytest.raises(OutsideWorkingHours):
        await availability.assert_slot_bookable(
            None,
            salon=patched["salon"],
            service=patched["service"],
            staff_id=STAFF_A,
            start=local(13),
            now=local(0),
        )


@pytest.mark.asyncio
async def test_rechaza_turno_que_excede_el_cierre(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]

    # 11:30 + 60' = 12:30, se pasa del cierre.
    with pytest.raises(OutsideWorkingHours):
        await availability.assert_slot_bookable(
            None,
            salon=patched["salon"],
            service=patched["service"],
            staff_id=STAFF_A,
            start=local(11, 30),
            now=local(0),
        )


@pytest.mark.asyncio
async def test_rechaza_reserva_sin_anticipacion_suficiente(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]

    with pytest.raises(InvalidBookingWindow):
        await availability.assert_slot_bookable(
            None,
            salon=patched["salon"],
            service=patched["service"],
            staff_id=STAFF_A,
            start=local(9, 30),
            now=local(9),  # solo 30' de anticipación, se exigen 60'
        )


@pytest.mark.asyncio
async def test_rechaza_reserva_demasiado_lejana(patched):
    far_day = DAY + dt.timedelta(days=400)
    patched["windows"][(STAFF_A, far_day)] = [
        Interval(local(9, day=far_day), local(12, day=far_day))
    ]

    with pytest.raises(InvalidBookingWindow):
        await availability.assert_slot_bookable(
            None,
            salon=patched["salon"],
            service=patched["service"],
            staff_id=STAFF_A,
            start=local(10, day=far_day),
            now=local(0),
        )


@pytest.mark.asyncio
async def test_detecta_solapamiento_antes_del_insert(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]
    patched["busy"][STAFF_A] = [Interval(local(10), local(11))]

    with pytest.raises(SlotTakenLocally):
        await availability.assert_slot_bookable(
            None,
            salon=patched["salon"],
            service=patched["service"],
            staff_id=STAFF_A,
            start=local(10, 30),
            now=local(0),
        )


@pytest.mark.asyncio
async def test_acepta_turno_pegado_a_otro_sin_solapar(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]
    patched["busy"][STAFF_A] = [Interval(local(9), local(10))]

    interval = await availability.assert_slot_bookable(
        None,
        salon=patched["salon"],
        service=patched["service"],
        staff_id=STAFF_A,
        start=local(10),
        now=local(0),
    )
    assert interval.start == local(10)
    assert interval.end == local(11)


@pytest.mark.asyncio
async def test_rechaza_start_time_naive(patched):
    patched["windows"][(STAFF_A, DAY)] = [Interval(local(9), local(12))]

    with pytest.raises(InvalidBookingWindow):
        await availability.assert_slot_bookable(
            None,
            salon=patched["salon"],
            service=patched["service"],
            staff_id=STAFF_A,
            start=dt.datetime(2026, 9, 1, 10, 0),  # sin tzinfo
            now=local(0),
        )


# --- busy_intervals: bloqueos traídos de Google Calendar --------------------
#
# Estos ejercitan `busy_intervals` de verdad (no lo monkeypatchean como el
# resto del archivo vía el fixture `patched`), con una sesión falsa que sirve
# los resultados de `session.scalars` en el mismo orden en que la función los
# pide: turnos, ausencias, cierres de salón, bloqueos de Google.


class _ScalarsSequenceSession:
    def __init__(self, sequence):
        self._sequence = list(sequence)

    async def scalars(self, stmt):
        return self._sequence.pop(0)


@pytest.mark.asyncio
async def test_busy_intervals_bloqueo_de_google_sin_staff_afecta_a_todos():
    block = SimpleNamespace(staff_id=None, starts_at=local(10), ends_at=local(11))
    session = _ScalarsSequenceSession([[], [], [], [block]])
    window = Interval(local(0), local(23, 59))

    busy = await availability.busy_intervals(session, [STAFF_A, STAFF_B], window, SALON_ID)

    expected = Interval(block.starts_at, block.ends_at)
    assert expected in busy[STAFF_A]
    assert expected in busy[STAFF_B]


@pytest.mark.asyncio
async def test_busy_intervals_bloqueo_de_google_con_staff_afecta_solo_a_ese_profesional():
    block = SimpleNamespace(staff_id=STAFF_A, starts_at=local(10), ends_at=local(11))
    session = _ScalarsSequenceSession([[], [], [], [block]])
    window = Interval(local(0), local(23, 59))

    busy = await availability.busy_intervals(session, [STAFF_A, STAFF_B], window, SALON_ID)

    expected = Interval(block.starts_at, block.ends_at)
    assert expected in busy[STAFF_A]
    assert expected not in busy[STAFF_B]

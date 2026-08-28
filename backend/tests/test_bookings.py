"""Tests de la lógica de reservas (app/services/bookings.py).

Se stubbea `availability` (ya cubierto por su propia suite) y
`notifications` (efecto secundario que no debe condicionar el resultado), y
se usa una sesión falsa en memoria en vez de Postgres real. Lo que se
ejercita acá es la orquestación: resolución de profesional, traducción de
IntegrityError a errores de dominio, y la máquina de estados.
"""

import datetime as dt
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.errors import (
    ConflictError,
    InvalidStateTransition,
    ResourceNotFound,
    SlotUnavailable,
    UpstreamError,
)
from app.db.models import AppointmentStatus, IdempotencyKey, PaymentMethod, PaymentStatus, Profile
from app.services import availability, bookings, notifications, payments
from app.services.availability import Interval, OutsideWorkingHours, SlotTakenLocally
from app.services.bookings import BookingRequest

SALON_ID = uuid.uuid4()
SERVICE_ID = uuid.uuid4()
STAFF_A = uuid.uuid4()
STAFF_B = uuid.uuid4()
CLIENT_ID = uuid.uuid4()

START = dt.datetime(2026, 9, 1, 14, 0, tzinfo=dt.UTC)
END = dt.datetime(2026, 9, 1, 15, 0, tzinfo=dt.UTC)
NOW = dt.datetime(2026, 8, 1, 0, 0, tzinfo=dt.UTC)


class FakeSession:
    """Sustituto mínimo de AsyncSession: solo lo que bookings.py usa."""

    def __init__(self):
        self.added = []
        self.commit_calls = 0
        self.rollback_calls = 0
        self.get_map = {}
        self.commit_side_effect: Exception | None = None
        self.executed = []

    async def get(self, model, id_):
        return self.get_map.get((model, id_))

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commit_calls += 1
        if self.commit_side_effect is not None:
            effect, self.commit_side_effect = self.commit_side_effect, None
            raise effect

    async def rollback(self):
        self.rollback_calls += 1

    async def refresh(self, obj):
        pass

    async def delete(self, obj):
        pass

    async def execute(self, stmt):
        self.executed.append(stmt)


def make_salon(**overrides):
    base = dict(id=SALON_ID, is_active=True)
    base.update(overrides)
    return SimpleNamespace(**base)


def make_service(**overrides):
    base = dict(
        id=SERVICE_ID,
        salon_id=SALON_ID,
        name="Manicura",
        occupied_minutes=60,
        price=1000,
        currency="ARS",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def make_profile(**overrides):
    base = dict(id=CLIENT_ID, salon_id=SALON_ID)
    base.update(overrides)
    return SimpleNamespace(**base)


def overlap_error(constraint: str) -> IntegrityError:
    return IntegrityError(
        "INSERT ...",
        {},
        Exception(f'duplicate key value violates unique constraint "{constraint}"'),
    )


@pytest.fixture
def patched(monkeypatch):
    state = {
        "salon": make_salon(),
        "service": make_service(),
        "notified": [],
    }

    async def load_salon(session, salon_id):
        return state["salon"]

    async def load_service(session, salon_id, service_id):
        return state["service"]

    async def noop_notify(event, appointment, **extra):
        state["notified"].append((event, extra))

    monkeypatch.setattr(availability, "load_salon", load_salon)
    monkeypatch.setattr(availability, "load_service", load_service)
    monkeypatch.setattr(notifications, "notify", noop_notify)
    return state


# --- create_booking: identidad del cliente -----------------------------------


@pytest.mark.asyncio
async def test_rechaza_sin_client_id_ni_guest_name(patched):
    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, staff_id=STAFF_A
    )
    with pytest.raises(ResourceNotFound):
        await bookings.create_booking(session, request, now=NOW)
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_rechaza_client_id_de_otro_salon(patched):
    session = FakeSession()
    session.get_map[(Profile, CLIENT_ID)] = make_profile(salon_id=uuid.uuid4())
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        client_id=CLIENT_ID,
    )
    with pytest.raises(ResourceNotFound):
        await bookings.create_booking(session, request, now=NOW)


# --- create_booking: resolución de profesional --------------------------------


@pytest.mark.asyncio
async def test_crea_turno_con_staff_explicito(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [only_staff_id] if only_staff_id else [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
    )
    appointment = await bookings.create_booking(session, request, now=NOW)

    assert appointment.staff_id == STAFF_A
    assert appointment.status == AppointmentStatus.pending
    assert appointment.start_time == START and appointment.end_time == END
    assert session.commit_calls == 1
    assert patched["notified"] == [("booking.created", {})]


@pytest.mark.asyncio
async def test_google_calendar_caido_no_bloquea_la_creacion_del_turno(patched, monkeypatch):
    """Contrato central de la integración: un problema con Google (token
    vencido, API caída, lo que sea) nunca puede tumbar una reserva real. Se
    fuerza la falla DENTRO del try/except de `google_calendar._push` (no
    reemplazando `push_appointment_created` entero, que saltearía la
    protección real y no probaría nada)."""
    from app.core.config import get_settings
    from app.services import google_calendar

    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "id")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(settings, "google_calendar_token_key", "key")

    async def boom(session, salon_id):
        raise RuntimeError("Google Calendar está caído")

    monkeypatch.setattr(google_calendar, "get_connection", boom)

    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [only_staff_id] if only_staff_id else [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
    )
    appointment = await bookings.create_booking(session, request, now=NOW)

    assert appointment.status == AppointmentStatus.pending
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_auto_confirm_deja_el_turno_confirmado(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
        auto_confirm=True,
    )
    appointment = await bookings.create_booking(session, request, now=NOW)
    assert appointment.status == AppointmentStatus.confirmed


@pytest.mark.asyncio
async def test_auto_asignacion_salta_al_primer_disponible(patched, monkeypatch):
    """STAFF_A está fuera de horario; debe caer a STAFF_B sin fallar."""

    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A, STAFF_B]

    async def assert_slot_bookable(session, staff_id, **kwargs):
        if staff_id == STAFF_A:
            raise OutsideWorkingHours("fuera de horario")
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    appointment = await bookings.create_booking(session, request, now=NOW)
    assert appointment.staff_id == STAFF_B


@pytest.mark.asyncio
async def test_auto_asignacion_sin_candidatos_disponibles(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A, STAFF_B]

    async def assert_slot_bookable(session, staff_id, **kwargs):
        raise SlotTakenLocally(Interval(START, END), staff_id)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    with pytest.raises(SlotUnavailable):
        await bookings.create_booking(session, request, now=NOW)
    assert session.commit_calls == 0


# --- create_booking: carrera de concurrencia ----------------------------------


@pytest.mark.asyncio
async def test_double_booking_en_commit_se_traduce_a_slot_unavailable(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [only_staff_id] if only_staff_id else [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    session.commit_side_effect = overlap_error("appointments_no_double_booking")

    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
    )
    with pytest.raises(SlotUnavailable):
        await bookings.create_booking(session, request, now=NOW)

    assert session.rollback_calls == 1
    # La notificación de creación no debe dispararse si el INSERT no prosperó.
    assert patched["notified"] == []


@pytest.mark.asyncio
async def test_constraint_desconocido_se_propaga_sin_traducir(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    session.commit_side_effect = overlap_error("some_other_unmapped_constraint")

    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
    )
    with pytest.raises(IntegrityError):
        await bookings.create_booking(session, request, now=NOW)


# --- transition_status / cancel_booking ---------------------------------------


def make_appointment(**overrides):
    base = dict(
        id=uuid.uuid4(),
        salon_id=SALON_ID,
        client_id=None,
        status=AppointmentStatus.pending,
        cancelled_at=None,
        cancellation_reason=None,
        start_time=START,
        end_time=END,
        staff_id=STAFF_A,
        service_id=SERVICE_ID,
        payment_status=PaymentStatus.unpaid,
        mp_payment_id=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_transicion_valida_actualiza_estado_y_notifica(patched):
    appt = make_appointment()
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    updated = await bookings.transition_status(
        session, appt.id, AppointmentStatus.confirmed
    )
    assert updated.status == AppointmentStatus.confirmed
    assert patched["notified"] == [("booking.confirmed", {"reason": None})]


@pytest.mark.asyncio
async def test_transicion_invalida_no_commitea(patched):
    appt = make_appointment(status=AppointmentStatus.completed)
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    with pytest.raises(InvalidStateTransition):
        await bookings.transition_status(session, appt.id, AppointmentStatus.confirmed)
    assert session.commit_calls == 0


@pytest.mark.asyncio
async def test_cancel_booking_setea_cancelled_at_y_reason(patched):
    appt = make_appointment()
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    updated = await bookings.cancel_booking(session, appt.id, reason="cliente avisó")
    assert updated.status == AppointmentStatus.cancelled
    assert updated.cancelled_at is not None
    assert updated.cancellation_reason == "cliente avisó"
    assert patched["notified"] == [("booking.cancelled", {"reason": "cliente avisó"})]


# --- reschedule_booking --------------------------------------------------------


@pytest.mark.asyncio
async def test_reschedule_actualiza_horario_y_notifica_con_start_previo(
    patched, monkeypatch
):
    new_start = START + dt.timedelta(hours=2)
    new_end = END + dt.timedelta(hours=2)

    async def assert_slot_bookable(session, **kwargs):
        return Interval(new_start, new_end)

    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    appt = make_appointment()
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    updated = await bookings.reschedule_booking(session, appt.id, new_start, now=NOW)
    assert updated.start_time == new_start
    assert updated.end_time == new_end

    event, extra = patched["notified"][0]
    assert event == "booking.rescheduled"
    assert extra["previous_start"] == START.isoformat()


@pytest.mark.asyncio
async def test_reschedule_turno_no_activo_falla(patched):
    appt = make_appointment(status=AppointmentStatus.cancelled)
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    with pytest.raises(InvalidStateTransition):
        await bookings.reschedule_booking(session, appt.id, START + dt.timedelta(hours=1))


@pytest.mark.asyncio
async def test_reschedule_choca_con_otro_turno(patched, monkeypatch):
    async def assert_slot_bookable(session, **kwargs):
        raise SlotTakenLocally(Interval(START, END), STAFF_A)

    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    appt = make_appointment()
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    with pytest.raises(SlotUnavailable):
        await bookings.reschedule_booking(session, appt.id, START + dt.timedelta(hours=1))


# --- create_booking_idempotent -------------------------------------------------


def key_violation() -> IntegrityError:
    return IntegrityError(
        "INSERT ...",
        {},
        Exception('duplicate key value violates unique constraint "idempotency_keys_pkey"'),
    )


@pytest.mark.asyncio
async def test_idempotent_sin_key_delega_directo(patched, monkeypatch):
    expected = make_appointment()
    calls = []

    async def fake_create(session, request, now=None):
        calls.append(request)
        return expected

    monkeypatch.setattr(bookings, "create_booking", fake_create)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    result = await bookings.create_booking_idempotent(session, request, now=NOW)

    assert result is expected
    assert len(calls) == 1
    assert session.added == []  # nunca se tocó idempotency_keys


@pytest.mark.asyncio
async def test_idempotent_primera_vez_reserva_key_y_guarda_appointment_id(
    patched, monkeypatch
):
    created = make_appointment()

    async def fake_create(session, request, now=None):
        return created

    monkeypatch.setattr(bookings, "create_booking", fake_create)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    result = await bookings.create_booking_idempotent(
        session, request, idempotency_key="key-123", now=NOW
    )

    assert result is created
    assert len(session.added) == 1
    assert isinstance(session.added[0], IdempotencyKey)
    assert session.added[0].key == "key-123"
    assert session.added[0].salon_id == SALON_ID
    assert session.commit_calls == 2  # reserva de la key + guardado del resultado
    assert len(session.executed) == 1  # el UPDATE que completa appointment_id


@pytest.mark.asyncio
async def test_idempotent_key_repetida_devuelve_el_turno_ya_creado(patched, monkeypatch):
    existing = make_appointment()

    async def fake_create(session, request, now=None):
        raise AssertionError("no debería volver a intentar crear el turno")

    async def fake_get_booking(session, appointment_id):
        assert appointment_id == existing.id
        return existing

    monkeypatch.setattr(bookings, "create_booking", fake_create)
    monkeypatch.setattr(bookings, "get_booking", fake_get_booking)

    session = FakeSession()
    session.commit_side_effect = key_violation()
    session.get_map[(IdempotencyKey, "key-123")] = SimpleNamespace(
        key="key-123", appointment_id=existing.id
    )

    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    result = await bookings.create_booking_idempotent(
        session, request, idempotency_key="key-123", now=NOW
    )

    assert result is existing
    assert session.rollback_calls == 1


@pytest.mark.asyncio
async def test_idempotent_key_repetida_sin_resultado_aun_da_conflict(patched, monkeypatch):
    session = FakeSession()
    session.commit_side_effect = key_violation()
    session.get_map[(IdempotencyKey, "key-123")] = SimpleNamespace(
        key="key-123", appointment_id=None
    )

    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    with pytest.raises(ConflictError):
        await bookings.create_booking_idempotent(
            session, request, idempotency_key="key-123", now=NOW
        )


@pytest.mark.asyncio
async def test_idempotent_libera_la_key_si_create_booking_falla(patched, monkeypatch):
    async def fake_create(session, request, now=None):
        raise SlotUnavailable("ocupado")

    monkeypatch.setattr(bookings, "create_booking", fake_create)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID, service_id=SERVICE_ID, start_time=START, guest_name="Julieta"
    )
    with pytest.raises(SlotUnavailable):
        await bookings.create_booking_idempotent(
            session, request, idempotency_key="key-123", now=NOW
        )

    # Se liberó la key (DELETE ejecutado) para que un reintento legítimo
    # pueda volver a evaluarse de cero.
    assert len(session.executed) == 1
    assert session.commit_calls == 2  # reserva de la key + el DELETE que la libera


# --- create_booking: seña (efectivo / Mercado Pago) --------------------------


@pytest.mark.asyncio
async def test_sin_payment_method_no_guarda_sena(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
    )
    appointment = await bookings.create_booking(session, request, now=NOW)

    assert appointment.payment_method is None
    assert appointment.deposit_amount is None
    assert appointment.payment_status == PaymentStatus.unpaid
    assert appointment.mp_init_point is None


@pytest.mark.asyncio
async def test_efectivo_congela_el_monto_de_sena_sin_llamar_a_mercadopago(
    patched, monkeypatch
):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("no debería llamarse a Mercado Pago para pago en efectivo")

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)
    monkeypatch.setattr(payments, "create_preference", fail_if_called)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
        payment_method=PaymentMethod.cash,
    )
    appointment = await bookings.create_booking(session, request, now=NOW)

    assert appointment.payment_method == PaymentMethod.cash
    assert appointment.deposit_amount == Decimal("8500")
    assert appointment.payment_status == PaymentStatus.pending
    assert appointment.status == AppointmentStatus.pending
    assert appointment.mp_init_point is None
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_mercadopago_crea_preferencia_y_deja_la_sena_pendiente(patched, monkeypatch):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    async def fake_create_preference(appointment, description):
        assert appointment.deposit_amount == Decimal("8500")
        assert "Manicura" in description
        return {"id": "pref-123", "init_point": "https://mercadopago.com/checkout/pref-123"}

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)
    monkeypatch.setattr(payments, "create_preference", fake_create_preference)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
        payment_method=PaymentMethod.mercadopago,
    )
    appointment = await bookings.create_booking(session, request, now=NOW)

    assert appointment.status == AppointmentStatus.pending  # el turno ya quedó reservado
    assert appointment.payment_status == PaymentStatus.pending
    assert appointment.mp_preference_id == "pref-123"
    assert appointment.mp_init_point == "https://mercadopago.com/checkout/pref-123"
    assert session.commit_calls == 2  # el INSERT del turno + guardar la preferencia


@pytest.mark.asyncio
async def test_mercadopago_si_falla_la_preferencia_el_turno_igual_queda_reservado(
    patched, monkeypatch
):
    async def eligible_staff_ids(session, service_id, only_staff_id=None):
        return [STAFF_A]

    async def assert_slot_bookable(session, **kwargs):
        return Interval(START, END)

    async def fake_create_preference(appointment, description):
        raise UpstreamError("Mercado Pago no responde")

    monkeypatch.setattr(availability, "eligible_staff_ids", eligible_staff_ids)
    monkeypatch.setattr(availability, "assert_slot_bookable", assert_slot_bookable)
    monkeypatch.setattr(payments, "create_preference", fake_create_preference)

    session = FakeSession()
    request = BookingRequest(
        salon_id=SALON_ID,
        service_id=SERVICE_ID,
        start_time=START,
        staff_id=STAFF_A,
        guest_name="Julieta",
        payment_method=PaymentMethod.mercadopago,
    )
    appointment = await bookings.create_booking(session, request, now=NOW)

    assert appointment.status == AppointmentStatus.pending
    assert appointment.payment_status == PaymentStatus.pending
    assert appointment.mp_init_point is None
    assert session.commit_calls == 1  # solo el INSERT; no se guardó preferencia


# --- confirm_mercadopago_payment (webhook) ------------------------------------


@pytest.mark.asyncio
async def test_webhook_pago_aprobado_confirma_el_turno(patched, monkeypatch):
    appt = make_appointment(
        status=AppointmentStatus.pending, payment_status=PaymentStatus.pending
    )
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    async def fake_get_payment(payment_id):
        assert payment_id == "pay-1"
        return {"id": "pay-1", "status": "approved", "external_reference": str(appt.id)}

    monkeypatch.setattr(payments, "get_payment", fake_get_payment)

    await bookings.confirm_mercadopago_payment(session, "pay-1")

    assert appt.payment_status == PaymentStatus.paid
    assert appt.mp_payment_id == "pay-1"
    assert appt.status == AppointmentStatus.confirmed
    assert patched["notified"] == [("booking.confirmed", {"reason": None})]


@pytest.mark.asyncio
async def test_webhook_pago_rechazado_no_toca_el_turno(patched, monkeypatch):
    appt = make_appointment(
        status=AppointmentStatus.pending, payment_status=PaymentStatus.pending
    )
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    async def fake_get_payment(payment_id):
        return {"id": "pay-2", "status": "rejected", "external_reference": str(appt.id)}

    monkeypatch.setattr(payments, "get_payment", fake_get_payment)

    await bookings.confirm_mercadopago_payment(session, "pay-2")

    assert appt.payment_status == PaymentStatus.pending
    assert appt.status == AppointmentStatus.pending
    assert patched["notified"] == []


@pytest.mark.asyncio
async def test_webhook_es_idempotente_si_la_sena_ya_estaba_paga(patched, monkeypatch):
    """No hay forma de saber que ya está pago sin resolver primero a qué
    turno corresponde `payment_id` (viene de `external_reference`), así que
    `get_payment` sí se llama — lo idempotente es que no se vuelve a
    commitear ni a disparar `booking.confirmed` una segunda vez."""
    appt = make_appointment(
        status=AppointmentStatus.confirmed, payment_status=PaymentStatus.paid
    )
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    async def fake_get_payment(payment_id):
        return {"id": "pay-3", "status": "approved", "external_reference": str(appt.id)}

    monkeypatch.setattr(payments, "get_payment", fake_get_payment)

    await bookings.confirm_mercadopago_payment(session, "pay-3")

    assert session.commit_calls == 0
    assert patched["notified"] == []


@pytest.mark.asyncio
async def test_webhook_turno_inexistente_no_rompe(patched, monkeypatch):
    session = FakeSession()

    async def fake_get_payment(payment_id):
        return {"id": "pay-4", "status": "approved", "external_reference": str(uuid.uuid4())}

    monkeypatch.setattr(payments, "get_payment", fake_get_payment)

    await bookings.confirm_mercadopago_payment(session, "pay-4")

    assert session.commit_calls == 0


# --- set_payment_status (transferencia confirmada/desmarcada a mano) ----------


@pytest.mark.asyncio
async def test_marcar_seña_recibida_confirma_el_turno(patched):
    appt = make_appointment(
        status=AppointmentStatus.pending, payment_status=PaymentStatus.pending
    )
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    result = await bookings.set_payment_status(session, appt.id, PaymentStatus.paid)

    assert result.payment_status == PaymentStatus.paid
    assert result.status == AppointmentStatus.confirmed
    assert patched["notified"] == [("booking.confirmed", {"reason": None})]


@pytest.mark.asyncio
async def test_marcar_seña_recibida_es_idempotente(patched):
    appt = make_appointment(
        status=AppointmentStatus.confirmed, payment_status=PaymentStatus.paid
    )
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    result = await bookings.set_payment_status(session, appt.id, PaymentStatus.paid)

    assert result.payment_status == PaymentStatus.paid
    assert session.commit_calls == 0
    assert patched["notified"] == []


@pytest.mark.asyncio
async def test_desmarcar_seña_no_revierte_el_turno_confirmado(patched):
    """Deshacer un pago corrige solo la seña, no el turno -- si ya se avisó
    al cliente que quedó confirmado, no tiene sentido volver atrás por un
    error de tipeo en la seña."""
    appt = make_appointment(
        status=AppointmentStatus.confirmed, payment_status=PaymentStatus.paid
    )
    session = FakeSession()
    session.get_map[(bookings.Appointment, appt.id)] = appt

    result = await bookings.set_payment_status(session, appt.id, PaymentStatus.pending)

    assert result.payment_status == PaymentStatus.pending
    assert result.status == AppointmentStatus.confirmed
    assert patched["notified"] == []

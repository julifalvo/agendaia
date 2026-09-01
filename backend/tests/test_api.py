"""Tests de integración de la capa HTTP: auth, autorización y wiring de rutas.

La lógica de negocio (motor de slots, máquina de estados) ya está cubierta en
`test_availability.py`/`test_bookings.py` con datos falsos; acá se ejercita la
parte que esos tests no tocan: que falte el token da 401 con el shape
correcto, que un rol equivocado da 403, que un cliente no puede leer turnos
de otro salón aunque lo pida por query string, etc. Las funciones de
`app.services.*` se monkeypatchean para no depender de Postgres.
"""

import datetime as dt
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.db.models import AppointmentStatus, UserRole
from app.db.session import get_session
from app.main import app
from app.services import admin as admin_service
from app.services import availability as availability_service
from app.services import bookings as bookings_service

SALON_ID = uuid.uuid4()
OTHER_SALON_ID = uuid.uuid4()
SERVICE_ID = uuid.uuid4()
STAFF_ID = uuid.uuid4()
CLIENT_ID = uuid.uuid4()

START = dt.datetime(2026, 9, 1, 14, 0, tzinfo=dt.UTC)
END = dt.datetime(2026, 9, 1, 15, 0, tzinfo=dt.UTC)


class _DummySession:
    """Sesión inerte: las rutas usan funciones de servicio monkeypatcheadas,
    salvo /health, que sí llama a `session.execute(SELECT 1)` de verdad."""

    async def execute(self, *args, **kwargs):
        return None


async def _fake_session():
    yield _DummySession()


def make_profile(role: UserRole, salon_id: uuid.UUID = SALON_ID, **overrides):
    base = dict(
        id=uuid.uuid4(),
        salon_id=salon_id,
        role=role,
        full_name="Perfil de prueba",
        email="test@example.com",
        phone=None,
        is_active=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def make_appointment(**overrides):
    base = dict(
        id=uuid.uuid4(),
        salon_id=SALON_ID,
        client_id=None,
        guest_name="Julieta",
        staff_id=STAFF_ID,
        service_id=SERVICE_ID,
        start_time=START,
        end_time=END,
        duration_minutes=60,
        price=1000,
        currency="ARS",
        status=AppointmentStatus.pending,
        notes=None,
        created_at=START,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _override_session():
    app.dependency_overrides[get_session] = _fake_session
    yield
    app.dependency_overrides.pop(get_session, None)


def as_profile(profile):
    """Reemplaza get_current_profile/get_optional_profile por uno fijo."""

    async def _current():
        return profile

    async def _optional():
        return profile

    app.dependency_overrides[deps.get_current_profile] = _current
    app.dependency_overrides[deps.get_optional_profile] = _optional


def as_anonymous():
    app.dependency_overrides.pop(deps.get_current_profile, None)

    async def _optional():
        return None

    app.dependency_overrides[deps.get_optional_profile] = _optional


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(deps.get_current_profile, None)
    app.dependency_overrides.pop(deps.get_optional_profile, None)


# --- infra ---------------------------------------------------------------


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


# --- auth: sin token / token de más --------------------------------------


def test_listar_turnos_sin_token_da_401_con_shape_consistente(client):
    app.dependency_overrides.pop(deps.get_current_profile, None)
    res = client.get("/api/v1/bookings")
    assert res.status_code == 401
    body = res.json()
    assert body["code"] == "not_authenticated"
    assert "message" in body


def test_availability_es_publica_sin_token(client, monkeypatch):
    async def fake_slots(session, **kwargs):
        return []

    monkeypatch.setattr(availability_service, "get_available_slots", fake_slots)

    res = client.get(
        "/api/v1/availability",
        params={"salon_id": str(SALON_ID), "service_id": str(SERVICE_ID), "date": "2026-09-01"},
    )
    assert res.status_code == 200
    assert res.json()["slots"] == []


# --- creación de turnos ----------------------------------------------------


def test_invitado_puede_reservar_sin_sesion(client, monkeypatch):
    as_anonymous()

    async def fake_create(session, request, now=None):
        assert request.client_id is None
        assert request.guest_name == "Julieta"
        assert request.guest_phone == "+5491100000000"
        assert request.guest_email == "julieta@example.com"
        return make_appointment(guest_name="Julieta")

    monkeypatch.setattr(bookings_service, "create_booking", fake_create)

    res = client.post(
        "/api/v1/bookings",
        json={
            "salon_id": str(SALON_ID),
            "service_id": str(SERVICE_ID),
            "start_time": START.isoformat(),
            "guest_name": "Julieta",
            "guest_phone": "+5491100000000",
            "guest_email": "julieta@example.com",
        },
    )
    assert res.status_code == 201
    assert res.json()["status"] == "pending"


def test_invitado_puede_reservar_sin_email(client, monkeypatch):
    """El email es opcional — a diferencia del WhatsApp, no debe bloquear la
    reserva de invitado si no lo carga."""
    as_anonymous()

    async def fake_create(session, request, now=None):
        assert request.guest_email is None
        return make_appointment(guest_name="Julieta")

    monkeypatch.setattr(bookings_service, "create_booking", fake_create)

    res = client.post(
        "/api/v1/bookings",
        json={
            "salon_id": str(SALON_ID),
            "service_id": str(SERVICE_ID),
            "start_time": START.isoformat(),
            "guest_name": "Julieta",
            "guest_phone": "+5491100000000",
        },
    )
    assert res.status_code == 201


def test_invitado_sin_whatsapp_no_puede_reservar(client):
    """El WhatsApp es el único canal que tiene el salón para confirmarle el
    turno a alguien sin cuenta — por eso es obligatorio, a diferencia del
    flujo de staff/owner cargando un turno a mano."""
    as_anonymous()

    res = client.post(
        "/api/v1/bookings",
        json={
            "salon_id": str(SALON_ID),
            "service_id": str(SERVICE_ID),
            "start_time": START.isoformat(),
            "guest_name": "Julieta",
        },
    )
    assert res.status_code == 404
    assert "whatsapp" in res.json()["message"].lower()


def test_invitado_no_puede_asignarse_client_id_ajeno(client):
    as_anonymous()

    res = client.post(
        "/api/v1/bookings",
        json={
            "salon_id": str(SALON_ID),
            "service_id": str(SERVICE_ID),
            "start_time": START.isoformat(),
            "client_id": str(CLIENT_ID),
        },
    )
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_cliente_logueado_no_puede_reservar_en_otro_salon(client):
    as_profile(make_profile(UserRole.client, salon_id=SALON_ID))

    res = client.post(
        "/api/v1/bookings",
        json={
            "salon_id": str(OTHER_SALON_ID),
            "service_id": str(SERVICE_ID),
            "start_time": START.isoformat(),
        },
    )
    assert res.status_code == 403


def test_cliente_logueado_ignora_client_id_del_body(client, monkeypatch):
    """El backend debe usar el id del token, nunca lo que venga en el JSON."""
    profile = make_profile(UserRole.client, salon_id=SALON_ID)
    as_profile(profile)

    captured = {}

    async def fake_create(session, request, now=None):
        captured["client_id"] = request.client_id
        return make_appointment(client_id=profile.id, guest_name=None)

    monkeypatch.setattr(bookings_service, "create_booking", fake_create)

    someone_else = uuid.uuid4()
    res = client.post(
        "/api/v1/bookings",
        json={
            "salon_id": str(SALON_ID),
            "service_id": str(SERVICE_ID),
            "start_time": START.isoformat(),
            "client_id": str(someone_else),
        },
    )
    assert res.status_code == 201
    assert captured["client_id"] == profile.id
    assert captured["client_id"] != someone_else


# --- listado: aislamiento multi-tenant ----------------------------------------


def test_cliente_solo_puede_listar_lo_propio(client, monkeypatch):
    profile = make_profile(UserRole.client, salon_id=SALON_ID)
    as_profile(profile)

    captured = {}

    async def fake_list(session, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(bookings_service, "list_bookings", fake_list)

    otro_cliente = uuid.uuid4()
    res = client.get("/api/v1/bookings", params={"client_id": str(otro_cliente)})

    assert res.status_code == 200
    # El client_id pedido por query string se ignora: siempre es el propio.
    assert captured["client_id"] == profile.id
    assert captured["salon_id"] == profile.salon_id


def test_salon_id_nunca_viene_del_caller(client, monkeypatch):
    """No hay forma de pedir los turnos de otro salón: no hay parámetro para eso."""
    profile = make_profile(UserRole.owner, salon_id=SALON_ID)
    as_profile(profile)

    captured = {}

    async def fake_list(session, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(bookings_service, "list_bookings", fake_list)

    res = client.get("/api/v1/bookings")
    assert res.status_code == 200
    assert captured["salon_id"] == profile.salon_id


# --- autorización sobre un turno puntual --------------------------------------


def test_get_booking_de_otro_salon_da_404_no_403(client, monkeypatch):
    """404 en vez de 403: no hay que confirmarle a nadie que el id existe."""
    as_profile(make_profile(UserRole.owner, salon_id=SALON_ID))

    async def fake_get(session, appointment_id):
        return make_appointment(salon_id=OTHER_SALON_ID)

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)

    res = client.get(f"/api/v1/bookings/{uuid.uuid4()}")
    assert res.status_code == 404


def test_cliente_no_puede_confirmar_turnos(client, monkeypatch):
    as_profile(make_profile(UserRole.client, salon_id=SALON_ID))

    res = client.patch(
        f"/api/v1/bookings/{uuid.uuid4()}/status", json={"status": "confirmed"}
    )
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_owner_puede_confirmar_turnos(client, monkeypatch):
    profile = make_profile(UserRole.owner, salon_id=SALON_ID)
    as_profile(profile)

    appt = make_appointment(salon_id=SALON_ID)

    async def fake_get(session, appointment_id):
        return appt

    async def fake_transition(session, appointment_id, new_status, reason=None):
        return make_appointment(salon_id=SALON_ID, status=new_status)

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)
    monkeypatch.setattr(bookings_service, "transition_status", fake_transition)

    res = client.patch(
        f"/api/v1/bookings/{appt.id}/status", json={"status": "confirmed"}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "confirmed"


# --- autorización: un staff no puede tocar turnos de otro profesional --------
#
# `_authorize_mutation` (routes/bookings.py) restringe las 4 rutas que mutan
# un turno existente: un staff (no owner) solo puede tocar lo suyo. El owner
# sigue sin restricciones — se verifica con un caso de regresión.


def test_staff_no_puede_cancelar_turno_de_otro_staff(client, monkeypatch):
    profile = make_profile(UserRole.staff, salon_id=SALON_ID)
    as_profile(profile)
    appt = make_appointment(salon_id=SALON_ID, staff_id=uuid.uuid4())

    async def fake_get(session, appointment_id):
        return appt

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)

    res = client.post(f"/api/v1/bookings/{appt.id}/cancel", json={})
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_staff_no_puede_reprogramar_turno_de_otro_staff(client, monkeypatch):
    profile = make_profile(UserRole.staff, salon_id=SALON_ID)
    as_profile(profile)
    appt = make_appointment(salon_id=SALON_ID, staff_id=uuid.uuid4())

    async def fake_get(session, appointment_id):
        return appt

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)

    res = client.post(
        f"/api/v1/bookings/{appt.id}/reschedule",
        json={"start_time": START.isoformat()},
    )
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_staff_no_puede_cambiar_estado_de_turno_de_otro_staff(client, monkeypatch):
    profile = make_profile(UserRole.staff, salon_id=SALON_ID)
    as_profile(profile)
    appt = make_appointment(salon_id=SALON_ID, staff_id=uuid.uuid4())

    async def fake_get(session, appointment_id):
        return appt

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)

    res = client.patch(
        f"/api/v1/bookings/{appt.id}/status", json={"status": "confirmed"}
    )
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_staff_no_puede_cambiar_pago_de_turno_de_otro_staff(client, monkeypatch):
    profile = make_profile(UserRole.staff, salon_id=SALON_ID)
    as_profile(profile)
    appt = make_appointment(salon_id=SALON_ID, staff_id=uuid.uuid4())

    async def fake_get(session, appointment_id):
        return appt

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)

    res = client.patch(
        f"/api/v1/bookings/{appt.id}/payment-status", json={"payment_status": "paid"}
    )
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_staff_puede_cancelar_su_propio_turno(client, monkeypatch):
    """Regresión: la restricción nueva no debe bloquear a un staff sobre sus
    propios turnos."""
    profile = make_profile(UserRole.staff, salon_id=SALON_ID)
    as_profile(profile)
    appt = make_appointment(salon_id=SALON_ID, staff_id=profile.id)

    async def fake_get(session, appointment_id):
        return appt

    async def fake_cancel(session, appointment_id, reason=None):
        return make_appointment(
            salon_id=SALON_ID, staff_id=profile.id, status=AppointmentStatus.cancelled
        )

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)
    monkeypatch.setattr(bookings_service, "cancel_booking", fake_cancel)

    res = client.post(f"/api/v1/bookings/{appt.id}/cancel", json={})
    assert res.status_code == 200


def test_owner_puede_cancelar_turno_de_cualquier_staff(client, monkeypatch):
    """Regresión: el owner sigue sin restricciones dentro de su salón."""
    profile = make_profile(UserRole.owner, salon_id=SALON_ID)
    as_profile(profile)
    appt = make_appointment(salon_id=SALON_ID, staff_id=uuid.uuid4())

    async def fake_get(session, appointment_id):
        return appt

    async def fake_cancel(session, appointment_id, reason=None):
        return make_appointment(salon_id=SALON_ID, status=AppointmentStatus.cancelled)

    monkeypatch.setattr(bookings_service, "get_booking", fake_get)
    monkeypatch.setattr(bookings_service, "cancel_booking", fake_cancel)

    res = client.post(f"/api/v1/bookings/{appt.id}/cancel", json={})
    assert res.status_code == 200


# --- administración: color de staff -------------------------------------------


def test_staff_no_puede_cambiar_color_de_staff(client):
    as_profile(make_profile(UserRole.staff, salon_id=SALON_ID))
    res = client.patch(
        f"/api/v1/staff/{uuid.uuid4()}/color", json={"color": "#AABBCC"}
    )
    assert res.status_code == 403


def test_owner_puede_cambiar_color_de_staff(client, monkeypatch):
    profile = make_profile(UserRole.owner, salon_id=SALON_ID)
    as_profile(profile)
    target_id = uuid.uuid4()

    async def fake_set_color(session, salon_id, staff_id, color):
        assert salon_id == profile.salon_id
        assert staff_id == target_id
        assert color == "#AABBCC"
        return make_profile(UserRole.staff, salon_id=SALON_ID, id=target_id, color=color)

    monkeypatch.setattr(admin_service, "set_staff_color", fake_set_color)

    res = client.patch(f"/api/v1/staff/{target_id}/color", json={"color": "#AABBCC"})
    assert res.status_code == 200
    assert res.json()["color"] == "#AABBCC"


def test_color_invalido_es_422(client):
    as_profile(make_profile(UserRole.owner, salon_id=SALON_ID))
    res = client.patch(f"/api/v1/staff/{uuid.uuid4()}/color", json={"color": "not-a-color"})
    assert res.status_code == 422


# --- administración: servicios ------------------------------------------------


def test_crear_servicio_requiere_owner(client):
    as_profile(make_profile(UserRole.staff, salon_id=SALON_ID))
    res = client.post(
        "/api/v1/services",
        json={"name": "Manicura", "duration_minutes": 60, "price": "1000"},
    )
    assert res.status_code == 403


def test_owner_crea_servicio_en_su_propio_salon(client, monkeypatch):
    profile = make_profile(UserRole.owner, salon_id=SALON_ID)
    as_profile(profile)

    captured = {}

    async def fake_create(session, salon_id, data):
        captured["salon_id"] = salon_id
        return SimpleNamespace(
            id=uuid.uuid4(),
            salon_id=salon_id,
            category_id=data.category_id,
            category_name=None,
            name=data.name,
            description=data.description,
            duration_minutes=data.duration_minutes,
            buffer_minutes=data.buffer_minutes,
            price=data.price,
            currency=data.currency,
            is_active=True,
        )

    monkeypatch.setattr(admin_service, "create_service", fake_create)

    res = client.post(
        "/api/v1/services",
        json={"name": "Manicura", "duration_minutes": 60, "price": "1000"},
    )
    assert res.status_code == 201
    assert captured["salon_id"] == profile.salon_id


def test_staff_no_puede_borrar_ausencia_de_otro_staff(client, monkeypatch):
    profile = make_profile(UserRole.staff, salon_id=SALON_ID)
    as_profile(profile)

    otro_staff_id = uuid.uuid4()
    time_off = SimpleNamespace(
        id=uuid.uuid4(), salon_id=SALON_ID, staff_id=otro_staff_id
    )

    class FakeSessionGet:
        async def get(self, model, id_):
            return time_off

    # Dependencia no-generadora: FastAPI usa el valor de retorno directamente
    # como sesión resuelta, sin esperar semántica de generador acá.
    app.dependency_overrides[get_session] = lambda: FakeSessionGet()

    res = client.delete(f"/api/v1/time-off/{time_off.id}")
    assert res.status_code == 403

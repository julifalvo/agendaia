"""Tests de `GET /bookings/{id}/public` — el link "ver mi turno" sin sesión.

No pega a la base real: se mockea `bookings.get_public_booking` y se ejercita
solo el contrato de la ruta (token inválido/ausente -> 404, token válido ->
devuelve el subconjunto público de campos, nunca `BookingOut` completo).
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.models import AppointmentStatus
from app.db.session import get_session
from app.main import app
from app.services import booking_links
from app.services import bookings as bookings_service

APPOINTMENT_ID = uuid.uuid4()


class _DummySession:
    pass


async def _fake_session():
    yield _DummySession()


@pytest.fixture(autouse=True)
def _setup(monkeypatch):
    app.dependency_overrides[get_session] = _fake_session
    monkeypatch.setattr(get_settings(), "booking_link_secret", "un-secreto-de-test")
    yield
    app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _path(token: str) -> str:
    return f"/api/v1/bookings/{APPOINTMENT_ID}/public?t={token}"


def test_sin_token_valido_devuelve_404(client):
    res = client.get(_path("token-inventado"))
    assert res.status_code == 404


def test_sin_booking_link_secret_configurado_rechaza_todo(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "booking_link_secret", "")
    token = "lo-que-sea"
    res = client.get(_path(token))
    assert res.status_code == 404


def test_token_valido_devuelve_el_subconjunto_publico(client, monkeypatch):
    token = booking_links.generate_token(APPOINTMENT_ID)
    assert token is not None

    now = dt.datetime.now(dt.UTC)

    async def fake_get_public_booking(session, appointment_id):
        assert appointment_id == APPOINTMENT_ID
        return bookings_service.PublicBooking(
            id=APPOINTMENT_ID,
            salon_name="MC Nails Studio",
            service_name="Manicura",
            staff_name="Valentina",
            start_time=now,
            end_time=now + dt.timedelta(hours=1),
            status=AppointmentStatus.confirmed,
        )

    monkeypatch.setattr(bookings_service, "get_public_booking", fake_get_public_booking)

    res = client.get(_path(token))
    assert res.status_code == 200
    body = res.json()
    assert body["service_name"] == "Manicura"
    assert body["staff_name"] == "Valentina"
    assert body["status"] == "confirmed"
    # Nunca el shape completo de BookingOut (sin notes/payment/created_by acá).
    assert "notes" not in body
    assert "payment_status" not in body

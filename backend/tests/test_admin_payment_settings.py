"""Tests de `GET/PATCH /salon/payment-settings`.

Mismo criterio de dos niveles que `test_admin_invite.py`:
  - Capa HTTP: autorización (solo owner/`has_full_access`) y shape, con
    `admin.get_payment_settings`/`admin.update_payment_settings` mockeados.
  - Capa de servicio: `update_payment_settings` sobre una sesión falsa en
    memoria, verificando que solo toca lo que vino en el payload y que
    delega el cifrado del token a `payments.encrypt_access_token`.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.core.config import get_settings
from app.db.models import UserRole
from app.db.session import get_session
from app.main import app
from app.schemas.admin import SalonPaymentSettingsUpdate
from app.services import admin as admin_service

SALON_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
def _reset_global_mercadopago_default(monkeypatch):
    """Aísla estos tests del `.env` real: sin esto, `mercadopago_configured`
    reflejaría si el backend local tiene un `MERCADOPAGO_ACCESS_TOKEN`
    cargado, no el comportamiento que se quiere probar acá."""
    monkeypatch.setattr(get_settings(), "mercadopago_access_token", "")


class _DummySession:
    async def execute(self, *args, **kwargs):
        return None


async def _fake_session():
    yield _DummySession()


def make_profile(role: UserRole, salon_id: uuid.UUID = SALON_ID, **overrides):
    base = dict(
        id=uuid.uuid4(),
        salon_id=salon_id,
        role=role,
        full_name="Dueña de prueba",
        email="owner@example.com",
        phone=None,
        is_active=True,
        color=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def make_salon(**overrides):
    base = dict(
        id=SALON_ID,
        booking_deposit_amount=None,
        mercadopago_access_token_encrypted=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _override_session():
    app.dependency_overrides[get_session] = _fake_session
    yield
    app.dependency_overrides.pop(get_session, None)


def as_profile(profile):
    async def _current():
        return profile

    app.dependency_overrides[deps.get_current_profile] = _current


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(deps.get_current_profile, None)


# --- capa HTTP: autorización y shape --------------------------------------


def test_owner_puede_ver_la_configuracion(client, monkeypatch):
    owner = make_profile(UserRole.owner)
    as_profile(owner)

    async def fake_get(session, salon_id):
        assert salon_id == owner.salon_id
        return make_salon(booking_deposit_amount=Decimal("9000"))

    monkeypatch.setattr(admin_service, "get_payment_settings", fake_get)

    res = client.get("/api/v1/salon/payment-settings")
    assert res.status_code == 200
    body = res.json()
    assert body["booking_deposit_amount"] == "9000.00" or float(body["booking_deposit_amount"]) == 9000
    assert body["mercadopago_configured"] is False
    assert body["mercadopago_uses_salon_token"] is False


def test_staff_sin_acceso_completo_no_puede_ver_ni_editar(client):
    as_profile(make_profile(UserRole.staff))

    res = client.get("/api/v1/salon/payment-settings")
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"

    res = client.patch("/api/v1/salon/payment-settings", json={"booking_deposit_amount": 10000})
    assert res.status_code == 403


def test_owner_puede_actualizar_el_monto_de_sena(client, monkeypatch):
    owner = make_profile(UserRole.owner)
    as_profile(owner)

    async def fake_update(session, salon_id, payload):
        assert salon_id == owner.salon_id
        assert payload.booking_deposit_amount == Decimal("15000")
        assert payload.mercadopago_access_token is None
        return make_salon(booking_deposit_amount=Decimal("15000"))

    monkeypatch.setattr(admin_service, "update_payment_settings", fake_update)

    res = client.patch("/api/v1/salon/payment-settings", json={"booking_deposit_amount": 15000})
    assert res.status_code == 200
    assert float(res.json()["booking_deposit_amount"]) == 15000


def test_monto_negativo_o_cero_es_422(client):
    as_profile(make_profile(UserRole.owner))

    res = client.patch("/api/v1/salon/payment-settings", json={"booking_deposit_amount": 0})
    assert res.status_code == 422


# --- capa de servicio: actualización parcial y cifrado ----------------------


class _FakeSession:
    def __init__(self, salon):
        self._salon = salon
        self.commit_calls = 0

    async def get(self, model, id_):
        return self._salon if self._salon and self._salon.id == id_ else None

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, obj):
        pass


@pytest.mark.asyncio
async def test_update_payment_settings_solo_toca_los_campos_presentes(monkeypatch):
    salon = make_salon(
        booking_deposit_amount=Decimal("8500"),
        mercadopago_access_token_encrypted="ya-habia-uno-cifrado",
    )
    session = _FakeSession(salon)

    payload = SalonPaymentSettingsUpdate(booking_deposit_amount=Decimal("11000"))
    result = await admin_service.update_payment_settings(session, SALON_ID, payload)

    assert result.booking_deposit_amount == Decimal("11000")
    # No vino mercadopago_access_token en el payload: no se toca lo ya guardado.
    assert result.mercadopago_access_token_encrypted == "ya-habia-uno-cifrado"
    assert session.commit_calls == 1


@pytest.mark.asyncio
async def test_update_payment_settings_cifra_el_token_nuevo(monkeypatch):
    salon = make_salon()
    session = _FakeSession(salon)

    calls = []

    def fake_encrypt(raw_token):
        calls.append(raw_token)
        return f"cifrado::{raw_token}"

    from app.services import payments

    monkeypatch.setattr(payments, "encrypt_access_token", fake_encrypt)

    payload = SalonPaymentSettingsUpdate(mercadopago_access_token="APP_USR-nuevo-token")
    result = await admin_service.update_payment_settings(session, SALON_ID, payload)

    assert calls == ["APP_USR-nuevo-token"]
    assert result.mercadopago_access_token_encrypted == "cifrado::APP_USR-nuevo-token"


@pytest.mark.asyncio
async def test_update_payment_settings_string_vacio_borra_el_token(monkeypatch):
    salon = make_salon(mercadopago_access_token_encrypted="algo-cifrado")
    session = _FakeSession(salon)

    payload = SalonPaymentSettingsUpdate(mercadopago_access_token="")
    result = await admin_service.update_payment_settings(session, SALON_ID, payload)

    assert result.mercadopago_access_token_encrypted is None

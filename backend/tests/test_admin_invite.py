"""Tests de `POST /staff/invite` y `POST /staff/{id}/reset-password`.

Dos nivels, mismo criterio que el resto de la suite:
  - Capa HTTP (`test_api.py`): se monkeypatchea `admin.invite_staff`/
    `admin.reset_staff_password` para probar autorización (owner-only) y el
    shape de la respuesta, sin tocar sesión de DB real (`_DummySession`, ver
    `test_api.py`).
  - Capa de servicio: se monkeypatchea `supabase_admin.create_staff_user`/
    `supabase_admin.reset_password` (nunca se pega a la red) y se usa una
    sesión falsa en memoria (mismo patrón que `FakeSession` de
    `test_bookings.py`) para probar que asignan el rol pedido, devuelven la
    contraseña temporal y traducen errores del upstream correctamente.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.core.errors import ConflictError, ResourceNotFound, UpstreamError
from app.db.models import Profile, UserRole
from app.db.session import get_session
from app.main import app
from app.schemas.admin import StaffInviteCreate
from app.services import admin as admin_service
from app.services import supabase_admin

SALON_ID = uuid.uuid4()


class _DummySession:
    async def execute(self, *args, **kwargs):
        return None


async def _fake_session():
    yield _DummySession()


def make_profile(role: UserRole, salon_id: uuid.UUID = SALON_ID, **overrides):
    from types import SimpleNamespace

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


def test_owner_puede_invitar_staff(client, monkeypatch):
    owner = make_profile(UserRole.owner)
    as_profile(owner)

    invited = make_profile(UserRole.staff, salon_id=SALON_ID, full_name="Nueva Staff")

    async def fake_invite(session, salon_id, data):
        assert salon_id == owner.salon_id
        assert data.role == "staff"
        return invited, "una-clave-temporal"

    monkeypatch.setattr(admin_service, "invite_staff", fake_invite)

    res = client.post(
        "/api/v1/staff/invite",
        json={"email": "nueva@example.com", "full_name": "Nueva Staff", "role": "staff"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["role"] == "staff"
    assert body["temporary_password"] == "una-clave-temporal"


def test_staff_no_puede_invitar(client):
    as_profile(make_profile(UserRole.staff))

    res = client.post(
        "/api/v1/staff/invite",
        json={"email": "nueva@example.com", "full_name": "Nueva Staff", "role": "staff"},
    )
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


def test_email_invalido_es_422(client):
    as_profile(make_profile(UserRole.owner))

    res = client.post(
        "/api/v1/staff/invite",
        json={"email": "no-es-un-email", "full_name": "Nueva Staff", "role": "staff"},
    )
    assert res.status_code == 422


def test_owner_puede_restablecer_contrasena(client, monkeypatch):
    owner = make_profile(UserRole.owner)
    as_profile(owner)
    staff_id = uuid.uuid4()

    async def fake_reset(session, salon_id, sid):
        assert salon_id == owner.salon_id
        assert sid == staff_id
        return "otra-clave-temporal"

    monkeypatch.setattr(admin_service, "reset_staff_password", fake_reset)

    res = client.post(f"/api/v1/staff/{staff_id}/reset-password")
    assert res.status_code == 200
    assert res.json()["temporary_password"] == "otra-clave-temporal"


def test_staff_no_puede_restablecer_contrasena(client):
    as_profile(make_profile(UserRole.staff))

    res = client.post(f"/api/v1/staff/{uuid.uuid4()}/reset-password")
    assert res.status_code == 403
    assert res.json()["code"] == "permission_denied"


# --- capa de servicio: asignación de rol y mapeo de errores ---------------


class _FakeSession:
    """Sustituto mínimo de AsyncSession: solo lo que `invite_staff` usa."""

    def __init__(self, profile: Profile | None):
        self._profile = profile
        self.commit_calls = 0

    async def get(self, model, id_):
        return self._profile if self._profile and self._profile.id == id_ else None

    async def scalar(self, *args, **kwargs):
        """`_next_staff_color` cuenta staff existente: 0 alcanza para el test."""
        return 0

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, obj):
        pass


@pytest.mark.asyncio
async def test_invite_staff_asigna_el_rol_pedido(monkeypatch):
    user_id = uuid.uuid4()
    profile = Profile(
        id=user_id,
        salon_id=SALON_ID,
        role=UserRole.client,
        full_name="Nueva Staff",
        email="nueva@example.com",
    )

    async def fake_create_staff_user(email, full_name, salon_id, password):
        return {"id": str(user_id)}

    monkeypatch.setattr(supabase_admin, "create_staff_user", fake_create_staff_user)

    session = _FakeSession(profile)
    data = StaffInviteCreate(email="nueva@example.com", full_name="Nueva Staff", role="owner")

    result, temporary_password = await admin_service.invite_staff(session, SALON_ID, data)

    assert result.role == UserRole.owner
    assert session.commit_calls == 1
    assert len(temporary_password) == 12


@pytest.mark.asyncio
async def test_invite_staff_asigna_color_de_la_paleta_segun_orden(monkeypatch):
    """La paleta rota según cuántos owner/staff ya existen en el salón —
    debe coincidir con el backfill de la migración
    20260827100000_google_calendar_and_staff_color.sql."""
    user_id = uuid.uuid4()
    profile = Profile(
        id=user_id, salon_id=SALON_ID, role=UserRole.client, full_name="X", email="x@example.com"
    )

    async def fake_create_staff_user(email, full_name, salon_id, password):
        return {"id": str(user_id)}

    monkeypatch.setattr(supabase_admin, "create_staff_user", fake_create_staff_user)

    class _CountingSession(_FakeSession):
        def __init__(self, profile, existing_count):
            super().__init__(profile)
            self._existing_count = existing_count

        async def scalar(self, *args, **kwargs):
            return self._existing_count

    session = _CountingSession(profile, existing_count=2)
    data = StaffInviteCreate(email="x@example.com", full_name="X", role="staff")

    result, _temporary_password = await admin_service.invite_staff(session, SALON_ID, data)

    assert result.color == admin_service._STAFF_COLOR_PALETTE[2]


@pytest.mark.asyncio
async def test_invite_staff_propaga_conflicto_del_upstream(monkeypatch):
    async def fake_create_staff_user(email, full_name, salon_id, password):
        raise ConflictError(f"Ya existe una cuenta con el email {email}")

    monkeypatch.setattr(supabase_admin, "create_staff_user", fake_create_staff_user)

    session = _FakeSession(None)
    data = StaffInviteCreate(email="repetida@example.com", full_name="X", role="staff")

    with pytest.raises(ConflictError):
        await admin_service.invite_staff(session, SALON_ID, data)


@pytest.mark.asyncio
async def test_invite_staff_error_si_el_profile_no_aparece(monkeypatch):
    """Defensivo: si el trigger de alta fallara en crear el profile (o lo
    creara en otro salón), no debe asignarse el rol a ciegas."""

    async def fake_create_staff_user(email, full_name, salon_id, password):
        return {"id": str(uuid.uuid4())}

    monkeypatch.setattr(supabase_admin, "create_staff_user", fake_create_staff_user)

    session = _FakeSession(None)
    data = StaffInviteCreate(email="nueva@example.com", full_name="X", role="staff")

    with pytest.raises(UpstreamError):
        await admin_service.invite_staff(session, SALON_ID, data)


# --- capa de servicio: reset de contraseña --------------------------------


@pytest.mark.asyncio
async def test_reset_staff_password_genera_y_delega_al_upstream(monkeypatch):
    user_id = uuid.uuid4()
    profile = Profile(
        id=user_id, salon_id=SALON_ID, role=UserRole.staff, full_name="X", email="x@example.com"
    )

    calls = []

    async def fake_reset_password(uid, password):
        calls.append((uid, password))

    monkeypatch.setattr(supabase_admin, "reset_password", fake_reset_password)

    session = _FakeSession(profile)
    temporary_password = await admin_service.reset_staff_password(session, SALON_ID, user_id)

    assert len(temporary_password) == 12
    assert calls == [(user_id, temporary_password)]


@pytest.mark.asyncio
async def test_reset_staff_password_404_si_no_es_de_este_salon(monkeypatch):
    async def fake_reset_password(uid, password):
        raise AssertionError("no debería llamarse al upstream")

    monkeypatch.setattr(supabase_admin, "reset_password", fake_reset_password)

    session = _FakeSession(None)
    with pytest.raises(ResourceNotFound):
        await admin_service.reset_staff_password(session, SALON_ID, uuid.uuid4())

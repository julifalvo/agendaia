"""Tests de `GET /staff/{id}/services`.

Agregado junto con el fix de un bug real: el admin armaba el checklist de
"qué servicios hace cada profesional" invirtiendo `GET /services/{id}/staff`
(público) para cada servicio del salón — esa ruta 404 si el servicio está de
baja (`is_active=False`), lo que hacía fallar el `Promise.all` del frontend
y dejaba el checklist vacío en cada carga. Como el frontend arma el próximo
PUT a partir de lo que ve marcado, esto terminaba *borrando* asignaciones
previas en vez de solo agregar la nueva. Este endpoint reemplaza ese
workaround: lee `staff_services` directo, sin pasar por `Service.is_active`.

Mismo criterio en dos niveles que `test_admin_invite.py`:
  - Capa HTTP: autorización (owner y staff pueden ver; un client no).
  - Capa de servicio: `admin.get_staff_services` devuelve los ids tal cual
    están en `staff_services`, sin filtrar por servicios activos.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.db.models import Profile, UserRole
from app.db.session import get_session
from app.main import app
from app.services import admin as admin_service

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
        full_name="Perfil de prueba",
        email="perfil@example.com",
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


# --- capa HTTP: autorización -----------------------------------------------


def test_owner_puede_ver_los_servicios_de_un_profesional(client, monkeypatch):
    owner = make_profile(UserRole.owner)
    as_profile(owner)
    staff_id = uuid.uuid4()
    service_ids = [uuid.uuid4(), uuid.uuid4()]

    async def fake_get(session, salon_id, sid):
        assert salon_id == owner.salon_id
        assert sid == staff_id
        return service_ids

    monkeypatch.setattr(admin_service, "get_staff_services", fake_get)

    res = client.get(f"/api/v1/staff/{staff_id}/services")
    assert res.status_code == 200
    assert res.json() == [str(i) for i in service_ids]


def test_staff_tambien_puede_ver_los_servicios(client, monkeypatch):
    as_profile(make_profile(UserRole.staff))

    async def fake_get(session, salon_id, sid):
        return []

    monkeypatch.setattr(admin_service, "get_staff_services", fake_get)

    res = client.get(f"/api/v1/staff/{uuid.uuid4()}/services")
    assert res.status_code == 200


def test_client_no_puede_ver_los_servicios(client):
    as_profile(make_profile(UserRole.client))

    res = client.get(f"/api/v1/staff/{uuid.uuid4()}/services")
    assert res.status_code == 403


# --- capa de servicio: no depende de que el servicio esté activo ----------


class _FakeSession:
    def __init__(self, profile: Profile | None, service_ids: list[uuid.UUID]):
        self._profile = profile
        self._service_ids = service_ids

    async def get(self, model, id_):
        return self._profile if self._profile and self._profile.id == id_ else None

    async def scalars(self, *args, **kwargs):
        return self._service_ids


@pytest.mark.asyncio
async def test_get_staff_services_devuelve_los_ids_asignados():
    staff_id = uuid.uuid4()
    profile = Profile(
        id=staff_id,
        salon_id=SALON_ID,
        role=UserRole.staff,
        full_name="Valentina",
        email="valentina@example.com",
    )
    service_ids = [uuid.uuid4(), uuid.uuid4()]
    session = _FakeSession(profile, service_ids)

    result = await admin_service.get_staff_services(session, SALON_ID, staff_id)

    assert result == service_ids

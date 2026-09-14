"""Tests de `GET /admin/google-calendar/blocks`.

El título real de un evento sincronizado (`summary`) es personal de quien
conectó el calendario — ver `app/api/routes/google_calendar.py`. Estos tests
verifican que solo lo reciba quien tiene acceso completo o el propio
profesional al que está atribuido el bloqueo; al resto del staff les llega
el bloqueo sin texto (el frontend cae a un genérico).
"""

from __future__ import annotations

import datetime as dt
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.db.models import UserRole
from app.db.session import get_session
from app.main import app
from app.services import google_calendar as google_calendar_service

SALON_ID = uuid.uuid4()
OTHER_STAFF_ID = uuid.uuid4()


class _DummySession:
    async def execute(self, *args, **kwargs):
        return None


async def _fake_session():
    yield _DummySession()


def make_profile(role, salon_id=SALON_ID, **overrides):
    base = dict(
        id=uuid.uuid4(),
        salon_id=salon_id,
        role=role,
        full_name="Perfil de prueba",
        email="staff@example.com",
        phone=None,
        is_active=True,
        color=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def make_block(staff_id, summary="Psiquiatra"):
    now = dt.datetime.now(dt.UTC)
    return SimpleNamespace(
        id=uuid.uuid4(),
        staff_id=staff_id,
        summary=summary,
        starts_at=now,
        ends_at=now + dt.timedelta(hours=1),
    )


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


def test_owner_ve_el_summary_real(client, monkeypatch):
    owner = make_profile(UserRole.owner)
    as_profile(owner)

    async def fake_list_blocks(session, salon_id, date_from, date_to):
        return [make_block(staff_id=OTHER_STAFF_ID)]

    monkeypatch.setattr(google_calendar_service, "list_blocks", fake_list_blocks)

    res = client.get("/api/v1/admin/google-calendar/blocks")
    assert res.status_code == 200
    assert res.json()[0]["summary"] == "Psiquiatra"


def test_staff_no_ve_el_summary_de_un_bloqueo_ajeno(client, monkeypatch):
    staff = make_profile(UserRole.staff, email="otra@example.com")
    as_profile(staff)

    async def fake_list_blocks(session, salon_id, date_from, date_to):
        return [make_block(staff_id=OTHER_STAFF_ID)]

    monkeypatch.setattr(google_calendar_service, "list_blocks", fake_list_blocks)

    res = client.get("/api/v1/admin/google-calendar/blocks")
    assert res.status_code == 200
    body = res.json()[0]
    assert body["summary"] is None
    assert body["staff_id"] == str(OTHER_STAFF_ID)  # la franja sigue marcándose ocupada


def test_staff_ve_el_summary_de_su_propio_bloqueo(client, monkeypatch):
    staff = make_profile(UserRole.staff, email="otra@example.com")
    as_profile(staff)

    async def fake_list_blocks(session, salon_id, date_from, date_to):
        return [make_block(staff_id=staff.id)]

    monkeypatch.setattr(google_calendar_service, "list_blocks", fake_list_blocks)

    res = client.get("/api/v1/admin/google-calendar/blocks")
    assert res.status_code == 200
    assert res.json()[0]["summary"] == "Psiquiatra"


def test_staff_no_ve_el_summary_de_un_bloqueo_de_salon_entero(client, monkeypatch):
    """staff_id NULL (fallback defensivo, ver google_calendar.py) también se
    trata como ajeno para quien no tiene acceso completo."""
    staff = make_profile(UserRole.staff, email="otra@example.com")
    as_profile(staff)

    async def fake_list_blocks(session, salon_id, date_from, date_to):
        return [make_block(staff_id=None)]

    monkeypatch.setattr(google_calendar_service, "list_blocks", fake_list_blocks)

    res = client.get("/api/v1/admin/google-calendar/blocks")
    assert res.status_code == 200
    assert res.json()[0]["summary"] is None

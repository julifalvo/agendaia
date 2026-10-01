"""Tests de `POST /admin/google-calendar/internal/sync-all`.

No hay sesión de admin acá (lo llama un cron externo, GitHub Actions) — la
única protección es el header `X-Internal-Sync-Token` contra
`settings.internal_sync_token`. "vacío = deshabilitado" aplica igual que al
resto de la integración de Google: sin token configurado, el endpoint
rechaza cualquier pedido en vez de quedar abierto.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import get_session
from app.main import app
from app.services import google_calendar as google_calendar_service

SALON_ID = uuid.uuid4()
PATH = "/api/v1/admin/google-calendar/internal/sync-all"


class _DummySession:
    pass


async def _fake_session():
    yield _DummySession()


@pytest.fixture(autouse=True)
def _override_session():
    app.dependency_overrides[get_session] = _fake_session
    yield
    app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_sin_token_configurado_rechaza(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "internal_sync_token", "")
    res = client.post(PATH, headers={"X-Internal-Sync-Token": "lo-que-sea"})
    assert res.status_code == 401


def test_sin_header_rechaza(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "internal_sync_token", "el-secreto")
    res = client.post(PATH)
    assert res.status_code == 401


def test_token_incorrecto_rechaza(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "internal_sync_token", "el-secreto")
    res = client.post(PATH, headers={"X-Internal-Sync-Token": "otro"})
    assert res.status_code == 401


def test_token_correcto_dispara_sync_de_todos_los_salones(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "internal_sync_token", "el-secreto")

    async def fake_sync_all_connections(session):
        return {
            SALON_ID: google_calendar_service.SyncResult(
                connected=True, upserted=2, pruned=1
            )
        }

    monkeypatch.setattr(
        google_calendar_service, "sync_all_connections", fake_sync_all_connections
    )

    res = client.post(PATH, headers={"X-Internal-Sync-Token": "el-secreto"})
    assert res.status_code == 200
    body = res.json()
    assert body[str(SALON_ID)]["upserted"] == 2
    assert body[str(SALON_ID)]["pruned"] == 1

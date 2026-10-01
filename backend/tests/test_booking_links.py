"""Tests de `app/services/booking_links.py` — el HMAC del link público "ver
mi turno". Convención de "vacío = deshabilitado" de siempre: sin
`booking_link_secret`, no se genera token ni se valida ninguno.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.config import get_settings
from app.services import booking_links

APPOINTMENT_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
def _reset_secret(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "booking_link_secret", "")
    yield settings


def test_sin_secreto_no_genera_token(_reset_secret):
    assert booking_links.generate_token(APPOINTMENT_ID) is None


def test_sin_secreto_build_url_devuelve_none(_reset_secret):
    assert booking_links.build_url(APPOINTMENT_ID) is None


def test_sin_secreto_verify_siempre_falso(_reset_secret):
    assert booking_links.verify_token(APPOINTMENT_ID, "cualquier-cosa") is False


def test_con_secreto_genera_y_verifica_round_trip(_reset_secret, monkeypatch):
    monkeypatch.setattr(_reset_secret, "booking_link_secret", "un-secreto-de-test")
    token = booking_links.generate_token(APPOINTMENT_ID)
    assert token is not None
    assert booking_links.verify_token(APPOINTMENT_ID, token) is True


def test_token_de_otro_turno_no_sirve(_reset_secret, monkeypatch):
    monkeypatch.setattr(_reset_secret, "booking_link_secret", "un-secreto-de-test")
    token = booking_links.generate_token(APPOINTMENT_ID)
    assert booking_links.verify_token(uuid.uuid4(), token) is False


def test_token_vencido_al_rotar_el_secreto(_reset_secret, monkeypatch):
    monkeypatch.setattr(_reset_secret, "booking_link_secret", "secreto-viejo")
    token = booking_links.generate_token(APPOINTMENT_ID)
    monkeypatch.setattr(_reset_secret, "booking_link_secret", "secreto-nuevo")
    assert booking_links.verify_token(APPOINTMENT_ID, token) is False


def test_build_url_con_secreto_incluye_token_y_path(_reset_secret, monkeypatch):
    monkeypatch.setattr(_reset_secret, "booking_link_secret", "un-secreto-de-test")
    monkeypatch.setattr(_reset_secret, "frontend_base_url", "https://salon.example")
    url = booking_links.build_url(APPOINTMENT_ID)
    assert url is not None
    assert url.startswith(f"https://salon.example/mi-turno/{APPOINTMENT_ID}?t=")

"""Tests de `app/services/google_calendar.py`.

No pega a la red real de Google en ningún caso: se ejercitan solo los
caminos que no dependen de `httpx` (convención de "vacío = deshabilitado",
cifrado, inferencia de `staff_id` por tag) y el contrato de no-propagación
de push/pull cuando la integración no está configurada o no hay conexión —
que es lo único que realmente importa desde la óptica de "un problema con
Google nunca puede tumbar una reserva".
"""

from __future__ import annotations

import datetime as dt
import uuid
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.services import google_calendar

SALON_ID = uuid.uuid4()
STAFF_ID = uuid.uuid4()


class _NoTouchSession:
    """Cualquier acceso a esta sesión rompe el test: prueba que push/pull no
    tocan la sesión en absoluto cuando la integración está deshabilitada."""

    def __getattr__(self, name):
        raise AssertionError(f"no debería tocarse session.{name} sin configuración")


def make_appointment(**overrides):
    base = dict(
        id=uuid.uuid4(),
        salon_id=SALON_ID,
        guest_name="Julieta",
        google_event_id=None,
        start_time=dt.datetime(2026, 9, 1, 14, 0, tzinfo=dt.UTC),
        end_time=dt.datetime(2026, 9, 1, 15, 0, tzinfo=dt.UTC),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _reset_google_settings(monkeypatch):
    """Por default, ninguno de los tres settings está seteado — mismo estado
    que un despliegue sin credenciales de Google cargadas."""
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "")
    monkeypatch.setattr(settings, "google_client_secret", "")
    monkeypatch.setattr(settings, "google_calendar_token_key", "")
    yield settings


# --- convención "vacío = deshabilitado" -------------------------------------


def test_no_configurado_por_default(_reset_google_settings):
    assert google_calendar._is_configured() is False


def test_configurado_solo_si_las_tres_claves_estan(_reset_google_settings, monkeypatch):
    monkeypatch.setattr(_reset_google_settings, "google_client_id", "id")
    monkeypatch.setattr(_reset_google_settings, "google_client_secret", "secret")
    assert google_calendar._is_configured() is False  # falta la clave Fernet

    monkeypatch.setattr(_reset_google_settings, "google_calendar_token_key", "key")
    assert google_calendar._is_configured() is True


# --- cifrado del refresh_token -----------------------------------------------


def test_encrypt_decrypt_round_trip(_reset_google_settings, monkeypatch):
    monkeypatch.setattr(
        _reset_google_settings, "google_calendar_token_key", Fernet.generate_key().decode()
    )
    encrypted = google_calendar._encrypt("un-refresh-token-secreto")
    assert encrypted != "un-refresh-token-secreto"
    assert google_calendar._decrypt(encrypted) == "un-refresh-token-secreto"


# --- push: no-op sin configuración -------------------------------------------


@pytest.mark.asyncio
async def test_push_created_no_op_sin_configuracion():
    appointment = make_appointment()
    # No lanza y no toca la sesión: _NoTouchSession rompería el test si
    # push_appointment_created intentara usarla.
    await google_calendar.push_appointment_created(_NoTouchSession(), appointment, "Manicura")


@pytest.mark.asyncio
async def test_push_cancelled_no_op_sin_configuracion():
    appointment = make_appointment()
    await google_calendar.push_appointment_cancelled(_NoTouchSession(), appointment)


@pytest.mark.asyncio
async def test_push_updated_nunca_propaga_aunque_el_turno_este_incompleto():
    """Ni siquiera un turno con atributos faltantes puede tumbar el push:
    `_event_body` se llama de forma perezosa, dentro del try/except."""
    appointment = SimpleNamespace(id=uuid.uuid4(), salon_id=SALON_ID)  # sin start_time, etc.
    # Sigue no-op porque no está configurado; si lo estuviera, el error de
    # atributo faltante también quedaría atrapado (ver _push).
    await google_calendar.push_appointment_updated(_NoTouchSession(), appointment, "Manicura")


# --- pull: no-op sin configuración / sin conexión ----------------------------


@pytest.mark.asyncio
async def test_sync_no_configurado_devuelve_connected_false():
    result = await google_calendar.sync_incoming_events(
        _NoTouchSession(), SALON_ID, dt.datetime.now(dt.UTC), dt.datetime.now(dt.UTC)
    )
    assert result.connected is False
    assert result.upserted == 0


class _NoConnectionSession:
    async def get(self, model, id_):
        return None


@pytest.mark.asyncio
async def test_sync_sin_conexion_devuelve_connected_false(_reset_google_settings, monkeypatch):
    monkeypatch.setattr(_reset_google_settings, "google_client_id", "id")
    monkeypatch.setattr(_reset_google_settings, "google_client_secret", "secret")
    monkeypatch.setattr(
        _reset_google_settings, "google_calendar_token_key", Fernet.generate_key().decode()
    )

    result = await google_calendar.sync_incoming_events(
        _NoConnectionSession(), SALON_ID, dt.datetime.now(dt.UTC), dt.datetime.now(dt.UTC)
    )
    assert result.connected is False


# --- inferencia de staff_id por tag "[Nombre]" -------------------------------


def test_infer_staff_id_con_tag_matcheado():
    staff_by_name = {"valentina profesional": STAFF_ID}
    assert (
        google_calendar._infer_staff_id("[Valentina Profesional] vacaciones", staff_by_name)
        == STAFF_ID
    )


def test_infer_staff_id_sin_tag_bloquea_todo_el_salon():
    assert google_calendar._infer_staff_id("Feriado nacional", {"x": STAFF_ID}) is None


def test_infer_staff_id_con_tag_sin_match_bloquea_todo_el_salon():
    assert google_calendar._infer_staff_id("[Alguien Que No Existe] evento", {}) is None

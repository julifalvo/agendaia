"""Tests de `app/services/payments.py`: resolución por-salón del token de
Mercado Pago y del monto de seña, y el cifrado del token guardado.

No pega a la red real de Mercado Pago en ningún caso — eso ya lo cubre
`test_bookings.py` vía monkeypatch de `create_preference`/`get_payment`.
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from app.core.config import get_settings
from app.core.errors import BackendNotConfigured
from app.services import payments


def make_salon(**overrides):
    base = dict(
        booking_deposit_amount=None,
        mercadopago_access_token_encrypted=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _reset_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "google_calendar_token_key", "")
    monkeypatch.setattr(settings, "mercadopago_access_token", "")
    monkeypatch.setattr(settings, "booking_deposit_amount", Decimal("8500"))
    yield settings


# --- cifrado -----------------------------------------------------------------


def test_encrypt_decrypt_round_trip(_reset_settings, monkeypatch):
    monkeypatch.setattr(
        _reset_settings, "google_calendar_token_key", Fernet.generate_key().decode()
    )
    encrypted = payments.encrypt_access_token("APP_USR-un-token-secreto")
    assert encrypted != "APP_USR-un-token-secreto"
    assert payments._decrypt_access_token(encrypted) == "APP_USR-un-token-secreto"


def test_encrypt_sin_clave_configurada_avisa_con_error_de_dominio(_reset_settings):
    with pytest.raises(BackendNotConfigured):
        payments.encrypt_access_token("un-token")


# --- resolve_access_token: propio del salón > default global ----------------


def test_resolve_access_token_usa_el_propio_del_salon(_reset_settings, monkeypatch):
    monkeypatch.setattr(_reset_settings, "google_calendar_token_key", Fernet.generate_key().decode())
    monkeypatch.setattr(_reset_settings, "mercadopago_access_token", "token-global")

    encrypted = payments.encrypt_access_token("token-del-salon")
    salon = make_salon(mercadopago_access_token_encrypted=encrypted)

    assert payments.resolve_access_token(salon) == "token-del-salon"


def test_resolve_access_token_cae_al_default_global_si_el_salon_no_tiene(_reset_settings, monkeypatch):
    monkeypatch.setattr(_reset_settings, "mercadopago_access_token", "token-global")
    salon = make_salon()

    assert payments.resolve_access_token(salon) == "token-global"


def test_resolve_access_token_none_si_no_hay_ni_salon_ni_default():
    assert payments.resolve_access_token(None) is None
    assert payments.resolve_access_token(make_salon()) is None


# --- resolve_deposit_amount: propio del salón > default global --------------


def test_resolve_deposit_amount_usa_el_propio_del_salon(_reset_settings):
    salon = make_salon(booking_deposit_amount=Decimal("12000"))
    assert payments.resolve_deposit_amount(salon) == Decimal("12000")


def test_resolve_deposit_amount_cae_al_default_global(_reset_settings):
    assert payments.resolve_deposit_amount(make_salon()) == Decimal("8500")
    assert payments.resolve_deposit_amount(None) == Decimal("8500")


# --- _validate_token ----------------------------------------------------------


def test_validate_token_none_o_vacio_avisa_no_configurado():
    with pytest.raises(payments.MercadoPagoNotConfigured):
        payments._validate_token(None)
    with pytest.raises(payments.MercadoPagoNotConfigured):
        payments._validate_token("")


def test_validate_token_devuelve_el_token_si_hay():
    assert payments._validate_token("un-token") == "un-token"

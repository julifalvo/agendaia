import datetime as dt
import uuid
from types import SimpleNamespace

from app.services.calendar import build_booking_ics

START = dt.datetime(2026, 9, 1, 14, 0, tzinfo=dt.timezone(dt.timedelta(hours=-3)))
END = dt.datetime(2026, 9, 1, 15, 0, tzinfo=dt.timezone(dt.timedelta(hours=-3)))


def make_appointment(**overrides):
    base = dict(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        guest_name="Julieta, Pérez",
        guest_email="julieta@example.com",
        start_time=START,
        end_time=END,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_convierte_horario_local_a_utc():
    ics = build_booking_ics(
        make_appointment(), "Esculpidas", "turnos@mcnailsstudio.com", "MC Nails Studio"
    )

    assert "DTSTART:20260901T170000Z" in ics
    assert "DTEND:20260901T180000Z" in ics


def test_escapa_comas_en_el_nombre_del_invitado():
    ics = build_booking_ics(
        make_appointment(), "Esculpidas", "turnos@mcnailsstudio.com", "MC Nails Studio"
    )

    assert "ATTENDEE;CN=Julieta\\, Pérez;RSVP=FALSE:mailto:julieta@example.com" in ics


def test_usa_method_request_para_que_el_cliente_de_mail_ofrezca_agendarlo():
    ics = build_booking_ics(
        make_appointment(), "Esculpidas", "turnos@mcnailsstudio.com", "MC Nails Studio"
    )

    assert "METHOD:REQUEST" in ics
    assert f"UID:{'11111111-1111-1111-1111-111111111111'}@agendaia" in ics

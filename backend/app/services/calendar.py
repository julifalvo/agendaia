"""Arma el .ics adjunto al mail de confirmación (ver app/services/email.py).

Usa METHOD:REQUEST + ORGANIZER/ATTENDEE (no METHOD:PUBLISH) a propósito:
es lo que hace que Gmail/Outlook lo reconozcan como una invitación real y
ofrezcan sumarlo al calendario solos, en vez de mostrarlo como un adjunto
suelto que hay que abrir a mano.
"""

from __future__ import annotations

import datetime as dt

from app.db.models import Appointment


def _ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _ics_date(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).strftime("%Y%m%dT%H%M%SZ")


def build_booking_ics(
    appointment: Appointment, service_name: str, organizer_email: str, salon_name: str
) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AgendaIA//Turnos//ES",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{appointment.id}@agendaia",
        f"DTSTAMP:{_ics_date(dt.datetime.now(dt.UTC))}",
        f"DTSTART:{_ics_date(appointment.start_time)}",
        f"DTEND:{_ics_date(appointment.end_time)}",
        f"SUMMARY:{_ics_escape(f'{service_name} — {salon_name}')}",
        f"DESCRIPTION:{_ics_escape(f'Tu turno en {salon_name}.')}",
        f"ORGANIZER;CN={_ics_escape(salon_name)}:mailto:{organizer_email}",
        f"ATTENDEE;CN={_ics_escape(appointment.guest_name or 'Cliente')};RSVP=FALSE:"
        f"mailto:{appointment.guest_email}",
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(lines)

"""Errores de dominio del motor de reservas.

Se traducen a respuestas HTTP en `app.main`. La capa de servicio nunca importa
FastAPI: así el motor se puede testear y reutilizar desde un worker o un script.
"""


class BookingError(Exception):
    """Base de todos los errores de negocio."""

    status_code = 400
    code = "booking_error"

    def __init__(self, message: str, **context):
        super().__init__(message)
        self.message = message
        self.context = context


class SlotUnavailable(BookingError):
    """El horario ya no está libre. Típicamente por una carrera con otra reserva."""

    status_code = 409
    code = "slot_unavailable"


class OutsideWorkingHours(BookingError):
    status_code = 422
    code = "outside_working_hours"


class InvalidBookingWindow(BookingError):
    """Demasiado pronto (lead time) o demasiado lejos en el futuro."""

    status_code = 422
    code = "invalid_booking_window"


class StaffCannotPerformService(BookingError):
    status_code = 422
    code = "staff_cannot_perform_service"


class ResourceNotFound(BookingError):
    status_code = 404
    code = "not_found"


class PermissionDenied(BookingError):
    status_code = 403
    code = "permission_denied"


class NotAuthenticated(BookingError):
    status_code = 401
    code = "not_authenticated"


class InvalidStateTransition(BookingError):
    status_code = 409
    code = "invalid_state_transition"


class ConflictError(BookingError):
    """Conflicto genérico (ej. bloques de horario que se superponen)."""

    status_code = 409
    code = "conflict"


class UpstreamError(BookingError):
    """Falló un servicio externo del que dependemos (ej. Admin API de
    Supabase Auth). No es error del cliente ni de nuestra base."""

    status_code = 502
    code = "upstream_error"

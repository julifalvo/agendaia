from decimal import Decimal
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Conexión directa a Postgres de Supabase (Connection string > Session pooler).
    # El backend usa el rol de servicio: bypassea RLS, así que toda autorización
    # que dependa del usuario se hace explícitamente en la capa de servicio.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres"

    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_jwt_secret: str = ""

    # Mercado Pago (Checkout Pro) para la seña de la reserva. Ver
    # app/services/payments.py.
    mercadopago_access_token: str = ""
    booking_deposit_amount: Decimal = Decimal("8500")
    #: Dominio público del frontend, usado para armar los back_urls a los que
    #: Mercado Pago redirige al cliente después de pagar.
    frontend_base_url: str = "http://localhost:5173"
    #: Dominio público de este backend, usado como notification_url del
    #: webhook. Debe ser accesible desde internet (no localhost) para que
    #: Mercado Pago pueda avisar el pago.
    backend_public_url: str = "http://localhost:8000"

    # Mail de confirmación con el turno adjunto (.ics), vía Resend. Ver
    # app/services/email.py. Vacío = no-op (mismo criterio que Mercado Pago).
    resend_api_key: str = ""
    #: Remitente. "onboarding@resend.dev" funciona sin verificar dominio
    #: propio — sirve para arrancar, pero mientras no se verifique un
    #: dominio propio, Resend solo entrega al mail con el que se creó la
    #: cuenta (no a las clientas ni, salvo que coincida, a la profesional).
    resend_from_email: str = "onboarding@resend.dev"

    # Google Calendar (OAuth) — sync bidireccional del calendario del salón,
    # una sola cuenta de Google por salón (no una por profesional). Vacío =
    # feature deshabilitada, mismo criterio que Mercado Pago/Resend.
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = (
        "http://localhost:8000/api/v1/admin/google-calendar/callback"
    )
    #: Clave Fernet (`Fernet.generate_key()`, 32 bytes url-safe base64) para
    #: cifrar el refresh_token antes de guardarlo. Vacía = feature deshabilitada.
    google_calendar_token_key: str = ""
    #: Secreto compartido para disparar la sincronización periódica desde un
    #: cron externo (GitHub Actions) sin sesión de admin — ver
    #: POST /admin/google-calendar/internal/sync-all. Vacío = endpoint
    #: deshabilitado (devuelve 503), mismo criterio que el resto de la
    #: integración.
    internal_sync_token: str = ""

    #: Secreto para firmar el link público "ver mi turno" (HMAC sobre el id
    #: del turno) que viaja en el mail de confirmación — ver
    #: app/services/booking_links.py. Propio y sin relación con
    #: google_calendar_token_key: rotar uno no debe invalidar el otro. Vacío
    #: = no se manda el link en el mail y el endpoint público rechaza todo.
    booking_link_secret: str = ""

    #: Emails con visibilidad total de la agenda del salón (ven los turnos de
    #: todo el staff, no solo los propios), sin importar su rol. El resto de
    #: los perfiles con rol staff solo ve su propia agenda. Separados por
    #: coma.
    full_calendar_access_emails: str = (
        "marticarballo2711@gmail.com,julianfalvo@gmail.com"
    )

    db_echo: bool = False
    cors_origins: list[str] = ["http://localhost:5173"]

    def full_calendar_access_email_set(self) -> frozenset[str]:
        return frozenset(
            email.strip().lower()
            for email in self.full_calendar_access_emails.split(",")
            if email.strip()
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()

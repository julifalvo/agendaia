import logging

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes import admin as admin_routes
from app.api.routes import bookings as bookings_routes
from app.api.routes import google_calendar as google_calendar_routes
from app.api.routes import me as me_routes
from app.api.routes import webhooks as webhooks_routes
from app.core.config import get_settings
from app.core.errors import BookingError
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.db.session import get_session

configure_logging()
logger = logging.getLogger("app")

settings = get_settings()

app = FastAPI(
    title="MC Nails Studio — API de Reservas",
    version="0.1.0",
    description=(
        "Motor de reservas con garantía de no double-booking a nivel de base de datos."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Agregado después de CORS a propósito: en Starlette el último middleware
# agregado queda más afuera, así que este es el primero en ver cada request
# (y el último en verlo salir) — captura la duración real de punta a punta.
app.add_middleware(RequestContextMiddleware)


@app.exception_handler(BookingError)
async def booking_error_handler(_: Request, exc: BookingError) -> JSONResponse:
    """Traduce errores de dominio a respuestas HTTP con código estable."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message, "context": exc.context},
    )


@app.get("/health", tags=["infra"])
async def health(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Liveness + conectividad real a Postgres.

    Un `/health` que solo devuelve `{"status": "ok"}` sin tocar la base miente
    justo en el escenario que más importa detectar: la app está arriba pero
    no puede hablar con la base (credenciales vencidas, pooler caído, etc).
    """
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health_check_failed")
        raise HTTPException(status_code=503, detail="database unavailable") from None
    return {"status": "ok"}


app.include_router(bookings_routes.router, prefix="/api/v1")
app.include_router(admin_routes.router, prefix="/api/v1")
app.include_router(google_calendar_routes.router, prefix="/api/v1")
app.include_router(me_routes.router, prefix="/api/v1")
app.include_router(webhooks_routes.router, prefix="/api/v1")

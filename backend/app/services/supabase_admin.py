"""Cliente delgado de la Admin API de Supabase Auth (GoTrue).

Usado exclusivamente para dar de alta owners/staff
(`POST /auth/v1/admin/users`): crea el usuario en `auth.users` ya con una
contraseña temporal y el mail marcado como confirmado, sin mandar ningún
mail. El trigger `on_auth_user_created` corre síncrono dentro de esa misma
request de GoTrue, así que cuando esta función vuelve con éxito el `profile`
correspondiente ya existe (con `role = 'client'` — ver
`supabase/migrations/20260814120000_harden_profile_writes.sql`; el rol real
se asigna después con un UPDATE de confianza en `services.admin.invite_staff`).

Sin lógica de negocio acá a propósito, mismo criterio que
`services/notifications.py`.
"""

from __future__ import annotations

import uuid

import httpx

from app.core.config import get_settings
from app.core.errors import ConflictError, UpstreamError

_TIMEOUT_SECONDS = 10.0


async def create_staff_user(
    email: str, full_name: str, salon_id: uuid.UUID, password: str
) -> dict:
    """Crea el usuario con `password` de una y el mail ya confirmado — no
    dispara ningún envío. La dueña le pasa esa contraseña temporal al staff a
    mano (WhatsApp, en persona); `must_change_password` en el metadata fuerza
    el cambio en el primer login (ver `AdminLayout` del lado del frontend)."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_KEY no están configurados en el backend"
        )

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users"
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
    }
    # `role` deliberadamente no va en el metadata: el trigger de alta lo
    # ignora y fuerza 'client'. El rol real lo asigna el caller después.
    body = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {
            "full_name": full_name,
            "salon_id": str(salon_id),
            "must_change_password": True,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise UpstreamError(
            "No se pudo contactar el servicio de autenticación"
        ) from exc

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = str(payload.get("msg") or payload.get("message") or payload)
        if response.status_code in (400, 409, 422) and "already" in detail.lower():
            raise ConflictError(f"Ya existe una cuenta con el email {email}")
        raise UpstreamError(
            "El servicio de autenticación rechazó el alta del usuario", detail=detail
        )

    return response.json()


async def delete_user(user_id: uuid.UUID) -> None:
    """Borra el usuario en Supabase Auth (`DELETE /auth/v1/admin/users/{id}`).

    `profiles.id` referencia `auth.users.id` con `ON DELETE CASCADE`, así que
    esto se lleva puesto el profile y, en cascada, `staff_services`,
    `staff_schedule_dates` y `time_off` de ese profesional — sin necesidad de
    borrarlos a mano desde acá.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_KEY no están configurados en el backend"
        )

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}"
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.delete(url, headers=headers)
    except httpx.HTTPError as exc:
        raise UpstreamError(
            "No se pudo contactar el servicio de autenticación"
        ) from exc

    if response.status_code >= 400 and response.status_code != 404:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = str(payload.get("msg") or payload.get("message") or payload)
        raise UpstreamError(
            "El servicio de autenticación rechazó el borrado del usuario",
            detail=detail,
        )


async def reset_password(user_id: uuid.UUID, password: str) -> None:
    """Pisa la contraseña de un usuario ya existente con una temporal nueva
    (`PUT /auth/v1/admin/users/{id}`) y marca `must_change_password` para que
    tenga que cambiarla en el próximo login — mismo criterio que el alta.

    Usado tanto para el botón "Restablecer contraseña" del panel como para
    las cuentas de staff que quedaron a mitad de camino con el viejo flujo de
    invitación por mail (creadas, pero sin contraseña utilizable porque nunca
    llegaron a abrir el link).

    Se lee el usuario primero para mergear `user_metadata` a mano: la Admin
    API de GoTrue no garantiza un merge parcial, y pisarlo entero borraría
    `full_name`/`salon_id` de cuentas viejas.
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_KEY no están configurados en el backend"
        )

    base_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}"
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            current = await client.get(base_url, headers=headers)
            if current.status_code >= 400:
                raise UpstreamError(
                    "No se pudo leer el usuario antes de restablecer la contraseña",
                    detail=current.text,
                )
            metadata = dict(current.json().get("user_metadata") or {})
            metadata["must_change_password"] = True

            response = await client.put(
                base_url,
                json={"password": password, "user_metadata": metadata},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise UpstreamError(
            "No se pudo contactar el servicio de autenticación"
        ) from exc

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = str(payload.get("msg") or payload.get("message") or payload)
        raise UpstreamError(
            "El servicio de autenticación rechazó el restablecimiento de contraseña",
            detail=detail,
        )

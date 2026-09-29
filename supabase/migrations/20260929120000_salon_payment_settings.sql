-- =============================================================================
-- Seña y Mercado Pago por salón, editables desde el panel de administración.
-- Antes eran env vars globales del backend (BOOKING_DEPOSIT_AMOUNT,
-- MERCADOPAGO_ACCESS_TOKEN): un solo monto y un solo token para todos los
-- salones de este backend, sin forma de que cada dueña lo cambie por su
-- cuenta. Ver TODO.md ("MERCADOPAGO_ACCESS_TOKEN sigue siendo una sola
-- variable global") y app/services/payments.py.
-- =============================================================================

alter table public.salons add column booking_deposit_amount numeric(10, 2);
alter table public.salons add column mercadopago_access_token_encrypted text;

comment on column public.salons.booking_deposit_amount is
  'Monto de la seña para reservar un turno en este salón. NULL = usa el default global del backend (Settings.booking_deposit_amount), pensado solo como fallback antes de que el owner lo configure desde el panel.';
comment on column public.salons.mercadopago_access_token_encrypted is
  'Access token de Mercado Pago (Checkout Pro) de este salón, cifrado con Fernet antes de guardarse (mismo criterio que google_calendar_connections.refresh_token_encrypted) — ver app/services/payments.py. NULL = usa el default global del backend (Settings.mercadopago_access_token) si existe, o la feature queda deshabilitada para este salón.';

-- Backfill: el monto que hoy está fijo para cualquier salón existente, así
-- ninguno cambia de comportamiento con este deploy.
update public.salons set booking_deposit_amount = 8500 where booking_deposit_amount is null;

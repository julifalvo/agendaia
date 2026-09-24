-- =============================================================================
-- Webhook de notificaciones (WhatsApp/Email vía Zapier/Make/n8n) por salón.
-- Antes era NOTIFICATIONS_WEBHOOK_URL, una sola variable de entorno global:
-- CADA turno de CUALQUIER salón (con nombre/teléfono de la clienta incluidos)
-- se mandaba al mismo webhook. Con un segundo salón eso significa que los
-- datos de sus clientas terminan en el Zapier/WhatsApp de otro salón — ver
-- app/services/notifications.py.
-- =============================================================================

alter table public.salons add column notifications_webhook_url text;

comment on column public.salons.notifications_webhook_url is
  'Webhook (Zapier/Make/n8n) que recibe cada evento de turno de ESTE salón (nombre/teléfono de clienta incluidos). NULL = no se manda notificación, nunca cae al webhook de otro salón.';

-- Backfill del salón existente con lo que hoy está en la variable de entorno
-- NOTIFICATIONS_WEBHOOK_URL — reemplazar <URL_ACTUAL> por el valor real antes
-- de correr esto (ver el valor configurado hoy en Render), o dejarlo sin
-- correr y cargarlo a mano si preferís verificarlo primero.
-- update public.salons
-- set notifications_webhook_url = '<URL_ACTUAL>'
-- where name = 'MC Nails Studio';

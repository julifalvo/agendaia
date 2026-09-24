-- =============================================================================
-- Datos de transferencia (alias/CVU/titular) por salón. Estaban hardcodeados
-- en el frontend (BookingFlow.tsx) con los datos bancarios personales de la
-- dueña de MC Nails Studio — cualquier otro salón que se sumara le iba a
-- mostrar a sus clientas los datos bancarios de OTRA persona. Ver discusión
-- de onboarding multi-tenant.
-- =============================================================================

alter table public.salons add column transfer_alias text;
alter table public.salons add column transfer_cvu text;
alter table public.salons add column transfer_account_name text;

comment on column public.salons.transfer_alias is
  'Alias de transferencia para pagar la seña. NULL = el frontend no puede ofrecer pago por transferencia (mostrar aviso de contactar al salón en vez de datos vacíos/ajenos).';
comment on column public.salons.transfer_cvu is
  'CVU de la cuenta que recibe la seña.';
comment on column public.salons.transfer_account_name is
  'Nombre del titular de la cuenta, tal cual se muestra a la clienta.';

-- Backfill del salón existente con lo que hoy está hardcodeado en el
-- frontend. Matchea por `name` porque no hay seed en este repo con el id
-- real de producción (se cargó a mano, ver DEPLOYMENT.md) — VERIFICAR que
-- el `name` del salón en producción sea exactamente 'MC Nails Studio' antes
-- de aplicar; si no matchea ninguna fila, correr el UPDATE a mano con el
-- salon_id correcto.
update public.salons
set transfer_alias = 'martu.manicura',
    transfer_cvu = '0000003100008080724270',
    transfer_account_name = 'Martina Yael Carballo'
where name = 'MC Nails Studio';

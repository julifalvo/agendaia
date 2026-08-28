-- =============================================================================
-- Color por profesional + integración con Google Calendar (sync bidireccional,
-- una sola cuenta de Google por salón).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles.color — color del profesional en el calendario admin. Se asigna en
-- código (app/services/admin._next_staff_color) al invitar staff, no acá: la
-- paleta vive en un solo lugar. Nullable a propósito (role=client no tiene
-- color, y no hay riesgo de INSERT roto por NULL porque no es NOT NULL).
-- -----------------------------------------------------------------------------
alter table public.profiles add column color text;

comment on column public.profiles.color is
  'Color hex (#RRGGBB) del profesional en el calendario. NULL para role=client. Se asigna en app/services/admin.invite_staff por rotación de paleta (_STAFF_COLOR_PALETTE) — la paleta vive en un solo lugar (el código), este backfill solo replica los mismos valores para las filas ya existentes.';

with ranked as (
  select id, row_number() over (partition by salon_id order by created_at) - 1 as rn
  from public.profiles
  where role in ('owner', 'staff') and color is null
)
update public.profiles p
set color = (array[
  '#F2B8C6', '#B8C6F2', '#C6F2B8', '#F2E1B8',
  '#B8F2E1', '#E1B8F2', '#F2B8E1', '#C6B8F2'
])[(ranked.rn % 8) + 1]
from ranked
where p.id = ranked.id;

-- -----------------------------------------------------------------------------
-- google_calendar_connections — conexión OAuth única por salón a una cuenta de
-- Google compartida (no una por profesional). PK = salon_id fuerza que exista
-- a lo sumo una fila por salón. Sin access_token/expires_at: el access token
-- se vuelve a pedir con el refresh_token en cada uso (evita bugs de "¿sigue
-- vigente el token cacheado?"), a costa de una llamada extra por sync/push —
-- aceptable porque todo esto es on-demand y de bajo volumen.
-- -----------------------------------------------------------------------------
create table public.google_calendar_connections (
  salon_id                uuid primary key references public.salons (id) on delete cascade,
  calendar_id             text not null default 'primary',
  refresh_token_encrypted text not null,
  connected_by            uuid references public.profiles (id) on delete set null,
  connected_at            timestamptz not null default now(),
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.google_calendar_connections is
  'Conexión OAuth única por salón a una cuenta de Google compartida. PK=salon_id fuerza que exista a lo sumo una fila por salón.';
comment on column public.google_calendar_connections.refresh_token_encrypted is
  'Cifrado con Fernet (settings.google_calendar_token_key) antes de guardar — nunca en texto plano.';

create trigger google_calendar_connections_touch_updated_at
  before update on public.google_calendar_connections
  for each row execute function public.touch_updated_at();

-- Sin RLS/policies a propósito: guarda un secreto (refresh token) y solo lo
-- toca el backend con service_role, igual que idempotency_keys.

-- -----------------------------------------------------------------------------
-- appointments.google_event_id — id del evento en Google Calendar si se pudo
-- empujar (push best-effort). NULL si Google no está conectado o el push
-- falló. Se usa para actualizar/borrar el evento al reprogramar/cancelar.
-- -----------------------------------------------------------------------------
alter table public.appointments add column google_event_id text;

create unique index appointments_google_event_id_key
  on public.appointments (google_event_id) where google_event_id is not null;

comment on column public.appointments.google_event_id is
  'id del evento en Google Calendar si se pudo empujar (push best-effort); NULL si Google no está conectado o el push falló.';

-- -----------------------------------------------------------------------------
-- google_calendar_blocks — eventos creados directamente en el Google Calendar
-- conectado (no por esta app), tratados como agenda ocupada. Espejo de
-- salon_closures + staff_id nullable: NULL bloquea todo el salón (como
-- salon_closures), con valor bloquea solo a ese profesional. Se infiere de un
-- tag opcional "[Nombre]" al inicio del título del evento en Google — ver
-- app/services/google_calendar.py. Sincronizado on-demand ("Sincronizar
-- ahora" / al abrir el calendario admin), no hay cron en este proyecto.
-- -----------------------------------------------------------------------------
create table public.google_calendar_blocks (
  id              uuid primary key default gen_random_uuid(),
  salon_id        uuid not null references public.salons (id) on delete cascade,
  google_event_id text not null,
  staff_id        uuid,
  summary         text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  period tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,

  constraint google_calendar_blocks_order_check check (ends_at > starts_at),
  constraint google_calendar_blocks_staff_fk foreign key (staff_id, salon_id)
    references public.profiles (id, salon_id) on delete cascade,
  -- Dedupe/prune en cada re-sync: una fila por evento de Google.
  constraint google_calendar_blocks_salon_event_key unique (salon_id, google_event_id)
);

comment on table public.google_calendar_blocks is
  'Eventos creados directamente en el Google Calendar conectado (no por esta app), tratados como agenda ocupada. staff_id NULL = bloquea todo el salón; con valor = bloquea solo a ese profesional.';

create trigger google_calendar_blocks_touch_updated_at
  before update on public.google_calendar_blocks
  for each row execute function public.touch_updated_at();

create index google_calendar_blocks_period_idx on public.google_calendar_blocks using gist (period);
create index google_calendar_blocks_staff_idx on public.google_calendar_blocks (staff_id);

alter table public.google_calendar_blocks enable row level security;

create policy google_calendar_blocks_read on public.google_calendar_blocks
  for select using (true);

-- Sin policy de escritura: solo el backend (service_role) escribe acá, igual
-- que el resto de la sincronización con Google.

-- =============================================================================
-- Categorías de servicios — sectorización del catálogo (peluquería, uñas, etc.)
-- =============================================================================
create table public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint service_categories_salon_name_key unique (salon_id, name),
  constraint service_categories_id_salon_key   unique (id, salon_id)
);

create index service_categories_salon_idx on public.service_categories (salon_id, sort_order);

create trigger service_categories_touch_updated_at before update on public.service_categories
  for each row execute function public.touch_updated_at();

alter table public.services
  add column category_id uuid;

-- FK compuesta (igual criterio que staff_services/appointments): impide que un
-- servicio de un salón apunte a una categoría de otro. `set null (category_id)`
-- (sintaxis de PG15+) es necesario porque el borrado de una categoría no puede
-- tocar `services.salon_id`, que es not null.
alter table public.services
  add constraint services_category_fk foreign key (category_id, salon_id)
    references public.service_categories (id, salon_id) on delete set null (category_id);

create index services_category_idx on public.services (category_id);

-- -----------------------------------------------------------------------------
-- RLS: mismo criterio que services (lectura pública, escritura solo owner).
-- -----------------------------------------------------------------------------
alter table public.service_categories enable row level security;

create policy service_categories_public_read on public.service_categories
  for select using (true);

create policy service_categories_owner_write on public.service_categories
  for all
  using (salon_id = public.current_salon_id() and public.current_role_is(array['owner']::public.user_role[]))
  with check (salon_id = public.current_salon_id() and public.current_role_is(array['owner']::public.user_role[]));

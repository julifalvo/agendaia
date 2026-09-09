-- =============================================================================
-- Orden manual de servicios dentro de su categoría (mismo criterio que
-- service_categories.sort_order).
-- =============================================================================
alter table public.services
  add column sort_order integer not null default 0;

-- Backfill: preserva el orden alfabético actual como punto de partida, para
-- que activar esta columna no reordene visualmente nada hasta que el admin
-- mueva algo a mano.
with ranked as (
  select id, row_number() over (
    partition by salon_id, category_id order by name
  ) - 1 as rn
  from public.services
)
update public.services s
set sort_order = ranked.rn
from ranked
where ranked.id = s.id;

create index services_sort_idx on public.services (salon_id, category_id, sort_order);

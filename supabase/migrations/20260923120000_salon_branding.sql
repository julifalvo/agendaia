-- =============================================================================
-- Personalización visual por salón: theme_color + logo_url. Permite que cada
-- salón se vea distinto (color de marca, logo propio) sobre el mismo
-- frontend compartido, sin forkear código por cliente — ver
-- app/services/availability.load_salon y el endpoint público GET
-- /salons/{salon_id} en app/api/routes/bookings.py.
-- =============================================================================

alter table public.salons add column theme_color text;
alter table public.salons add column logo_url text;

comment on column public.salons.theme_color is
  'Color de marca del salón en hex (#RRGGBB), ej. "#FF6FA0". NULL = usa la paleta candy-pink por defecto del frontend.';
comment on column public.salons.logo_url is
  'URL pública del logo del salón. NULL = el frontend usa el lockup de marca por defecto (Logo/Wordmark).';

alter table public.salons add constraint salons_theme_color_format
  check (theme_color is null or theme_color ~ '^#[0-9A-Fa-f]{6}$');

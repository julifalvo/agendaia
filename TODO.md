# TODO — Onboarding del segundo salón (nueva estética)

Estado al cerrar la sesión: todos los cambios de código están hechos y
testeados localmente (121 tests backend, tsc + vitest + build frontend en
verde), pero **nada está commiteado ni pusheado**. Los archivos siguen en el
working directory — no se pierden al apagar la PC, pero conviene commitear
localmente antes de cerrar (sin pushear) para tener un snapshot.

## Antes de pushear nada a producción (orden importa)

- [ ] **Verificar en Supabase que `salons.name` de Martina sea exactamente
      `'MC Nails Studio'`** — el backfill de la migración de transferencia
      matchea por ese string. Si no coincide, ajustar el `UPDATE` con su
      `salon_id` real antes de correr la migración.
- [ ] **Completar el backfill del webhook de notificaciones.** En
      `supabase/migrations/20260923140000_salon_notifications_webhook.sql`
      quedó comentado a propósito — copiar el valor actual de
      `NOTIFICATIONS_WEBHOOK_URL` desde Render (Environment) y pegarlo ahí
      antes de correr la migración. Si se corre sin esto, Martina deja de
      recibir avisos de turnos nuevos por WhatsApp/Zapier, en silencio.
- [ ] Correr las 3 migraciones nuevas en Supabase, en orden:
  1. `20260923120000_salon_branding.sql` (theme_color, logo_url)
  2. `20260923130000_salon_transfer_details.sql` (transfer_alias/cvu/account_name — con backfill de Martina)
  3. `20260923140000_salon_notifications_webhook.sql` (notifications_webhook_url — con backfill completado)
- [ ] **Recién después** pushear el backend (Render) — si se pushea antes de
      correr las migraciones, el sitio entero de Martina se rompe (columnas
      que el ORM espera y no existen todavía).
- [ ] Por último, el frontend — si se pushea antes de que el backend tenga
      el endpoint `/salons/{id}` nuevo, el sitio muestra "Consultá al salón
      cómo abonar la seña" en vez de los datos reales de Martina.

## Google Cloud — antes de conectar el calendario de la nueva estética

- [ ] Crear proyecto nuevo en Google Cloud, con una cuenta que controle el
      negocio (no `marticarballo2711@gmail.com`, idealmente no un Gmail
      personal tampoco).
- [ ] Configurar OAuth consent screen: nombre "AgendaIA" (no "MC Nails
      Studio"), scope `.../auth/calendar`.
- [ ] Crear credenciales OAuth 2.0 (Web application) con el mismo
      `GOOGLE_REDIRECT_URI` que ya está en Render.
- [ ] Actualizar `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` en Render.
- [ ] Agregar como test users (mientras la app esté en modo Testing): el
      Gmail de Martina y el de la dueña de la nueva estética.
- [ ] Avisarle a Martina que tiene que reconectar su Google Calendar una vez
      (Desconectar → Conectar en el panel, 2 clicks) — su `refresh_token`
      viejo no sirve con el Client ID nuevo.

## Para dar de alta a la nueva estética (una vez lo anterior esté resuelto)

- [ ] Insertar su fila en `salons`: nombre, slug, timezone, políticas, y sus
      propios `transfer_alias` / `transfer_cvu` / `transfer_account_name`
      (sin esto no puede cobrar seña) y `notifications_webhook_url` si
      quiere avisos.
- [ ] Opcional: `theme_color` / `logo_url` si quiere identidad visual propia.
- [ ] Alta manual del primer owner (signup normal + `UPDATE profiles set
      role='owner'`, ver `DEPLOYMENT.md`).
- [ ] Sitio nuevo en Netlify con su propio `VITE_SALON_ID`.

## No bloqueante para arrancar, pero pendiente

- [ ] Comprar el dominio propio (`agendaia.com` o `.com.ar`) — hoy no hay
      ninguno comprado. Lo necesita Resend (sigue en sandbox: ningún mail
      real le llega a ninguna clienta de ningún salón) y eventualmente la
      verificación de Google OAuth.
- [ ] Verificar el dominio en Resend una vez comprado.
- [x] ~~`PrivacyPolicy.tsx` y `TermsOfService.tsx` siguen diciendo "MC Nails
      Studio" hardcodeado~~ y ~~footer de `PublicSite.tsx:215`~~ —
      **resuelto (2026-09-29)**: los tres ahora usan `salon?.name` de
      `useSalon()`, con un fallback genérico ("Este salón" / "AgendaIA")
      mientras la sesión todavía no cargó. El handle de Instagram
      (`@mcstudiodebelleza`, en las dos páginas legales y en el footer)
      sigue hardcodeado — no hay un campo de contacto social por salón en
      `salons` todavía; queda pendiente si se necesita para el reskin
      liviano de un cliente nuevo.
- [x] ~~`MERCADOPAGO_ACCESS_TOKEN` sigue siendo una sola variable global~~ —
      **resuelto (2026-09-29)**: `salons.mercadopago_access_token_encrypted`
      (cifrado con Fernet, misma clave que el refresh_token de Google
      Calendar) + `salons.booking_deposit_amount`, editables por el owner
      desde el panel (`/admin/payment-settings`, `GET`/`PATCH
      /salon/payment-settings`). Sigue dormido en el frontend público (solo
      ofrece `"transfer"`), pero ya no hay bug de fondo que arreglar antes de
      activarlo por salón — ver migración
      `20260929120000_salon_payment_settings.sql` y
      `app/services/payments.py`.
- [ ] UptimeRobot pingueando el backend para que Supabase (free tier) no se
      pause por inactividad.
- [ ] Título de Swagger en `main.py:26` ("MC Nails Studio — API de
      Reservas") — cosmético, solo visible en `/docs`, baja prioridad.
- [ ] Verificación de OAuth de Google (saca el cartel de "app no
      verificada" para siempre) — depende del dominio propio + Privacy
      Policy/Terms online + video de uso del scope de Calendar. No urgente
      para arrancar.

## Pricing acordado para la nueva estética

- Implementación (pago único): $15.000–$25.000 ARS.
- Suscripción mensual: $15.000 ARS/mes.

## Alta de un tercer salón (o más)

Con el trabajo de 429c3ea (multi-tenant real) y el de payment-settings de hoy
(2026-09-29), sumar un salón nuevo ya no necesita tocar código: lo que antes
era una env var global (seña, Mercado Pago) ahora es una fila en `salons` que
el propio owner carga desde su panel, sin volver a tocar la base a mano ni
pedir un deploy.

Pasos:

1. Insertar la fila en `salons` (mismo criterio que el segundo salón):
   nombre, slug, timezone, políticas de reserva (`min_lead_minutes`,
   `max_advance_days`, `slot_step_minutes`).
2. Alta manual del primer owner (signup normal + `UPDATE profiles set
   role='owner'`, ver `DEPLOYMENT.md`).
3. El owner entra a su panel (`/admin/payment-settings`) y carga su propio
   monto de seña y, si tiene, su access token de Mercado Pago — sin esto
   sigue funcionando con transferencia y/o el default global del backend.
4. Sitio nuevo en Netlify con su propio `VITE_SALON_ID`.
5. Si quiere Google Calendar: agregarlo como test user en el proyecto de
   Google Cloud usado (mientras la app siga en modo Testing, ver sección de
   arriba).

**Ya no bloqueante** (antes sí lo era): un tercer salón que quisiera su
propia cuenta de Mercado Pago hubiera terminado compartiendo el token de
otro salón — arreglado con `salons.mercadopago_access_token_encrypted`.

**Sigue pendiente, no bloqueante:** `transfer_alias` / `transfer_cvu` /
`transfer_account_name` y `notifications_webhook_url` todavía se cargan por
SQL a mano (mismo criterio que el segundo salón), no desde el panel. Si se
suman más clientes seguido, conviene darles el mismo tratamiento que a
payment-settings (endpoint + UI en `/admin`) para sacar a Supabase del medio
por completo.

Pricing de referencia: el mismo acordado arriba para el segundo salón sigue
aplicando — el costo marginal de infra por salón adicional sigue siendo
~$0 (mismo backend/Supabase compartido), así que $15.000 ARS/mes por salón
mantiene un margen muy alto.

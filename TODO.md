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
- [ ] `PrivacyPolicy.tsx` y `TermsOfService.tsx` siguen diciendo "MC Nails
      Studio" hardcodeado como la entidad legal — falta hacerlo dinámico
      (mismo patrón que el resto).
- [ ] Footer de `PublicSite.tsx:215` — "MC NAILS STUDIO · hecho con cariño
      para tus uñas", hardcodeado en todas las páginas.
- [ ] `MERCADOPAGO_ACCESS_TOKEN` sigue siendo una sola variable global
      (dormida hoy porque el frontend solo usa `"transfer"`) — arreglar
      antes de activar MercadoPago como método de pago para cualquier salón,
      mismo bug de fondo que tenía `transfer_alias`.
- [ ] UptimeRobot pingueando el backend para que Supabase (free tier) no se
      pause por inactividad.
- [ ] `BOOKING_DEPOSIT_AMOUNT` sigue siendo global — ambos salones están
      forzados al mismo monto de seña. No es bloqueante, pero si algún
      cliente quiere un monto distinto, hay que hacerlo por salón.
- [ ] Título de Swagger en `main.py:26` ("MC Nails Studio — API de
      Reservas") — cosmético, solo visible en `/docs`, baja prioridad.
- [ ] Verificación de OAuth de Google (saca el cartel de "app no
      verificada" para siempre) — depende del dominio propio + Privacy
      Policy/Terms online + video de uso del scope de Calendar. No urgente
      para arrancar.

## Pricing acordado para la nueva estética

- Implementación (pago único): $15.000–$25.000 ARS.
- Suscripción mensual: $15.000 ARS/mes.

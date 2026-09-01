import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";

export function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-soft-white">
      <div className="safe-top sticky top-0 z-10 border-b border-charcoal/8 bg-soft-white/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
        </div>
      </div>

      <article className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
        <h1 className="font-display text-3xl text-charcoal">Política de privacidad</h1>
        <p className="mt-2 text-sm text-charcoal/50">Última actualización: 1 de septiembre de 2026</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-charcoal/70">
          <p>
            MC Nails Studio ("nosotros") opera este sitio y el panel de administración
            para gestionar turnos del salón. Esta política explica qué datos recolectamos
            y cómo los usamos.
          </p>

          <section>
            <h2 className="font-display text-lg text-charcoal">Qué datos recolectamos</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Datos de reserva: nombre, teléfono y, opcionalmente, email del cliente.</li>
              <li>Datos de cuenta del personal y administración: email y credenciales de acceso.</li>
              <li>
                Si el salón conecta Google Calendar, accedemos a su calendario únicamente
                para sincronizar turnos y bloqueos de horario — nunca leemos ni compartimos
                otra información de la cuenta de Google.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Cómo usamos los datos</h2>
            <p className="mt-2">
              Los datos de reserva se usan exclusivamente para coordinar turnos (confirmaciones,
              recordatorios, gestión de la agenda). No vendemos ni compartimos datos personales
              con terceros, salvo los proveedores necesarios para operar el servicio (por
              ejemplo, procesamiento de pagos de seña o envío de emails de confirmación).
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Google Calendar</h2>
            <p className="mt-2">
              El acceso a Google Calendar se usa solo para leer y crear eventos relacionados
              con los turnos del salón. El acceso puede revocarse en cualquier momento desde
              el panel de administración o directamente desde{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-champagne underline-offset-4 hover:underline"
              >
                la configuración de tu cuenta de Google
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Conservación y seguridad</h2>
            <p className="mt-2">
              Los datos se almacenan en infraestructura con acceso restringido y se conservan
              mientras sea necesario para prestar el servicio o cumplir obligaciones legales.
              Podés pedir la corrección o eliminación de tus datos escribiéndonos.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Contacto</h2>
            <p className="mt-2">
              Para consultas sobre esta política o tus datos, escribinos por Instagram a{" "}
              <a
                href="https://www.instagram.com/mcstudiodebelleza"
                target="_blank"
                rel="noopener noreferrer"
                className="text-champagne underline-offset-4 hover:underline"
              >
                @mcstudiodebelleza
              </a>
              .
            </p>
          </section>
        </div>

        <Link
          to="/"
          className="tap-btn mt-10 inline-block text-xs font-medium text-charcoal/50 underline-offset-4 hover:text-champagne hover:underline"
        >
          ← Volver al inicio
        </Link>
      </article>
    </main>
  );
}

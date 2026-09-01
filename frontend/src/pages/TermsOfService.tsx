import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";

export function TermsOfService() {
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
        <h1 className="font-display text-3xl text-charcoal">Términos de servicio</h1>
        <p className="mt-2 text-sm text-charcoal/50">Última actualización: 1 de septiembre de 2026</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-charcoal/70">
          <p>
            Al reservar un turno o usar el panel de administración de MC Nails Studio,
            aceptás estos términos.
          </p>

          <section>
            <h2 className="font-display text-lg text-charcoal">Reservas</h2>
            <p className="mt-2">
              Las reservas quedan sujetas a disponibilidad y pueden requerir una seña para
              confirmarse. El salón puede reprogramar o cancelar un turno por motivos de
              fuerza mayor, avisando al cliente por el medio de contacto informado en la
              reserva.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Seña y pagos</h2>
            <p className="mt-2">
              Cuando corresponda seña, el monto y medio de pago se informan al momento de
              reservar. La seña se descuenta del valor total del servicio.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Panel de administración</h2>
            <p className="mt-2">
              El acceso al panel está reservado a personal autorizado del salón. Cada
              usuario es responsable de mantener sus credenciales seguras y de la actividad
              realizada con su cuenta.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Integración con Google Calendar</h2>
            <p className="mt-2">
              Al conectar Google Calendar desde el panel, el salón autoriza a la aplicación a
              leer y crear eventos en el calendario conectado, únicamente para sincronizar
              turnos y bloqueos de agenda. Esta conexión puede desconectarse en cualquier
              momento desde el panel.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Cambios</h2>
            <p className="mt-2">
              Estos términos pueden actualizarse. Los cambios relevantes se reflejan en esta
              misma página con la fecha de actualización.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-charcoal">Contacto</h2>
            <p className="mt-2">
              Consultas por Instagram a{" "}
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

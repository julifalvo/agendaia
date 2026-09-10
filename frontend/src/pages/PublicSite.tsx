import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuthContext";
import { useProfile } from "../hooks/useProfileContext";
import { BookingFlow } from "../components/BookingFlow";
import { DecorBackground } from "../components/DecorBackground";
import { Divider } from "../components/Divider";
import { InstagramIcon } from "../components/InstagramIcon";
import { Logo, Monogram, Wordmark } from "../components/Logo";
import { Marquee } from "../components/Marquee";
import { PolishSwatches } from "../components/PolishSwatches";
import { Sparkle } from "../components/Sparkle";
import { Welcome } from "../components/Welcome";

function TopBar() {
  const { user, signOut, loading } = useAuth();
  const { profile } = useProfile();
  const isStaff = profile?.role === "owner" || profile?.role === "staff";

  return (
    <div className="safe-top sticky top-0 z-20 border-b border-charcoal/8 bg-soft-white/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3 sm:px-6 lg:max-w-5xl lg:px-10 lg:py-4">
        <Logo />

        {!loading && isStaff && (
          <div className="flex items-center gap-3 text-xs">
            <Link
              to="/admin"
              className="tap-btn text-charcoal/50 underline-offset-4 hover:text-charcoal hover:underline"
            >
              Panel del salón
            </Link>
            {user && (
              <button
                type="button"
                onClick={() => void signOut()}
                className="tap-btn text-charcoal/50 underline-offset-4 hover:text-charcoal hover:underline"
              >
                Cerrar sesión
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div className="mx-auto max-w-md px-5 pb-10 pt-10 text-center sm:px-6 lg:max-w-none lg:pt-16">
      <div className="glow-orb mx-auto inline-block">
        <Wordmark className="h-20 lg:h-24" />
      </div>

      <div
        className="mx-auto mt-7 flex w-fit items-center gap-1.5 rounded-full border border-baby-pink/60 bg-white/70 px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-bubblegum backdrop-blur-sm"
        style={{ boxShadow: "0 4px 14px -6px rgba(255, 111, 160, 0.35)" }}
      >
        <Sparkle className="h-2.5 w-2.5 shrink-0" color="var(--color-bubblegum)" />
        Reservá tu turno online
      </div>

      <h1 className="mt-5 font-display text-[2.6rem] leading-[0.98] tracking-tight text-charcoal lg:text-[3.6rem]">
        Uñas lindas,
        <br />
        <span className="italic text-bubblegum">a tu manera.</span>
      </h1>
      <p className="mx-auto mt-4 max-w-[26rem] text-sm text-charcoal/55 lg:text-base">
        Reservá tu turno en minutos, sin vueltas ni necesidad de crear una cuenta.
      </p>
      <div className="mt-6 flex justify-center">
        <PolishSwatches />
      </div>
    </div>
  );
}

const HOW_IT_WORKS = [
  { step: "01", title: "Elegí tu servicio", detail: "Manicura, pedicura, nail art o spa de manos." },
  { step: "02", title: "Elegí tu horario", detail: "Vemos la disponibilidad real de cada profesional." },
  { step: "03", title: "Confirmá con la seña", detail: "Transferencia simple y tu turno queda reservado." },
];

/** Panel de marca para el layout de dos columnas en desktop — en mobile el
 * flujo de reserva ya ocupa toda la pantalla, así que este panel solo
 * aparece a partir de `lg` para no duplicar contenido en pantallas chicas. */
function BrandPanel() {
  return (
    <div className="hidden lg:sticky lg:top-24 lg:col-start-1 lg:block">
      <p className="font-display text-[1.6rem] italic leading-snug text-charcoal">
        “Un ritual de belleza pensado en cada detalle, de principio a fin.”
      </p>

      <Divider className="my-8 justify-start" />

      <div className="flex flex-col">
        {HOW_IT_WORKS.map((item, i) => (
          <div key={item.step} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-bubblegum/25 bg-gradient-to-br from-bubblegum/10 to-champagne/10 font-display text-sm italic text-bubblegum"
                style={{ boxShadow: "0 4px 12px -6px rgba(255, 111, 160, 0.3)" }}
              >
                {item.step}
              </span>
              {i < HOW_IT_WORKS.length - 1 && (
                <span className="my-1 w-px flex-1 bg-gradient-to-b from-bubblegum/25 to-transparent" />
              )}
            </div>
            <div className={i < HOW_IT_WORKS.length - 1 ? "pb-6" : ""}>
              <p className="font-display text-base text-charcoal">{item.title}</p>
              <p className="mt-0.5 text-sm text-charcoal/50">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <a
        href="https://www.instagram.com/mcstudiodebelleza"
        target="_blank"
        rel="noopener noreferrer"
        className="tap-btn mt-10 flex items-center gap-1.5 text-xs font-medium text-charcoal/50
          underline-offset-4 transition-colors hover:text-champagne hover:underline"
      >
        <InstagramIcon className="h-3.5 w-3.5" />
        Mirá los diseños en Instagram
      </a>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-charcoal/40">
        <Link to="/privacidad" className="tap-btn underline-offset-4 hover:text-champagne hover:underline">
          Privacidad
        </Link>
        <Link to="/terminos" className="tap-btn underline-offset-4 hover:text-champagne hover:underline">
          Términos
        </Link>
      </div>
    </div>
  );
}

export function PublicSite() {
  // Si Mercado Pago redirige de vuelta acá (`?pago=...`), se salta la
  // pantalla de bienvenida: BookingFlow ya sabe mostrar el aviso de retorno.
  const [entered, setEntered] = useState(() =>
    new URLSearchParams(window.location.search).has("pago"),
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-soft-white">
      <DecorBackground />

      <TopBar />

      <AnimatePresence mode="wait">
        {!entered ? (
          <motion.div
            key="welcome"
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: "easeIn" }}
          >
            <Welcome onStart={() => setEntered(true)} />
          </motion.div>
        ) : (
          <motion.div
            key="booking"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <div className="mx-auto max-w-md px-5 sm:px-6 lg:max-w-5xl lg:px-10">
              <Hero />
            </div>
            <Marquee />

            <div className="mx-auto max-w-md px-5 pb-16 pt-8 sm:px-6 lg:max-w-5xl lg:px-10 lg:pb-24 lg:pt-14">
              <div className="lg:grid lg:grid-cols-[1fr_25rem] lg:gap-16">
                <BrandPanel />

                <div>
                  <Divider className="mb-6 lg:hidden" />

                  <div
                    className="relative overflow-hidden rounded-[2rem] border border-baby-pink/40 bg-white/75 p-6 backdrop-blur-xl sm:p-8"
                    style={{ boxShadow: "var(--shadow-soft)" }}
                  >
                    <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-bubblegum via-baby-pink to-champagne" />
                    <BookingFlow />
                  </div>
                </div>
              </div>

              <footer className="mt-14 flex flex-col items-center gap-3 border-t border-baby-pink/40 pt-10 lg:mt-20">
                <Monogram className="h-7 w-7 opacity-60 lg:hidden" />

                <a
                  href="https://www.instagram.com/mcstudiodebelleza"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-btn flex items-center gap-1.5 text-xs font-medium text-charcoal/50
                    underline-offset-4 transition-colors hover:text-champagne hover:underline lg:hidden"
                >
                  <InstagramIcon className="h-3.5 w-3.5" />
                  Mirá los diseños en Instagram
                </a>

                <p className="text-center text-xs tracking-wide text-charcoal/35">
                  MC NAILS STUDIO · hecho con cariño para tus uñas
                </p>

                <div className="flex items-center gap-3 text-[11px] text-charcoal/40">
                  <Link to="/privacidad" className="tap-btn underline-offset-4 hover:text-champagne hover:underline">
                    Privacidad
                  </Link>
                  <Link to="/terminos" className="tap-btn underline-offset-4 hover:text-champagne hover:underline">
                    Términos
                  </Link>
                </div>
              </footer>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

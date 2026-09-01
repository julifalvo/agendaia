import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuthContext";
import { useProfile } from "../hooks/useProfileContext";
import { BookingFlow } from "../components/BookingFlow";
import { DecorBackground } from "../components/DecorBackground";
import { Divider } from "../components/Divider";
import { InstagramIcon } from "../components/InstagramIcon";
import { Logo, Monogram } from "../components/Logo";
import { Marquee } from "../components/Marquee";
import { PolishSwatches } from "../components/PolishSwatches";
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
    <div className="mx-auto max-w-md px-5 pb-8 pt-10 text-center sm:px-6 lg:max-w-none lg:pt-16">
      <div className="glow-orb mx-auto inline-block">
        <Monogram className="h-12 w-12 lg:h-14 lg:w-14" />
      </div>

      <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.35em] text-champagne">
        MC Nails Studio
      </p>
      <h1 className="mt-3 font-display text-[2.6rem] leading-[0.98] tracking-tight text-charcoal lg:text-[3.4rem]">
        Uñas lindas,
        <br />
        <span className="italic text-bubblegum">a tu manera.</span>
      </h1>
      <p className="mx-auto mt-4 max-w-[26rem] text-sm text-charcoal/55 lg:text-base">
        Reservá tu turno en minutos, sin vueltas ni necesidad de crear una cuenta.
      </p>
      <div className="mt-5 flex justify-center">
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

      <div className="flex flex-col gap-6">
        {HOW_IT_WORKS.map((item) => (
          <div key={item.step} className="flex gap-4">
            <span className="font-display text-lg italic text-champagne/70">{item.step}</span>
            <div>
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
                    className="rounded-[2rem] border border-baby-pink/40 bg-white/75 p-6 backdrop-blur-xl sm:p-8"
                    style={{ boxShadow: "var(--shadow-soft)" }}
                  >
                    <BookingFlow />
                  </div>
                </div>
              </div>

              <footer className="mt-10 flex flex-col items-center gap-3 lg:mt-16">
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

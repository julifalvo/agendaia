import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const FLOWER_COUNT = 26;
const PETAL_ANGLES = [0, 60, 120, 180, 240, 300];
const AUTO_DISMISS_MS = 4500;

/** Margarita amarilla simple — puramente decorativa, sin relación con la
 * paleta de marca (a propósito: es un festejo de temporada, no un elemento
 * permanente de la UI). `tone` da un poco de variedad entre las que caen. */
function FlowerIcon({ className = "h-full w-full", tone = 0 }: { className?: string; tone?: 0 | 1 }) {
  const petal = tone === 0 ? "#FFDB4D" : "#FFE58A";
  const center = tone === 0 ? "#F2A93B" : "#EF9B2E";
  return (
    <svg viewBox="0 0 40 40" className={`${className} drop-shadow-sm`} aria-hidden="true">
      {PETAL_ANGLES.map((angle) => (
        <ellipse
          key={angle}
          cx="20"
          cy="11"
          rx="5.5"
          ry="9.5"
          fill={petal}
          transform={`rotate(${angle} 20 20)`}
        />
      ))}
      <circle cx="20" cy="20" r="5" fill={center} />
    </svg>
  );
}

interface FlowerSpec {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  spin: number;
  sway: number;
  tone: 0 | 1;
}

function FallingFlowers() {
  const [flowers] = useState<FlowerSpec[]>(() =>
    Array.from({ length: FLOWER_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 1.6,
      duration: 5 + Math.random() * 3.5,
      size: 16 + Math.random() * 18,
      spin: Math.random() > 0.5 ? 1 : -1,
      sway: 18 + Math.random() * 26,
      tone: Math.random() > 0.5 ? 1 : 0,
    })),
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {flowers.map((f) => (
        <motion.div
          key={f.id}
          className="absolute top-0"
          style={{ left: `${f.left}%`, width: f.size, height: f.size }}
          initial={{ y: "-10vh", x: 0, opacity: 0, rotate: 0 }}
          animate={{
            y: "110vh",
            x: [0, f.sway, -f.sway, 0],
            opacity: [0, 1, 1, 0],
            rotate: 360 * f.spin,
          }}
          transition={{
            y: { duration: f.duration, delay: f.delay, ease: "linear" },
            opacity: { duration: f.duration, delay: f.delay, ease: "linear" },
            rotate: { duration: f.duration, delay: f.delay, ease: "linear" },
            x: { duration: f.duration / 2, delay: f.delay, repeat: 1, ease: "easeInOut" },
          }}
        >
          <FlowerIcon tone={f.tone} />
        </motion.div>
      ))}
    </div>
  );
}

function SpringOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[70] flex cursor-pointer flex-col items-center justify-center overflow-hidden px-6 text-center backdrop-blur-xl"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,246,214,0.4), rgba(255,111,160,0.18))",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      whileTap={{ opacity: 0.85 }}
      transition={{ duration: 0.5 }}
      onClick={onDismiss}
      onTap={onDismiss}
      role="button"
      aria-label="Cerrar saludo de primavera"
    >
      <FallingFlowers />

      <motion.p
        initial={{ opacity: 0, y: 18, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -14, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        className="relative font-display text-4xl italic text-charcoal sm:text-6xl"
        style={{ textShadow: "0 8px 32px rgba(255,255,255,0.85), 0 2px 10px rgba(242,169,59,0.4)" }}
      >
        ¡Feliz Primavera!
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="relative mt-2 text-sm text-charcoal/60 sm:text-base"
        style={{ textShadow: "0 2px 14px rgba(255,255,255,0.9)" }}
      >
        Que florezca todo lo lindo
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 1, duration: 0.6 }}
        className="relative mt-8 text-[11px] uppercase tracking-[0.22em] text-charcoal/40"
      >
        Tocá para continuar
      </motion.p>
    </motion.div>
  );
}

/**
 * Festejo temporal de bienvenida: apenas se entra a la pantalla, todo el
 * sitio se blurrea y aparece "Feliz Primavera" con flores amarillas cayendo.
 * Se dispara en cada montaje (o sea, en cada refresh de la pantalla inicial),
 * se puede cerrar tocando en cualquier lado, y si no se toca desaparece solo
 * — después la página vuelve a ser interactuable normalmente.
 */
export function SpringFestivity() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShow(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  return <AnimatePresence>{show && <SpringOverlay onDismiss={() => setShow(false)} />}</AnimatePresence>;
}

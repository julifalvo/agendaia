import { motion, useReducedMotion } from "framer-motion";
import { Sparkle } from "./Sparkle";

/** Ángulo, distancia, tamaño, color y delay de cada partícula — fijos (no
 * `Math.random()`) para que el burst sea el mismo en cada render y no salte
 * al re-renderizar; la variación en los valores ya alcanza para que no se
 * vea mecánico. */
const PARTICLES = [
  { angle: -100, distance: 70, size: 14, color: "var(--color-bubblegum)", delay: 0 },
  { angle: -55, distance: 85, size: 10, color: "var(--color-champagne)", delay: 0.04 },
  { angle: -20, distance: 65, size: 12, color: "var(--color-baby-pink)", delay: 0.08 },
  { angle: 15, distance: 90, size: 9, color: "var(--color-bubblegum)", delay: 0.02 },
  { angle: 50, distance: 70, size: 13, color: "var(--color-champagne)", delay: 0.1 },
  { angle: 95, distance: 80, size: 10, color: "var(--color-bubblegum)", delay: 0.06 },
  { angle: 130, distance: 65, size: 12, color: "var(--color-baby-pink)", delay: 0.12 },
  { angle: 165, distance: 88, size: 9, color: "var(--color-champagne)", delay: 0.03 },
  { angle: -145, distance: 75, size: 11, color: "var(--color-baby-pink)", delay: 0.09 },
  { angle: -170, distance: 60, size: 13, color: "var(--color-bubblegum)", delay: 0.14 },
];

/**
 * Ráfaga de sparkles que estalla desde el centro una sola vez al montarse —
 * el "delight" del momento en que se confirma el turno. Pensado para
 * celular: el check de confirmación ya es el elemento con más foco en una
 * pantalla chica, así que el burst lo corona en vez de competir con otro
 * contenido. Respeta `prefers-reduced-motion` (no anima, no se monta).
 */
export function ConfettiBurst() {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {PARTICLES.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180;
        const x = Math.cos(rad) * p.distance;
        const y = Math.sin(rad) * p.distance;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2"
            initial={{ x: 0, y: 0, scale: 0, opacity: 1, rotate: 0 }}
            animate={{ x, y, scale: [0, 1.1, 1, 0.8], opacity: [1, 1, 1, 0], rotate: p.angle }}
            transition={{ duration: 0.7, delay: p.delay, ease: "easeOut" }}
          >
            <Sparkle style={{ width: p.size, height: p.size }} color={p.color} />
          </motion.div>
        );
      })}
    </div>
  );
}

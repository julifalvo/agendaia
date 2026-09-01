import { Monogram } from "./Logo";
import { Sparkle } from "./Sparkle";

/** Posiciones de los sparkles dispersos: clase de posición + tamaño + delay
 * de titileo, para que no todos brillen a la vez. */
const SCATTERED_SPARKLES = [
  { className: "left-[8%] top-[14%] h-4 w-4", delay: "-0.4s", color: "var(--color-bubblegum)" },
  { className: "left-[22%] top-[62%] h-3 w-3", delay: "-1.8s", color: "var(--color-champagne)" },
  { className: "right-[14%] top-[10%] h-5 w-5", delay: "-2.6s", color: "var(--color-champagne)" },
  { className: "right-[26%] top-[46%] h-3 w-3", delay: "-0.9s", color: "var(--color-bubblegum)" },
  { className: "left-[12%] top-[85%] h-3.5 w-3.5", delay: "-2.1s", color: "var(--color-bubblegum)" },
  { className: "right-[10%] top-[78%] h-4 w-4", delay: "-1.2s", color: "var(--color-champagne)" },
];

/**
 * Composición de fondo "cute atelier": dos manchas grandes y suaves para dar
 * profundidad, un monograma gigante casi invisible como marca de agua
 * (motivo que usan las casas de belleza para dar peso de marca sin
 * fotografía) y un puñado de sparkles dispersos que titilan suavemente — el
 * "polvo mágico" que hace que el fondo se sienta tierno y vivo en vez de
 * plano. `aria-hidden` + `pointer-events-none`: nunca deben interceptar foco
 * ni clicks. Requiere un contenedor `relative overflow-hidden`.
 */
export function DecorBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="decor-blob -right-32 -top-40 h-[26rem] w-[26rem] bg-baby-pink lg:-right-48 lg:-top-56 lg:h-[42rem] lg:w-[42rem]" />
      <div
        className="decor-blob -bottom-32 -left-24 h-96 w-96 bg-champagne/70 lg:-bottom-48 lg:-left-40 lg:h-[34rem] lg:w-[34rem]"
        style={{ animationDelay: "-9s" }}
      />

      <Monogram className="absolute -right-14 top-20 h-72 w-72 -rotate-6 opacity-[0.05] sm:h-[26rem] sm:w-[26rem] lg:h-[34rem] lg:w-[34rem]" />

      {SCATTERED_SPARKLES.map((s, i) => (
        <Sparkle
          key={i}
          className={`sparkle-twinkle absolute ${s.className}`}
          style={{ animationDelay: s.delay }}
          color={s.color}
        />
      ))}
    </div>
  );
}

import { Sparkle } from "./Sparkle";

const ITEMS = ["Manicura", "Pedicura", "Nail Art", "Spa de manos", "Cuidado profesional"];

/**
 * Cinta de texto en loop infinito — el mismo recurso que usan Chillhouse o
 * Paintbox para reforzar marca sin depender de fotografía. El contenido se
 * duplica; la animación desliza exactamente la mitad del ancho total, así
 * el loop no se nota. Separador: sparkle rosa entre cada palabra — el detalle
 * "cute" que puntúa la cinta como confeti en vez de un punto neutro.
 */
export function Marquee() {
  const content = (
    <span className="flex shrink-0 items-center gap-3 pr-3">
      {ITEMS.map((item) => (
        <span key={item} className="flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-charcoal/50">
            {item}
          </span>
          <Sparkle className="h-2.5 w-2.5 shrink-0" color="var(--color-bubblegum)" />
        </span>
      ))}
    </span>
  );

  return (
    <div className="overflow-hidden border-y border-baby-pink/40 bg-baby-pink/10 py-2.5" aria-hidden="true">
      <div className="marquee-track">
        {content}
        {content}
      </div>
    </div>
  );
}

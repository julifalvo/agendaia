import { useId } from "react";

/**
 * Sistema de marca en 3 piezas, mismo espíritu editorial que la referencia
 * (monograma fino entrelazado + "STUDIO" en versalitas espaciadas + tagline
 * diminuto), adaptado a la paleta rosa del sitio en vez de blanco y negro:
 *  - `Monogram`: sólo "MC" entrelazado, para usos chicos/ícono (footer,
 *    watermark de `DecorBackground`).
 *  - `Wordmark`: el lockup completo (MC + STUDIO + tagline) para usos
 *    grandes y protagónicos (Hero, Welcome) — reemplaza la combinación
 *    anterior de ícono + leyenda repetida aparte.
 *  - `Logo`: versión horizontal compacta para las barras de navegación
 *    (ícono + "STUDIO").
 * `id` único evita que dos instancias del mismo SVG en la misma página
 * compartan el gradiente.
 */
export function Monogram({ className = "" }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="6" y1="14" x2="88" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-bubblegum)" />
          <stop offset="100%" stopColor="var(--color-baby-pink)" />
        </linearGradient>
      </defs>
      <text
        x="34"
        y="63"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="500"
        fontSize="52"
        fill={`url(#${gradientId})`}
      >
        M
      </text>
      <text
        x="66"
        y="63"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="500"
        fontSize="52"
        fill={`url(#${gradientId})`}
      >
        C
      </text>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 200 130" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="55" y1="14" x2="150" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--color-bubblegum)" />
          <stop offset="100%" stopColor="var(--color-baby-pink)" />
        </linearGradient>
      </defs>
      <text
        x="86"
        y="66"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="500"
        fontSize="60"
        fill={`url(#${gradientId})`}
      >
        M
      </text>
      <text
        x="128"
        y="66"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="500"
        fontSize="60"
        fill={`url(#${gradientId})`}
      >
        C
      </text>
      <text
        x="103"
        y="94"
        textAnchor="middle"
        fontFamily="var(--font-body)"
        fontWeight="600"
        fontSize="15"
        letterSpacing="6.5"
        fill="var(--color-charcoal)"
      >
        STUDIO
      </text>
      <text
        x="103"
        y="112"
        textAnchor="middle"
        fontFamily="var(--font-body)"
        fontWeight="500"
        fontSize="8"
        letterSpacing="2.5"
        fill="var(--color-champagne)"
      >
        NAILS &amp; BEAUTY
      </text>
    </svg>
  );
}

/**
 * A tamaño de ícono de nav (~28px) el entrelazado de `Monogram` pierde
 * definición y se ve como una mancha en vez de dos letras — por eso acá
 * "MC" se resuelve en texto plano (sin solapar), no con el SVG grande.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="font-display text-xl font-semibold tracking-tight text-bubblegum">
        MC
      </span>
      <span className="font-body text-sm font-semibold tracking-[0.3em] text-charcoal">
        STUDIO
      </span>
    </div>
  );
}

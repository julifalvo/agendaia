import type { CSSProperties } from "react";

/**
 * Motivo de estrella de 4 puntas — el "twinkle" que usan casi todas las
 * marcas de belleza/nail art para puntuar texto sin depender de fotografía.
 * Puramente decorativo: `aria-hidden` siempre.
 */
export function Sparkle({
  className = "",
  style,
  color = "var(--color-champagne)",
}: {
  className?: string;
  style?: CSSProperties;
  color?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="none" aria-hidden="true">
      <path
        d="M12 2.5 13.8 9.2 20.5 11 13.8 12.8 12 19.5 10.2 12.8 3.5 11 10.2 9.2Z"
        fill={color}
      />
    </svg>
  );
}

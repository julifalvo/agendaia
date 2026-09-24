import { useEffect, useState, type ReactNode } from "react";
import { apiGet } from "../lib/api";
import { SalonContext } from "./SalonContext";
import type { ApiSalon } from "../types/api";

const SALON_ID = import.meta.env.VITE_SALON_ID;

/**
 * Pinta `--color-bubblegum` (el único acento dinámico del sistema de diseño,
 * ver index.css) con el `theme_color` del salón — así un salón sin color
 * propio configurado (NULL) sigue viendo la paleta candy-pink por defecto,
 * sin tocar nada.
 */
function applyThemeColor(themeColor: string | null) {
  const root = document.documentElement.style;
  if (themeColor) {
    root.setProperty("--color-bubblegum", themeColor);
  } else {
    root.removeProperty("--color-bubblegum");
  }
}

export function SalonProvider({ children }: { children: ReactNode }) {
  const [salon, setSalon] = useState<ApiSalon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<ApiSalon>(`/salons/${SALON_ID}`);
        if (!cancelled) {
          setSalon(data);
          applyThemeColor(data.theme_color);
        }
      } catch {
        if (!cancelled) setSalon(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <SalonContext.Provider value={{ salon, loading }}>{children}</SalonContext.Provider>;
}

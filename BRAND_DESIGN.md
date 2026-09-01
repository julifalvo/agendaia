# Brand Design & UI: MC Nails Studio
**Estética: Cute Atelier — tierno, femenino, dinámico**

## Paleta de Colores
Vuelta a un rosa vivo tipo candy (como el logo `mcstudio.jpg`), dejando atrás
la versión apagada/"prestigiosa" anterior. Se suma un acento fucsia
(`bubblegum`) para dar pop a botones y estados activos, sin perder la base
elegante (serif, glassmorphism, espaciado).

*   **Baby Pink (Primary):** `#F9C2D4` (rosa candy suave).
*   **Soft White (Background):** `#FFF3F7` (blanco con tibieza rosada).
*   **Deep Charcoal (Text/Accents):** `#4A3540` (negro cálido tipo ciruela, no gris plano).
*   **Gold/Champagne (Highlights):** `#E0A94E` (oro luminoso).
*   **Bubblegum (Acento dinámico):** `#FF6FA0` (fucsia vivo — CTAs primarios, estados
    seleccionados, degradés `from-bubblegum to-champagne`).

Ornamentación: sin miedo a repetir. Sparkles dispersos y titilantes en el
fondo (`DecorBackground`, clase `.sparkle-twinkle`), sparkle en cada palabra
del separador (`Marquee`) y en el `Divider`. El monograma tipo sello y su
versión gigante como marca de agua se mantienen como ancla de marca detrás
de todo el confeti.

## Pautas de UI
1.  **Tipografía:** Serif para títulos (Playfair Display), Sans-Serif (Inter) para el cuerpo.
2.  **Espaciado:** Mucho espacio en blanco. Glassmorphism sutil en tarjetas de reserva.
3.  **Componentes:** Bordes redondeados (`rounded-2xl`/`rounded-full`), sombras con tinte
    rosa (`--shadow-soft`, `--shadow-glow`), degradés `bubblegum → champagne` en botones
    y estados primarios (cliente, staff y admin comparten el mismo lenguaje visual).
4.  **Interactividad:** micro-animaciones con `framer-motion` (hover/tap scale, springs en
    pills activas), sparkles con titileo (`@keyframes twinkle`), transiciones de color en
    hover — presente en el flujo de reserva público y en los paneles internos por igual.

## Implementación Técnica
*   Tokens definidos con `@theme` (Tailwind v4) en `frontend/src/index.css` — cambiar un
    valor ahí se propaga a toda la app (cliente, staff, admin) sin tocar componentes.

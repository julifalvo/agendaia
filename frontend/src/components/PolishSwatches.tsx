/**
 * Fila de pastillas de color estilo "rack de esmaltes" — un motivo gráfico
 * característico de nail studios que no depende de fotografía. Los tonos
 * son variaciones puramente decorativas alrededor de la paleta de marca,
 * nunca se reutilizan como color funcional en la UI.
 */
const SWATCHES = [
  "#f9c2d4", // baby-pink
  "#ff6fa0", // bubblegum
  "#e0a94e", // champagne
  "#ffd9e6", // rosa pastel claro
  "#fff3f7", // soft-white
];

export function PolishSwatches() {
  return (
    <div className="flex -space-x-2.5" aria-hidden="true">
      {SWATCHES.map((color, i) => (
        <span
          key={color}
          className="h-7 w-7 rounded-full border-2 border-soft-white transition-transform duration-300 hover:-translate-y-1 hover:scale-110 active:scale-95"
          style={{
            backgroundColor: color,
            zIndex: SWATCHES.length - i,
            boxShadow: "0 3px 8px -2px rgba(74, 53, 64, 0.28)",
          }}
        />
      ))}
    </div>
  );
}

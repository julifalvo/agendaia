/**
 * Vibración corta al tocar — el "click" táctil que hace que elegir un
 * servicio o confirmar un turno se sienta como una app nativa en vez de una
 * página web. Solo Android la soporta en el navegador (iOS Safari nunca
 * implementó la Vibration API, ni en PWA agregada al Home Screen), así que
 * es un extra silencioso: en iOS `vibrate` no existe y esto no hace nada.
 */
export function haptic(pattern: number | number[] = 8): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

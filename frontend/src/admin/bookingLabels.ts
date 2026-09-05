import type { PaymentStatus } from "../types/api";
import type { AppointmentStatus } from "../types/booking";

/**
 * Constantes y helpers de fecha compartidos entre `AdminCalendar` (grilla) y
 * `AdminMyBookings` (resumen del día) — antes estaban duplicados en los dos
 * archivos.
 */

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No asistió",
};

export const STATUS_STYLE: Record<AppointmentStatus, string> = {
  pending: "bg-baby-pink/40 text-charcoal",
  confirmed: "bg-champagne/15 text-champagne",
  completed: "bg-charcoal/10 text-charcoal/70",
  cancelled: "bg-charcoal/5 text-charcoal/40 line-through",
  no_show: "bg-charcoal/5 text-charcoal/40",
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Sin seña",
  pending: "Seña sin confirmar",
  paid: "Seña recibida",
};

export const PAYMENT_STYLE: Record<PaymentStatus, string> = {
  unpaid: "bg-charcoal/5 text-charcoal/40",
  pending: "bg-red-50 text-red-600",
  paid: "bg-green-50 text-green-700",
};

/** Fecha local en formato YYYY-MM-DD. `toISOString()` convierte a UTC
 * primero, así que cerca de medianoche en Argentina (UTC-3) devolvería el
 * día siguiente; esto arma la fecha a partir de los componentes locales. */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISODate(): string {
  return toLocalISODate(new Date());
}

export function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function toLocalTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

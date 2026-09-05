import { apiPatch, apiPost } from "../lib/api";
import type { ApiBooking, PaymentStatus } from "../types/api";
import type { AppointmentStatus } from "../types/booking";

/**
 * Acciones sobre un turno ya existente, compartidas entre `AdminMyBookings`
 * (lista del día) y `AdminCalendar` (grilla estilo Teams) — mismo endpoint,
 * mismo shape de body, para no duplicar la lógica en dos lugares.
 */

export function transitionBooking(
  id: string,
  status: AppointmentStatus,
): Promise<ApiBooking> {
  return apiPatch<ApiBooking>(`/bookings/${id}/status`, { status });
}

export function cancelBooking(id: string): Promise<ApiBooking> {
  return apiPost<ApiBooking>(`/bookings/${id}/cancel`, {});
}

export function setBookingPaymentStatus(
  id: string,
  paymentStatus: PaymentStatus,
): Promise<ApiBooking> {
  return apiPatch<ApiBooking>(`/bookings/${id}/payment-status`, {
    payment_status: paymentStatus,
  });
}

export function rescheduleBooking(
  id: string,
  startTimeIso: string,
  staffId: string,
): Promise<ApiBooking> {
  return apiPost<ApiBooking>(`/bookings/${id}/reschedule`, {
    start_time: startTimeIso,
    staff_id: staffId,
  });
}

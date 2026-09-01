import type { AppointmentStatus } from "./booking";

/**
 * Tipos que reflejan tal cual la forma de la API (snake_case, ids sin
 * resolver a nombres). `types/booking.ts` define el modelo de *presentación*
 * que consume `BookingCard`; `lib/mappers.ts` traduce de uno a otro.
 */

export interface ApiService {
  id: string;
  salon_id: string;
  category_id: string | null;
  // Resuelto server-side, no es una columna real — ver ServiceOut en el backend.
  category_name: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  // Pydantic serializa Decimal como string para no perder precisión.
  price: string;
  currency: string;
  is_active: boolean;
}

export interface ApiCategory {
  id: string;
  salon_id: string;
  name: string;
  sort_order: number;
}

export interface CategoryInput {
  name: string;
  sort_order?: number;
}

export interface CategoryUpdateInput {
  name?: string;
  sort_order?: number;
}

export interface ApiSlot {
  start: string;
  end: string;
  staff_ids: string[];
}

export interface ApiAvailability {
  salon_id: string;
  service_id: string;
  date: string;
  slots: ApiSlot[];
}

export type PaymentMethod = "cash" | "mercadopago" | "transfer";
export type PaymentStatus = "unpaid" | "pending" | "paid";

export interface ApiBooking {
  id: string;
  salon_id: string;
  client_id: string | null;
  // Resuelto server-side; null para invitados (ver guest_name).
  client_name: string | null;
  guest_name: string | null;
  guest_email: string | null;
  staff_id: string;
  service_id: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  // Pydantic serializa Decimal como string para no perder precisión.
  price: string;
  currency: string;
  status: AppointmentStatus;
  notes: string | null;
  created_at: string;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  deposit_amount: string | null;
  // Solo viene en la respuesta de POST /bookings, no en GET.
  mp_init_point: string | null;
}

export interface ApiPublicStaff {
  id: string;
  full_name: string;
}

export interface ApiProfile {
  id: string;
  salon_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: "owner" | "staff" | "client";
  is_active: boolean;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  context: Record<string, unknown>;
}

// --- Administración -----------------------------------------------------

export interface ApiStaff {
  id: string;
  salon_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: "owner" | "staff" | "client";
  is_active: boolean;
  color: string | null;
}

export interface ServiceInput {
  name: string;
  description?: string | null;
  category_id?: string | null;
  duration_minutes: number;
  buffer_minutes?: number;
  price: string;
  currency?: string;
}

export interface ServiceUpdateInput {
  name?: string;
  description?: string | null;
  category_id?: string | null;
  duration_minutes?: number;
  buffer_minutes?: number;
  price?: string;
  currency?: string;
  is_active?: boolean;
}

export interface ApiScheduleBlock {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface ScheduleBlockInput {
  start_time: string;
  end_time: string;
}

export interface ApiSalonClosure {
  id: string;
  salon_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface SalonClosureInput {
  starts_at: string;
  ends_at: string;
  reason?: string | null;
}

export interface StaffInviteInput {
  email: string;
  full_name: string;
  role: "owner" | "staff";
}

export interface ApiTimeOff {
  id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

// --- Google Calendar ------------------------------------------------------

export interface ApiGoogleCalendarStatus {
  connected: boolean;
  calendar_id: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
}

export interface ApiGoogleCalendarConnect {
  authorization_url: string;
}

export interface ApiGoogleCalendarSyncResult {
  connected: boolean;
  upserted: number;
  pruned: number;
  error: string | null;
}

export interface ApiGoogleCalendarBlock {
  id: string;
  staff_id: string | null;
  summary: string | null;
  starts_at: string;
  ends_at: string;
}

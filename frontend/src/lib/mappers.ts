import type { ApiBooking, ApiPublicStaff, ApiService } from "../types/api";
import type { Booking } from "../types/booking";

/** "Alisados" tiene precio variable según largo/tipo de pelo: se muestra como punto de partida, no como precio cerrado. */
export function formatServicePrice(service: Pick<ApiService, "price" | "currency" | "category_name">): string {
  const amount = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: service.currency,
  }).format(Number(service.price));
  return service.category_name === "Alisados" ? `Desde ${amount}` : amount;
}

export function toDisplayBooking(
  api: ApiBooking,
  service: ApiService | undefined,
  staff: ApiPublicStaff | undefined,
  clientDisplayName: string,
): Booking {
  return {
    id: api.id,
    serviceName: service?.name ?? "Servicio",
    staffName: staff?.full_name ?? "Profesional asignado",
    clientName: clientDisplayName,
    startTime: api.start_time,
    endTime: api.end_time,
    price: Number(api.price),
    currency: api.currency,
    status: api.status,
    notes: api.notes,
  };
}

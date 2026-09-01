import { describe, expect, it } from "vitest";
import { toDisplayBooking } from "./mappers";
import type { ApiBooking, ApiPublicStaff, ApiService } from "../types/api";

function makeApiBooking(overrides: Partial<ApiBooking> = {}): ApiBooking {
  return {
    id: "b1",
    salon_id: "s1",
    client_id: null,
    client_name: null,
    guest_name: "Julieta",
    guest_email: null,
    staff_id: "staff-1",
    service_id: "service-1",
    start_time: "2026-09-01T14:00:00Z",
    end_time: "2026-09-01T15:00:00Z",
    duration_minutes: 60,
    price: "12000.00",
    currency: "ARS",
    status: "pending",
    notes: null,
    created_at: "2026-08-01T00:00:00Z",
    payment_method: null,
    payment_status: "unpaid",
    deposit_amount: null,
    mp_init_point: null,
    ...overrides,
  };
}

const SERVICE: ApiService = {
  id: "service-1",
  salon_id: "s1",
  category_id: null,
  category_name: null,
  name: "Manicura",
  description: null,
  duration_minutes: 60,
  buffer_minutes: 0,
  price: "12000.00",
  currency: "ARS",
  is_active: true,
};

const STAFF: ApiPublicStaff = { id: "staff-1", full_name: "Valentina" };

describe("toDisplayBooking", () => {
  it("convierte el price de string (JSON) a number para el display model", () => {
    const result = toDisplayBooking(makeApiBooking(), SERVICE, STAFF, "Julieta");
    expect(result.price).toBe(12000);
    expect(typeof result.price).toBe("number");
  });

  it("usa el nombre del cliente pasado, no el de la API, cuando se lo dan explícito", () => {
    const result = toDisplayBooking(makeApiBooking(), SERVICE, STAFF, "Vos");
    expect(result.clientName).toBe("Vos");
  });

  it("cae a valores por defecto cuando no se resolvió el servicio/staff", () => {
    const result = toDisplayBooking(makeApiBooking(), undefined, undefined, "Julieta");
    expect(result.serviceName).toBe("Servicio");
    expect(result.staffName).toBe("Profesional asignado");
  });

  it("preserva id, horarios y estado tal cual vienen de la API", () => {
    const api = makeApiBooking({ status: "confirmed" });
    const result = toDisplayBooking(api, SERVICE, STAFF, "Julieta");
    expect(result.id).toBe(api.id);
    expect(result.startTime).toBe(api.start_time);
    expect(result.endTime).toBe(api.end_time);
    expect(result.status).toBe("confirmed");
  });
});

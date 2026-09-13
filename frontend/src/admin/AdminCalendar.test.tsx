import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AdminCalendar } from "./AdminCalendar";

/**
 * Cubre solo lo que tiene implicancia de seguridad/UX (mismo criterio que el
 * resto de `admin/`, que tiene baja densidad de tests): un admin (owner, o
 * los emails de `full_calendar_access_emails`) puede crear/reprogramar
 * turnos de cualquier profesional; un staff sin ese acceso ve su propia
 * semana en modo estrictamente solo lectura — ni crear, ni arrastrar, ni
 * abrir el modal de edición sobre su propio turno. La restricción real la
 * impone el backend (`_authorize_mutation`/`has_full_access`); esto prueba
 * que la UI respeta el mismo límite en vez de ofrecer una acción que el
 * backend va a rechazar.
 *
 * El reprogramado por arrastre usa Pointer Events (no HTML5 drag-and-drop,
 * que no dispara en touch) — jsdom no hace layout real, así que
 * `document.elementFromPoint` (con el que el componente detecta sobre qué
 * columna está el dedo/mouse) se mockea para devolver la columna elegida.
 *
 * Las fechas de los turnos de prueba se calculan relativas a "hoy" (no
 * fechas fijas): `bookingsFor`/`isWorking` en el componente filtran por
 * fecha exacta de columna, así que un turno con fecha fija quedaría fuera
 * de la semana/día que el calendario efectivamente pide según cuándo corra
 * el test.
 */

const mockUseProfile = vi.fn();
vi.mock("../hooks/useProfileContext", () => ({
  useProfile: () => mockUseProfile(),
}));

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock("../lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...(args as [string])),
  apiPost: (...args: unknown[]) => apiPostMock(...(args as [string, unknown])),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {
    status = 0;
    code = "error";
    context = {};
  },
}));

/** Simula un drag completo con Pointer Events sobre `button`, haciendo que
 * `document.elementFromPoint` (no implementado en jsdom) devuelva `targetColumn`
 * durante el gesto. */
function dragTo(button: HTMLElement, targetColumn: HTMLElement, clientY = 100) {
  const originalElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = (() => targetColumn) as typeof document.elementFromPoint;
  try {
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 0, clientY });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 0, clientY });
  } finally {
    document.elementFromPoint = originalElementFromPoint;
  }
}

/** ISO datetime `daysFromToday` días desde hoy a la hora local dada —
 * construido a partir de un `Date` real y serializado con `toISOString()`,
 * igual que una respuesta real del backend (mismo criterio de parseo que
 * `toLocalDateInput`/`localMinutesSinceMidnight` en el componente). */
function isoAt(daysFromToday: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const STAFF_1 = {
  id: "staff-1",
  salon_id: "s1",
  full_name: "Ana",
  email: null,
  phone: null,
  role: "staff",
  is_active: true,
  color: "#ff0000",
};
const STAFF_2 = {
  id: "staff-2",
  salon_id: "s1",
  full_name: "Beatriz",
  email: null,
  phone: null,
  role: "staff",
  is_active: true,
  color: "#0000ff",
};

const SERVICE = {
  id: "svc-1",
  salon_id: "s1",
  name: "Manicura",
  description: null,
  duration_minutes: 60,
  buffer_minutes: 0,
  price: "1000",
  currency: "ARS",
  is_active: true,
};

const BOOKING = {
  id: "b1",
  salon_id: "s1",
  client_id: null,
  client_name: null,
  guest_name: "Julieta",
  guest_email: null,
  staff_id: "staff-1",
  service_id: "svc-1",
  start_time: isoAt(0, 13),
  end_time: isoAt(0, 14),
  duration_minutes: 60,
  price: "1000",
  currency: "ARS",
  status: "pending",
  notes: null,
  created_at: "2026-08-01T00:00:00Z",
  payment_method: null,
  payment_status: "unpaid",
  deposit_amount: null,
  mp_init_point: null,
};

function workingBlock(dateFrom: string) {
  return [{ id: "sb-1", date: dateFrom, start_time: "08:00:00", end_time: "18:00:00" }];
}

function setupApiGet(bookings: unknown[] = [BOOKING]) {
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/staff") return [STAFF_1, STAFF_2];
    if (path === "/services/mine") return [SERVICE];
    if (path.startsWith("/bookings?")) return bookings;
    if (path.startsWith("/salon/closures")) return [];
    if (path.startsWith("/admin/google-calendar/blocks")) return [];
    if (path.startsWith("/admin/google-calendar/status")) {
      return { connected: false, calendar_id: null, connected_at: null, last_synced_at: null };
    }
    const scheduleMatch = /^\/staff\/[^/]+\/schedule\?date_from=([^&]+)/.exec(path);
    if (scheduleMatch) return workingBlock(scheduleMatch[1]);
    throw new Error(`apiGet no mockeado para: ${path}`);
  });
}

function renderCalendar() {
  return render(
    <MemoryRouter initialEntries={["/admin/calendar"]}>
      <AdminCalendar />
    </MemoryRouter>,
  );
}

function ownerProfile() {
  return {
    id: "owner-1",
    salon_id: "s1",
    full_name: "Camila",
    role: "owner",
    is_active: true,
    color: null,
    email: null,
    phone: null,
  };
}

function staffProfile() {
  return {
    id: "staff-2",
    salon_id: "s1",
    full_name: "Beatriz",
    role: "staff",
    is_active: true,
    color: "#0000ff",
    email: null,
    phone: null,
  };
}

describe("AdminCalendar", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    setupApiGet();
  });

  it("un admin puede crear turnos en cualquier columna del día", async () => {
    mockUseProfile.mockReturnValue({ profile: ownerProfile(), loading: false, refresh: vi.fn() });

    renderCalendar();

    await waitFor(() =>
      expect(screen.getAllByLabelText("Crear turno 09:00")).toHaveLength(2),
    );
    const slots = screen.getAllByLabelText("Crear turno 09:00");
    expect(slots[0]).not.toBeDisabled();
    expect(slots[1]).not.toBeDisabled();

    const user = userEvent.setup();
    await user.click(slots[0]);
    expect(screen.getByText("Nuevo turno")).toBeInTheDocument();
  });

  it('el botón global "+ Nuevo turno" abre el modal de creación sin depender de un click en la grilla', async () => {
    mockUseProfile.mockReturnValue({ profile: ownerProfile(), loading: false, refresh: vi.fn() });

    renderCalendar();
    await waitFor(() => expect(screen.getAllByLabelText("Crear turno 09:00")).toHaveLength(2));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ Nuevo turno" }));

    expect(screen.getByText("Nuevo turno")).toBeInTheDocument();
    expect(screen.getByLabelText("Profesional")).toBeInTheDocument();
    expect(screen.getByLabelText("Hora")).toBeInTheDocument();
  });

  it("un admin puede arrastrar el turno de una profesional a otra", async () => {
    apiPostMock.mockResolvedValue(BOOKING);
    mockUseProfile.mockReturnValue({ profile: ownerProfile(), loading: false, refresh: vi.fn() });

    renderCalendar();

    const bookingButton = await screen.findByRole("button", { name: /Manicura/ });
    const targetSlot = screen.getAllByLabelText("Crear turno 09:00")[1]; // columna de staff-2
    const targetColumn = targetSlot.parentElement!;

    dragTo(bookingButton, targetColumn, 300);

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith(
        expect.stringContaining("/reschedule"),
        expect.objectContaining({ staff_id: "staff-2" }),
      ),
    );
  });

  it("un staff sin acceso completo ve su semana (7 días) totalmente deshabilitada y sin botón de crear", async () => {
    mockUseProfile.mockReturnValue({ profile: staffProfile(), loading: false, refresh: vi.fn() });

    renderCalendar();

    await waitFor(() =>
      expect(screen.getAllByLabelText("Crear turno 09:00")).toHaveLength(7),
    );
    for (const slot of screen.getAllByLabelText("Crear turno 09:00")) {
      expect(slot).toBeDisabled();
    }
    expect(screen.queryByRole("button", { name: "+ Nuevo turno" })).not.toBeInTheDocument();
  });

  it("clickear el turno propio de un staff no abre ningún modal (solo lectura)", async () => {
    const OWN_BOOKING = {
      ...BOOKING,
      id: "b2",
      staff_id: "staff-2",
      guest_name: "Camila",
      start_time: isoAt(0, 13),
      end_time: isoAt(0, 14),
    };
    setupApiGet([OWN_BOOKING]);
    mockUseProfile.mockReturnValue({ profile: staffProfile(), loading: false, refresh: vi.fn() });

    renderCalendar();

    const ownBookingButton = await screen.findByRole("button", { name: /Camila/ });
    const user = userEvent.setup();
    await user.click(ownBookingButton);

    expect(screen.queryByText("Reprogramar")).not.toBeInTheDocument();
    expect(screen.queryByText("Nuevo turno")).not.toBeInTheDocument();
  });

  it("un staff no puede arrastrar su propio turno a otro día (solo lectura)", async () => {
    const OWN_BOOKING = {
      ...BOOKING,
      id: "b2",
      staff_id: "staff-2",
      guest_name: "Camila",
      start_time: isoAt(0, 13),
      end_time: isoAt(0, 14),
    };
    setupApiGet([OWN_BOOKING]);
    mockUseProfile.mockReturnValue({ profile: staffProfile(), loading: false, refresh: vi.fn() });

    renderCalendar();

    const ownBookingButton = await screen.findByRole("button", { name: /Camila/ });
    const otherDaySlot = screen.getAllByLabelText("Crear turno 09:00")[1]; // otro día de la semana
    const otherDayColumn = otherDaySlot.parentElement!;

    dragTo(ownBookingButton, otherDayColumn, 300);

    expect(apiPostMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/reschedule"),
      expect.anything(),
    );
  });
});

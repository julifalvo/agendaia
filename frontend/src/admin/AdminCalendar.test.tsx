import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AdminCalendar } from "./AdminCalendar";

/**
 * Cubre solo lo que tiene implicancia de seguridad/UX (mismo criterio que el
 * resto de `admin/`, que tiene baja densidad de tests): un staff no puede
 * abrir el modal de crear/editar turno en una columna que no es la suya, ni
 * arrastrar un turno hacia la columna de otro profesional. La restricción
 * real la impone el backend (`_authorize_mutation`); esto prueba que la UI
 * respeta el mismo límite en vez de ofrecer una acción que el backend va a
 * rechazar.
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

/** Fake mínimo de DataTransfer — jsdom no lo implementa. */
function createDataTransfer() {
  let payload = "";
  return {
    setData: (_type: string, value: string) => {
      payload = value;
    },
    getData: () => payload,
    effectAllowed: "",
  };
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
  start_time: "2026-09-01T13:00:00.000Z",
  end_time: "2026-09-01T14:00:00.000Z",
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

function setupApiGet() {
  apiGetMock.mockImplementation(async (path: string) => {
    if (path === "/staff") return [STAFF_1, STAFF_2];
    if (path === "/services/mine") return [SERVICE];
    if (path.startsWith("/bookings?")) return [BOOKING];
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

describe("AdminCalendar", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    setupApiGet();
  });

  it("un staff no puede abrir el modal de crear turno en una columna ajena, sí en la propia", async () => {
    mockUseProfile.mockReturnValue({
      profile: {
        id: "staff-2",
        salon_id: "s1",
        full_name: "Beatriz",
        role: "staff",
        is_active: true,
        color: "#0000ff",
        email: null,
        phone: null,
      },
      loading: false,
      refresh: vi.fn(),
    });

    renderCalendar();

    await waitFor(() =>
      expect(screen.getAllByLabelText("Crear turno 09:00")).toHaveLength(2),
    );
    const [staffOneSlot, staffTwoSlot] = screen.getAllByLabelText("Crear turno 09:00");

    expect(staffOneSlot).toBeDisabled(); // columna de staff-1: no es la propia
    expect(staffTwoSlot).not.toBeDisabled(); // columna propia (staff-2)

    const user = userEvent.setup();
    await user.click(staffTwoSlot);
    expect(screen.getByText("Nuevo turno")).toBeInTheDocument();
  });

  it("clickear el turno de otro profesional no abre el modal de edición", async () => {
    mockUseProfile.mockReturnValue({
      profile: {
        id: "staff-2",
        salon_id: "s1",
        full_name: "Beatriz",
        role: "staff",
        is_active: true,
        color: "#0000ff",
        email: null,
        phone: null,
      },
      loading: false,
      refresh: vi.fn(),
    });

    renderCalendar();

    const bookingButton = await screen.findByRole("button", { name: /Manicura/ });
    const user = userEvent.setup();
    await user.click(bookingButton);

    expect(screen.queryByText("Reprogramar")).not.toBeInTheDocument();
  });

  it("el owner puede abrir el modal de crear en cualquier columna", async () => {
    mockUseProfile.mockReturnValue({
      profile: {
        id: "owner-1",
        salon_id: "s1",
        full_name: "Camila",
        role: "owner",
        is_active: true,
        color: null,
        email: null,
        phone: null,
      },
      loading: false,
      refresh: vi.fn(),
    });

    renderCalendar();

    await waitFor(() =>
      expect(screen.getAllByLabelText("Crear turno 09:00")).toHaveLength(2),
    );
    const slots = screen.getAllByLabelText("Crear turno 09:00");
    expect(slots[0]).not.toBeDisabled();
    expect(slots[1]).not.toBeDisabled();
  });

  it('el botón global "+ Nuevo turno" abre el modal de creación sin depender de un click en la grilla', async () => {
    mockUseProfile.mockReturnValue({
      profile: {
        id: "owner-1",
        salon_id: "s1",
        full_name: "Camila",
        role: "owner",
        is_active: true,
        color: null,
        email: null,
        phone: null,
      },
      loading: false,
      refresh: vi.fn(),
    });

    renderCalendar();
    await waitFor(() => expect(screen.getAllByLabelText("Crear turno 09:00")).toHaveLength(2));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ Nuevo turno" }));

    expect(screen.getByText("Nuevo turno")).toBeInTheDocument();
    expect(screen.getByLabelText("Profesional")).toBeInTheDocument();
    expect(screen.getByLabelText("Hora")).toBeInTheDocument();
  });

  it("un staff no puede arrastrar un turno propio hacia la columna de otro profesional", async () => {
    const OWN_BOOKING = { ...BOOKING, id: "b2", staff_id: "staff-2", guest_name: "Camila" };
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/staff") return [STAFF_1, STAFF_2];
      if (path === "/services/mine") return [SERVICE];
      if (path.startsWith("/bookings?")) return [BOOKING, OWN_BOOKING];
      if (path.startsWith("/salon/closures")) return [];
      if (path.startsWith("/admin/google-calendar/blocks")) return [];
      const scheduleMatch = /^\/staff\/[^/]+\/schedule\?date_from=([^&]+)/.exec(path);
      if (scheduleMatch) return workingBlock(scheduleMatch[1]);
      throw new Error(`apiGet no mockeado para: ${path}`);
    });
    mockUseProfile.mockReturnValue({
      profile: {
        id: "staff-2",
        salon_id: "s1",
        full_name: "Beatriz",
        role: "staff",
        is_active: true,
        color: "#0000ff",
        email: null,
        phone: null,
      },
      loading: false,
      refresh: vi.fn(),
    });

    renderCalendar();

    const ownBookingButton = await screen.findByRole("button", { name: /Camila/ });
    const otherColumnSlot = screen.getAllByLabelText("Crear turno 09:00")[0]; // columna de staff-1
    const otherColumn = otherColumnSlot.parentElement!;

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(ownBookingButton, { dataTransfer });
    fireEvent.dragOver(otherColumn, { dataTransfer });
    fireEvent.drop(otherColumn, { dataTransfer, clientY: 100 });

    expect(apiPostMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/reschedule"),
      expect.anything(),
    );
  });
});

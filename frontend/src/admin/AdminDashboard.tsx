import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiError } from "../lib/api";
import {
  cancelBooking as cancelBookingAction,
  rescheduleBooking,
  setBookingPaymentStatus,
  transitionBooking,
} from "./bookingActions";
import type { ApiBooking, ApiPublicStaff, ApiService, ApiStaff, PaymentStatus } from "../types/api";
import type { AppointmentStatus } from "../types/booking";

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });
const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency });

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No asistió",
};

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  pending: "bg-baby-pink/40 text-charcoal",
  confirmed: "bg-champagne/15 text-champagne",
  completed: "bg-charcoal/10 text-charcoal/70",
  cancelled: "bg-charcoal/5 text-charcoal/40 line-through",
  no_show: "bg-charcoal/5 text-charcoal/40",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Sin seña",
  pending: "Seña sin confirmar",
  paid: "Seña recibida",
};

const PAYMENT_STYLE: Record<PaymentStatus, string> = {
  unpaid: "bg-charcoal/5 text-charcoal/40",
  pending: "bg-red-50 text-red-600",
  paid: "bg-green-50 text-green-700",
};

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AdminDashboard() {
  const [date, setDate] = useState(todayISODate());
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [services, setServices] = useState<Record<string, ApiService>>({});
  const [staff, setStaff] = useState<Record<string, ApiStaff | ApiPublicStaff>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ date: "", time: "", staffId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59.999`);
      const params = new URLSearchParams({
        date_from: dayStart.toISOString(),
        date_to: dayEnd.toISOString(),
      });
      const [rows, serviceRows, staffRows] = await Promise.all([
        apiGet<ApiBooking[]>(`/bookings?${params}`),
        apiGet<ApiService[]>("/services/mine"),
        apiGet<ApiStaff[]>("/staff"),
      ]);
      setBookings(rows);
      setServices(Object.fromEntries(serviceRows.map((s) => [s.id, s])));
      setStaff(Object.fromEntries(staffRows.map((s) => [s.id, s])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la agenda");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...bookings].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [bookings],
  );

  async function transition(id: string, status: AppointmentStatus) {
    setBusyId(id);
    try {
      await transitionBooking(id, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el turno");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    try {
      await cancelBookingAction(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cancelar el turno");
    } finally {
      setBusyId(null);
    }
  }

  async function setPaymentStatus(id: string, paymentStatus: PaymentStatus) {
    setBusyId(id);
    try {
      await setBookingPaymentStatus(id, paymentStatus);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar la seña");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(booking: ApiBooking) {
    setEditingId(booking.id);
    setEditForm({
      date: toLocalDateInput(booking.start_time),
      time: toLocalTimeInput(booking.start_time),
      staffId: booking.staff_id,
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveReschedule(id: string) {
    if (!editForm.date || !editForm.time) return;
    setBusyId(id);
    setError(null);
    try {
      const startTime = new Date(`${editForm.date}T${editForm.time}:00`).toISOString();
      await rescheduleBooking(id, startTime, editForm.staffId);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reprogramar el turno");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-charcoal">Agenda</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none focus:border-champagne"
        />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      {!loading && sorted.length === 0 && (
        <p className="mt-6 text-sm text-charcoal/50">No hay turnos para este día.</p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {sorted.map((booking) => {
          const service = services[booking.service_id];
          const professional = staff[booking.staff_id];
          const clientLabel = booking.client_name ?? booking.guest_name ?? "Cliente";
          const isBusy = busyId === booking.id;

          return (
            <article
              key={booking.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-baby-pink/30 bg-white/60 p-4 shadow-sm backdrop-blur-md"
            >
              <div className="w-20 shrink-0">
                <p className="font-display text-lg text-charcoal">
                  {timeFormatter.format(new Date(booking.start_time))}
                </p>
              </div>

              <div className="min-w-[10rem] flex-1">
                <p className="text-charcoal">{service?.name ?? "Servicio"}</p>
                <p className="text-sm text-charcoal/60">
                  {clientLabel} · con {professional?.full_name ?? "profesional"}
                </p>
              </div>

              <p className="text-sm font-medium text-champagne">
                {service ? currencyFormatter(booking.currency).format(Number(booking.price)) : ""}
              </p>

              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[booking.status]}`}
              >
                {STATUS_LABEL[booking.status]}
              </span>

              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${PAYMENT_STYLE[booking.payment_status]}`}
              >
                {PAYMENT_LABEL[booking.payment_status]}
              </span>

              <div className="flex gap-2">
                {booking.payment_status === "paid" ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void setPaymentStatus(booking.id, "pending")}
                    className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                  >
                    Deshacer seña recibida
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void setPaymentStatus(booking.id, "paid")}
                    className="rounded-full bg-champagne px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Marcar seña recibida
                  </button>
                )}
                {booking.status === "pending" && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void transition(booking.id, "confirmed")}
                    className="rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-champagne hover:text-white disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                )}
                {booking.status === "confirmed" && (
                  <>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void transition(booking.id, "completed")}
                      className="rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-champagne hover:text-white disabled:opacity-50"
                    >
                      Completar
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void transition(booking.id, "no_show")}
                      className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                    >
                      No asistió
                    </button>
                  </>
                )}
                {(booking.status === "pending" || booking.status === "confirmed") && (
                  <>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => (editingId === booking.id ? cancelEdit() : startEdit(booking))}
                      className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                    >
                      {editingId === booking.id ? "Cerrar edición" : "Editar horario"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void cancel(booking.id)}
                      className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                )}
              </div>

              {editingId === booking.id && (
                <div className="flex w-full flex-wrap items-end gap-3 rounded-xl border border-champagne/30 bg-champagne/5 p-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-charcoal/60">Fecha</label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                      className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none focus:border-champagne"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-charcoal/60">Hora</label>
                    <input
                      type="time"
                      value={editForm.time}
                      onChange={(e) => setEditForm((f) => ({ ...f, time: e.target.value }))}
                      className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none focus:border-champagne"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-charcoal/60">Profesional</label>
                    <select
                      value={editForm.staffId}
                      onChange={(e) => setEditForm((f) => ({ ...f, staffId: e.target.value }))}
                      className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none focus:border-champagne"
                    >
                      {Object.values(staff).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void saveReschedule(booking.id)}
                    className="rounded-full bg-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {isBusy ? "Guardando..." : "Guardar cambio"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

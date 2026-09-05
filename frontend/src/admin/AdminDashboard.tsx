import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiError } from "../lib/api";
import { haptic } from "../lib/haptics";
import { cancelBooking as cancelBookingAction, setBookingPaymentStatus, transitionBooking } from "./bookingActions";
import { BookingEditModal } from "./BookingEditModal";
import { PAYMENT_LABEL, PAYMENT_STYLE, STATUS_LABEL, STATUS_STYLE, todayISODate } from "./bookingLabels";
import type { ApiBooking, ApiService, ApiStaff, PaymentStatus } from "../types/api";
import type { AppointmentStatus } from "../types/booking";

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });
const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency });

export function AdminDashboard() {
  const [date, setDate] = useState(todayISODate());
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [services, setServices] = useState<Record<string, ApiService>>({});
  const [staff, setStaff] = useState<Record<string, ApiStaff>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<ApiBooking | null>(null);

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
    haptic();
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
    haptic();
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-charcoal">Agenda</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
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
              className="tap-card flex flex-col gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4 shadow-sm backdrop-blur-md sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
            >
              <div className="flex items-center gap-4">
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
              </div>

              <div className="flex flex-wrap items-center gap-2">
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
              </div>

              <div className="flex flex-wrap gap-2">
                {booking.payment_status === "paid" ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void setPaymentStatus(booking.id, "pending")}
                    className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                  >
                    Deshacer seña recibida
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void setPaymentStatus(booking.id, "paid")}
                    className="tap-btn rounded-full bg-gradient-to-r from-bubblegum to-champagne px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Marcar seña recibida
                  </button>
                )}
                {booking.status === "pending" && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void transition(booking.id, "confirmed")}
                    className="tap-btn rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
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
                      className="tap-btn rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
                    >
                      Completar
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void transition(booking.id, "no_show")}
                      className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
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
                      onClick={() => setEditingBooking(booking)}
                      className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                    >
                      Editar horario
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void cancel(booking.id)}
                      className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {editingBooking && (
        <BookingEditModal
          booking={editingBooking}
          staffOptions={Object.values(staff)}
          onClose={() => setEditingBooking(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

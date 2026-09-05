import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, ApiError } from "../lib/api";
import { haptic } from "../lib/haptics";
import { useProfile } from "../hooks/useProfileContext";
import { cancelBooking as cancelBookingAction, setBookingPaymentStatus, transitionBooking } from "./bookingActions";
import { BookingEditModal } from "./BookingEditModal";
import {
  PAYMENT_LABEL,
  PAYMENT_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  toLocalDateInput,
  toLocalISODate,
  todayISODate,
} from "./bookingLabels";
import type { ApiBooking, ApiService, ApiStaff, PaymentStatus } from "../types/api";
import type { AppointmentStatus } from "../types/booking";

/**
 * Rango de días hacia adelante que se trae de una sola vez, para que un
 * turno reservado para la semana que viene aparezca en la lista sin que el
 * profesional tenga que adivinar la fecha y elegirla a mano.
 */
const RANGE_DAYS = 60;

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency });

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayLabel(iso: string, today: string, tomorrow: string): string {
  if (iso === today) return "Hoy";
  if (iso === tomorrow) return "Mañana";
  return capitalize(dayFormatter.format(new Date(`${iso}T00:00:00`)));
}

export function AdminMyBookings() {
  const { profile } = useProfile();
  const [onlyMine, setOnlyMine] = useState(profile?.role === "staff");
  const [onlyPending, setOnlyPending] = useState(false);
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [services, setServices] = useState<Record<string, ApiService>>({});
  const [staff, setStaff] = useState<Record<string, ApiStaff>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingBooking, setEditingBooking] = useState<ApiBooking | null>(null);
  const todayRef = useRef<HTMLElement | null>(null);

  const today = todayISODate();
  const rangeEnd = useMemo(() => addDaysISO(today, RANGE_DAYS), [today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date_from: new Date(`${today}T00:00:00`).toISOString(),
        date_to: new Date(`${rangeEnd}T23:59:59.999`).toISOString(),
        limit: "500",
      });
      const [rows, serviceRows, staffRows] = await Promise.all([
        apiGet<ApiBooking[]>(`/bookings?${params}`),
        apiGet<ApiService[]>("/services/mine"),
        apiGet<ApiStaff[]>("/staff"),
      ]);
      setBookings(rows.filter((b) => b.status !== "cancelled"));
      setServices(Object.fromEntries(serviceRows.map((s) => [s.id, s])));
      setStaff(Object.fromEntries(staffRows.map((s) => [s.id, s])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los turnos");
    } finally {
      setLoading(false);
    }
  }, [today, rangeEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const scoped = useMemo(
    () => (onlyMine && profile ? bookings.filter((b) => b.staff_id === profile.id) : bookings),
    [bookings, onlyMine, profile],
  );

  const pendingCount = useMemo(() => scoped.filter((b) => b.status === "pending").length, [scoped]);

  const days = useMemo(() => {
    const visible = onlyPending ? scoped.filter((b) => b.status === "pending") : scoped;
    const byDate = new Map<string, ApiBooking[]>();
    for (const booking of visible) {
      const key = toLocalDateInput(booking.start_time);
      const bucket = byDate.get(key);
      if (bucket) bucket.push(booking);
      else byDate.set(key, [booking]);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => a.start_time.localeCompare(b.start_time)),
      }));
  }, [scoped, onlyPending]);

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

  const tomorrow = addDaysISO(today, 1);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-charcoal">Mis turnos</h2>
        {days.some((d) => d.date === today) && (
          <button
            type="button"
            onClick={() => todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="tap-btn rounded-full border border-charcoal/15 px-4 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            Ir a hoy
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-charcoal/15 bg-white/60 p-1">
          <button
            type="button"
            onClick={() => setOnlyMine(true)}
            className={`tap-btn rounded-full px-4 py-1.5 text-sm transition-all ${
              onlyMine
                ? "bg-gradient-to-r from-bubblegum to-champagne text-white"
                : "text-charcoal/60 hover:text-charcoal"
            }`}
          >
            Solo mis turnos
          </button>
          <button
            type="button"
            onClick={() => setOnlyMine(false)}
            className={`tap-btn rounded-full px-4 py-1.5 text-sm transition-all ${
              !onlyMine
                ? "bg-gradient-to-r from-bubblegum to-champagne text-white"
                : "text-charcoal/60 hover:text-charcoal"
            }`}
          >
            Todo el salón
          </button>
        </div>

        <div className="inline-flex rounded-full border border-charcoal/15 bg-white/60 p-1">
          <button
            type="button"
            onClick={() => setOnlyPending(false)}
            className={`tap-btn rounded-full px-4 py-1.5 text-sm transition-all ${
              !onlyPending
                ? "bg-gradient-to-r from-bubblegum to-champagne text-white"
                : "text-charcoal/60 hover:text-charcoal"
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setOnlyPending(true)}
            className={`tap-btn rounded-full px-4 py-1.5 text-sm transition-all ${
              onlyPending
                ? "bg-gradient-to-r from-bubblegum to-champagne text-white"
                : "text-charcoal/60 hover:text-charcoal"
            }`}
          >
            Pendientes de confirmar
          </button>
        </div>
      </div>

      {!loading && pendingCount > 0 && !onlyPending && (
        <button
          type="button"
          onClick={() => setOnlyPending(true)}
          className="tap-btn mt-4 flex w-full items-center justify-between rounded-2xl border border-champagne/40 bg-champagne/10 px-4 py-3 text-left text-sm text-charcoal transition-colors hover:bg-champagne/20"
        >
          <span>
            Tenés <strong>{pendingCount}</strong> turno{pendingCount === 1 ? "" : "s"} pendiente
            {pendingCount === 1 ? "" : "s"} de confirmar en los próximos {RANGE_DAYS} días.
          </span>
          <span className="shrink-0 text-champagne">Ver →</span>
        </button>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      {!loading && days.length === 0 && (
        <p className="mt-6 text-sm text-charcoal/50">
          {onlyPending
            ? "No hay turnos pendientes de confirmar."
            : onlyMine
              ? "No tenés turnos en los próximos días."
              : "No hay turnos en los próximos días."}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-5">
        {days.map((day) => (
          <section key={day.date} ref={day.date === today ? todayRef : undefined}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm text-charcoal">{dayLabel(day.date, today, tomorrow)}</h3>
              <span className="text-xs text-charcoal/40">
                {day.items.length} turno{day.items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {day.items.map((booking) => {
                const service = services[booking.service_id];
                const professional = staff[booking.staff_id];
                const clientLabel = booking.client_name ?? booking.guest_name ?? "Cliente";
                const isBusy = busyId === booking.id;

                return (
                  <article
                    key={booking.id}
                    className="tap-card flex flex-col gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4 shadow-sm backdrop-blur-md sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
                  >
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="shrink-0">
                        <p className="whitespace-nowrap font-display text-lg text-charcoal">
                          {timeFormatter.format(new Date(booking.start_time))}
                        </p>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-charcoal">{service?.name ?? "Servicio"}</p>
                        <p className="text-sm text-charcoal/60">
                          {clientLabel}
                          {!onlyMine && <> · con {professional?.full_name ?? "profesional"}</>}
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
          </section>
        ))}
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

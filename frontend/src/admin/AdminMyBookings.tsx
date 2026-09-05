import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, ApiError } from "../lib/api";
import { useProfile } from "../hooks/useProfileContext";
import {
  PAYMENT_LABEL,
  PAYMENT_STYLE,
  STATUS_LABEL,
  STATUS_STYLE,
  toLocalDateInput,
  todayISODate,
} from "./bookingLabels";
import type { ApiBooking, ApiService } from "../types/api";

/**
 * Índice de los propios turnos agrupados por día, para no tener que ir
 * cambiando la fecha de a uno en "Agenda" solo para ver cuántos turnos hay
 * cada día. Siempre filtrado al profesional logueado (`staff_id` propio) —
 * ver "Agenda"/"Calendario" para la vista compartida de todo el salón.
 */

const RANGE_DAYS = 60;

const timeFormatter = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function AdminMyBookings() {
  const { profile } = useProfile();
  const [rangeStart, setRangeStart] = useState(todayISODate());
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [services, setServices] = useState<Record<string, ApiService>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeEnd = useMemo(() => addDaysISO(rangeStart, RANGE_DAYS), [rangeStart]);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        staff_id: profile.id,
        date_from: new Date(`${rangeStart}T00:00:00`).toISOString(),
        date_to: new Date(`${rangeEnd}T23:59:59.999`).toISOString(),
        limit: "500",
      });
      const [rows, serviceRows] = await Promise.all([
        apiGet<ApiBooking[]>(`/bookings?${params}`),
        apiGet<ApiService[]>("/services/mine"),
      ]);
      setBookings(rows.filter((b) => b.status !== "cancelled"));
      setServices(Object.fromEntries(serviceRows.map((s) => [s.id, s])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar tus turnos");
    } finally {
      setLoading(false);
    }
  }, [profile, rangeStart, rangeEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const byDate = new Map<string, ApiBooking[]>();
    for (const booking of bookings) {
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
  }, [bookings]);

  const today = todayISODate();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-charcoal">Mis turnos</h2>
        {rangeStart !== today && (
          <button
            type="button"
            onClick={() => setRangeStart(today)}
            className="tap-btn rounded-full border border-charcoal/15 px-4 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            Volver a hoy
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-charcoal/50">
        Próximos {RANGE_DAYS} días · {bookings.length} turno{bookings.length === 1 ? "" : "s"} en total
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      {!loading && days.length === 0 && (
        <p className="mt-6 text-sm text-charcoal/50">No tenés turnos en este período.</p>
      )}

      <div className="mt-6 flex flex-col gap-5">
        {days.map((day) => (
          <section key={day.date}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm text-charcoal">
                {capitalize(dayFormatter.format(new Date(`${day.date}T00:00:00`)))}
              </h3>
              {day.date === today && (
                <span className="rounded-full bg-champagne/15 px-2 py-0.5 text-[10px] font-medium text-champagne">
                  Hoy
                </span>
              )}
              <span className="text-xs text-charcoal/40">
                {day.items.length} turno{day.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {day.items.map((booking) => {
                const service = services[booking.service_id];
                const clientLabel = booking.client_name ?? booking.guest_name ?? "Cliente";
                return (
                  <div
                    key={booking.id}
                    className="tap-card flex flex-wrap items-center gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-3 shadow-sm backdrop-blur-md"
                  >
                    <p className="w-14 shrink-0 font-display text-charcoal">
                      {timeFormatter.format(new Date(booking.start_time))}
                    </p>
                    <div className="min-w-[8rem] flex-1">
                      <p className="text-sm text-charcoal">{service?.name ?? "Servicio"}</p>
                      <p className="text-xs text-charcoal/55">{clientLabel}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[booking.status]}`}
                    >
                      {STATUS_LABEL[booking.status]}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${PAYMENT_STYLE[booking.payment_status]}`}
                    >
                      {PAYMENT_LABEL[booking.payment_status]}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

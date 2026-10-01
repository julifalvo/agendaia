import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { apiGet, ApiError } from "../lib/api";
import { STATUS_LABEL, STATUS_STYLE } from "../admin/bookingLabels";
import type { AppointmentStatus } from "../types/booking";

interface PublicBooking {
  id: string;
  salon_name: string;
  service_name: string;
  staff_name: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * "Ver mi turno" — link público del mail de confirmación (ver
 * `services/booking_links.py` en el backend). Sin sesión: la única
 * protección es el token `t` de la URL, que el backend valida con HMAC.
 * `noindex` en `index.html` no aplica por ruta, así que la etiqueta se pone
 * acá mismo vía `document.title`/meta — ver el `useEffect` de abajo.
 */
export function MyBooking() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t");

  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!appointmentId || !token) {
      setError("Este link no es válido.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiGet<PublicBooking>(
      `/bookings/${appointmentId}/public?t=${encodeURIComponent(token)}`,
    )
      .then((data) => {
        if (!cancelled) setBooking(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setError("No encontramos ese turno. El link puede haber vencido o ser incorrecto.");
        } else {
          setError("No pudimos cargar el turno. Probá de nuevo en un rato.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, token]);

  return (
    <main className="min-h-screen bg-soft-white">
      <div className="safe-top sticky top-0 z-10 border-b border-charcoal/8 bg-soft-white/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-xl items-center justify-between px-5 py-3 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-5 py-10 sm:px-6">
        {loading && <p className="text-sm text-charcoal/50">Cargando tu turno...</p>}

        {!loading && error && (
          <div className="rounded-2xl bg-charcoal/5 p-6 text-center">
            <p className="text-sm text-charcoal/70">{error}</p>
          </div>
        )}

        {!loading && booking && (
          <div className="rounded-2xl border border-charcoal/8 bg-white p-6 shadow-sm">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[booking.status]}`}
            >
              {STATUS_LABEL[booking.status]}
            </span>

            <h1 className="mt-4 font-display text-2xl text-charcoal">
              {booking.service_name}
            </h1>
            <p className="mt-1 text-sm text-charcoal/60">{booking.salon_name}</p>

            <div className="mt-6 flex flex-col gap-2 text-sm text-charcoal/80">
              <p className="capitalize">{dateFormatter.format(new Date(booking.start_time))}</p>
              <p>
                {timeFormatter.format(new Date(booking.start_time))} —{" "}
                {timeFormatter.format(new Date(booking.end_time))}
              </p>
              <p>Con {booking.staff_name}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

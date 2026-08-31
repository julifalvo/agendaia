import { useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import {
  cancelBooking,
  rescheduleBooking,
  setBookingPaymentStatus,
  transitionBooking,
} from "./bookingActions";
import { STATUS_LABEL, toLocalDateInput, toLocalTimeInput } from "./bookingLabels";
import type { ApiBooking, ApiStaff } from "../types/api";
import type { AppointmentStatus } from "../types/booking";

interface BookingEditModalProps {
  booking: ApiBooking;
  staffOptions: ApiStaff[];
  onClose: () => void;
  /** Refresca la lista/grilla del padre tras una mutación exitosa. */
  onChanged: () => void | Promise<void>;
}

/**
 * Modal de edición de un turno existente: reprogramar (fecha/hora/staff),
 * cambiar de estado, marcar seña y cancelar. Antes vivía inline en
 * `AdminCalendar`; `AdminDashboard` reimplementaba una versión casi idéntica
 * del formulario de reprogramar. Se unificó acá para que ambas vistas
 * compartan la misma lógica de mutación (busy/error incluidos).
 */
export function BookingEditModal({ booking, staffOptions, onClose, onChanged }: BookingEditModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: toLocalDateInput(booking.start_time),
    time: toLocalTimeInput(booking.start_time),
    staffId: booking.staff_id,
  });

  async function run(action: () => Promise<ApiBooking>, closeAfter: boolean) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      if (closeAfter) onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el turno");
    } finally {
      setBusy(false);
    }
  }

  function handleTransition(status: AppointmentStatus) {
    return run(() => transitionBooking(booking.id, status), true);
  }

  function handleCancel() {
    return run(() => cancelBooking(booking.id), true);
  }

  function handlePayment(paid: boolean) {
    return run(() => setBookingPaymentStatus(booking.id, paid ? "paid" : "pending"), true);
  }

  function handleReschedule(event: FormEvent) {
    event.preventDefault();
    const startTime = new Date(`${form.date}T${form.time}:00`).toISOString();
    return run(() => rescheduleBooking(booking.id, startTime, form.staffId), true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-charcoal">{STATUS_LABEL[booking.status]}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-charcoal/40 hover:text-charcoal"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-1 text-sm text-charcoal/60">
          {booking.client_name ?? booking.guest_name ?? "Cliente"}
        </p>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <form onSubmit={(e) => void handleReschedule(e)} className="mt-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="flex-1 rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal"
            />
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal"
            />
          </div>
          <select
            value={form.staffId}
            onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))}
            className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal"
          >
            {staffOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="self-start rounded-full bg-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Reprogramar
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {booking.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTransition("confirmed")}
              className="rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal disabled:opacity-50"
            >
              Confirmar
            </button>
          )}
          {booking.status === "confirmed" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTransition("completed")}
                className="rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal disabled:opacity-50"
              >
                Completar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTransition("no_show")}
                className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 disabled:opacity-50"
              >
                No asistió
              </button>
            </>
          )}
          {booking.payment_status === "paid" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePayment(false)}
              className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 disabled:opacity-50"
            >
              Deshacer seña
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePayment(true)}
              className="rounded-full bg-champagne px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Marcar seña recibida
            </button>
          )}
          {(booking.status === "pending" || booking.status === "confirmed") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCancel()}
              className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 disabled:opacity-50"
            >
              Cancelar turno
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

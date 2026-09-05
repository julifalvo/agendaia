import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
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
 * `AdminCalendar`; `AdminMyBookings` reimplementaba una versión casi idéntica
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/30 sm:items-center sm:p-4"
    >
      {/* En mobile sube como bottom-sheet nativo (solo esquinas de arriba
          redondeadas, pegado a los bordes) — en desktop es el modal
          centrado de siempre. `stopPropagation` evita que un tap adentro
          cierre el modal por el onClick del backdrop. */}
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: "100%" }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="safe-bottom w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-charcoal">{STATUS_LABEL[booking.status]}</h3>
          <button
            type="button"
            onClick={onClose}
            className="tap-btn text-sm text-charcoal/40 hover:text-charcoal"
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
              className="flex-1 rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
            />
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
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
            className="tap-btn self-start rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
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
              className="tap-btn rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
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
                className="tap-btn rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
              >
                Completar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTransition("no_show")}
                className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
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
              className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
            >
              Deshacer seña
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePayment(true)}
              className="tap-btn rounded-full bg-gradient-to-r from-bubblegum to-champagne px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Marcar seña recibida
            </button>
          )}
          {(booking.status === "pending" || booking.status === "confirmed") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCancel()}
              className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
            >
              Cancelar turno
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

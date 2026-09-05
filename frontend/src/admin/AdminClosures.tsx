import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api";
import { useProfile } from "../hooks/useProfileContext";
import type { ApiSalonClosure } from "../types/api";
import { todayISODate } from "./bookingLabels";

const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const EMPTY_FORM = { startDate: todayISODate(), endDate: todayISODate(), reason: "" };

export function AdminClosures() {
  const { profile } = useProfile();
  const isOwner = profile?.role === "owner";

  const [closures, setClosures] = useState<ApiSalonClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const from = new Date();
      from.setMonth(from.getMonth() - 1);
      setClosures(
        await apiGet<ApiSalonClosure[]>(`/salon/closures?date_from=${from.toISOString()}`),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los cierres");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const startsAt = new Date(`${form.startDate}T00:00:00`).toISOString();
      const endsAt = new Date(`${form.endDate}T23:59:59.999`).toISOString();
      await apiPost("/salon/closures", { starts_at: startsAt, ends_at: endsAt, reason: form.reason || null });
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el cierre");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiDelete(`/salon/closures/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el cierre");
    } finally {
      setBusyId(null);
    }
  }

  const now = new Date();
  const upcoming = closures.filter((c) => new Date(c.ends_at) >= now);
  const past = closures.filter((c) => new Date(c.ends_at) < now);

  return (
    <div>
      <h2 className="font-display text-2xl text-charcoal">Bloquear agenda</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        Cerrá la agenda completa del salón para un rango de fechas (feriado, vacaciones): ningún
        profesional queda disponible para reservas durante ese período.
      </p>

      {isOwner && (
        <form
          onSubmit={handleSubmit}
          className="tap-card mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-charcoal/60">Desde</label>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-charcoal/60">Hasta</label>
            <input
              type="date"
              required
              value={form.endDate}
              min={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-charcoal/60">Motivo (opcional)</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Feriado, vacaciones..."
              className="w-full rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="tap-btn rounded-full bg-baby-pink px-4 py-2 text-sm font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
          >
            {submitting ? "Bloqueando..." : "Bloquear agenda"}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      {!loading && upcoming.length === 0 && (
        <p className="mt-6 text-sm text-charcoal/50">No hay cierres de agenda cargados.</p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {upcoming.map((closure) => (
          <div
            key={closure.id}
            className="tap-card flex items-center justify-between rounded-2xl border border-charcoal/10 bg-white/60 p-4"
          >
            <div>
              <p className="text-charcoal">
                {dateTimeFormatter.format(new Date(closure.starts_at))} →{" "}
                {dateTimeFormatter.format(new Date(closure.ends_at))}
              </p>
              {closure.reason && <p className="text-sm text-charcoal/60">{closure.reason}</p>}
            </div>
            {isOwner && (
              <button
                type="button"
                disabled={busyId === closure.id}
                onClick={() => void remove(closure.id)}
                className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
              >
                Quitar
              </button>
            )}
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <div className="mt-8">
          <p className="text-xs uppercase tracking-wide text-charcoal/40">Cierres pasados</p>
          <div className="mt-2 flex flex-col gap-2 opacity-50">
            {past.map((closure) => (
              <div key={closure.id} className="rounded-2xl border border-charcoal/10 bg-white/60 p-4">
                <p className="text-charcoal">
                  {dateTimeFormatter.format(new Date(closure.starts_at))} →{" "}
                  {dateTimeFormatter.format(new Date(closure.ends_at))}
                </p>
                {closure.reason && <p className="text-sm text-charcoal/60">{closure.reason}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

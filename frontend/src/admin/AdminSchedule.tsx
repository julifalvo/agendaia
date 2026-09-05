import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPut, ApiError } from "../lib/api";
import type { ApiScheduleBlock, ScheduleBlockInput } from "../types/api";
import { todayISODate } from "./bookingLabels";

interface Row {
  start_time: string;
  end_time: string;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function AdminSchedule() {
  const { staffId } = useParams<{ staffId: string }>();
  const [date, setDate] = useState(todayISODate());
  const [rows, setRows] = useState<Row[]>([]);
  const [upcoming, setUpcoming] = useState<ApiScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rangeFrom = todayISODate();
  const rangeTo = useMemo(() => addDaysISO(rangeFrom, 90), [rangeFrom]);

  async function loadUpcoming() {
    if (!staffId) return;
    try {
      const blocks = await apiGet<ApiScheduleBlock[]>(
        `/staff/${staffId}/schedule?date_from=${rangeFrom}&date_to=${rangeTo}`,
      );
      setUpcoming(blocks);
    } catch {
      // No es crítico: la vista del día puntual sigue funcionando igual.
    }
  }

  async function loadDay(day: string) {
    if (!staffId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const blocks = await apiGet<ApiScheduleBlock[]>(
        `/staff/${staffId}/schedule?date_from=${day}&date_to=${day}`,
      );
      setRows(blocks.map((b) => ({ start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el horario");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDay(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, date]);

  useEffect(() => {
    void loadUpcoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  function addRow() {
    setRows((prev) => [...prev, { start_time: "09:00", end_time: "18:00" }]);
  }

  function updateRow(index: number, field: "start_time" | "end_time", value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!staffId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const blocks: ScheduleBlockInput[] = rows.map((r) => ({
        start_time: r.start_time,
        end_time: r.end_time,
      }));
      await apiPut(`/staff/${staffId}/schedule/${date}`, { blocks });
      setSaved(true);
      await loadUpcoming();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el horario");
    } finally {
      setSaving(false);
    }
  }

  const upcomingByDate = useMemo(() => {
    const map = new Map<string, ApiScheduleBlock[]>();
    for (const block of upcoming) {
      const list = map.get(block.date) ?? [];
      list.push(block);
      map.set(block.date, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [upcoming]);

  return (
    <div>
      <Link to="/admin/staff" className="text-sm text-charcoal/50 underline-offset-2 hover:underline">
        ← Volver a Staff
      </Link>
      <h2 className="mt-2 font-display text-2xl text-charcoal">Horario por día</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        Elegí un día puntual del calendario y cargá las horas que trabaja ese día. No se repite
        automáticamente: cada día se carga por separado.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <input
          type="date"
          value={date}
          min={rangeFrom}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none focus:border-champagne"
        />
        <span className="text-sm capitalize text-charcoal/60">{formatDateLabel(date)}</span>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && <p className="mt-3 text-sm text-champagne">Horario guardado.</p>}
      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      {!loading && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="rounded-2xl border border-baby-pink/30 bg-white/60 p-4">
            <div className="flex items-center justify-between">
              <p className="font-display capitalize text-charcoal">{formatDateLabel(date)}</p>
              <button
                type="button"
                onClick={addRow}
                className="text-xs text-champagne underline-offset-2 hover:underline"
              >
                + agregar bloque
              </button>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              {rows.length === 0 && (
                <p className="text-sm text-charcoal/40">No trabaja este día.</p>
              )}
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={row.start_time}
                    onChange={(e) => updateRow(index, "start_time", e.target.value)}
                    className="rounded-xl border border-charcoal/15 bg-white px-2 py-1 text-sm text-charcoal outline-none focus:border-champagne"
                  />
                  <span className="text-charcoal/40">a</span>
                  <input
                    type="time"
                    value={row.end_time}
                    onChange={(e) => updateRow(index, "end_time", e.target.value)}
                    className="rounded-xl border border-charcoal/15 bg-white px-2 py-1 text-sm text-charcoal outline-none focus:border-champagne"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs text-charcoal/40 hover:text-red-600"
                  >
                    quitar
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="self-start rounded-full bg-baby-pink px-5 py-2 text-sm font-medium text-charcoal transition-colors hover:bg-champagne hover:text-white disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar este día"}
          </button>

          {upcomingByDate.length > 0 && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-charcoal/40">
                Próximos días con horario cargado
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {upcomingByDate.map(([day, blocks]) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDate(day)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      day === date
                        ? "border-champagne bg-champagne/10 text-champagne"
                        : "border-charcoal/10 text-charcoal/70 hover:border-baby-pink"
                    }`}
                  >
                    <span className="capitalize">{formatDateLabel(day)}</span>
                    <span className="text-xs text-charcoal/50">
                      {blocks.map((b) => `${b.start_time.slice(0, 5)}-${b.end_time.slice(0, 5)}`).join(", ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

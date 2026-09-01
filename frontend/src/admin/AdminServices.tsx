import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from "../lib/api";
import type { ApiService, ServiceInput, ServiceUpdateInput } from "../types/api";

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency });

const EMPTY_FORM = { name: "", description: "", duration_minutes: "60", price: "" };

export function AdminServices() {
  const [services, setServices] = useState<ApiService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setServices(await apiGet<ApiService[]>("/services/mine"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los servicios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function startEdit(service: ApiService) {
    setEditingId(service.id);
    setForm({
      name: service.name,
      description: service.description ?? "",
      duration_minutes: String(service.duration_minutes),
      price: service.price,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editingId) {
        const payload: ServiceUpdateInput = {
          name: form.name,
          description: form.description || null,
          duration_minutes: Number(form.duration_minutes),
          price: form.price,
        };
        await apiPatch(`/services/${editingId}`, payload);
      } else {
        const payload: ServiceInput = {
          name: form.name,
          description: form.description || null,
          duration_minutes: Number(form.duration_minutes),
          price: form.price,
        };
        await apiPost("/services", payload);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el servicio");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(service: ApiService) {
    setBusyId(service.id);
    try {
      if (service.is_active) {
        await apiDelete(`/services/${service.id}`);
      } else {
        await apiPatch(`/services/${service.id}`, { is_active: true });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el servicio");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteForever(service: ApiService) {
    if (!window.confirm(`¿Eliminar "${service.name}" definitivamente? Esta acción no se puede deshacer.`)) {
      return;
    }
    setBusyId(service.id);
    setError(null);
    try {
      await apiDelete(`/services/${service.id}/permanent`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el servicio");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2 className="font-display text-2xl text-charcoal">Servicios</h2>

      <form
        onSubmit={handleSubmit}
        className="tap-card mt-6 flex flex-col gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-charcoal/60">Nombre</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-charcoal/60">Duración (min)</label>
            <input
              type="number"
              min={5}
              max={600}
              required
              value={form.duration_minutes}
              onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
              className="w-28 rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-charcoal/60">Precio (ARS)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              className="w-32 rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-charcoal/60">Nota (en qué consiste el servicio)</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            placeholder="Este servicio consiste en..."
            className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none focus:border-champagne"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="tap-btn rounded-full bg-baby-pink px-4 py-2 text-sm font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
          >
            {submitting ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar servicio"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="tap-btn rounded-full border border-charcoal/20 px-4 py-2 text-sm text-charcoal/70 transition-colors hover:border-charcoal/40"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      <div className="mt-6 flex flex-col gap-2">
        {services.map((service) => (
          <div
            key={service.id}
            className={`tap-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-charcoal/10 bg-white/60 p-4 ${
              !service.is_active ? "opacity-50" : ""
            }`}
          >
            <div>
              <p className="text-charcoal">{service.name}</p>
              <p className="text-sm text-charcoal/60">
                {service.duration_minutes} min ·{" "}
                {currencyFormatter(service.currency).format(Number(service.price))}
              </p>
              {service.description && (
                <p className="mt-1 max-w-md text-sm text-charcoal/50">{service.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === service.id}
                onClick={() => startEdit(service)}
                className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
              >
                Editar
              </button>
              <button
                type="button"
                disabled={busyId === service.id}
                onClick={() => void toggleActive(service)}
                className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
              >
                {service.is_active ? "Dar de baja" : "Reactivar"}
              </button>
              <button
                type="button"
                disabled={busyId === service.id}
                onClick={() => void deleteForever(service)}
                className="tap-btn rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:border-red-400 disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

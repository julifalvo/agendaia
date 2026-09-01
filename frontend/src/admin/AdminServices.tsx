import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from "../lib/api";
import type {
  ApiCategory,
  ApiService,
  CategoryInput,
  ServiceInput,
  ServiceUpdateInput,
} from "../types/api";

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency });

const UNCATEGORIZED = "__uncategorized__";

const EMPTY_FORM = {
  name: "",
  description: "",
  duration_minutes: "60",
  price: "",
  category_id: "",
};

export function AdminServices() {
  const [services, setServices] = useState<ApiService[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [categorySubmitting, setCategorySubmitting] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [servicesRes, categoriesRes] = await Promise.all([
        apiGet<ApiService[]>("/services/mine"),
        apiGet<ApiCategory[]>("/categories/mine"),
      ]);
      setServices(servicesRes);
      setCategories(categoriesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los servicios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const groupedServices = useMemo(() => {
    const byCategory = new Map<string, ApiService[]>();
    for (const service of services) {
      const key = service.category_id ?? UNCATEGORIZED;
      const bucket = byCategory.get(key);
      if (bucket) bucket.push(service);
      else byCategory.set(key, [service]);
    }
    const orderedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const groups: { key: string; label: string; services: ApiService[] }[] = [];
    for (const category of orderedCategories) {
      const bucket = byCategory.get(category.id);
      if (bucket) groups.push({ key: category.id, label: category.name, services: bucket });
    }
    const uncategorized = byCategory.get(UNCATEGORIZED);
    if (uncategorized) {
      groups.push({ key: UNCATEGORIZED, label: "Sin categoría", services: uncategorized });
    }
    return groups;
  }, [services, categories]);

  function startEdit(service: ApiService) {
    setEditingId(service.id);
    setForm({
      name: service.name,
      description: service.description ?? "",
      duration_minutes: String(service.duration_minutes),
      price: service.price,
      category_id: service.category_id ?? "",
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
          category_id: form.category_id || null,
        };
        await apiPatch(`/services/${editingId}`, payload);
      } else {
        const payload: ServiceInput = {
          name: form.name,
          description: form.description || null,
          duration_minutes: Number(form.duration_minutes),
          price: form.price,
          category_id: form.category_id || null,
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

  async function handleAddCategory(event: FormEvent) {
    event.preventDefault();
    if (!newCategoryName.trim()) return;
    setError(null);
    setCategorySubmitting(true);
    try {
      const payload: CategoryInput = {
        name: newCategoryName.trim(),
        sort_order: categories.length,
      };
      await apiPost("/categories", payload);
      setNewCategoryName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setCategorySubmitting(false);
    }
  }

  function startEditCategory(category: ApiCategory) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  }

  async function saveEditingCategory(categoryId: string) {
    if (!editingCategoryName.trim()) return;
    setCategoryBusyId(categoryId);
    setError(null);
    try {
      await apiPatch(`/categories/${categoryId}`, { name: editingCategoryName.trim() });
      setEditingCategoryId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo renombrar la categoría");
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function deleteCategory(category: ApiCategory) {
    if (
      !window.confirm(
        `¿Eliminar la categoría "${category.name}"? Los servicios que la usan quedan sin categoría.`,
      )
    ) {
      return;
    }
    setCategoryBusyId(category.id);
    setError(null);
    try {
      await apiDelete(`/categories/${category.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la categoría");
    } finally {
      setCategoryBusyId(null);
    }
  }

  return (
    <div>
      <h2 className="font-display text-2xl text-charcoal">Servicios</h2>

      {/* Categorías / sectores */}
      <div className="tap-card mt-6 rounded-2xl border border-baby-pink/30 bg-white/60 p-4">
        <h3 className="text-sm font-medium text-charcoal/70">Categorías</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex items-center gap-1.5 rounded-full border border-charcoal/15 bg-white px-3 py-1.5"
            >
              {editingCategoryId === category.id ? (
                <input
                  autoFocus
                  value={editingCategoryName}
                  onChange={(e) => setEditingCategoryName(e.target.value)}
                  onBlur={() => void saveEditingCategory(category.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEditingCategory(category.id);
                    if (e.key === "Escape") setEditingCategoryId(null);
                  }}
                  className="w-28 rounded-md border border-champagne/50 px-1.5 py-0.5 text-xs text-charcoal outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditCategory(category)}
                  disabled={categoryBusyId === category.id}
                  className="tap-btn text-xs font-medium text-charcoal"
                >
                  {category.name}
                </button>
              )}
              <button
                type="button"
                disabled={categoryBusyId === category.id}
                onClick={() => void deleteCategory(category)}
                aria-label={`Eliminar categoría ${category.name}`}
                className="tap-btn text-xs text-charcoal/35 transition-colors hover:text-red-500 disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="text-xs text-charcoal/45">Todavía no creaste categorías.</p>
          )}
        </div>
        <form onSubmit={handleAddCategory} className="mt-3 flex gap-2">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Nueva categoría (p. ej. Uñas, Peluquería)"
            className="w-64 rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
          />
          <button
            type="submit"
            disabled={categorySubmitting || !newCategoryName.trim()}
            className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
          >
            Agregar
          </button>
        </form>
      </div>

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
            <label className="text-xs text-charcoal/60">Categoría</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            >
              <option value="">Sin categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
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

      <div className="mt-6 flex flex-col gap-6">
        {groupedServices.map((group) => (
          <div key={group.key}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-charcoal/70">
              <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-bubblegum to-champagne" />
              {group.label}
            </h3>
            <div className="flex flex-col gap-2">
              {group.services.map((service) => (
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
        ))}
      </div>
    </div>
  );
}

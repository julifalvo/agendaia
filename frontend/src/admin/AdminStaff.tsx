import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost, apiPut, apiDelete, ApiError } from "../lib/api";
import type { ApiService, ApiStaff, StaffInviteInput } from "../types/api";

const EMPTY_INVITE: StaffInviteInput = { email: "", full_name: "", role: "staff" };

export function AdminStaff() {
  const [staff, setStaff] = useState<ApiStaff[]>([]);
  const [services, setServices] = useState<ApiService[]>([]);
  const [assigned, setAssigned] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [invite, setInvite] = useState<StaffInviteInput>(EMPTY_INVITE);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [staffRows, serviceRows] = await Promise.all([
        apiGet<ApiStaff[]>("/staff"),
        apiGet<ApiService[]>("/services/mine"),
      ]);
      setStaff(staffRows);
      setServices(serviceRows);

      // No hay un GET /staff/{id}/services: se arma el mapa invirtiendo
      // GET /services/{id}/staff (público) para cada servicio del salón.
      const assignments: Record<string, Set<string>> = {};
      for (const member of staffRows) assignments[member.id] = new Set();

      await Promise.all(
        serviceRows.map(async (service) => {
          const providers = await apiGet<{ id: string; full_name: string }[]>(
            `/services/${service.id}/staff`,
          );
          for (const provider of providers) {
            assignments[provider.id]?.add(service.id);
          }
        }),
      );
      setAssigned(assignments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el staff");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function changeColor(member: ApiStaff, color: string) {
    setBusyId(member.id);
    try {
      const updated = await apiPatch<ApiStaff>(`/staff/${member.id}/color`, { color });
      setStaff((prev) => prev.map((s) => (s.id === member.id ? updated : s)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el color");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(member: ApiStaff) {
    setBusyId(member.id);
    try {
      await apiPatch(`/staff/${member.id}/active`, { is_active: !member.is_active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el estado");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteForever(member: ApiStaff) {
    if (
      !window.confirm(
        `¿Eliminar a "${member.full_name}" definitivamente? Pierde el acceso al panel y esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    setBusyId(member.id);
    setError(null);
    try {
      await apiDelete(`/staff/${member.id}/permanent`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el profesional");
    } finally {
      setBusyId(null);
    }
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setInviteBusy(true);
    setInviteError(null);
    setInviteSent(null);
    try {
      const created = await apiPost<ApiStaff>("/staff/invite", invite);
      setStaff((prev) => [...prev, created].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setInviteSent(`Invitación enviada a ${created.email}`);
      setInvite(EMPTY_INVITE);
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "No se pudo enviar la invitación");
    } finally {
      setInviteBusy(false);
    }
  }

  function isAssigned(staffId: string, serviceId: string): boolean {
    return assigned[staffId]?.has(serviceId) ?? false;
  }

  async function toggleService(staffId: string, serviceId: string) {
    const current = assigned[staffId] ?? new Set<string>();
    const next = new Set(current);
    if (next.has(serviceId)) {
      next.delete(serviceId);
    } else {
      next.add(serviceId);
    }
    setBusyId(staffId);
    try {
      await apiPut(`/staff/${staffId}/services`, { service_ids: Array.from(next) });
      setAssigned((prev) => ({ ...prev, [staffId]: next }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el servicio");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2 className="font-display text-2xl text-charcoal">Staff</h2>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <form
        onSubmit={(event) => void handleInvite(event)}
        className="mt-6 flex flex-col gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label className="text-xs text-charcoal/60" htmlFor="invite-email">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={invite.email}
            onChange={(e) => setInvite((prev) => ({ ...prev, email: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal"
            placeholder="profesional@ejemplo.com"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-charcoal/60" htmlFor="invite-name">
            Nombre
          </label>
          <input
            id="invite-name"
            type="text"
            required
            value={invite.full_name}
            onChange={(e) => setInvite((prev) => ({ ...prev, full_name: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal"
            placeholder="Nombre y apellido"
          />
        </div>
        <div>
          <label className="text-xs text-charcoal/60" htmlFor="invite-role">
            Rol
          </label>
          <select
            id="invite-role"
            value={invite.role}
            onChange={(e) =>
              setInvite((prev) => ({ ...prev, role: e.target.value as "owner" | "staff" }))
            }
            className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal sm:w-auto"
          >
            <option value="staff">Staff</option>
            <option value="owner">Dueña</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={inviteBusy}
          className="rounded-full bg-charcoal px-5 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {inviteBusy ? "Invitando..." : "Invitar"}
        </button>
      </form>
      {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
      {inviteSent && <p className="mt-2 text-sm text-green-700">{inviteSent}</p>}

      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      <div className="mt-6 flex flex-col gap-4">
        {staff.map((member) => (
          <div
            key={member.id}
            className={`rounded-2xl border border-baby-pink/30 bg-white/60 p-4 ${
              !member.is_active ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-charcoal">{member.full_name}</p>
                <p className="text-sm text-charcoal/60">
                  {member.role === "owner" ? "Dueña" : "Staff"}
                  {member.email ? ` · ${member.email}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`Color de ${member.full_name} en el calendario`}
                  value={member.color ?? "#cccccc"}
                  disabled={busyId === member.id}
                  onChange={(e) => void changeColor(member, e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded-full border border-charcoal/15 bg-white p-0.5 disabled:opacity-50"
                />
                <Link
                  to={`/admin/staff/${member.id}/schedule`}
                  className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40"
                >
                  Horario
                </Link>
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => void toggleActive(member)}
                  className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 transition-colors hover:border-charcoal/40 disabled:opacity-50"
                >
                  {member.is_active ? "Desactivar" : "Reactivar"}
                </button>
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => void deleteForever(member)}
                  className="rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:border-red-400 disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() => void toggleService(member.id, service.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                    isAssigned(member.id, service.id)
                      ? "border-champagne bg-champagne/10 text-champagne"
                      : "border-charcoal/15 text-charcoal/60 hover:border-baby-pink"
                  }`}
                >
                  {service.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

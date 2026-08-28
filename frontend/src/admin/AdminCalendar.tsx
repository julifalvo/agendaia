import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api";
import { useProfile } from "../hooks/useProfileContext";
import {
  cancelBooking,
  rescheduleBooking,
  setBookingPaymentStatus,
  transitionBooking,
} from "./bookingActions";
import type {
  ApiBooking,
  ApiGoogleCalendarBlock,
  ApiGoogleCalendarStatus,
  ApiGoogleCalendarSyncResult,
  ApiSalonClosure,
  ApiScheduleBlock,
  ApiService,
  ApiStaff,
} from "../types/api";
import type { AppointmentStatus } from "../types/booking";

// --- Grilla: un día, 08:00–21:00 en bloques de 30' -------------------------

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 21 * 60;
const SLOT_MIN = 30;
const PX_PER_MIN = 1.2;
const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const ROW_PX = SLOT_MIN * PX_PER_MIN;
const GRID_HEIGHT_PX = SLOT_COUNT * ROW_PX;

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No asistió",
};

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
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

function timeStringToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function localMinutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToTimeLabel(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface CreateForm {
  staffId: string;
  serviceId: string;
  time: string;
  guestName: string;
  guestPhone: string;
}

interface EditForm {
  date: string;
  time: string;
  staffId: string;
}

export function AdminCalendar() {
  const { profile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();

  const [date, setDate] = useState(todayISODate());
  const [staff, setStaff] = useState<ApiStaff[]>([]);
  const [services, setServices] = useState<ApiService[]>([]);
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [scheduleByStaff, setScheduleByStaff] = useState<Record<string, ApiScheduleBlock[]>>({});
  const [closures, setClosures] = useState<ApiSalonClosure[]>([]);
  const [googleBlocks, setGoogleBlocks] = useState<ApiGoogleCalendarBlock[]>([]);
  const [googleStatus, setGoogleStatus] = useState<ApiGoogleCalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createSlot, setCreateSlot] = useState<CreateForm | null>(null);
  const [editingBooking, setEditingBooking] = useState<ApiBooking | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ date: "", time: "", staffId: "" });

  const isOwner = profile?.role === "owner";
  const activeStaff = useMemo(() => staff.filter((s) => s.is_active), [staff]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59.999`);
      const params = new URLSearchParams({
        date_from: dayStart.toISOString(),
        date_to: dayEnd.toISOString(),
      });

      const [staffRows, serviceRows, bookingRows, closureRows, blockRows] = await Promise.all([
        apiGet<ApiStaff[]>("/staff"),
        apiGet<ApiService[]>("/services/mine"),
        apiGet<ApiBooking[]>(`/bookings?${params}`),
        apiGet<ApiSalonClosure[]>(`/salon/closures?${params}`),
        apiGet<ApiGoogleCalendarBlock[]>(`/admin/google-calendar/blocks?${params}`),
      ]);
      setStaff(staffRows);
      setServices(serviceRows);
      setBookings(bookingRows);
      setClosures(closureRows);
      setGoogleBlocks(blockRows);

      const activeIds = staffRows.filter((s) => s.is_active).map((s) => s.id);
      const scheduleEntries = await Promise.all(
        activeIds.map(async (staffId) => {
          const blocks = await apiGet<ApiScheduleBlock[]>(
            `/staff/${staffId}/schedule?date_from=${date}&date_to=${date}`,
          );
          return [staffId, blocks] as const;
        }),
      );
      setScheduleByStaff(Object.fromEntries(scheduleEntries));

      if (profile?.role === "owner") {
        setGoogleStatus(await apiGet<ApiGoogleCalendarStatus>("/admin/google-calendar/status"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el calendario");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, profile?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const google = searchParams.get("google");
    if (google === "connected") setNotice("Google Calendar conectado.");
    if (google === "error") setError("No se pudo conectar con Google Calendar.");
    if (google) {
      searchParams.delete("google");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isWorking(staffId: string, slotIndex: number): boolean {
    const slotStart = DAY_START_MIN + slotIndex * SLOT_MIN;
    const slotEnd = slotStart + SLOT_MIN;
    const blocks = scheduleByStaff[staffId] ?? [];
    return blocks.some(
      (b) =>
        timeStringToMinutes(b.start_time) <= slotStart &&
        slotEnd <= timeStringToMinutes(b.end_time),
    );
  }

  function canManage(staffId: string): boolean {
    return isOwner || profile?.id === staffId;
  }

  function bookingsFor(staffId: string): ApiBooking[] {
    return bookings.filter((b) => b.staff_id === staffId && b.status !== "cancelled");
  }

  function googleBlocksFor(staffId: string): ApiGoogleCalendarBlock[] {
    return googleBlocks.filter((b) => b.staff_id === staffId);
  }

  const salonWideBands = useMemo(() => {
    const bands: { top: number; height: number; label: string }[] = [];
    for (const closure of closures) {
      bands.push({
        top: (localMinutesSinceMidnight(closure.starts_at) - DAY_START_MIN) * PX_PER_MIN,
        height:
          (localMinutesSinceMidnight(closure.ends_at) - localMinutesSinceMidnight(closure.starts_at)) *
          PX_PER_MIN,
        label: closure.reason ?? "Agenda cerrada",
      });
    }
    for (const block of googleBlocks.filter((b) => b.staff_id === null)) {
      bands.push({
        top: (localMinutesSinceMidnight(block.starts_at) - DAY_START_MIN) * PX_PER_MIN,
        height:
          (localMinutesSinceMidnight(block.ends_at) - localMinutesSinceMidnight(block.starts_at)) *
          PX_PER_MIN,
        label: block.summary || "Bloqueado (Google)",
      });
    }
    return bands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closures, googleBlocks]);

  function openCreate(staffId: string, slotIndex: number) {
    if (!canManage(staffId)) return;
    const minutes = DAY_START_MIN + slotIndex * SLOT_MIN;
    setCreateSlot({
      staffId,
      serviceId: services[0]?.id ?? "",
      time: minutesToTimeLabel(minutes),
      guestName: "",
      guestPhone: "",
    });
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!createSlot || !profile) return;
    setBusy(true);
    setError(null);
    try {
      const startTime = new Date(`${date}T${createSlot.time}:00`).toISOString();
      await apiPost("/bookings", {
        salon_id: profile.salon_id,
        service_id: createSlot.serviceId,
        staff_id: createSlot.staffId,
        start_time: startTime,
        guest_name: createSlot.guestName || null,
        guest_phone: createSlot.guestPhone || null,
      });
      setCreateSlot(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el turno");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(booking: ApiBooking) {
    if (!canManage(booking.staff_id)) return;
    setEditingBooking(booking);
    const start = new Date(booking.start_time);
    setEditForm({
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      time: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      staffId: booking.staff_id,
    });
  }

  async function handleTransition(status: AppointmentStatus) {
    if (!editingBooking) return;
    setBusy(true);
    setError(null);
    try {
      await transitionBooking(editingBooking.id, status);
      setEditingBooking(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el turno");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!editingBooking) return;
    setBusy(true);
    setError(null);
    try {
      await cancelBooking(editingBooking.id);
      setEditingBooking(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cancelar el turno");
    } finally {
      setBusy(false);
    }
  }

  async function handlePayment(paid: boolean) {
    if (!editingBooking) return;
    setBusy(true);
    setError(null);
    try {
      await setBookingPaymentStatus(editingBooking.id, paid ? "paid" : "pending");
      setEditingBooking(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar la seña");
    } finally {
      setBusy(false);
    }
  }

  async function handleReschedule(event: FormEvent) {
    event.preventDefault();
    if (!editingBooking) return;
    setBusy(true);
    setError(null);
    try {
      const startTime = new Date(`${editForm.date}T${editForm.time}:00`).toISOString();
      await rescheduleBooking(editingBooking.id, startTime, editForm.staffId);
      setEditingBooking(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reprogramar el turno");
    } finally {
      setBusy(false);
    }
  }

  async function connectGoogle() {
    setBusy(true);
    setError(null);
    try {
      const { authorization_url } = await apiGet<{ authorization_url: string }>(
        "/admin/google-calendar/connect",
      );
      window.location.href = authorization_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar la conexión con Google");
      setBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("¿Desconectar Google Calendar de este salón?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete("/admin/google-calendar/connection");
      setGoogleStatus({ connected: false, calendar_id: null, connected_at: null, last_synced_at: null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desconectar Google Calendar");
    } finally {
      setBusy(false);
    }
  }

  async function syncGoogle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<ApiGoogleCalendarSyncResult>("/admin/google-calendar/sync", {});
      if (result.error) {
        setError(`Google Calendar: ${result.error}`);
      } else {
        setNotice(`Sincronizado: ${result.upserted} bloqueos actualizados, ${result.pruned} liberados.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo sincronizar con Google Calendar");
    } finally {
      setBusy(false);
    }
  }

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) marks.push(m);
    return marks;
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-charcoal">Calendario</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDate((d) => addDaysISO(d, -1))}
            className="rounded-full border border-charcoal/15 px-3 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            ← Ayer
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none focus:border-champagne"
          />
          <button
            type="button"
            onClick={() => setDate((d) => addDaysISO(d, 1))}
            className="rounded-full border border-charcoal/15 px-3 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            Mañana →
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm capitalize text-charcoal/60">{formatDateLabel(date)}</p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-champagne">{notice}</p>}

      {isOwner && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4">
          <p className="text-sm text-charcoal/70">
            Google Calendar:{" "}
            {googleStatus?.connected ? (
              <span className="text-champagne">conectado</span>
            ) : (
              <span className="text-charcoal/40">sin conectar</span>
            )}
            {googleStatus?.last_synced_at && (
              <span className="text-charcoal/40">
                {" "}
                · última sync {new Date(googleStatus.last_synced_at).toLocaleString("es-AR")}
              </span>
            )}
          </p>
          <div className="flex gap-2">
            {googleStatus?.connected ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void syncGoogle()}
                  className="rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-champagne hover:text-white disabled:opacity-50"
                >
                  Sincronizar ahora
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnectGoogle()}
                  className="rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 hover:border-charcoal/40 disabled:opacity-50"
                >
                  Desconectar
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void connectGoogle()}
                className="rounded-full bg-charcoal px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Conectar Google Calendar
              </button>
            )}
          </div>
        </div>
      )}

      {activeStaff.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {activeStaff.map((member) => (
            <span key={member.id} className="flex items-center gap-1.5 text-xs text-charcoal/60">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: member.color ?? "#cccccc" }}
              />
              {member.full_name}
            </span>
          ))}
        </div>
      )}

      {loading && <p className="mt-6 text-sm text-charcoal/50">Cargando...</p>}

      {!loading && activeStaff.length === 0 && (
        <p className="mt-6 text-sm text-charcoal/50">No hay profesionales activos.</p>
      )}

      {!loading && activeStaff.length > 0 && (
        <div className="mt-6 flex overflow-x-auto rounded-2xl border border-baby-pink/30 bg-white/60 p-4">
          <div className="shrink-0" style={{ width: 56 }}>
            <div style={{ height: 24 }} />
            <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
              {hourMarks.map((m) => (
                <div
                  key={m}
                  className="absolute right-2 -translate-y-1/2 text-xs text-charcoal/40"
                  style={{ top: (m - DAY_START_MIN) * PX_PER_MIN }}
                >
                  {minutesToTimeLabel(m)}
                </div>
              ))}
            </div>
          </div>

          <div className="relative flex flex-1">
            {salonWideBands.map((band, i) => (
              <div
                key={i}
                title={band.label}
                className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center overflow-hidden bg-charcoal/10 text-[10px] text-charcoal/50"
                style={{ top: 24 + band.top, height: Math.max(band.height, 4) }}
              >
                {band.label}
              </div>
            ))}

            {activeStaff.map((member) => (
              <div key={member.id} className="min-w-[140px] flex-1 border-l border-charcoal/10">
                <div
                  className="truncate px-2 text-center text-sm font-medium"
                  style={{ height: 24, color: member.color ?? undefined }}
                >
                  {member.full_name}
                </div>
                <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
                  {Array.from({ length: SLOT_COUNT }).map((_, slotIndex) => {
                    const working = isWorking(member.id, slotIndex);
                    return (
                      <button
                        key={slotIndex}
                        type="button"
                        disabled={!working || !canManage(member.id)}
                        onClick={() => openCreate(member.id, slotIndex)}
                        className={`absolute inset-x-0 border-b border-charcoal/5 transition-colors ${
                          working
                            ? "cursor-pointer hover:bg-champagne/10"
                            : "cursor-default bg-charcoal/[0.03]"
                        }`}
                        style={{ top: slotIndex * ROW_PX, height: ROW_PX }}
                        aria-label={`Crear turno ${minutesToTimeLabel(DAY_START_MIN + slotIndex * SLOT_MIN)}`}
                      />
                    );
                  })}

                  {googleBlocksFor(member.id).map((block) => (
                    <div
                      key={block.id}
                      title={block.summary ?? "Bloqueado (Google)"}
                      className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.06),rgba(0,0,0,0.06)_4px,transparent_4px,transparent_8px)] text-[10px] text-charcoal/50"
                      style={{
                        top: (localMinutesSinceMidnight(block.starts_at) - DAY_START_MIN) * PX_PER_MIN,
                        height: Math.max(
                          (localMinutesSinceMidnight(block.ends_at) -
                            localMinutesSinceMidnight(block.starts_at)) *
                            PX_PER_MIN,
                          4,
                        ),
                      }}
                    />
                  ))}

                  {bookingsFor(member.id).map((booking) => {
                    const service = services.find((s) => s.id === booking.service_id);
                    const clientLabel = booking.client_name ?? booking.guest_name ?? "Cliente";
                    const top = (localMinutesSinceMidnight(booking.start_time) - DAY_START_MIN) * PX_PER_MIN;
                    const height = Math.max(booking.duration_minutes * PX_PER_MIN, 18);
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={() => openEdit(booking)}
                        className="absolute inset-x-0.5 z-20 overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-[11px] text-white shadow-sm"
                        style={{
                          top,
                          height,
                          backgroundColor: member.color ?? "#999999",
                          opacity: booking.status === "no_show" ? 0.5 : 1,
                        }}
                      >
                        <p className="truncate font-medium">{service?.name ?? "Turno"}</p>
                        <p className="truncate opacity-90">{clientLabel}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {createSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 p-4">
          <form
            onSubmit={(e) => void submitCreate(e)}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg"
          >
            <h3 className="font-display text-lg text-charcoal">Nuevo turno</h3>
            <p className="mt-1 text-sm text-charcoal/60">
              {formatDateLabel(date)} · {createSlot.time}
            </p>

            <label className="mt-4 block text-xs text-charcoal/60">Servicio</label>
            <select
              required
              value={createSlot.serviceId}
              onChange={(e) => setCreateSlot((f) => f && { ...f, serviceId: e.target.value })}
              className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal"
            >
              {services
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>

            <label className="mt-3 block text-xs text-charcoal/60">Cliente (opcional)</label>
            <input
              type="text"
              value={createSlot.guestName}
              onChange={(e) => setCreateSlot((f) => f && { ...f, guestName: e.target.value })}
              placeholder="Nombre"
              className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal"
            />
            <input
              type="text"
              value={createSlot.guestPhone}
              onChange={(e) => setCreateSlot((f) => f && { ...f, guestPhone: e.target.value })}
              placeholder="Teléfono"
              className="mt-2 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateSlot(null)}
                className="rounded-full border border-charcoal/20 px-4 py-1.5 text-sm text-charcoal/70"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !createSlot.serviceId}
                className="rounded-full bg-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Creando..." : "Crear turno"}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-charcoal">
                {STATUS_LABEL[editingBooking.status]}
              </h3>
              <button
                type="button"
                onClick={() => setEditingBooking(null)}
                className="text-sm text-charcoal/40 hover:text-charcoal"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-sm text-charcoal/60">
              {editingBooking.client_name ?? editingBooking.guest_name ?? "Cliente"}
            </p>

            <form onSubmit={(e) => void handleReschedule(e)} className="mt-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="flex-1 rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal"
                />
                <input
                  type="time"
                  value={editForm.time}
                  onChange={(e) => setEditForm((f) => ({ ...f, time: e.target.value }))}
                  className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal"
                />
              </div>
              <select
                value={editForm.staffId}
                onChange={(e) => setEditForm((f) => ({ ...f, staffId: e.target.value }))}
                className="rounded-xl border border-charcoal/15 bg-white px-3 py-1.5 text-sm text-charcoal"
              >
                {activeStaff.map((member) => (
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
              {editingBooking.status === "pending" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTransition("confirmed")}
                  className="rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal disabled:opacity-50"
                >
                  Confirmar
                </button>
              )}
              {editingBooking.status === "confirmed" && (
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
              {editingBooking.payment_status === "paid" ? (
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
              {(editingBooking.status === "pending" || editingBooking.status === "confirmed") && (
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
      )}
    </div>
  );
}

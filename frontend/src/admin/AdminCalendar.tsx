import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api";
import { useProfile } from "../hooks/useProfileContext";
import { rescheduleBooking } from "./bookingActions";
import { BookingEditModal } from "./BookingEditModal";
import { todayISODate } from "./bookingLabels";
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

// --- Grilla: un día, 08:00–21:00 en bloques de 30' -------------------------

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 21 * 60;
const SLOT_MIN = 30;
const PX_PER_MIN = 1.2;
const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const ROW_PX = SLOT_MIN * PX_PER_MIN;
const GRID_HEIGHT_PX = SLOT_COUNT * ROW_PX;

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
  const [dragOverStaffId, setDragOverStaffId] = useState<string | null>(null);

  const isOwner = profile?.role === "owner";
  const activeStaff = useMemo(() => staff.filter((s) => s.is_active), [staff]);
  const manageableStaff = useMemo(
    () => activeStaff.filter((s) => canManage(s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeStaff, isOwner, profile?.id],
  );

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

  function openCreateGlobal() {
    if (manageableStaff.length === 0) return;
    setCreateSlot({
      staffId: manageableStaff[0].id,
      serviceId: services[0]?.id ?? "",
      time: minutesToTimeLabel(DAY_START_MIN),
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
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, booking: ApiBooking) {
    if (!canManage(booking.staff_id)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", booking.id);
    event.dataTransfer.effectAllowed = "move";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, staffId: string) {
    event.preventDefault();
    setDragOverStaffId(null);
    if (!canManage(staffId)) return;
    const bookingId = event.dataTransfer.getData("text/plain");
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking || !canManage(booking.staff_id)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const rawMinutes = DAY_START_MIN + (event.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.round(rawMinutes / SLOT_MIN) * SLOT_MIN;
    const slotIndex = (snapped - DAY_START_MIN) / SLOT_MIN;
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT || !isWorking(staffId, slotIndex)) return;
    if (snapped === localMinutesSinceMidnight(booking.start_time) && staffId === booking.staff_id) return;

    setBusy(true);
    setError(null);
    try {
      const startTime = new Date(`${date}T${minutesToTimeLabel(snapped)}:00`).toISOString();
      await rescheduleBooking(booking.id, startTime, staffId);
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={manageableStaff.length === 0}
            onClick={openCreateGlobal}
            className="tap-btn rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            + Nuevo turno
          </button>
          <button
            type="button"
            onClick={() => setDate((d) => addDaysISO(d, -1))}
            className="tap-btn rounded-full border border-charcoal/15 px-3 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            ← Ayer
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
          />
          <button
            type="button"
            onClick={() => setDate((d) => addDaysISO(d, 1))}
            className="tap-btn rounded-full border border-charcoal/15 px-3 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            Mañana →
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm capitalize text-charcoal/60">{formatDateLabel(date)}</p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-champagne">{notice}</p>}

      {isOwner && (
        <div className="tap-card mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-baby-pink/30 bg-white/60 p-4">
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
                  className="tap-btn rounded-full bg-baby-pink px-3 py-1.5 text-xs font-medium text-charcoal transition-colors hover:bg-bubblegum hover:text-white disabled:opacity-50"
                >
                  Sincronizar ahora
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnectGoogle()}
                  className="tap-btn rounded-full border border-charcoal/20 px-3 py-1.5 text-xs text-charcoal/70 hover:border-charcoal/40 disabled:opacity-50"
                >
                  Desconectar
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void connectGoogle()}
                className="tap-btn rounded-full bg-charcoal px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
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
                <div
                  className={`relative transition-colors ${
                    dragOverStaffId === member.id ? "bg-champagne/10" : ""
                  }`}
                  style={{ height: GRID_HEIGHT_PX }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverStaffId(member.id);
                  }}
                  onDragLeave={() =>
                    setDragOverStaffId((id) => (id === member.id ? null : id))
                  }
                  onDrop={(e) => void handleDrop(e, member.id)}
                >
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
                            ? "cursor-pointer hover:bg-champagne/10 active:bg-champagne/20"
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
                        draggable={canManage(booking.staff_id)}
                        onDragStart={(e) => handleDragStart(e, booking)}
                        onClick={() => openEdit(booking)}
                        className={`absolute inset-x-0.5 z-20 overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-[11px] text-white shadow-sm transition-[filter,box-shadow] duration-150 hover:z-30 hover:shadow-lg hover:brightness-110 active:brightness-90 ${
                          canManage(booking.staff_id) ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setCreateSlot(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/30 sm:items-center sm:p-4"
        >
          <motion.form
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            onSubmit={(e) => void submitCreate(e)}
            className="safe-bottom w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-lg sm:rounded-2xl"
          >
            <h3 className="font-display text-lg text-charcoal">Nuevo turno</h3>
            <p className="mt-1 text-sm capitalize text-charcoal/60">{formatDateLabel(date)}</p>

            <label htmlFor="create-staff" className="mt-4 block text-xs text-charcoal/60">
              Profesional
            </label>
            <select
              id="create-staff"
              required
              value={createSlot.staffId}
              onChange={(e) => setCreateSlot((f) => f && { ...f, staffId: e.target.value })}
              className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
            >
              {manageableStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>

            <label htmlFor="create-time" className="mt-3 block text-xs text-charcoal/60">
              Hora
            </label>
            <input
              id="create-time"
              type="time"
              required
              value={createSlot.time}
              onChange={(e) => setCreateSlot((f) => f && { ...f, time: e.target.value })}
              className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
            />

            <label className="mt-3 block text-xs text-charcoal/60">Servicio</label>
            <select
              required
              value={createSlot.serviceId}
              onChange={(e) => setCreateSlot((f) => f && { ...f, serviceId: e.target.value })}
              className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
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
              className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
            />
            <input
              type="text"
              value={createSlot.guestPhone}
              onChange={(e) => setCreateSlot((f) => f && { ...f, guestPhone: e.target.value })}
              placeholder="Teléfono"
              className="mt-2 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateSlot(null)}
                className="tap-btn rounded-full border border-charcoal/20 px-4 py-1.5 text-sm text-charcoal/70"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy || !createSlot.serviceId}
                className="tap-btn rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Creando..." : "Crear turno"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}

      {editingBooking && (
        <BookingEditModal
          booking={editingBooking}
          staffOptions={activeStaff}
          onClose={() => setEditingBooking(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

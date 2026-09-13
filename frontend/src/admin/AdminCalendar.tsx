import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost, apiDelete, ApiError } from "../lib/api";
import { hasFullAccess } from "../lib/access";
import { useProfile } from "../hooks/useProfileContext";
import { rescheduleBooking } from "./bookingActions";
import { BookingEditModal } from "./BookingEditModal";
import { toLocalDateInput, todayISODate } from "./bookingLabels";
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

// --- Grilla: 08:00–21:00 en bloques de 30' ----------------------------------
// Los admins ven un día con una columna por profesional; el resto del staff
// ve su propia semana con una columna por día (ver `canViewAllStaff`).

const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 21 * 60;
const SLOT_MIN = 30;
const PX_PER_MIN = 1.2;
const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const ROW_PX = SLOT_MIN * PX_PER_MIN;
const GRID_HEIGHT_PX = SLOT_COUNT * ROW_PX;

// Conectar/sincronizar Google Calendar queda reservado a esta cuenta —
// coincide con `google_calendar_allowed_email` en el backend, que además lo
// exige del lado del servidor (esto solo evita mostrar la sección al resto).
const GOOGLE_CALENDAR_ALLOWED_EMAIL = "marticarballo2711@gmail.com";

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana (ISO 8601) que contiene `iso`. */
function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysISO(iso, diff);
}

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatWeekRangeLabel(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const startLabel = start.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  const endLabel = end.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  return `Semana del ${startLabel} al ${endLabel}`;
}

function formatDayColumnLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const weekday = d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d.getDate()}`;
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
  date: string;
  serviceId: string;
  time: string;
  guestName: string;
  guestPhone: string;
}

/** Una columna de la grilla: profesional (vista admin) o día (vista semanal
 * de un staff sin acceso completo). Cada una fija un (fecha, profesional). */
interface CalendarColumn {
  key: string;
  label: string;
  color: string | null;
  date: string;
  staffId: string;
  isToday: boolean;
}

export function AdminCalendar() {
  const { profile } = useProfile();
  const [searchParams, setSearchParams] = useSearchParams();

  const [date, setDate] = useState(todayISODate());
  const [staff, setStaff] = useState<ApiStaff[]>([]);
  const [services, setServices] = useState<ApiService[]>([]);
  const [bookings, setBookings] = useState<ApiBooking[]>([]);
  const [scheduleByStaff, setScheduleByStaff] = useState<Record<string, ApiScheduleBlock[]>>({});
  const [scheduleWeek, setScheduleWeek] = useState<ApiScheduleBlock[]>([]);
  const [closures, setClosures] = useState<ApiSalonClosure[]>([]);
  const [googleBlocks, setGoogleBlocks] = useState<ApiGoogleCalendarBlock[]>([]);
  const [googleStatus, setGoogleStatus] = useState<ApiGoogleCalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createSlot, setCreateSlot] = useState<CreateForm | null>(null);
  const [editingBooking, setEditingBooking] = useState<ApiBooking | null>(null);
  // Reprogramar por arrastre con Pointer Events (no HTML5 drag-and-drop, que
  // no dispara en pantallas táctiles) — funciona igual con mouse y con dedo.
  const [drag, setDrag] = useState<{ booking: ApiBooking; colKey: string; slotIndex: number } | null>(
    null,
  );
  const pendingDragRef = useRef<{ booking: ApiBooking; pointerId: number; x: number; y: number } | null>(
    null,
  );
  // true una vez que el gesto se convirtió en drag real: el click sintético
  // que sigue al pointerup en touch se ignora mientras esto sea true.
  const dragMovedRef = useRef(false);

  const isOwner = profile?.role === "owner";
  const canManageGoogleCalendar =
    isOwner && profile?.email?.toLowerCase() === GOOGLE_CALENDAR_ALLOWED_EMAIL;
  const canViewAllStaff = hasFullAccess(profile);
  const activeStaff = useMemo(() => staff.filter((s) => s.is_active), [staff]);
  const visibleStaff = useMemo(
    () => (canViewAllStaff ? activeStaff : activeStaff.filter((s) => s.id === profile?.id)),
    [activeStaff, canViewAllStaff, profile?.id],
  );
  // Solo un admin (ver `canViewAllStaff`) puede cargar turnos; el resto del
  // staff tiene la agenda en modo solo lectura.
  const manageableStaff = useMemo(
    () => (canViewAllStaff ? activeStaff : []),
    [activeStaff, canViewAllStaff],
  );

  // Un staff sin acceso completo ve su semana (columnas = días); los admins
  // ven un día con columnas = profesionales.
  const weekDays = useMemo(() => {
    if (canViewAllStaff) return [];
    const start = mondayOfISO(date);
    return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
  }, [date, canViewAllStaff]);

  const columns: CalendarColumn[] = useMemo(() => {
    const today = todayISODate();
    if (canViewAllStaff) {
      return visibleStaff.map((s) => ({
        key: s.id,
        label: s.full_name,
        color: s.color,
        date,
        staffId: s.id,
        isToday: date === today,
      }));
    }
    if (!profile) return [];
    const selfColor = visibleStaff[0]?.color ?? null;
    return weekDays.map((iso) => ({
      key: iso,
      label: formatDayColumnLabel(iso),
      color: selfColor,
      date: iso,
      staffId: profile.id,
      isToday: iso === today,
    }));
  }, [canViewAllStaff, visibleStaff, date, weekDays, profile]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rangeStartIso = canViewAllStaff ? date : mondayOfISO(date);
      const rangeEndIso = canViewAllStaff ? date : addDaysISO(rangeStartIso, 6);
      const dayStart = new Date(`${rangeStartIso}T00:00:00`);
      const dayEnd = new Date(`${rangeEndIso}T23:59:59.999`);
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

      if (canViewAllStaff) {
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
      } else if (profile) {
        const blocks = await apiGet<ApiScheduleBlock[]>(
          `/staff/${profile.id}/schedule?date_from=${rangeStartIso}&date_to=${rangeEndIso}`,
        );
        setScheduleWeek(blocks);
      }

      if (canManageGoogleCalendar) {
        setGoogleStatus(await apiGet<ApiGoogleCalendarStatus>("/admin/google-calendar/status"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el calendario");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, canManageGoogleCalendar, canViewAllStaff, profile?.id]);

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

  function workingBlocksFor(col: CalendarColumn): ApiScheduleBlock[] {
    return canViewAllStaff
      ? scheduleByStaff[col.staffId] ?? []
      : scheduleWeek.filter((b) => b.date === col.date);
  }

  function isWorking(col: CalendarColumn, slotIndex: number): boolean {
    const slotStart = DAY_START_MIN + slotIndex * SLOT_MIN;
    const slotEnd = slotStart + SLOT_MIN;
    const blocks = workingBlocksFor(col);
    return blocks.some(
      (b) =>
        timeStringToMinutes(b.start_time) <= slotStart &&
        slotEnd <= timeStringToMinutes(b.end_time),
    );
  }

  function bookingsFor(col: CalendarColumn): ApiBooking[] {
    return bookings.filter(
      (b) =>
        b.staff_id === col.staffId &&
        b.status !== "cancelled" &&
        toLocalDateInput(b.start_time) === col.date,
    );
  }

  function googleBlocksFor(col: CalendarColumn): ApiGoogleCalendarBlock[] {
    return googleBlocks.filter(
      (b) => b.staff_id === col.staffId && toLocalDateInput(b.starts_at) === col.date,
    );
  }

  function bandsFor(col: CalendarColumn): { top: number; height: number; label: string }[] {
    const bands: { top: number; height: number; label: string }[] = [];
    for (const closure of closures) {
      if (toLocalDateInput(closure.starts_at) !== col.date) continue;
      bands.push({
        top: (localMinutesSinceMidnight(closure.starts_at) - DAY_START_MIN) * PX_PER_MIN,
        height:
          (localMinutesSinceMidnight(closure.ends_at) - localMinutesSinceMidnight(closure.starts_at)) *
          PX_PER_MIN,
        label: closure.reason ?? "Agenda cerrada",
      });
    }
    for (const block of googleBlocks.filter((b) => b.staff_id === null)) {
      if (toLocalDateInput(block.starts_at) !== col.date) continue;
      bands.push({
        top: (localMinutesSinceMidnight(block.starts_at) - DAY_START_MIN) * PX_PER_MIN,
        height:
          (localMinutesSinceMidnight(block.ends_at) - localMinutesSinceMidnight(block.starts_at)) *
          PX_PER_MIN,
        label: block.summary || "Bloqueado (Google)",
      });
    }
    return bands;
  }

  function openCreate(colKey: string, slotIndex: number) {
    const col = columns.find((c) => c.key === colKey);
    if (!col || !canViewAllStaff) return;
    const minutes = DAY_START_MIN + slotIndex * SLOT_MIN;
    setCreateSlot({
      staffId: col.staffId,
      date: col.date,
      serviceId: services[0]?.id ?? "",
      time: minutesToTimeLabel(minutes),
      guestName: "",
      guestPhone: "",
    });
  }

  function openCreateGlobal() {
    if (manageableStaff.length === 0) return;
    const staffId = manageableStaff[0].id;
    const today = todayISODate();
    const defaultCol =
      columns.find((c) => c.staffId === staffId && c.date === today) ??
      columns.find((c) => c.staffId === staffId) ??
      columns[0];
    setCreateSlot({
      staffId,
      date: defaultCol?.date ?? date,
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
      const startTime = new Date(`${createSlot.date}T${createSlot.time}:00`).toISOString();
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
    if (!canViewAllStaff) return;
    setEditingBooking(booking);
  }

  function currentSlotIndex(booking: ApiBooking): number {
    return Math.round((localMinutesSinceMidnight(booking.start_time) - DAY_START_MIN) / SLOT_MIN);
  }

  async function commitReschedule(booking: ApiBooking, colKey: string, slotIndex: number) {
    const col = columns.find((c) => c.key === colKey);
    if (!col || !canViewAllStaff) return;
    if (slotIndex < 0 || slotIndex >= SLOT_COUNT || !isWorking(col, slotIndex)) return;
    const snapped = DAY_START_MIN + slotIndex * SLOT_MIN;
    const unchanged =
      snapped === localMinutesSinceMidnight(booking.start_time) &&
      col.staffId === booking.staff_id &&
      col.date === toLocalDateInput(booking.start_time);
    if (unchanged) return;

    setBusy(true);
    setError(null);
    try {
      const startTime = new Date(`${col.date}T${minutesToTimeLabel(snapped)}:00`).toISOString();
      await rescheduleBooking(booking.id, startTime, col.staffId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reprogramar el turno");
    } finally {
      setBusy(false);
    }
  }

  function handleBookingPointerDown(event: PointerEvent<HTMLButtonElement>, booking: ApiBooking) {
    if (!canViewAllStaff) return;
    // Progressive enhancement: si el navegador no soporta pointer capture,
    // el drag sigue funcionando vía elementFromPoint, solo es menos robusto
    // si el dedo sale de los límites del botón.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pendingDragRef.current = { booking, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
  }

  function handleBookingPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const pending = pendingDragRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;

    if (!dragMovedRef.current) {
      const dx = event.clientX - pending.x;
      const dy = event.clientY - pending.y;
      // Umbral chico para no confundir un tap con un drag apenas empieza.
      if (Math.hypot(dx, dy) < 6) return;
      dragMovedRef.current = true;
      const bookingDate = toLocalDateInput(pending.booking.start_time);
      const initialCol = columns.find(
        (c) => c.staffId === pending.booking.staff_id && c.date === bookingDate,
      );
      setDrag({
        booking: pending.booking,
        colKey: initialCol?.key ?? pending.booking.staff_id,
        slotIndex: currentSlotIndex(pending.booking),
      });
    }

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const column = target?.closest<HTMLElement>("[data-col-key]");
    if (!column) return;
    const colKey = column.dataset.colKey!;
    const rect = column.getBoundingClientRect();
    const rawMinutes = DAY_START_MIN + (event.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.round(rawMinutes / SLOT_MIN) * SLOT_MIN;
    const slotIndex = Math.min(Math.max((snapped - DAY_START_MIN) / SLOT_MIN, 0), SLOT_COUNT - 1);
    setDrag((d) => (d ? { ...d, colKey, slotIndex } : d));
  }

  async function handleBookingPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const pending = pendingDragRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    pendingDragRef.current = null;

    if (dragMovedRef.current && drag) {
      const finalDrag = drag;
      setDrag(null);
      await commitReschedule(finalDrag.booking, finalDrag.colKey, finalDrag.slotIndex);
    }
  }

  function handleBookingPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    const pending = pendingDragRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    pendingDragRef.current = null;
    dragMovedRef.current = false;
    setDrag(null);
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

  const dateLabel = canViewAllStaff
    ? formatDateLabel(date)
    : formatWeekRangeLabel(weekDays[0] ?? date, weekDays[6] ?? date);
  const stepDays = canViewAllStaff ? 1 : 7;
  const prevLabel = canViewAllStaff ? "← Ayer" : "← Semana anterior";
  const nextLabel = canViewAllStaff ? "Mañana →" : "Semana siguiente →";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-charcoal">Calendario</h2>
        <div className="flex flex-wrap items-center gap-2">
          {canViewAllStaff && (
            <button
              type="button"
              disabled={manageableStaff.length === 0}
              onClick={openCreateGlobal}
              className="tap-btn rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              + Nuevo turno
            </button>
          )}
          <button
            type="button"
            onClick={() => setDate((d) => addDaysISO(d, -stepDays))}
            className="tap-btn rounded-full border border-charcoal/15 px-3 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            {prevLabel}
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
          />
          <button
            type="button"
            onClick={() => setDate((d) => addDaysISO(d, stepDays))}
            className="tap-btn rounded-full border border-charcoal/15 px-3 py-1.5 text-sm text-charcoal/60 hover:border-charcoal/40"
          >
            {nextLabel}
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm capitalize text-charcoal/60">{dateLabel}</p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-champagne">{notice}</p>}

      {canManageGoogleCalendar && (
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

      {canViewAllStaff && visibleStaff.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {visibleStaff.map((member) => (
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

      {!loading && columns.length === 0 && (
        <p className="mt-6 text-sm text-charcoal/50">No hay profesionales activos.</p>
      )}

      {!loading && columns.length > 1 && (
        <p className="mt-6 text-xs text-charcoal/40 sm:hidden">
          {canViewAllStaff
            ? "Deslizá para ver el resto de las profesionales →"
            : "Deslizá para ver el resto de la semana →"}
        </p>
      )}

      {!loading && columns.length > 0 && (
        <div
          className={`flex overflow-x-auto rounded-2xl border border-baby-pink/30 bg-white/60 p-4 ${
            columns.length > 1 ? "mt-2" : "mt-6"
          }`}
        >
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
            {columns.map((col) => (
              <div key={col.key} className="min-w-[140px] flex-1 border-l border-charcoal/10">
                <div
                  className={`truncate px-2 text-center text-sm font-medium ${
                    col.isToday && !canViewAllStaff ? "text-champagne" : ""
                  }`}
                  style={{ height: 24, color: canViewAllStaff ? col.color ?? undefined : undefined }}
                >
                  {col.label}
                </div>
                <div
                  data-col-key={col.key}
                  className={`relative transition-colors ${
                    drag?.colKey === col.key ? "bg-champagne/10" : ""
                  }`}
                  style={{ height: GRID_HEIGHT_PX }}
                >
                  {bandsFor(col).map((band, i) => (
                    <div
                      key={i}
                      title={band.label}
                      className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center overflow-hidden bg-charcoal/10 text-[10px] text-charcoal/50"
                      style={{ top: band.top, height: Math.max(band.height, 4) }}
                    >
                      {band.label}
                    </div>
                  ))}

                  {Array.from({ length: SLOT_COUNT }).map((_, slotIndex) => {
                    const working = isWorking(col, slotIndex);
                    const interactive = working && canViewAllStaff;
                    return (
                      <button
                        key={slotIndex}
                        type="button"
                        disabled={!interactive}
                        onClick={() => openCreate(col.key, slotIndex)}
                        className={`absolute inset-x-0 border-b border-charcoal/5 transition-colors ${
                          interactive
                            ? "cursor-pointer hover:bg-champagne/10 active:bg-champagne/20"
                            : working
                              ? "cursor-default"
                              : "cursor-default bg-charcoal/[0.03]"
                        }`}
                        style={{ top: slotIndex * ROW_PX, height: ROW_PX }}
                        aria-label={`Crear turno ${minutesToTimeLabel(DAY_START_MIN + slotIndex * SLOT_MIN)}`}
                      />
                    );
                  })}

                  {googleBlocksFor(col).map((block) => (
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

                  {bookingsFor(col).map((booking) => {
                    const service = services.find((s) => s.id === booking.service_id);
                    const clientLabel = booking.client_name ?? booking.guest_name ?? "Cliente";
                    const top = (localMinutesSinceMidnight(booking.start_time) - DAY_START_MIN) * PX_PER_MIN;
                    const height = Math.max(booking.duration_minutes * PX_PER_MIN, 18);
                    const isBeingDragged = drag?.booking.id === booking.id;
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        onPointerDown={(e) => handleBookingPointerDown(e, booking)}
                        onPointerMove={handleBookingPointerMove}
                        onPointerUp={(e) => void handleBookingPointerUp(e)}
                        onPointerCancel={handleBookingPointerCancel}
                        onClick={() => {
                          if (dragMovedRef.current) {
                            dragMovedRef.current = false;
                            return;
                          }
                          openEdit(booking);
                        }}
                        className={`absolute inset-x-0.5 z-20 overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-[11px] text-white shadow-sm transition-[filter,box-shadow] duration-150 hover:z-30 hover:shadow-lg hover:brightness-110 active:brightness-90 ${
                          canViewAllStaff ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                        }`}
                        style={{
                          top,
                          height,
                          backgroundColor: col.color ?? "#999999",
                          opacity: isBeingDragged ? 0.35 : booking.status === "no_show" ? 0.5 : 1,
                          touchAction: canViewAllStaff ? "none" : undefined,
                        }}
                      >
                        <p className="truncate font-medium">{service?.name ?? "Turno"}</p>
                        <p className="truncate opacity-90">{clientLabel}</p>
                      </button>
                    );
                  })}

                  {drag && drag.colKey === col.key && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-30 rounded-lg border-2 border-dashed border-champagne bg-champagne/20"
                      style={{
                        top: drag.slotIndex * ROW_PX,
                        height: Math.max(drag.booking.duration_minutes * PX_PER_MIN, 18),
                      }}
                    />
                  )}
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
            <p className="mt-1 text-sm capitalize text-charcoal/60">{formatDateLabel(createSlot.date)}</p>

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

            {!canViewAllStaff && (
              <>
                <label htmlFor="create-date" className="mt-3 block text-xs text-charcoal/60">
                  Día
                </label>
                <input
                  id="create-date"
                  type="date"
                  required
                  value={createSlot.date}
                  onChange={(e) => setCreateSlot((f) => f && { ...f, date: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-charcoal/15 bg-white px-3 py-2 text-sm text-charcoal transition-colors hover:border-baby-pink focus:border-champagne"
                />
              </>
            )}

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
          staffOptions={visibleStaff}
          onClose={() => setEditingBooking(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

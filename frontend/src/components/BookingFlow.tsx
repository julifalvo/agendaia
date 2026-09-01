import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { haptic } from "../lib/haptics";
import { toDisplayBooking } from "../lib/mappers";
import { useAuth } from "../hooks/useAuthContext";
import { useProfile } from "../hooks/useProfileContext";
import { BookingCard } from "./BookingCard";
import { ConfettiBurst } from "./ConfettiBurst";
import type { ApiAvailability, ApiBooking, ApiCategory, ApiPublicStaff, ApiService, ApiSlot } from "../types/api";

const SALON_ID = import.meta.env.VITE_SALON_ID;

// Debe coincidir con BOOKING_DEPOSIT_AMOUNT en el backend — no hay endpoint
// público que exponga el monto configurado antes de reservar.
const DEPOSIT_AMOUNT = 8500;

// Única forma de pagar la seña: transferencia directa (sin pasarela). El
// salón confirma el turno a mano al ver la transferencia en su banco — ver
// POST /bookings/{id}/payment-received en el panel de administración.
const TRANSFER_ALIAS = "martu.manicura";
const TRANSFER_CVU = "0000003100008080724270";
const TRANSFER_NAME = "Martina Yael Carballo";

const depositFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const timeFormatter = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
});
const fullDateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Fecha local en formato YYYY-MM-DD. `toISOString()` convierte a UTC
 * primero, así que cerca de medianoche en Argentina (UTC-3) devolvería el
 * día siguiente; esto arma la fecha a partir de los componentes locales. */
function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayISODate(): string {
  return toLocalISODate(new Date());
}

const WEEKDAY_HEADERS = ["L", "M", "M", "J", "V", "S", "D"];

const monthYearFormatter = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

interface MonthCell {
  iso: string;
  day: number;
}

/** Grilla tipo iOS: semana arranca en lunes, celdas vacías para el offset
 * inicial (no se muestran días del mes adyacente, para no dar la falsa
 * impresión de que son tappeables). */
function buildMonthGrid(viewDate: Date): (MonthCell | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstWeekdayMon0 = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (MonthCell | null)[] = Array.from({ length: firstWeekdayMon0 }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: toLocalISODate(new Date(year, month, day)), day });
  }
  return cells;
}

function groupSlots(slots: ApiSlot[]) {
  const groups: { label: string; items: ApiSlot[] }[] = [
    { label: "Mañana", items: [] },
    { label: "Tarde", items: [] },
    { label: "Noche", items: [] },
  ];
  for (const slot of slots) {
    const hour = new Date(slot.start).getHours();
    const bucket = hour < 13 ? 0 : hour < 19 ? 1 : 2;
    groups[bucket].items.push(slot);
  }
  return groups.filter((g) => g.items.length > 0);
}

const STEPS = [
  { label: "Servicio", heading: "¿Qué te gustaría hacerte?" },
  { label: "Horario", heading: "¿Cuándo te queda bien?" },
  { label: "Confirmar", heading: "Confirmá tu turno" },
];

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function currentStepIndex(hasService: boolean, hasSlot: boolean): number {
  if (!hasService) return 0;
  if (!hasSlot) return 1;
  return 2;
}

function ProgressTrack({ step }: { step: number }) {
  const progress = ((step + 1) / STEPS.length) * 100;
  return (
    <div className="mb-7">
      <div className="h-1 overflow-hidden rounded-full bg-charcoal/8">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-bubblegum to-champagne"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-champagne">
          Paso {step + 1} de {STEPS.length}
        </span>
        <span className="text-[11px] text-charcoal/40">{STEPS[step].label}</span>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[1.35rem] leading-snug text-charcoal">{children}</h2>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap-btn mb-2 flex items-center gap-1 text-xs font-medium text-charcoal/40 transition-colors hover:text-champagne"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
        <path
          d="M15 6l-6 6 6 6"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </button>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-champagne" fill="none">
        <path
          d="M5 13l4 4L19 7"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-charcoal/35" fill="none">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M5 15V6a2 2 0 0 1 2-2h9"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Todo el renglón es tappeable (no solo el ícono) — copia el valor de esa
 * fila puntual al portapapeles, con un check momentáneo de feedback. */
function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API puede fallar (permisos, contexto no seguro); el valor
      // sigue visible en pantalla para copiarlo a mano.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="tap-btn flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left transition-colors hover:bg-champagne/10 active:bg-champagne/15"
    >
      <span>
        <span className="text-charcoal/45">{label}:</span>{" "}
        <span className="font-medium text-charcoal">{value}</span>
      </span>
      {copied ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-champagne">
          Copiado <CopyIcon copied />
        </span>
      ) : (
        <CopyIcon copied={false} />
      )}
    </button>
  );
}

function TransferDetails() {
  return (
    <div className="mt-2 flex flex-col text-sm text-charcoal/75">
      <CopyableField label="Alias" value={TRANSFER_ALIAS} />
      <CopyableField label="CVU" value={TRANSFER_CVU} />
      <p className="py-1">
        <span className="text-charcoal/45">Titular:</span>{" "}
        <span className="font-medium text-charcoal">{TRANSFER_NAME}</span>
      </p>
    </div>
  );
}

export function BookingFlow() {
  const { user } = useAuth();
  const { profile } = useProfile();
  // La sesión de Supabase puede pertenecer a un owner/staff que quedó
  // logueado y entra a la página pública (ej. para probar el flujo): el
  // backend solo autocompleta `client_id` desde el perfil para el rol
  // 'client', así que acá también hay que pedir nombre/WhatsApp de invitado,
  // o el turno queda sin cliente y sin forma de completarlo en la UI.
  const bookingAsGuest = !user || profile?.role !== "client";

  const [services, setServices] = useState<ApiService[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  // El backend gratuito "duerme" tras un rato sin uso y tarda unos segundos
  // en despertar en el primer pedido — sin este aviso, esa espera se lee
  // como que la página está rota en vez de que está arrancando.
  const [showSlowHint, setShowSlowHint] = useState(false);

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [staffForService, setStaffForService] = useState<ApiPublicStaff[]>([]);

  const [date, setDate] = useState(todayISODate());
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [slots, setSlots] = useState<ApiSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<ApiSlot | null>(null);
  const [searchingNextDate, setSearchingNextDate] = useState(false);
  const [noNextDateFound, setNoNextDateFound] = useState(false);

  const currentMonthStart = useMemo(() => startOfMonth(new Date()), []);
  const monthGrid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);

  function goToDate(iso: string) {
    haptic(6);
    setDate(iso);
    setViewDate(startOfMonth(new Date(`${iso}T00:00:00`)));
    setNoNextDateFound(false);
  }

  /** Busca en bloques de 10 días (en paralelo) el próximo día con algún slot
   * libre para el servicio elegido — no hay endpoint de rango en el backend,
   * así que se consulta día por día, pero de a lotes para no hacer esperar
   * ~90 round-trips secuenciales. */
  async function goToNextAvailableDate() {
    if (!selectedServiceId) return;
    setSearchingNextDate(true);
    setNoNextDateFound(false);
    const CHUNK_SIZE = 10;
    const MAX_DAYS_AHEAD = 90;
    const base = new Date(`${date}T00:00:00`);
    try {
      for (let offset = 1; offset <= MAX_DAYS_AHEAD; offset += CHUNK_SIZE) {
        const offsets = Array.from(
          { length: Math.min(CHUNK_SIZE, MAX_DAYS_AHEAD - offset + 1) },
          (_, i) => offset + i,
        );
        const results = await Promise.all(
          offsets.map(async (n) => {
            const d = new Date(base);
            d.setDate(d.getDate() + n);
            const iso = toLocalISODate(d);
            const params = new URLSearchParams({
              salon_id: SALON_ID,
              service_id: selectedServiceId,
              date: iso,
            });
            try {
              const res = await apiGet<ApiAvailability>(`/availability?${params}`);
              return { n, iso, hasSlots: res.slots.length > 0 };
            } catch {
              return { n, iso, hasSlots: false };
            }
          }),
        );
        const earliest = results.filter((r) => r.hasSlots).sort((a, b) => a.n - b.n)[0];
        if (earliest) {
          goToDate(earliest.iso);
          return;
        }
      }
      setNoNextDateFound(true);
    } finally {
      setSearchingNextDate(false);
    }
  }

  const [guestFirstName, setGuestFirstName] = useState("");
  const [guestLastName, setGuestLastName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const guestFullName = `${guestFirstName.trim()} ${guestLastName.trim()}`.trim();
  // El backend solo manda el mail con el turno adjunto para reservas de
  // invitado con email cargado (ver app/services/email.py) — clientes
  // logueados todavía no, por eso no se usa el email del profile acá.
  const willEmailCalendarInvite = bookingAsGuest && guestEmail.trim() !== "";

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ApiBooking | null>(null);

  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  const groupedServices = useMemo(() => {
    const byCategory = new Map<string, ApiService[]>();
    for (const service of services) {
      const key = service.category_id ?? "__uncategorized__";
      const bucket = byCategory.get(key);
      if (bucket) bucket.push(service);
      else byCategory.set(key, [service]);
    }
    const orderedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const groups: { key: string; label: string | null; services: ApiService[] }[] = [];
    for (const category of orderedCategories) {
      const bucket = byCategory.get(category.id);
      if (bucket) groups.push({ key: category.id, label: category.name, services: bucket });
    }
    const uncategorized = byCategory.get("__uncategorized__");
    if (uncategorized) {
      // Sin encabezado si es la única categoría (catálogo chico sin sectorizar).
      groups.push({
        key: "__uncategorized__",
        label: groups.length > 0 ? "Otros" : null,
        services: uncategorized,
      });
    }
    return groups;
  }, [services, categories]);

  const loadServices = useCallback(() => {
    setLoadingServices(true);
    setServicesError(null);
    Promise.all([
      apiGet<ApiService[]>(`/services?salon_id=${SALON_ID}`),
      apiGet<ApiCategory[]>(`/categories?salon_id=${SALON_ID}`),
    ])
      .then(([servicesRes, categoriesRes]) => {
        setServices(servicesRes);
        setCategories(categoriesRes);
      })
      .catch((err) =>
        setServicesError(err instanceof Error ? err.message : "No se pudieron cargar los servicios"),
      )
      .finally(() => setLoadingServices(false));
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    if (!loadingServices) {
      setShowSlowHint(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowHint(true), 3500);
    return () => clearTimeout(timer);
  }, [loadingServices]);

  useEffect(() => {
    if (!selectedServiceId) {
      setStaffForService([]);
      return;
    }
    apiGet<ApiPublicStaff[]>(`/services/${selectedServiceId}/staff`)
      .then(setStaffForService)
      .catch(() => setStaffForService([]));
  }, [selectedServiceId]);

  useEffect(() => {
    if (!selectedServiceId) {
      setSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSelectedSlot(null);
    setNoNextDateFound(false);
    const params = new URLSearchParams({ salon_id: SALON_ID, service_id: selectedServiceId, date });
    apiGet<ApiAvailability>(`/availability?${params}`)
      .then((res) => setSlots(res.slots))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedServiceId, date]);

  async function refreshSlots() {
    if (!selectedServiceId) return;
    setLoadingSlots(true);
    const params = new URLSearchParams({ salon_id: SALON_ID, service_id: selectedServiceId, date });
    try {
      const res = await apiGet<ApiAvailability>(`/availability?${params}`);
      setSlots(res.slots);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleSubmit() {
    if (!selectedService || !selectedSlot) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const booking = await apiPost<ApiBooking>("/bookings", {
        salon_id: SALON_ID,
        service_id: selectedService.id,
        start_time: selectedSlot.start,
        guest_name: bookingAsGuest ? guestFullName : undefined,
        guest_phone: bookingAsGuest ? guestPhone.trim() : undefined,
        guest_email: bookingAsGuest ? guestEmail.trim() || undefined : undefined,
        payment_method: "transfer",
      });

      haptic([12, 40, 12]);
      setConfirmed(booking);
    } catch (err) {
      if (err instanceof ApiError && err.code === "slot_unavailable") {
        setFormError("Justo se ocupó ese horario. Elegí otro de la lista.");
        await refreshSlots();
        setSelectedSlot(null);
      } else {
        setFormError(err instanceof Error ? err.message : "No se pudo crear la reserva");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setConfirmed(null);
    setSelectedSlot(null);
    setGuestFirstName("");
    setGuestLastName("");
    setGuestPhone("");
    setGuestEmail("");
    void refreshSlots();
  }

  if (confirmed && selectedService) {
    const assignedStaff = staffForService.find((s) => s.id === confirmed.staff_id);
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="mb-7 flex flex-col items-center gap-3">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
            className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-bubblegum/20 to-champagne/20"
          >
            <ConfettiBurst />
            <div className="absolute inset-0 animate-ping rounded-full bg-bubblegum/20" />
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
              <path
                d="M5 13l4 4L19 7"
                stroke="var(--color-champagne)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="check-path"
              />
            </svg>
          </motion.div>
          <div className="text-center">
            <p className="font-display text-xl text-charcoal">¡Todo listo!</p>
            <p className="mt-0.5 text-sm text-charcoal/50">Te esperamos con muchas ganas.</p>
          </div>
        </div>

        <BookingCard
          booking={toDisplayBooking(
            confirmed,
            selectedService,
            assignedStaff,
            bookingAsGuest ? guestFullName || "Vos" : (user?.user_metadata?.full_name ?? "Vos"),
          )}
        />

        <div className="mt-4 rounded-2xl border border-champagne/25 bg-champagne/[0.06] px-4 py-3.5">
          <p className="text-sm text-charcoal/75">
            Para confirmar tu turno, transferí la seña de{" "}
            <span className="font-medium text-charcoal">
              {depositFormatter.format(DEPOSIT_AMOUNT)}
            </span>{" "}
            a:
          </p>
          <TransferDetails />
        </div>
        {willEmailCalendarInvite && (
          <p className="mt-4 text-center text-sm text-charcoal/55">
            Te mandamos un mail con el turno para que lo sumes a tu calendario.
          </p>
        )}

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={reset}
          className="mt-5 w-full rounded-full border border-charcoal/15 py-2.5 text-sm text-charcoal/60
            transition-colors hover:border-charcoal/30 hover:text-charcoal"
        >
          Reservar otro turno
        </motion.button>
      </motion.div>
    );
  }

  const step = currentStepIndex(!!selectedService, !!selectedSlot);

  return (
    <div>
      <ProgressTrack step={step} />

      {/* Paso 1: servicio */}
      <section>
        <SectionHeading>{STEPS[0].heading}</SectionHeading>
        {servicesError && (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-sm text-red-600">{servicesError}</p>
            <button
              type="button"
              onClick={loadServices}
              className="tap-btn text-sm font-medium text-champagne underline underline-offset-4"
            >
              Reintentar
            </button>
          </div>
        )}
        {loadingServices && (
          <div className="mt-4 flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[4.5rem] animate-pulse rounded-[1.4rem] bg-charcoal/8" />
            ))}
            <AnimatePresence>
              {showSlowHint && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-1 text-center text-xs text-charcoal/40"
                >
                  Estamos preparando todo — puede tardar unos segundos la primera vez.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}
        {!loadingServices && !servicesError && services.length === 0 && (
          <p className="mt-2 text-sm text-charcoal/45">
            No hay servicios disponibles por el momento.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-5">
          {!loadingServices &&
            groupedServices.map((group) => (
              <div key={group.key} className="flex flex-col gap-2">
                {group.label && (
                  <p className="px-1 text-xs font-medium uppercase tracking-wide text-charcoal/40">
                    {group.label}
                  </p>
                )}
                {group.services.map((service) => {
                  const isSelected = service.id === selectedServiceId;
                  return (
                    <motion.button
                      key={service.id}
                      type="button"
                      whileHover={{ y: isSelected ? 0 : -3, scale: isSelected ? 1 : 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        haptic();
                        setSelectedServiceId(service.id);
                      }}
                      className={`relative flex items-center justify-between gap-3 overflow-hidden rounded-[1.4rem] border py-3.5 pl-4 pr-3.5 text-left transition-colors duration-200 ${
                        isSelected
                          ? "border-bubblegum/40 bg-bubblegum/[0.06]"
                          : "border-charcoal/8 bg-white hover:border-baby-pink"
                      }`}
                      style={{
                        boxShadow: isSelected
                          ? "0 10px 24px -12px rgba(255, 111, 160, 0.45)"
                          : "0 1px 2px rgba(74, 53, 64, 0.04)",
                      }}
                    >
                      <motion.span
                        animate={{ opacity: isSelected ? 1 : 0 }}
                        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-bubblegum/0 via-bubblegum to-champagne/0"
                      />
                      <div>
                        <p className="font-display text-[1.05rem] text-charcoal">{service.name}</p>
                        <p className="mt-0.5 text-[13px] text-charcoal/45">
                          {service.duration_minutes} min ·{" "}
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: service.currency,
                          }).format(Number(service.price))}
                        </p>
                      </div>
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          isSelected
                            ? "border-transparent bg-gradient-to-br from-bubblegum to-champagne"
                            : "border-charcoal/15"
                        }`}
                      >
                        <AnimatePresence>
                          {isSelected && (
                            <motion.svg
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{ type: "spring", stiffness: 500, damping: 25 }}
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5 text-white"
                              fill="none"
                            >
                              <path
                                d="M5 13l4 4L19 7"
                                stroke="currentColor"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </motion.svg>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            ))}
        </div>
      </section>

      {/* Paso 2: fecha y horario */}
      <AnimatePresence>
        {selectedService && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-8 border-t border-charcoal/8 pt-7"
          >
            <BackLink
              onClick={() => {
                setSelectedServiceId(null);
                setSelectedSlot(null);
              }}
            >
              Cambiar servicio
            </BackLink>
            <SectionHeading>{STEPS[1].heading}</SectionHeading>

            <div className="mt-4 rounded-2xl bg-charcoal/[0.03] p-3">
              <div className="flex items-center justify-between px-1">
                <button
                  type="button"
                  disabled={viewDate <= currentMonthStart}
                  onClick={() => {
                    haptic(6);
                    setViewDate((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1));
                  }}
                  className="tap-btn flex h-7 w-7 items-center justify-center rounded-full text-charcoal/50 transition-colors hover:bg-white hover:text-charcoal disabled:pointer-events-none disabled:opacity-25"
                  aria-label="Mes anterior"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                    <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span className="font-display text-sm text-charcoal">
                  {capitalize(monthYearFormatter.format(viewDate))}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptic(6);
                    setViewDate((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1));
                  }}
                  className="tap-btn flex h-7 w-7 items-center justify-center rounded-full text-charcoal/50 transition-colors hover:bg-white hover:text-charcoal"
                  aria-label="Mes siguiente"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
                {WEEKDAY_HEADERS.map((wd, i) => (
                  <span key={i} className="text-[10px] font-medium uppercase text-charcoal/35">
                    {wd}
                  </span>
                ))}
                {monthGrid.map((cell, i) => {
                  if (!cell) return <div key={`blank-${i}`} />;
                  const isActive = cell.iso === date;
                  const isToday = cell.iso === todayISODate();
                  const isPast = cell.iso < todayISODate();
                  return (
                    <div key={cell.iso} className="flex items-center justify-center py-0.5">
                      <button
                        type="button"
                        disabled={isPast}
                        onClick={() => goToDate(cell.iso)}
                        className="tap-btn relative flex h-9 w-9 items-center justify-center rounded-full text-sm disabled:pointer-events-none disabled:opacity-25"
                      >
                        {isActive && (
                          <motion.div
                            layoutId="date-pill"
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            className="absolute inset-0 rounded-full bg-gradient-to-br from-bubblegum to-champagne"
                          />
                        )}
                        <span
                          className={`relative font-display ${
                            isActive
                              ? "font-medium text-white"
                              : isToday
                                ? "font-medium text-champagne"
                                : "text-charcoal/75"
                          }`}
                        >
                          {cell.day}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              {loadingSlots && (
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-9 w-16 animate-pulse rounded-xl bg-charcoal/8" />
                  ))}
                </div>
              )}
              {!loadingSlots && slots.length === 0 && (
                <div className="flex flex-col items-start gap-2.5">
                  <p className="text-sm text-charcoal/45">
                    No hay turnos disponibles ese día — probá con otra fecha.
                  </p>
                  {!noNextDateFound && (
                    <motion.button
                      whileHover={{ scale: searchingNextDate ? 1 : 1.02 }}
                      whileTap={{ scale: searchingNextDate ? 1 : 0.98 }}
                      type="button"
                      disabled={searchingNextDate}
                      onClick={goToNextAvailableDate}
                      className="tap-btn flex items-center gap-1.5 rounded-full border border-champagne/40 bg-champagne/[0.08] px-4 py-2 text-xs font-medium text-charcoal/75 transition-colors hover:border-champagne disabled:opacity-60"
                    >
                      {searchingNextDate ? (
                        "Buscando..."
                      ) : (
                        <>
                          Ir a la próxima fecha disponible
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                            <path
                              d="M5 12h14M13 6l6 6-6 6"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </>
                      )}
                    </motion.button>
                  )}
                  {noNextDateFound && (
                    <p className="text-xs text-charcoal/40">
                      No encontramos turnos disponibles en los próximos meses.
                    </p>
                  )}
                </div>
              )}
              {!loadingSlots &&
                groupSlots(slots).map((group) => (
                  <div key={group.label} className="mb-4 last:mb-0">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-charcoal/35">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {group.items.map((slot, i) => {
                        const isActive = slot.start === selectedSlot?.start;
                        return (
                          <motion.button
                            key={slot.start}
                            type="button"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.025 }}
                            whileHover={{ scale: 1.06 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                              haptic();
                              setSelectedSlot(slot);
                            }}
                            className="relative rounded-xl text-sm"
                          >
                            {isActive && (
                              <motion.div
                                layoutId="slot-pill"
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                className="absolute inset-0 rounded-xl bg-gradient-to-br from-bubblegum to-champagne"
                              />
                            )}
                            <span
                              className={`relative block rounded-xl border px-2 py-2 text-center tabular-nums ${
                                isActive
                                  ? "border-transparent font-medium text-white"
                                  : "border-charcoal/10 text-charcoal/80"
                              }`}
                            >
                              {timeFormatter.format(new Date(slot.start))}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Paso 3: resumen, seña y datos del invitado (si no hay sesión) */}
      <AnimatePresence>
        {selectedService && selectedSlot && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-8 border-t border-charcoal/8 pt-7"
          >
            <BackLink onClick={() => setSelectedSlot(null)}>Cambiar horario</BackLink>
            <SectionHeading>{STEPS[2].heading}</SectionHeading>

            <div className="mt-4 rounded-2xl border border-charcoal/8 bg-charcoal/[0.02] p-4">
              <p className="font-display text-base text-charcoal">{selectedService.name}</p>
              <p className="mt-1 text-sm text-charcoal/55">
                {capitalize(fullDateFormatter.format(new Date(selectedSlot.start)))} ·{" "}
                {timeFormatter.format(new Date(selectedSlot.start))} hs
              </p>
              <p className="mt-2 font-display text-lg text-champagne">
                {new Intl.NumberFormat("es-AR", {
                  style: "currency",
                  currency: selectedService.currency,
                }).format(Number(selectedService.price))}
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-champagne/25 bg-champagne/[0.06] px-4 py-3.5">
              <p className="text-sm text-charcoal/75">
                Para reservar se pide una{" "}
                <span className="font-medium text-charcoal">
                  seña de {depositFormatter.format(DEPOSIT_AMOUNT)}
                </span>{" "}
                por transferencia a:
              </p>
              <TransferDetails />
            </div>

            {bookingAsGuest && (
              <div className="mt-5 flex flex-col gap-2.5">
                <div className="flex gap-2.5">
                  <input
                    type="text"
                    placeholder="Nombre"
                    required
                    value={guestFirstName}
                    onChange={(e) => setGuestFirstName(e.target.value)}
                    className="w-1/2 rounded-xl border border-charcoal/12 bg-white px-4 py-2.5 text-sm text-charcoal outline-none transition-all hover:border-baby-pink focus:border-champagne focus:ring-4 focus:ring-champagne/10"
                  />
                  <input
                    type="text"
                    placeholder="Apellido"
                    required
                    value={guestLastName}
                    onChange={(e) => setGuestLastName(e.target.value)}
                    className="w-1/2 rounded-xl border border-charcoal/12 bg-white px-4 py-2.5 text-sm text-charcoal outline-none transition-all hover:border-baby-pink focus:border-champagne focus:ring-4 focus:ring-champagne/10"
                  />
                </div>
                <input
                  type="tel"
                  placeholder="WhatsApp"
                  required
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  className="rounded-xl border border-charcoal/12 bg-white px-4 py-2.5 text-sm text-charcoal outline-none transition-all hover:border-baby-pink focus:border-champagne focus:ring-4 focus:ring-champagne/10"
                />
                <input
                  type="email"
                  placeholder="Email (opcional — para sumarlo a tu calendario)"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  className="rounded-xl border border-charcoal/12 bg-white px-4 py-2.5 text-sm text-charcoal outline-none transition-all hover:border-baby-pink focus:border-champagne focus:ring-4 focus:ring-champagne/10"
                />
              </div>
            )}

            {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}

            <motion.button
              whileHover={{ scale: submitting ? 1 : 1.015 }}
              whileTap={{ scale: submitting ? 1 : 0.98 }}
              type="button"
              disabled={
                submitting ||
                (bookingAsGuest &&
                  (!guestFirstName.trim() || !guestLastName.trim() || !guestPhone.trim()))
              }
              onClick={handleSubmit}
              className="group mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r
                from-bubblegum to-champagne py-3.5 text-sm font-medium tracking-wide text-white transition-opacity
                disabled:opacity-40"
              style={{ boxShadow: submitting ? "none" : "var(--shadow-glow)" }}
            >
              {submitting ? "Reservando..." : "Confirmar reserva"}
              {!submitting && (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  fill="none"
                >
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </motion.button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

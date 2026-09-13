import type { ApiStaff } from "../types/api";

/**
 * Estas dos cuentas tienen acceso total al salón (ver y gestionar los
 * turnos de todo el staff, servicios, staff) aunque su rol sea "staff", no
 * "owner". Coincide con `full_calendar_access_emails` en el backend, que
 * además lo exige del lado del servidor — esto solo decide qué se
 * muestra/permite acá.
 */
const FULL_ACCESS_EMAILS = ["marticarballo2711@gmail.com", "julianfalvo@gmail.com"];

type ProfileLike = Pick<ApiStaff, "role" | "email"> | null | undefined;

export function hasFullAccess(profile: ProfileLike): boolean {
  if (!profile) return false;
  if (profile.role === "owner") return true;
  return FULL_ACCESS_EMAILS.includes(profile.email?.toLowerCase() ?? "");
}

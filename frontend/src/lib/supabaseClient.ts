import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: el login no va a funcionar. " +
      "Completá frontend/.env a partir de .env.example.",
  );
}

// Supabase le agrega `type=invite|recovery` al hash de la URL cuando la
// sesión se creó por un link de mail, y se lo borra apenas la procesa
// (`createClient` abajo dispara ese procesamiento). Por eso esto se lee acá,
// de forma sincrónica, antes de que exista una carrera con esa limpieza —
// es la única forma confiable de distinguir "vino de un mail de
// invitación/recuperación" (no requiere contraseña actual, porque no la
// tiene o no la recuerda) de "ya tenía una sesión normal abierta y navegó
// directo a /set-password" (ahí sí hay que pedirle la actual, si no
// cualquiera con la sesión abierta podría tomar la cuenta).
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const _authRedirectType = hashParams.get("type");
export const authRedirectType: "invite" | "recovery" | null =
  _authRedirectType === "invite" || _authRedirectType === "recovery" ? _authRedirectType : null;

export const supabase = createClient(url ?? "", anonKey ?? "");

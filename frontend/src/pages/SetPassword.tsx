import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuthContext";
import { authRedirectType } from "../lib/supabaseClient";
import { DecorBackground } from "../components/DecorBackground";
import { Logo } from "../components/Logo";

// Si `authRedirectType` es null, esta sesión no vino de un link de
// invitación/recuperación: es una sesión normal ya abierta (alguien navegó
// directo a esta URL). Ahí sí hace falta la contraseña actual, para que no
// alcance con tener la sesión abierta en una compu para tomar la cuenta.
export function SetPassword() {
  const { user, loading, signInWithPassword, updatePassword } = useAuth();
  const navigate = useNavigate();
  const requiresCurrentPassword = authRedirectType === null;
  const mustChangePassword = user?.user_metadata?.must_change_password === true;

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Las contraseñas nuevas no coinciden");
      return;
    }
    setSubmitting(true);
    try {
      if (requiresCurrentPassword) {
        if (!user?.email) throw new Error("No se pudo verificar tu cuenta");
        try {
          await signInWithPassword(user.email, currentPassword);
        } catch {
          throw new Error("La contraseña actual no es correcta");
        }
      }
      await updatePassword(password);
      setDone(true);
      setTimeout(() => navigate("/admin"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-soft-white px-6">
      <DecorBackground />
      <div className="tap-card relative w-full max-w-sm rounded-2xl border border-baby-pink/30 bg-white/70 p-6 shadow-sm backdrop-blur-md">
        <div className="mb-4 flex justify-center">
          <Logo />
        </div>

        {loading ? (
          <p className="text-center text-sm text-charcoal/50">Cargando...</p>
        ) : !user ? (
          <>
            <h2 className="font-display text-center text-xl font-semibold text-charcoal">
              Link inválido o vencido
            </h2>
            <p className="mt-2 text-center text-sm text-charcoal/60">
              Pedí que te reenvíen la invitación o usá "¿Olvidaste tu contraseña?" desde el login.
            </p>
            <Link
              to="/admin"
              className="tap-btn mt-4 block text-center text-sm text-champagne underline-offset-2 hover:underline"
            >
              Ir al login
            </Link>
          </>
        ) : done ? (
          <p className="text-center text-sm text-charcoal/70">
            Listo, ya podés ingresar con tu contraseña nueva...
          </p>
        ) : (
          <>
            <h2 className="font-display text-center text-xl font-semibold text-charcoal">
              {requiresCurrentPassword && !mustChangePassword ? "Cambiar contraseña" : "Elegí tu contraseña"}
            </h2>
            <p className="mt-1 text-center text-xs text-charcoal/50">{user.email}</p>
            {mustChangePassword && (
              <p className="mt-2 rounded-xl bg-baby-pink/20 px-3 py-2 text-center text-xs text-charcoal/70">
                Por seguridad, antes de entrar al panel tenés que cambiar la contraseña temporal
                que te pasaron.
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
              {requiresCurrentPassword && (
                <input
                  type="password"
                  placeholder={mustChangePassword ? "Contraseña temporal" : "Contraseña actual"}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
                />
              )}
              <input
                type="password"
                placeholder="Contraseña nueva"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
              />
              <input
                type="password"
                placeholder="Repetir contraseña nueva"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
              />

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="tap-btn mt-1 rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-2 text-sm font-medium
                  text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Un momento..." : "Guardar contraseña"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

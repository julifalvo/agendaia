import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuthContext";

export function LoginPanel({ onClose }: { onClose: () => void }) {
  const { signInWithPassword, resetPasswordForEmail } = useAuth();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithPassword(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPasswordForEmail(email);
      setNotice("Te enviamos un mail para que elijas una contraseña nueva. Revisá tu bandeja (y spam).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: "login" | "forgot") {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  if (mode === "forgot") {
    return (
      <div className="tap-card rounded-2xl border border-baby-pink/30 bg-white/70 p-6 shadow-sm backdrop-blur-md">
        <h2 className="font-display text-xl font-semibold text-charcoal">Recuperar contraseña</h2>
        <p className="mt-1 text-xs text-charcoal/50">
          Te mandamos un mail con un link para elegir una contraseña nueva.
        </p>

        {notice ? (
          <p className="mt-4 text-sm text-charcoal/70">{notice}</p>
        ) : (
          <form onSubmit={handleForgotSubmit} className="mt-4 flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="tap-btn mt-1 rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-2 text-sm font-medium
                text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Un momento..." : "Enviar link"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => switchMode("login")}
          className="tap-btn mt-3 text-xs text-charcoal/50 underline-offset-2 hover:underline"
        >
          Volver a iniciar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="tap-card rounded-2xl border border-baby-pink/30 bg-white/70 p-6 shadow-sm backdrop-blur-md">
      <h2 className="font-display text-xl font-semibold text-charcoal">Iniciar sesión</h2>
      <p className="mt-1 text-xs text-charcoal/50">Acceso exclusivo para el equipo del salón.</p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
        />
        <input
          type="password"
          placeholder="Contraseña"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl border border-charcoal/15 bg-white px-4 py-2 text-sm text-charcoal outline-none transition-colors hover:border-baby-pink focus:border-champagne"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="tap-btn mt-1 rounded-full bg-gradient-to-r from-bubblegum to-champagne px-4 py-2 text-sm font-medium
            text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Un momento..." : "Ingresar"}
        </button>

        <button
          type="button"
          onClick={() => switchMode("forgot")}
          className="tap-btn text-xs text-charcoal/50 underline-offset-2 hover:underline"
        >
          ¿Olvidaste tu contraseña?
        </button>
      </form>
    </div>
  );
}

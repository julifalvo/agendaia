import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuthContext";
import { useProfile } from "../hooks/useProfileContext";
import { LoginPanel } from "../components/LoginPanel";

const NAV_LINKS = [
  { to: "/admin", label: "Agenda", end: true },
  { to: "/admin/calendar", label: "Calendario" },
  { to: "/admin/services", label: "Servicios" },
  { to: "/admin/staff", label: "Staff" },
  { to: "/admin/closures", label: "Bloquear agenda" },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-full px-4 py-1.5 text-sm transition-colors ${
    isActive
      ? "bg-baby-pink text-charcoal"
      : "text-charcoal/60 hover:text-charcoal"
  }`;
}

export function AdminLayout() {
  const { user, signOut, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();

  if (authLoading || (user && profileLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-soft-white">
        <p className="text-charcoal/50">Cargando...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-soft-white px-6">
        <p className="text-charcoal/70">
          Iniciá sesión con tu cuenta del salón para entrar al panel.
        </p>
        <div className="w-full max-w-sm">
          <LoginPanel onClose={() => {}} />
        </div>
        <Link to="/" className="text-sm text-charcoal/50 underline-offset-2 hover:underline">
          Volver a la página de reservas
        </Link>
      </main>
    );
  }

  if (profile && profile.role !== "owner" && profile.role !== "staff") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-soft-white px-6">
        <p className="text-charcoal/70">
          Tu cuenta no tiene acceso al panel del salón.
        </p>
        <Link to="/" className="text-sm text-champagne underline-offset-2 hover:underline">
          Volver a la página de reservas
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-soft-white">
      <header className="border-b border-charcoal/10 bg-white/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-display text-lg font-semibold text-charcoal">
              MC Nails Studio
            </p>
            <p className="text-xs text-charcoal/50">
              {profile?.full_name} · {profile?.role === "owner" ? "Dueña" : "Staff"}
            </p>
          </div>
          <nav className="flex items-center gap-2">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-sm text-charcoal/60 underline-offset-2 hover:underline"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <Outlet />
      </div>
    </div>
  );
}

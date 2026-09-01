import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuthContext";
import { useProfile } from "../hooks/useProfileContext";
import { DecorBackground } from "../components/DecorBackground";
import { LoginPanel } from "../components/LoginPanel";
import { Logo } from "../components/Logo";

const NAV_LINKS = [
  { to: "/admin", label: "Agenda", end: true },
  { to: "/admin/calendar", label: "Calendario" },
  { to: "/admin/services", label: "Servicios" },
  { to: "/admin/staff", label: "Staff" },
  { to: "/admin/closures", label: "Bloquear agenda" },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `tap-btn shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-all ${
    isActive
      ? "bg-gradient-to-r from-bubblegum to-champagne text-white"
      : "text-charcoal/60 hover:bg-baby-pink/25 hover:text-charcoal"
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
        <Link to="/" className="tap-btn text-sm text-charcoal/50 underline-offset-2 hover:underline">
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
        <Link to="/" className="tap-btn text-sm text-champagne underline-offset-2 hover:underline">
          Volver a la página de reservas
        </Link>
      </main>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-soft-white">
      <DecorBackground />

      <header className="safe-top relative border-b border-charcoal/10 bg-white/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:flex-nowrap sm:justify-between sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
            <Logo />
            <span className="truncate text-[11px] text-charcoal/50 sm:text-xs">
              {profile?.full_name} · {profile?.role === "owner" ? "Dueña" : "Staff"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="tap-btn shrink-0 text-xs text-charcoal/60 underline-offset-2 hover:underline sm:order-3 sm:text-sm"
          >
            Cerrar sesión
          </button>

          <nav className="flex w-full items-center gap-2 overflow-x-auto sm:order-2 sm:w-auto sm:overflow-visible">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </div>
    </div>
  );
}

import { Link, Navigate } from "react-router-dom";
import { Loader2, Gamepad2, Radar, Bell, FolderKanban } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BriefingCard } from "@/components/copilot/BriefingCard";
import logoImg from "@/assets/logo.png";

/* -------------------------------------------------------------------------- */
/* Cockpit du jour — remplace le portail des espaces.                          */
/* La navigation entre espaces se fait via la sidebar (menu latéral).          */
/* -------------------------------------------------------------------------- */

export default function Hub() {
  const {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
    canAccessSalle,
    salleOnly,
    user,
    isLoading,
  } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }

  // Responsable de salle : cockpit 100 % salle → redirige déjà dans son espace
  if (salleOnly) return <Navigate to="/salle" replace />;

  const isDir = isAdmin || isDirection;
  const firstName =
    (user?.user_metadata as any)?.full_name?.split(" ")[0] ??
    user?.email?.split("@")[0] ??
    "";
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? "Bonne nuit" : hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
  const dateLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="md:hidden"><MobileNav /></div>
          <SidebarTrigger className="hidden md:inline-flex" />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <section>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{dateLabel}</div>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-semibold">
            {greeting}{firstName ? `, ${firstName}` : ""}.
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ce qui mérite votre attention aujourd'hui.
          </p>
        </section>

        {copilotEnabled && (
          <section>
            <BriefingCard defaultExpanded={false} />
          </section>
        )}

        <QuickActions
          isDirection={isDir}
          isAdmin={isAdmin}
          canAccessSalle={canAccessSalle}
          canAccessDashboard={canAccessDashboard}
          copilotEnabled={copilotEnabled}
        />
      </main>
    </div>
  );
}



/* ============================== ACTIONS RAPIDES ========================== */

const SPACE_COLOR: Record<string, string> = {
  commerce: "--space-commerce",
  pilotage: "--space-pilotage",
  salle: "--space-salle",
  ecommerce: "--space-ecommerce",
  sav: "--space-sav",
  logistique: "--space-logistique",
};

function QuickActions({
  isDirection,
  isAdmin,
  canAccessSalle,
  canAccessDashboard,
  copilotEnabled,
}: {
  isDirection: boolean;
  isAdmin: boolean;
  canAccessSalle: boolean;
  canAccessDashboard: boolean;
  copilotEnabled: boolean;
}) {
  const actions: { label: string; to: string; icon: any; space: keyof typeof SPACE_COLOR }[] = [];
  if (canAccessSalle) actions.push({ label: "Saisir la journée salle", to: "/salle#saisie", icon: Gamepad2, space: "salle" });
  actions.push({ label: "Nouveau dossier", to: "/dossiers", icon: FolderKanban, space: "commerce" });
  if (isDirection || isAdmin) actions.push({ label: "Générer la veille", to: "/admin/veille", icon: Radar, space: "pilotage" });
  actions.push({ label: "Voir les notifications", to: "/admin/notifications", icon: Bell, space: "pilotage" });

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Actions rapides
      </h3>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const color = `hsl(var(${SPACE_COLOR[a.space]}))`;
          const border = `hsl(var(${SPACE_COLOR[a.space]}) / 0.35)`;
          const bg = `hsl(var(${SPACE_COLOR[a.space]}) / 0.08)`;
          const Icon = a.icon;
          return (
            <Link
              key={a.to}
              to={a.to}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:-translate-y-0.5 transition-transform"
              style={{ borderColor: border, backgroundColor: bg, color }}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-foreground">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

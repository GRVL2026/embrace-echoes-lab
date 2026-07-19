import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Loader2, ArrowRight } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { SPACES, type NavCtx } from "@/nav/spaces";

/**
 * Portail Arcade OS. Chaque carte = un espace. La description est suivie
 * de 3-4 destinations en liens directs (raccourcis clavier de l'équipe).
 * L'ordre et les couleurs correspondent à la sidebar.
 */
export default function Hub() {
  const {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
    isLoading,
  } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }

  // Les non-admins sont envoyés directement dans leur espace de travail.
  if (!isAdmin && !isDirection) return <Navigate to="/dossiers" replace />;

  const ctx: NavCtx = {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
  };

  const DESCRIPTIONS: Record<string, string> = {
    commerce:
      "Fiches clients, pipeline commercial, dossiers, planner arcade et catalogue.",
    pilotage:
      "Tableaux de bord AA & Magasin, revue stratégique, veille marché et copilote IA.",
    ecommerce: "Activité de la boutique en ligne : ventes, produits, clients.",
    sav: "Tickets, interventions et pièces détachées — piloté par Zendesk.",
    logistique:
      "Suivi des expéditions fournisseurs : flippers Stern (US), jeux Asie, dates, coûts.",
    reglages:
      "Utilisateurs & accès, synchronisation ERP Cegid, configuration.",
  };

  const visibleSpaces = SPACES.filter((s) => !s.show || s.show(ctx));

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="md:hidden">
            <MobileNav />
          </div>
          <SidebarTrigger className="hidden md:inline-flex" />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img
              src={logoImg}
              alt="Arcade OS logo"
              className="h-7 w-auto object-contain flex-shrink-0"
            />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-16">
        <div className="mb-10 sm:mb-14 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary uppercase tracking-wider">
            Portail
          </div>
          <h2 className="mt-4 font-display text-4xl sm:text-6xl font-bold tracking-tight">
            <span className="text-primary text-glow-purple">Gaia</span>
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
            Choisissez votre espace de travail.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {visibleSpaces.map((space) => {
            const entries = space.entries.filter((e) => !e.show || e.show(ctx));
            const first = entries[0];
            if (!first) return null;
            const color = `hsl(var(${space.colorToken}))`;
            const border = `hsl(var(${space.colorToken}) / 0.35)`;
            const borderHover = `hsl(var(${space.colorToken}) / 0.7)`;
            const bgTint = `hsl(var(${space.colorToken}) / 0.08)`;
            const Icon = space.icon;
            return (
              <div
                key={space.key}
                className="group relative flex h-full flex-col rounded-2xl border bg-card/60 p-6 transition-all hover:-translate-y-0.5"
                style={{
                  borderColor: border,
                  boxShadow: `0 0 0 1px transparent, 0 20px 40px -30px ${color}`,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = borderHover)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = border)}
              >
                <Link to={first.to} className="flex items-start gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl flex-shrink-0"
                    style={{ backgroundColor: bgTint, color }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-xl sm:text-2xl font-semibold">
                      {space.label}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {DESCRIPTIONS[space.key]}
                    </p>
                  </div>
                </Link>

                <ul className="mt-5 space-y-1.5 border-t pt-4" style={{ borderColor: border }}>
                  {entries.map((entry) => {
                    const EntryIcon = entry.icon;
                    return (
                      <li key={entry.to}>
                        <Link
                          to={entry.to}
                          className="group/entry flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <span className="inline-flex items-center gap-2">
                            <EntryIcon className="h-3.5 w-3.5" style={{ color }} />
                            <span>{entry.label}</span>
                          </span>
                          <ArrowRight
                            className="h-3.5 w-3.5 opacity-40 group-hover/entry:opacity-100 transition-opacity"
                            style={{ color }}
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

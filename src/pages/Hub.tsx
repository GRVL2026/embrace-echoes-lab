import { Link, Navigate } from "react-router-dom";
import { Loader2, Receipt } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BriefingCard } from "@/components/copilot/BriefingCard";
import { WeekActivitySection } from "@/components/copilot/WeekActivitySection";
import logoImg from "@/assets/logo.png";

/* -------------------------------------------------------------------------- */
/* Cockpit du jour — remplace le portail des espaces.                          */
/* La navigation entre espaces se fait via la sidebar (menu latéral).          */
/* -------------------------------------------------------------------------- */

export default function Hub() {
  const {
    isAdmin,
    isDirection,
    isChefVentes,
    copilotEnabled,
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
  // Le pouls commercial (devis/commandes de la semaine) reste réservé au management :
  // ce sont des chiffres globaux (montants, clients, tous commerciaux confondus).
  const isManagement = isDir || isChefVentes;
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

        {/* Cockpit commercial — toujours visible : chiffre d'affaires (exercice / mois /
            semaine) et devis/commandes de la semaine, celle-ci remise à zéro chaque lundi.
            Réservé au management : chiffres globaux (montants, clients, tous commerciaux). */}
        {isManagement && (
          <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur px-4 sm:px-5 py-4">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary flex-shrink-0">
                <Receipt className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">Activité commerciale</div>
                <div className="text-[11px] text-muted-foreground">Chiffre d'affaires · Devis &amp; commandes de la semaine</div>
              </div>
            </div>
            <WeekActivitySection />
          </section>
        )}

        {copilotEnabled && (
          <section>
            <BriefingCard defaultExpanded={false} />
          </section>
        )}
      </main>
    </div>
  );
}

import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShoppingCart, Truck, Wrench, ArrowRight, Globe } from "lucide-react";
import logoImg from "@/assets/logo.png";

type EnvCard = {
  key: string;
  title: string;
  description: string;
  Icon: typeof ShoppingCart;
  to?: string;
  available: boolean;
};

const CARDS: EnvCard[] = [
  {
    key: "commerce",
    title: "Commerce",
    description: "Dossiers commerciaux, planner arcade, catalogue et Dashboard.",
    Icon: ShoppingCart,
    to: "/dossiers",
    available: true,
  },
  {
    key: "logistique",
    title: "Logistique",
    description: "Suivi des expéditions fournisseurs : flippers Stern (US), jeux Asie, dates, coûts, documents.",
    Icon: Truck,
    to: "/logistique",
    available: true,
  },
  {
    key: "ecommerce",
    title: "E-commerce",
    description: "Activité de la boutique en ligne : ventes, produits, clients.",
    Icon: Globe,
    to: "/ecommerce",
    available: true,
  },
  {
    key: "sav",
    title: "SAV",
    description: "Tickets, interventions et pièces détachées — piloté par Zendesk.",
    Icon: Wrench,
    to: "/sav",
    available: true,
  },
];

export default function Hub() {
  const { isAdmin, canAccessGaia, isLoading } = useAuth();
  const visibleCards = CARDS.filter((c) => c.key !== "sav" || canAccessGaia);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }

  // Non-admins are sent directly to their workspace.
  if (!isAdmin) return <Navigate to="/dossiers" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
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
            Choisissez votre environnement de travail.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {visibleCards.map(({ key, title, description, Icon, to, available }) => {
            const inner = (
              <div
                className={`group relative flex h-full flex-col justify-between rounded-2xl border p-6 sm:p-8 transition-all ${
                  available
                    ? "border-primary/30 bg-card/60 hover:border-primary/60 hover:bg-card/80 hover:-translate-y-0.5 cursor-pointer"
                    : "border-border/50 bg-card/20 opacity-60 cursor-not-allowed"
                }`}
              >
                <div>
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                      available ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <h3 className="font-display text-xl sm:text-2xl font-semibold">{title}</h3>
                    {!available && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                        Bientôt
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                </div>
                {available && (
                  <div className="mt-6 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-80 group-hover:opacity-100">
                    Entrer <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
            if (available && to) {
              return (
                <Link key={key} to={to} className="block h-full">
                  {inner}
                </Link>
              );
            }
            return (
              <div key={key} aria-disabled className="h-full">
                {inner}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

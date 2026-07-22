import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { useAuth } from "@/contexts/AuthContext";
import logoImg from "@/assets/logo.png";
import type { ReactNode } from "react";

/**
 * En-tête d'application partagée entre toutes les pages authentifiées.
 * L'ancienne barre de navigation horizontale a été remplacée par la
 * barre latérale persistante (AppSidebar) — cette en-tête n'affiche plus
 * que le logo, le fil d'Ariane et le UserMenu.
 */
export function AppHeader({ right, standalone = false }: { right?: ReactNode; standalone?: boolean }) {
  const { isAdmin, isLoading } = useAuth();

  return (
    <header
      className="sticky top-0 z-40 flex w-full items-center justify-between border-b border-border bg-background/85 backdrop-blur px-3 sm:px-6 gap-2 flex-shrink-0"
      style={{ paddingTop: "var(--safe-top)", minHeight: "calc(3.5rem + var(--safe-top))" }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="md:hidden flex-shrink-0">
          <MobileNav />
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS" className="h-6 sm:h-7 w-auto object-contain" />
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Link to={isAdmin ? "/" : "/dossiers"} className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS" className="h-6 sm:h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-sm sm:text-xl font-bold tracking-tight whitespace-nowrap truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
        )}
        <div className="hidden md:flex ml-4 min-w-0">
          <Breadcrumbs />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {right}
        <div className="hidden md:block">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

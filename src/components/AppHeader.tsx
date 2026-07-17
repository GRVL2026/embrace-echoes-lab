import { Link, useLocation } from "react-router-dom";
import { Database, Loader2, Radar, Shield, Globe, Wrench } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { useAuth } from "@/contexts/AuthContext";
import logoImg from "@/assets/logo.png";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type NavItem = {
  to: string;
  label: string;
  icon?: React.ElementType;
  match?: (pathname: string) => boolean;
  show?: (ctx: { isAdmin: boolean; canAccessGaia: boolean }) => boolean;
};

const NAV: NavItem[] = [
  { to: "/dossiers", label: "Dossiers", match: (p) => p === "/dossiers" || p.startsWith("/dossiers/") },
  {
    to: "/planner",
    label: "Arcade Planner",
    match: (p) => p === "/planner" || p.startsWith("/planner/"),
  },
  { to: "/catalogue", label: "Catalogue" },
  {
    to: "/ecommerce",
    label: "E-commerce",
    icon: Globe,
    show: ({ canAccessGaia }) => canAccessGaia,
  },
  {
    to: "/sav",
    label: "SAV",
    icon: Wrench,
    show: ({ canAccessGaia }) => canAccessGaia,
  },
  {
    to: "/admin/gaia",
    label: "Dashboard",
    icon: Database,
    show: ({ canAccessGaia }) => canAccessGaia,
    match: (p) => p.startsWith("/admin/gaia"),
  },
  {
    to: "/admin/veille",
    label: "Veille",
    icon: Radar,
    show: ({ canAccessGaia }) => canAccessGaia,
  },
  {
    to: "/admin",
    label: "Admin",
    icon: Shield,
    show: ({ isAdmin }) => isAdmin,
    match: (p) => p === "/admin" || p.startsWith("/admin/") && !p.startsWith("/admin/gaia") && !p.startsWith("/admin/veille"),
  },
];

export function AppHeader({ right }: { right?: ReactNode }) {
  const { isAdmin, canAccessGaia, isLoading } = useAuth();
  const { pathname } = useLocation();

  const isActive = (item: NavItem) =>
    item.match ? item.match(pathname) : pathname === item.to;

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
        <nav className="ml-4 hidden md:flex items-center gap-1">
          {NAV.filter((it) => !it.show || it.show({ isAdmin, canAccessGaia })).map((it) => {
            const active = isActive(it);
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1",
                  active
                    ? "bg-primary/15 border border-primary/40 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {it.label}
              </Link>
            );
          })}
        </nav>
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

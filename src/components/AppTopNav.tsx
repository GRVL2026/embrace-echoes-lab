import { Link, useLocation } from "react-router-dom";
import { Database, Radar, Shield, Link2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type NavItem = {
  to: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  show: boolean;
};

/**
 * Barre de sous-navigation partagée entre toutes les pages "admin/pro" (Dossiers,
 * Planner, Catalogue, Dashboard, Veille, Admin, Catalogue↔ERP).
 *
 * L'élément actif est déduit du pathname courant — ne jamais dupliquer ce nav
 * dans une page (évite les oublis de renommage).
 */
export function AppTopNav() {
  const { isAdmin, canAccessGaia, canAccessDashboard } = useAuth();
  const { pathname } = useLocation();

  const items: NavItem[] = [
    { to: "/dossiers", label: "Dossiers", show: true },
    { to: "/planner", label: "Arcade Planner", show: true },
    { to: "/catalogue", label: "Catalogue", show: true },
    { to: "/admin/gaia", label: "Dashboard", icon: Database, show: canAccessDashboard },
    { to: "/admin/veille", label: "Veille", icon: Radar, show: canAccessGaia },
    { to: "/admin/catalog-erp", label: "Catalogue ↔ ERP", icon: Link2, show: isAdmin },
    { to: "/admin", label: "Admin", icon: Shield, show: isAdmin },
  ];

  const isActive = (to: string) => {
    if (to === "/admin") return pathname === "/admin";
    return pathname === to || pathname.startsWith(to + "/");
  };

  return (
    <nav className="ml-4 hidden md:flex items-center gap-1">
      {items.filter((i) => i.show).map((i) => {
        const active = isActive(i.to);
        const Icon = i.icon;
        const base = "rounded-md px-3 py-1 text-xs font-medium inline-flex items-center gap-1";
        const cls = active
          ? `${base} bg-primary/15 border border-primary/40 text-primary`
          : `${base} text-muted-foreground hover:text-foreground hover:bg-muted`;
        return (
          <Link key={i.to} to={i.to} className={cls}>
            {Icon && <Icon className="h-3 w-3" />} {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

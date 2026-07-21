import {
  ShoppingCart,
  Users,
  KanbanSquare,
  FolderKanban,
  LayoutGrid,
  BookOpen,
  Compass,
  BarChart3,
  Package,
  ClipboardCheck,
  Radar,
  Bot,
  Globe,
  Wrench,
  Truck,
  Settings,
  ShieldCheck,
  RefreshCw,
  Cog,
  Bell,
  Building2,
  Gamepad2,
  Grid2x2,
  type LucideIcon,
} from "lucide-react";

export type SpaceKey =
  | "commerce"
  | "salle"
  | "pilotage"
  | "ecommerce"
  | "sav"
  | "logistique"
  | "reglages";

export type NavCtx = {
  isAdmin: boolean;
  isDirection: boolean;
  canAccessGaia: boolean;
  canAccessDashboard: boolean;
  copilotEnabled: boolean;
  canAccessSalle: boolean;
  salleOnly: boolean;
};

export type NavEntry = {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Test si l'URL courante correspond à cette entrée (surligne la nav). */
  match?: (pathname: string, hash: string) => boolean;
  /** Filtre selon les droits du user. Par défaut toujours visible. */
  show?: (ctx: NavCtx) => boolean;
};

export type Space = {
  key: SpaceKey;
  label: string;
  icon: LucideIcon;
  /** Nom du token CSS de couleur, ex: "--space-commerce". */
  colorToken: string;
  show?: (ctx: NavCtx) => boolean;
  entries: NavEntry[];
};

const startsWith = (prefix: string) => (p: string) =>
  p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix + "?");

export const SPACES: Space[] = [
  {
    key: "commerce",
    label: "Commerce",
    icon: ShoppingCart,
    colorToken: "--space-commerce",
    show: (c) => !c.salleOnly,
    entries: [
      {
        label: "Clients",
        to: "/clients",
        icon: Users,
        show: (c) => c.canAccessDashboard,
        match: startsWith("/clients"),
      },

      {
        label: "Pipeline",
        to: "/admin/gaia/carnet/devis",
        icon: KanbanSquare,
        show: (c) => c.canAccessDashboard,
        match: (p) => p.startsWith("/admin/gaia/carnet"),
      },
      {
        label: "Dossiers commerciaux",
        to: "/dossiers",
        icon: FolderKanban,
        match: startsWith("/dossiers"),
      },
      {
        label: "Arcade Planner",
        to: "/planner",
        icon: LayoutGrid,
        match: startsWith("/planner"),
      },
      {
        label: "Catalogue",
        to: "/catalogue",
        icon: BookOpen,
        match: startsWith("/catalogue"),
      },
    ],
  },
  {
    key: "pilotage",
    label: "Pilotage",
    icon: Compass,
    colorToken: "--space-pilotage",
    show: (c) => c.isDirection,
    entries: [
      {
        label: "Dashboard AA",
        to: "/admin/gaia#aa",
        icon: BarChart3,
        match: (p, h) => p === "/admin/gaia" && h === "#aa",
      },
      {
        label: "Matrice CA × marge",
        to: "/admin/matrice-clients",
        icon: Grid2x2,
        show: (c) => c.isDirection,
        match: startsWith("/admin/matrice-clients"),
      {
        label: "Dashboard Magasin",
        to: "/admin/gaia#magasin",
        icon: Package,
        match: (p, h) => p === "/admin/gaia" && h === "#magasin",
      },
      {
        label: "Revue stratégique",
        to: "/admin/gaia#revue",
        icon: ClipboardCheck,
        match: (p, h) => p === "/admin/gaia" && h === "#revue",
      },
      {
        label: "Veille marché",
        to: "/admin/veille",
        icon: Radar,
        match: startsWith("/admin/veille"),
      },
      {
        label: "Copilote IA",
        to: "/admin/gaia#copilote",
        icon: Bot,
        show: (c) => c.copilotEnabled,
        match: (p, h) => p === "/admin/gaia" && h === "#copilote",
      },
    ],
  },
  {
    key: "salle",
    label: "Salle Hyper Nova",
    icon: Gamepad2,
    colorToken: "--space-salle",
    show: (c) => c.canAccessSalle,
    entries: [
      {
        label: "Saisie du jour",
        to: "/salle#saisie",
        icon: ClipboardCheck,
        match: (p, h) => p === "/salle" && (h === "" || h === "#saisie"),
      },
      {
        label: "Dashboard salle",
        to: "/salle#dashboard",
        icon: BarChart3,
        match: (p, h) => p === "/salle" && h === "#dashboard",
      },
    ],
  },
  {
    key: "ecommerce",
    label: "E-commerce",
    icon: Globe,
    colorToken: "--space-ecommerce",
    show: (c) => c.canAccessGaia,
    entries: [
      {
        label: "Boutique en ligne",
        to: "/ecommerce",
        icon: Globe,
        match: startsWith("/ecommerce"),
      },
    ],
  },
  {
    key: "sav",
    label: "SAV",
    icon: Wrench,
    colorToken: "--space-sav",
    show: (c) => c.canAccessGaia,
    entries: [
      {
        label: "Tickets & interventions",
        to: "/sav",
        icon: Wrench,
        match: startsWith("/sav"),
      },
    ],
  },
  {
    key: "logistique",
    label: "Logistique",
    icon: Truck,
    colorToken: "--space-logistique",
    show: (c) => c.isAdmin,
    entries: [
      {
        label: "Expéditions & imports",
        to: "/logistique",
        icon: Truck,
        match: startsWith("/logistique"),
      },
    ],
  },
  {
    key: "reglages",
    label: "Réglages",
    icon: Settings,
    colorToken: "--space-reglages",
    show: (c) => c.isAdmin || c.isDirection,
    entries: [
      {
        label: "Notifications",
        to: "/admin/notifications",
        icon: Bell,
        match: startsWith("/admin/notifications"),
      },
      {
        label: "Utilisateurs & accès",
        to: "/admin",
        icon: ShieldCheck,
        show: (c) => c.isAdmin,
        match: (p) => p === "/admin",
      },
      {
        label: "Synchronisation ERP",
        to: "/admin/synchronisation",
        icon: RefreshCw,
        show: (c) => c.isAdmin,
        match: startsWith("/admin/synchronisation"),
      },
      {
        label: "Catalogue ↔ ERP",
        to: "/admin/catalog-erp",
        icon: Cog,
        show: (c) => c.isAdmin,
        match: startsWith("/admin/catalog-erp"),
      },
      {
        label: "Entreprises (INSEE)",
        to: "/admin/entreprises",
        icon: Building2,
        show: (c) => c.isAdmin || c.isDirection,
        match: startsWith("/admin/entreprises"),
      },
    ],
  },
];

/** Résout l'espace + l'entrée courants à partir de l'URL. */
export function resolveActive(
  pathname: string,
  hash: string,
  ctx: NavCtx,
): { space: Space | null; entry: NavEntry | null } {
  for (const space of SPACES) {
    if (space.show && !space.show(ctx)) continue;
    for (const entry of space.entries) {
      if (entry.show && !entry.show(ctx)) continue;
      if (entry.match?.(pathname, hash)) return { space, entry };
    }
  }
  // Fallback : premier match par prefix pathname sans hash.
  for (const space of SPACES) {
    for (const entry of space.entries) {
      const to = entry.to.split("#")[0];
      if (to && (pathname === to || pathname.startsWith(to + "/"))) {
        return { space, entry };
      }
    }
  }
  return { space: null, entry: null };
}

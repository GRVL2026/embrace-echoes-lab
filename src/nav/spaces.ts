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
  Globe,
  Wrench,

  Settings,
  ShieldCheck,
  RefreshCw,
  Cog,
  Bell,
  Building2,
  Gamepad2,
  Grid2x2,
  ShoppingBag,
  Target,
  Map as MapIcon,
  RotateCcw as RotateCcwIcon,
  type LucideIcon,
} from "lucide-react";

export type SpaceKey =
  | "commerce"
  | "prospection"
  | "salle"
  | "pilotage"
  | "ecommerce"
  | "sav"
  | "achats"
  | "reglages";

export type NavCtx = {
  isAdmin: boolean;
  isDirection: boolean;
  canAccessGaia: boolean;
  canAccessDashboard: boolean;
  canMargeGlobale: boolean;
  copilotEnabled: boolean;
  canAccessSalle: boolean;
  canAccessProspection: boolean;
  canReactivation: boolean;
  salleOnly: boolean;
  /** Overrides d'accès par section/sous-section (admin-managed).
   *  Retourne true/false (override) ou undefined (fallback show()). */
  menuAllowed?: (key: string) => boolean | undefined;
};

export type NavEntry = {
  /** Clé stable de la sous-section (ex: "commerce.clients"). */
  key: string;
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
        key: "commerce.clients",
        label: "Clients",
        to: "/clients",
        icon: Users,
        show: (c) => c.canAccessDashboard,
        match: startsWith("/clients"),
      },



      {
        key: "commerce.pipeline",
        label: "Pipeline",
        to: "/admin/gaia/carnet/devis",
        icon: KanbanSquare,
        show: (c) => c.canAccessDashboard,
        match: (p) => p.startsWith("/admin/gaia/carnet"),
      },
      {
        key: "commerce.dossiers",
        label: "Dossiers commerciaux",
        to: "/dossiers",
        icon: FolderKanban,
        match: startsWith("/dossiers"),
      },
      {
        key: "commerce.planner",
        label: "Arcade Planner",
        to: "/planner",
        icon: LayoutGrid,
        match: startsWith("/planner"),
      },
      {
        key: "commerce.catalogue",
        label: "Catalogue",
        to: "/catalogue",
        icon: BookOpen,
        match: startsWith("/catalogue"),
      },
    ],
  },
  {
    key: "prospection",
    label: "Prospection",
    icon: Target,
    colorToken: "--space-prospection",
    show: (c) => c.canAccessProspection,
    entries: [
      {
        key: "prospection.pipeline",
        label: "Pipeline prospects",
        to: "/prospection",
        icon: Target,
        match: startsWith("/prospection"),
      },
      {
        key: "prospection.reconquete",
        label: "À relancer",
        to: "/reconquete",
        icon: RotateCcwIcon,
        show: (c) => c.canReactivation,
        match: startsWith("/reconquete"),
      },
      {
        key: "prospection.carte",
        label: "Carte",
        to: "/carte?vue=prospection",
        icon: MapIcon,
        show: (c) => c.isAdmin || c.isDirection,
        match: (p, _h) => p === "/carte",
      },
    ],
  },
  {
    key: "achats",
    label: "Achats",
    icon: ShoppingBag,
    colorToken: "--space-logistique",
    show: (c) => c.isAdmin || c.isDirection,
    entries: [
      {
        key: "achats.dashboard",
        label: "Dashboard achats",
        to: "/achats",
        icon: BarChart3,
        match: startsWith("/achats"),
      },
    ],
  },
  {

    key: "pilotage",
    label: "Pilotage",
    icon: Compass,
    colorToken: "--space-pilotage",
    show: (c) => c.canMargeGlobale,
    entries: [
      {
        key: "pilotage.dashboard_aa",
        label: "Dashboard AA",
        to: "/admin/gaia#aa",
        icon: BarChart3,
        match: (p, h) => p === "/admin/gaia" && h === "#aa",
      },
      {
        key: "pilotage.dashboard_magasin",
        label: "Dashboard Magasin",
        to: "/admin/gaia#magasin",
        icon: Package,
        match: (p, h) => p === "/admin/gaia" && h === "#magasin",
      },
      {
        key: "pilotage.matrice_familles",
        label: "Matrice familles",
        to: "/matrice-familles",
        icon: Grid2x2,
        show: (c) => c.canMargeGlobale,
        match: startsWith("/matrice-familles"),
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
        key: "salle.saisie",
        label: "Saisie du jour",
        to: "/salle#saisie",
        icon: ClipboardCheck,
        match: (p, h) => p === "/salle" && (h === "" || h === "#saisie"),
      },
      {
        key: "salle.dashboard",
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
        key: "ecommerce.boutique",
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
        key: "sav.tickets",
        label: "Tickets & interventions",
        to: "/sav",
        icon: Wrench,
        match: startsWith("/sav"),
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
        key: "reglages.notifications",
        label: "Notifications",
        to: "/admin/notifications",
        icon: Bell,
        match: startsWith("/admin/notifications"),
      },
      {
        key: "reglages.utilisateurs",
        label: "Utilisateurs & accès",
        to: "/admin",
        icon: ShieldCheck,
        show: (c) => c.isAdmin,
        match: (p) => p === "/admin",
      },
      {
        key: "reglages.synchronisation",
        label: "Synchronisation ERP",
        to: "/admin/synchronisation",
        icon: RefreshCw,
        show: (c) => c.isAdmin,
        match: startsWith("/admin/synchronisation"),
      },
      {
        key: "reglages.catalog_erp",
        label: "Catalogue ↔ ERP",
        to: "/admin/catalog-erp",
        icon: Cog,
        show: (c) => c.isAdmin,
        match: startsWith("/admin/catalog-erp"),
      },
      {
        key: "reglages.entreprises",
        label: "Entreprises (INSEE)",
        to: "/admin/entreprises",
        icon: Building2,
        show: (c) => c.isAdmin || c.isDirection,
        match: startsWith("/admin/entreprises"),
      },
    ],
  },
];

/** Vérifie si une clé de menu est autorisée pour ctx.
 *  Règle : admin/direction bypass. Sinon : override explicite user_menu_access
 *  gagne sur le show() ; en l'absence d'override, on retombe sur show()
 *  (backward-compat).
 */
export function isMenuKeyAllowed(
  ctx: NavCtx,
  key: string,
  fallback: boolean,
): boolean {
  if (ctx.isAdmin || ctx.isDirection) return fallback;
  const override = ctx.menuAllowed?.(key);
  if (override === undefined) return fallback;
  return override && fallback;
}

/** Filtre les entrées visibles d'un espace pour un ctx donné (show + override). */
export function visibleEntries(space: Space, ctx: NavCtx): NavEntry[] {
  return space.entries.filter((e) => {
    const base = e.show ? e.show(ctx) : true;
    return isMenuKeyAllowed(ctx, e.key, base);
  });
}

/** Filtre les espaces visibles (show du space + au moins une entrée visible). */
export function visibleSpaces(ctx: NavCtx): Space[] {
  return SPACES.filter((s) => {
    const base = s.show ? s.show(ctx) : true;
    if (!isMenuKeyAllowed(ctx, s.key, base)) return false;
    return visibleEntries(s, ctx).length > 0;
  });
}

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
      const to = entry.to.split("#")[0].split("?")[0];
      if (to && (pathname === to || pathname.startsWith(to + "/"))) {
        return { space, entry };
      }
    }
  }
  return { space: null, entry: null };
}

/** Retourne toutes les clés (espaces + entrées) — utile pour l'UI admin. */
export function allMenuKeys(): { spaces: SpaceKey[]; entries: string[] } {
  return {
    spaces: SPACES.map((s) => s.key),
    entries: SPACES.flatMap((s) => s.entries.map((e) => e.key)),
  };
}

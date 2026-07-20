import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowRight, AlertCircle, AlertTriangle, Info, Plus, Gamepad2, Radar, Bell, FolderKanban, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BriefingCard } from "@/components/copilot/BriefingCard";
import logoImg from "@/assets/logo.png";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Cockpit du jour — remplace le portail des espaces.                          */
/* La navigation entre espaces se fait via la sidebar (menu latéral).          */
/* -------------------------------------------------------------------------- */

const TOTAL_KEYS = ["ca_pax_ht", "ca_cartes_ht", "ca_merch_ht"] as const;
const OBJ_JOUR = 500;
const OBJ_SEMAINE = 3500;

const eur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);

function startOfWeekMonday(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
function toISODate(d: Date) {
  // Date locale (YYYY-MM-DD) — évite le décalage UTC qui, un lundi matin à Paris,
  // renverrait la date du dimanche et casserait la borne de semaine ISO.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

        <AlertsSection />

        <NumbersSection
          isDirection={isDir}
          canAccessSalle={canAccessSalle}
          isAdmin={isAdmin}
          canAccessDashboard={canAccessDashboard}
        />

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

/* ============================== ALERTES ================================== */

type Alerte = {
  id: string;
  gravite: "info" | "attention" | "urgent";
  titre: string;
  constat: string;
  action_suggeree: string | null;
  lien: string | null;
  statut: "nouveau" | "lu" | "traite" | "ignore";
};

function GraviteDot({ g }: { g: Alerte["gravite"] }) {
  if (g === "urgent") return <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />;
  if (g === "attention") return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
  return <Info className="h-4 w-4 text-blue-400 flex-shrink-0" />;
}

function AlertsSection() {
  const { copilotEnabled, isDirection, isAdmin } = useAuth();
  const enabled = copilotEnabled && (isAdmin || isDirection);
  const { data: alertes = [], isLoading } = useQuery({
    queryKey: ["hub-alertes"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Alerte[]> => {
      const { data, error } = await (supabase as any)
        .from("copilot_alertes")
        .select("id, gravite, titre, constat, action_suggeree, lien, statut")
        .in("statut", ["nouveau", "lu"])
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as Alerte[];
    },
  });

  if (!enabled) return null;

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Alertes en cours
      </h3>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Chargement…</div>
      ) : alertes.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          Aucune alerte — tout est calme.
        </div>
      ) : (
        <ul className="rounded-xl border border-border bg-card/40 divide-y divide-border overflow-hidden">
          {alertes.map((a) => {
            const content = (
              <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                <GraviteDot g={a.gravite} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{a.titre}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{a.constat}</div>
                </div>
                {a.lien && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/60 mt-0.5 flex-shrink-0" />
                )}
              </div>
            );
            return (
              <li key={a.id}>
                {a.lien ? <Link to={a.lien}>{content}</Link> : content}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ============================== CHIFFRES DU JOUR ========================= */

// Couleurs des espaces (correspond aux tokens CSS)
const SPACE_COLOR: Record<string, string> = {
  commerce: "--space-commerce",
  pilotage: "--space-pilotage",
  salle: "--space-salle",
  ecommerce: "--space-ecommerce",
  sav: "--space-sav",
  logistique: "--space-logistique",
};

function KpiCard({
  space,
  label,
  value,
  hint,
  trend,
  to,
}: {
  space: keyof typeof SPACE_COLOR;
  label: string;
  value: string;
  hint?: string;
  trend?: { pct: number; label?: string };
  to: string;
}) {
  const color = `hsl(var(${SPACE_COLOR[space]}))`;
  const bg = `hsl(var(${SPACE_COLOR[space]}) / 0.08)`;
  const border = `hsl(var(${SPACE_COLOR[space]}) / 0.35)`;
  const TrendIcon = trend ? (trend.pct > 0 ? TrendingUp : trend.pct < 0 ? TrendingDown : Minus) : null;
  return (
    <Link
      to={to}
      className="group relative flex flex-col justify-between rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        borderColor: border,
        backgroundColor: bg,
        boxShadow: `0 20px 40px -35px ${color}`,
      }}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>
        {label}
      </div>
      <div className="mt-2 font-display text-2xl sm:text-3xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 min-h-[16px] flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {trend && TrendIcon && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              trend.pct > 0 ? "text-emerald-400" : trend.pct < 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <TrendIcon className="h-3 w-3" />
            {trend.pct > 0 ? "+" : ""}{Math.round(trend.pct)}%
          </span>
        )}
        {hint && <span className="truncate">{hint}</span>}
      </div>
    </Link>
  );
}

function NumbersSection({
  isDirection,
  isAdmin,
  canAccessSalle,
  canAccessDashboard,
}: {
  isDirection: boolean;
  isAdmin: boolean;
  canAccessSalle: boolean;
  canAccessDashboard: boolean;
}) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Chiffres du jour
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {canAccessSalle && <SalleCard />}
        {isDirection && <PipelineCard />}
        {isAdmin && <LogistiqueCard />}
        {isDirection && <SavCard />}
        {!isDirection && canAccessDashboard && <DevisRelanceCard />}
      </div>
    </section>
  );
}

function SalleCard() {
  const { data } = useQuery({
    queryKey: ["hub-salle-semaine"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const today = new Date();
      const monday = startOfWeekMonday(today);
      const { data, error } = await (supabase as any)
        .from("salle_journees")
        .select("date, ca_pax_ht, ca_cartes_ht, ca_merch_ht")
        .gte("date", toISODate(monday))
        .lte("date", toISODate(today))
        .order("date", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, any>>;
      const total = rows.reduce(
        (s, r) => s + TOTAL_KEYS.reduce((a, k) => a + Number(r[k] ?? 0), 0),
        0,
      );
      const last = rows.length ? rows[rows.length - 1] : null;
      const lastTotal = last
        ? TOTAL_KEYS.reduce((a, k) => a + Number((last as any)[k] ?? 0), 0)
        : 0;
      const lastLabel = last
        ? new Date((last as any).date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long" })
        : null;
      return { total, lastLabel, lastTotal };
    },
  });
  const total = data?.total ?? 0;
  const pct = OBJ_SEMAINE ? Math.round((total / OBJ_SEMAINE) * 100) : 0;
  const hint = data?.lastLabel
    ? `${pct}% de 3 500 € · Dernier jour saisi : ${data.lastLabel} — ${eur(data.lastTotal)}`
    : `${pct}% de l'objectif 3 500 €`;
  return (
    <KpiCard
      space="salle"
      label="CA salle — semaine en cours"
      value={eur(total)}
      hint={hint}
      to="/salle#dashboard"
    />
  );
}

function PipelineCard() {
  const { data } = useQuery({
    queryKey: ["hub-pipeline"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_gaia_pipeline")
        .select("categorie, statut, total_ht, sfa");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ categorie: string; statut: string; total_ht: number | string; sfa?: boolean }>;
      const totalHorsSfa = rows
        .filter((r) => r.categorie === "devis" && !r.sfa)
        .reduce((s, r) => s + Number(r.total_ht || 0), 0);
      return { totalHorsSfa };
    },
  });
  return (
    <KpiCard
      space="commerce"
      label="Pipeline ouvert"
      value={eur(data?.totalHorsSfa ?? 0)}
      hint="Devis en cours (hors SFA)"
      to="/admin/gaia/carnet/devis"
    />
  );
}

function LogistiqueCard() {
  const { data } = useQuery({
    queryKey: ["hub-logi-retard"],
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const today = toISODate(new Date());
      const { data, error } = await (supabase as any)
        .from("logi_expeditions")
        .select("id, statut, eta_le_havre")
        .in("statut", ["en_mer", "en_cours", "a_venir"])
        .not("eta_le_havre", "is", null)
        .lt("eta_le_havre", today);
      if (error) throw error;
      return { count: (data ?? []).length };
    },
  });
  const n = data?.count ?? 0;
  return (
    <KpiCard
      space="logistique"
      label="Expéditions en retard"
      value={String(n)}
      hint={n === 0 ? "Aucun retard" : "ETA dépassée"}
      to="/logistique"
    />
  );
}

function SavCard() {
  const { data } = useQuery({
    queryKey: ["hub-sav"],
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("zendesk_stats_cache")
        .select("payload, fetched_at")
        .eq("period_key", "default")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const p = (data?.payload ?? {}) as any;
      const kpi = p.kpi ?? {};
      const ouverts = Number(kpi.ouverts ?? 0) + Number(kpi.nouveaux ?? 0);
      return { ouverts };
    },
  });
  return (
    <KpiCard
      space="sav"
      label="Tickets SAV ouverts"
      value={String(data?.ouverts ?? 0)}
      hint="Nouveaux + ouverts"
      to="/sav"
    />
  );
}

function DevisRelanceCard() {
  const { data } = useQuery({
    queryKey: ["hub-devis-relance"],
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_gaia_devis_a_relancer")
        .select("n_cde, montant_ht");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ montant_ht: number | string }>;
      const total = rows.reduce((s, r) => s + Number(r.montant_ht || 0), 0);
      return { count: rows.length, total };
    },
  });
  return (
    <KpiCard
      space="commerce"
      label="Devis à relancer"
      value={String(data?.count ?? 0)}
      hint={data?.total ? `${eur(data.total)} en jeu` : undefined}
      to="/admin/gaia/carnet/devis"
    />
  );
}

/* ============================== ACTIONS RAPIDES ========================== */

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

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp, TrendingDown, AlertTriangle, AlertOctagon, Info, Target,
  ChevronDown, Phone, Moon, Package, Sparkles, ArrowRight, MessageCircle,
  CalendarClock, CalendarDays, CalendarRange, CheckCircle2, Circle, User,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip,
} from "recharts";
import { ChartTooltipContent, barTooltipCursor } from "./chartTooltip";

export type PlanActionHorizon = "cette_semaine" | "ce_mois" | "ce_trimestre";

export type PlanAction = {
  titre: string;
  constat: string;
  impact_potentiel_eur: number;
  responsable_suggere: string;
  horizon: PlanActionHorizon;
  premieres_etapes: string[];
};

export type SignalVigilance = { titre: string; detail: string };

export type RevueData = {
  sante: {
    commentaire: string;
    annees: { annee: number; ca_ht: number; evolution_pct?: number }[];
    tendance_mensuelle: { mois: string; evolution_pct: number; commentaire?: string }[];
  };
  mouvements: {
    familles: { nom: string; sens: "hausse" | "baisse"; detail: string }[];
    clients_hausse: { client: string; detail: string }[];
    clients_baisse: { client: string; detail: string }[];
  };
  risques: { titre: string; gravite: "haute" | "moyenne" | "basse"; detail: string }[];
  /** Legacy — TOP 5 actions plates (conservé pour compat des anciennes revues). */
  actions: { rang: number; titre: string; qui: string; cible: string; impact_eur: number; pourquoi: string }[];
  /** Plan d'action stratégique priorisé par horizon. */
  plan_actions?: PlanAction[];
  /** Signaux de vigilance chiffrés. */
  signaux_vigilance?: SignalVigilance[];
};

export const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);

export const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

export function exerciceLabel(annee: number, short = false) {
  if (short) return `Ex. ${annee}`;
  return `Exercice ${annee} (sept. ${annee - 1} → août ${annee})`;
}

export function isRevueEmpty(r: RevueData | null | undefined): boolean {
  if (!r || typeof r !== "object") return true;
  const sante = r.sante ?? ({} as any);
  const santeFilled =
    typeof sante.commentaire === "string" &&
    sante.commentaire.trim().length > 0 &&
    Array.isArray(sante.annees) &&
    sante.annees.length > 0;
  const mvts = r.mouvements ?? ({} as any);
  const sectionsFilled =
    (Array.isArray(mvts.familles) ? mvts.familles.length : 0) +
    (Array.isArray(mvts.clients_hausse) ? mvts.clients_hausse.length : 0) +
    (Array.isArray(mvts.clients_baisse) ? mvts.clients_baisse.length : 0) +
    (Array.isArray(r.risques) ? r.risques.length : 0) +
    (Array.isArray(r.actions) ? r.actions.length : 0) +
    (Array.isArray(r.plan_actions) ? r.plan_actions.length : 0) +
    (Array.isArray(r.signaux_vigilance) ? r.signaux_vigilance.length : 0);
  return !santeFilled || sectionsFilled === 0;
}


export function revueToText(r: RevueData): string {
  const lines: string[] = [];
  lines.push(`# Revue commerciale du mois\n`);
  lines.push(`## Santé`);
  lines.push(r.sante.commentaire);
  r.sante.annees.forEach((a) =>
    lines.push(`- ${exerciceLabel(a.annee, true)} : ${eur(a.ca_ht)}${a.evolution_pct != null ? ` (${pct(a.evolution_pct)})` : ""}`)
  );
  lines.push(`\n### Tendance mensuelle`);
  r.sante.tendance_mensuelle.forEach((m) =>
    lines.push(`- ${m.mois} : ${pct(m.evolution_pct)}${m.commentaire ? ` — ${m.commentaire}` : ""}`)
  );
  if (r.plan_actions?.length) {
    lines.push(`\n## Plan d'action stratégique`);
    r.plan_actions.forEach((a, i) => {
      lines.push(`${i + 1}. [${horizonLabel(a.horizon)}] ${a.titre} — impact ${eur(a.impact_potentiel_eur)} · ${a.responsable_suggere}`);
      lines.push(`   Constat : ${a.constat}`);
      (a.premieres_etapes ?? []).forEach((e) => lines.push(`   • ${e}`));
    });
  }
  if (r.signaux_vigilance?.length) {
    lines.push(`\n## Signaux de vigilance`);
    r.signaux_vigilance.forEach((s) => lines.push(`- ${s.titre} — ${s.detail}`));
  }
  if (r.actions?.length) {
    lines.push(`\n## Actions prioritaires (héritage)`);
    r.actions.forEach((a) => lines.push(`${a.rang}. ${a.titre} (${eur(a.impact_eur)}) — ${a.qui} · ${a.cible} · ${a.pourquoi}`));
  }
  lines.push(`\n## Mouvements`);
  lines.push(`### Familles`);
  r.mouvements.familles.forEach((f) => lines.push(`- ${f.sens === "hausse" ? "↗" : "↘"} ${f.nom} — ${f.detail}`));
  lines.push(`### Clients en hausse`);
  r.mouvements.clients_hausse.forEach((c) => lines.push(`- ${c.client} — ${c.detail}`));
  lines.push(`### Clients en baisse`);
  r.mouvements.clients_baisse.forEach((c) => lines.push(`- ${c.client} — ${c.detail}`));
  lines.push(`\n## Risques`);
  r.risques.forEach((x) => lines.push(`- [${x.gravite.toUpperCase()}] ${x.titre} — ${x.detail}`));
  return lines.join("\n");
}

const eurCompact = (n: number) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")} M€`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)} k€`;
  return `${v} €`;
};

/* ============ KPI band ============ */

function KpiTile({
  label, value, evo, highlight,
}: { label: string; value: string; evo?: number; highlight?: boolean }) {
  return (
    <div
      className={`flex-1 min-w-[140px] rounded-lg border p-3 ${
        highlight
          ? "border-primary/50 bg-primary/10"
          : "border-border/60 bg-background/40"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
      {evo != null && !isNaN(evo) && (
        <div
          className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${
            evo >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {evo >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {pct(evo)} <span className="font-normal text-muted-foreground">vs N-1</span>
        </div>
      )}
    </div>
  );
}

function MonthlySparkline({ data }: { data: { mois: string; evolution_pct: number; commentaire?: string }[] }) {
  if (!data?.length) return null;
  const chart = data.map((m) => ({
    mois: m.mois,
    evo: Math.max(-50, Math.min(50, Number(m.evolution_pct) || 0)),
    raw: Number(m.evolution_pct) || 0,
    commentaire: m.commentaire,
  }));
  return (
    <div className="h-[110px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="mois"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis hide domain={[-50, 50]} />
          <Tooltip
            cursor={barTooltipCursor}
            content={
              <ChartTooltipContent
                hideLabel={false}
                formatter={(_v: any, _n: any, item: any) => [
                  `${pct(item?.payload?.raw ?? 0)}${item?.payload?.commentaire ? ` — ${item.payload.commentaire}` : ""}`,
                  "Évolution",
                ]}
              />
            }
          />
          <Bar dataKey="evo" radius={[3, 3, 0, 0]}>
            {chart.map((d, i) => (
              <Cell key={i} fill={d.evo >= 0 ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiBand({ data }: { data: RevueData }) {
  const sorted = [...(data.sante?.annees ?? [])].sort((a, b) => b.annee - a.annee);
  const n = sorted[0];
  const n1 = sorted[1];
  const n2 = sorted[2];
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
      <div className="flex flex-wrap gap-3">
        {n && <KpiTile label={`Ex. ${n.annee} — période égale`} value={eurCompact(n.ca_ht)} evo={n.evolution_pct} highlight />}
        {n1 && <KpiTile label={`Ex. ${n1.annee}`} value={eurCompact(n1.ca_ht)} evo={n1.evolution_pct} />}
        {n2 && <KpiTile label={`Ex. ${n2.annee}`} value={eurCompact(n2.ca_ht)} evo={n2.evolution_pct} />}
        <div className="flex-[2] min-w-[260px] rounded-lg border border-border/60 bg-background/60 p-2">
          <div className="px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Tendance mensuelle vs N-1
          </div>
          <MonthlySparkline data={data.sante?.tendance_mensuelle ?? []} />
        </div>
      </div>
      {data.sante?.commentaire && (
        <p className="mt-3 line-clamp-2 text-sm text-foreground/90">{data.sante.commentaire}</p>
      )}
    </div>
  );
}

/* ============ Actions ============ */

function actionIcon(titre: string) {
  const t = (titre || "").toLowerCase();
  if (/devis|relan/.test(t)) return Phone;
  if (/dormant|inact|reveil|réveil/.test(t)) return Moon;
  if (/stock|logist|livrais/.test(t)) return Package;
  return Sparkles;
}

function ActionCard({
  a, rank, knownClients,
}: { a: RevueData["actions"][number]; rank: number; knownClients: string[] }) {
  const [open, setOpen] = useState(false);
  const highlight = rank === 1;
  const Icon = actionIcon(a.titre);
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        highlight
          ? "border-primary/50 bg-primary/10 hover:bg-primary/15"
          : "border-border/60 bg-background/40 hover:bg-background/70"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
            highlight ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          }`}
        >
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className={`h-4 w-4 shrink-0 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
              <div className={`font-semibold leading-snug ${open ? "" : "line-clamp-2"}`}>
                {a.titre}
              </div>
            </div>
            <div
              className={`shrink-0 rounded-md px-2 py-0.5 font-display text-base font-bold tabular-nums ${
                highlight ? "bg-primary/20 text-primary" : "bg-muted text-foreground"
              }`}
            >
              {eur(a.impact_eur)}
            </div>
          </div>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Voir le détail →
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="text-muted-foreground">
                <span className="text-foreground/80">Qui :</span> {linkifyClients(a.qui, knownClients)}
                <span className="mx-1.5 text-border">·</span>
                <span className="text-foreground/80">Cible :</span> {linkifyClients(a.cible, knownClients)}
              </div>
              {a.pourquoi && (
                <div className="text-foreground/80">{emphasizeNumbers(a.pourquoi)}</div>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                Réduire
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ Mouvements ============ */

function extractPct(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(-?\d+(?:[.,]\d+)?)\s?%/);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

function MvtBullet({ name, detail, sens }: { name: string; detail: string; sens: "hausse" | "baisse" }) {
  const p = extractPct(detail);
  const positive = sens === "hausse";
  return (
    <li className="flex items-baseline justify-between gap-2 py-1 text-sm">
      <span className="min-w-0 truncate font-medium" title={detail}>{name}</span>
      {p != null ? (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
            positive ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
          }`}
        >
          {pct(p)}
        </span>
      ) : (
        <ArrowRight className={`h-3 w-3 shrink-0 ${positive ? "text-emerald-400" : "text-rose-400"}`} />
      )}
    </li>
  );
}

function MouvementsBlock({ data }: { data: RevueData }) {
  const hausse = [
    ...data.mouvements.familles.filter((f) => f.sens === "hausse").map((f) => ({ name: f.nom, detail: f.detail })),
    ...data.mouvements.clients_hausse.map((c) => ({ name: c.client, detail: c.detail })),
  ];
  const baisse = [
    ...data.mouvements.familles.filter((f) => f.sens === "baisse").map((f) => ({ name: f.nom, detail: f.detail })),
    ...data.mouvements.clients_baisse.map((c) => ({ name: c.client, detail: c.detail })),
  ];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
          <TrendingUp className="h-4 w-4" /> En hausse
        </div>
        <ul className="divide-y divide-border/40">
          {hausse.length === 0 && <li className="py-2 text-xs text-muted-foreground">Aucun mouvement.</li>}
          {hausse.map((x, i) => <MvtBullet key={`h${i}`} name={x.name} detail={x.detail} sens="hausse" />)}
        </ul>
      </div>
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-rose-400">
          <TrendingDown className="h-4 w-4" /> En baisse
        </div>
        <ul className="divide-y divide-border/40">
          {baisse.length === 0 && <li className="py-2 text-xs text-muted-foreground">Aucun mouvement.</li>}
          {baisse.map((x, i) => <MvtBullet key={`b${i}`} name={x.name} detail={x.detail} sens="baisse" />)}
        </ul>
      </div>
    </div>
  );
}

/* ============ Risques (accordion fermé) ============ */

function RisqueRow({ r }: { r: RevueData["risques"][number] }) {
  const [open, setOpen] = useState(false);
  const cfg = risqueStyle(r.gravite);
  const Icon = cfg.icon;
  return (
    <div className={`rounded-lg border border-border/60 bg-background/40 ${cfg.border}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon className={`h-4 w-4 shrink-0 ${cfg.iconColor}`} />
        <div className="min-w-0 flex-1 truncate font-medium text-foreground">{r.titre}</div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cfg.badge}`}>
          {r.gravite}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2 text-sm text-foreground/80">
          {emphasizeNumbers(r.detail)}
        </div>
      )}
    </div>
  );
}

function RisquesBlock({ items }: { items: RevueData["risques"] }) {
  const sorted = [...items].sort((a, b) => graviteOrder(a.gravite) - graviteOrder(b.gravite));
  return (
    <div className="flex flex-col gap-2">
      {sorted.map((r, i) => <RisqueRow key={i} r={r} />)}
    </div>
  );
}

/* ============ Plan d'action stratégique (par horizon) ============ */

const HORIZONS: { key: PlanActionHorizon; label: string; icon: typeof CalendarClock; tone: string }[] = [
  { key: "cette_semaine", label: "Cette semaine", icon: CalendarClock, tone: "border-primary/50 bg-primary/10" },
  { key: "ce_mois", label: "Ce mois", icon: CalendarDays, tone: "border-secondary/40 bg-secondary/5" },
  { key: "ce_trimestre", label: "Ce trimestre", icon: CalendarRange, tone: "border-border/60 bg-background/40" },
];

export function horizonLabel(h: PlanActionHorizon | string): string {
  return HORIZONS.find((x) => x.key === h)?.label ?? String(h);
}

function PlanActionCard({
  a, idx, knownClients, onAskCopilot,
}: {
  a: PlanAction;
  idx: number;
  knownClients: string[];
  onAskCopilot?: (prompt: string) => void;
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const toggle = (i: number) => setChecked((s) => ({ ...s, [i]: !s[i] }));

  const askPrompt = useMemo(() => {
    const etapes = (a.premieres_etapes ?? []).map((e, i) => `${i + 1}. ${e}`).join("\n");
    return `Contexte issu de la revue commerciale — action à approfondir :

**${a.titre}** (${horizonLabel(a.horizon)}, responsable suggéré : ${a.responsable_suggere}, impact estimé : ${eur(a.impact_potentiel_eur)})

Constat : ${a.constat}

Premières étapes proposées :
${etapes}

Aide-moi à concrétiser cette action : chiffres à vérifier, script d'appel/mail, arbitrages à trancher, prochaines décisions.`;
  }, [a]);

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3 hover:bg-background/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">#{idx + 1}</span>
            <User className="h-3 w-3" />
            <span className="truncate">{a.responsable_suggere}</span>
          </div>
          <div className="mt-1 font-semibold leading-snug text-foreground">
            {linkifyClients(a.titre, knownClients)}
          </div>
        </div>
        <div className="shrink-0 rounded-md bg-primary/20 px-2 py-1 text-right">
          <div className="font-display text-sm font-bold tabular-nums text-primary">
            {eur(a.impact_potentiel_eur)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-primary/80">Impact</div>
        </div>
      </div>

      {a.constat && (
        <p className="mt-2 text-xs text-foreground/85">
          <span className="font-semibold text-muted-foreground">Constat : </span>
          {emphasizeNumbers(a.constat)}
        </p>
      )}

      {a.premieres_etapes?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {a.premieres_etapes.map((e, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50"
              >
                {checked[i] ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={checked[i] ? "text-muted-foreground line-through" : "text-foreground/85"}>{e}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {onAskCopilot && (
        <div className="mt-2 flex justify-end print:hidden">
          <button
            type="button"
            onClick={() => onAskCopilot(askPrompt)}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
          >
            <MessageCircle className="h-3 w-3" />
            Demander au copilote
          </button>
        </div>
      )}
    </div>
  );
}

function PlanActionsBoard({
  items, knownClients, onAskCopilot,
}: {
  items: PlanAction[];
  knownClients: string[];
  onAskCopilot?: (prompt: string) => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<PlanActionHorizon, PlanAction[]> = { cette_semaine: [], ce_mois: [], ce_trimestre: [] };
    items.forEach((a) => {
      const h = (HORIZONS.find((x) => x.key === a.horizon)?.key) ?? "ce_mois";
      g[h].push(a);
    });
    (Object.keys(g) as PlanActionHorizon[]).forEach((k) =>
      g[k].sort((a, b) => (b.impact_potentiel_eur || 0) - (a.impact_potentiel_eur || 0)),
    );
    return g;
  }, [items]);

  let running = 0;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {HORIZONS.map(({ key, label, icon: Icon, tone }) => {
        const list = grouped[key];
        const total = list.reduce((s, a) => s + (Number(a.impact_potentiel_eur) || 0), 0);
        return (
          <div key={key} className={`rounded-lg border p-3 ${tone}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon className="h-4 w-4 text-primary" />
                {label}
              </div>
              {total > 0 && (
                <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                  {eur(total)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {list.length === 0 && (
                <div className="rounded border border-dashed border-border/60 p-2 text-center text-[11px] text-muted-foreground">
                  Aucune action
                </div>
              )}
              {list.map((a) => {
                const idx = running++;
                return (
                  <PlanActionCard
                    key={`${key}-${idx}`}
                    a={a}
                    idx={idx}
                    knownClients={knownClients}
                    onAskCopilot={onAskCopilot}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VigilanceBanner({ items }: { items: SignalVigilance[] }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-amber-300">
        <AlertTriangle className="h-4 w-4" /> Signaux de vigilance
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            <div>
              <div className="font-semibold text-amber-100">{s.titre}</div>
              <div className="text-amber-100/80">{emphasizeNumbers(s.detail)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============ Main ============ */

export function RevueDashboard({
  data,
  onAskCopilot,
}: {
  data: RevueData;
  onAskCopilot?: (prompt: string) => void;
}) {
  const knownClients = collectClients(data);
  const planActions = Array.isArray(data.plan_actions) ? data.plan_actions : [];
  const legacyTopActions = [...(data.actions ?? [])].sort((a, b) => a.rang - b.rang).slice(0, 5);
  const vigilance = Array.isArray(data.signaux_vigilance) ? data.signaux_vigilance : [];

  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-5 revue-dashboard">
      {/* KPI band */}
      <section id="revue-sante">
        <KpiBand data={data} />
      </section>

      {/* Signaux de vigilance en bandeau ambre */}
      {vigilance.length > 0 && (
        <section id="revue-vigilance">
          <VigilanceBanner items={vigilance} />
        </section>
      )}

      {/* Sticky anchor bar */}
      <nav className="sticky top-0 z-10 -mx-2 flex items-center gap-1 border-b border-border/60 bg-background/85 px-2 py-1.5 backdrop-blur print:hidden">
        {planActions.length > 0 && (
          <a href="#revue-plan" onClick={scrollTo("revue-plan")} className="rounded-md px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted">
            <Target className="mr-1 inline h-3.5 w-3.5 text-primary" />
            Plan d'action
          </a>
        )}
        {legacyTopActions.length > 0 && (
          <a href="#revue-actions" onClick={scrollTo("revue-actions")} className="rounded-md px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted">
            <Target className="mr-1 inline h-3.5 w-3.5 text-primary" />
            Actions
          </a>
        )}
        <a href="#revue-mouvements" onClick={scrollTo("revue-mouvements")} className="rounded-md px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted">
          <TrendingUp className="mr-1 inline h-3.5 w-3.5 text-primary" />
          Mouvements
        </a>
        <a href="#revue-risques" onClick={scrollTo("revue-risques")} className="rounded-md px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-primary" />
          Risques
        </a>
      </nav>

      {/* Plan d'action stratégique par horizon */}
      {planActions.length > 0 && (
        <section id="revue-plan" className="scroll-mt-16">
          <h4 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-4 w-4 text-primary" /> Plan d'action stratégique
          </h4>
          <PlanActionsBoard items={planActions} knownClients={knownClients} onAskCopilot={onAskCopilot} />
        </section>
      )}

      {/* Actions legacy (rétrocompat pour les anciennes revues) */}
      {legacyTopActions.length > 0 && (
        <section id="revue-actions" className="scroll-mt-16">
          <h4 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-4 w-4 text-primary" /> Actions prioritaires
          </h4>
          <div className="flex flex-col gap-2">
            {legacyTopActions.map((a, i) => (
              <ActionCard key={a.rang ?? i} a={a} rank={a.rang ?? i + 1} knownClients={knownClients} />
            ))}
          </div>
        </section>
      )}

      {/* Mouvements */}
      <section id="revue-mouvements" className="scroll-mt-16">
        <h4 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <TrendingUp className="h-4 w-4 text-primary" /> Mouvements
        </h4>
        <MouvementsBlock data={data} />
      </section>

      {/* Risques */}
      {data.risques?.length > 0 && (
        <section id="revue-risques" className="scroll-mt-16">
          <h4 className="mb-2 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-primary" /> Risques
          </h4>
          <RisquesBlock items={data.risques} />
        </section>
      )}
    </div>
  );
}

/* ============ Helpers ============ */

const graviteOrder = (g: string) => (g === "haute" ? 0 : g === "moyenne" ? 1 : 2);

function risqueStyle(g: string) {
  if (g === "haute") {
    return {
      border: "border-l-4 border-l-rose-500",
      badge: "bg-rose-500/20 text-rose-300",
      icon: AlertOctagon,
      iconColor: "text-rose-400",
    };
  }
  if (g === "moyenne") {
    return {
      border: "border-l-4 border-l-amber-500",
      badge: "bg-amber-500/20 text-amber-300",
      icon: AlertTriangle,
      iconColor: "text-amber-400",
    };
  }
  return {
    border: "border-l-4 border-l-muted-foreground/60",
    badge: "bg-muted text-muted-foreground",
    icon: Info,
    iconColor: "text-muted-foreground",
  };
}

function emphasizeNumbers(text: string) {
  if (!text) return text;
  const regex = /(\d{1,3}(?:[ .]\d{3})+(?:[.,]\d+)?\s?(?:€|k€|M€|%)?|\d+(?:[.,]\d+)?\s?(?:€|k€|M€|%)|\b(?:19|20)\d{2}\b)/g;
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={`n${i++}`} className="font-semibold text-foreground">{m[0]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function collectClients(data: RevueData): string[] {
  const set = new Set<string>();
  data.mouvements?.clients_hausse?.forEach((c) => c.client && set.add(c.client));
  data.mouvements?.clients_baisse?.forEach((c) => c.client && set.add(c.client));
  return Array.from(set);
}

function linkifyClients(text: string, clients: string[]) {
  if (!text) return text;
  const sorted = [...clients].sort((a, b) => b.length - a.length).filter(Boolean);
  if (sorted.length === 0) return text;
  const escaped = sorted.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((p, i) =>
        sorted.includes(p) ? (
          <Link
            key={i}
            to={`/admin/gaia/client/${encodeURIComponent(p)}`}
            className="font-medium text-primary hover:underline"
          >
            {p}
          </Link>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

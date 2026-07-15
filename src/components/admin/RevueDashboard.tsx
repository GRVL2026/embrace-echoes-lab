import { Link } from "react-router-dom";
import {
  Sparkles, TrendingUp, TrendingDown, AlertTriangle, AlertOctagon, Info, Target,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

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
  actions: { rang: number; titre: string; qui: string; cible: string; impact_eur: number; pourquoi: string }[];
};

export const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0);

export const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

export function exerciceLabel(annee: number, short = false) {
  if (short) return `Ex. ${annee}`;
  return `Exercice ${annee} (sept. ${annee - 1} → août ${annee})`;
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
  lines.push(`\n## Mouvements`);
  lines.push(`### Familles`);
  r.mouvements.familles.forEach((f) => lines.push(`- ${f.sens === "hausse" ? "↗" : "↘"} ${f.nom} — ${f.detail}`));
  lines.push(`### Clients en hausse`);
  r.mouvements.clients_hausse.forEach((c) => lines.push(`- ${c.client} — ${c.detail}`));
  lines.push(`### Clients en baisse`);
  r.mouvements.clients_baisse.forEach((c) => lines.push(`- ${c.client} — ${c.detail}`));
  lines.push(`\n## Risques`);
  r.risques.forEach((x) => lines.push(`- [${x.gravite.toUpperCase()}] ${x.titre} — ${x.detail}`));
  lines.push(`\n## Actions prioritaires`);
  r.actions.forEach((a) => lines.push(`${a.rang}. ${a.titre} (${eur(a.impact_eur)}) — ${a.qui} · ${a.cible} · ${a.pourquoi}`));
  return lines.join("\n");
}

function EvolBadge({ value }: { value?: number }) {
  if (value == null || isNaN(value)) return null;
  const positive = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${
        positive ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
      }`}
    >
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pct(value)}
    </span>
  );
}

function MonthPill({ mois, evolution_pct, commentaire }: { mois: string; evolution_pct: number; commentaire?: string }) {
  const clamp = Math.max(-30, Math.min(30, evolution_pct));
  const bg =
    clamp >= 0
      ? `rgba(16,185,129,${0.15 + (clamp / 30) * 0.35})`
      : `rgba(244,63,94,${0.15 + (-clamp / 30) * 0.35})`;
  return (
    <div
      title={commentaire || ""}
      className="flex min-w-[68px] flex-col items-center rounded border border-border/60 px-2 py-1.5 text-center revue-pill"
      style={{ backgroundColor: bg }}
    >
      <div className="text-[11px] font-medium capitalize text-foreground/80">{mois}</div>
      <div className={`text-xs font-semibold tabular-nums ${evolution_pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
        {pct(evolution_pct)}
      </div>
    </div>
  );
}

const eurCompact = (n: number) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")} M€`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)} k€`;
  return `${v} €`;
};

function SanteChart({ annees }: { annees: { annee: number; ca_ht: number; evolution_pct?: number }[] }) {
  const sorted = [...annees].sort((a, b) => a.annee - b.annee);
  if (sorted.length === 0) return null;
  const lastAnnee = sorted[sorted.length - 1].annee;
  const data = sorted.map((a) => ({
    label: `Ex. ${a.annee}`,
    annee: a.annee,
    ca: Number(a.ca_ht) || 0,
    evo: a.evolution_pct,
    isLast: a.annee === lastAnnee,
  }));

  // Y domain with headroom for top value labels
  const maxCa = Math.max(...data.map((d) => d.ca), 0);
  const minCa = Math.min(...data.map((d) => d.ca), 0);
  const yMax = maxCa * 1.18 || 1;
  const yMin = minCa < 0 ? minCa * 1.1 : 0;

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const isLast = payload?.isLast;
    return (
      <g>
        {isLast && (
          <circle cx={cx} cy={cy} r={11} fill="hsl(var(--primary) / 0.18)" />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={isLast ? 6 : 4}
          fill={isLast ? "hsl(var(--primary))" : "hsl(var(--background))"}
          stroke="hsl(var(--primary))"
          strokeWidth={isLast ? 2.5 : 2}
        />
      </g>
    );
  };

  const ValueLabel = (props: any) => {
    const { x, y, value, index } = props;
    if (x == null || y == null || value == null) return null;
    const d = data[index];
    const isLast = d?.isLast;
    return (
      <text
        x={x}
        y={y - 18}
        textAnchor="middle"
        className="tabular-nums"
        fill={isLast ? "hsl(var(--primary))" : "hsl(var(--foreground))"}
        fontSize={isLast ? 13 : 12}
        fontWeight={isLast ? 700 : 600}
      >
        {eurCompact(Number(value))}
      </text>
    );
  };

  const EvoLabel = (props: any) => {
    const { x, y, index } = props;
    if (x == null || y == null) return null;
    const d = data[index];
    if (d?.evo == null || isNaN(d.evo)) return null;
    const positive = d.evo >= 0;
    return (
      <text
        x={x}
        y={y + 26}
        textAnchor="middle"
        fill={positive ? "rgb(52 211 153)" : "rgb(251 113 133)"}
        fontSize={11}
        fontWeight={700}
      >
        {pct(d.evo)}
      </text>
    );
  };

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 36, right: 40, left: 24, bottom: 40 }}>
          <defs>
            <linearGradient id="santeCaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border) / 0.25)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 24, right: 24 }}
            tickMargin={12}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v) => eurCompact(Number(v))}
            axisLine={false}
            tickLine={false}
            width={52}
            tickCount={4}
            domain={[yMin, yMax]}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: any, _n, item: any) => {
              const evo = item?.payload?.evo;
              return [
                `${eurCompact(Number(value))}${evo != null ? ` (${pct(evo)})` : ""}`,
                "CA à période égale",
              ];
            }}
          />
          <Area
            type="monotone"
            dataKey="ca"
            stroke="hsl(var(--primary))"
            strokeWidth={3}
            fill="url(#santeCaFill)"
            dot={<CustomDot />}
            activeDot={{ r: 7, fill: "hsl(var(--primary))" }}
            label={<ValueLabel />}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ca"
            stroke="transparent"
            dot={false}
            label={<EvoLabel />}
            isAnimationActive={false}
            legendType="none"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RevueDashboard({ data }: { data: RevueData }) {
  return (
    <div className="space-y-5 revue-dashboard">
      {/* Santé */}
      <section className="revue-section">
        <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Santé globale
        </h4>
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 revue-card">
          <SanteChart annees={data.sante.annees} />
        </div>
        {data.sante.commentaire && (
          <p className="mt-3 text-sm text-foreground/90">{data.sante.commentaire}</p>
        )}
        {data.sante.tendance_mensuelle?.length > 0 && (
          <>
            <div className="mt-4 text-xs uppercase text-muted-foreground">Tendance mensuelle vs exercice précédent</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.sante.tendance_mensuelle.map((m, i) => <MonthPill key={i} {...m} />)}
            </div>
          </>
        )}
      </section>

      {/* Mouvements */}
      <section className="revue-section">
        <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <TrendingUp className="h-4 w-4 text-primary" /> Mouvements
        </h4>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 revue-card">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
              <TrendingUp className="h-4 w-4" /> En hausse ↗
            </div>
            <ul className="divide-y divide-border/40">
              {data.mouvements.familles.filter((f) => f.sens === "hausse").map((f, i) => (
                <li key={`fh${i}`} className="py-1.5 text-sm">
                  <span className="font-medium">{f.nom}</span>
                  <span className="text-muted-foreground"> — {f.detail}</span>
                </li>
              ))}
              {data.mouvements.clients_hausse.map((c, i) => (
                <li key={`ch${i}`} className="py-1.5 text-sm">
                  <span className="font-medium">{c.client}</span>
                  <span className="text-muted-foreground"> — {c.detail}</span>
                </li>
              ))}
              {data.mouvements.familles.filter((f) => f.sens === "hausse").length === 0 &&
                data.mouvements.clients_hausse.length === 0 && (
                  <li className="py-2 text-xs text-muted-foreground">Aucun mouvement à la hausse.</li>
                )}
            </ul>
          </div>
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 revue-card">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-400">
              <TrendingDown className="h-4 w-4" /> En baisse ↘
            </div>
            <ul className="divide-y divide-border/40">
              {data.mouvements.familles.filter((f) => f.sens === "baisse").map((f, i) => (
                <li key={`fb${i}`} className="py-1.5 text-sm">
                  <span className="font-medium">{f.nom}</span>
                  <span className="text-muted-foreground"> — {f.detail}</span>
                </li>
              ))}
              {data.mouvements.clients_baisse.map((c, i) => (
                <li key={`cb${i}`} className="py-1.5 text-sm">
                  <span className="font-medium">{c.client}</span>
                  <span className="text-muted-foreground"> — {c.detail}</span>
                </li>
              ))}
              {data.mouvements.familles.filter((f) => f.sens === "baisse").length === 0 &&
                data.mouvements.clients_baisse.length === 0 && (
                  <li className="py-2 text-xs text-muted-foreground">Aucun mouvement à la baisse.</li>
                )}
            </ul>
          </div>
        </div>
      </section>

      {/* Risques */}
      {data.risques?.length > 0 && (
        <section className="revue-section">
          <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-primary" /> Risques
          </h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[...data.risques]
              .sort((a, b) => graviteOrder(a.gravite) - graviteOrder(b.gravite))
              .map((r, i) => {
                const cfg = risqueStyle(r.gravite);
                const Icon = cfg.icon;
                return (
                  <div
                    key={i}
                    className={`flex h-full flex-col rounded-lg border border-border/60 bg-background/40 p-3 pl-4 revue-card ${cfg.border}`}
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconColor}`} />
                        <div className={`font-semibold leading-snug line-clamp-2 ${cfg.title}`}>{r.titre}</div>
                      </div>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cfg.badge}`}>
                        {r.gravite}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80">{emphasizeNumbers(r.detail)}</p>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Actions */}
      {data.actions?.length > 0 && (
        <section className="revue-section">
          <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-4 w-4 text-primary" /> Actions prioritaires
          </h4>
          <div className="flex flex-col gap-2">
            {[...data.actions]
              .sort((a, b) => a.rang - b.rang)
              .map((a) => {
                const highlight = a.rang === 1;
                const knownClients = collectClients(data);
                return (
                  <div
                    key={a.rang}
                    className={`group flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:items-start sm:gap-4 revue-card ${
                      highlight
                        ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                        : "border-border/60 bg-background/40 hover:bg-background/70"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
                        highlight
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {a.rang}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                        <div className={`font-semibold leading-snug break-words ${highlight ? "text-foreground" : "text-foreground/95"}`}>
                          {a.titre}
                        </div>
                        <div
                          className={`font-display text-lg font-bold tabular-nums sm:text-xl ${
                            highlight ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {eur(a.impact_eur)}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span className="text-foreground/80">Qui :</span> {linkifyClients(a.qui, knownClients)}
                        <span className="mx-1.5 text-border">·</span>
                        <span className="text-foreground/80">Cible :</span> {linkifyClients(a.cible, knownClients)}
                      </div>
                      {a.pourquoi && (
                        <div className="mt-1 text-xs text-foreground/70">{emphasizeNumbers(a.pourquoi)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}

const graviteOrder = (g: string) => (g === "haute" ? 0 : g === "moyenne" ? 1 : 2);

function risqueStyle(g: string) {
  if (g === "haute") {
    return {
      border: "border-l-4 border-l-rose-500",
      badge: "bg-rose-500/20 text-rose-300",
      icon: AlertOctagon,
      iconColor: "text-rose-400",
      title: "text-foreground",
    };
  }
  if (g === "moyenne") {
    return {
      border: "border-l-4 border-l-amber-500",
      badge: "bg-amber-500/20 text-amber-300",
      icon: AlertTriangle,
      iconColor: "text-amber-400",
      title: "text-foreground",
    };
  }
  return {
    border: "border-l-4 border-l-muted-foreground/60",
    badge: "bg-muted text-muted-foreground",
    icon: Info,
    iconColor: "text-muted-foreground",
    title: "text-foreground",
  };
}

// Bold numbers: montants (€, k€, M€), pourcentages, années 4 chiffres
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

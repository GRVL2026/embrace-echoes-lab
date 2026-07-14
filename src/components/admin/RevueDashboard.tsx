import {
  Sparkles, TrendingUp, TrendingDown, AlertTriangle, Target,
} from "lucide-react";

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

export function RevueDashboard({ data }: { data: RevueData }) {
  return (
    <div className="space-y-5 revue-dashboard">
      {/* Santé */}
      <section className="revue-section">
        <h4 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Santé globale
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {data.sante.annees.map((a) => (
            <div key={a.annee} className="rounded-lg border border-border/60 bg-background/40 p-3 revue-card">
              <div className="text-xs uppercase text-muted-foreground">{exerciceLabel(a.annee, true)}</div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{eur(a.ca_ht)}</div>
              <div className="mt-1"><EvolBadge value={a.evolution_pct} /></div>
              <div className="mt-1 text-[10px] text-muted-foreground/80">sept. {a.annee - 1} → août {a.annee}</div>
            </div>
          ))}
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.risques.map((r, i) => {
              const style =
                r.gravite === "haute"
                  ? "border-rose-500/50 bg-rose-500/10"
                  : r.gravite === "moyenne"
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-border/60 bg-background/40";
              const badge =
                r.gravite === "haute"
                  ? "bg-rose-500/20 text-rose-300"
                  : r.gravite === "moyenne"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-muted text-muted-foreground";
              return (
                <div key={i} className={`rounded-lg border p-3 revue-card ${style}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="font-medium">{r.titre}</div>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge}`}>{r.gravite}</span>
                  </div>
                  <p className="text-sm text-foreground/80">{r.detail}</p>
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[...data.actions].sort((a, b) => a.rang - b.rang).map((a) => (
              <div key={a.rang} className="relative flex flex-col rounded-lg border border-primary/30 bg-primary/5 p-3 revue-card">
                <div className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">
                  {a.rang}
                </div>
                <div className="mt-2 font-semibold leading-tight">{a.titre}</div>
                <div className="mt-2 font-display text-xl font-bold tabular-nums text-primary">{eur(a.impact_eur)}</div>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div><span className="text-foreground/80">Qui :</span> {a.qui}</div>
                  <div><span className="text-foreground/80">Cible :</span> {a.cible}</div>
                  <div className="mt-1 text-foreground/70">{a.pourquoi}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const DEVIS = "#a78bfa";
const DEVIS_DARK = "#7c3aed";
const CMD = "#34d399";
const CMD_DARK = "#059669";

type HebdoRow = { jour: string; type_doc: "devis" | "commande"; univers: "jeux" | "magasin"; n_docs: number; montant: number };
type CaRow = { ca_n: number; ca_n1: number; ca_m: number; ca_m1: number; ca_s: number; ca_s1: number };
type JourDoc = { n_cde: string; type_doc: "devis" | "commande"; code_client: string | null; montant_ht: number | null; univers: "jeux" | "magasin" | null; proprietaire: string | null };
type SemaineDoc = JourDoc & { jour: string };

type DetailSelection =
  | { kind: "jour"; day: string }
  | { kind: "semaine"; typeDoc: "devis" | "commande" };

function isoMonday(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const eur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);

const LEGEND_ITEMS: { key: string; label: string; color: string; dashed: boolean }[] = [
  { key: "devis_jeux", label: "Devis · Jeux", color: DEVIS_DARK, dashed: false },
  { key: "devis_magasin", label: "Devis · Magasin", color: DEVIS_DARK, dashed: true },
  { key: "commandes_jeux", label: "Commandes · Jeux", color: CMD_DARK, dashed: false },
  { key: "commandes_magasin", label: "Commandes · Magasin", color: CMD_DARK, dashed: true },
];

function CustomLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center px-2 pt-1">
      {LEGEND_ITEMS.map((it) => (
        <div key={it.key} className="flex items-center gap-1.5 text-[11px] text-foreground/85">
          <svg width="22" height="8" aria-hidden>
            <line
              x1="1"
              y1="4"
              x2="21"
              y2="4"
              stroke={it.color}
              strokeWidth={2}
              strokeDasharray={it.dashed ? "4 3" : undefined}
              strokeLinecap="round"
            />
          </svg>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function WeekActivitySection() {
  const today = new Date();
  const monday = isoMonday(today);
  const prevMonday = addDays(monday, -7);
  const currentDays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  const prevDays = Array.from({ length: 5 }, (_, i) => addDays(prevMonday, i));
  const currentIsoDays = currentDays.map(toISODate);
  const prevIsoDays = prevDays.map(toISODate);
  const todayIso = toISODate(today);

  const [selection, setSelection] = useState<DetailSelection | null>(null);

  const { data: hebdo } = useQuery({
    queryKey: ["briefing-activite-hebdo"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<HebdoRow[]> => {
      const { data, error } = await (supabase as any).rpc("get_briefing_activite_hebdo");
      if (error) throw error;
      return (data ?? []) as HebdoRow[];
    },
  });

  // Les trois CA — exercice (N), mois (M), semaine (S) — chacun contre sa période
  // précédente. Le calcul, avec l'éco-taxe exclue et l'exercice fiscal sept→août, se fait
  // en base (get_briefing_ca) ; on ne fait qu'afficher.
  const { data: ca } = useQuery({
    queryKey: ["briefing-ca"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<CaRow | null> => {
      const { data, error } = await (supabase as any).rpc("get_briefing_ca");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as CaRow | null;
    },
  });

  const chartData = useMemo(() => {
    const rows = hebdo ?? [];
    const byDay = new Map<string, { devis_jeux: number; devis_magasin: number; commandes_jeux: number; commandes_magasin: number }>();
    for (const iso of currentIsoDays) byDay.set(iso, { devis_jeux: 0, devis_magasin: 0, commandes_jeux: 0, commandes_magasin: 0 });
    for (const r of rows) {
      const iso = String(r.jour).slice(0, 10);
      if (!currentIsoDays.includes(iso)) continue;
      const b = byDay.get(iso)!;
      const key = `${r.type_doc === "devis" ? "devis" : "commandes"}_${r.univers}` as keyof typeof b;
      b[key] += Number(r.n_docs || 0);
    }
    const labels = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
    return currentIsoDays.map((iso, i) => ({ iso, label: labels[i], ...byDay.get(iso)! }));
  }, [hebdo, currentIsoDays.join(",")]);

  // Totaux devis & commandes : semaine en cours (S0) vs semaine précédente COMPLÈTE (S-1),
  // en nombre ET en montant €. La RPC get_briefing_activite_hebdo couvre déjà les deux
  // semaines et renvoie le montant ; on répartit selon le lundi courant. Même base de
  // comparaison que la carte « CA semaine » (en cours vs S-1 global).
  const totaux = useMemo(() => {
    const lundiIso = currentIsoDays[0];
    const vide = () => ({ devis: { n: 0, montant: 0 }, commande: { n: 0, montant: 0 } });
    const s0 = vide();
    const s1 = vide();
    for (const r of hebdo ?? []) {
      const iso = String(r.jour).slice(0, 10);
      const cible = iso >= lundiIso ? s0 : s1;
      const k = r.type_doc === "devis" ? "devis" : "commande";
      cible[k].n += Number(r.n_docs || 0);
      cible[k].montant += Number(r.montant || 0);
    }
    return { s0, s1 };
  }, [hebdo, currentIsoDays.join(",")]);

  const selectDay = (iso: string) =>
    setSelection((s) => (s?.kind === "jour" && s.day === iso ? null : { kind: "jour", day: iso }));

  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Chiffre d'affaires</div>

      {/* Trois échelles, du large au fin : l'exercice pour la tendance de fond, le mois
          pour le rythme, la semaine pour le pouls. Chacune avec le bon repère. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <CaCard
          label="CA exercice"
          base="à date"
          montant={ca?.ca_n ?? 0}
          prev={ca?.ca_n1 ?? 0}
          prevLabel="N-1"
          color="#8b5cf6"
        />
        <CaCard
          label="CA mois"
          base="global"
          montant={ca?.ca_m ?? 0}
          prev={ca?.ca_m1 ?? 0}
          prevLabel="N-1"
          color="#22d3ee"
        />
        <CaCard
          label="CA semaine"
          base="global"
          montant={ca?.ca_s ?? 0}
          prev={ca?.ca_s1 ?? 0}
          prevLabel="S-1"
          color="#34d399"
        />
      </div>

      <div className="mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Activité de la semaine</div>

      {/* Devis / commandes de la semaine en cours : nombre + montant €, chacun comparé à la
          semaine précédente complète (S-1). Distinct du CA (facturé) : c'est l'activité
          commerciale générée, en amont de la facturation. */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <DocCard label="Devis" color="#a78bfa" cur={totaux.s0.devis} prev={totaux.s1.devis} />
        <DocCard label="Commandes" color="#34d399" cur={totaux.s0.commande} prev={totaux.s1.commande} />
      </div>

      <div className="rounded-lg border border-border/60 bg-background/40 p-2">
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 12, bottom: 4, left: -20 }}
              onClick={(e: any) => {
                const iso = e?.activePayload?.[0]?.payload?.iso;
                if (iso) selectDay(iso);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} width={30} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Legend content={<CustomLegend />} verticalAlign="bottom" />
              {currentIsoDays.includes(todayIso) && (
                <ReferenceLine
                  x={["Lun", "Mar", "Mer", "Jeu", "Ven"][currentIsoDays.indexOf(todayIso)]}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="2 2"
                  label={{ value: "Auj.", fill: "hsl(var(--primary))", fontSize: 10, position: "top" }}
                />
              )}
              <Line type="monotone" dataKey="devis_jeux" name="Devis · Jeux" stroke={DEVIS_DARK} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, cursor: "pointer" }} />
              <Line type="monotone" dataKey="devis_magasin" name="Devis · Magasin" stroke={DEVIS_DARK} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} activeDot={{ r: 5, cursor: "pointer" }} />
              <Line type="monotone" dataKey="commandes_jeux" name="Commandes · Jeux" stroke={CMD_DARK} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, cursor: "pointer" }} />
              <Line type="monotone" dataKey="commandes_magasin" name="Commandes · Magasin" stroke={CMD_DARK} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} activeDot={{ r: 5, cursor: "pointer" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2 px-1">
          {chartData.map((d) => {
            const active = selection?.kind === "jour" && selection.day === d.iso;
            return (
              <button
                key={d.iso}
                onClick={() => selectDay(d.iso)}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded border transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                {d.label} {new Date(d.iso + "T00:00:00").getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {selection && <DocsDetail selection={selection} onClose={() => setSelection(null)} />}
    </div>
  );
}

/** Petit indicateur de variation vs S-1, réutilisé pour le nombre et pour le montant. */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;
  const Icon = cur > prev ? TrendingUp : cur < prev ? TrendingDown : Minus;
  const color = cur > prev ? "text-emerald-400" : cur < prev ? "text-red-400" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums", color)}>
      <Icon className="h-3 w-3" />
      {prev > 0 ? `${d > 0 ? "+" : ""}${Math.round(d)}%` : "—"}
    </span>
  );
}

/** Carte « Devis » ou « Commandes » de la semaine : nombre et montant €, chacun comparé
 *  à la semaine précédente complète (S-1). */
function DocCard({
  label,
  color,
  cur,
  prev,
}: {
  label: string;
  color: string;
  cur: { n: number; montant: number };
  prev: { n: number; montant: number };
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: `${color}55`, background: `linear-gradient(135deg, ${color}18, ${color}05)` }}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums text-foreground">{cur.n}</span>
        <Delta cur={cur.n} prev={prev.n} />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-display text-base font-semibold tabular-nums text-foreground">{eur(cur.montant)}</span>
        <Delta cur={cur.montant} prev={prev.montant} />
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
        S-1&nbsp;: {prev.n} · {eur(prev.montant)}
      </div>
    </div>
  );
}

function CaCard({
  label,
  base,
  montant,
  prev,
  prevLabel,
  color,
}: {
  label: string;
  base: "à date" | "global";
  montant: number;
  prev: number;
  prevLabel: string;
  color: string;
}) {
  const delta = prev > 0 ? ((montant - prev) / prev) * 100 : montant > 0 ? 100 : 0;
  const DeltaIcon = montant > prev ? TrendingUp : montant < prev ? TrendingDown : Minus;
  const deltaColor = montant > prev ? "text-emerald-400" : montant < prev ? "text-red-400" : "text-muted-foreground";

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: `${color}55`, background: `linear-gradient(135deg, ${color}18, ${color}05)` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>
          {label}
        </div>
        {/* Le repère de comparaison : « à date » pour l'exercice (à période égale),
            « global » pour le mois et la semaine (période précédente complète). */}
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground">
          {base}
        </span>
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">{eur(montant)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className={cn("inline-flex items-center gap-0.5 font-medium", deltaColor)}>
          <DeltaIcon className="h-3 w-3" />
          {prev > 0 ? `${delta > 0 ? "+" : ""}${Math.round(delta)}%` : "—"}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {prevLabel}&nbsp;: {eur(prev)}
        </span>
      </div>
    </div>
  );
}

function DocsDetail({ selection, onClose }: { selection: DetailSelection; onClose: () => void }) {
  const isJour = selection.kind === "jour";

  const { data, isLoading } = useQuery({
    queryKey: isJour
      ? ["briefing-jour-docs", (selection as any).day]
      : ["briefing-semaine-docs", (selection as any).typeDoc],
    queryFn: async (): Promise<SemaineDoc[]> => {
      if (isJour) {
        const { data, error } = await (supabase as any).rpc("get_briefing_jour_docs", { _jour: (selection as any).day });
        if (error) throw error;
        return ((data ?? []) as JourDoc[]).map((d) => ({ ...d, jour: (selection as any).day }));
      } else {
        const { data, error } = await (supabase as any).rpc("get_briefing_semaine_docs", { _type_doc: (selection as any).typeDoc });
        if (error) throw error;
        return (data ?? []) as SemaineDoc[];
      }
    },
  });

  const nCdes = useMemo(() => (data ?? []).map((d) => d.n_cde).filter(Boolean), [data]);
  const { data: clientMap } = useQuery({
    queryKey: ["briefing-docs-clients", isJour ? (selection as any).day : (selection as any).typeDoc, nCdes.join(",")],
    enabled: nCdes.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await (supabase as any)
        .from("v_gaia_carnet_documents")
        .select("n_cde, client")
        .in("n_cde", nCdes);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) if (r.n_cde) map[r.n_cde] = r.client ?? "";
      return map;
    },
  });

  const title = isJour
    ? `Saisies du ${new Date((selection as any).day + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`
    : (selection as any).typeDoc === "devis"
      ? "Devis de la semaine"
      : "Commandes de la semaine";

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="text-sm font-semibold">{title}</div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {isLoading ? (
          <div className="p-3 text-xs text-muted-foreground">Chargement…</div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">Aucune saisie.</div>
        ) : (
          <ul className="divide-y divide-border/40">
            {data!.map((d, i) => {
              const isDevis = d.type_doc === "devis";
              const clientName = (clientMap?.[d.n_cde] || d.code_client || "—").trim();
              const dayShort = !isJour && d.jour
                ? new Date(String(d.jour).slice(0, 10) + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
                : null;
              return (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span
                    className="inline-flex px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider text-[9px]"
                    style={{
                      background: isDevis ? `${DEVIS_DARK}33` : `${CMD_DARK}33`,
                      color: isDevis ? DEVIS : CMD,
                    }}
                  >
                    {isDevis ? "Devis" : "Cmd"}
                  </span>
                  {dayShort && <span className="text-[10px] text-muted-foreground w-14 flex-shrink-0">{dayShort}</span>}
                  <span className="font-mono text-[11px] text-muted-foreground">{d.n_cde}</span>
                  <span className="flex-1 truncate text-foreground/90">{clientName || d.code_client}</span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded border"
                    style={{
                      borderColor: d.univers === "jeux" ? "#a78bfa66" : "#94a3b866",
                      color: d.univers === "jeux" ? "#a78bfa" : "#94a3b8",
                    }}
                  >
                    {d.univers === "jeux" ? "Jeux" : "Magasin"}
                  </span>
                  <span className="tabular-nums font-medium text-foreground">{eur(Number(d.montant_ht ?? 0))}</span>
                  {d.proprietaire && <span className="text-muted-foreground hidden sm:inline">· {d.proprietaire}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

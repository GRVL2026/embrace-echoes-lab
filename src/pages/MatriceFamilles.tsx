import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Cell,
  LabelList,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { cn } from "@/lib/utils";
import {
  Grid2x2,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
  ArrowLeft,
  Search,
  X,
} from "lucide-react";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

type MargeFamilleRow = {
  annee: number | null;
  famille: string | null;
  ca_ht: number | null;
  ca_avec_cout: number | null;
  cout_estime: number | null;
  marge_estimee: number | null;
  part_reelle: number | null;
};

type QKey = "moteurs" | "pepites" | "volume" | "questionner";

type Point = {
  famille: string;
  ca: number;
  ca_avec_cout: number;
  marge: number;
  taux: number;
  part_reelle: number;
  faible_couverture: boolean;
  quadrant: QKey;
};

const Q_META: Record<QKey, { label: string; sub: string; color: string; bg: string; border: string; fill: string }> = {
  moteurs: {
    label: "Moteurs",
    sub: "CA élevé · marge élevée",
    color: "text-emerald-500",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/30",
    fill: "hsl(160 84% 39%)",
  },
  pepites: {
    label: "Pépites",
    sub: "CA faible · marge élevée",
    color: "text-sky-500",
    bg: "bg-sky-500/5",
    border: "border-sky-500/30",
    fill: "hsl(199 89% 48%)",
  },
  volume: {
    label: "Volume à surveiller",
    sub: "CA élevé · marge faible",
    color: "text-orange-500",
    bg: "bg-orange-500/5",
    border: "border-orange-500/30",
    fill: "hsl(25 95% 53%)",
  },
  questionner: {
    label: "À questionner",
    sub: "CA faible · marge faible",
    color: "text-muted-foreground",
    bg: "bg-muted/20",
    border: "border-border",
    fill: "hsl(220 9% 46%)",
  },
};

// Familles à exclure (non-produit).
const EXCLUDED_FAMILLES = new Set<string>(
  ["Composants", "Merchandising", "Main d'oeuvre", "Pieces & divers"].map((s) => normalize(s)),
);

const COVERAGE_THRESHOLD = 80; // % — en dessous : couverture faible → estompé + astérisque

function fmtEuro(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M€`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)} k€`;
  return `${Math.round(v).toLocaleString("fr-FR")} €`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)} %`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classify(p: { ca: number; taux: number }, caSeuil: number, tauxSeuil: number): QKey {
  const highCa = p.ca >= caSeuil;
  const highTaux = p.taux >= tauxSeuil;
  if (highCa && highTaux) return "moteurs";
  if (!highCa && highTaux) return "pepites";
  if (highCa && !highTaux) return "volume";
  return "questionner";
}

function toCsv(points: Point[]): string {
  const header = "famille;ca_ht;marge_eur;taux_marge_pct;part_reelle_pct;quadrant";
  const rows = points.map((p) =>
    [p.famille, p.ca.toFixed(2), p.marge.toFixed(2), p.taux.toFixed(2), p.part_reelle.toFixed(1), Q_META[p.quadrant].label].join(";"),
  );
  return [header, ...rows].join("\n");
}

function downloadCsv(name: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MatriceFamilles() {
  const { canMargeGlobale, isLoading } = useAuth();

  const { data: yearsData } = useQuery({
    queryKey: ["matrice-familles-exercices"],
    enabled: canMargeGlobale,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc("get_gaia_exercices");
      if (error) throw error;
      return ((rows as { annee: number }[]) ?? [])
        .map((r) => Number(r.annee))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);
    },
  });
  const years = yearsData ?? [];

  const [year, setYear] = useState<number | null>(null);
  const effectiveYear = year ?? years[0] ?? null;

  const { data, isLoading: loadingRows } = useQuery({
    queryKey: ["matrice-marge-famille"],
    enabled: canMargeGlobale,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any).rpc("get_marge_famille");
      if (error) throw error;
      return (rows as MargeFamilleRow[]) ?? [];
    },
  });

  const yearRows = useMemo(
    () =>
      (data ?? []).filter(
        (r) =>
          r.famille &&
          r.annee === effectiveYear &&
          !EXCLUDED_FAMILLES.has(normalize(r.famille)),
      ),
    [data, effectiveYear],
  );

  const allPoints = useMemo(() => {
    return yearRows
      .map((r) => {
        const ca = Number(r.ca_ht) || 0;
        const caCout = Number(r.ca_avec_cout) || 0;
        const marge = Number(r.marge_estimee) || 0;
        const taux = ca > 0 ? (marge / ca) * 100 : 0;
        const part = Number(r.part_reelle) || 0;
        return {
          famille: (r.famille ?? "").trim(),
          ca,
          ca_avec_cout: caCout,
          marge,
          taux,
          part_reelle: part,
          faible_couverture: part < COVERAGE_THRESHOLD,
        };
      })
      .filter((p) => p.famille && p.ca > 0);
  }, [yearRows]);

  const totalCaGlobal = useMemo(() => allPoints.reduce((n, p) => n + p.ca, 0), [allPoints]);

  const medianCa = useMemo(() => median(allPoints.map((p) => p.ca)), [allPoints]);
  const medianTaux = useMemo(() => median(allPoints.map((p) => p.taux)), [allPoints]);

  const [caSeuil, setCaSeuil] = useState<number | null>(null);
  const [tauxSeuil, setTauxSeuil] = useState<number | null>(null);
  const [search, setSearch] = useState<string>("");

  const effectiveCaSeuil = caSeuil ?? medianCa;
  const effectiveTauxSeuil = tauxSeuil ?? medianTaux;

  const normSearch = normalize(search.trim());
  const matchFamille = (famille: string) => normSearch.length > 0 && normalize(famille).includes(normSearch);

  const points: Point[] = useMemo(() => {
    return allPoints.map((p) => ({ ...p, quadrant: classify(p, effectiveCaSeuil, effectiveTauxSeuil) }));
  }, [allPoints, effectiveCaSeuil, effectiveTauxSeuil]);

  const maxCa = useMemo(() => points.reduce((n, p) => Math.max(n, p.ca), 0), [points]);
  const labelThreshold = Math.max(effectiveCaSeuil * 0.5, maxCa * 0.15);

  const grouped = useMemo(() => {
    const g: Record<QKey, Point[]> = { moteurs: [], pepites: [], volume: [], questionner: [] };
    for (const p of points) g[p.quadrant].push(p);
    (Object.keys(g) as QKey[]).forEach((k) => g[k].sort((a, b) => b.ca - a.ca));
    return g;
  }, [points]);

  const hasFaibleCouverture = points.some((p) => p.faible_couverture);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canMargeGlobale) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <DetailPageHeader
        className="md:hidden"
        backTo="/admin/gaia"
        backLabel="Retour au pilotage"
        title="Matrice CA × marge — familles"
        subtitle={effectiveYear ? `Exercice ${effectiveYear}` : undefined}
        actions={<div className="flex items-center gap-1"><MobileNav /><UserMenu /></div>}
      />

      <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto w-full">
        <header className="hidden md:flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30">
              <Grid2x2 className="h-5 w-5 text-sky-500" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Matrice CA × marge — familles</h1>
              <p className="text-sm text-muted-foreground">
                Arbitrage du mix produits — CA vs taux de marge par famille et par exercice
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/gaia">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Retour au pilotage
            </Link>
          </Button>
        </header>

        {/* Contrôles */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3 md:p-4 grid gap-3 md:grid-cols-[auto_1fr_1fr_auto] md:items-end">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Exercice</label>
            <select
              className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={effectiveYear ?? ""}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Seuil CA (€) — médiane {fmtEuro(medianCa)}
            </label>
            <Input
              type="number"
              min={0}
              step={10_000}
              value={caSeuil ?? Math.round(medianCa)}
              onChange={(e) => setCaSeuil(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Seuil marge (%) — médiane {fmtPct(medianTaux)}
            </label>
            <Input
              type="number"
              step={0.5}
              value={tauxSeuil ?? Number(medianTaux.toFixed(1))}
              onChange={(e) => setTauxSeuil(Number(e.target.value))}
              className="mt-1 h-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setCaSeuil(null); setTauxSeuil(null); }}
            className="h-9"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Réinitialiser
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une famille…"
              className="h-9 pl-8 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted"
                aria-label="Effacer la recherche"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {points.length} famille{points.length > 1 ? "s" : ""} affichée{points.length > 1 ? "s" : ""}
          </p>
        </div>

        {loadingRows ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-border/60 bg-card/40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Graphique — masqué sur mobile */}
            <div className="hidden md:block rounded-lg border border-border/60 bg-card/40 p-3">
              <div style={{ width: "100%", height: 520 }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <ReferenceArea x1={effectiveCaSeuil} y1={effectiveTauxSeuil} fill={Q_META.moteurs.fill} fillOpacity={0.06} />
                    <ReferenceArea x2={effectiveCaSeuil} y1={effectiveTauxSeuil} fill={Q_META.pepites.fill} fillOpacity={0.06} />
                    <ReferenceArea x1={effectiveCaSeuil} y2={effectiveTauxSeuil} fill={Q_META.volume.fill} fillOpacity={0.06} />
                    <ReferenceArea x2={effectiveCaSeuil} y2={effectiveTauxSeuil} fill={Q_META.questionner.fill} fillOpacity={0.05} />

                    <XAxis
                      type="number"
                      dataKey="ca"
                      name="CA HT"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v) => fmtEuro(Number(v))}
                      label={{ value: "CA HT (€)", position: "insideBottom", offset: -15, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="taux"
                      name="Taux marge"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v) => `${Number(v).toFixed(0)} %`}
                      label={{ value: "Taux de marge (%)", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                    <ZAxis type="number" dataKey="marge" range={[60, 900]} name="Marge €" />

                    <ReferenceLine x={effectiveCaSeuil} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <ReferenceLine y={effectiveTauxSeuil} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />

                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={(props: any) => {
                        const { active, payload } = props;
                        if (!active || !payload?.length) return null;
                        const seen = new Set<string>();
                        const unique: Point[] = [];
                        for (const item of payload) {
                          const p = item?.payload as Point | undefined;
                          if (!p || seen.has(p.famille)) continue;
                          seen.add(p.famille);
                          unique.push(p);
                        }
                        if (!unique.length) return null;
                        return (
                          <div className="min-w-[180px] rounded-md border border-border/80 bg-popover/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
                            <ul className="space-y-1">
                              {unique.map((p, i) => (
                                <li key={i} className="space-y-0.5">
                                  <div className="flex items-baseline gap-2">
                                    <span
                                      className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-sm"
                                      style={{ background: Q_META[p.quadrant].fill }}
                                    />
                                    <span className="font-semibold" style={{ color: Q_META[p.quadrant].fill }}>
                                      {p.famille}{p.faible_couverture ? " *" : ""}
                                    </span>
                                  </div>
                                  <div className="pl-4 text-muted-foreground tabular-nums">
                                    CA {fmtEuro(p.ca)} · marge {fmtEuro(p.marge)} ({fmtPct(p.taux)})
                                  </div>
                                  <div className="pl-4 text-[10px] text-muted-foreground">
                                    {Q_META[p.quadrant].label} · couverture {fmtPct(p.part_reelle)}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      }}
                    />

                    <Scatter data={points}>
                      {points.map((p, i) => {
                        const isMatch = matchFamille(p.famille);
                        const dim = normSearch.length > 0 && !isMatch;
                        const lowCoverage = p.faible_couverture;
                        return (
                          <Cell
                            key={i}
                            fill={Q_META[p.quadrant].fill}
                            fillOpacity={dim ? 0.12 : lowCoverage ? 0.4 : isMatch ? 1 : 0.8}
                            stroke={isMatch ? "hsl(var(--foreground))" : Q_META[p.quadrant].fill}
                            strokeDasharray={lowCoverage ? "3 3" : undefined}
                            strokeWidth={isMatch ? 2.5 : 1}
                          />
                        );
                      })}
                      <LabelList
                        dataKey="famille"
                        position="top"
                        style={{ fontSize: 10, fill: "hsl(var(--foreground))" }}
                        formatter={(v: any) => {
                          const p = points.find((pt) => pt.famille === v);
                          if (!p) return "";
                          const suffix = p.faible_couverture ? " *" : "";
                          if (matchFamille(p.famille)) return String(v).slice(0, 22) + suffix;
                          if (normSearch.length > 0) return "";
                          return p.ca >= labelThreshold ? String(v).slice(0, 22) + suffix : "";
                        }}
                      />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                {(Object.keys(Q_META) as QKey[]).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: Q_META[k].fill }} />
                    {Q_META[k].label} · {Q_META[k].sub}
                  </span>
                ))}
              </div>
            </div>

            {/* 4 cartes quadrants */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(Q_META) as QKey[]).map((k) => (
                <QuadrantCard
                  key={k}
                  qkey={k}
                  points={grouped[k]}
                  year={effectiveYear}
                  totalCaGlobal={totalCaGlobal}
                  search={normSearch}
                />
              ))}
            </div>

            {hasFaibleCouverture && (
              <p className="text-xs text-muted-foreground pt-2">
                * marge estimée sur une partie du CA seulement (couverture &lt; {COVERAGE_THRESHOLD} %).
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

function QuadrantCard({
  qkey,
  points,
  year,
  totalCaGlobal,
  search,
}: {
  qkey: QKey;
  points: Point[];
  year: number | null;
  totalCaGlobal: number;
  search: string;
}) {
  const meta = Q_META[qkey];
  const [open, setOpen] = useState(false);

  const totals = useMemo(() => {
    let ca = 0, marge = 0;
    for (const p of points) { ca += p.ca; marge += p.marge; }
    return { ca, marge, taux: ca > 0 ? (marge / ca) * 100 : 0 };
  }, [points]);

  const partCa = totalCaGlobal > 0 ? (totals.ca / totalCaGlobal) * 100 : 0;

  const filteredPoints = useMemo(() => {
    if (!search) return points;
    return points.filter((p) => normalize(p.famille).includes(search));
  }, [points, search]);

  return (
    <div className={cn("rounded-lg border p-3", meta.bg, meta.border)}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-start justify-between">
          <div>
            <div className={cn("text-sm font-semibold", meta.color)}>{meta.label}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{meta.sub}</div>
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="text-muted-foreground">Familles</div>
          <div className="text-right font-semibold tabular-nums">{points.length}</div>
          <div className="text-muted-foreground">CA cumulé</div>
          <div className="text-right font-semibold tabular-nums">{fmtEuro(totals.ca)}</div>
          <div className="text-muted-foreground">Marge cumulée</div>
          <div className="text-right font-semibold tabular-nums">{fmtEuro(totals.marge)}</div>
          <div className="text-muted-foreground">Taux moyen</div>
          <div className="text-right font-semibold tabular-nums">{fmtPct(totals.taux)}</div>
          <div className="text-muted-foreground">Part du CA global</div>
          <div className={cn("text-right font-semibold tabular-nums", meta.color)}>{fmtPct(partCa)}</div>
        </div>
      </button>

      {open && (
        <div className="mt-3 border-t border-border/60 pt-2 space-y-1">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => downloadCsv(
                `matrice-familles-${qkey}-${year ?? "exercice"}.csv`,
                toCsv(points),
              )}
            >
              <Download className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
          </div>
          {filteredPoints.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              {search ? "Aucune famille ne correspond à la recherche." : "Aucune famille dans ce quadrant."}
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-border/40">
              {filteredPoints.map((p) => (
                <li key={p.famille} className="flex items-center justify-between gap-2 py-1.5 text-xs px-1">
                  <span
                    className={cn("truncate flex-1", p.faible_couverture && "text-muted-foreground italic")}
                    title={p.famille}
                  >
                    {p.famille}{p.faible_couverture ? " *" : ""}
                  </span>
                  <span className="tabular-nums text-muted-foreground w-16 text-right">{fmtEuro(p.ca)}</span>
                  <span className={cn(
                    "tabular-nums w-14 text-right font-medium",
                    p.taux >= 22 ? "text-emerald-500" : p.taux >= 10 ? "text-orange-500" : "text-red-500",
                  )}>
                    {fmtPct(p.taux)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
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
import { ChartTooltipContent } from "@/components/admin/chartTooltip";
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

type MargeRow = {
  annee: number | null;
  client: string | null;
  ca_ht: number | null;
  ca_avec_cout: number | null;
  marge_estimee: number | null;
  part_reelle: number | null;
};

type Point = {
  client: string;
  ca: number;
  ca_avec_cout: number;
  marge: number;
  taux: number;
  quadrant: QKey;
};

type QKey = "piliers" | "pepites" | "volume" | "marginaux";

const Q_META: Record<QKey, { label: string; sub: string; color: string; bg: string; border: string; fill: string }> = {
  piliers: {
    label: "Piliers",
    sub: "à protéger",
    color: "text-emerald-500",
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/30",
    fill: "hsl(160 84% 39%)",
  },
  pepites: {
    label: "Pépites",
    sub: "à développer",
    color: "text-sky-500",
    bg: "bg-sky-500/5",
    border: "border-sky-500/30",
    fill: "hsl(199 89% 48%)",
  },
  volume: {
    label: "Volume",
    sub: "à renégocier",
    color: "text-orange-500",
    bg: "bg-orange-500/5",
    border: "border-orange-500/30",
    fill: "hsl(25 95% 53%)",
  },
  marginaux: {
    label: "Petits comptes",
    sub: "faible volume",
    color: "text-muted-foreground",
    bg: "bg-muted/20",
    border: "border-border",
    fill: "hsl(220 9% 46%)",
  },
};

const DEFAULT_CA_SEUIL = 50_000;
const DEFAULT_CA_MIN = 10_000;

function fmtEuro(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M€`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)} k€`;
  return `${Math.round(v).toLocaleString("fr-FR")} €`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)} %`;
}

function classify(p: { ca: number; taux: number }, caSeuil: number, tauxSeuil: number): QKey {
  const highCa = p.ca >= caSeuil;
  const highTaux = p.taux >= tauxSeuil;
  if (highCa && highTaux) return "piliers";
  if (!highCa && highTaux) return "pepites";
  if (highCa && !highTaux) return "volume";
  return "marginaux";
}

function toCsv(points: Point[]): string {
  const header = "client;ca_ht;marge_eur;taux_marge_pct;quadrant";
  const rows = points.map((p) =>
    [p.client, p.ca.toFixed(2), p.marge.toFixed(2), p.taux.toFixed(2), Q_META[p.quadrant].label].join(";"),
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

export default function MatriceClients() {
  const { canMargeGlobale, isLoading } = useAuth();
  const navigate = useNavigate();

  // Liste des exercices via RPC dédiée (pas de troncature)
  const { data: yearsData } = useQuery({
    queryKey: ["matrice-exercices"],
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
    queryKey: ["matrice-marge-client", effectiveYear],
    enabled: canMargeGlobale && effectiveYear != null,
    queryFn: async () => {
      // Filtre par exercice côté SQL — évite la troncature 1000 lignes.
      const { data: rows, error } = await (supabase as any).rpc("get_marge_client", {
        _annee: effectiveYear,
      });
      if (error) throw error;
      return (rows as MargeRow[]) ?? [];
    },
  });

  const yearRows = useMemo(() => (data ?? []).filter((r) => r.client), [data]);

  // Taux moyen pondéré du portefeuille (marge totale / ca_avec_cout total)
  const portfolioAvgTaux = useMemo(() => {
    let m = 0;
    let c = 0;
    for (const r of yearRows) {
      m += Number(r.marge_estimee) || 0;
      c += Number(r.ca_avec_cout) || 0;
    }
    return c > 0 ? (m / c) * 100 : 22.4;
  }, [yearRows]);

  const [caSeuil, setCaSeuil] = useState<number>(DEFAULT_CA_SEUIL);
  const [caMin, setCaMin] = useState<number>(DEFAULT_CA_MIN);
  const [tauxSeuil, setTauxSeuil] = useState<number | null>(null);
  const [search, setSearch] = useState<string>("");
  const effectiveTauxSeuil = tauxSeuil ?? portfolioAvgTaux;

  const normSearch = normalize(search.trim());
  const matchClient = (client: string) => normSearch.length > 0 && normalize(client).includes(normSearch);

  const allPoints = useMemo(() => {
    return yearRows
      .map((r) => {
        const ca = Number(r.ca_ht) || 0;
        const caCout = Number(r.ca_avec_cout) || 0;
        const marge = Number(r.marge_estimee) || 0;
        const taux = caCout > 0 ? (marge / caCout) * 100 : 0;
        return { client: (r.client ?? "").trim(), ca, ca_avec_cout: caCout, marge, taux };
      })
      .filter((p) => p.client && p.ca > 0);
  }, [yearRows]);

  // CA global de tous les clients de l'exercice (pour "part du CA global")
  const totalCaGlobal = useMemo(() => allPoints.reduce((n, p) => n + p.ca, 0), [allPoints]);

  const points: Point[] = useMemo(() => {
    // Filtre CA min + bypass pour les clients correspondant à la recherche
    return allPoints
      .filter((p) => p.ca >= caMin || (normSearch.length > 0 && normalize(p.client).includes(normSearch)))
      .map((p) => ({ ...p, quadrant: classify(p, caSeuil, effectiveTauxSeuil) }));
  }, [allPoints, caMin, caSeuil, effectiveTauxSeuil, normSearch]);

  const hiddenCount = allPoints.length - points.length;

  // Couverture (marge estimée sur X % du CA au coût connu)
  const coverage = useMemo(() => {
    let ca = 0;
    let caCout = 0;
    for (const p of points) {
      ca += p.ca;
      caCout += p.ca_avec_cout;
    }
    return ca > 0 ? (caCout / ca) * 100 : 0;
  }, [points]);

  const maxCa = useMemo(() => points.reduce((n, p) => Math.max(n, p.ca), 0), [points]);
  const labelThreshold = Math.max(caSeuil, maxCa * 0.6);

  const grouped = useMemo(() => {
    const g: Record<QKey, Point[]> = { piliers: [], pepites: [], volume: [], marginaux: [] };
    for (const p of points) g[p.quadrant].push(p);
    (Object.keys(g) as QKey[]).forEach((k) => g[k].sort((a, b) => b.ca - a.ca));
    return g;
  }, [points]);

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

  const from = "/admin/matrice-clients";

  return (
    <>
      <DetailPageHeader
        className="md:hidden"
        backTo="/clients"
        backLabel="Retour aux clients"
        title="Matrice CA × marge"
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
              <h1 className="font-display text-2xl font-bold">Matrice CA × marge</h1>
              <p className="text-sm text-muted-foreground">
                Arbitrage du portefeuille clients — CA vs taux de marge par exercice fiscal
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/clients">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Retour aux clients
            </Link>
          </Button>
        </header>

        {/* Contrôles */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3 md:p-4 grid gap-3 md:grid-cols-[auto_1fr_1fr_1fr_auto] md:items-end">
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
              CA min. affiché (€) — actuellement {fmtEuro(caMin)}
            </label>
            <Input
              type="number"
              min={0}
              step={1_000}
              value={caMin}
              onChange={(e) => setCaMin(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Seuil CA (€) — actuellement {fmtEuro(caSeuil)}
            </label>
            <Input
              type="number"
              min={0}
              step={10_000}
              value={caSeuil}
              onChange={(e) => setCaSeuil(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Seuil marge (%) — moyenne portefeuille {fmtPct(portfolioAvgTaux)}
            </label>
            <Input
              type="number"
              step={0.5}
              value={tauxSeuil ?? Number(portfolioAvgTaux.toFixed(1))}
              onChange={(e) => setTauxSeuil(Number(e.target.value))}
              className="mt-1 h-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setCaSeuil(DEFAULT_CA_SEUIL); setCaMin(DEFAULT_CA_MIN); setTauxSeuil(null); }}
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
              placeholder="Rechercher un client…"
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
            {points.length} client{points.length > 1 ? "s" : ""} affiché{points.length > 1 ? "s" : ""}
            {hiddenCount > 0 ? ` · ${hiddenCount} masqué${hiddenCount > 1 ? "s" : ""} sous ${fmtEuro(caMin)}` : ""}
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
                    {/* Fonds de quadrants */}
                    <ReferenceArea x1={caSeuil} y1={effectiveTauxSeuil} fill={Q_META.piliers.fill} fillOpacity={0.06} />
                    <ReferenceArea x2={caSeuil} y1={effectiveTauxSeuil} fill={Q_META.pepites.fill} fillOpacity={0.06} />
                    <ReferenceArea x1={caSeuil} y2={effectiveTauxSeuil} fill={Q_META.volume.fill} fillOpacity={0.06} />
                    <ReferenceArea x2={caSeuil} y2={effectiveTauxSeuil} fill={Q_META.marginaux.fill} fillOpacity={0.05} />

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
                    <ZAxis type="number" dataKey="marge" range={[40, 900]} name="Marge €" />

                    <ReferenceLine x={caSeuil} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
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
                          if (!p || seen.has(p.client)) continue;
                          seen.add(p.client);
                          unique.push(p);
                        }
                        if (!unique.length) return null;
                        return (
                          <div className="min-w-[140px] rounded-md border border-border/80 bg-popover/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
                            <ul className="space-y-0.5">
                              {unique.map((p, i) => (
                                <li key={i} className="flex items-baseline gap-2">
                                  <span
                                    className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-sm"
                                    style={{ background: Q_META[p.quadrant].fill }}
                                  />
                                  <span className="text-muted-foreground">{p.client} :</span>
                                  <span
                                    className="font-semibold tabular-nums"
                                    style={{ color: Q_META[p.quadrant].fill }}
                                  >
                                    {fmtEuro(p.ca)} · marge {fmtEuro(p.marge)} ({fmtPct(p.taux)}) · {Q_META[p.quadrant].label}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      }}
                    />

                    <Scatter
                      data={points}
                      onClick={(e: any) => {
                        const p = e?.payload as Point | undefined;
                        if (p) navigate(`/admin/gaia/client/${encodeURIComponent(p.client)}`, { state: { from } });
                      }}
                    >
                      {points.map((p, i) => {
                        const isMatch = matchClient(p.client);
                        const dim = normSearch.length > 0 && !isMatch;
                        return (
                          <Cell
                            key={i}
                            fill={Q_META[p.quadrant].fill}
                            fillOpacity={dim ? 0.12 : isMatch ? 1 : 0.75}
                            stroke={isMatch ? "hsl(var(--foreground))" : Q_META[p.quadrant].fill}
                            strokeWidth={isMatch ? 2.5 : 1}
                            className="cursor-pointer"
                          />
                        );
                      })}
                      <LabelList
                        dataKey="client"
                        position="top"
                        style={{ fontSize: 10, fill: "hsl(var(--foreground))" }}
                        formatter={(v: any) => {
                          const p = points.find((pt) => pt.client === v);
                          if (!p) return "";
                          if (matchClient(p.client)) return String(v).slice(0, 22);
                          if (normSearch.length > 0) return "";
                          return p.ca >= labelThreshold ? String(v).slice(0, 22) : "";
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
                <QuadrantCard key={k} qkey={k} points={grouped[k]} year={effectiveYear} from={from} />
              ))}
            </div>

            <p className="text-xs text-muted-foreground pt-2">
              Marge estimée sur {coverage.toFixed(1)} % du CA au coût connu. Le taux de marge est calculé sur ce périmètre uniquement.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function QuadrantCard({ qkey, points, year, from }: { qkey: QKey; points: Point[]; year: number | null; from: string }) {
  const meta = Q_META[qkey];
  const [open, setOpen] = useState(false);

  const totals = useMemo(() => {
    let ca = 0, marge = 0, caCout = 0;
    for (const p of points) { ca += p.ca; marge += p.marge; caCout += p.ca_avec_cout; }
    return { ca, marge, taux: caCout > 0 ? (marge / caCout) * 100 : 0 };
  }, [points]);

  return (
    <div className={cn("rounded-lg border p-3", meta.bg, meta.border)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className={cn("text-sm font-semibold", meta.color)}>{meta.label}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{meta.sub}</div>
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="text-muted-foreground">Clients</div>
          <div className="text-right font-semibold tabular-nums">{points.length}</div>
          <div className="text-muted-foreground">CA cumulé</div>
          <div className="text-right font-semibold tabular-nums">{fmtEuro(totals.ca)}</div>
          <div className="text-muted-foreground">Marge cumulée</div>
          <div className="text-right font-semibold tabular-nums">{fmtEuro(totals.marge)}</div>
          <div className="text-muted-foreground">Taux moyen</div>
          <div className="text-right font-semibold tabular-nums">{fmtPct(totals.taux)}</div>
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
                `matrice-${qkey}-${year ?? "exercice"}.csv`,
                toCsv(points),
              )}
            >
              <Download className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
          </div>
          {points.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">Aucun client dans ce quadrant.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto divide-y divide-border/40">
              {points.map((p) => (
                <li key={p.client}>
                  <Link
                    to={`/admin/gaia/client/${encodeURIComponent(p.client)}`}
                    state={{ from }}
                    className="flex items-center justify-between gap-2 py-1.5 text-xs hover:bg-background/40 rounded px-1"
                  >
                    <span className="truncate flex-1" title={p.client}>{p.client}</span>
                    <span className="tabular-nums text-muted-foreground w-16 text-right">{fmtEuro(p.ca)}</span>
                    <span className={cn("tabular-nums w-14 text-right font-medium", p.taux >= 22 ? "text-emerald-500" : p.taux >= 10 ? "text-orange-500" : "text-red-500")}>
                      {fmtPct(p.taux)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

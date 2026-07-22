import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Loader2, TrendingUp, TrendingDown, Users, ShoppingCart, Wrench,
  FileText, FileSignature, Truck, ArrowRight, ArrowDown, Info,
  Package, AlertOctagon, ChevronDown, Layers, PieChart as PieIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { KpiTile } from "@/components/ui/kpi-tile";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { ChartTooltipContent, barTooltipCursor } from "./chartTooltip";
import { DonutHoverCenter } from "./DonutHoverCenter";
import { MargeInfoSheet } from "./MargeInfoSheet";

type Mensuel = { mois: string | null; annee: number | null; ca_ht: number | string | null; lignes: number | string | null; clients: number | string | null };
type TopClient = { annee: number | null; client: string | null; code_client: string | null; ca_ht: number | string | null; lignes: number | string | null };
type TopArticle = { annee: number | null; code_article: string | null; description: string | null; quantite: number | string | null; ca_ht: number | string | null };
type CarnetRow = { categorie: "devis" | "commande" | string | null; statut: string | null; nb: number | string | null; total_ht: number | string | null; sfa: boolean | null };
type StockRow = { refs: number | string | null; quantite: number | string | null; valeur_achat: number | string | null; valeur_vente: number | string | null };
type RuptureRow = { code: string | null; description: string | null; sous_famille: string | null; qty_disponible: number | string | null; qte_vendue_6m: number | string | null; ca_6m: number | string | null };
type MargeRow = { annee: number | null; ca_ht: number | string | null; ca_avec_cout: number | string | null; marge_estimee: number | string | null; part_reelle?: number | string | null };
type SousFamRow = { annee: number | null; sous_famille: string | null; refs: number | string | null; ca_ht: number | string | null };

const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n || 0);
const MOIS_FISCAL = ["Sept","Oct","Nov","Déc","Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août"];
const COLORS = ["#9B5CFF","#ADFF00","#5CC8FF","#FF6B9D","#FFB800"];
const SOUS_FAM_COLORS = ["#9B5CFF","#ADFF00","#5CC8FF","#FF6B9D","#FFB800","#B0B0B0"];
const exShort = (a: number) => `Ex. ${a}`;

function currentFiscalYear(d: Date = new Date()) {
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

function toMoisFiscal(moisStr: string | null): number | null {
  if (!moisStr) return null;
  const cal = parseInt(moisStr.slice(5, 7), 10);
  if (!cal) return null;
  return cal >= 9 ? cal - 8 : cal + 4;
}

const SIGNEE_STATUTS = ["Brouillon", "Ouvert"];
const LIVRAISON_STATUTS = ["Expédition en cours", "Reliquat"];

type PipeAgg = { total: number; nb: number; totalAvec: number; nbAvec: number };

function aggregate(rows: CarnetRow[], cat: "devis" | "commande", statuts?: string[]): PipeAgg {
  const filtered = rows.filter((r) => (r.categorie ?? "") === cat && (!statuts || (r.statut ? statuts.includes(r.statut) : false)));
  const hors = filtered.filter((r) => !r.sfa);
  return {
    total: hors.reduce((n, r) => n + Number(r.total_ht || 0), 0),
    nb: hors.reduce((n, r) => n + Number(r.nb || 0), 0),
    totalAvec: filtered.reduce((n, r) => n + Number(r.total_ht || 0), 0),
    nbAvec: filtered.reduce((n, r) => n + Number(r.nb || 0), 0),
  };
}

export function GaiaMagasin() {
  const currentYear = currentFiscalYear();
  const { canMargeGlobale } = useAuth();
  const [yearArticles, setYearArticles] = useState<number>(currentYear);
  const [yearSousFam, setYearSousFam] = useState<number>(currentYear);
  const [chartMode, setChartMode] = useState<"bar" | "pie">("bar");
  const [openArticle, setOpenArticle] = useState<{ code: string; description: string | null } | null>(null);
  const [openSousFam, setOpenSousFam] = useState<string | null>(null);
  const [margeInfoOpen, setMargeInfoOpen] = useState(false);

  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };


  const { data, isPending: loading } = useQuery({
    queryKey: ["gaia-magasin"],
    queryFn: async () => {
      const c: any = supabase;
      const [m, tc, ta, carnet, stock, ruptures, marge, sousFam] = await Promise.all([
        c.from("v_gaia_magasin_mensuel").select("*"),
        c.from("v_gaia_magasin_top_clients").select("*"),
        c.from("v_gaia_magasin_top_articles").select("*"),
        c.from("v_gaia_magasin_carnet").select("*"),
        c.from("v_gaia_magasin_stock_valeur").select("*"),
        c.from("v_gaia_magasin_ruptures").select("*"),
        c.rpc("get_magasin_marge"),
        c.from("v_gaia_magasin_sous_familles").select("*"),
      ]);
      return {
        mensuel: (m.data as Mensuel[]) ?? [],
        topClients: (tc.data as TopClient[]) ?? [],
        topArticles: (ta.data as TopArticle[]) ?? [],
        carnet: (carnet.data as CarnetRow[]) ?? [],
        stock: (stock.data as StockRow[]) ?? [],
        ruptures: (ruptures.data as RuptureRow[]) ?? [],
        marge: (marge.data as MargeRow[]) ?? [],
        sousFam: (sousFam.data as SousFamRow[]) ?? [],
      };
    },
  });

  const mensuel = data?.mensuel ?? [];
  const topClients = data?.topClients ?? [];
  const topArticles = data?.topArticles ?? [];
  const carnet = data?.carnet ?? [];
  const stock = data?.stock ?? [];
  const ruptures = data?.ruptures ?? [];
  const marge = data?.marge ?? [];
  const sousFam = data?.sousFam ?? [];

  const years = useMemo(() => {
    const s = new Set<number>();
    mensuel.forEach((r) => r.annee && s.add(Number(r.annee)));
    return Array.from(s).sort((a, b) => b - a).slice(0, 3);
  }, [mensuel]);

  const yearsArticles = useMemo(() => {
    const s = new Set<number>();
    topArticles.forEach((r) => r.annee && s.add(Number(r.annee)));
    return Array.from(s).sort((a, b) => b - a);
  }, [topArticles]);

  const yearsSousFam = useMemo(() => {
    const s = new Set<number>();
    sousFam.forEach((r) => r.annee && s.add(Number(r.annee)));
    return Array.from(s).sort((a, b) => b - a);
  }, [sousFam]);

  // Mini-pipeline pièces
  const pipeStats = useMemo(() => ({
    devis: aggregate(carnet, "devis"),
    signee: aggregate(carnet, "commande", SIGNEE_STATUTS),
    livraison: aggregate(carnet, "commande", LIVRAISON_STATUTS),
  }), [carnet]);

  // Stock magasin
  const stockAgg = useMemo(() => {
    return stock.reduce(
      (acc, r) => ({
        refs: acc.refs + Number(r.refs || 0),
        quantite: acc.quantite + Number(r.quantite || 0),
        achat: acc.achat + Number(r.valeur_achat || 0),
        vente: acc.vente + Number(r.valeur_vente || 0),
      }),
      { refs: 0, quantite: 0, achat: 0, vente: 0 },
    );
  }, [stock]);

  const rupturesSorted = useMemo(
    () => [...ruptures].sort((a, b) => Number(b.ca_6m || 0) - Number(a.ca_6m || 0)),
    [ruptures],
  );

  // Marge estimée magasin
  const margeCurrent = useMemo(() => marge.find((r) => Number(r.annee) === currentYear), [marge, currentYear]);
  const margePrev = useMemo(() => marge.find((r) => Number(r.annee) === currentYear - 1), [marge, currentYear]);

  const computeTaux = (row: MargeRow | undefined) => {
    if (!row) return null;
    const caCout = Number(row.ca_avec_cout || 0);
    const marg = Number(row.marge_estimee || 0);
    const caHt = Number(row.ca_ht || 0);
    if (caCout <= 0) return null;
    return {
      taux: (marg / caCout) * 100,
      marge: marg,
      caCout,
      caHt,
      couverture: caHt > 0 ? (caCout / caHt) * 100 : 0,
      partReelle: Number(row.part_reelle || 0),
    };
  };
  const margeCur = computeTaux(margeCurrent);
  const margePre = computeTaux(margePrev);
  const margeEvol = margeCur && margePre ? margeCur.taux - margePre.taux : null;

  // KPI
  const kpi = useMemo(() => {
    const sum = (year: number) => {
      const rows = mensuel.filter((r) => Number(r.annee) === year);
      const ca = rows.reduce((n, r) => n + Number(r.ca_ht || 0), 0);
      const lignes = rows.reduce((n, r) => n + Number(r.lignes || 0), 0);
      const clientsMax = rows.reduce((n, r) => Math.max(n, Number(r.clients || 0)), 0);
      return { ca, lignes, clientsMax };
    };
    const cur = sum(currentYear);
    const prev = sum(currentYear - 1);
    const clientsCurYear = new Set(
      topClients.filter((r) => Number(r.annee) === currentYear && r.client).map((r) => r.client),
    ).size;
    const evol = prev.ca > 0 ? ((cur.ca - prev.ca) / prev.ca) * 100 : null;
    const panierMoyen = cur.lignes > 0 ? cur.ca / cur.lignes : 0;
    return { cur, prev, evol, clients: clientsCurYear || cur.clientsMax, panierMoyen };
  }, [mensuel, topClients, currentYear]);

  // CA mensuel par exercice
  const chart = useMemo(() => {
    const idx = new Map<number, Map<number, number>>();
    for (const r of mensuel) {
      const y = Number(r.annee);
      const mf = toMoisFiscal(r.mois);
      if (!y || !mf) continue;
      if (!idx.has(y)) idx.set(y, new Map());
      const cur = idx.get(y)!;
      cur.set(mf, (cur.get(mf) ?? 0) + Number(r.ca_ht || 0));
    }
    return Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, any> = { mois: MOIS_FISCAL[i] };
      for (const y of years) row[exShort(y)] = idx.get(y)?.get(i + 1) ?? 0;
      return row;
    });
  }, [mensuel, years]);

  // Ventilation sous-familles
  const sousFamStats = useMemo(() => {
    const cur = sousFam.filter((r) => Number(r.annee) === yearSousFam);
    const prev = sousFam.filter((r) => Number(r.annee) === yearSousFam - 1);
    const prevMap = new Map(prev.map((r) => [r.sous_famille ?? "—", Number(r.ca_ht || 0)]));
    const rows = cur.map((r) => {
      const name = r.sous_famille ?? "—";
      const value = Number(r.ca_ht || 0);
      const prevVal = prevMap.get(name) ?? 0;
      const evol = prevVal > 0 ? ((value - prevVal) / prevVal) * 100 : null;
      return { name, value, prev: prevVal, evol };
    });
    return rows.sort((a, b) => b.value - a.value);
  }, [sousFam, yearSousFam]);

  const topClientsCur = useMemo(() => {
    return [...topClients]
      .filter((r) => Number(r.annee) === currentYear)
      .sort((a, b) => Number(b.ca_ht || 0) - Number(a.ca_ht || 0))
      .slice(0, 10);
  }, [topClients, currentYear]);

  const topArticlesYear = useMemo(() => {
    return [...topArticles]
      .filter((r) => Number(r.annee) === yearArticles)
      .sort((a, b) => Number(b.ca_ht || 0) - Number(a.ca_ht || 0))
      .slice(0, 10);
  }, [topArticles, yearArticles]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement du magasin…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-display text-lg font-semibold">Magasin — pièces détachées</h3>
            <p className="text-xs text-muted-foreground">
              Pilotage du magasin interne (classe Cegid MAGASIN, entrepôt PIECES) — exercice fiscal sept. → août.
            </p>
          </div>
        </div>
      </div>

      {/* Mini-pipeline pièces */}
      <MiniPipeline stats={pipeStats} />

      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          title={`CA pièces — ${exShort(currentYear)}`}
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          value={eur(kpi.cur.ca)}
          onClick={() => scrollToId("magasin-ca-mensuel")}
          ariaLabel="Voir le CA magasin mensuel"
          hint={
            kpi.evol === null ? (
              <span className="text-muted-foreground">Pas de comparatif</span>
            ) : (
              <span className={kpi.evol >= 0 ? "text-secondary" : "text-destructive"}>
                {kpi.evol >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                {kpi.evol >= 0 ? "+" : ""}{kpi.evol.toFixed(1)}% vs {exShort(currentYear - 1)} ({eur(kpi.prev.ca)})
              </span>
            )
          }
        />
        <KpiTile
          title="Clients acheteurs"
          icon={<Users className="h-4 w-4 text-secondary" />}
          value={num(kpi.clients)}
          onClick={() => scrollToId("magasin-top-clients")}
          ariaLabel="Voir le top clients pièces"
          hint={<span className="text-muted-foreground">{num(kpi.cur.lignes)} lignes sur l'exercice</span>}
        />
        <KpiTile
          title="Panier moyen / ligne"
          icon={<ShoppingCart className="h-4 w-4 text-primary" />}
          value={eur(kpi.panierMoyen)}
          onClick={() => scrollToId("magasin-top-articles")}
          ariaLabel="Voir le top articles pièces"
          hint={<span className="text-muted-foreground">Ticket moyen d'une ligne · voir top articles</span>}
        />
      </div>


      {/* Stock magasin + Marge estimée (marge = admin/direction uniquement) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Stock */}
        <div className={`rounded-lg border border-border bg-card/40 p-4 ${isDirection ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="font-display text-lg font-semibold">Stock magasin (entrepôt PIECES)</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StockTile label="Valeur d'achat" value={eur(stockAgg.achat)} hint="Prix de revient stocké" tone="primary" />
            <StockTile label="Valeur de vente" value={eur(stockAgg.vente)} hint="Valorisé au prix de vente" tone="secondary" />
            <StockTile label="Références" value={num(stockAgg.refs)} hint={`${num(stockAgg.quantite)} pièces au total`} tone="neutral" />
          </div>

          <details className="mt-4 rounded border border-rose-500/30 bg-rose-500/5 group">
            <summary className="flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/10">
              <span className="flex items-center gap-2">
                <AlertOctagon className="h-4 w-4" />
                Pièces en rupture qui se vendent
                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-medium text-rose-200">
                  {num(rupturesSorted.length)}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-rose-500/20 p-2">
              <p className="mb-2 px-1 text-[11px] text-muted-foreground">
                Alerte réassort — références en rupture (stock ≤ 0) qui ont généré du CA sur les 6 derniers mois, triées par CA 6 mois décroissant.
              </p>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b border-rose-500/20">
                      <th className="px-2 py-2 text-left">Code</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-left">Sous-famille</th>
                      <th className="px-2 py-2 text-right">Qté vendue 6 m</th>
                      <th className="px-2 py-2 text-right">CA 6 m</th>
                      <th className="px-2 py-2 text-center">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rupturesSorted.map((r, i) => (
                      <tr key={(r.code ?? "") + i} className="border-b border-rose-500/10 hover:bg-rose-500/5">
                        <td className="px-2 py-2 font-mono text-xs">{r.code ?? "—"}</td>
                        <td className="px-2 py-2 truncate max-w-[220px]" title={r.description ?? undefined}>{r.description ?? "—"}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{r.sous_famille ?? "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(Number(r.qte_vendue_6m || 0))}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(Number(r.ca_6m || 0))}</td>
                        <td className="px-2 py-2 text-center">
                          <span className="inline-flex items-center rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
                            Rupture
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rupturesSorted.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">Aucune rupture critique détectée.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </div>

        {/* Marge estimée — admin/direction uniquement */}
        {isDirection && (
        <button
          type="button"
          onClick={() => setMargeInfoOpen(true)}
          aria-label="Comprendre les différentes lectures de la marge"
          className="text-left rounded-lg border border-primary/40 bg-primary/5 p-4 transition-colors cursor-pointer hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <span>Taux de marque pièces — {exShort(currentYear)}</span>
            <Info className="h-3.5 w-3.5 text-muted-foreground/70" />
          </div>
          {margeCur ? (
            <>
              <div className="font-display text-3xl font-bold text-primary text-glow-purple">
                {margeCur.taux.toFixed(1)}%
              </div>
              {margeEvol !== null && (
                <div className={`mt-1 text-xs ${margeEvol >= 0 ? "text-secondary" : "text-destructive"}`}>
                  {margeEvol >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                  {margeEvol >= 0 ? "+" : ""}{margeEvol.toFixed(1)} pts vs {exShort(currentYear - 1)}
                  {margePre && ` (${margePre.taux.toFixed(1)}%)`}
                </div>
              )}
              <div className="mt-2 text-xs text-muted-foreground">
                {margeCur.partReelle > 90 ? "Marge réelle" : "Marge estimée"} : <span className="text-foreground">{eur(margeCur.marge)}</span> sur{" "}
                <span className="text-foreground">{eur(margeCur.caCout)}</span> de CA analysé
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {margeCur.partReelle > 90 ? "réelle" : "estimée"} sur {margeCur.couverture.toFixed(0)}% du CA ({eur(margeCur.caCout)} / {eur(margeCur.caHt)})
              </div>
            </>
          ) : (
            <div className="flex h-32 items-center text-sm text-muted-foreground">
              Aucune donnée de marge pour {exShort(currentYear)}.
            </div>
          )}
        </button>
        )}

      </div>


      {/* CA mensuel par exercice */}
      <div id="magasin-ca-mensuel" className="rounded-lg border border-border bg-card/40 p-4 scroll-mt-20">
        <h3 className="mb-3 font-display text-lg font-semibold">CA magasin — comparaison par exercice (sept. → août)</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mois" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} M€` : v >= 1000 ? `${Math.round(v / 1000)} k€` : String(v))}
              />
              <Tooltip
                cursor={barTooltipCursor}
                content={<ChartTooltipContent formatter={(v: any) => eur(Number(v))} />}
              />
              <Legend />
              {years.map((y, i) => (
                <Bar key={y} dataKey={exShort(y)} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ventilation par sous-famille */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-semibold">Ventilation par sous-famille</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChartMode(chartMode === "bar" ? "pie" : "bar")}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              title="Basculer barres / donut"
            >
              <PieIcon className="h-3.5 w-3.5" />
              {chartMode === "bar" ? "Donut" : "Barres"}
            </button>
            <Select value={String(yearSousFam)} onValueChange={(v) => setYearSousFam(Number(v))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(yearsSousFam.length ? yearsSousFam : [currentYear]).map((y) => (
                  <SelectItem key={y} value={String(y)}>{exShort(y)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {sousFamStats.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            Aucune donnée pour {exShort(yearSousFam)}.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="h-72">
                {chartMode === "bar" ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sousFamStats} layout="vertical" margin={{ left: 20, right: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)} k€` : String(v))} />
                      <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={130} />
                      <Tooltip
                        cursor={barTooltipCursor}
                        content={<ChartTooltipContent formatter={(v: any, n: any) => [eur(Number(v)), n]} />}
                      />
                      <Bar
                        dataKey="value"
                        radius={[0, 4, 4, 0]}
                        onClick={(d: any) => d?.name && setOpenSousFam(String(d.name))}
                        className="cursor-pointer"
                      >
                        {sousFamStats.map((_, i) => (
                          <Cell key={i} fill={SOUS_FAM_COLORS[i % SOUS_FAM_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (() => {
                  const total = sousFamStats.reduce((n, r) => n + Number(r.value || 0), 0);
                  const data = sousFamStats.map((r, i) => ({
                    name: r.name,
                    value: Number(r.value || 0),
                    color: SOUS_FAM_COLORS[i % SOUS_FAM_COLORS.length],
                  }));
                  return (
                    <DonutHoverCenter
                      data={data}
                      total={eur(total)}
                      totalLabel={exShort(yearSousFam)}
                      innerRadius={55}
                      outerRadius={100}
                      paddingAngle={2}
                      formatValue={(v) => {
                        const p = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
                        return `${eur(v)} (${p} %)`;
                      }}
                      onSegmentClick={(d) => d?.name && setOpenSousFam(String(d.name))}
                    />
                  );
                })()}
              </div>
            </div>
            <div className="lg:col-span-2">
              <div className="rounded border border-border/60 bg-background/40 p-3">
                <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Évolution vs {exShort(yearSousFam - 1)}
                </div>
                <ul className="divide-y divide-border/40">
                  {sousFamStats.map((r, i) => (
                    <li key={r.name}>
                      <button
                        type="button"
                        onClick={() => setOpenSousFam(r.name)}
                        aria-label={`Voir les articles de la sous-famille ${r.name}`}
                        className="flex w-full items-center justify-between gap-2 py-2 text-sm text-left transition-colors hover:bg-muted/40 rounded px-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-block h-3 w-3 shrink-0 rounded"
                            style={{ background: SOUS_FAM_COLORS[i % SOUS_FAM_COLORS.length] }} />
                          <span className="truncate font-medium">{r.name}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums text-muted-foreground">{eur(r.value)}</span>
                          {r.evol === null ? (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                                r.evol >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                              }`}
                            >
                              {r.evol >= 0 ? <TrendingUp className="mr-0.5 h-3 w-3" /> : <TrendingDown className="mr-0.5 h-3 w-3" />}
                              {r.evol >= 0 ? "+" : ""}{r.evol.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Top 10 clients + Top 10 articles */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div id="magasin-top-clients" className="rounded-lg border border-border bg-card/40 p-4 scroll-mt-20">
          <h3 className="mb-3 font-display text-lg font-semibold">Top 10 clients pièces — {exShort(currentYear)}</h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Client</th>
                  <th className="px-2 py-2 text-right">CA HT</th>
                  <th className="px-2 py-2 text-right">Lignes</th>
                </tr>
              </thead>
              <tbody>
                {topClientsCur.map((r, i) => (
                  <tr key={(r.code_client ?? "") + i} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2">
                      {r.client ? (
                        <Link
                          to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {r.client}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(Number(r.ca_ht || 0))}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(Number(r.lignes || 0))}</td>
                  </tr>
                ))}
                {topClientsCur.length === 0 && (
                  <tr><td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">Aucun client sur l'exercice.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div id="magasin-top-articles" className="rounded-lg border border-border bg-card/40 p-4 scroll-mt-20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold">Top 10 articles pièces</h3>
            <Select value={String(yearArticles)} onValueChange={(v) => setYearArticles(Number(v))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(yearsArticles.length ? yearsArticles : [currentYear]).map((y) => (
                  <SelectItem key={y} value={String(y)}>{exShort(y)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Code</th>
                  <th className="px-2 py-2 text-left">Description</th>
                  <th className="px-2 py-2 text-right">Qté</th>
                  <th className="px-2 py-2 text-right">CA HT</th>
                </tr>
              </thead>
              <tbody>
                {topArticlesYear.map((r, i) => {
                  const code = r.code_article ?? "";
                  return (
                    <tr
                      key={code + i}
                      onClick={() => code && setOpenArticle({ code, description: r.description })}
                      className={`border-b border-border/40 ${code ? "hover:bg-muted/30 cursor-pointer" : ""}`}
                      aria-label={code ? `Voir l'historique de l'article ${code}` : undefined}
                    >
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-2 font-mono text-xs text-primary">{code || "—"}</td>
                      <td className="px-2 py-2 truncate max-w-[220px]" title={r.description ?? undefined}>{r.description ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(Number(r.quantite || 0))}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(Number(r.ca_ht || 0))}</td>
                    </tr>
                  );
                })}
                {topArticlesYear.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Aucun article sur l'exercice.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sheet : historique d'un article */}
      <ArticleHistorySheet
        article={openArticle}
        onClose={() => setOpenArticle(null)}
      />

      {/* Sheet : articles d'une sous-famille */}
      <SousFamilleSheet
        sousFamille={openSousFam}
        year={yearSousFam}
        onClose={() => setOpenSousFam(null)}
      />

      {/* Sheet : comprendre les différentes lectures de la marge */}
      <MargeInfoSheet
        open={margeInfoOpen}
        onOpenChange={setMargeInfoOpen}
        tauxErp={margeCur?.taux ?? null}
        source="Magasin"
        currentExercice={currentYear}
      />
    </div>


  );
}

/* ============ Mini-pipeline pièces ============ */

const PIPE_COLORS: Record<string, { border: string; bg: string; text: string; icon: string }> = {
  primary: { border: "border-primary/40", bg: "bg-primary/10", text: "text-primary", icon: "text-primary" },
  blue: { border: "border-sky-500/40", bg: "bg-sky-500/10", text: "text-sky-400", icon: "text-sky-400" },
  orange: { border: "border-orange-500/40", bg: "bg-orange-500/10", text: "text-orange-400", icon: "text-orange-400" },
};

function MiniPipelineStep({
  color, icon, label, value, count, tooltip, withSfa,
}: {
  color: "primary" | "blue" | "orange";
  icon: React.ReactNode;
  label: string;
  value: string;
  count: string;
  tooltip: string;
  withSfa?: string;
}) {
  const c = PIPE_COLORS[color];
  return (
    <div className={`group relative flex flex-col rounded-lg border ${c.border} ${c.bg} p-3`} title={tooltip}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md bg-background/40 ${c.icon}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
        <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="font-display text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{count}</div>
      {withSfa && (
        <div
          className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-500 tabular-nums"
          title="Total incluant les clients SFA (rétrocession) — exclus du CA officiel"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          avec SFA : {withSfa}
        </div>
      )}
    </div>
  );
}

function MiniPipeline({ stats }: { stats: { devis: PipeAgg; signee: PipeAgg; livraison: PipeAgg } }) {
  const Arrow = () => (
    <>
      <ArrowRight className="hidden h-6 w-6 shrink-0 self-center text-muted-foreground/50 md:block" />
      <ArrowDown className="mx-auto h-5 w-5 shrink-0 text-muted-foreground/50 md:hidden" />
    </>
  );
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-3">
        <h3 className="font-display text-lg font-semibold">Pipeline pièces</h3>
        <p className="text-xs text-muted-foreground">Cycle magasin — du devis à la livraison, montants hors clients SFA</p>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <MiniPipelineStep
          color="primary"
          icon={<FileText className="h-5 w-5" />}
          label="Devis pièces"
          value={eur(stats.devis.total)}
          count={`${num(stats.devis.nb)} devis`}
          withSfa={stats.devis.totalAvec !== stats.devis.total ? eur(stats.devis.totalAvec) : undefined}
          tooltip="Devis pièces détachées non encore validés en commande (statuts Brouillon + Ouvert d'un devis Cegid). Potentiel commercial magasin. Montant hors clients SFA (rétrocession, exclu du CA officiel)."
        />
        <Arrow />
        <MiniPipelineStep
          color="blue"
          icon={<FileSignature className="h-5 w-5" />}
          label="Commandes signées"
          value={eur(stats.signee.total)}
          count={`${num(stats.signee.nb)} commandes`}
          withSfa={stats.signee.totalAvec !== stats.signee.total ? eur(stats.signee.totalAvec) : undefined}
          tooltip="Commandes pièces validées ou en préparation (statuts Brouillon + Ouvert d'une commande), stock réservé, en attente d'expédition. Montant hors clients SFA."
        />
        <Arrow />
        <MiniPipelineStep
          color="orange"
          icon={<Truck className="h-5 w-5" />}
          label="En livraison"
          value={eur(stats.livraison.total)}
          count={`${num(stats.livraison.nb)} commandes`}
          withSfa={stats.livraison.totalAvec !== stats.livraison.total ? eur(stats.livraison.totalAvec) : undefined}
          tooltip="Commandes pièces en cours d'expédition ou partiellement livrées (Expédition en cours + Reliquat). Montant hors clients SFA."
        />
      </div>
    </div>
  );
}

/* ============ Stock tile ============ */

function StockTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "primary" | "secondary" | "neutral" }) {
  const toneCls =
    tone === "primary" ? "border-primary/40 bg-primary/5 text-primary"
    : tone === "secondary" ? "border-secondary/40 bg-secondary/5 text-secondary"
    : "border-border bg-background/40 text-foreground";
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/* ============ Sheet : historique d'un article ============ */

function ArticleHistorySheet({
  article,
  onClose,
}: {
  article: { code: string; description: string | null } | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data, isPending } = useQuery({
    queryKey: ["magasin-article-history", article?.code],
    enabled: !!article?.code,
    queryFn: async () => {
      const c: any = supabase;
      // Historique récent + agrégats
      const { data: lignes } = await c
        .from("v_gaia_lignes")
        .select("invoice_date,code_client,qty,montant_ht")
        .or(`code_article.eq.${article!.code},inventory_id.eq.${article!.code}`)
        .gt("montant_ht", 0)
        .order("invoice_date", { ascending: false })
        .limit(200);
      const rows = ((lignes ?? []) as { invoice_date: string; code_client: string; qty: number | string; montant_ht: number | string }[]);

      // Top clients
      const map = new Map<string, { code: string; ca: number; qty: number }>();
      for (const r of rows) {
        const cur = map.get(r.code_client) ?? { code: r.code_client, ca: 0, qty: 0 };
        cur.ca += Number(r.montant_ht || 0);
        cur.qty += Number(r.qty || 0);
        map.set(r.code_client, cur);
      }
      const clientCodes = Array.from(map.keys());
      const { data: cliNames } = clientCodes.length
        ? await c.from("gaia_clients").select("customer_id,name").in("customer_id", clientCodes)
        : { data: [] };
      const nameOf = new Map<string, string>();
      ((cliNames ?? []) as { customer_id: string; name: string }[]).forEach((x) => nameOf.set(x.customer_id, x.name));
      const topClients = Array.from(map.values())
        .map((r) => ({ ...r, nom: nameOf.get(r.code) || r.code }))
        .sort((a, b) => b.ca - a.ca)
        .slice(0, 10);

      const totalCa = rows.reduce((n, r) => n + Number(r.montant_ht || 0), 0);
      const totalQty = rows.reduce((n, r) => n + Number(r.qty || 0), 0);

      return { rows: rows.slice(0, 50), topClients, totalCa, totalQty, nbLignes: rows.length };
    },
  });

  return (
    <Sheet open={!!article} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display inline-flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm">{article?.code}</span>
          </SheetTitle>
          <SheetDescription className="truncate">{article?.description ?? "—"}</SheetDescription>
        </SheetHeader>
        {isPending ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded border border-border/60 bg-background/40 p-3">
                <div className="text-[11px] uppercase text-muted-foreground">CA cumulé</div>
                <div className="font-display text-lg font-bold">{eur(data?.totalCa || 0)}</div>
              </div>
              <div className="rounded border border-border/60 bg-background/40 p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Qté vendue</div>
                <div className="font-display text-lg font-bold">{num(data?.totalQty || 0)}</div>
              </div>
              <div className="rounded border border-border/60 bg-background/40 p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Lignes</div>
                <div className="font-display text-lg font-bold">{num(data?.nbLignes || 0)}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Top 10 clients</div>
              <div className="overflow-auto rounded border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left">Client</th>
                      <th className="px-2 py-2 text-right">Qté</th>
                      <th className="px-2 py-2 text-right">CA HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.topClients ?? []).map((r) => (
                      <tr
                        key={r.code}
                        onClick={() => {
                          onClose();
                          navigate(`/admin/gaia/client/${encodeURIComponent(r.nom)}`);
                        }}
                        className="border-t border-border/60 cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-2 py-2 truncate max-w-[220px] text-primary hover:underline">{r.nom}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(r.qty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(r.ca)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                50 dernières lignes
              </div>
              <div className="overflow-auto rounded border border-border/60 max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Client</th>
                      <th className="px-2 py-2 text-right">Qté</th>
                      <th className="px-2 py-2 text-right">CA HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.rows ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.invoice_date).toLocaleDateString("fr-FR")}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">{r.code_client}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(Number(r.qty || 0))}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(Number(r.montant_ht || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ============ Sheet : articles d'une sous-famille ============ */

function SousFamilleSheet({
  sousFamille,
  year,
  onClose,
}: {
  sousFamille: string | null;
  year: number;
  onClose: () => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: ["magasin-sous-famille", sousFamille, year],
    enabled: !!sousFamille,
    queryFn: async () => {
      const c: any = supabase;
      // 1) Références de la sous-famille depuis gaia_stock
      const filter = sousFamille === "(sans)" ? null : sousFamille;
      let q = c.from("gaia_stock").select("inventory_id,description,qty_on_hand,prix_vente,magasin_famille2").limit(2000);
      if (filter) q = q.eq("magasin_famille2", filter);
      else q = q.or("magasin_famille2.is.null,magasin_famille2.eq.");
      const { data: refs } = await q;
      const rows = ((refs ?? []) as { inventory_id: string; description: string | null; qty_on_hand: number | string; prix_vente: number | string }[])
        .filter((r) => r.inventory_id);

      // 2) Agréger le CA sur l'exercice pour ces refs
      const ids = rows.map((r) => r.inventory_id.trim());
      const start = `${year - 1}-09-01`;
      const end = `${year}-09-01`;
      const salesMap = new Map<string, { qty: number; ca: number }>();
      // batch par 500
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { data: lg } = await c
          .from("v_gaia_lignes")
          .select("code_article,inventory_id,qty,montant_ht")
          .or(`code_article.in.(${chunk.join(",")}),inventory_id.in.(${chunk.join(",")})`)
          .gte("invoice_date", start)
          .lt("invoice_date", end);
        for (const r of ((lg ?? []) as { code_article: string; inventory_id: string; qty: number | string; montant_ht: number | string }[])) {
          const key = (r.code_article || r.inventory_id || "").trim();
          const cur = salesMap.get(key) ?? { qty: 0, ca: 0 };
          cur.qty += Number(r.qty || 0);
          cur.ca += Number(r.montant_ht || 0);
          salesMap.set(key, cur);
        }
      }

      const enriched = rows.map((r) => {
        const s = salesMap.get(r.inventory_id.trim()) ?? { qty: 0, ca: 0 };
        return {
          code: r.inventory_id,
          description: r.description,
          stock: Number(r.qty_on_hand || 0),
          prix: Number(r.prix_vente || 0),
          qty: s.qty,
          ca: s.ca,
        };
      });
      return enriched.sort((a, b) => b.ca - a.ca).slice(0, 100);
    },
  });

  const totalCa = (data ?? []).reduce((n, r) => n + r.ca, 0);

  return (
    <Sheet open={!!sousFamille} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display inline-flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Sous-famille · {sousFamille}
          </SheetTitle>
          <SheetDescription>
            Articles de la sous-famille — {exShort(year)} · CA total {eur(totalCa)}
          </SheetDescription>
        </SheetHeader>
        {isPending ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
          </div>
        ) : (
          <div className="mt-4 overflow-auto rounded border border-border/60 max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left">Code</th>
                  <th className="px-2 py-2 text-left">Description</th>
                  <th className="px-2 py-2 text-right">Stock</th>
                  <th className="px-2 py-2 text-right">Qté vendue</th>
                  <th className="px-2 py-2 text-right">CA HT</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((r) => (
                  <tr key={r.code} className="border-t border-border/60">
                    <td className="px-2 py-2 font-mono text-xs text-primary">{r.code}</td>
                    <td className="px-2 py-2 truncate max-w-[240px]" title={r.description ?? undefined}>{r.description ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(r.stock)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(r.qty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(r.ca)}</td>
                  </tr>
                ))}
                {(!data || data.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Aucun article.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

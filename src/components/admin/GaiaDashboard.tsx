import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, TrendingDown, FileText, FileSignature, Package, Leaf, RefreshCw, ArrowRight, ArrowDown, Search, Info, Truck, PackageCheck, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const FAMILY_COLORS = ["#9B5CFF", "#ADFF00", "#00D4FF", "#FF8A00", "#FF4FA3"];
const OTHERS_COLOR = "#6B7280";

type CaMensuel = { mois: string; annee: number; mois_fiscal?: number; mois_calendaire?: number; ca_ht: number | string; lignes: number };
type CaClient = { annee: number; code_client: string; client: string; ca_ht: number };
type CaFamille = { annee: number; famille: string; ca_ht: number };
type CommandesEtat = { etat: "signee" | "devis"; nb_commandes: number; total_ht: number };
type PipelineRow = { categorie: "devis" | "commande"; statut: string; nb: number; total_ht: number | string };
type StockValeur = { depot: string; quantite: number; valeur_achat: number; valeur_vente: number };
type EcotaxeMensuel = { mois: number; ecotaxe_ht: number };
type CaPeriodeEgale = { annee: number; ca_ht: number | string };
type RetrocessionSfa = { annee: number; mois?: number; montant_ht: number | string };
type MargeFamille = { annee: number; famille: string | null; ca_ht: number | string; ca_avec_cout: number | string; cout_estime: number | string; marge_estimee: number | string };
type MargeClient = { annee: number; client: string | null; ca_ht: number | string; ca_avec_cout: number | string; marge_estimee: number | string };

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n || 0);

// Mois du calendrier fiscal : sept (1) → août (12)
const MOIS_FISCAL = ["Sept","Oct","Nov","Déc","Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août"];
const MOIS_CAL = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
const COLORS = ["#9B5CFF","#ADFF00","#5CC8FF","#FF6B9D","#FFB800","#00E5A0","#FF7A5C","#B08CFF","#5CFFB8","#FFD75C"];

const exLong = (a: number) => `Exercice ${a} (sept. ${a - 1} → août ${a})`;
const exShort = (a: number) => `Ex. ${a}`;

// L'exercice fiscal courant : si on est entre sept. et déc., on est dans FY (year+1)
function currentFiscalYear(d: Date = new Date()) {
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

export function GaiaDashboard({ onGoToSync }: { onGoToSync: () => void }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [clientQuery, setClientQuery] = useState("");
  const [caMensuel, setCaMensuel] = useState<CaMensuel[]>([]);
  const [caClient, setCaClient] = useState<CaClient[]>([]);
  const [caFamille, setCaFamille] = useState<CaFamille[]>([]);
  const [cmdEtat, setCmdEtat] = useState<CommandesEtat[]>([]);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [stock, setStock] = useState<StockValeur[]>([]);
  const [ecotaxe, setEcotaxe] = useState<EcotaxeMensuel[]>([]);
  const [caPeriodeEgale, setCaPeriodeEgale] = useState<CaPeriodeEgale[]>([]);
  const [retroSfa, setRetroSfa] = useState<RetrocessionSfa[]>([]);
  const [margeFamille, setMargeFamille] = useState<MargeFamille[]>([]);
  const [margeClient, setMargeClient] = useState<MargeClient[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const currentYear = currentFiscalYear();
  const [yearClient, setYearClient] = useState<number>(currentYear);
  const [yearFamille, setYearFamille] = useState<number>(currentYear);
  const [yearMarge, setYearMarge] = useState<number>(currentYear);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const client: any = supabase;
      const [m, c, f, e, s, ec, pe, sfa, mf, mc, sl, pip] = await Promise.all([
        client.from("v_gaia_ca_mensuel").select("*"),
        client.from("v_gaia_ca_client").select("*"),
        client.from("v_gaia_ca_famille").select("*"),
        client.from("v_gaia_commandes_etat").select("*"),
        client.from("v_gaia_stock_valeur").select("*"),
        client.from("v_gaia_ecotaxe_mensuel").select("*"),
        client.from("v_gaia_ca_periode_egale").select("*"),
        client.from("v_gaia_retrocession_sfa").select("*"),
        client.from("v_gaia_marge_famille").select("*"),
        client.from("v_gaia_marge_client").select("*"),
        client.from("gaia_sync_log").select("finished_at").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
        client.from("v_gaia_pipeline").select("*"),
      ]);
      setCaMensuel((m.data as CaMensuel[]) ?? []);
      setCaClient((c.data as CaClient[]) ?? []);
      setCaFamille((f.data as CaFamille[]) ?? []);
      setCmdEtat((e.data as CommandesEtat[]) ?? []);
      setStock((s.data as StockValeur[]) ?? []);
      setEcotaxe((ec.data as EcotaxeMensuel[]) ?? []);
      setCaPeriodeEgale((pe.data as CaPeriodeEgale[]) ?? []);
      setRetroSfa((sfa.data as RetrocessionSfa[]) ?? []);
      setMargeFamille((mf.data as MargeFamille[]) ?? []);
      setMargeClient((mc.data as MargeClient[]) ?? []);
      setPipeline((pip.data as PipelineRow[]) ?? []);
      setLastSync(sl.data?.finished_at ?? null);
      setLoading(false);
    })();
  }, []);

  // KPI CA exercice en cours (comparaison à période égale)
  const caPeMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of caPeriodeEgale) m.set(Number(r.annee), Number(r.ca_ht || 0));
    return m;
  }, [caPeriodeEgale]);
  const caCurrent = caPeMap.get(currentYear) ?? 0;
  const caPrev = caPeMap.get(currentYear - 1) ?? 0;
  const evolution = caPrev > 0 ? ((caCurrent - caPrev) / caPrev) * 100 : null;
  const retroCurrent = useMemo(
    () => retroSfa.filter((r) => Number(r.annee) === currentYear).reduce((n, r) => n + Number(r.montant_ht || 0), 0),
    [retroSfa, currentYear]
  );

  // Pipeline commercial (agrégats)
  const pipeStats = useMemo(() => {
    const pick = (cat: "devis" | "commande", statuts: string[]) => {
      const rows = pipeline.filter((r) => r.categorie === cat && statuts.includes(r.statut));
      return {
        total: rows.reduce((n, r) => n + Number(r.total_ht || 0), 0),
        nb: rows.reduce((n, r) => n + Number(r.nb || 0), 0),
      };
    };
    return {
      devis: pick("devis", ["Brouillon", "Ouvert"]),
      signee: pick("commande", ["Brouillon", "Ouvert"]),
      expedition: pick("commande", ["Expédition en cours"]),
      reliquat: pick("commande", ["Reliquat"]),
    };
  }, [pipeline]);

  const stockTotal = stock.reduce(
    (acc, r) => ({ achat: acc.achat + Number(r.valeur_achat || 0), vente: acc.vente + Number(r.valeur_vente || 0) }),
    { achat: 0, vente: 0 }
  );

  // Exercices disponibles (multi-années)
  const years = useMemo(() => {
    const set = new Set<number>();
    caMensuel.forEach((r) => set.add(Number(r.annee)));
    return Array.from(set).sort((a, b) => b - a).slice(0, 3);
  }, [caMensuel]);

  // Séries mensuelles indexées par mois_fiscal (1=sept … 12=août)
  const chartMensuel = useMemo(() => {
    const idx = new Map<number, Map<number, number>>();
    for (const r of caMensuel) {
      const y = Number(r.annee);
      let mf = Number(r.mois_fiscal);
      if (!mf) {
        // fallback : dériver du champ "mois" (date)
        const cal = typeof r.mois === "string" ? parseInt(r.mois.slice(5, 7), 10) : 0;
        if (cal >= 9) mf = cal - 8;
        else if (cal >= 1) mf = cal + 4;
      }
      if (!mf) continue;
      const ca = Number(r.ca_ht) || 0;
      if (!idx.has(y)) idx.set(y, new Map());
      idx.get(y)!.set(mf, (idx.get(y)!.get(mf) ?? 0) + ca);
    }
    return Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, any> = { mois: MOIS_FISCAL[i] };
      for (const y of years) {
        row[exShort(y)] = idx.get(y)?.get(i + 1) ?? 0;
      }
      return row;
    });
  }, [caMensuel, years]);


  const yearsClient = useMemo(
    () => Array.from(new Set(caClient.map((r) => r.annee))).sort((a, b) => b - a),
    [caClient]
  );
  const yearsFamille = useMemo(
    () => Array.from(new Set(caFamille.map((r) => r.annee))).sort((a, b) => b - a),
    [caFamille]
  );

  const topClients = useMemo(() => {
    const filtered = caClient.filter((r) => r.annee === yearClient);
    const total = filtered.reduce((n, r) => n + Number(r.ca_ht || 0), 0);
    const sorted = [...filtered].sort((a, b) => Number(b.ca_ht) - Number(a.ca_ht)).slice(0, 10);
    return sorted.map((r, i) => ({
      rang: i + 1,
      client: r.client || r.code_client,
      code: r.code_client,
      ca: Number(r.ca_ht || 0),
      part: total > 0 ? (Number(r.ca_ht || 0) / total) * 100 : 0,
    }));
  }, [caClient, yearClient]);

  const famillesData = useMemo(() => {
    const filtered = caFamille.filter((r) => r.annee === yearFamille);
    const sorted = [...filtered]
      .map((r) => ({ name: r.famille || "—", value: Number(r.ca_ht || 0) }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 6) {
      return sorted.map((r, i) => ({ ...r, color: i < 5 ? FAMILY_COLORS[i] : OTHERS_COLOR }));
    }
    const top = sorted.slice(0, 5).map((r, i) => ({ ...r, color: FAMILY_COLORS[i] }));
    const othersValue = sorted.slice(5).reduce((n, r) => n + r.value, 0);
    return [...top, { name: "Autres", value: othersValue, color: OTHERS_COLOR }];
  }, [caFamille, yearFamille]);

  const famillesTotal = useMemo(
    () => famillesData.reduce((n, r) => n + r.value, 0),
    [famillesData]
  );

  const ecotaxeTotal = ecotaxe.reduce((n, r) => n + Number(r.ecotaxe_ht || 0), 0);
  const ecotaxeChart = ecotaxe
    .slice()
    .sort((a, b) => a.mois - b.mois)
    .map((r) => ({ mois: MOIS_CAL[(r.mois - 1) % 12], value: Number(r.ecotaxe_ht || 0) }));

  // ===== Marge (estimée) =====
  const yearsMarge = useMemo(() => {
    const set = new Set<number>();
    margeFamille.forEach((r) => set.add(Number(r.annee)));
    margeClient.forEach((r) => set.add(Number(r.annee)));
    return Array.from(set).sort((a, b) => b - a);
  }, [margeFamille, margeClient]);

  const margeFamilleYear = useMemo(
    () => margeFamille.filter((r) => Number(r.annee) === yearMarge),
    [margeFamille, yearMarge]
  );
  const margeClientYear = useMemo(
    () => margeClient.filter((r) => Number(r.annee) === yearMarge),
    [margeClient, yearMarge]
  );

  const margeGlobal = useMemo(() => {
    const caHt = margeFamilleYear.reduce((n, r) => n + Number(r.ca_ht || 0), 0);
    const caCout = margeFamilleYear.reduce((n, r) => n + Number(r.ca_avec_cout || 0), 0);
    const marge = margeFamilleYear.reduce((n, r) => n + Number(r.marge_estimee || 0), 0);
    const cout = Math.max(0, caCout - marge);
    return {
      caHt,
      caCout,
      cout,
      marge,
      // Taux de marque = marge / prix de vente
      taux: caCout > 0 ? (marge / caCout) * 100 : 0,
      // Taux de marge = marge / coût d'achat
      tauxMarge: cout > 0 ? (marge / cout) * 100 : 0,
      couverture: caHt > 0 ? (caCout / caHt) * 100 : 0,
    };
  }, [margeFamilleYear]);

  const margeFamilleTable = useMemo(() => {
    return [...margeFamilleYear]
      .map((r) => {
        const caCout = Number(r.ca_avec_cout || 0);
        const marge = Number(r.marge_estimee || 0);
        return {
          famille: r.famille || "—",
          ca: Number(r.ca_ht || 0),
          caCout,
          marge,
          taux: caCout > 0 ? (marge / caCout) * 100 : 0,
        };
      })
      .sort((a, b) => b.marge - a.marge);
  }, [margeFamilleYear]);

  const maxTauxFamille = useMemo(
    () => margeFamilleTable.reduce((m, r) => (r.taux > m ? r.taux : m), 0),
    [margeFamilleTable]
  );

  const topClientsMarge = useMemo(() => {
    return [...margeClientYear]
      .map((r) => {
        const caCout = Number(r.ca_avec_cout || 0);
        const marge = Number(r.marge_estimee || 0);
        return {
          client: r.client || "—",
          ca: Number(r.ca_ht || 0),
          caCout,
          marge,
          taux: caCout > 0 ? (marge / caCout) * 100 : 0,
        };
      })
      .sort((a, b) => b.marge - a.marge)
      .slice(0, 10);
  }, [margeClientYear]);

  const flopClientsMarge = useMemo(() => {
    return [...margeClientYear]
      .map((r) => {
        const caCout = Number(r.ca_avec_cout || 0);
        const marge = Number(r.marge_estimee || 0);
        return {
          client: r.client || "—",
          ca: Number(r.ca_ht || 0),
          caCout,
          marge,
          taux: caCout > 0 ? (marge / caCout) * 100 : 0,
        };
      })
      .filter((r) => r.ca > 20_000 && r.caCout > 0)
      .sort((a, b) => a.taux - b.taux)
      .slice(0, 5);
  }, [margeClientYear]);
  // Liste des noms de clients pour la recherche (nom regroupé)
  const clientNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of caClient) if (r.client) set.add(r.client);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [caClient]);

  const clientMatches = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return [] as string[];
    return clientNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  }, [clientNames, clientQuery]);

  const openClient = (name: string) => navigate(`/admin/gaia/client/${encodeURIComponent(name)}`);


  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement du dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header sync info + recherche client */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
          Dernière synchronisation :{" "}
          <span className="text-foreground">
            {lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "jamais"}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && clientMatches[0]) openClient(clientMatches[0]);
              }}
              placeholder="Rechercher un client…"
              className="h-8 pl-8"
            />
            {clientQuery && clientMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-xl">
                {clientMatches.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setClientQuery("");
                      openClient(n);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onGoToSync}>
            Aller à la synchronisation <ArrowRight className="ml-2 h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Pipeline commercial */}
      <PipelineBanner stats={pipeStats} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          title="CA exercice en cours"
          value={eur(caCurrent)}
          hint={
            <div className="space-y-1">
              {evolution === null ? (
                <span className="text-muted-foreground">{exShort(currentYear)} · pas de comparatif</span>
              ) : (
                <span className={evolution >= 0 ? "text-secondary" : "text-destructive"}>
                  {evolution >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                  {evolution >= 0 ? "+" : ""}
                  {evolution.toFixed(1)}% vs {exShort(currentYear - 1)} à période égale ({eur(caPrev)})
                </span>
              )}
              {retroCurrent > 0 && (
                <div className="text-[11px] text-muted-foreground/80">
                  + rétrocession SFA : {eur(retroCurrent)} (hors CA)
                </div>
              )}
            </div>
          }
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
        />
        <KpiCard
          title="Stock"
          value={eur(stockTotal.achat)}
          hint={<span className="text-muted-foreground">Valeur vente : {eur(stockTotal.vente)}</span>}
          icon={<Package className="h-4 w-4 text-secondary" />}
        />
      </div>

      {/* CA mensuel — calendrier fiscal */}
      <Panel title="CA mensuel — comparaison par exercice (sept. → août)">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartMensuel}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mois" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} M€` : v >= 1000 ? `${Math.round(v / 1000)} k€` : String(v))}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(v: number) => eur(Number(v))}
              />
              <Legend />
              {years.map((y, i) => (
                <Bar key={y} dataKey={exShort(y)} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* Palmarès clients */}
      <Panel
        title="Palmarès clients — top 10"
        action={
          <YearSelect value={yearClient} years={yearsClient.length ? yearsClient : [currentYear]} onChange={setYearClient} />
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topClients} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <YAxis type="category" dataKey="client" stroke="hsl(var(--muted-foreground))" fontSize={11} width={140} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} labelStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(v: number) => eur(Number(v))}
                />
                <Bar dataKey="ca" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Client</th>
                  <th className="px-2 py-2 text-right">CA HT</th>
                  <th className="px-2 py-2 text-right">Part</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((r) => (
                  <tr key={r.code} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{r.rang}</td>
                    <td className="px-2 py-2">
                      <Link
                        to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                        className="text-foreground hover:text-primary hover:underline"
                      >
                        {r.client}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right font-medium">{eur(r.ca)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{r.part.toFixed(1)}%</td>
                  </tr>
                ))}
                {topClients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                      Aucune donnée pour {exShort(yearClient)}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      {/* Familles + Écotaxe */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Ventilation par famille"
            action={
              <YearSelect
                value={yearFamille}
                years={yearsFamille.length ? yearsFamille : [currentYear]}
                onChange={setYearFamille}
              />
            }
          >
            {famillesData.length === 0 ? (
              <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
                Aucune donnée pour {exShort(yearFamille)}.
              </div>
            ) : (
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <div className="h-72 w-full md:w-1/2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={famillesData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={110}
                        paddingAngle={2}
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                        labelLine={false}
                        label={({ percent, cx, cy, midAngle, innerRadius, outerRadius }: any) => {
                          if (!percent || percent < 0.08) return null;
                          const RAD = Math.PI / 180;
                          const r = innerRadius + (outerRadius - innerRadius) * 0.55;
                          const x = cx + r * Math.cos(-midAngle * RAD);
                          const y = cy + r * Math.sin(-midAngle * RAD);
                          return (
                            <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
                              {`${Math.round(percent * 100)}%`}
                            </text>
                          );
                        }}
                      >
                        {famillesData.map((r, i) => (
                          <Cell key={i} fill={r.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number) => eur(Number(v))}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-full space-y-1.5 md:w-1/2">
                  {famillesData.map((r) => {
                    const pct = famillesTotal > 0 ? (r.value / famillesTotal) * 100 : 0;
                    return (
                      <li key={r.name} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/30">
                        <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                        <span className="flex-1 truncate">{r.name}</span>
                        <span className="font-medium tabular-nums">{eur(r.value)}</span>
                        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Panel>
        </div>
        <div>
          <Panel title="Éco-taxe">
            {ecotaxe.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Leaf className="h-8 w-8 text-secondary/60" />
                <div className="font-medium text-foreground">À configurer</div>
                <div>Aucune donnée éco-taxe disponible pour le moment.</div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded border border-border/60 bg-background/40 p-3">
                  <div className="text-xs text-muted-foreground">Total annuel</div>
                  <div className="font-display text-2xl font-bold">{eur(ecotaxeTotal)}</div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ecotaxeChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="mois" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number) => eur(Number(v))}
                      />
                      <Line type="monotone" dataKey="value" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ===== Marge (estimée) ===== */}
      <Panel
        title="Marge (estimée)"
        action={
          <YearSelect
            value={yearMarge}
            years={yearsMarge.length ? yearsMarge : [currentYear]}
            onChange={setYearMarge}
          />
        }
      >
        {margeFamilleYear.length === 0 && margeClientYear.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            Aucune donnée de marge pour {exShort(yearMarge)}.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 lg:col-span-1">
                <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                  <span>Taux de marque global</span>
                  <span
                    title="Taux de marque = marge ÷ prix de vente. Le taux de marge (marge ÷ coût d'achat) est indiqué entre parenthèses."
                    className="inline-flex cursor-help"
                    aria-label="Définition taux de marque"
                  >
                    <Info className="h-3.5 w-3.5 text-muted-foreground/70" />
                  </span>
                </div>
                <div className="font-display text-3xl font-bold text-primary text-glow-purple">
                  {margeGlobal.taux.toFixed(1)}%
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  soit un taux de marge de{" "}
                  <span className="text-foreground">{margeGlobal.tauxMarge.toFixed(1)}%</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Marge estimée : <span className="text-foreground">{eur(margeGlobal.marge)}</span> sur{" "}
                  <span className="text-foreground">{eur(margeGlobal.caCout)}</span> de CA analysé
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  sur {margeGlobal.couverture.toFixed(0)}% du CA analysé ({eur(margeGlobal.caCout)} /{" "}
                  {eur(margeGlobal.caHt)})
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card/40 p-4 lg:col-span-2">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Marge par famille</span>
                  <span>Trié par marge estimée</span>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 text-left">Famille</th>
                        <th className="px-2 py-2 text-right">CA</th>
                        <th className="px-2 py-2 text-right">Marge est.</th>
                        <th className="px-2 py-2 text-left w-56">Taux</th>
                      </tr>
                    </thead>
                    <tbody>
                      {margeFamilleTable.map((r) => {
                        const pct = maxTauxFamille > 0 ? (r.taux / maxTauxFamille) * 100 : 0;
                        return (
                          <tr key={r.famille} className="border-b border-border/40 hover:bg-muted/30">
                            <td className="px-2 py-2 truncate max-w-[220px]">{r.famille}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{eur(r.ca)}</td>
                            <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(r.marge)}</td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded bg-muted/50">
                                  <div
                                    className="h-full rounded bg-primary"
                                    style={{ width: `${Math.max(2, pct)}%` }}
                                  />
                                </div>
                                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                                  {r.taux.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card/40 p-4">
                <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Top 10 clients — marge estimée
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Client</th>
                        <th className="px-2 py-2 text-right">CA</th>
                        <th className="px-2 py-2 text-right">Marge</th>
                        <th className="px-2 py-2 text-right">Taux</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topClientsMarge.map((r, i) => (
                        <tr key={r.client + i} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-2 truncate max-w-[180px]">
                            <Link
                              to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                              className="text-foreground hover:text-primary hover:underline"
                            >
                              {r.client}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{eur(r.ca)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(r.marge)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                            {r.taux.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {topClientsMarge.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                            Aucun client.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Flop 5 — taux de marque le plus faible (CA &gt; 20 000 €)
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Client</th>
                        <th className="px-2 py-2 text-right">CA</th>
                        <th className="px-2 py-2 text-right">Marge</th>
                        <th className="px-2 py-2 text-right">Taux</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flopClientsMarge.map((r, i) => (
                        <tr key={r.client + i} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-2 truncate max-w-[180px]">
                            <Link
                              to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                              className="text-foreground hover:text-primary hover:underline"
                            >
                              {r.client}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{eur(r.ca)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{eur(r.marge)}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium text-destructive">
                            {r.taux.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {flopClientsMarge.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                            Aucun client au-dessus de 20 000 € de CA.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              ⓘ Marge estimée sur la base du dernier coût d'achat connu. Elle ne
              couvre que la part du CA pour laquelle un coût est disponible
              ({margeGlobal.couverture.toFixed(0)}% du CA sur {exShort(yearMarge)}).
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{title}</span>
        {icon}
      </div>
      <div className="font-display text-2xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-xs">{hint}</div>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function YearSelect({ value, years, onChange }: { value: number; years: number[]; onChange: (y: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {exShort(y)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type PipeAgg = { total: number; nb: number };
type PipeStats = { devis: PipeAgg; signee: PipeAgg; expedition: PipeAgg; reliquat: PipeAgg };

function PipelineBanner({ stats }: { stats: PipeStats }) {
  const Arrow = () => (
    <>
      <ArrowRight className="hidden h-6 w-6 shrink-0 text-muted-foreground/50 md:block" />
      <ArrowDown className="mx-auto h-5 w-5 shrink-0 text-muted-foreground/50 md:hidden" />
    </>
  );
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Pipeline commercial</h3>
          <p className="text-xs text-muted-foreground">Cycle de vie Cegid — du devis à la facturation</p>
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <PipelineStep
          color="primary"
          icon={<FileText className="h-5 w-5" />}
          label="Devis en cours"
          value={eur(stats.devis.total)}
          count={`${num(stats.devis.nb)} devis`}
          tooltip="Statuts Cegid Brouillon + Ouvert d'un devis (QT) : documents non encore validés en commande. C'est du potentiel commercial."
        />
        <Arrow />
        <PipelineStep
          color="blue"
          icon={<FileSignature className="h-5 w-5" />}
          label="Commandes signées"
          value={eur(stats.signee.total)}
          count={`${num(stats.signee.nb)} commandes`}
          subtitle="Stock réservé, en attente d'expédition"
          tooltip="Statuts Cegid Brouillon + Ouvert d'une commande : commandes en cours de préparation ou validées, stock réservé, en attente d'expédition."
        />
        <Arrow />
        <PipelineStep
          color="orange"
          icon={<Truck className="h-5 w-5" />}
          label="En livraison"
          value={eur(stats.expedition.total + stats.reliquat.total)}
          count={`${num(stats.expedition.nb + stats.reliquat.nb)} commandes`}
          tooltip="Commandes physiquement en train d'être livrées ou livrées partiellement (reliquat)."
          extra={
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-2 rounded border border-orange-500/20 bg-orange-500/5 px-2 py-1">
                <span className="text-muted-foreground">Expédition en cours</span>
                <span className="tabular-nums text-foreground">{eur(stats.expedition.total)} · {num(stats.expedition.nb)}</span>
              </div>
              <div
                className="flex items-center justify-between gap-2 rounded border border-orange-500/20 bg-orange-500/5 px-2 py-1"
                title="Commande partiellement expédiée : la part déjà livrée est déjà facturée. Montant affiché = total de la commande (le reste-à-facturer précis arrive bientôt)."
              >
                <span className="flex items-center gap-1 text-muted-foreground">
                  Reliquat
                  <Info className="h-3 w-3" />
                </span>
                <span className="tabular-nums text-foreground">{eur(stats.reliquat.total)} · {num(stats.reliquat.nb)}</span>
              </div>
            </div>
          }
        />
        <Arrow />
        <PipelineStep
          color="green"
          icon={<Receipt className="h-5 w-5" />}
          label="Traité = facturé"
          value="→ CA"
          count="Bascule dans le chiffre d'affaires"
          tooltip="Statut Cegid Traité : la commande est facturée. Le montant sort du pipeline et rejoint le chiffre d'affaires."
          isFinal
        />
      </div>
    </div>
  );
}

const PIPE_COLORS: Record<string, { border: string; bg: string; text: string; icon: string }> = {
  primary: { border: "border-primary/40", bg: "bg-primary/10", text: "text-primary", icon: "text-primary" },
  blue: { border: "border-sky-500/40", bg: "bg-sky-500/10", text: "text-sky-400", icon: "text-sky-400" },
  orange: { border: "border-orange-500/40", bg: "bg-orange-500/10", text: "text-orange-400", icon: "text-orange-400" },
  green: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-400", icon: "text-emerald-400" },
};

function PipelineStep({
  color, icon, label, value, count, subtitle, tooltip, extra, isFinal,
}: {
  color: "primary" | "blue" | "orange" | "green";
  icon: React.ReactNode;
  label: string;
  value: string;
  count: string;
  subtitle?: string;
  tooltip: string;
  extra?: React.ReactNode;
  isFinal?: boolean;
}) {
  const c = PIPE_COLORS[color];
  return (
    <div
      className={`group relative flex flex-col rounded-lg border ${c.border} ${c.bg} p-3 transition hover:shadow-lg`}
      title={tooltip}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md bg-background/40 ${c.icon}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
      </div>
      <div className={`font-display text-2xl font-bold tabular-nums ${isFinal ? c.text : "text-foreground"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{count}</div>
      {subtitle && <div className="mt-1 text-[11px] italic text-muted-foreground/80">{subtitle}</div>}
      {extra}
    </div>
  );
}


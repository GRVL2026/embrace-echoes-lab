import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, TrendingDown, FileText, FileSignature, Package, Leaf, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
type StockValeur = { depot: string; quantite: number; valeur_achat: number; valeur_vente: number };
type EcotaxeMensuel = { mois: number; ecotaxe_ht: number };
type CaPeriodeEgale = { annee: number; ca_ht: number | string };
type RetrocessionSfa = { annee: number; mois?: number; montant_ht: number | string };

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
  const [loading, setLoading] = useState(true);
  const [caMensuel, setCaMensuel] = useState<CaMensuel[]>([]);
  const [caClient, setCaClient] = useState<CaClient[]>([]);
  const [caFamille, setCaFamille] = useState<CaFamille[]>([]);
  const [cmdEtat, setCmdEtat] = useState<CommandesEtat[]>([]);
  const [stock, setStock] = useState<StockValeur[]>([]);
  const [ecotaxe, setEcotaxe] = useState<EcotaxeMensuel[]>([]);
  const [caPeriodeEgale, setCaPeriodeEgale] = useState<CaPeriodeEgale[]>([]);
  const [retroSfa, setRetroSfa] = useState<RetrocessionSfa[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const currentYear = currentFiscalYear();
  const [yearClient, setYearClient] = useState<number>(currentYear);
  const [yearFamille, setYearFamille] = useState<number>(currentYear);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const client: any = supabase;
      const [m, c, f, e, s, ec, pe, sl] = await Promise.all([
        client.from("v_gaia_ca_mensuel").select("*"),
        client.from("v_gaia_ca_client").select("*"),
        client.from("v_gaia_ca_famille").select("*"),
        client.from("v_gaia_commandes_etat").select("*"),
        client.from("v_gaia_stock_valeur").select("*"),
        client.from("v_gaia_ecotaxe_mensuel").select("*"),
        client.from("v_gaia_ca_periode_egale").select("*"),
        client.from("gaia_sync_log").select("finished_at").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setCaMensuel((m.data as CaMensuel[]) ?? []);
      setCaClient((c.data as CaClient[]) ?? []);
      setCaFamille((f.data as CaFamille[]) ?? []);
      setCmdEtat((e.data as CommandesEtat[]) ?? []);
      setStock((s.data as StockValeur[]) ?? []);
      setEcotaxe((ec.data as EcotaxeMensuel[]) ?? []);
      setCaPeriodeEgale((pe.data as CaPeriodeEgale[]) ?? []);
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

  const signees = cmdEtat.find((r) => r.etat === "signee") ?? { nb_commandes: 0, total_ht: 0, etat: "signee" as const };
  const devis = cmdEtat.find((r) => r.etat === "devis") ?? { nb_commandes: 0, total_ht: 0, etat: "devis" as const };
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

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement du dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header sync info */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
          Dernière synchronisation :{" "}
          <span className="text-foreground">
            {lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "jamais"}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onGoToSync}>
          Aller à la synchronisation <ArrowRight className="ml-2 h-3 w-3" />
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="CA exercice en cours"
          value={eur(caCurrent)}
          hint={
            evolution === null ? (
              <span className="text-muted-foreground">{exShort(currentYear)} · pas de comparatif</span>
            ) : (
              <span className={evolution >= 0 ? "text-secondary" : "text-destructive"}>
                {evolution >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                {evolution >= 0 ? "+" : ""}
                {evolution.toFixed(1)}% vs {exShort(currentYear - 1)} à période égale ({eur(caPrev)})
              </span>
            )
          }
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
        />
        <KpiCard
          title="Commandes signées"
          value={eur(Number(signees.total_ht))}
          hint={<span className="text-muted-foreground">{num(Number(signees.nb_commandes))} commandes</span>}
          icon={<FileSignature className="h-4 w-4 text-secondary" />}
        />
        <KpiCard
          title="Devis en cours"
          value={eur(Number(devis.total_ht))}
          hint={<span className="text-muted-foreground">{num(Number(devis.nb_commandes))} devis</span>}
          icon={<FileText className="h-4 w-4 text-primary" />}
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
                    <td className="px-2 py-2">{r.client}</td>
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

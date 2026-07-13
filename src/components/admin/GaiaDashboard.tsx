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

type CaMensuel = { mois: string; annee: number; ca_ht: number | string; lignes: number };
type CaClient = { annee: number; code_client: string; client: string; ca_ht: number };
type CaFamille = { annee: number; famille: string; ca_ht: number };
type CommandesEtat = { etat: "signee" | "devis"; nb_commandes: number; total_ht: number };
type StockValeur = { depot: string; quantite: number; valeur_achat: number; valeur_vente: number };
type EcotaxeMensuel = { mois: number; ecotaxe_ht: number };

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n || 0);

const MOIS = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
const COLORS = ["#9B5CFF","#ADFF00","#5CC8FF","#FF6B9D","#FFB800","#00E5A0","#FF7A5C","#B08CFF","#5CFFB8","#FFD75C"];

export function GaiaDashboard({ onGoToSync }: { onGoToSync: () => void }) {
  const [loading, setLoading] = useState(true);
  const [caMensuel, setCaMensuel] = useState<CaMensuel[]>([]);
  const [caClient, setCaClient] = useState<CaClient[]>([]);
  const [caFamille, setCaFamille] = useState<CaFamille[]>([]);
  const [cmdEtat, setCmdEtat] = useState<CommandesEtat[]>([]);
  const [stock, setStock] = useState<StockValeur[]>([]);
  const [ecotaxe, setEcotaxe] = useState<EcotaxeMensuel[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [yearClient, setYearClient] = useState<number>(currentYear);
  const [yearFamille, setYearFamille] = useState<number>(currentYear);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const client: any = supabase;
      const [m, c, f, e, s, ec, sl] = await Promise.all([
        client.from("v_gaia_ca_mensuel").select("*"),
        client.from("v_gaia_ca_client").select("*"),
        client.from("v_gaia_ca_famille").select("*"),
        client.from("v_gaia_commandes_etat").select("*"),
        client.from("v_gaia_stock_valeur").select("*"),
        client.from("v_gaia_ecotaxe_mensuel").select("*"),
        client.from("gaia_sync_log").select("finished_at").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setCaMensuel((m.data as CaMensuel[]) ?? []);
      setCaClient((c.data as CaClient[]) ?? []);
      setCaFamille((f.data as CaFamille[]) ?? []);
      setCmdEtat((e.data as CommandesEtat[]) ?? []);
      setStock((s.data as StockValeur[]) ?? []);
      setEcotaxe((ec.data as EcotaxeMensuel[]) ?? []);
      setLastSync(sl.data?.finished_at ?? null);
      setLoading(false);
    })();
  }, []);

  // KPI CA année en cours + N-1
  const caY = useMemo(() => {
    const acc = new Map<number, number>();
    for (const r of caMensuel) acc.set(r.annee, (acc.get(r.annee) ?? 0) + Number(r.ca_ht || 0));
    return acc;
  }, [caMensuel]);
  const caCurrent = caY.get(currentYear) ?? 0;
  const caPrev = caY.get(currentYear - 1) ?? 0;
  const evolution = caPrev > 0 ? ((caCurrent - caPrev) / caPrev) * 100 : null;

  const signees = cmdEtat.find((r) => r.etat === "signee") ?? { nb_commandes: 0, total_ht: 0, etat: "signee" as const };
  const devis = cmdEtat.find((r) => r.etat === "devis") ?? { nb_commandes: 0, total_ht: 0, etat: "devis" as const };
  const stockTotal = stock.reduce(
    (acc, r) => ({ achat: acc.achat + Number(r.valeur_achat || 0), vente: acc.vente + Number(r.valeur_vente || 0) }),
    { achat: 0, vente: 0 }
  );

  // Séries mensuelles multi-années
  const years = useMemo(() => {
    const set = new Set<number>();
    caMensuel.forEach((r) => set.add(r.annee));
    return Array.from(set).sort((a, b) => b - a).slice(0, 3);
  }, [caMensuel]);

  const chartMensuel = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, any> = { mois: MOIS[i] };
      for (const y of years) {
        const rec = caMensuel.find((r) => r.annee === y && r.mois === i + 1);
        row[String(y)] = rec ? Number(rec.ca_ht) : 0;
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
    return [...filtered]
      .sort((a, b) => Number(b.ca_ht) - Number(a.ca_ht))
      .map((r) => ({ name: r.famille || "—", value: Number(r.ca_ht || 0) }));
  }, [caFamille, yearFamille]);

  const ecotaxeTotal = ecotaxe.reduce((n, r) => n + Number(r.ecotaxe_ht || 0), 0);
  const ecotaxeChart = ecotaxe
    .slice()
    .sort((a, b) => a.mois - b.mois)
    .map((r) => ({ mois: MOIS[(r.mois - 1) % 12], value: Number(r.ecotaxe_ht || 0) }));

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
          title={`CA ${currentYear}`}
          value={eur(caCurrent)}
          hint={
            evolution === null ? (
              <span className="text-muted-foreground">Pas de N-1</span>
            ) : (
              <span className={evolution >= 0 ? "text-secondary" : "text-destructive"}>
                {evolution >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                {evolution >= 0 ? "+" : ""}
                {evolution.toFixed(1)}% vs {currentYear - 1} ({eur(caPrev)})
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

      {/* CA mensuel */}
      <Panel title="CA mensuel — comparaison multi-années">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartMensuel}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mois" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number) => eur(Number(v))}
              />
              <Legend />
              {years.map((y, i) => (
                <Bar key={y} dataKey={String(y)} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
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
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
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
                      Aucune donnée pour {yearClient}.
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
            <div className="h-80">
              {famillesData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Aucune donnée pour {yearFamille}.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={famillesData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={120}
                      paddingAngle={2}
                    >
                      {famillesData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: number) => eur(Number(v))}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
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
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
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
      <SelectTrigger className="h-8 w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

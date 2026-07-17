import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, TrendingUp, TrendingDown, Users, ShoppingCart, Wrench } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";

type Mensuel = { mois: string | null; annee: number | null; ca_ht: number | string | null; lignes: number | string | null; clients: number | string | null };
type TopClient = { annee: number | null; client: string | null; code_client: string | null; ca_ht: number | string | null; lignes: number | string | null };
type TopArticle = { annee: number | null; code_article: string | null; description: string | null; quantite: number | string | null; ca_ht: number | string | null };

const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n || 0);
const MOIS_FISCAL = ["Sept","Oct","Nov","Déc","Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août"];
const COLORS = ["#9B5CFF","#ADFF00","#5CC8FF","#FF6B9D","#FFB800"];
const exShort = (a: number) => `Ex. ${a}`;

function currentFiscalYear(d: Date = new Date()) {
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

// mois fiscal (1 = sept … 12 = août) à partir d'une date ISO ou d'un mois numérique
function toMoisFiscal(moisStr: string | null): number | null {
  if (!moisStr) return null;
  const cal = parseInt(moisStr.slice(5, 7), 10);
  if (!cal) return null;
  return cal >= 9 ? cal - 8 : cal + 4;
}

export function GaiaMagasin() {
  const currentYear = currentFiscalYear();
  const [yearArticles, setYearArticles] = useState<number>(currentYear);

  const { data, isPending: loading } = useQuery({
    queryKey: ["gaia-magasin"],
    queryFn: async () => {
      const c: any = supabase;
      const [m, tc, ta] = await Promise.all([
        c.from("v_gaia_magasin_mensuel").select("*"),
        c.from("v_gaia_magasin_top_clients").select("*"),
        c.from("v_gaia_magasin_top_articles").select("*"),
      ]);
      return {
        mensuel: (m.data as Mensuel[]) ?? [],
        topClients: (tc.data as TopClient[]) ?? [],
        topArticles: (ta.data as TopArticle[]) ?? [],
      };
    },
  });

  const mensuel = data?.mensuel ?? [];
  const topClients = data?.topClients ?? [];
  const topArticles = data?.topArticles ?? [];

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

  // KPIs exercice en cours vs N-1
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

    // clients uniques exercice courant via top_clients
    const clientsCurYear = new Set(
      topClients.filter((r) => Number(r.annee) === currentYear && r.client).map((r) => r.client),
    ).size;

    const evol = prev.ca > 0 ? ((cur.ca - prev.ca) / prev.ca) * 100 : null;
    const panierMoyen = cur.lignes > 0 ? cur.ca / cur.lignes : 0;
    return { cur, prev, evol, clients: clientsCurYear || cur.clientsMax, panierMoyen };
  }, [mensuel, topClients, currentYear]);

  // Chart CA mensuel par exercice (calendrier fiscal)
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
              Pilotage du magasin interne (classe Cegid MAGASIN) — exercice fiscal sept. → août.
            </p>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>CA pièces — {exShort(currentYear)}</span>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div className="font-display text-2xl font-bold">{eur(kpi.cur.ca)}</div>
          <div className="mt-1 text-xs">
            {kpi.evol === null ? (
              <span className="text-muted-foreground">Pas de comparatif</span>
            ) : (
              <span className={kpi.evol >= 0 ? "text-secondary" : "text-destructive"}>
                {kpi.evol >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                {kpi.evol >= 0 ? "+" : ""}{kpi.evol.toFixed(1)}% vs {exShort(currentYear - 1)} ({eur(kpi.prev.ca)})
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Clients acheteurs</span>
            <Users className="h-4 w-4 text-secondary" />
          </div>
          <div className="font-display text-2xl font-bold">{num(kpi.clients)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {num(kpi.cur.lignes)} lignes sur l'exercice
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Panier moyen / ligne</span>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </div>
          <div className="font-display text-2xl font-bold">{eur(kpi.panierMoyen)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Ticket moyen d'une ligne de facture pièce</div>
        </div>
      </div>

      {/* CA mensuel par exercice */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
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
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                itemStyle={{ color: "hsl(var(--foreground))" }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(v: number) => eur(Number(v))}
              />
              <Legend />
              {years.map((y, i) => (
                <Bar key={y} dataKey={exShort(y)} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top 10 clients + Top 10 articles */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card/40 p-4">
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

        <div className="rounded-lg border border-border bg-card/40 p-4">
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
                {topArticlesYear.map((r, i) => (
                  <tr key={(r.code_article ?? "") + i} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2 font-mono text-xs">{r.code_article ?? "—"}</td>
                    <td className="px-2 py-2 truncate max-w-[220px]" title={r.description ?? undefined}>{r.description ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{num(Number(r.quantite || 0))}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">{eur(Number(r.ca_ht || 0))}</td>
                  </tr>
                ))}
                {topArticlesYear.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">Aucun article sur l'exercice.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

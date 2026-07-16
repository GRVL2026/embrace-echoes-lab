import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Minus, ArrowLeft, AlertTriangle, Package, Users, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

type Stats = {
  currency: string;
  kpi: {
    ca30: number; caPrev: number; evolCA: number;
    count30: number; countPrev: number; evolCount: number;
    aov: number; aovPrev: number; evolAov: number;
  };
  salesByDay: { day: string; amount: number; count: number }[];
  topProducts: { title: string; qty: number; revenue: number }[];
  customers: { new: number; returning: number };
  latestOrders: {
    id: string; name: string; createdAt: string; customer: string;
    amount: number; currency: string; financial: string; fulfillment: string;
  }[];
  lowStock: {
    id: string; productTitle: string; handle: string; image: string | null;
    variantTitle: string; sku: string; quantity: number;
  }[];
  traffic: { sessions: number; conversion: number } | null;
  fetched_at: string;
  cached: boolean;
};

function fmtMoney(n: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
}
function fmtPct(n: number) {
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}
function EvolPill({ v }: { v: number }) {
  const Icon = v > 0.5 ? TrendingUp : v < -0.5 ? TrendingDown : Minus;
  const cls = v > 0.5 ? "text-secondary" : v < -0.5 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" /> {fmtPct(v)}
    </span>
  );
}

function statusBadge(v: string) {
  const map: Record<string, string> = {
    PAID: "bg-secondary/15 text-secondary border-secondary/40",
    PENDING: "bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
    REFUNDED: "bg-destructive/15 text-destructive border-destructive/40",
    FULFILLED: "bg-secondary/15 text-secondary border-secondary/40",
    UNFULFILLED: "bg-muted text-muted-foreground border-border",
    PARTIALLY_FULFILLED: "bg-yellow-500/15 text-yellow-500 border-yellow-500/40",
  };
  return map[v] || "bg-muted text-muted-foreground border-border";
}

export default function Ecommerce() {
  const { canAccessGaia, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const load = async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectId}.supabase.co/functions/v1/shopify-stats${force ? "?refresh=1" : ""}`;
      const r = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setStats(j);
    } catch (e: any) {
      toast.error("Erreur Shopify", { description: e?.message || String(e) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false); }, []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col">
      <AppHeader
        right={
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Actualiser
          </Button>
        }
      />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link to="/" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Retour au hub
            </Link>
            <h1 className="font-display text-3xl font-bold mt-1">
              <span className="text-primary text-glow-purple">E-commerce</span>
            </h1>
            <p className="text-sm text-muted-foreground">Activité de la boutique en ligne Shopify.</p>
          </div>
          {stats && (
            <div className="text-xs text-muted-foreground">
              Dernière synchro : {new Date(stats.fetched_at).toLocaleString("fr-FR")}
              {stats.cached && <span className="ml-2 opacity-60">(cache)</span>}
            </div>
          )}
        </div>

        {loading || !stats ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiTile
                label="CA 30 jours"
                value={fmtMoney(stats.kpi.ca30, stats.currency)}
                evol={stats.kpi.evolCA}
                sub={`vs ${fmtMoney(stats.kpi.caPrev, stats.currency)}`}
                accent="primary"
              />
              <KpiTile
                label="Commandes 30j"
                value={String(stats.kpi.count30)}
                evol={stats.kpi.evolCount}
                sub={`vs ${stats.kpi.countPrev}`}
                accent="secondary"
              />
              <KpiTile
                label="Panier moyen"
                value={fmtMoney(stats.kpi.aov, stats.currency)}
                evol={stats.kpi.evolAov}
                sub={`vs ${fmtMoney(stats.kpi.aovPrev, stats.currency)}`}
                accent="primary"
              />
              <KpiTile
                label="Clients 30j"
                value={String(stats.customers.new + stats.customers.returning)}
                sub={`${stats.customers.new} nouveaux · ${stats.customers.returning} récurrents`}
                accent="secondary"
              />
            </div>

            {/* Traffic (optional) */}
            {stats.traffic && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <KpiTile label="Sessions 7j" value={String(stats.traffic.sessions)} accent="primary" />
                <KpiTile label="Taux de conversion 7j" value={`${stats.traffic.conversion.toFixed(2)}%`} accent="secondary" />
              </div>
            )}

            {/* Chart 7 days */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" /> Ventes des 7 derniers jours
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.salesByDay}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickFormatter={(d) => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any) => fmtMoney(Number(v), stats.currency)}
                      labelFormatter={(d) => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })}
                    />
                    <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top products */}
              <Card className="p-4 sm:p-6 bg-card/60 border-border">
                <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" /> Top 10 produits (30j)
                </h2>
                {stats.topProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune vente.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                        <th className="pb-2">Produit</th>
                        <th className="pb-2 text-right">Qté</th>
                        <th className="pb-2 text-right">CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.topProducts.map((p, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="py-2 truncate max-w-[240px]">{p.title}</td>
                          <td className="py-2 text-right tabular-nums">{p.qty}</td>
                          <td className="py-2 text-right tabular-nums font-medium text-secondary">
                            {fmtMoney(p.revenue, stats.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              {/* Latest orders */}
              <Card className="p-4 sm:p-6 bg-card/60 border-border">
                <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> 10 dernières commandes
                </h2>
                {stats.latestOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune commande.</p>
                ) : (
                  <div className="space-y-2">
                    {stats.latestOrders.map((o) => (
                      <div key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{o.name} · {o.customer}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {new Date(o.createdAt).toLocaleString("fr-FR")}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className={`text-[10px] ${statusBadge(o.financial)}`}>{o.financial}</Badge>
                          <div className="text-sm font-semibold tabular-nums w-20 text-right">
                            {fmtMoney(o.amount, o.currency)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Low stock */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" /> Stock faible (&lt; 5)
              </h2>
              {stats.lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tous les produits ont un stock suffisant.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {stats.lowStock.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 rounded-md border border-border/60 bg-background/40 p-3">
                      {v.image ? (
                        <img src={v.image} alt="" className="h-12 w-12 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="h-12 w-12 rounded bg-muted flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{v.productTitle}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{v.variantTitle} · {v.sku || "—"}</div>
                      </div>
                      <Badge className="bg-destructive/15 text-destructive border-destructive/40 border" variant="outline">
                        {v.quantity}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function KpiTile({
  label, value, sub, evol, accent = "primary",
}: {
  label: string; value: string; sub?: string; evol?: number; accent?: "primary" | "secondary";
}) {
  const color = accent === "primary" ? "text-primary text-glow-purple" : "text-secondary text-glow-green";
  const border = accent === "primary" ? "border-primary/30" : "border-secondary/30";
  return (
    <Card className={`p-4 bg-card/60 border ${border}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {typeof evol === "number" && <EvolPill v={evol} />}
        {sub && <span className="text-muted-foreground truncate">{sub}</span>}
      </div>
    </Card>
  );
}

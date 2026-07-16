import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Minus, ArrowLeft,
  AlertTriangle, Package, Users, ShoppingBag, Sparkles, Repeat,
  Mail, Phone, MapPin, Copy, ChevronRight, CalendarRange,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import StockSyncPanel from "@/components/ecommerce/StockSyncPanel";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

type OrderLine = { title: string; variant: string | null; quantity: number; unitPrice: number; total: number };
type OrderDetail = {
  id: string; name: string; createdAt: string;
  customer: string; customerEmail: string | null; customerPhone: string | null;
  customerCity: string | null; customerCountry: string | null; customerOrders: number;
  amount: number; subtotal: number; shipping: number; tax: number;
  currency: string; financial: string; fulfillment: string;
  lineItems: OrderLine[];
};

type Stats = {
  currency: string;
  period: { key: string; days: number; since: string };
  kpi: {
    ca30: number; caPrev: number; evolCA: number;
    count30: number; countPrev: number; evolCount: number;
    aov: number; aovPrev: number; evolAov: number;
    returningShare: number;
  };
  salesByDay: { day: string; amount: number; count: number }[];
  salesByMonth: { month: string; amount: number; count: number }[];
  topProducts: { title: string; qty: number; revenue: number }[];
  customers: { new: number; returning: number };
  latestOrders: OrderDetail[];
  lowStock: {
    id: string; productTitle: string; handle: string; image: string | null;
    variantTitle: string; sku: string; quantity: number;
  }[];
  traffic: { sessions: number; conversion: number } | null;
  fetched_at: string;
  cached: boolean;
};

const PERIODS: { key: "7d" | "30d" | "90d" | "12m" | "all"; label: string; kpiLabel: string }[] = [
  { key: "7d", label: "7 jours", kpiLabel: "7j" },
  { key: "30d", label: "30 jours", kpiLabel: "30j" },
  { key: "90d", label: "90 jours", kpiLabel: "90j" },
  { key: "12m", label: "12 mois", kpiLabel: "12m" },
  { key: "all", label: "Depuis le début", kpiLabel: "total" },
];

function fmtMoney(n: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
}
function fmtMoneyPrecise(n: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(n || 0);
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
function CustomerBadge({ n }: { n: number }) {
  if (n <= 1) {
    return (
      <Badge variant="outline" className="text-[10px] bg-secondary/15 text-secondary border-secondary/40">
        <Sparkles className="h-3 w-3 mr-1" /> Nouveau client
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-primary/15 text-primary border-primary/40">
      <Repeat className="h-3 w-3 mr-1" /> Client récurrent — {n}<sup>e</sup> commande
    </Badge>
  );
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

/** Defensive normalization: guarantees every field exists even if the payload came from an older shape. */
function normalizeStats(j: any): Stats {
  const k = j?.kpi ?? {};
  const c = j?.customers ?? {};
  return {
    currency: j?.currency ?? "EUR",
    period: j?.period ?? { key: "30d", days: 30, since: new Date().toISOString() },
    kpi: {
      ca30: Number(k.ca30 ?? 0),
      caPrev: Number(k.caPrev ?? 0),
      evolCA: Number(k.evolCA ?? 0),
      count30: Number(k.count30 ?? 0),
      countPrev: Number(k.countPrev ?? 0),
      evolCount: Number(k.evolCount ?? 0),
      aov: Number(k.aov ?? 0),
      aovPrev: Number(k.aovPrev ?? 0),
      evolAov: Number(k.evolAov ?? 0),
      returningShare: Number(k.returningShare ?? 0),
    },
    salesByDay: Array.isArray(j?.salesByDay) ? j.salesByDay : [],
    salesByMonth: Array.isArray(j?.salesByMonth) ? j.salesByMonth : [],
    topProducts: Array.isArray(j?.topProducts) ? j.topProducts : [],
    customers: { new: Number(c.new ?? 0), returning: Number(c.returning ?? 0) },
    latestOrders: Array.isArray(j?.latestOrders) ? j.latestOrders : [],
    lowStock: Array.isArray(j?.lowStock) ? j.lowStock : [],
    traffic: j?.traffic
      ? { sessions: Number(j.traffic.sessions ?? 0), conversion: Number(j.traffic.conversion ?? 0) }
      : null,
    fetched_at: j?.fetched_at ?? new Date().toISOString(),
    cached: Boolean(j?.cached),
  };
}

export default function Ecommerce() {
  const { canAccessGaia, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [period, setPeriod] = useState<typeof PERIODS[number]["key"]>("30d");
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);
  const [lowStockOpen, setLowStockOpen] = useState(false);

  const load = async (force = false, p = period) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const params = new URLSearchParams();
      params.set("period", p);
      if (force) params.set("refresh", "1");
      const url = `https://${projectId}.supabase.co/functions/v1/shopify-stats?${params}`;
      const r = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setStats(normalizeStats(j));
    } catch (e: any) {
      toast.error("Erreur Shopify", { description: e?.message || String(e) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false, period); /* eslint-disable-next-line */ }, [period]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/" replace />;

  const currentPeriodMeta = PERIODS.find((p) => p.key === period)!;

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col">
      <AppHeader
        right={
          <Button variant="outline" size="sm" onClick={() => load(true, period)} disabled={refreshing}>
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

        {/* Period selector */}
        <Card className="p-2 bg-card/60 border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange className="h-4 w-4 text-primary ml-2" />
            <span className="text-xs text-muted-foreground mr-2">Période :</span>
            {PERIODS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={period === p.key ? "default" : "ghost"}
                className={period === p.key ? "" : "text-muted-foreground"}
                onClick={() => setPeriod(p.key)}
                disabled={loading || refreshing}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </Card>

        {loading || !stats ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiTile
                label={`CA ${currentPeriodMeta.kpiLabel}`}
                value={fmtMoney(stats.kpi.ca30, stats.currency)}
                evol={stats.kpi.evolCA}
                sub={`vs ${fmtMoney(stats.kpi.caPrev, stats.currency)}`}
                accent="primary"
              />
              <KpiTile
                label={`Commandes ${currentPeriodMeta.kpiLabel}`}
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
                label="Clients récurrents"
                value={`${(stats.kpi.returningShare ?? 0).toFixed(0)}%`}
                sub={`${stats.customers.returning} / ${stats.customers.new + stats.customers.returning} cmd`}
                accent="primary"
              />
              <KpiTile
                label="Clients période"
                value={String(stats.customers.new + stats.customers.returning)}
                sub={`${stats.customers.new} nouveaux · ${stats.customers.returning} récurrents`}
                accent="secondary"
              />
            </div>

            {stats.traffic && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <KpiTile label="Sessions 7j" value={String(stats.traffic.sessions)} accent="primary" />
                <KpiTile label="Taux de conversion 7j" value={`${stats.traffic.conversion.toFixed(2)}%`} accent="secondary" />
              </div>
            )}

            {/* Monthly chart */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" /> Ventes par mois
                <span className="text-xs text-muted-foreground font-normal">({stats.salesByMonth.length} mois)</span>
              </h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.salesByMonth}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={monthLabel} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => fmtMoney(Number(v), stats.currency)} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--secondary))" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any, _name, item: any) => {
                        const key = item?.dataKey;
                        if (key === "amount") return [fmtMoney(Number(v), stats.currency), "CA"];
                        return [`${Math.round(Number(v))} commandes`, "Commandes"];
                      }}
                      labelFormatter={monthLabel}
                    />
                    <Bar yAxisId="left" dataKey="amount" name="CA" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    <Bar yAxisId="right" dataKey="count" name="Commandes" fill="hsl(var(--secondary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

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
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => fmtMoney(Number(v), stats.currency)} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: any) => [fmtMoney(Number(v), stats.currency), "CA"]}
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
                  <Package className="h-4 w-4 text-primary" /> Top 10 produits ({currentPeriodMeta.kpiLabel})
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
                  <Users className="h-4 w-4 text-primary" /> Dernières commandes
                </h2>
                {stats.latestOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune commande.</p>
                ) : (
                  <div className="space-y-2">
                    {stats.latestOrders.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => setOpenOrder(o)}
                        className="w-full text-left flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 hover:bg-background/70 hover:border-primary/40 transition group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate flex items-center gap-2">
                            {o.name} · {o.customer}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <CustomerBadge n={o.customerOrders} />
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(o.createdAt).toLocaleString("fr-FR")}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className={`text-[10px] ${statusBadge(o.financial)}`}>{o.financial}</Badge>
                          <div className="text-sm font-semibold tabular-nums w-20 text-right">
                            {fmtMoney(o.amount, o.currency)}
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Low stock (collapsed by default) */}
            <Card className="bg-card/60 border-border">
              <button
                type="button"
                onClick={() => setLowStockOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 p-4 sm:p-6 text-left"
              >
                <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Stock faible ({stats.lowStock.length})
                </h2>
                <ChevronRight
                  className={`h-4 w-4 text-muted-foreground transition-transform ${lowStockOpen ? "rotate-90" : ""}`}
                />
              </button>
              {lowStockOpen && (
                <div className="px-4 sm:px-6 pb-4 sm:pb-6">
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
                </div>
              )}
            </Card>


            <StockSyncPanel />
          </>
        )}
      </main>


      {/* Order detail sheet */}
      <Sheet open={!!openOrder} onOpenChange={(o) => !o && setOpenOrder(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-card">
          {openOrder && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-xl">{openOrder.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      navigator.clipboard.writeText(openOrder.name);
                      toast.success("Numéro de commande copié");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </SheetTitle>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <Badge variant="outline" className={`text-[10px] ${statusBadge(openOrder.financial)}`}>{openOrder.financial}</Badge>
                  <Badge variant="outline" className={`text-[10px] ${statusBadge(openOrder.fulfillment)}`}>{openOrder.fulfillment}</Badge>
                  <CustomerBadge n={openOrder.customerOrders} />
                </div>
                <div className="text-xs text-muted-foreground pt-1">
                  {new Date(openOrder.createdAt).toLocaleString("fr-FR")}
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {/* Customer */}
                <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-1.5">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Client</div>
                  <div className="font-medium">{openOrder.customer}</div>
                  {openOrder.customerEmail && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Mail className="h-3 w-3" /> {openOrder.customerEmail}
                    </div>
                  )}
                  {openOrder.customerPhone && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Phone className="h-3 w-3" /> {openOrder.customerPhone}
                    </div>
                  )}
                  {(openOrder.customerCity || openOrder.customerCountry) && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      {[openOrder.customerCity, openOrder.customerCountry].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>

                {/* Line items */}
                <div className="rounded-md border border-border/60 bg-background/40 p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Produits</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/60">
                        <th className="pb-1.5">Article</th>
                        <th className="pb-1.5 text-right">Qté</th>
                        <th className="pb-1.5 text-right">PU</th>
                        <th className="pb-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openOrder.lineItems.map((li, i) => (
                        <tr key={i} className="border-b border-border/30 last:border-0">
                          <td className="py-1.5 pr-2">
                            <div className="font-medium truncate max-w-[220px]">{li.title}</div>
                            {li.variant && li.variant !== "Default Title" && (
                              <div className="text-[11px] text-muted-foreground truncate">{li.variant}</div>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{li.quantity}</td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtMoneyPrecise(li.unitPrice, openOrder.currency)}</td>
                          <td className="py-1.5 text-right tabular-nums font-medium">{fmtMoneyPrecise(li.total, openOrder.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Sous-total</span>
                    <span className="tabular-nums">{fmtMoneyPrecise(openOrder.subtotal, openOrder.currency)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Livraison</span>
                    <span className="tabular-nums">{fmtMoneyPrecise(openOrder.shipping, openOrder.currency)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxes</span>
                    <span className="tabular-nums">{fmtMoneyPrecise(openOrder.tax, openOrder.currency)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-border/60 font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums text-primary">{fmtMoneyPrecise(openOrder.amount, openOrder.currency)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
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

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, RefreshCw, ArrowLeft, ExternalLink, Wrench, AlertTriangle,
  Clock, CheckCircle2, Inbox, Timer, Search, X, Users, Crown, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Ticket = {
  id: number;
  subject: string;
  requester: string;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  subdomain: string;
  kpi: { nouveaux: number; ouverts: number; enAttente: number; resolusSemaine: number; resolusMois: number };
  priority: { urgent: number; high: number; normal: number; low: number };
  tickets: Ticket[];
  avgFirstReplyMinutes: number | null;
  fetched_at: string;
  cached: boolean;
};

type TopClient = {
  rank: number;
  requester_id: number;
  name: string;
  email: string | null;
  total: number;
  ouverts: number;
  en_attente: number;
};
type TopClientsPayload = {
  clients: TopClient[];
  scanned: number;
  truncated: boolean;
  fetched_at: string;
  cached?: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  new: "bg-primary/15 text-primary border-primary/40",
  open: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40",
  hold: "bg-purple-500/15 text-purple-400 border-purple-500/40",
  solved: "bg-secondary/15 text-secondary border-secondary/40",
  closed: "bg-muted text-muted-foreground border-border",
};
const STATUS_LABEL: Record<string, string> = {
  new: "Nouveau", open: "Ouvert", pending: "En attente",
  hold: "Suspendu", solved: "Résolu", closed: "Clos",
};

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-destructive/15 text-destructive border-destructive/40",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  normal: "bg-primary/15 text-primary border-primary/40",
  low: "bg-muted text-muted-foreground border-border",
};
const PRIORITY_LABEL: Record<string, string> = {
  urgent: "Urgent", high: "Haute", normal: "Normale", low: "Basse",
};

type FilterKey = "all" | "new" | "open" | "pending" | "solved" | "closed";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "new", label: "Nouveau" },
  { key: "open", label: "Ouvert" },
  { key: "pending", label: "En attente" },
  { key: "solved", label: "Résolu" },
  { key: "closed", label: "Clos" },
];

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/zendesk-stats`;

async function callFn(params: URLSearchParams) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const r = await fetch(`${FN_URL}?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function KpiTile({ label, value, sub, Icon, accent = "primary" }: {
  label: string; value: string | number; sub?: string; Icon: any; accent?: "primary" | "secondary" | "destructive";
}) {
  const color = accent === "destructive" ? "text-destructive" : accent === "secondary" ? "text-secondary" : "text-primary";
  return (
    <Card className="p-4 bg-card/60 border-border">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase text-muted-foreground tracking-wider">{label}</div>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className={`mt-2 text-3xl font-display font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function TicketRow({ t, onClick, ticketUrl }: {
  t: Ticket; onClick: () => void; ticketUrl: string;
}) {
  return (
    <tr onClick={onClick} className="border-b border-border/40 last:border-0 hover:bg-muted/40 cursor-pointer">
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">#{t.id}</td>
      <td className="py-2 pr-3 max-w-[280px] truncate font-medium text-primary" title={t.subject}>{t.subject}</td>
      <td className="py-2 pr-3 max-w-[160px] truncate">{t.requester}</td>
      <td className="py-2 pr-3">
        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[t.status] || STATUS_STYLE.closed}`}>
          {STATUS_LABEL[t.status] || t.status}
        </Badge>
      </td>
      <td className="py-2 pr-3">
        {t.priority ? (
          <Badge variant="outline" className={`text-[10px] ${PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.low}`}>
            {PRIORITY_LABEL[t.priority] || t.priority}
          </Badge>
        ) : <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(t.created_at).toLocaleDateString("fr-FR")}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(t.updated_at).toLocaleDateString("fr-FR")}
      </td>
      <td className="py-2" onClick={(e) => e.stopPropagation()}>
        <a href={ticketUrl} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary text-xs"
           title="Ouvrir dans Zendesk">
          <ExternalLink className="h-3 w-3" />
        </a>
      </td>
    </tr>
  );
}

export default function Sav() {
  const navigate = useNavigate();
  const { canAccessGaia, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  // Filters + search state
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Ticket[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Top clients
  const [topClients, setTopClients] = useState<TopClientsPayload | null>(null);
  const [loadingTop, setLoadingTop] = useState(true);

  const load = async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const j = await callFn(new URLSearchParams(force ? { refresh: "1" } : {}));
      setStats(j);
    } catch (e: any) {
      toast.error("Erreur Zendesk", { description: e?.message || String(e) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadTop = async (force = false) => {
    setLoadingTop(true);
    try {
      const params = new URLSearchParams({ action: "top_clients" });
      if (force) params.set("refresh", "1");
      const j = await callFn(params);
      setTopClients(j);
    } catch (e: any) {
      toast.error("Top clients", { description: e?.message || String(e) });
    } finally {
      setLoadingTop(false);
    }
  };

  useEffect(() => { load(false); loadTop(false); }, []);

  // Debounced search
  const runSearch = async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const j = await callFn(new URLSearchParams({ action: "search", q }));
      setSearchResults(j.tickets || []);
    } catch (e: any) {
      toast.error("Recherche", { description: e?.message || String(e) });
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(() => runSearch(v), 450);
  };

  const clearSearch = () => {
    setQuery("");
    setSearchResults(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const searchClient = (c: TopClient) => {
    const q = c.email ? `requester:${c.email}` : c.name;
    setQuery(q);
    setFilter("all");
    runSearch(q);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Combined visible tickets: search results override the base list.
  const rawList: Ticket[] = searchResults ?? stats?.tickets ?? [];

  // Client-side filter counts on whatever list is currently loaded.
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: rawList.length, new: 0, open: 0, pending: 0, solved: 0, closed: 0 };
    for (const t of rawList) {
      if (t.status in c) (c as any)[t.status]++;
    }
    return c;
  }, [rawList]);

  const filteredList = useMemo(() => {
    if (filter === "all") return rawList;
    return rawList.filter((t) => t.status === filter);
  }, [rawList, filter]);

  // If filter yields nothing but there's data upstream, propose server search
  const emptyButFilterActive = filter !== "all" && filteredList.length === 0 && rawList.length > 0;

  const applyServerFilter = async () => {
    setSearching(true);
    try {
      const j = await callFn(new URLSearchParams({ action: "search", q: `status:${filter}` }));
      setSearchResults(j.tickets || []);
      setQuery(`status:${filter}`);
    } catch (e: any) {
      toast.error("Recherche", { description: e?.message || String(e) });
    } finally {
      setSearching(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/" replace />;

  const ticketUrl = (id: number) => stats ? `https://${stats.subdomain}.zendesk.com/agent/tickets/${id}` : "#";

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col">
      <AppHeader
        right={
          <Button variant="outline" size="sm" onClick={() => { load(true); loadTop(true); }} disabled={refreshing || loading}>
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
            <h1 className="font-display text-3xl font-bold mt-1 flex items-center gap-2">
              <Wrench className="h-7 w-7 text-primary" />
              <span className="text-primary text-glow-purple">SAV</span>
            </h1>
            <p className="text-sm text-muted-foreground">Tickets, interventions et pièces détachées — piloté par Zendesk.</p>
          </div>
          {stats && (
            <div className="text-xs text-muted-foreground text-right">
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
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiTile label="Nouveaux" value={stats.kpi.nouveaux} Icon={Inbox} accent="primary" />
              <KpiTile label="Ouverts" value={stats.kpi.ouverts} Icon={AlertTriangle} accent="destructive" />
              <KpiTile label="En attente" value={stats.kpi.enAttente} Icon={Clock} accent="primary" />
              <KpiTile label="Résolus (7j)" value={stats.kpi.resolusSemaine} sub={`${stats.kpi.resolusMois} sur 30j`} Icon={CheckCircle2} accent="secondary" />
              <KpiTile
                label="1ère réponse"
                value={stats.avgFirstReplyMinutes != null ? `${stats.avgFirstReplyMinutes} min` : "—"}
                sub="moyenne récente"
                Icon={Timer}
                accent="primary"
              />
            </div>

            {/* Priority breakdown */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <h2 className="font-display text-lg font-semibold mb-4">Répartition par priorité (tickets actifs)</h2>
              <div className="flex flex-wrap gap-2">
                {(["urgent", "high", "normal", "low"] as const).map((p) => (
                  <Badge key={p} variant="outline" className={`${PRIORITY_STYLE[p]} text-sm px-3 py-1.5`}>
                    {PRIORITY_LABEL[p]} · <span className="ml-1 font-bold tabular-nums">{stats.priority[p]}</span>
                  </Badge>
                ))}
              </div>
            </Card>

            {/* Top 10 clients */}
            <Card className="p-4 sm:p-6 bg-gradient-to-br from-secondary/10 via-card/60 to-card/60 border-secondary/30">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/15 text-secondary">
                    <Crown className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-semibold">Top 10 clients SAV</h2>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Volume de tickets sur la période analysée
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => loadTop(true)} disabled={loadingTop}>
                  {loadingTop ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </div>

              {loadingTop && !topClients ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-secondary" /></div>
              ) : !topClients?.clients?.length ? (
                <p className="text-sm text-muted-foreground">Aucune donnée disponible.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {topClients.clients.map((c) => {
                      const enCours = c.ouverts + c.en_attente;
                      return (
                        <button
                          key={c.requester_id}
                          onClick={() => searchClient(c)}
                          className="group flex items-center gap-3 rounded-lg border border-border bg-card/40 hover:bg-muted/40 hover:border-secondary/40 transition p-3 text-left"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary text-xs font-bold tabular-nums">
                            #{c.rank}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate group-hover:text-secondary transition">{c.name}</div>
                            {c.email && (
                              <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                                <Mail className="h-2.5 w-2.5" /> {c.email}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <Badge variant="outline" className="bg-secondary/15 text-secondary border-secondary/40 tabular-nums">
                              {c.total} <Users className="h-3 w-3 ml-1" />
                            </Badge>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {enCours > 0 ? `dont ${enCours} en cours` : "à jour"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {topClients.truncated && (
                    <div className="mt-3 text-[10px] text-muted-foreground italic text-right">
                      Calculé sur les 1000 derniers tickets.
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* Tickets + search + filters */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="font-display text-lg font-semibold">
                  {searchResults ? `Résultats (${filteredList.length})` : "20 derniers tickets"}
                </h2>
              </div>

              {/* Search bar */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearch(query); }}
                  placeholder="Rechercher (numéro #, nom/email de client, mot-clé...)"
                  className="pl-9 pr-24 bg-background/50"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {query && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearSearch}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Status filters */}
              <div className="flex flex-wrap gap-2 mb-4">
                {FILTERS.map((f) => {
                  const active = filter === f.key;
                  const count = counts[f.key];
                  return (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      <span>{f.label}</span>
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>

              {emptyButFilterActive && (
                <div className="mb-4 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    Aucun ticket « {STATUS_LABEL[filter]} » dans la liste courante.
                  </span>
                  <Button variant="outline" size="sm" onClick={applyServerFilter} disabled={searching}>
                    Rechercher tous les « {STATUS_LABEL[filter]} »
                  </Button>
                </div>
              )}

              {filteredList.length === 0 && !emptyButFilterActive ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Search className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
                  <p className="text-sm text-muted-foreground">Aucun ticket trouvé.</p>
                  {query && (
                    <Button variant="ghost" size="sm" onClick={clearSearch} className="mt-2">
                      Réinitialiser la recherche
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                        <th className="pb-2 pr-3">#</th>
                        <th className="pb-2 pr-3">Sujet</th>
                        <th className="pb-2 pr-3">Demandeur</th>
                        <th className="pb-2 pr-3">Statut</th>
                        <th className="pb-2 pr-3">Priorité</th>
                        <th className="pb-2 pr-3 whitespace-nowrap">Créé</th>
                        <th className="pb-2 pr-3 whitespace-nowrap">MAJ</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredList.map((t) => (
                        <TicketRow
                          key={t.id}
                          t={t}
                          ticketUrl={ticketUrl(t.id)}
                          onClick={() => navigate(`/sav/ticket/${t.id}`)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

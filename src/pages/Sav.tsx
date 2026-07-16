import { useEffect, useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, RefreshCw, ArrowLeft, ExternalLink, Wrench, AlertTriangle,
  Clock, CheckCircle2, Inbox, Timer,
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

export default function Sav() {
  const navigate = useNavigate();
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
      const url = `https://${projectId}.supabase.co/functions/v1/zendesk-stats${force ? "?refresh=1" : ""}`;
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setStats(j);
    } catch (e: any) {
      toast.error("Erreur Zendesk", { description: e?.message || String(e) });
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

  const ticketUrl = (id: number) => stats ? `https://${stats.subdomain}.zendesk.com/agent/tickets/${id}` : "#";

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col">
      <AppHeader
        right={
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing || loading}>
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

            {/* Tickets */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <h2 className="font-display text-lg font-semibold mb-4">20 derniers tickets</h2>
              {stats.tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun ticket.</p>
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
                      {stats.tickets.map((t) => (
                        <tr key={t.id}
                            onClick={() => navigate(`/sav/ticket/${t.id}`)}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/40 cursor-pointer">
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
                            <a href={ticketUrl(t.id)} target="_blank" rel="noreferrer"
                               className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary text-xs"
                               title="Ouvrir dans Zendesk">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                        </tr>
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

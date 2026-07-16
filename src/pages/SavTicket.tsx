import { useEffect, useState } from "react";
import { Navigate, Link, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, ArrowLeft, ExternalLink, Wrench, Sparkles, RefreshCw,
  Download, User, Headset, AlertCircle, Wrench as WrenchIcon, Truck, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Attachment = {
  id: number; file_name: string; content_url: string;
  content_type: string; size: number;
  thumbnails: { content_url: string; content_type: string }[];
};
type Comment = {
  id: number; author_id: number; author_name: string; author_role: string;
  public: boolean; created_at: string; plain_body: string; html_body: string;
  attachments: Attachment[];
};
type Ticket = {
  id: number; subject: string; description: string; status: string; priority: string | null;
  created_at: string; updated_at: string; requester_id: number;
  requester_name: string; requester_email: string | null;
  assignee_name: string | null; tags: string[];
};
type SideEvent = {
  id: number | string; created_at: string; author_name: string; author_email: string | null;
  to: string[]; cc: string[]; subject: string; body: string;
};
type SideConversation = {
  id: number | string; subject: string; state: string; created_at: string; updated_at: string;
  participants: { name: string; email: string | null }[];
  events: SideEvent[];
};
type TicketPayload = { ticket: Ticket; comments: Comment[]; side_conversations?: SideConversation[] };
type Resume = {
  probleme_rencontre: string; diagnostic: string; resolution: string;
  pieces_detachees: string[]; machine_concernee: string;
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

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function proxyUrl(url: string, token: string | undefined) {
  const p = new URLSearchParams({ action: "attachment", url });
  return `${FN_URL}?${p.toString()}${token ? `&_t=${encodeURIComponent(token.slice(0, 8))}` : ""}`;
}

function isImage(type: string) {
  return type?.startsWith("image/");
}

function AttachmentTile({ a, token }: { a: Attachment; token: string | undefined }) {
  const src = proxyUrl(a.content_url, token);
  const thumb = a.thumbnails?.[0]?.content_url ? proxyUrl(a.thumbnails[0].content_url, token) : src;
  if (isImage(a.content_type)) {
    return (
      <a href={src} target="_blank" rel="noreferrer"
         className="group relative block h-24 w-24 overflow-hidden rounded-lg border border-border bg-muted">
        <img src={thumb} alt={a.file_name} className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-end p-1">
          <span className="text-[9px] text-white opacity-0 group-hover:opacity-100 truncate">{a.file_name}</span>
        </div>
      </a>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs hover:bg-muted">
      <Download className="h-3.5 w-3.5 text-primary" />
      <span className="truncate max-w-[180px]" title={a.file_name}>{a.file_name}</span>
      <span className="text-muted-foreground">{fmtSize(a.size)}</span>
    </a>
  );
}

function ResumeCard({ id }: { id: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [cached, setCached] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const j = await callFn(new URLSearchParams({ action: "resume", id }));
      setResume(j.resume); setCached(Boolean(j.cached));
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  return (
    <Card className="p-4 sm:p-6 bg-gradient-to-br from-primary/10 via-card/60 to-card/60 border-primary/30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">Résumé copilote</h2>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Analyse automatique {cached && "· cache"}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-destructive">Impossible de générer le résumé</div>
            <div className="text-xs text-muted-foreground break-words mt-1">{error}</div>
            <Button variant="outline" size="sm" onClick={load} className="mt-3">Réessayer</Button>
          </div>
        </div>
      )}

      {resume && !loading && !error && (
        <div className="space-y-4 text-sm">
          {resume.machine_concernee && (
            <div className="flex items-center gap-2 text-xs">
              <WrenchIcon className="h-3.5 w-3.5 text-secondary" />
              <span className="text-muted-foreground">Machine :</span>
              <span className="font-medium">{resume.machine_concernee}</span>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">Problème</div>
            <p className="text-foreground/90 leading-relaxed">{resume.probleme_rencontre}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">Diagnostic</div>
            <p className="text-foreground/90 leading-relaxed">{resume.diagnostic}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">Résolution</div>
            <p className="text-foreground/90 leading-relaxed">{resume.resolution}</p>
          </div>
          {resume.pieces_detachees?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-2">Pièces détachées</div>
              <div className="flex flex-wrap gap-2">
                {resume.pieces_detachees.map((p, i) => (
                  <Badge key={i} variant="outline" className="bg-secondary/15 text-secondary border-secondary/40">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function SavTicket() {
  const { canAccessGaia, isLoading: authLoading } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TicketPayload | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [subdomain, setSubdomain] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    callFn(new URLSearchParams({ action: "ticket", id }))
      .then((j) => {
        setData(j);
        // Fetch subdomain lazily from stats cache
        callFn(new URLSearchParams({ action: "stats" }))
          .then((s) => setSubdomain(s.subdomain || ""))
          .catch(() => {});
      })
      .catch((e: any) => toast.error("Erreur", { description: e?.message || String(e) }))
      .finally(() => setLoading(false));
  }, [id]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/" replace />;

  const t = data?.ticket;

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex flex-col">
      <AppHeader
        right={
          subdomain && t && (
            <a href={`https://${subdomain}.zendesk.com/agent/tickets/${t.id}`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-2" /> Ouvrir dans Zendesk
              </Button>
            </a>
          )
        }
      />
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <Link to="/sav" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour aux tickets
        </Link>

        {loading || !t ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" /> Ticket #{t.id}
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold mt-1">{t.subject}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className={STATUS_STYLE[t.status] || STATUS_STYLE.closed}>
                  {STATUS_LABEL[t.status] || t.status}
                </Badge>
                {t.priority && (
                  <Badge variant="outline" className={PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.low}>
                    {PRIORITY_LABEL[t.priority] || t.priority}
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  <User className="h-3 w-3 inline mr-1" />
                  {t.requester_name}{t.requester_email ? ` · ${t.requester_email}` : ""}
                </span>
                <span className="text-muted-foreground">
                  Créé le {new Date(t.created_at).toLocaleString("fr-FR")}
                </span>
                <span className="text-muted-foreground">
                  MAJ {new Date(t.updated_at).toLocaleString("fr-FR")}
                </span>
              </div>
            </div>

            {/* AI resume */}
            <ResumeCard id={String(t.id)} />

            {/* Conversation */}
            <Card className="p-4 sm:p-6 bg-card/60 border-border">
              <h2 className="font-display text-lg font-semibold mb-4">Fil de conversation ({data!.comments.length})</h2>
              <div className="space-y-4">
                {data!.comments.map((c) => {
                  const isClient = c.author_role === "end-user";
                  return (
                    <div key={c.id} className={`flex gap-3 ${isClient ? "" : "flex-row-reverse"}`}>
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        isClient ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"
                      }`}>
                        {isClient ? <User className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
                      </div>
                      <div className={`flex-1 min-w-0 rounded-2xl border p-4 ${
                        isClient
                          ? "border-secondary/30 bg-secondary/5"
                          : "border-primary/30 bg-primary/5"
                      }`}>
                        <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                          <span className="font-medium">{c.author_name}</span>
                          <Badge variant="outline" className="text-[9px] uppercase">
                            {isClient ? "Client" : "Agent"}
                          </Badge>
                          {!c.public && (
                            <Badge variant="outline" className="text-[9px] uppercase bg-yellow-500/15 text-yellow-500 border-yellow-500/40">
                              Note interne
                            </Badge>
                          )}
                          <span className="text-muted-foreground">
                            {new Date(c.created_at).toLocaleString("fr-FR")}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed break-words">
                          {c.plain_body}
                        </div>
                        {c.attachments.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {c.attachments.map((a) => (
                              <AttachmentTile key={a.id} a={a} token={token} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

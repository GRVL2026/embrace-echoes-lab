import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Database, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { GaiaDashboard } from "@/components/admin/GaiaDashboard";

type TokenStep = {
  ok: boolean;
  http_status?: number;
  duration_ms: number;
  error?: string;
  preview?: string;
};

type FeedResult = {
  name: string;
  url: string;
  ok: boolean;
  http_status?: number;
  duration_ms: number;
  error?: string;
  format?: "json" | "xml" | "text";
  columns?: string[];
  sample?: any[];
  preview?: string;
};

type Diagnostic = {
  token_step: TokenStep;
  feeds: FeedResult[];
};

type SyncSummary = {
  feed: string;
  rows: number;
  ok: boolean;
  error?: string;
  duration_ms: number;
};

type SyncLogRow = {
  feed: string;
  rows_loaded: number | null;
  ok: boolean;
  error: string | null;
  finished_at: string | null;
};

export default function AdminGaia() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [summary, setSummary] = useState<SyncSummary[] | null>(null);
  const [lastLogs, setLastLogs] = useState<SyncLogRow[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, SyncSummary & { status: "pending" | "running" | "done" }>>({});

  const FEEDS = [
    "BD-Clients",
    "BD-Ventes",
    "BD-Historique",
    "BD-Commandes",
    "BD-Stock",
  ] as const;

  const loadLogs = async () => {
    const { data } = await (supabase as any)
      .from("gaia_sync_log")
      .select("feed,rows_loaded,ok,error,finished_at")
      .order("finished_at", { ascending: false })
      .limit(50);
    if (!data) return;
    // keep only latest per feed
    const map = new Map<string, SyncLogRow>();
    for (const r of data as SyncLogRow[]) {
      if (!map.has(r.feed)) map.set(r.feed, r);
    }
    setLastLogs(Array.from(map.values()));
  };

  useEffect(() => {
    if (isAdmin) loadLogs();
  }, [isAdmin]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/dossiers" replace />;

  const runDiscover = async () => {
    setRunning(true);
    setGlobalError(null);
    setDiag(null);
    try {
      const { data, error } = await supabase.functions.invoke("cegid-sync", {
        body: { action: "discover" },
      });
      if (error) throw error;
      const d = data as Diagnostic | { error?: string };
      if ((d as any)?.error && !(d as any)?.token_step) throw new Error((d as any).error);
      setDiag(d as Diagnostic);
      toast({ title: "Test Cegid terminé", description: "Voir le diagnostic ci-dessous." });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setGlobalError(msg);
      toast({ title: "Erreur", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };


  const runSync = async () => {
    setSyncing(true);
    setGlobalError(null);
    setSummary(null);
    const initial: Record<string, SyncSummary & { status: "pending" | "running" | "done" }> = {};
    for (const f of FEEDS) {
      initial[f] = { feed: f, rows: 0, ok: false, duration_ms: 0, status: "pending" };
    }
    setProgress(initial);

    const results: SyncSummary[] = [];
    for (const feed of FEEDS) {
      setProgress((p) => ({ ...p, [feed]: { ...p[feed], status: "running" } }));
      try {
        const { data, error } = await supabase.functions.invoke("cegid-sync", {
          body: { action: "sync", feed },
        });
        if (error) throw error;
        const d = data as { token_step?: TokenStep; summary?: SyncSummary[]; error?: string };
        if (d?.token_step && !d.token_step.ok) {
          const err = d.token_step.error ?? "Échec ticket OAuth";
          const s: SyncSummary = { feed, rows: 0, ok: false, error: err, duration_ms: d.token_step.duration_ms ?? 0 };
          results.push(s);
          setProgress((p) => ({ ...p, [feed]: { ...s, status: "done" } }));
          continue;
        }
        const s = d?.summary?.[0] ?? { feed, rows: 0, ok: false, error: "Réponse vide", duration_ms: 0 };
        results.push(s);
        setProgress((p) => ({ ...p, [feed]: { ...s, status: "done" } }));
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        const s: SyncSummary = { feed, rows: 0, ok: false, error: msg, duration_ms: 0 };
        results.push(s);
        setProgress((p) => ({ ...p, [feed]: { ...s, status: "done" } }));
      }
    }

    setSummary(results);
    await loadLogs();
    const okCount = results.filter((r) => r.ok).length;
    const totalRows = results.reduce((n, s) => n + (s.ok ? s.rows : 0), 0);
    toast({
      title: "Synchronisation terminée",
      description: `${okCount}/${results.length} flux OK · ${totalRows} lignes chargées.`,
      variant: okCount === results.length ? "default" : "destructive",
    });
    setSyncing(false);
  };



  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-6">
        <div className="flex items-center gap-3">
          <Link to="/dossiers" className="flex items-center gap-3">
            <img src={logoImg} alt="Arcade Planner logo" className="h-7 w-auto object-contain" />
            <h1 className="font-display text-xl font-bold tracking-tight">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">Planner</span>
            </h1>
          </Link>
          <nav className="ml-4 flex items-center gap-1">
            <Link
              to="/dossiers"
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              Dossiers
            </Link>
            <Link
              to="/planner"
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              Arcade Planner
            </Link>
            <Link
              to="/admin"
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"
            >
              <Shield className="h-3 w-3" /> Admin
            </Link>
            <Link
              to="/admin/gaia"
              className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium inline-flex items-center gap-1"
            >
              <Database className="h-3 w-3" /> Gaia
            </Link>
          </nav>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold">Dashboard Gaia</h2>
            <p className="text-sm text-muted-foreground">
              Diagnostic de connexion aux flux OData Cegid XRP Flex.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runDiscover} disabled={running || syncing}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Test en cours…
                </>
              ) : (
                <>Tester la connexion Cegid</>
              )}
            </Button>
            <Button onClick={runSync} disabled={running || syncing}>
              {syncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Synchronisation… (1-2 min)
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Synchroniser les données
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Résumé des dernières synchros par flux */}
        {lastLogs.length > 0 && (
          <div className="mb-6 rounded-lg border border-border bg-card/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">Dernière synchronisation</h3>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lastLogs.map((l) => (
                <div
                  key={l.feed}
                  className="flex items-center justify-between rounded border border-border/60 bg-background/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {l.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-secondary" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-medium">{l.feed}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{l.rows_loaded ?? 0} lignes</span>
                    {l.finished_at && (
                      <span>· {new Date(l.finished_at).toLocaleString("fr-FR")}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progression en direct */}
        {(syncing || Object.keys(progress).length > 0) && (
          <div className="mb-6 rounded-lg border border-border bg-card/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Loader2 className={`h-4 w-4 text-primary ${syncing ? "animate-spin" : ""}`} />
              <h3 className="font-display text-lg font-semibold">Progression</h3>
            </div>
            <div className="space-y-2">
              {FEEDS.map((feed) => {
                const p = progress[feed];
                const status = p?.status ?? "pending";
                return (
                  <div
                    key={feed}
                    className="flex items-center justify-between rounded border border-border/60 bg-background/40 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {status === "pending" && (
                        <span className="h-4 w-4 rounded-full border border-muted-foreground/40" />
                      )}
                      {status === "running" && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      )}
                      {status === "done" && p?.ok && (
                        <CheckCircle2 className="h-4 w-4 text-secondary" />
                      )}
                      {status === "done" && p && !p.ok && (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className="font-medium">{feed}</span>
                      {status === "done" && p && (
                        <Badge variant="outline">{p.duration_ms} ms</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {status === "pending" && (
                        <span className="text-muted-foreground">En attente…</span>
                      )}
                      {status === "running" && (
                        <span className="text-primary">Synchronisation en cours…</span>
                      )}
                      {status === "done" && p?.ok && (
                        <span className="text-secondary">OK · {p.rows} lignes</span>
                      )}
                      {status === "done" && p && !p.ok && (
                        <span className="max-w-md truncate text-destructive" title={p.error}>
                          {p.error ?? "Erreur"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Résumé de la synchro qui vient de tourner */}
        {summary && summary.length > 0 && (
          <div className="mb-6 rounded-lg border border-border bg-card/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <h3 className="font-display text-lg font-semibold">Résultat de la synchronisation</h3>
            </div>
            <div className="space-y-2">
              {summary.map((s) => (
                <div
                  key={s.feed}
                  className="flex items-center justify-between rounded border border-border/60 bg-background/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {s.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-secondary" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-medium">{s.feed}</span>
                    <Badge variant="outline">{s.duration_ms} ms</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{s.rows} lignes</span>
                    {s.error && (
                      <span className="max-w-md truncate text-destructive" title={s.error}>
                        {s.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {globalError && (
          <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {globalError}
          </div>
        )}

        {diag && (
          <div className="space-y-4">
            {/* Étape ticket OAuth */}
            <div className="rounded-lg border border-border bg-card/40 p-4">
              <div className="mb-3 flex items-center gap-2">
                {diag.token_step.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-secondary" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <h3 className="font-display text-lg font-semibold">Ticket OAuth</h3>
                <Badge variant={diag.token_step.ok ? "default" : "destructive"}>
                  HTTP {diag.token_step.http_status ?? "—"}
                </Badge>
                <Badge variant="outline">{diag.token_step.duration_ms} ms</Badge>
              </div>
              {diag.token_step.error && (
                <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  {diag.token_step.error}
                </div>
              )}
              {diag.token_step.preview && (
                <div className="mt-2">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">Aperçu réponse</div>
                  <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                    {diag.token_step.preview}
                  </pre>
                </div>
              )}
            </div>

            {/* Flux OData */}
            {diag.feeds.map((r) => (
              <div
                key={r.name}
                className="rounded-lg border border-border bg-card/40 p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  {r.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-secondary" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <h3 className="font-display text-lg font-semibold">{r.name}</h3>
                  <Badge variant={r.ok ? "default" : "destructive"}>
                    HTTP {r.http_status ?? "—"}
                  </Badge>
                  <Badge variant="outline">{r.duration_ms} ms</Badge>
                  {r.format && <Badge variant="outline">{r.format}</Badge>}
                </div>

                <div className="mb-2 truncate text-xs text-muted-foreground">
                  {r.url}
                </div>

                {r.error && (
                  <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                    {r.error}
                  </div>
                )}

                {r.columns && r.columns.length > 0 && (
                  <div className="mb-3 mt-2">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      Colonnes ({r.columns.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.columns.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-muted px-2 py-0.5 text-xs font-mono"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {r.sample && r.sample.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      Échantillon ({r.sample.length})
                    </div>
                    <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-3 text-xs">
                      {JSON.stringify(r.sample, null, 2)}
                    </pre>
                  </div>
                )}

                {r.preview && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      Aperçu brut
                    </div>
                    <pre className="max-h-72 overflow-auto rounded bg-muted/50 p-3 text-xs whitespace-pre-wrap">
                      {r.preview}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!diag && !globalError && !running && (
          <div className="rounded-lg border border-dashed border-border bg-card/20 p-8 text-center text-sm text-muted-foreground">
            Cliquez sur « Tester la connexion Cegid » pour découvrir les flux OData.
          </div>
        )}

      </main>
    </div>
  );
}

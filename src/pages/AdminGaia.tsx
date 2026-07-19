import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Database, CheckCircle2, XCircle, RefreshCw, Radar } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { GaiaDashboard } from "@/components/admin/GaiaDashboard";
import { GaiaMagasin } from "@/components/admin/GaiaMagasin";
import { GaiaCopilot } from "@/components/admin/GaiaCopilot";
import { MobileNav } from "@/components/MobileNav";
import { AppTopNav } from "@/components/AppTopNav";

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
  http_status?: number;
  response_body?: string;
  done?: boolean;
  next_skip?: number;
  total_rows?: number;
  started_at?: string;
};

type SyncLogRow = {
  feed: string;
  rows_loaded: number | null;
  ok: boolean;
  error: string | null;
  finished_at: string | null;
};

export default function AdminGaia() {
  const { isAdmin, canAccessGaia, canAccessDashboard, copilotEnabled, loading: authLoading } = useAuth();
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

  type FeedName = (typeof FEEDS)[number];

  const readFunctionError = async (error: unknown): Promise<Pick<SyncSummary, "error" | "http_status" | "response_body">> => {
    if (error instanceof FunctionsHttpError) {
      const response = error.context;
      let body = "";
      try {
        const json = await response.clone().json();
        body = JSON.stringify(json, null, 2);
      } catch {
        try {
          body = await response.text();
        } catch {
          body = "Corps de réponse illisible";
        }
      }
      return {
        http_status: response.status,
        response_body: body,
        error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  };

  const syncOneFeed = async (feed: FeedName): Promise<SyncSummary> => {
    const started = Date.now();
    let skip = 0;
    let totalRows = 0;
    let startedAt: string | undefined;

    // La fonction traite au plus trois pages par requête. Le front reprend le curseur
    // jusqu'à la fin pour éviter le timeout serveur de 150 secondes.
    for (let chunk = 0; chunk < 200; chunk++) {
      try {
        const { data, error } = await supabase.functions.invoke("cegid-sync", {
          body: {
            action: "sync",
            feed,
            skip,
            total_rows: totalRows,
            started_at: startedAt,
            reset: chunk === 0,
          },
        });
        if (error) throw error;
        const d = data as { token_step?: TokenStep; summary?: SyncSummary[]; error?: string };
        if (d?.token_step && !d.token_step.ok) {
          return {
            feed,
            rows: totalRows,
            ok: false,
            error: d.token_step.error ?? "Échec ticket OAuth",
            duration_ms: Date.now() - started,
          };
        }

        const part = d?.summary?.[0];
        if (!part) {
          return {
            feed,
            rows: totalRows,
            ok: false,
            error: d?.error ?? "Réponse vide",
            response_body: d ? JSON.stringify(d, null, 2) : undefined,
            duration_ms: Date.now() - started,
          };
        }
        if (!part.ok) {
          return { ...part, feed, rows: part.total_rows ?? totalRows, duration_ms: Date.now() - started };
        }

        totalRows = part.total_rows ?? totalRows + part.rows;
        startedAt = part.started_at ?? startedAt;
        setProgress((current) => ({
          ...current,
          [feed]: {
            feed,
            rows: totalRows,
            ok: false,
            duration_ms: Date.now() - started,
            status: "running",
          },
        }));

        if (part.done) {
          return { ...part, feed, rows: totalRows, total_rows: totalRows, duration_ms: Date.now() - started };
        }
        if (typeof part.next_skip !== "number" || part.next_skip <= skip) {
          return {
            feed,
            rows: totalRows,
            ok: false,
            error: "La pagination Cegid n'a pas avancé.",
            duration_ms: Date.now() - started,
          };
        }
        skip = part.next_skip;
      } catch (error: unknown) {
        const detail = await readFunctionError(error);
        return { feed, rows: totalRows, ok: false, duration_ms: Date.now() - started, ...detail };
      }
    }

    return {
      feed,
      rows: totalRows,
      ok: false,
      error: "Limite de sécurité de pagination atteinte.",
      duration_ms: Date.now() - started,
    };
  };

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
  if (!canAccessDashboard) return <Navigate to="/dossiers" replace />;

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
      const result = await syncOneFeed(feed);
      results.push(result);
      setProgress((p) => ({ ...p, [feed]: { ...result, status: "done" } }));
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

  const retryFeed = async (feed: FeedName) => {
    setProgress((p) => ({
      ...p,
      [feed]: { feed, rows: 0, ok: false, duration_ms: 0, status: "running" },
    }));
    const result = await syncOneFeed(feed);
    setProgress((p) => ({ ...p, [feed]: { ...result, status: "done" } }));
    setSummary((current) => {
      const next = current ? [...current] : [];
      const index = next.findIndex((item) => item.feed === feed);
      if (index >= 0) next[index] = result;
      else next.push(result);
      return next;
    });
    await loadLogs();
    toast({
      title: result.ok ? `${feed} synchronisé` : `Échec de ${feed}`,
      description: result.ok ? `${result.rows} lignes chargées.` : result.error,
      variant: result.ok ? "default" : "destructive",
    });
  };



  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to={isAdmin ? "/" : "/dossiers"} className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
          <AppTopNav />
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-display text-xl sm:text-2xl font-bold">Dashboard — Avranches Automatic</h2>
          <p className="text-sm text-muted-foreground">
            Pilotage financier et synchronisation des flux Cegid XRP Flex.
          </p>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="dashboard">AA</TabsTrigger>
            <TabsTrigger value="magasin">Magasin</TabsTrigger>
            {(canAccessGaia && copilotEnabled) && <TabsTrigger value="copilot">Copilote</TabsTrigger>}
            {isAdmin && <TabsTrigger value="sync">Synchronisation</TabsTrigger>}
          </TabsList>

          {(canAccessGaia && copilotEnabled) && (
            <TabsContent value="copilot">
              <GaiaCopilot />
            </TabsContent>
          )}

          <TabsContent value="dashboard">
            <GaiaDashboard onGoToSync={() => {
              const trigger = document.querySelector<HTMLButtonElement>('[role="tab"][value="sync"]');
              trigger?.click();
            }} />
          </TabsContent>

          <TabsContent value="magasin">
            <GaiaMagasin />
          </TabsContent>


          {isAdmin && (
          <TabsContent value="sync">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h3 className="font-display text-xl font-bold">Synchronisation Cegid</h3>
            <p className="text-sm text-muted-foreground">
              Diagnostic de connexion aux flux OData Cegid XRP Flex.
            </p>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
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
          ) : (
            <div className="text-xs text-muted-foreground italic">
              Lecture seule — les synchronisations sont réservées aux administrateurs.
            </div>
          )}
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
                    className="rounded border border-border/60 bg-background/40 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {status === "pending" && <span className="h-4 w-4 rounded-full border border-muted-foreground/40" />}
                        {status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                        {status === "done" && p?.ok && <CheckCircle2 className="h-4 w-4 text-secondary" />}
                        {status === "done" && p && !p.ok && <XCircle className="h-4 w-4 text-destructive" />}
                        <span className="font-medium">{feed}</span>
                        {status === "done" && p && <Badge variant="outline">{p.duration_ms} ms</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {status === "pending" && <span className="text-muted-foreground">En attente…</span>}
                        {status === "running" && <span className="text-primary">Synchronisation en cours… {p?.rows ? `· ${p.rows} lignes` : ""}</span>}
                        {status === "done" && p?.ok && <span className="text-secondary">OK · {p.rows} lignes</span>}
                        {status === "done" && p && !p.ok && <span className="text-destructive">{p.error ?? "Erreur"}</span>}
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => retryFeed(feed)}
                            disabled={syncing || running || status === "running"}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" /> Relancer
                          </Button>
                        )}
                      </div>
                    </div>
                    {status === "done" && p && !p.ok && (p.http_status || p.response_body) && (
                      <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                        <div className="mb-2 font-semibold">Statut HTTP : {p.http_status ?? "indisponible"}</div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{p.response_body || "Corps de réponse vide"}</pre>
                      </div>
                    )}
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

          </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}

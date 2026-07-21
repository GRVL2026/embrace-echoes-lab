import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { AppTopNav } from "@/components/AppTopNav";
import logoImg from "@/assets/logo.png";
import {
  Building2,
  Loader2,
  Play,
  Pause,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";

type EntrepriseRow = {
  code_client: string;
  siren: string | null;
  denomination: string | null;
  forme_juridique: string | null;
  date_creation: string | null;
  effectif_tranche: string | null;
  adresse_siege: string | null;
  etat_administratif: string | null;
  procedure_collective: boolean;
  match_statut: "auto" | "a_valider" | "valide" | "introuvable";
  candidats: any[] | null;
  maj: string;
};

export default function AdminEntreprises() {
  const { isAdmin, isDirection, loading } = useAuth();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; passes: number; done: boolean }>({
    processed: 0,
    passes: 0,
    done: false,
  });
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [search, setSearch] = useState("");

  const { data: stats } = useQuery({
    queryKey: ["entreprises-stats"],
    enabled: isDirection,
    queryFn: async () => {
      const { data, error } = await supabase.from("gaia_entreprises").select("match_statut, procedure_collective, etat_administratif");
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return {
        total: rows.length,
        auto: rows.filter((r) => r.match_statut === "auto").length,
        valide: rows.filter((r) => r.match_statut === "valide").length,
        a_valider: rows.filter((r) => r.match_statut === "a_valider").length,
        introuvable: rows.filter((r) => r.match_statut === "introuvable").length,
        procedures: rows.filter((r) => r.procedure_collective).length,
        cessees: rows.filter((r) => r.etat_administratif === "C").length,
      };
    },
    refetchInterval: running ? 3000 : false,
  });

  const { data: validationRows } = useQuery({
    queryKey: ["entreprises-a-valider", search],
    enabled: isDirection,
    queryFn: async () => {
      let q = supabase.from("gaia_entreprises").select("*").eq("match_statut", "a_valider").order("code_client");
      if (search.trim()) q = q.ilike("denomination", `%${search.trim()}%`);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return (data ?? []) as EntrepriseRow[];
    },
    refetchInterval: running ? 5000 : false,
  });

  const runEnrichmentLoop = async () => {
    setRunning(true);
    setStopRequested(false);
    setProgress({ processed: 0, passes: 0, done: false });
    try {
      let processedTotal = 0;
      let passes = 0;
      // Guard : max 500 passes = 20k clients pour éviter boucle infinie
      while (passes < 500) {
        if (stopRequested) break;
        const { data, error } = await supabase.functions.invoke("gaia-entreprises", { body: { action: "enrich-batch" } });
        if (error) throw new Error(error.message);
        const r = (data ?? {}) as any;
        passes++;
        processedTotal += Number(r.processed ?? 0);
        setProgress({ processed: processedTotal, passes, done: !!r.done });
        qc.invalidateQueries({ queryKey: ["entreprises-stats"] });
        if (r.done) break;
      }
      toast({ title: "Enrichissement terminé", description: `${processedTotal} clients traités en ${passes} passes.` });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["entreprises-a-valider"] });
    }
  };

  const runRefresh = async () => {
    setRefreshBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("gaia-entreprises", { body: { action: "refresh" } });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as any;
      toast({ title: "Refresh terminé", description: `${r.refreshed}/${r.checked} SIREN vérifiés · ${r.procedures} en procédure collective, ${r.cessees} cessées.` });
      qc.invalidateQueries({ queryKey: ["entreprises-stats"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setRefreshBusy(false);
    }
  };

  const validate = async (code: string, siren: string | null) => {
    try {
      const { data, error } = await supabase.functions.invoke("gaia-entreprises", {
        body: { action: "validate", code_client: code, siren },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data.error || "Validation impossible");
      toast({ title: siren ? "Rapprochement validé" : "Marqué introuvable" });
      qc.invalidateQueries({ queryKey: ["entreprises-a-valider"] });
      qc.invalidateQueries({ queryKey: ["entreprises-stats"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }
  if (!isDirection && !isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
          <AppTopNav />
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold">Entreprises — enrichissement légal</h2>
            <p className="text-xs text-muted-foreground">
              Source : recherche-entreprises.api.gouv.fr (données publiques INSEE, sans clé). Réservé direction / admin.
            </p>
          </div>
        </div>

        {/* Statistiques */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Rattachés</div>
            <div className="font-display text-2xl font-bold">{(stats?.auto ?? 0) + (stats?.valide ?? 0)}</div>
            <div className="text-[11px] text-muted-foreground">{stats?.auto ?? 0} auto · {stats?.valide ?? 0} validés</div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">À valider</div>
            <div className="font-display text-2xl font-bold text-amber-500">{stats?.a_valider ?? 0}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Introuvables</div>
            <div className="font-display text-2xl font-bold text-muted-foreground">{stats?.introuvable ?? 0}</div>
          </Card>
          <Card className="p-3 border-destructive/40">
            <div className="text-[10px] uppercase text-muted-foreground">Alertes</div>
            <div className="font-display text-2xl font-bold text-destructive">{(stats?.procedures ?? 0) + (stats?.cessees ?? 0)}</div>
            <div className="text-[11px] text-muted-foreground">{stats?.procedures ?? 0} proc. coll. · {stats?.cessees ?? 0} cessées</div>
          </Card>
        </div>

        {/* Actions */}
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <Button onClick={runEnrichmentLoop} className="gap-2">
                <Play className="h-4 w-4" /> Lancer l'enrichissement
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setStopRequested(true)} className="gap-2">
                <Pause className="h-4 w-4" /> Arrêter après la passe en cours
              </Button>
            )}
            <Button variant="outline" onClick={runRefresh} disabled={refreshBusy} className="gap-2">
              {refreshBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Rafraîchir les états (SIREN déjà rattachés)
            </Button>
          </div>
          {(running || progress.processed > 0) && (
            <div className="text-xs text-muted-foreground">
              {running && <Loader2 className="inline h-3 w-3 animate-spin mr-1" />}
              {progress.processed} clients traités · {progress.passes} passes
              {progress.done && <span className="ml-2 text-secondary inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> tour de la base terminé</span>}
              {stopRequested && running && <span className="ml-2 text-amber-500">arrêt en cours…</span>}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            Un rafraîchissement automatique est planifié chaque lundi 02:00 UTC (état administratif + procédure collective).
            <br/>
            Étage 2 (bilans via API Pappers) : non connecté pour le moment — sera disponible dans une prochaine version.
          </div>
        </Card>

        {/* À valider */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider">
                À valider ({validationRows?.length ?? 0})
              </h3>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Chercher un client…"
                className="pl-7 h-8 w-56 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {(!validationRows || validationRows.length === 0) ? (
            <div className="rounded border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              Aucun rapprochement en attente.
            </div>
          ) : (
            <div className="space-y-3">
              {validationRows.map((row) => (
                <ValidationCard key={row.code_client} row={row} onValidate={validate} />
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function ValidationCard({ row, onValidate }: { row: EntrepriseRow; onValidate: (code: string, siren: string | null) => void }) {
  const candidats = Array.isArray(row.candidats) ? row.candidats : [];
  return (
    <div className="rounded border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{row.code_client}</div>
          <div className="font-semibold truncate">{row.denomination ?? "—"}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onValidate(row.code_client, null)}>
          Aucun ne correspond
        </Button>
      </div>
      <div className="mt-2 grid gap-2">
        {candidats.length === 0 ? (
          <div className="text-xs text-muted-foreground">Aucun candidat retourné.</div>
        ) : candidats.map((c: any, i: number) => (
          <button
            key={i}
            className="text-left rounded border border-border/60 p-2 hover:border-primary/60 transition-colors"
            onClick={() => onValidate(row.code_client, c.siren)}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{c.nom || "—"}</div>
                <div className="text-[11px] text-muted-foreground">
                  SIREN {c.siren} · {c.forme || "—"} · {c.ville || "—"}
                  {c.date_creation && <> · créée {String(c.date_creation).slice(0, 4)}</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.procedure_collective && <Badge variant="destructive" className="text-[10px]">Procédure coll.</Badge>}
                {c.etat_administratif === "C" && <Badge variant="destructive" className="text-[10px]">Cessée</Badge>}
                <span className="text-[10px] text-muted-foreground">score {Math.round(Number(c.score ?? 0) * 100)}%</span>
                <a
                  href={`https://www.pappers.fr/entreprise/${c.siren}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary hover:underline text-[11px] inline-flex items-center gap-1"
                >
                  Pappers <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

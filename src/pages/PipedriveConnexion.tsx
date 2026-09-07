import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Loader2, CheckCircle2, XCircle, Plug } from "lucide-react";

// Écran Réglages → Pipedrive : teste la connexion (secrets Supabase) et affiche la
// structure du compte (société, commerciaux, pipelines, étapes). Base de l'intégration
// à venir (push des leads + briefing). Réservé admin/direction.

type Explore = {
  ok: boolean;
  error?: string;
  indice?: string;
  societe?: { nom: string | null; domaine: string | null; connecte_en_tant_que: string | null };
  commerciaux?: { id: number; nom: string; email: string }[];
  pipelines?: { id: number; nom: string }[];
  etapes?: { id: number; nom: string; pipeline_id: number; ordre: number }[];
};

export default function PipedriveConnexion() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const [res, setRes] = useState<Explore | null>(null);
  const [loading, setLoading] = useState(false);

  const tester = async () => {
    setLoading(true);
    setRes(null);
    try {
      const { data, error } = await supabase.functions.invoke("pipedrive-explore");
      if (error) throw error;
      setRes(data as Explore);
    } catch (e: any) {
      setRes({ ok: false, error: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!isAdmin && !isDirection) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <DetailPageHeader
        className="md:hidden"
        backTo="/"
        backLabel="Retour au hub"
        title="Pipedrive"
        actions={<div className="flex items-center gap-1"><MobileNav /><UserMenu /></div>}
      />
      <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
        <header className="hidden md:flex items-center gap-3">
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-2">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Connexion Pipedrive</h1>
            <p className="text-sm text-muted-foreground">Vérifie l'accès à ton compte Pipedrive (jeton + domaine).</p>
          </div>
        </header>

        <div className="rounded-lg border border-border bg-card/40 p-4 text-sm text-muted-foreground space-y-2">
          <p>Prérequis : deux secrets à ajouter dans Supabase (Edge Functions → Secrets) :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code className="text-foreground">PIPEDRIVE_API_TOKEN</code> — ton jeton API personnel</li>
            <li><code className="text-foreground">PIPEDRIVE_DOMAIN</code> — ton domaine (ex. <code className="text-foreground">avranches.pipedrive.com</code>)</li>
          </ul>
        </div>

        <Button onClick={tester} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Tester la connexion
        </Button>

        {res && (res.ok ? (
          <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 font-semibold text-emerald-500">
              <CheckCircle2 className="h-5 w-5" /> Connecté
            </div>
            <div className="text-sm">
              Société : <b className="text-foreground">{res.societe?.nom ?? "—"}</b>
              {res.societe?.connecte_en_tant_que && <> · en tant que {res.societe.connecte_en_tant_que}</>}
            </div>
            <div className="text-sm">
              <b className="text-foreground">{res.commerciaux?.length ?? 0}</b> commerciaux actifs ·{" "}
              <b className="text-foreground">{res.pipelines?.length ?? 0}</b> pipelines ·{" "}
              <b className="text-foreground">{res.etapes?.length ?? 0}</b> étapes
            </div>
            {(res.pipelines?.length ?? 0) > 0 && (
              <div className="text-sm">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1 mb-1">Pipelines</div>
                <div className="flex flex-wrap gap-1.5">
                  {res.pipelines!.map((p) => (
                    <span key={p.id} className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs">{p.nom}</span>
                  ))}
                </div>
              </div>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Voir le détail (commerciaux, étapes)</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-background/60 p-2 text-[11px]">
{JSON.stringify({ commerciaux: res.commerciaux, etapes: res.etapes }, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <XCircle className="h-5 w-5" /> Échec de la connexion
            </div>
            <div className="mt-1 text-sm text-foreground/90">{res.error}</div>
            {res.indice && <div className="mt-1 text-xs text-muted-foreground">{res.indice}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

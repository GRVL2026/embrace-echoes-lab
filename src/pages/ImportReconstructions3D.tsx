import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Loader2, Boxes, CheckCircle2, XCircle } from "lucide-react";
import liste from "@/data/reconstructions3d.json";

// Import des modèles 3D reconstruits (Hunyuan3D) : un clic -> l'edge importer-glb
// télécharge chaque GLB, le stocke dans le bucket et le rattache à la fiche produit.
// Aucune clé à manipuler : tout se fait côté serveur. Réservé au management.

type Res = { name: string; ok: boolean; fiches?: number; url?: string; error?: string };

export default function ImportReconstructions3D() {
  const { isAdmin, isDirection, isChefVentes, isLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Res[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const lancer = async () => {
    setLoading(true); setErr(null); setResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("importer-glb", { body: { items: liste } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Échec de l'import.");
      setResults(data.results as Res[]);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!isAdmin && !isDirection && !isChefVentes) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <DetailPageHeader className="md:hidden" backTo="/" backLabel="Retour au hub" title="Import 3D"
        actions={<div className="flex items-center gap-1"><MobileNav /><UserMenu /></div>} />
      <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
        <header className="hidden md:flex items-center gap-3">
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-2"><Boxes className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="font-display text-2xl font-bold">Import des modèles 3D reconstruits</h1>
            <p className="text-sm text-muted-foreground">Rattache les GLB reconstruits (Hunyuan3D) aux fiches produit — un clic, rien à installer.</p>
          </div>
        </header>

        <div className="rounded-lg border border-border bg-card/40 p-4 text-sm">
          <b className="text-foreground">{liste.length}</b> modèle(s) 3D à importer.
          Le serveur télécharge chaque GLB, le stocke et le rattache à sa fiche. Le Planner l'utilisera ensuite en tous angles.
        </div>

        <Button onClick={lancer} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
          {loading ? "Import en cours…" : `Importer les ${liste.length} modèle(s) 3D`}
        </Button>

        {err && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground/90">{err}</div>
        )}

        {results && (
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-card/40 p-3 text-sm">
                {r.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500" /> : <XCircle className="h-4 w-4 mt-0.5 text-destructive" />}
                <div className="min-w-0">
                  <div className="font-medium">{r.name}</div>
                  {r.ok
                    ? <div className="text-xs text-muted-foreground">{r.fiches} fiche(s) mise(s) à jour{r.fiches === 0 ? " — ⚠️ nom introuvable dans le catalogue" : ""}</div>
                    : <div className="text-xs text-destructive break-words">{r.error}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Loader2, ArrowLeft, Copy, Printer, Link as LinkIcon } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { RevueDashboard, revueToText, isRevueEmpty, type RevueData } from "@/components/admin/RevueDashboard";

type RevueRow = { id: string; titre: string | null; created_at: string; data: RevueData };

export default function GaiaRevueView() {
  const { isAdmin, canAccessGaia, loading: authLoading } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<RevueRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessGaia || !id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("gaia_revues")
        .select("id,titre,created_at,data")
        .eq("id", id)
        .maybeSingle();
      if (error) setError(error.message);
      else if (!data) setError("Revue introuvable.");
      else setRow(data as RevueRow);
      setLoading(false);
    })();
  }, [id, canAccessGaia]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/dossiers" replace />;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Lien copié", description: "L'URL de la revue est dans le presse-papier." });
    } catch {
      toast({ title: "Erreur", description: "Impossible de copier.", variant: "destructive" });
    }
  };

  const copyText = async () => {
    if (!row) return;
    try {
      await navigator.clipboard.writeText(revueToText(row.data));
      toast({ title: "Copié" });
    } catch {}
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2 print:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to={isAdmin ? "/" : "/dossiers"} className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 revue-print-root">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div>
            <Link to="/admin/gaia" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Retour au copilote
            </Link>
            <h2 className="font-display text-xl sm:text-2xl font-bold">
              {row?.titre ?? "Revue commerciale"}
            </h2>
            {row && (
              <p className="text-sm text-muted-foreground">
                Générée le {new Date(row.created_at).toLocaleString("fr-FR")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copyLink}>
              <LinkIcon className="mr-2 h-4 w-4" /> Copier le lien
            </Button>
            <Button variant="outline" onClick={copyText} disabled={!row}>
              <Copy className="mr-2 h-4 w-4" /> Copier le texte
            </Button>
            <Button onClick={() => window.print()} disabled={!row}>
              <Printer className="mr-2 h-4 w-4" /> Télécharger en PDF
            </Button>
          </div>
        </div>

        {/* Print-only header */}
        {row && (
          <div className="hidden print:block mb-6">
            <h1 className="text-2xl font-bold">{row.titre ?? "Revue commerciale"}</h1>
            <p className="text-sm">Générée le {new Date(row.created_at).toLocaleString("fr-FR")}</p>
            <hr className="mt-2 border-black/30" />
          </div>
        )}

        {loading && (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de la revue…
          </div>
        )}
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        {row && (
          <div className="rounded border border-border/60 bg-background/40 p-4 print:border-0 print:bg-white print:p-0">
            <RevueDashboard data={row.data} />
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Database, Radar, CalendarDays, CalendarRange } from "lucide-react";
import logoImg from "@/assets/logo.png";

type Rapport = {
  id: string;
  type: "quotidien" | "hebdomadaire";
  periode: string;
  contenu_markdown: string;
  sources: any;
  created_at: string;
};

export default function AdminVeille() {
  const { isAdmin, canAccessGaia, loading } = useAuth();
  const [rapports, setRapports] = useState<Rapport[]>([]);
  const [selected, setSelected] = useState<Rapport | null>(null);
  const [generating, setGenerating] = useState<"quotidien" | "hebdomadaire" | null>(null);

  const load = async () => {
    const { data } = await (supabase as any)
      .from("veille_rapports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) {
      setRapports(data);
      if (!selected && data.length > 0) setSelected(data[0]);
    }
  };

  useEffect(() => {
    if (canAccessGaia) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessGaia]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/dossiers" replace />;

  const generate = async (type: "quotidien" | "hebdomadaire") => {
    setGenerating(type);
    toast({
      title: "Génération en cours",
      description: "Le rapport peut prendre 1 à 2 minutes. Merci de patienter…",
    });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/veille-marche`;
      console.log("[veille] POST", url, { type });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type }),
      });
      const raw = await res.text();
      console.log("[veille] status", res.status, "body", raw.slice(0, 500));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} — ${raw.slice(0, 400)}`);
      }
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { throw new Error(`Réponse non-JSON: ${raw.slice(0, 200)}`); }
      if (parsed?.error) throw new Error(String(parsed.error));
      const rapport = parsed as Rapport;
      setRapports((prev) => [rapport, ...prev.filter((r) => r.id !== rapport.id)]);
      setSelected(rapport);
      toast({ title: "Rapport généré", description: rapport.periode });
      load();
    } catch (e: any) {
      console.error("[veille] erreur", e);
      toast({
        title: "Erreur de génération",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
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
          <nav className="ml-4 hidden md:flex items-center gap-1">
            <Link to="/dossiers" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Dossiers</Link>
            <Link to="/planner" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Arcade Planner</Link>
            <Link to="/catalogue" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Catalogue</Link>
            <Link to="/admin/gaia" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Database className="h-3 w-3" /> Gaia</Link>
            <Link to="/admin/veille" className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium inline-flex items-center gap-1"><Radar className="h-3 w-3" /> Veille</Link>
            {isAdmin && <Link to="/admin" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</Link>}
          </nav>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" /> Veille marché
            </h2>
            <p className="text-sm text-muted-foreground">
              Flippers Stern, arcade, distributeurs FR/EU — synthèses générées par IA à partir du web.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => generate("quotidien")} disabled={generating !== null} variant="outline">
              {generating === "quotidien" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération… (1-2 min)</>
              ) : (
                <><CalendarDays className="mr-2 h-4 w-4" /> Rapport du jour</>
              )}
            </Button>
            <Button onClick={() => generate("hebdomadaire")} disabled={generating !== null}>
              {generating === "hebdomadaire" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération… (1-2 min)</>
              ) : (
                <><CalendarRange className="mr-2 h-4 w-4" /> Rapport de la semaine</>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <aside className="rounded-lg border border-border bg-card/40 p-3 max-h-[70vh] overflow-y-auto">
            <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Historique ({rapports.length})
            </div>
            {rapports.length === 0 && (
              <div className="px-2 py-6 text-sm text-muted-foreground text-center">
                Aucun rapport. Générez le premier.
              </div>
            )}
            <ul className="space-y-1">
              {rapports.map((r) => {
                const active = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelected(r)}
                      className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-primary/15 border border-primary/40 text-primary"
                          : "hover:bg-muted border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {r.type === "quotidien" ? (
                          <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <CalendarRange className="h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        <span className="font-medium capitalize">{r.type}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">
                        {new Date(r.created_at).toLocaleString("fr-FR")}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6 min-h-[60vh]">
            {selected ? (
              <>
                <div className="mb-4 pb-3 border-b border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {selected.type} · {new Date(selected.created_at).toLocaleString("fr-FR")}
                  </div>
                  <div className="mt-1 font-display text-lg font-semibold">{selected.periode}</div>
                </div>
                <article className="prose prose-invert prose-sm max-w-none prose-headings:font-display prose-a:text-primary prose-table:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.contenu_markdown}</ReactMarkdown>
                </article>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sélectionnez un rapport ou générez-en un nouveau.
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

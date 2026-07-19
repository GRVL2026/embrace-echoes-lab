import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { AppTopNav } from "@/components/AppTopNav";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Shield, Database, Radar, CalendarDays, CalendarRange,
  Sparkles, Building2, CalendarClock, LineChart, ExternalLink,
  Link as LinkIcon, Mail, Printer, ChevronRight, Eye,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WatchlistPanel } from "@/components/admin/WatchlistPanel";
import logoImg from "@/assets/logo.png";
import { GenerationProgress } from "@/components/GenerationProgress";


type VeilleLink = { label: string; url: string };
type VeilleItem = {
  titre: string;
  resume: string;
  points_cles: string[];
  importance: "haute" | "moyenne" | "info";
  liens: VeilleLink[];
};
type VeilleSection = {
  id: "nouveautes" | "concurrents" | "evenements" | "tendances";
  titre: string;
  items: VeilleItem[];
};
type VeilleJson = {
  titre: string;
  periode: string;
  resume_executif: string;
  stats: { nb_nouveautes: number; nb_concurrents: number; nb_evenements: number; nb_sources: number };
  sections: VeilleSection[];
};

type Rapport = {
  id: string;
  type: "quotidien" | "hebdomadaire";
  periode: string;
  contenu_markdown: string;
  contenu_json: VeilleJson | null;
  sources: any;
  created_at: string;
};

const SECTION_META: Record<VeilleSection["id"], { icon: any; color: string; ring: string; bg: string }> = {
  nouveautes: { icon: Sparkles, color: "text-primary", ring: "border-primary/40", bg: "bg-primary/10" },
  concurrents: { icon: Building2, color: "text-orange-400", ring: "border-orange-500/40", bg: "bg-orange-500/10" },
  evenements: { icon: CalendarClock, color: "text-emerald-400", ring: "border-emerald-500/40", bg: "bg-emerald-500/10" },
  tendances: { icon: LineChart, color: "text-sky-400", ring: "border-sky-500/40", bg: "bg-sky-500/10" },
};

const IMPORTANCE_META: Record<VeilleItem["importance"], { label: string; cls: string }> = {
  haute: { label: "Haute", cls: "bg-rose-500/15 text-rose-400 border-rose-500/40" },
  moyenne: { label: "Moyenne", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  info: { label: "Info", cls: "bg-muted text-muted-foreground border-border" },
};

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="text-2xl font-bold font-display">{value ?? 0}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function ItemCard({ item }: { item: VeilleItem }) {
  const imp = IMPORTANCE_META[item.importance] ?? IMPORTANCE_META.info;
  return (
    <AccordionItem value={item.titre} className="border border-border/60 rounded-md bg-background/40 px-3">
      <AccordionTrigger className="hover:no-underline py-3">
        <div className="flex items-center gap-3 flex-1 text-left">
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${imp.cls}`}>
            {imp.label}
          </span>
          <span className="font-medium text-sm flex-1">{item.titre}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-1 pb-3 space-y-3">
        <p className="text-sm text-muted-foreground">{item.resume}</p>
        {item.points_cles?.length > 0 && (
          <ul className="space-y-1">
            {item.points_cles.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <ChevronRight className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-1" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
        {item.liens?.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {item.liens.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs bg-muted hover:bg-muted/70 border border-border rounded px-2 py-1 text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="max-w-[280px] truncate">{l.label || l.url}</span>
              </a>
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function SectionCard({ section }: { section: VeilleSection }) {
  const meta = SECTION_META[section.id] ?? SECTION_META.tendances;
  const Icon = meta.icon;
  return (
    <section className={`rounded-lg border ${meta.ring} ${meta.bg} p-4 sm:p-5`}>
      <header className="mb-3 flex items-center gap-2">
        <Icon className={`h-5 w-5 ${meta.color}`} />
        <h3 className="font-display text-base font-semibold">{section.titre}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{section.items?.length ?? 0} item(s)</span>
      </header>
      {section.items?.length ? (
        <Accordion type="multiple" className="space-y-2">
          {section.items.map((it, i) => <ItemCard key={i} item={it} />)}
        </Accordion>
      ) : (
        <p className="text-sm text-muted-foreground italic">Rien à signaler sur cette section.</p>
      )}
    </section>
  );
}

function VeilleRichView({ data }: { data: VeilleJson }) {
  return (
    <div className="space-y-5">
      {/* Résumé exécutif */}
      <section className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-secondary/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-[11px] uppercase tracking-wider text-primary font-semibold">Résumé exécutif</div>
        </div>
        <h1 className="font-display text-xl sm:text-2xl font-bold mb-2">{data.titre}</h1>
        <p className="text-sm text-muted-foreground mb-3">{data.periode}</p>
        <p className="text-base leading-relaxed">{data.resume_executif}</p>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Nouveautés" value={data.stats?.nb_nouveautes} color="border-primary/40 bg-primary/5" />
        <StatTile label="Concurrents" value={data.stats?.nb_concurrents} color="border-orange-500/40 bg-orange-500/5" />
        <StatTile label="Événements" value={data.stats?.nb_evenements} color="border-emerald-500/40 bg-emerald-500/5" />
        <StatTile label="Sources" value={data.stats?.nb_sources} color="border-sky-500/40 bg-sky-500/5" />
      </div>

      {/* Sections */}
      <div className="grid grid-cols-1 gap-4">
        {data.sections?.map((s, i) => <SectionCard key={i} section={s} />)}
      </div>
    </div>
  );
}

export default function AdminVeille() {
  const { isAdmin, canAccessGaia, loading, user } = useAuth();
  const [rapports, setRapports] = useState<Rapport[]>([]);
  const [selected, setSelected] = useState<Rapport | null>(null);
  const [generating, setGenerating] = useState<"quotidien" | "hebdomadaire" | null>(null);
  const [etape, setEtape] = useState<string>("");

  const load = async () => {
    const { data } = await (supabase as any)
      .from("veille_rapports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) {
      setRapports(data);
      // Deep-link : ?rapport=id
      const url = new URL(window.location.href);
      const rid = url.searchParams.get("rapport");
      const target = rid ? data.find((r: Rapport) => r.id === rid) : null;
      if (target) setSelected(target);
      else if (!selected && data.length > 0) setSelected(data[0]);
    }
  };

  useEffect(() => {
    if (canAccessGaia) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessGaia]);

  // Reprise persistante : si un job de veille de cet utilisateur est en cours,
  // on remonte l'état pour bloquer la génération et afficher la progression,
  // même après un rafraîchissement ou une navigation.
  useEffect(() => {
    if (!canAccessGaia || !user?.id) return;
    let cancelled = false;
    const poll = async () => {
      const { data } = await (supabase as any)
        .from("veille_jobs")
        .select("id, type, etape, done")
        .eq("owner_id", user.id)
        .eq("done", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data && !data.done) {
        setGenerating(data.type as "quotidien" | "hebdomadaire");
        setEtape(data.etape ?? "en cours…");
      } else if (generating) {
        // Le job est fini : on libère l'UI et on rafraîchit l'historique.
        setGenerating(null);
        setEtape("");
        load();
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessGaia, user?.id, generating]);


  const structured: VeilleJson | null = useMemo(() => {
    const j = selected?.contenu_json;
    if (!j || typeof j !== "object") return null;
    return j as VeilleJson;
  }, [selected]);

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
    setEtape("démarrage…");
    toast({
      title: "Génération lancée",
      description: "Collecte parallèle puis synthèse (≈ 2 à 3 min).",
    });
    const startedAt = new Date().toISOString();
    let jobId: string | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/veille-marche`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type }),
      });
      if (!res.ok && res.status !== 202) {
        const raw = await res.text();
        throw new Error(`HTTP ${res.status} — ${raw.slice(0, 400)}`);
      }
      try {
        const payload = await res.json();
        jobId = payload?.job_id ?? null;
      } catch { /* ignore */ }

      const maxMs = 10 * 60 * 1000;
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        await new Promise((r) => setTimeout(r, 8000));
        if (jobId) {
          const { data: jobRow } = await (supabase as any)
            .from("veille_jobs")
            .select("etape, done")
            .eq("id", jobId)
            .maybeSingle();
          if (jobRow?.etape) setEtape(jobRow.etape);
        }
        const { data } = await (supabase as any)
          .from("veille_rapports")
          .select("*")
          .eq("type", type)
          .gt("created_at", startedAt)
          .order("created_at", { ascending: false })
          .limit(1);
        const fresh = data?.[0] as Rapport | undefined;
        if (fresh) {
          setRapports((prev) => [fresh, ...prev.filter((r) => r.id !== fresh.id)]);
          setSelected(fresh);
          toast({ title: "Rapport généré", description: fresh.periode });
          return;
        }
      }
      throw new Error("Le rapport n'est pas arrivé dans le délai (10 min). Vérifiez plus tard l'historique.");
    } catch (e: any) {
      console.error("[veille] erreur", e);
      toast({ title: "Erreur de génération", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setGenerating(null);
      setEtape("");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Lien copié" });
    } catch {
      toast({ title: "Erreur", description: "Impossible de copier.", variant: "destructive" });
    }
  };

  const emailReport = () => {
    if (!selected) return;
    const j = structured;
    const subject = encodeURIComponent(`[Veille marché] ${j?.titre ?? selected.periode}`);
    const body = encodeURIComponent(
      `${j?.titre ?? "Veille marché"}\n${j?.periode ?? selected.periode}\n\n` +
      `${j?.resume_executif ?? selected.contenu_markdown.slice(0, 600)}\n\n` +
      `Rapport complet : ${window.location.href}\n`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
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
          <AppTopNav />
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" /> Veille marché
            </h2>
            <p className="text-sm text-muted-foreground">
              Flippers Stern, arcade, distributeurs FR/EU — synthèses générées par IA à partir du web.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {generating && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                Génération en cours — vous pouvez naviguer, vous serez notifié{etape ? ` · ${etape}` : ""}
              </span>
            )}
            <Button onClick={() => generate("quotidien")} disabled={generating !== null} variant="outline">
              {generating === "quotidien" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération…</>
              ) : (
                <><CalendarDays className="mr-2 h-4 w-4" /> Rapport du jour</>
              )}
            </Button>
            <Button onClick={() => generate("hebdomadaire")} disabled={generating !== null}>
              {generating === "hebdomadaire" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération…</>
              ) : (
                <><CalendarRange className="mr-2 h-4 w-4" /> Rapport de la semaine</>
              )}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="rapports">
          <TabsList className="mb-4">
            <TabsTrigger value="rapports"><Radar className="h-4 w-4 mr-1" /> Rapports</TabsTrigger>
            <TabsTrigger value="watchlist"><Eye className="h-4 w-4 mr-1" /> Watchlist</TabsTrigger>
          </TabsList>

          <TabsContent value="rapports">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          <aside className="rounded-lg border border-border bg-card/40 p-3 max-h-[75vh] overflow-y-auto print:hidden">
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

          <section className="min-h-[60vh] space-y-4">
            {selected && (
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" /> Télécharger en PDF
                </Button>
                <Button size="sm" variant="outline" onClick={copyLink}>
                  <LinkIcon className="mr-2 h-4 w-4" /> Copier le lien
                </Button>
                <Button size="sm" variant="outline" onClick={emailReport}>
                  <Mail className="mr-2 h-4 w-4" /> Envoyer par email
                </Button>
              </div>
            )}
            {selected ? (
              structured ? (
                <VeilleRichView data={structured} />
              ) : (
                <div className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
                  <div className="mb-4 pb-3 border-b border-border">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      {selected.type} · {new Date(selected.created_at).toLocaleString("fr-FR")}
                    </div>
                    <div className="mt-1 font-display text-lg font-semibold">{selected.periode}</div>
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      Ancien format (markdown) — les prochains rapports seront affichés en cartes structurées.
                    </p>
                  </div>
                  <article className="prose prose-invert prose-sm max-w-none prose-headings:font-display prose-a:text-primary prose-table:text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.contenu_markdown}</ReactMarkdown>
                  </article>
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground rounded-lg border border-border bg-card/40 p-10">
                Sélectionnez un rapport ou générez-en un nouveau.
              </div>
            )}
          </section>
        </div>
          </TabsContent>

          <TabsContent value="watchlist">
            <WatchlistPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

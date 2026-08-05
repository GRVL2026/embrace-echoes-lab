import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Newspaper, Loader2, ExternalLink, Plus, X, MapPin, Clock, Building2, RefreshCw,
} from "lucide-react";

type Signal = {
  id: string;
  publie_le: string;
  source: string | null;
  titre: string;
  url: string;
  commune: string | null;
  departement: string | null;
  region: string | null;
  type_lieu: string | null;
  evenement: string | null;
  etablissement: string | null;
  interpretation: string | null;
  urgence: string | null;
  statut: string;
  prospect_id: string | null;
};

// Le territoire de Léopaul passe devant : à volume égal, un signal normand vaut
// davantage qu'un signal en Occitanie, parce qu'on peut s'y déplacer.
const REGIONS_PRIORITAIRES = ["Normandie", "Bretagne", "Île-de-France", "Ile-de-France"];

const URGENCES: Record<string, { label: string; classe: string; rang: number }> = {
  haute: { label: "À appeler cette semaine", classe: "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", rang: 0 },
  moyenne: { label: "À qualifier", classe: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400", rang: 1 },
  basse: { label: "Pour information", classe: "border-border bg-muted text-muted-foreground", rang: 2 },
};

function joursDepuis(d: string): number {
  return Math.floor((Date.now() - new Date(d + "T12:00:00").getTime()) / 86_400_000);
}

function fraicheur(d: string): string {
  const j = joursDepuis(d);
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return "hier";
  if (j < 7) return `il y a ${j} jours`;
  return new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export default function Gazette() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const qc = useQueryClient();
  const [filtreUrgence, setFiltreUrgence] = useState<"all" | "haute" | "moyenne" | "basse">("all");
  const [filtreZone, setFiltreZone] = useState<"all" | "prioritaires">("all");
  const [enCours, setEnCours] = useState<string | null>(null);

  const autorise = isAdmin || isDirection;

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["gazette-signaux"],
    enabled: autorise,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gazette_signaux" as any)
        .select("*")
        .in("statut", ["nouveau", "retenu", "converti"])
        .order("publie_le", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as Signal[];
    },
  });

  const signaux = useMemo(() => {
    let liste = data ?? [];
    if (filtreUrgence !== "all") liste = liste.filter((s) => (s.urgence ?? "moyenne") === filtreUrgence);
    if (filtreZone === "prioritaires") {
      liste = liste.filter((s) => REGIONS_PRIORITAIRES.includes(s.region ?? ""));
    }
    // Le territoire d'abord, puis l'urgence, puis la fraîcheur.
    return [...liste].sort((a, b) => {
      const pa = REGIONS_PRIORITAIRES.includes(a.region ?? "") ? 0 : 1;
      const pb = REGIONS_PRIORITAIRES.includes(b.region ?? "") ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ua = URGENCES[a.urgence ?? "moyenne"]?.rang ?? 1;
      const ub = URGENCES[b.urgence ?? "moyenne"]?.rang ?? 1;
      if (ua !== ub) return ua - ub;
      return b.publie_le.localeCompare(a.publie_le);
    });
  }, [data, filtreUrgence, filtreZone]);

  async function creerProspect(s: Signal) {
    setEnCours(s.id);
    try {
      const nom = s.etablissement || `${s.type_lieu ?? "Lieu de loisirs"} — ${s.commune ?? "commune inconnue"}`;
      const { data: cree, error } = await supabase
        .from("prospects" as any)
        .insert({
          entreprise: nom,
          ville: s.commune,
          segment: s.type_lieu === "camping" ? "camping" : "loisirs",
          tag: "Gazette",
          source: "presse",
          statut: "nouveau",
          // L'article est la matière de l'accroche : sans lui, le commercial perd le
          // prétexte de son appel. On le conserve donc dans la fiche.
          signal: `${s.evenement ?? "signal presse"} — ${s.titre}`,
          notes: [s.interpretation, `Source : ${s.source ?? "presse"} (${s.publie_le})`, s.url]
            .filter(Boolean).join("\n\n"),
        })
        .select("id").single();
      if (error) throw error;

      await supabase.from("gazette_signaux" as any)
        .update({ statut: "converti", prospect_id: (cree as any).id })
        .eq("id", s.id);

      toast.success("Prospect créé", { description: nom });
      qc.invalidateQueries({ queryKey: ["gazette-signaux"] });
    } catch (e) {
      toast.error("Création impossible", { description: (e as Error).message });
    } finally {
      setEnCours(null);
    }
  }

  async function ignorer(s: Signal) {
    setEnCours(s.id);
    try {
      await supabase.from("gazette_signaux" as any).update({ statut: "ignore" }).eq("id", s.id);
      qc.invalidateQueries({ queryKey: ["gazette-signaux"] });
    } finally {
      setEnCours(null);
    }
  }

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!autorise) return <Navigate to="/" replace />;

  const nbHaute = (data ?? []).filter((s) => s.urgence === "haute" && s.statut !== "converti").length;

  return (
    <div className="flex flex-col min-h-screen">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 backdrop-blur px-4 py-3"
        style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
      >
        <Newspaper className="h-5 w-5" style={{ color: "hsl(var(--space-prospection))" }} />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-base sm:text-lg font-semibold truncate">Gazette</h1>
          <p className="text-xs text-muted-foreground truncate">
            Les lieux de loisirs qui ouvrent, changent de mains ou s'agrandissent
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </header>

      <div className="border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtreZone} onValueChange={(v) => setFiltreZone(v as typeof filtreZone)}>
            <SelectTrigger className="h-9 w-[210px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toute la France</SelectItem>
              <SelectItem value="prioritaires">Normandie · Bretagne · IDF</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtreUrgence} onValueChange={(v) => setFiltreUrgence(v as typeof filtreUrgence)}>
            <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes priorités</SelectItem>
              <SelectItem value="haute">🟢 À appeler cette semaine</SelectItem>
              <SelectItem value="moyenne">🟠 À qualifier</SelectItem>
              <SelectItem value="basse">⚪ Pour information</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{signaux.length}</span> signaux
            {nbHaute > 0 && <span className="ml-2 text-emerald-500">· {nbHaute} à traiter</span>}
          </span>
        </div>
      </div>

      <main className="flex-1 px-4 py-4 space-y-3">
        {isFetching && !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : signaux.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Aucun signal pour l'instant. La gazette se remplit chaque matin ; un secteur
            calme est un secteur sans opportunité, pas une panne.
          </Card>
        ) : (
          signaux.map((s) => {
            const u = URGENCES[s.urgence ?? "moyenne"] ?? URGENCES.moyenne;
            const prioritaire = REGIONS_PRIORITAIRES.includes(s.region ?? "");
            const converti = s.statut === "converti";
            return (
              <Card
                key={s.id}
                className={cn(
                  "p-4 transition-colors",
                  prioritaire && "border-l-2 border-l-primary",
                  converti && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mb-1.5">
                  <Badge variant="outline" className={cn("h-5 px-2 text-[10px]", u.classe)}>{u.label}</Badge>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fraicheur(s.publie_le)}</span>
                  {s.commune && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{s.commune}{s.departement ? ` (${s.departement})` : ""}
                    </span>
                  )}
                  {s.type_lieu && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{s.type_lieu}</span>}
                  {s.source && <span className="ml-auto italic">{s.source}</span>}
                </div>

                <h2 className="font-semibold text-sm leading-snug">{s.titre}</h2>

                {s.interpretation && (
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{s.interpretation}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {converti ? (
                    <Badge variant="outline" className="h-8 px-3 border-primary/40 text-primary">
                      Prospect créé
                    </Badge>
                  ) : (
                    <>
                      <Button size="sm" className="gap-1.5" disabled={enCours === s.id} onClick={() => creerProspect(s)}>
                        {enCours === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Créer le prospect
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
                        disabled={enCours === s.id} onClick={() => ignorer(s)}>
                        <X className="h-3.5 w-3.5" /> Ignorer
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" asChild className="gap-1.5 ml-auto">
                    <a href={s.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /> Lire l'article
                    </a>
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}

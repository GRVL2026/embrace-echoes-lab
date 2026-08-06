import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Newspaper, Loader2, ExternalLink, Plus, X, MapPin, Clock, Building2, RefreshCw,
  Search, Quote, UserRound, Save, Sparkles, ArrowLeft,
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
  // Le dirigeant cité dans l'article. La citation est conservée avec le nom : c'est
  // elle qui prouve que le nom vient bien de l'article et n'a pas été inventé.
  contact_nom: string | null;
  contact_role: string | null;
  contact_citation: string | null;
  contact_origine: string | null;
  prospect_id: string | null;
  code_client: string | null;
};

type Parc = { prospect_id: string | null; code_client: string | null;
              nb_machines: number; nb_flippers: number; nb_catalogue: number };

// Le territoire de Léopaul passe devant : à volume égal, un signal normand vaut
// davantage qu'un signal en Occitanie, parce qu'on peut s'y déplacer.
const REGIONS_PRIORITAIRES = ["Normandie", "Bretagne", "Île-de-France", "Ile-de-France"];

// Une icône et une couleur par univers : « bowling » et « camping » ne se lisent pas de
// la même façon, et un commercial reconnaît son terrain avant même de lire.
const TYPES: Record<string, { icone: string; teinte: string }> = {
  bowling: { icone: "🎳", teinte: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  camping: { icone: "⛺", teinte: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  "parc de loisirs": { icone: "🎡", teinte: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  "complexe de loisirs": { icone: "🎯", teinte: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  "laser game": { icone: "🔫", teinte: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  "escape game": { icone: "🗝️", teinte: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  "bar à jeux": { icone: "🍺", teinte: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  "parc aquatique": { icone: "🌊", teinte: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  autre: { icone: "📍", teinte: "bg-muted text-muted-foreground border-border" },
};
const typeMeta = (t: string | null) => TYPES[(t ?? "autre").toLowerCase()] ?? TYPES.autre;

const EVENEMENTS: Record<string, string> = {
  ouverture: "Ouvre",
  reprise: "Repris",
  rénovation: "Rénove",
  agrandissement: "S'agrandit",
  diversification: "Se diversifie",
  sinistre: "Sinistre",
};

const URGENCES: Record<string, { label: string; classe: string; rang: number }> = {
  haute: { label: "À appeler cette semaine", classe: "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", rang: 0 },
  moyenne: { label: "À qualifier", classe: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400", rang: 1 },
  basse: { label: "Pour information", classe: "border-border bg-muted text-muted-foreground", rang: 2 },
};

// POURQUOI UN SCORE, ET PAS UN ORDRE CHRONOLOGIQUE.
//
// Un journal se lit du plus récent au plus ancien. Une file de prospection, non : un
// commercial devant quarante signaux doit savoir lequel appeler EN PREMIER, et
// pourquoi. La date n'est qu'un critère parmi d'autres, et pas le plus fort.
//
// Chaque point porte donc une justification affichée à l'écran. Un score sans motif
// n'est qu'un chiffre auquel on n'obéit pas.
function priorite(s: Signal, parc: Parc | undefined): { note: number; motifs: string[] } {
  const motifs: string[] = [];
  let note = 0;

  if (s.code_client) { note += 50; motifs.push("déjà client"); }
  else if (s.prospect_id) { note += 30; motifs.push("déjà en fiche"); }

  if (parc?.nb_machines) {
    note += 15;
    const manque = parc.nb_flippers === 0 ? ", aucun flipper" : "";
    motifs.push(`${parc.nb_machines} machines connues${manque}`);
  }

  const j = joursDepuis(s.publie_le);
  if (j <= 7) { note += 25; motifs.push(j <= 1 ? "tout frais" : "cette semaine"); }
  else if (j <= 30) note += 12;
  else if (j > 120) note -= 10;

  if (REGIONS_PRIORITAIRES.includes(s.region ?? "")) { note += 20; motifs.push("territoire prioritaire"); }
  if (s.evenement === "reprise" || s.evenement === "ouverture") note += 15;
  if (s.contact_nom) { note += 10; motifs.push(`contact : ${s.contact_nom}`); }
  if (s.urgence === "haute") note += 10;

  return { note, motifs };
}

const MOIS = ["janv.", "févr.", "mars", "avril", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Intertitre d'une journée : la date devient une structure de lecture, pas une étiquette. */
function titreJour(d: string): string {
  const j = joursDepuis(d);
  if (j <= 0) return "Aujourd'hui";
  if (j === 1) return "Hier";
  const dt = new Date(d + "T12:00:00");
  const libelle = dt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return libelle.charAt(0).toUpperCase() + libelle.slice(1);
}

/** Nettoie le titre du suffixe « - Ouest-France » : la source est déjà affichée à part. */
function titrePropre(t: string, source: string | null): string {
  let v = t.replace(/\s*[-–—]\s*[^-–—]{2,28}$/, "").trim();
  if (source) v = v.replace(new RegExp(`\\s*[-–—]\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
  return v || t;
}

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
  const [recherche, setRecherche] = useState("");
  const [enCours, setEnCours] = useState<string | null>(null);
  // Le signal ouvert dans le panneau de détail, et le brouillon du dirigeant saisi à
  // la main. Le brouillon vit à côté du signal : on ne réécrit la base qu'à la
  // validation, pas à chaque frappe.
  const [ouvert, setOuvert] = useState<Signal | null>(null);
  const [brouillon, setBrouillon] = useState<{ nom: string; role: string }>({ nom: "", role: "" });

  function ouvrir(s: Signal) {
    setOuvert(s);
    setBrouillon({ nom: s.contact_nom ?? "", role: s.contact_role ?? "" });
  }

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

  // Le parc des lieux déjà rattachés : c'est lui qui fait la différence entre
  // « un bowling a ouvert » et « un bowling de 36 machines sans flipper a ouvert ».
  const { data: parcs } = useQuery({
    queryKey: ["gazette-parcs"],
    enabled: autorise, staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_arcade_parc_resume" as any)
        .select("prospect_id, code_client, nb_machines, nb_flippers, nb_catalogue").limit(1200);
      if (error) throw error;
      return (data ?? []) as unknown as Parc[];
    },
  });

  const parcParFiche = useMemo(() => {
    const m = new Map<string, Parc>();
    for (const p of parcs ?? []) {
      if (p.prospect_id) m.set(`p:${p.prospect_id}`, p);
      if (p.code_client) m.set(`c:${p.code_client}`, p);
    }
    return m;
  }, [parcs]);

  const { tries: signaux, notes } = useMemo(() => {
    let liste = data ?? [];
    if (filtreUrgence !== "all") liste = liste.filter((s) => (s.urgence ?? "moyenne") === filtreUrgence);
    if (filtreZone === "prioritaires") {
      liste = liste.filter((s) => REGIONS_PRIORITAIRES.includes(s.region ?? ""));
    }
    // Recherche libre : on cherche un article aussi bien par sa commune que par le nom
    // de l'établissement, du journal ou du dirigeant — on ne se souvient jamais du même
    // fragment d'un article qu'on a lu la veille.
    const q = recherche.trim().toLowerCase();
    if (q) {
      liste = liste.filter((s) =>
        [s.titre, s.commune, s.departement, s.region, s.etablissement,
         s.source, s.interpretation, s.contact_nom]
          .some((v) => (v ?? "").toLowerCase().includes(q)),
      );
    }
    // Classement par priorité, et non par date : voir la note sur priorite().
    const notes = new Map<string, { note: number; motifs: string[] }>();
    for (const sig of liste) {
      const cle = sig.code_client ? `c:${sig.code_client}` : sig.prospect_id ? `p:${sig.prospect_id}` : null;
      notes.set(sig.id, priorite(sig, cle ? parcParFiche.get(cle) : undefined));
    }
    const tries = [...liste].sort((a, b) => {
      const d = (notes.get(b.id)?.note ?? 0) - (notes.get(a.id)?.note ?? 0);
      return d !== 0 ? d : b.publie_le.localeCompare(a.publie_le);
    });

    // Trois paquets, parce qu'un commercial ne travaille pas une liste de quarante
    // lignes : il travaille les cinq premières, puis revient. Le seuil de 60 points
    // correspond à un signal qui cumule au moins deux atouts — une fiche connue et
    // de la fraîcheur, ou un territoire et un parc.
    const parJour: { jour: string; items: Signal[] }[] = [];
    for (const sig of tries) {
      const dernier = parJour[parJour.length - 1];
      if (dernier && dernier.jour === sig.publie_le) dernier.items.push(sig);
      else parJour.push({ jour: sig.publie_le, items: [sig] });
    }
    return { tries, parJour, notes };
  }, [data, filtreUrgence, filtreZone, recherche, parcParFiche]);

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
          // Le dirigeant repéré dans l'article part avec la fiche : sans lui, le
          // commercial rappelle un standard et recommence l'enquête à zéro.
          contact_nom: s.contact_nom,
          contact_role: s.contact_role,
          notes: [s.interpretation, `Source : ${s.source ?? "presse"} (${s.publie_le})`, s.url]
            .filter(Boolean).join("\n\n"),
        })
        .select("id").single();
      if (error) throw error;

      await supabase.from("gazette_signaux" as any)
        .update({ statut: "converti", prospect_id: (cree as any).id })
        .eq("id", s.id);

      toast.success("Prospect créé", { description: nom });
      setOuvert(null);   // le signal est traité : le panneau n'a plus rien à montrer
      qc.invalidateQueries({ queryKey: ["gazette-signaux"] });
    } catch (e) {
      toast.error("Création impossible", { description: (e as Error).message });
    } finally {
      setEnCours(null);
    }
  }

  async function enregistrerContact(s: Signal) {
    const nom = brouillon.nom.trim();
    const role = brouillon.role.trim();
    setEnCours(s.id);
    try {
      const { error } = await supabase.from("gazette_signaux" as any)
        .update({
          contact_nom: nom || null,
          contact_role: role || null,
          contact_origine: nom || role ? "manuel" : null,
        })
        .eq("id", s.id);
      if (error) throw error;
      toast.success(nom ? `Dirigeant enregistré : ${nom}` : "Dirigeant effacé");
      setOuvert({ ...s, contact_nom: nom || null, contact_role: role || null,
                  contact_origine: nom || role ? "manuel" : null });
      qc.invalidateQueries({ queryKey: ["gazette-signaux"] });
    } catch (e) {
      toast.error("Enregistrement impossible", { description: (e as Error).message });
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
        {/* Sans ce retour, la Gazette est un cul-de-sac sur mobile : aucun autre chemin
            ne ramène au menu. */}
        <Link
          to="/"
          className="flex-shrink-0 -ml-1 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Retour au menu"
          aria-label="Retour au menu"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Newspaper className="h-5 w-5 flex-shrink-0" style={{ color: "hsl(var(--space-prospection))" }} />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-base sm:text-lg font-semibold truncate">Gazette</h1>
          <p className="text-xs text-muted-foreground truncate">
            Classés par priorité d'appel — commencez par le haut
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </header>

      <div className="border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Chercher : commune, enseigne, journal…"
              className="h-9 pl-8 pr-8 text-xs"
            />
            {recherche && (
              <button type="button" onClick={() => setRecherche("")} title="Effacer"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
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
          <>
            {[
              { cle: "top", titre: "Commencez par ici", aide: "Les signaux qui cumulent plusieurs atouts — une fiche déjà connue, un parc recensé, votre territoire, ou une actualité de la semaine.", seuil: 60 },
              { cle: "semaine", titre: "À traiter ensuite", aide: "Utiles, mais moins d'atouts réunis.", seuil: 30 },
              { cle: "reste", titre: "Le reste", aide: "Pour information — signaux anciens ou hors territoire.", seuil: -999 },
            ].map((bloc, i, blocs) => {
              const borneHaute = i === 0 ? 99999 : blocs[i - 1].seuil;
              const items = signaux.filter((s) => {
                const n = notes.get(s.id)?.note ?? 0;
                return n < borneHaute && n >= bloc.seuil;
              });
              if (items.length === 0) return null;
              const limite = bloc.cle === "top" ? 6 : bloc.cle === "semaine" ? 20 : 30;
              return (
                <section key={bloc.cle} className="space-y-2">
                  <div className="sticky z-10 -mx-4 px-4 py-1.5 bg-background/95 backdrop-blur"
                    style={{ top: "calc(52px + var(--safe-top))" }}>
                    <div className="flex items-baseline gap-2">
                      <h2 className={cn("font-display text-sm font-semibold",
                        bloc.cle === "top" && "text-emerald-600 dark:text-emerald-400")}>
                        {bloc.titre}
                      </h2>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
                      <div className="flex-1 border-b border-border/60 ml-2" />
                    </div>
                    <p className="text-[10px] leading-snug text-muted-foreground">{bloc.aide}</p>
                  </div>

                  {items.slice(0, limite).map((s) => {
                const u = URGENCES[s.urgence ?? "moyenne"] ?? URGENCES.moyenne;
                const t = typeMeta(s.type_lieu);
                const converti = s.statut === "converti";
                const d = new Date(s.publie_le + "T12:00:00");
                return (
                  <Card
                    key={s.id}
                    className={cn(
                      "group relative overflow-hidden p-0 transition-colors hover:border-primary/40",
                      converti && "opacity-55",
                    )}
                  >
                    {/* L'urgence devient un liseré : présente sans répéter un badge vingt fois. */}
                    <div className={cn("absolute left-0 top-0 h-full w-1",
                      s.urgence === "haute" ? "bg-emerald-500"
                        : s.urgence === "moyenne" ? "bg-amber-500" : "bg-border")} />

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => ouvrir(s)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(s); } }}
                      className="flex gap-3 p-3 pl-4 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      {/* Pastille calendrier : la date se lit d'un coup d'œil. */}
                      <div className="flex-shrink-0 w-12 text-center">
                        <div className="text-xl font-semibold leading-none tabular-nums">{d.getDate()}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{MOIS[d.getMonth()]}</div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px] gap-1", t.teinte)}>
                            <span aria-hidden>{t.icone}</span>{s.type_lieu ?? "lieu de loisirs"}
                          </Badge>
                          {s.evenement && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-border">
                              {EVENEMENTS[s.evenement] ?? s.evenement}
                            </Badge>
                          )}
                          {(s.commune || s.region) && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {[s.region, s.commune && `${s.commune}${s.departement ? ` (${s.departement})` : ""}`]
                                .filter(Boolean).join(" · ")}
                            </span>
                          )}
                          {/* Le journal fait partie du signal : « Ouest-France » et un blog
                              d'annonces ne se lisent pas avec le même crédit. */}
                          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-foreground/75">
                            <Newspaper className="h-3 w-3" />{s.source ?? "source inconnue"}
                          </span>
                        </div>

                        <h3 className="text-sm font-semibold leading-snug">
                          {titrePropre(s.titre, s.source)}
                        </h3>

                        {s.interpretation && (
                          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{s.interpretation}</p>
                        )}

                        {/* POURQUOI CE SIGNAL EST ICI. Un classement dont on ne voit pas
                            la raison n'est pas suivi : le commercial refait son propre tri
                            et l'ordre proposé ne sert à rien. */}
                        {(notes.get(s.id)?.motifs.length ?? 0) > 0 && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-1">
                            {notes.get(s.id)!.motifs.map((m) => (
                              <span key={m} className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                m === "déjà client" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                  : m === "déjà en fiche" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                                  : "bg-muted text-muted-foreground",
                              )}>{m}</span>
                            ))}
                          </p>
                        )}

                        {s.contact_nom && (
                          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px]">
                            <UserRound className="h-3.5 w-3.5 text-primary" />
                            <span className="font-medium">{s.contact_nom}</span>
                            {s.contact_role && <span className="text-muted-foreground">· {s.contact_role}</span>}
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {converti ? (
                            <span className="text-[11px] font-medium text-primary">Prospect créé ✓</span>
                          ) : (
                            <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={enCours === s.id}
                              onClick={(e) => { e.stopPropagation(); creerProspect(s); }}>
                              {enCours === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                              Créer le prospect
                            </Button>
                          )}
                          {/* L'article est la matière première du signal : son accès reste un
                              bouton nommé, pas une icône à deviner. */}
                          <Button size="sm" variant="outline" asChild className="h-7 gap-1.5 text-xs">
                            <a href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              <ExternalLink className="h-3 w-3" />Lire l'article
                            </a>
                          </Button>
                          {!converti && (
                            <Button size="sm" variant="ghost" title="Ignorer ce signal"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                              disabled={enCours === s.id}
                              onClick={(e) => { e.stopPropagation(); ignorer(s); }}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
                  })}

                  {items.length > limite && (
                    <p className="px-1 text-[11px] text-muted-foreground">
                      {items.length - limite} autre{items.length - limite > 1 ? "s" : ""} dans cette
                      catégorie — affine avec la recherche ou les filtres plutôt que de tout parcourir.
                    </p>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>

      {/* Panneau de détail : l'article, ce qu'on en comprend, et la personne à appeler.
          La feuille couvre l'écran sur mobile — d'où la marge de sécurité en haut, sans
          laquelle le titre passe sous l'heure et la batterie du téléphone. */}
      <Sheet open={!!ouvert} onOpenChange={(o) => { if (!o) setOuvert(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto"
          style={{ paddingTop: "calc(1.5rem + var(--safe-top))" }}
        >
          {ouvert && (
            <>
              <SheetHeader className="space-y-2 text-left">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                    <Clock className="h-3 w-3" />
                    {new Date(ouvert.publie_le + "T12:00:00").toLocaleDateString("fr-FR",
                      { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground/75">
                    <Newspaper className="h-3 w-3" />{ouvert.source ?? "source inconnue"}
                  </span>
                </div>
                <SheetTitle className="text-base leading-snug">
                  {titrePropre(ouvert.titre, ouvert.source)}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px] gap-1", typeMeta(ouvert.type_lieu).teinte)}>
                    <span aria-hidden>{typeMeta(ouvert.type_lieu).icone}</span>
                    {ouvert.type_lieu ?? "lieu de loisirs"}
                  </Badge>
                  {ouvert.evenement && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {EVENEMENTS[ouvert.evenement] ?? ouvert.evenement}
                    </Badge>
                  )}
                  {(ouvert.commune || ouvert.region) && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {[ouvert.region, ouvert.commune && `${ouvert.commune}${ouvert.departement ? ` (${ouvert.departement})` : ""}`]
                        .filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>

                {ouvert.etablissement && (
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <Building2 className="h-4 w-4 text-muted-foreground" />{ouvert.etablissement}
                  </p>
                )}

                <Button asChild className="w-full gap-2">
                  <a href={ouvert.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Lire l'article{ouvert.source ? ` sur ${ouvert.source}` : ""}
                  </a>
                </Button>

                {ouvert.interpretation && (
                  <p className="rounded-md bg-muted/40 p-3 text-[13px] leading-relaxed text-muted-foreground">
                    {ouvert.interpretation}
                  </p>
                )}

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Dirigeant</h3>
                    {ouvert.contact_origine === "article" && (
                      <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] border-primary/40 text-primary">
                        <Sparkles className="h-3 w-3" />trouvé dans l'article
                      </Badge>
                    )}
                  </div>

                  {/* La citation d'origine reste sous les yeux : c'est elle qui permet de
                      vérifier d'un regard que le nom vient de l'article. */}
                  {ouvert.contact_citation && (
                    <blockquote className="flex gap-2 rounded-md border-l-2 border-primary/40 bg-muted/30 p-3 text-[13px] italic leading-relaxed">
                      <Quote className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      <span>{ouvert.contact_citation}</span>
                    </blockquote>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="gz-nom" className="text-xs">Nom</Label>
                    <Input id="gz-nom" value={brouillon.nom} placeholder="Prénom et nom"
                      onChange={(e) => setBrouillon((b) => ({ ...b, nom: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="gz-role" className="text-xs">Fonction</Label>
                    <Input id="gz-role" value={brouillon.role} placeholder="Gérant, directrice, repreneur…"
                      onChange={(e) => setBrouillon((b) => ({ ...b, role: e.target.value }))} />
                  </div>

                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    disabled={enCours === ouvert.id
                      || (brouillon.nom.trim() === (ouvert.contact_nom ?? "")
                          && brouillon.role.trim() === (ouvert.contact_role ?? ""))}
                    onClick={() => enregistrerContact(ouvert)}
                  >
                    {enCours === ouvert.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Save className="h-4 w-4" />}
                    Enregistrer le dirigeant
                  </Button>
                </div>

                <Separator />

                <div className="flex flex-col gap-2 pb-6">
                  {ouvert.statut === "converti" ? (
                    <p className="text-sm font-medium text-primary">Prospect déjà créé ✓</p>
                  ) : (
                    <Button className="w-full gap-2" disabled={enCours === ouvert.id}
                      onClick={() => creerProspect(ouvert)}>
                      {enCours === ouvert.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Plus className="h-4 w-4" />}
                      Créer le prospect
                    </Button>
                  )}
                  {ouvert.statut !== "converti" && (
                    <Button variant="ghost" className="w-full gap-2 text-muted-foreground"
                      disabled={enCours === ouvert.id}
                      onClick={() => { ignorer(ouvert); setOuvert(null); }}>
                      <X className="h-4 w-4" />Ignorer ce signal
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

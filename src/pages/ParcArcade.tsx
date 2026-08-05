import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeft, Loader2, Search, X, Gamepad2, MapPin, ExternalLink, Factory,
} from "lucide-react";

// Parc installé — ce qui tourne réellement dans les lieux de loisirs français.
//
// Deux lectures d'un même jeu de données. Côté VENTE : quelles salles ont quoi, et
// donc à qui parler de quoi. Côté ACHAT : quels modèles sont massivement déployés,
// et lesquels manquent au catalogue. Cette seconde lecture n'existe nulle part
// ailleurs dans l'outil.

type Modele = {
  slug: string; nom: string; categorie: string | null; type_jeu: string | null;
  editeur: string | null; annee: number | null; code_article: string | null;
  correspondance: string | null; salles: number;
};

type Salle = {
  id: string; slug: string; nom: string | null; ville: string | null;
  departement: string | null; region: string | null; type_lieu: string | null;
  prestations: string[] | null; fiche_url: string; site_web: string | null;
  nb_machines: number; nb_flippers: number; parc_annee_moyenne: number | null;
  prospect_id: string | null; code_client: string | null;
};

const TYPES: Record<string, string> = {
  bowling: "🎳", camping: "⛺", restaurant: "🍽️", "cinéma": "🎬",
  "salle d'arcade": "🕹️", "laser game": "🔫", "aire de jeux": "🧸", bar: "🍺",
  "réalité virtuelle": "🥽", "hôtel": "🏨", "parc d'attraction": "🎡",
  magasin: "🛍️", karting: "🏎️", "café ludique": "☕", "escape game": "🗝️",
  "karaoké": "🎤", "musée": "🏛️", "aéroport": "✈️", "complexe sportif": "🏟️",
  trampoline: "🤸", "aire d'autoroute": "🛣️", "discothèque": "🪩",
  privatisation: "🔒", "quiz box": "❓",
};
const emoji = (t: string | null) => TYPES[(t ?? "").toLowerCase()] ?? "📍";

export default function ParcArcade() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const [recherche, setRecherche] = useState("");
  const [typeChoisi, setTypeChoisi] = useState<string | null>(null);
  const [modeleOuvert, setModeleOuvert] = useState<Modele | null>(null);

  const autorise = isAdmin || isDirection;

  const { data: modeles, isFetching: chargeModeles } = useQuery({
    queryKey: ["arcade-modeles"],
    enabled: autorise,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_arcade_modeles" as any)
        .select("*").order("salles", { ascending: false }).limit(400);
      if (error) throw error;
      return (data ?? []) as unknown as Modele[];
    },
  });

  const { data: salles } = useQuery({
    queryKey: ["arcade-salles-parc"],
    enabled: autorise,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_arcade_salles_parc" as any)
        .select("*").order("nb_machines", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as Salle[];
    },
  });

  // Les salles portant le modèle ouvert, calculées à la demande : charger le parc
  // complet en amont ferait descendre plusieurs milliers de lignes pour rien.
  const { data: sallesDuModele, isFetching: chargeSalles } = useQuery({
    queryKey: ["arcade-modele-salles", modeleOuvert?.slug],
    enabled: !!modeleOuvert,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arcade_parc" as any)
        .select("salle_id").eq("machine_slug", modeleOuvert!.slug).limit(1000);
      if (error) throw error;
      const ids = new Set((data ?? []).map((r: any) => r.salle_id));
      return (salles ?? []).filter((s) => ids.has(s.id));
    },
  });

  const parType = useMemo(() => {
    const m = new Map<string, { salles: number; machines: number }>();
    for (const s of salles ?? []) {
      const t = s.type_lieu ?? "non classé";
      const e = m.get(t) ?? { salles: 0, machines: 0 };
      e.salles++; e.machines += s.nb_machines;
      m.set(t, e);
    }
    return [...m.entries()].sort((a, b) => b[1].salles - a[1].salles);
  }, [salles]);

  const parEditeur = useMemo(() => {
    const m = new Map<string, number>();
    for (const mo of modeles ?? []) {
      if (!mo.editeur || !mo.salles) continue;
      m.set(mo.editeur, (m.get(mo.editeur) ?? 0) + mo.salles);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [modeles]);

  const listeModeles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (modeles ?? [])
      .filter((m) => m.salles > 0)
      .filter((m) => !q || [m.nom, m.editeur, m.type_jeu].some((v) => (v ?? "").toLowerCase().includes(q)))
      .slice(0, 150);
  }, [modeles, recherche]);

  const listeSalles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (salles ?? [])
      .filter((s) => !typeChoisi || (s.type_lieu ?? "non classé") === typeChoisi)
      .filter((s) => !q || [s.nom, s.ville, s.departement, s.region].some((v) => (v ?? "").toLowerCase().includes(q)))
      .slice(0, 200);
  }, [salles, typeChoisi, recherche]);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!autorise) return <Navigate to="/" replace />;

  const totalSalles = (salles ?? []).length;
  const totalImplantations = (salles ?? []).reduce((n, s) => n + s.nb_machines, 0);
  const modelesDeployes = (modeles ?? []).filter((m) => m.salles > 0).length;

  return (
    <div className="flex flex-col min-h-screen">
      {/* La marge de sécurité évite que le titre passe sous l'heure et la batterie. */}
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 backdrop-blur px-4 py-3"
        style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
      >
        <Link to="/" title="Retour au menu" aria-label="Retour au menu"
          className="flex-shrink-0 -ml-1 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Gamepad2 className="h-5 w-5 flex-shrink-0" style={{ color: "hsl(var(--space-prospection))" }} />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-base sm:text-lg font-semibold truncate">Parc installé</h1>
          <p className="text-xs text-muted-foreground truncate">
            Ce qui tourne réellement dans les lieux de loisirs français
          </p>
        </div>
      </header>

      <div className="border-b border-border bg-muted/20 px-4 py-2">
        <div className="relative w-full sm:w-[320px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder="Chercher un modèle, un fabricant, une salle…" className="h-9 pl-8 pr-8 text-xs" />
          {recherche && (
            <button type="button" onClick={() => setRecherche("")} title="Effacer"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 px-4 py-4 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: totalSalles, l: "lieux recensés" },
            { v: totalImplantations, l: "machines installées" },
            { v: modelesDeployes, l: "modèles distincts" },
          ].map((k) => (
            <Card key={k.l} className="p-3 text-center">
              <div className="text-xl font-semibold tabular-nums">{k.v.toLocaleString("fr-FR")}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">{k.l}</div>
            </Card>
          ))}
        </div>

        {/* Chaque type est un filtre : la répartition n'est pas qu'un décor, elle mène
            à la liste correspondante. */}
        <section className="space-y-2">
          <h2 className="font-display text-sm font-semibold">Par type de lieu</h2>
          <div className="flex flex-wrap gap-1.5">
            {parType.map(([t, e]) => (
              <button key={t} type="button" onClick={() => setTypeChoisi(typeChoisi === t ? null : t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  typeChoisi === t ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-foreground/40",
                )}>
                <span aria-hidden>{emoji(t)}</span>
                <span className="capitalize">{t}</span>
                <span className="tabular-nums font-medium">{e.salles}</span>
              </button>
            ))}
          </div>
        </section>

        {parEditeur.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-display text-sm font-semibold flex items-center gap-1.5">
              <Factory className="h-4 w-4 text-muted-foreground" />Par fabricant
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Nombre d'implantations recensées. C'est la mesure de ton périmètre : un fabricant
              très présent que tu ne distribues pas est une question d'achat, pas de vente.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {parEditeur.map(([e, n]) => (
                <Badge key={e} variant="outline" className="h-6 gap-1.5 px-2 text-[11px]">
                  {e}<span className="tabular-nums font-semibold">{n}</span>
                </Badge>
              ))}
            </div>
          </section>
        )}

        <Separator />

        <section className="space-y-2">
          <h2 className="font-display text-sm font-semibold">Modèles les plus déployés</h2>
          {chargeModeles && !modeles ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : (
            <div className="space-y-1">
              {listeModeles.map((m) => (
                <button key={m.slug} type="button" onClick={() => setModeleOuvert(m)}
                  className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:border-primary/40">
                  <span className="w-10 flex-shrink-0 text-right text-sm font-semibold tabular-nums">{m.salles}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium capitalize">{m.nom}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[m.editeur, m.annee, m.type_jeu].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  {m.categorie === "flipper" && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">flipper</Badge>
                  )}
                </button>
              ))}
              {listeModeles.length === 0 && (
                <Card className="p-4 text-center text-sm text-muted-foreground">
                  Aucun modèle ne correspond. La lecture des fiches est peut-être encore en cours.
                </Card>
              )}
            </div>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="font-display text-sm font-semibold">
            Lieux{typeChoisi && <span className="text-muted-foreground font-normal"> · {typeChoisi}</span>}
          </h2>
          <div className="space-y-1">
            {listeSalles.map((s) => (
              <a key={s.id} href={s.fiche_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40">
                <span className="w-8 flex-shrink-0 text-right text-sm font-semibold tabular-nums">{s.nb_machines}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    <span aria-hidden className="mr-1">{emoji(s.type_lieu)}</span>{s.nom ?? s.slug}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[s.ville, s.departement, s.region].filter(Boolean).join(" · ")}
                    {s.nb_flippers > 0 && ` · ${s.nb_flippers} flipper${s.nb_flippers > 1 ? "s" : ""}`}
                    {s.parc_annee_moyenne ? ` · parc ${s.parc_annee_moyenne}` : ""}
                  </span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </section>
      </main>

      <Sheet open={!!modeleOuvert} onOpenChange={(o) => { if (!o) setModeleOuvert(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto"
          style={{ paddingTop: "calc(1.5rem + var(--safe-top))" }}>
          {modeleOuvert && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-base capitalize">{modeleOuvert.nom}</SheetTitle>
                <p className="text-xs text-muted-foreground">
                  {[modeleOuvert.editeur, modeleOuvert.annee, modeleOuvert.type_jeu].filter(Boolean).join(" · ") || "—"}
                </p>
              </SheetHeader>
              <div className="mt-4 space-y-3">
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{modeleOuvert.salles}</span>{" "}
                  {modeleOuvert.salles > 1 ? "lieux recensés" : "lieu recensé"} en France
                </p>
                <Button asChild variant="outline" className="w-full gap-2">
                  <a href={`https://www.annuaire-arcade.fr/${modeleOuvert.categorie ?? "jeu"}/${modeleOuvert.slug}/`}
                    target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />Fiche du modèle
                  </a>
                </Button>
                <Separator />
                {chargeSalles ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement des lieux…
                  </div>
                ) : (
                  <div className="space-y-1 pb-6">
                    {(sallesDuModele ?? []).map((s) => (
                      <div key={s.id} className="rounded-md border border-border px-2.5 py-1.5">
                        <div className="truncate text-[13px] font-medium">
                          <span aria-hidden className="mr-1">{emoji(s.type_lieu)}</span>{s.nom ?? s.slug}
                        </div>
                        <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {[s.ville, s.departement].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    ))}
                    {(sallesDuModele ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun lieu chargé pour ce modèle.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

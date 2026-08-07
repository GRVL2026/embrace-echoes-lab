import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
// L'infobulle autonome, et non celle de ui/chart : cette dernière appelle useChart()
// et LÈVE une exception hors d'un ChartContainer — la page devenait un écran noir.
import { ChartTooltipContent } from "@/components/admin/chartTooltip";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
} from "recharts";
import {
  ArrowLeft, Loader2, Search, X, Gamepad2, MapPin, ExternalLink, ChevronRight,
} from "lucide-react";

// Parc installé — 939 lieux de loisirs français et les 6 900 machines qui y tournent.
//
// La première version de cet écran était un tableau de chiffres : Léopaul n'a pas su
// quoi en faire, et il avait raison. Une page d'analyse doit poser des QUESTIONS et y
// répondre visuellement, pas empiler des listes. Chaque section porte donc une question
// commerciale, un graphique qui y répond, et une phrase disant quoi en faire. Tout est
// cliquable : une part de camembert, une barre, une ligne ouvrent le détail.

type Modele = {
  slug: string; nom: string; categorie: string | null; type_jeu: string | null;
  editeur: string | null; annee: number | null; code_article: string | null;
  correspondance: string | null; salles: number;
};

type Salle = {
  id: string; slug: string; nom: string | null; ville: string | null;
  departement: string | null; region: string | null; type_lieu: string | null;
  fiche_url: string; site_web: string | null;
  nb_machines: number; nb_flippers: number; parc_annee_moyenne: number | null;
};

type Lien = { salle_id: string; machine_slug: string };

type Detail =
  | { genre: "type"; valeur: string }
  | { genre: "fabricant"; valeur: string }
  | { genre: "modele"; modele: Modele };

const COULEURS = ["#9B5CFF", "#ADFF00", "#5CC8FF", "#FF6B9D", "#FFB800", "#7CE0FF",
  "#FFA07A", "#A78BFA", "#34D399", "#F472B6", "#FBBF24", "#B0B0B0"];

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

// L'année n'est plus exploitée : l'annuaire donne l'année de SORTIE du modèle, pas
// celle de son achat. Présentée comme l'âge d'un parc, elle induisait en erreur — un
// lieu qui renouvelle chaque année et un lieu figé depuis dix ans obtenaient la même
// moyenne. La donnée reste en base, elle n'a simplement rien à faire dans un écran
// d'aide à la décision.

export default function ParcArcade() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const [recherche, setRecherche] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const autorise = isAdmin || isDirection;

  const { data: modeles } = useQuery({
    queryKey: ["arcade-modeles"],
    enabled: autorise, staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_arcade_modeles" as any).select("*")
        .order("salles", { ascending: false }).limit(1200);
      if (error) throw error;
      return (data ?? []) as unknown as Modele[];
    },
  });

  const { data: salles } = useQuery({
    queryKey: ["arcade-salles-parc"],
    enabled: autorise, staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_arcade_salles_parc" as any).select("*")
        .order("nb_machines", { ascending: false }).limit(1200);
      if (error) throw error;
      return (data ?? []) as unknown as Salle[];
    },
  });

  // Le lien salle × machine est chargé une fois, en entier. Sept mille couples pèsent
  // peu et rendent TOUT croisable côté navigateur : cliquer un fabricant pour voir ses
  // lieux ne coûte alors aucun aller-retour.
  const { data: liens } = useQuery({
    queryKey: ["arcade-parc-liens"],
    enabled: autorise, staleTime: 300_000,
    queryFn: async () => {
      const tout: Lien[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await supabase
          .from("arcade_parc" as any).select("salle_id, machine_slug").range(de, de + 999);
        if (error) throw error;
        tout.push(...((data ?? []) as unknown as Lien[]));
        if (!data || data.length < 1000) break;
      }
      return tout;
    },
  });

  const parModele = useMemo(() => {
    const m = new Map<string, Modele>();
    for (const x of modeles ?? []) m.set(x.slug, x);
    return m;
  }, [modeles]);

  const parSalle = useMemo(() => {
    const m = new Map<string, Salle>();
    for (const s of salles ?? []) m.set(s.id, s);
    return m;
  }, [salles]);

  const typesData = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of salles ?? []) {
      const t = s.type_lieu ?? "non classé";
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].map(([nom, valeur]) => ({ nom, valeur }))
      .sort((a, b) => b.valeur - a.valeur);
  }, [salles]);

  const fabricantsData = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of modeles ?? []) {
      if (!x.editeur || !x.salles) continue;
      m.set(x.editeur, (m.get(x.editeur) ?? 0) + x.salles);
    }
    return [...m.entries()].map(([nom, valeur]) => ({ nom, valeur }))
      .sort((a, b) => b.valeur - a.valeur).slice(0, 12);
  }, [modeles]);

  const modelesTop = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return (modeles ?? [])
      .filter((m) => m.salles > 0)
      .filter((m) => !q || [m.nom, m.editeur, m.type_jeu].some((v) => (v ?? "").toLowerCase().includes(q)))
      .slice(0, q ? 40 : 15)
      .map((m) => ({ ...m, nomCourt: m.nom.length > 26 ? m.nom.slice(0, 25) + "…" : m.nom }));
  }, [modeles, recherche]);

  // Les lieux concernés par ce qui vient d'être cliqué.
  const lieuxDuDetail = useMemo((): Salle[] => {
    if (!detail) return [];
    if (detail.genre === "type") {
      return (salles ?? []).filter((s) => (s.type_lieu ?? "non classé") === detail.valeur);
    }
    const slugsRetenus = new Set(
      (modeles ?? []).filter((m) => {
        if (detail.genre === "fabricant") return m.editeur === detail.valeur;
        return m.slug === detail.modele.slug;
      }).map((m) => m.slug),
    );
    const ids = new Set((liens ?? []).filter((l) => slugsRetenus.has(l.machine_slug)).map((l) => l.salle_id));
    return [...ids].map((id) => parSalle.get(id)).filter(Boolean) as Salle[];
  }, [detail, salles, modeles, liens, parSalle]);

  // Les modèles d'un TYPE DE LIEU, avec leur sur- ou sous-représentation. Le simple
  // classement ne dit pas grand-chose : les mêmes gros titres sortent partout. Ce qui
  // est instructif, c'est l'ÉCART à la moyenne nationale — un modèle présent dans 30 %
  // des cinémas contre 19 % de l'ensemble révèle une affinité, et donc un argument.
  const modelesDuType = useMemo(() => {
    if (detail?.genre !== "type") return [];
    const duType = new Set(
      (salles ?? []).filter((s) => (s.type_lieu ?? "non classé") === detail.valeur).map((s) => s.id),
    );
    if (duType.size < 5) return [];   // sous cinq lieux, un « classement » n'en est pas un
    const dansLeType = new Map<string, number>();
    const partout = new Map<string, number>();
    for (const l of liens ?? []) {
      partout.set(l.machine_slug, (partout.get(l.machine_slug) ?? 0) + 1);
      if (duType.has(l.salle_id)) dansLeType.set(l.machine_slug, (dansLeType.get(l.machine_slug) ?? 0) + 1);
    }
    const totalLieux = (salles ?? []).length || 1;
    return [...dansLeType.entries()]
      .map(([slug, n]) => {
        const m = parModele.get(slug);
        const pctType = (n / duType.size) * 100;
        const pctPartout = ((partout.get(slug) ?? 0) / totalLieux) * 100;
        return {
          slug, nom: m?.nom ?? slug, editeur: m?.editeur ?? null,
          categorie: m?.categorie ?? null, modele: m,
          lieux: n, pctType, pctPartout,
          indice: pctPartout > 0 ? pctType / pctPartout : 1,
        };
      })
      .filter((x) => x.lieux >= 3)
      .sort((a, b) => b.lieux - a.lieux)
      .slice(0, 20);
  }, [detail, salles, liens, parModele]);

  // Symétrique du précédent : pour un fabricant, DANS QUELS TYPES DE LIEUX il est
  // présent. Une liste de quatre cent quatre-vingts noms d'établissements ne se lit
  // pas ; savoir que Namco est deux fois plus présent au cinéma qu'ailleurs se lit,
  // et se travaille.
  const typesDuFabricant = useMemo(() => {
    if (detail?.genre !== "fabricant") return [];
    const slugs = new Set(
      (modeles ?? []).filter((m) => m.editeur === detail.valeur).map((m) => m.slug),
    );
    if (!slugs.size) return [];
    const equipes = new Set<string>();
    for (const l of liens ?? []) if (slugs.has(l.machine_slug)) equipes.add(l.salle_id);

    const parTypeTotal = new Map<string, number>();
    const parTypeEquipe = new Map<string, number>();
    for (const sa of salles ?? []) {
      const t = sa.type_lieu ?? "non classé";
      parTypeTotal.set(t, (parTypeTotal.get(t) ?? 0) + 1);
      if (equipes.has(sa.id)) parTypeEquipe.set(t, (parTypeEquipe.get(t) ?? 0) + 1);
    }
    const pctGlobal = ((salles ?? []).length ? equipes.size / (salles ?? []).length : 0) * 100;
    return [...parTypeEquipe.entries()]
      .map(([type, n]) => {
        const total = parTypeTotal.get(type) ?? 1;
        const pct = (n / total) * 100;
        return { type, lieux: n, total, pct, indice: pctGlobal > 0 ? pct / pctGlobal : 1 };
      })
      .filter((x) => x.total >= 5)
      .sort((a, b) => b.lieux - a.lieux);
  }, [detail, modeles, liens, salles]);

  const modelesDuDetail = useMemo((): Modele[] => {
    if (detail?.genre !== "fabricant") return [];
    return (modeles ?? []).filter((m) => m.editeur === detail.valeur && m.salles > 0).slice(0, 40);
  }, [detail, modeles]);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!autorise) return <Navigate to="/" replace />;

  const pret = !!salles && !!modeles && !!liens;
  const totalMachines = (salles ?? []).reduce((n, s) => n + s.nb_machines, 0);
  const sansFlipper = (salles ?? []).filter((s) => s.nb_machines > 0 && s.nb_flippers === 0).length;

  const titreDetail = !detail ? ""
    : detail.genre === "modele" ? detail.modele.nom
    : detail.genre === "fabricant" ? detail.valeur
    : detail.valeur;

  return (
    <div className="flex flex-col min-h-screen">
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
            Ce qui tourne chez les concurrents, et chez tes futurs clients
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-6 pb-16">
        {!pret && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement du parc…
          </div>
        )}

        {/* Trois chiffres qui sont trois occasions, pas trois totaux. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Card className="p-3">
            <div className="text-2xl font-semibold tabular-nums">{totalMachines.toLocaleString("fr-FR")}</div>
            <div className="text-[11px] text-muted-foreground">machines installées dans {(salles ?? []).length} lieux</div>
          </Card>
          <button type="button" onClick={() => setDetail({ genre: "type", valeur: "bowling" })}
            className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40">
            <div className="text-2xl font-semibold tabular-nums text-emerald-500">{sansFlipper}</div>
            <div className="text-[11px] text-muted-foreground">lieux équipés <strong>sans aucun flipper</strong></div>
          </button>
        </div>

        {/* ── Question 1 ─────────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">Quels lieux s'équipent&nbsp;?</h2>
          <p className="text-xs text-muted-foreground">
            Clique une part pour ouvrir la liste des lieux de ce type, avec leur parc.
          </p>
          <Card className="p-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div style={{ width: "100%", maxWidth: 260, height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={typesData} dataKey="valeur" nameKey="nom" cx="50%" cy="50%"
                      innerRadius={52} outerRadius={100} paddingAngle={1} cursor="pointer"
                      stroke="hsl(var(--background))" strokeWidth={2}
                      onClick={(d: any) => {
                        const n = (d?.payload ?? d)?.nom;
                        if (n) setDetail({ genre: "type", valeur: n });
                      }}>
                      {typesData.map((_, i) => <Cell key={i} fill={COULEURS[i % COULEURS.length]} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltipContent hideLabel
                      formatter={(v: any, _n: any, it: any) => [`${v} lieux`, it?.payload?.nom]} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 w-full grid grid-cols-2 gap-1">
                {typesData.slice(0, 10).map((t, i) => (
                  <button key={t.nom} type="button" onClick={() => setDetail({ genre: "type", valeur: t.nom })}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted">
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                      style={{ background: COULEURS[i % COULEURS.length] }} />
                    <span aria-hidden>{emoji(t.nom)}</span>
                    <span className="flex-1 truncate capitalize">{t.nom}</span>
                    <span className="tabular-nums font-semibold">{t.valeur}</span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </section>

        {/* ── Question 2 ─────────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">Qui équipe le marché&nbsp;?</h2>
          <p className="text-xs text-muted-foreground">
            Nombre de machines installées par fabricant. Un fabricant très présent que tu ne
            distribues pas est une décision d'achat, pas une piste de vente.
          </p>
          <Card className="p-3">
            <div style={{ width: "100%", height: Math.max(220, fabricantsData.length * 26) }}>
              <ResponsiveContainer>
                <BarChart data={fabricantsData} layout="vertical" margin={{ left: 4, right: 34, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                  <XAxis type="number" hide />
                  {/* interval={0} force l'affichage de TOUTES les étiquettes. Par
                      défaut Recharts en saute pour gagner de la place, et un graphique
                      qui nomme un fabricant sur deux ne se lit pas : on ne sait pas à
                      qui appartient la barre qu'on regarde. */}
                  <YAxis type="category" dataKey="nom" width={132} tickLine={false} axisLine={false}
                    interval={0} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted)/0.4)" }}
                    content={<ChartTooltipContent hideLabel
                      formatter={(v: any, _n: any, it: any) => [`${v} machines`, it?.payload?.nom]} />} />
                  <Bar dataKey="valeur" radius={[0, 4, 4, 0]} cursor="pointer"
                    onClick={(d: any) => {
                      const n = (d?.payload ?? d)?.nom;
                      if (n) setDetail({ genre: "fabricant", valeur: n });
                    }}>
                    {fabricantsData.map((_, i) => <Cell key={i} fill={COULEURS[i % COULEURS.length]} />)}
                    <LabelList dataKey="valeur" position="right"
                      style={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>

        {/* ── Question 4 ─────────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold">Quels modèles sont partout&nbsp;?</h2>
            <div className="relative w-full sm:w-[240px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={recherche} onChange={(e) => setRecherche(e.target.value)}
                placeholder="Chercher un modèle…" className="h-8 pl-8 pr-8 text-xs" />
              {recherche && (
                <button type="button" onClick={() => setRecherche("")} title="Effacer"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Nombre de lieux équipés. Clique un modèle pour voir lesquels.
          </p>
          <Card className="p-1">
            {modelesTop.map((m) => (
              <button key={m.slug} type="button" onClick={() => setDetail({ genre: "modele", modele: m })}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                <span className="w-9 flex-shrink-0 text-right text-sm font-semibold tabular-nums">{m.salles}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium capitalize">{m.nom}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {[m.editeur, m.annee, m.type_jeu].filter(Boolean).join(" · ") || "métadonnées inconnues"}
                  </span>
                </span>
                {/* Une barre proportionnelle vaut mieux qu'un nombre seul : on voit
                    immédiatement le décrochage entre le troisième et le dixième. */}
                <span className="hidden sm:block h-1.5 w-24 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((m.salles / (modelesTop[0]?.salles || 1)) * 100)}%` }} />
                </span>
                {m.categorie === "flipper" && (
                  <Badge variant="outline" className="h-5 flex-shrink-0 px-1.5 text-[10px]">flipper</Badge>
                )}
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </button>
            ))}
            {modelesTop.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">Aucun modèle ne correspond.</p>
            )}
          </Card>
        </section>
      </main>

      <Sheet open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto"
          style={{ paddingTop: "calc(1.5rem + var(--safe-top))" }}>
          {detail && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-base capitalize">{titreDetail}</SheetTitle>
                <p className="text-xs text-muted-foreground">
                  {detail.genre === "modele"
                    ? [detail.modele.editeur, detail.modele.annee, detail.modele.type_jeu].filter(Boolean).join(" · ") || "métadonnées inconnues"
                    : `${lieuxDuDetail.length} lieu${lieuxDuDetail.length > 1 ? "x" : ""} concerné${lieuxDuDetail.length > 1 ? "s" : ""}`}
                </p>
              </SheetHeader>

              <div className="mt-4 space-y-3 pb-8">
                {detail.genre === "modele" && (
                  <p className="rounded-md bg-muted/40 p-3 text-[13px]">
                    Installé dans <strong className="tabular-nums">{detail.modele.salles}</strong> lieux recensés.
                  </p>
                )}

                {modelesDuDetail.length > 0 && (
                  <>
                    <h3 className="text-sm font-semibold">Modèles de ce fabricant</h3>
                    {/* Une liste ordonnée avec sa barre, et non une nuée d'étiquettes :
                        vingt-cinq pastilles de même taille ne disent pas lequel pèse.
                        Ici le décrochage entre le premier et le dixième se voit. */}
                    <div className="space-y-0.5">
                      {modelesDuDetail.map((m) => (
                        <button
                          key={m.slug}
                          type="button"
                          onClick={() => setDetail({ genre: "modele", modele: m })}
                          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                        >
                          <span className="w-8 flex-shrink-0 text-right text-[13px] font-semibold tabular-nums">
                            {m.salles}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] capitalize">{m.nom}</span>
                          <span className="hidden sm:block h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary"
                              style={{ width: `${Math.round((m.salles / (modelesDuDetail[0]?.salles || 1)) * 100)}%` }} />
                          </span>
                          {m.categorie === "flipper" && (
                            <Badge variant="outline" className="h-4 flex-shrink-0 px-1 text-[9px]">flipper</Badge>
                          )}
                        </button>
                      ))}
                    </div>
                    <Separator />
                  </>
                )}

                {typesDuFabricant.length > 0 && (
                  <>
                    <h3 className="text-sm font-semibold">Où ce fabricant est présent</h3>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Part des lieux de chaque type qui possèdent au moins une de ses machines.
                      La flèche compare à sa présence moyenne, tous types confondus.
                    </p>
                    <div className="space-y-0.5">
                      {typesDuFabricant.map((t) => {
                        const fort = t.indice >= 1.3, faible = t.indice <= 0.7;
                        return (
                          <button key={t.type} type="button"
                            onClick={() => setDetail({ genre: "type", valeur: t.type })}
                            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted">
                            <span className="w-11 flex-shrink-0 text-right text-[13px] font-semibold tabular-nums">
                              {Math.round(t.pct)} %
                            </span>
                            <span aria-hidden className="flex-shrink-0">{emoji(t.type)}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] capitalize">{t.type}</span>
                            <span className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              {t.lieux}/{t.total}
                            </span>
                            <span className="hidden sm:block h-1.5 w-16 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-primary"
                                style={{ width: `${Math.min(100, Math.round(t.pct))}%` }} />
                            </span>
                            {(fort || faible) && (
                              <span className={cn("flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
                                fort ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                     : "bg-muted text-muted-foreground")}>
                                ×{t.indice.toFixed(1)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <Separator />
                  </>
                )}

                {modelesDuType.length > 0 && (
                  <>
                    <h3 className="text-sm font-semibold">Ce qu'on y trouve</h3>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Part des {detail.genre === "type" ? detail.valeur : "lieux"} équipés de chaque modèle.
                      La flèche compare à la moyenne de tous les lieux : elle signale une affinité
                      avec ce type d'établissement.
                    </p>
                    <div className="space-y-0.5">
                      {modelesDuType.map((m) => {
                        const fort = m.indice >= 1.4;
                        const faible = m.indice <= 0.65;
                        return (
                          <button key={m.slug} type="button"
                            onClick={() => m.modele && setDetail({ genre: "modele", modele: m.modele })}
                            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted">
                            <span className="w-11 flex-shrink-0 text-right text-[13px] font-semibold tabular-nums">
                              {Math.round(m.pctType)} %
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] capitalize">{m.nom}</span>
                              {m.editeur && (
                                <span className="block truncate text-[10px] text-muted-foreground">{m.editeur}</span>
                              )}
                            </span>
                            <span className="hidden sm:block h-1.5 w-16 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-primary"
                                style={{ width: `${Math.min(100, Math.round(m.pctType))}%` }} />
                            </span>
                            {/* L'écart à la moyenne, seulement quand il est net : signaler
                                un indice de 1,05 comme une affinité serait du bruit. */}
                            {(fort || faible) && (
                              <span className={cn("flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
                                fort ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                     : "bg-muted text-muted-foreground")}>
                                {fort ? "×" : "×"}{m.indice.toFixed(1)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <Separator />
                  </>
                )}

                <h3 className="text-sm font-semibold">
                  Lieux
                  {(typesDuFabricant.length > 0 || modelesDuType.length > 0) && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      — du mieux équipé au moins équipé
                    </span>
                  )}
                </h3>
                <div className="space-y-1">
                  {lieuxDuDetail
                    .sort((a, b) => b.nb_machines - a.nb_machines)
                    .slice(0, 80)
                    .map((s) => (
                      <a key={s.id} href={s.fiche_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 transition-colors hover:border-primary/40">
                        <span className="w-7 flex-shrink-0 text-right text-[13px] font-semibold tabular-nums">
                          {s.nb_machines}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            <span aria-hidden className="mr-1">{emoji(s.type_lieu)}</span>{s.nom ?? s.slug}
                          </span>
                          <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {[s.ville, s.departement, s.region].filter(Boolean).join(" · ") || "—"}
                            {s.nb_flippers === 0 && s.nb_machines > 0 && " · aucun flipper"}
                          </span>
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      </a>
                    ))}
                  {lieuxDuDetail.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Aucun lieu — la lecture des fiches est peut-être encore en cours.
                    </p>
                  )}
                  {lieuxDuDetail.length > 80 && (
                    <p className="pt-1 text-[11px] text-muted-foreground">
                      80 premiers affichés sur {lieuxDuDetail.length}, du mieux équipé au moins équipé.
                    </p>
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

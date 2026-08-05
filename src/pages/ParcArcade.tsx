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
import { ChartTooltipContent } from "@/components/ui/chart";
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
  | { genre: "age"; valeur: string; min: number; max: number }
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

// Tranches d'âge du parc. Dix ans est la frontière qui compte : au-delà, une machine
// n'attire plus, et son exploitant le sait avant nous.
const TRANCHES = [
  { label: "2022 et après", min: 2022, max: 9999, ton: "#34D399" },
  { label: "2016 → 2021", min: 2016, max: 2021, ton: "#ADFF00" },
  { label: "2010 → 2015", min: 2010, max: 2015, ton: "#FFB800" },
  { label: "2000 → 2009", min: 2000, max: 2009, ton: "#FF6B9D" },
  { label: "avant 2000", min: 0, max: 1999, ton: "#9B5CFF" },
];

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

  const agesData = useMemo(() => {
    const compte = new Map<string, number>();
    for (const l of liens ?? []) {
      const an = parModele.get(l.machine_slug)?.annee;
      if (!an) continue;
      const t = TRANCHES.find((x) => an >= x.min && an <= x.max);
      if (t) compte.set(t.label, (compte.get(t.label) ?? 0) + 1);
    }
    return TRANCHES.map((t) => ({ nom: t.label, valeur: compte.get(t.label) ?? 0, ton: t.ton }));
  }, [liens, parModele]);

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
        if (detail.genre === "age") return m.annee != null && m.annee >= detail.min && m.annee <= detail.max;
        return m.slug === detail.modele.slug;
      }).map((m) => m.slug),
    );
    const ids = new Set((liens ?? []).filter((l) => slugsRetenus.has(l.machine_slug)).map((l) => l.salle_id));
    return [...ids].map((id) => parSalle.get(id)).filter(Boolean) as Salle[];
  }, [detail, salles, modeles, liens, parSalle]);

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
  const parcAncien = (salles ?? []).filter((s) => s.parc_annee_moyenne != null && s.parc_annee_moyenne < 2016).length;

  const titreDetail = !detail ? ""
    : detail.genre === "modele" ? detail.modele.nom
    : detail.genre === "fabricant" ? detail.valeur
    : detail.genre === "age" ? `Parc ${detail.valeur}`
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Card className="p-3">
            <div className="text-2xl font-semibold tabular-nums">{totalMachines.toLocaleString("fr-FR")}</div>
            <div className="text-[11px] text-muted-foreground">machines installées dans {(salles ?? []).length} lieux</div>
          </Card>
          <button type="button" onClick={() => setDetail({ genre: "type", valeur: "bowling" })}
            className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40">
            <div className="text-2xl font-semibold tabular-nums text-emerald-500">{sansFlipper}</div>
            <div className="text-[11px] text-muted-foreground">lieux équipés <strong>sans aucun flipper</strong></div>
          </button>
          <button type="button" onClick={() => setDetail({ genre: "age", valeur: "2010 → 2015", min: 0, max: 2015 })}
            className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40">
            <div className="text-2xl font-semibold tabular-nums text-amber-500">{parcAncien}</div>
            <div className="text-[11px] text-muted-foreground">lieux dont le parc date d'<strong>avant 2016</strong></div>
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
                  <YAxis type="category" dataKey="nom" width={124} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
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

        {/* ── Question 3 ─────────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold">Quel âge a le parc&nbsp;?</h2>
          <p className="text-xs text-muted-foreground">
            Une machine de plus de dix ans n'attire plus, et son exploitant le sait avant toi.
            Clique une tranche pour voir les lieux concernés.
          </p>
          <Card className="p-3">
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={agesData} margin={{ left: 4, right: 4, top: 16, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                  <XAxis dataKey="nom" tickLine={false} axisLine={false}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: "hsl(var(--muted)/0.4)" }}
                    content={<ChartTooltipContent hideLabel
                      formatter={(v: any, _n: any, it: any) => [`${v} machines`, it?.payload?.nom]} />} />
                  <Bar dataKey="valeur" radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(d: any) => {
                      const p = d?.payload ?? d;
                      const t = TRANCHES.find((x) => x.label === p?.nom);
                      if (t) setDetail({ genre: "age", valeur: t.label, min: t.min, max: t.max });
                    }}>
                    {agesData.map((a, i) => <Cell key={i} fill={a.ton} />)}
                    <LabelList dataKey="valeur" position="top"
                      style={{ fontSize: 11, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Seules les machines dont l'année est connue sont comptées.
            </p>
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
                    <div className="flex flex-wrap gap-1">
                      {modelesDuDetail.map((m) => (
                        <Badge key={m.slug} variant="outline" className="h-5 gap-1 px-1.5 text-[10px] capitalize">
                          {m.nom}<span className="tabular-nums font-semibold">{m.salles}</span>
                        </Badge>
                      ))}
                    </div>
                    <Separator />
                  </>
                )}

                <h3 className="text-sm font-semibold">Lieux</h3>
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

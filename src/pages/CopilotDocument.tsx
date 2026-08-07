import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as InfobulleGraphique,
} from "recharts";
import { ArrowLeft, Loader2, Printer, Link2, Map as MapIcon, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartTooltipContent } from "@/components/admin/chartTooltip";
import { cn } from "@/lib/utils";

// Rendu d'un document produit par le copilote.
//
// Le copilote répond librement dans le fil ; il ne crée un document que si on le lui
// demande. Cette page affiche ce document — et rien d'autre : pas de barre latérale, pas
// de navigation parasite. C'est une page qu'on lit, qu'on imprime et qu'on envoie.
//
// L'EXPORT PDF PASSE PAR L'IMPRESSION DU NAVIGATEUR, pas par html2canvas. La capture
// d'écran produit une image : texte non sélectionnable, illisible au zoom, et lourde.
// L'impression rend un PDF vectoriel, et sur iPhone le menu de partage propose
// « Enregistrer au format PDF » sans qu'on ait une ligne de code à écrire.

type Chiffre = { valeur: string; libelle: string; alerte?: boolean };
type Section = { titre: string; corps: string; citation?: string };
type Graphique = {
  type: "ligne" | "barres" | "donut";
  titre: string; commentaire?: string; unite?: string;
  donnees: { x: string; y: number }[];
};
type Action = {
  titre: string; pourquoi: string; principe?: string;
  echeance: string; urgence: "immediat" | "court_terme" | "fond";
  resultat_attendu?: string;
};
type Prospect = { priorite: "P1" | "P2" | "P3"; nom: string; lieu?: string; contact?: string; pourquoi: string };

type Contenu = {
  resume?: string;
  chiffres_cles?: Chiffre[];
  sections?: Section[];
  graphiques?: Graphique[];
  actions?: Action[];
  prospects?: Prospect[];
  carte?: { question: string; libelle: string };
  sources?: string;
};

type Doc = { id: string; titre: string; sujet: string | null; contenu: Contenu; created_at: string };

const COULEURS = ["#8B5CF6", "#22D3EE", "#F5A524", "#34D399", "#F87171", "#A78BFA"];

const URGENCE: Record<Action["urgence"], { texte: string; classe: string }> = {
  immediat: { texte: "Immédiat", classe: "bg-destructive/15 text-destructive" },
  court_terme: { texte: "Court terme", classe: "bg-amber-500/15 text-amber-500" },
  fond: { texte: "Travail de fond", classe: "bg-emerald-500/15 text-emerald-500" },
};

const PRIORITE: Record<Prospect["priorite"], string> = {
  P1: "bg-destructive/15 text-destructive",
  P2: "bg-amber-500/15 text-amber-500",
  P3: "bg-muted text-muted-foreground",
};

function Graph({ g }: { g: Graphique }) {
  const data = g.donnees.map((d) => ({ nom: d.x, valeur: d.y }));
  const infobulle = (
    <InfobulleGraphique
      content={<ChartTooltipContent hideLabel
        formatter={(v: any, _n: any, it: any) =>
          [`${Number(v).toLocaleString("fr-FR")}${g.unite ? ` ${g.unite}` : ""}`, it?.payload?.nom]} />} />
  );
  return (
    <Card className="p-4 break-inside-avoid">
      <p className="text-sm font-semibold">{g.titre}</p>
      {g.commentaire && <p className="mt-0.5 text-xs text-muted-foreground">{g.commentaire}</p>}
      <div className="mt-3" style={{ width: "100%", height: g.type === "barres" ? Math.max(200, data.length * 26) : 240 }}>
        <ResponsiveContainer>
          {g.type === "ligne" ? (
            <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="nom" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              {infobulle}
              <Line type="monotone" dataKey="valeur" stroke={COULEURS[0]} strokeWidth={2} dot={false} />
            </LineChart>
          ) : g.type === "barres" ? (
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
              <XAxis type="number" hide />
              {/* interval={0} force TOUTES les étiquettes : un graphique qui nomme une
                  barre sur deux ne se lit pas, on ne sait pas ce qu'on regarde. */}
              <YAxis type="category" dataKey="nom" width={128} interval={0} tickLine={false} axisLine={false}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              {infobulle}
              <Bar dataKey="valeur" radius={[0, 4, 4, 0]} fill={COULEURS[0]} />
            </BarChart>
          ) : (
            <PieChart>
              <Pie data={data} dataKey="valeur" nameKey="nom" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
                {data.map((_, i) => <Cell key={i} fill={COULEURS[i % COULEURS.length]} />)}
              </Pie>
              {infobulle}
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
      {g.type === "donut" && (
        <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
          {data.map((d, i) => (
            <span key={d.nom} className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: COULEURS[i % COULEURS.length] }} />
              <span className="flex-1 truncate text-muted-foreground">{d.nom}</span>
              <span className="font-semibold tabular-nums">{d.valeur.toLocaleString("fr-FR")}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function CopilotDocument() {
  const { id } = useParams<{ id: string }>();
  const { isDirection, isAdmin, isLoading } = useAuth();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (!id) return;
    let annule = false;
    (async () => {
      const { data, error } = await supabase
        .from("copilot_documents")
        .select("id, titre, sujet, contenu, created_at")
        .eq("id", id)
        .maybeSingle();
      if (annule) return;
      if (error) setErreur(error.message);
      else if (!data) setErreur("Ce document n'existe pas ou n'est plus accessible.");
      else setDoc(data as unknown as Doc);
    })();
    return () => { annule = true; };
  }, [id]);

  const c = doc?.contenu;
  const dateTexte = useMemo(
    () => doc ? new Date(doc.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "",
    [doc],
  );

  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch { /* le presse-papier peut être refusé hors HTTPS */ }
  };

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!isDirection && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Accès réservé à l'administration et à la direction.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* La barre ne s'imprime pas : elle appartient à l'écran, pas au document. */}
      <header
        className="print:hidden sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
      >
        <Link to="/admin/gaia" aria-label="Retour au copilote"
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex-1 truncate text-xs uppercase tracking-wider text-muted-foreground">Document</span>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copierLien}>
          {copie ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
          <span className="hidden sm:inline">{copie ? "Copié" : "Copier le lien"}</span>
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline">PDF</span>
        </Button>
      </header>

      {erreur && <p className="mx-auto max-w-3xl px-5 py-16 text-center text-sm text-muted-foreground">{erreur}</p>}
      {!doc && !erreur && (
        <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}

      {doc && c && (
        <article className="mx-auto max-w-3xl space-y-12 px-5 pb-24 pt-8">
          <header className="space-y-3">
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-4xl" style={{ textWrap: "balance" }}>
              {doc.titre}
            </h1>
            {c.resume && <p className="text-base leading-relaxed text-muted-foreground">{c.resume}</p>}
            <p className="text-xs text-muted-foreground">
              {dateTexte}
              {doc.sujet && <> · à la suite de : « {doc.sujet} »</>}
            </p>
          </header>

          {c.chiffres_cles && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {c.chiffres_cles.map((k) => (
                <Card key={k.libelle} className="p-3">
                  <b className={cn("block font-mono text-2xl font-bold tabular-nums leading-none",
                    k.alerte && "text-amber-500")}>{k.valeur}</b>
                  <span className="mt-1.5 block text-xs text-muted-foreground">{k.libelle}</span>
                </Card>
              ))}
            </div>
          )}

          {c.sections?.map((s) => (
            <section key={s.titre} className="space-y-3 break-inside-avoid">
              <h2 className="font-display text-lg font-semibold" style={{ textWrap: "balance" }}>{s.titre}</h2>
              <div className="prose-doc space-y-3 text-[15px] leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.corps}</ReactMarkdown>
              </div>
              {s.citation && (
                <blockquote className="border-l-2 border-amber-500 pl-4 text-[15px] leading-relaxed">
                  {s.citation}
                </blockquote>
              )}
            </section>
          ))}

          {c.graphiques && (
            <div className="grid gap-3">
              {c.graphiques.map((g, i) => <Graph key={`${g.titre}-${i}`} g={g} />)}
            </div>
          )}

          {c.carte && (
            <Link to={`/carte?q=${encodeURIComponent(c.carte.question)}`}
              className="print:hidden inline-flex items-center gap-2 border-b border-primary/40 pb-0.5 text-sm font-medium text-primary hover:border-primary">
              <MapIcon className="h-4 w-4" />
              {c.carte.libelle}
            </Link>
          )}

          {c.actions && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold">Plan d'action</h2>
              <div className="grid gap-2">
                {c.actions.map((a, i) => (
                  <Card key={a.titre} className="grid grid-cols-[auto_1fr] gap-3 p-4 break-inside-avoid">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 font-mono text-sm font-bold text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-semibold">{a.titre}</h3>
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          URGENCE[a.urgence]?.classe)}>
                          {URGENCE[a.urgence]?.texte ?? a.urgence}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{a.pourquoi}</p>
                      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 pt-0.5">
                        {a.principe && (
                          <div>
                            <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Bonne pratique</dt>
                            <dd className="text-xs font-medium">{a.principe}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Échéance</dt>
                          <dd className="text-xs font-medium">{a.echeance}</dd>
                        </div>
                        {a.resultat_attendu && (
                          <div>
                            <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Résultat attendu</dt>
                            <dd className="text-xs font-medium">{a.resultat_attendu}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {c.prospects && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold">Prospects à traiter</h2>
              {/* Le tableau défile dans son propre conteneur : sans cela, c'est la page
                  entière qui part de travers sur mobile. */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[40rem] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Priorité", "Établissement", "Lieu", "Contact", "Pourquoi maintenant"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {c.prospects.map((p, i) => (
                      <tr key={`${p.nom}-${i}`} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 align-top">
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", PRIORITE[p.priorite])}>
                            {p.priorite}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-top font-semibold">{p.nom}</td>
                        <td className="px-3 py-2.5 align-top text-muted-foreground">{p.lieu ?? "—"}</td>
                        <td className="px-3 py-2.5 align-top text-muted-foreground">{p.contact ?? "—"}</td>
                        <td className="px-3 py-2.5 align-top text-muted-foreground">{p.pourquoi}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {c.sources && (
            <footer className="border-t border-border pt-4 font-mono text-xs leading-relaxed text-muted-foreground">
              {c.sources}
            </footer>
          )}
        </article>
      )}
    </div>
  );
}

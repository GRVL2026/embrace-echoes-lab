import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Gamepad2, ChevronDown, ExternalLink, Loader2 } from "lucide-react";

// Le parc installé d'un lieu, tel que l'annuaire arcade le recense.
//
// C'est l'information qui change la nature d'un appel : un établissement déjà équipé
// n'a pas à être convaincu du principe, seulement du fournisseur. Trois faits suffisent
// à le dire — combien de machines, quel âge, et ce qui manque. Le reste se déplie.
//
// PRUDENCE ASSUMÉE : « installé » n'est jamais « vendu par nous ». L'annuaire dit ce
// qui est sur place, pas qui l'a livré. Le bloc ne l'affirme donc jamais, et distingue
// ce qui relève de notre catalogue de ce qui a été facturé.

type Machine = {
  slug: string; nom: string; categorie: string | null; type_jeu: string | null;
  editeur: string | null; annee: number | null; correspondance: string | null;
};

type Salle = {
  id: string; nom: string | null; ville: string | null; type_lieu: string | null;
  prestations: string[] | null; fiche_url: string; fiche_lue_at: string | null;
};

const TRANCHES = [
  { label: "2022+", min: 2022, ton: "bg-emerald-500" },
  { label: "2016-21", min: 2016, ton: "bg-lime-500" },
  { label: "2010-15", min: 2010, ton: "bg-amber-500" },
  { label: "< 2010", min: 0, ton: "bg-rose-500" },
];

/** Familles que nous vendons, pour dire ce qui manque sur place. Une catégorie absente
 *  est un argument d'appel plus direct qu'un parc vieillissant : elle se constate. */
const FAMILLES = [
  { cle: "flipper", label: "flipper", test: (m: Machine) => m.categorie === "flipper" },
  { cle: "billard", label: "billard", test: (m: Machine) => /billard/i.test(m.nom) },
  { cle: "babyfoot", label: "baby-foot", test: (m: Machine) => /baby ?foot/i.test(m.nom) },
  { cle: "grue", label: "grue", test: (m: Machine) => /grue|crane|pince|peluche/i.test(m.nom) },
];

export function ParcArcadeBloc({
  prospectId, codeClient, salleId,
}: { prospectId?: string | null; codeClient?: string | null; salleId?: string | null }) {
  const [ouvert, setOuvert] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["parc-arcade", prospectId ?? "", codeClient ?? "", salleId ?? ""],
    enabled: !!(prospectId || codeClient || salleId),
    staleTime: 300_000,
    queryFn: async () => {
      let q = supabase.from("arcade_salles" as any)
        .select("id, nom, ville, type_lieu, prestations, fiche_url, fiche_lue_at");
      // Trois entrées possibles : par la fiche prospect, par le compte client, ou
      // directement par la salle — ce dernier cas servant à l'arbitrage, où le lieu
      // n'est encore rattaché à rien.
      q = salleId ? q.eq("id", salleId)
        : prospectId ? q.eq("prospect_id", prospectId)
        : q.eq("code_client", codeClient!);
      const { data: salles, error } = await q.limit(4);
      if (error) throw error;
      if (!salles?.length) return { salle: null as Salle | null, machines: [] as Machine[] };

      const salle = salles[0] as unknown as Salle;
      const { data: liens, error: e2 } = await supabase
        .from("arcade_parc" as any)
        .select("arcade_machines(slug, nom, categorie, type_jeu, editeur, annee, correspondance)")
        .eq("salle_id", salle.id).limit(300);
      if (e2) throw e2;
      const machines = (liens ?? [])
        .map((l: any) => l.arcade_machines).filter(Boolean) as Machine[];
      return { salle, machines };
    },
  });

  const stats = useMemo(() => {
    const m = data?.machines ?? [];
    const annees = m.map((x) => x.annee).filter((a): a is number => !!a);
    const parTranche = TRANCHES.map((t, i) => ({
      ...t,
      n: annees.filter((a) => a >= t.min && (i === 0 || a < TRANCHES[i - 1].min)).length,
    }));
    return {
      total: m.length,
      catalogue: m.filter((x) => x.correspondance === "exacte" || x.correspondance === "marque").length,
      annee: annees.length ? Math.round(annees.reduce((a, b) => a + b, 0) / annees.length) : null,
      parTranche,
      absentes: FAMILLES.filter((f) => !m.some(f.test)).map((f) => f.label),
      parType: [...m.reduce((acc, x) => {
        const k = x.categorie === "flipper" ? "flipper" : (x.type_jeu ?? "autre");
        return acc.set(k, (acc.get(k) ?? 0) + 1);
      }, new Map<string, number>())].sort((a, b) => b[1] - a[1]),
    };
  }, [data]);

  if (!prospectId && !codeClient && !salleId) return null;
  if (isFetching && !data) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Parc installé…
      </div>
    );
  }
  if (!data?.salle) return null;

  const { salle } = data;
  const avecAnnee = stats.parTranche.reduce((n, t) => n + t.n, 0);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Gamepad2 className="h-4 w-4 flex-shrink-0" style={{ color: "hsl(var(--space-prospection))" }} />
        <h3 className="text-sm font-semibold">Parc installé</h3>
        <span className="text-2xl font-semibold tabular-nums leading-none ml-auto">{stats.total}</span>
        <span className="text-[11px] text-muted-foreground">machine{stats.total > 1 ? "s" : ""}</span>
      </div>

      {/* Trois faits, et rien de plus au premier regard. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {stats.annee && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            parc {stats.annee} en moyenne
          </Badge>
        )}
        {stats.catalogue > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-primary/40 text-primary">
            {stats.catalogue} de notre périmètre
          </Badge>
        )}
        {stats.absentes.length > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
            aucun {stats.absentes.slice(0, 2).join(", aucun ")}
          </Badge>
        )}
      </div>

      {/* L'âge du parc en une barre : on voit d'un coup si le renouvellement est le sujet. */}
      {avecAnnee > 0 && (
        <div className="mt-2.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {stats.parTranche.map((t) => t.n > 0 && (
              <div key={t.label} className={cn("h-full", t.ton)}
                style={{ width: `${(t.n / avecAnnee) * 100}%` }}
                title={`${t.n} machine${t.n > 1 ? "s" : ""} ${t.label}`} />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            {stats.parTranche.filter((t) => t.n > 0).map((t) => (
              <span key={t.label} className="inline-flex items-center gap-1">
                <span className={cn("h-1.5 w-1.5 rounded-full", t.ton)} />{t.label} · {t.n}
              </span>
            ))}
          </div>
        </div>
      )}

      <Collapsible open={ouvert} onOpenChange={setOuvert}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="mt-2 h-7 w-full justify-between px-2 text-xs">
            <span>{ouvert ? "Masquer" : "Voir"} le détail des machines</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", ouvert && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1">
            {stats.parType.map(([t, n]) => (
              <Badge key={t} variant="secondary" className="h-5 px-1.5 text-[10px] capitalize">
                {t} · {n}
              </Badge>
            ))}
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {(data.machines ?? [])
              .slice()
              .sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0))
              .map((m, i) => (
                <div key={`${m.slug}-${i}`} className="flex items-baseline gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-muted">
                  <span className="w-10 flex-shrink-0 text-right tabular-nums text-muted-foreground">
                    {m.annee ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate capitalize">{m.nom}</span>
                  {m.editeur && <span className="truncate text-[10px] text-muted-foreground">{m.editeur}</span>}
                  {(m.correspondance === "exacte" || m.correspondance === "marque") && (
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
                      title="Relève de notre catalogue" />
                  )}
                </div>
              ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Source : annuaire-arcade.fr{salle.fiche_lue_at ? `, relevé le ${new Date(salle.fiche_lue_at).toLocaleDateString("fr-FR")}` : ""}.
            « Installé » ne veut pas dire « vendu par nous » — l'annuaire dit ce qui est sur
            place, pas qui l'a livré.
          </p>
          <Button asChild variant="outline" size="sm" className="h-7 w-full gap-1.5 text-xs">
            <a href={salle.fiche_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3 w-3" />Fiche de l'annuaire
            </a>
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default ParcArcadeBloc;

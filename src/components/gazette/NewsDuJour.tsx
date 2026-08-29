import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Newspaper, MapPin, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Les dernières actualités du secteur, en tête d'accueil.
//
// « Détectées du jour » se lit sur created_at (l'insertion par la veille), PAS sur
// publie_le (la date de l'article, souvent antérieure). La veille tourne en semaine :
// pour ne pas afficher une carte vide le week-end, on montre le dernier lot détecté et
// on date honnêtement le sous-titre — « aujourd'hui » quand la veille a tourné le jour
// même, sinon « hier » ou la date. Rien détecté du tout → la carte disparaît.
//
// Réservée aux profils qui accèdent à la Gazette (admin/direction) : le gate est posé
// par l'appelant (Hub), et chaque ligne mène à la Gazette pour agir sur le signal.

type NewsRow = {
  id: string;
  titre: string;
  source: string | null;
  commune: string | null;
  region: string | null;
  type_lieu: string | null;
  publie_le: string;
  created_at: string | null;
  statut: string;
};

/** Retire le suffixe « - Ouest-France » du titre : la source est déjà affichée à part. */
function titrePropre(t: string, source: string | null): string {
  let v = t.replace(/\s*[-–—]\s*[^-–—]{2,28}$/, "").trim();
  if (source) v = v.replace(new RegExp(`\\s*[-–—]\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
  return v || t;
}

function joursDepuis(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function labelDetection(created_at: string | null): string {
  if (!created_at) return "récemment";
  const j = joursDepuis(created_at);
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return "hier";
  return new Date(created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export function NewsDuJour() {
  const { data } = useQuery({
    queryKey: ["hub-news-du-jour"],
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async (): Promise<NewsRow[]> => {
      const { data, error } = await supabase
        .from("gazette_signaux" as any)
        .select("id, titre, source, commune, region, type_lieu, publie_le, created_at, statut")
        .in("statut", ["nouveau", "retenu", "converti"])
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as unknown as NewsRow[];
    },
  });

  const news = data ?? [];
  if (news.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur px-4 sm:px-5 py-4">
      <div className="mb-2 flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0"
          style={{ color: "hsl(var(--space-prospection))", background: "hsl(var(--space-prospection) / 0.15)" }}
        >
          <Newspaper className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Actualités du secteur</div>
          <div className="text-[11px] text-muted-foreground">
            Dernières détections · {labelDetection(news[0].created_at)}
          </div>
        </div>
        <Link
          to="/gazette"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0"
        >
          Voir tout <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <ul className="divide-y divide-border/40">
        {news.map((s) => {
          const d = new Date(s.publie_le + "T12:00:00");
          const lieu = [s.commune, s.region].filter(Boolean).join(" · ");
          return (
            <li key={s.id}>
              <Link to="/gazette" className="group flex gap-3 py-2">
                {/* Pastille date de l'article (publie_le), comme dans la Gazette. */}
                <div className="w-9 flex-shrink-0 text-center">
                  <div className="text-base font-semibold leading-none tabular-nums">{d.getDate()}</div>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    {d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-medium leading-snug transition-colors group-hover:text-primary">
                    {titrePropre(s.titre, s.source)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {s.type_lieu && <span>{s.type_lieu}</span>}
                    {lieu && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />{lieu}
                      </span>
                    )}
                    {s.source && (
                      <span className="inline-flex items-center gap-1">
                        <Newspaper className="h-3 w-3" />{s.source}
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

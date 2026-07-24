import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Sparkles, Sunrise, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCopilot } from "@/contexts/CopilotContext";
import { cn } from "@/lib/utils";
import { WeekActivitySection } from "./WeekActivitySection";

type Briefing = {
  date: string;
  contenu: {
    resume: string;
    fraicheur: string;
    changements: { titre: string; detail: string }[];
    alertes_nouvelles: string[];
    opportunites: { titre: string; detail: string; lien?: string }[];
    mouvements_commerce?: { resume: string; lignes: string[]; first_run?: boolean };
  };
};


/**
 * Carte "Briefing du matin" affichée en haut du Hub.
 * Repliable, avec bouton "En parler au copilote" qui ouvre le panneau global
 * avec le contexte du briefing pré-rempli.
 */
export function BriefingCard({ defaultExpanded = true }: { defaultExpanded?: boolean } = {}) {
  const { copilotEnabled } = useAuth();
  const { open: openCopilot } = useCopilot();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { data, isLoading } = useQuery({
    queryKey: ["copilot-briefing-today"],
    enabled: copilotEnabled,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Briefing | null> => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("copilot_briefings")
        .select("date, contenu")
        .eq("date", today)
        .maybeSingle();
      if (error) throw error;
      return (data as Briefing) ?? null;
    },
  });

  if (!copilotEnabled) return null;
  if (isLoading || !data) return null;

  const b = data.contenu;
  const dateLabel = new Date(data.date).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div
      className="rounded-2xl border bg-card/60 backdrop-blur"
      style={{
        borderColor: "hsl(var(--primary) / 0.35)",
        boxShadow: "0 20px 60px -40px hsl(var(--primary))",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary flex-shrink-0">
          <Sunrise className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary/80 font-medium">
            <Sparkles className="h-3 w-3" /> Briefing du matin · {dateLabel}
          </div>
          <p className="mt-0.5 text-sm sm:text-base text-foreground/90 line-clamp-2">
            {b.resume}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/60 px-5 py-4 space-y-5">
          <p className="text-[11px] text-muted-foreground italic">{b.fraicheur}</p>

          {b.changements?.length > 0 && (
            <Section title="Ce qui a changé depuis hier">
              <ul className="space-y-1.5">
                {b.changements.map((c, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{c.titre}</span>
                    <span className="text-muted-foreground"> — {c.detail}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {b.mouvements_commerce && (
            <Section title="📋 Mouvements commerce d'hier">
              {b.mouvements_commerce.first_run ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-primary/80 mb-1">
                    Première photo · démarrage
                  </div>
                  <p className="text-foreground/90">{b.mouvements_commerce.resume}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Aucune photo de la veille n'était disponible : la sentinelle vient de prendre la première. Le récap comparatif apparaîtra dès le prochain briefing.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-foreground/90 mb-1.5">{b.mouvements_commerce.resume}</p>
                  {b.mouvements_commerce.lignes?.length > 0 && (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {b.mouvements_commerce.lignes.map((l, i) => (
                        <li key={i} className="flex gap-2"><span className="text-primary">•</span>{l}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Section>
          )}

          {b.alertes_nouvelles?.length > 0 && (
            <Section title="Alertes du jour">
              <ul className="space-y-1 text-sm text-muted-foreground">
                {b.alertes_nouvelles.map((a, i) => (
                  <li key={i} className="flex gap-2"><span className="text-amber-500">•</span>{a}</li>
                ))}
              </ul>
            </Section>
          )}


          {b.opportunites?.length > 0 && (
            <Section title="Opportunités">
              <ul className="space-y-2">
                {b.opportunites.map((o, i) => (
                  <li key={i} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                    <div className="font-medium">{o.titre}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">{o.detail}</div>
                    {o.lien && (
                      <Link to={o.lien} className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        Ouvrir <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                openCopilot({
                  title: `Briefing du ${dateLabel}`,
                  prefill: `Peux-tu m'aider à prioriser les actions du briefing du jour ?\n\nContexte briefing :\n${b.resume}`,
                  entity: { kind: "briefing", label: `Briefing ${data.date}`, extra: b as any },
                })
              }
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              En parler au copilote
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

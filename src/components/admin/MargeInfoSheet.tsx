import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Info, BarChart3, BookOpen, Layers, Scale, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type Reference = {
  exercice_clos: string;
  /** Année de clôture (ex. 2025 pour bilan clos au 31/08/2025 = exercice 2024-2025) */
  exercice?: number;
  marge_marchandises: number;
  ventes_marchandises: number;
  marges_totales: number;
  ca_total: number;
  ca_hors_sfa: number;
  taux_marge_commerciale: number;
  taux_marges_totales: number;
  taux_equivalent_dashboard: number;
};

const FALLBACK: Reference = {
  exercice_clos: "31/08/2025",
  exercice: 2025,
  marge_marchandises: 2122462,
  ventes_marchandises: 11062089,
  marges_totales: 2379985,
  ca_total: 11332634,
  ca_hors_sfa: 10352062,
  taux_marge_commerciale: 19.19,
  taux_marges_totales: 21.0,
  taux_equivalent_dashboard: 23.0,
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

/** "2024-25" pour exercice 2025 (clôture 31/08/2025) */
const exerciceLabel = (year: number) => `${year - 1}-${String(year).slice(-2)}`;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Taux ERP dynamique (taux de marque global ERP hors SFA & hors éco-taxe) */
  tauxErp?: number | null;
  /** Libellé de la source (ex. "Dashboard AA" ou "Magasin") */
  source?: string;
  /** Exercice actuellement affiché par la carte Marge appelante (année de clôture) */
  currentExercice?: number;
};

export function MargeInfoSheet({ open, onOpenChange, tauxErp, source, currentExercice }: Props) {
  const { data: ref = FALLBACK } = useQuery({
    queryKey: ["gaia_config", "marge_reference_bilan"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("gaia_config")
        .select("value")
        .eq("key", "marge_reference_bilan")
        .maybeSingle();
      if (!data?.value) return FALLBACK;
      try {
        return { ...FALLBACK, ...JSON.parse(data.value as string) } as Reference;
      } catch {
        return FALLBACK;
      }
    },
    staleTime: 60 * 60 * 1000,
  });

  const refYear =
    ref.exercice ??
    (() => {
      const m = /(\d{4})/.exec(ref.exercice_clos || "");
      return m ? Number(m[1]) : 2025;
    })();
  const refLabel = exerciceLabel(refYear);
  const isFuturExercice = typeof currentExercice === "number" && currentExercice > refYear;
  const nextCloture = `31/08/${refYear + 1}`;

  const cards = [
    {
      icon: BarChart3,
      title: "Vision ERP — pilotage",
      value:
        typeof tauxErp === "number" && isFinite(tauxErp)
          ? `${tauxErp.toFixed(1)} %`
          : "dynamique",
      formulaTop: "Marge ligne à ligne (ERP)",
      formulaBottom: "CA couvert par un coût, hors SFA et hors éco-taxe",
      usage:
        "Utilisez-la pour comparer clients, familles et tendances. C'est le chiffre affiché par le dashboard.",
      accent: "border-primary/40 bg-primary/5",
      valueColor: "text-primary text-glow-purple",
      accounting: false,
    },
    {
      icon: BookOpen,
      title: "Marge commerciale comptable",
      value: `${ref.taux_marge_commerciale.toFixed(2)} %`,
      formulaTop: `Marge sur marchandises seules (${eur(ref.marge_marchandises)})`,
      formulaBottom: `Ventes de marchandises, SFA incluse (${eur(ref.ventes_marchandises)})`,
      usage:
        "C'est le chiffre du bilan, la référence officielle pour la banque et les associés.",
      accent: "border-border bg-card/40",
      valueColor: "text-foreground",
      accounting: true,
    },
    {
      icon: Layers,
      title: "Marges totales comptables",
      value: `${ref.taux_marges_totales.toFixed(2)} %`,
      formulaTop: `Marges marchandises + services (${eur(ref.marges_totales)})`,
      formulaBottom: `CA total, SFA incluse (${eur(ref.ca_total)})`,
      usage:
        "Vision comptable élargie incluant les prestations de services.",
      accent: "border-border bg-card/40",
      valueColor: "text-foreground",
      accounting: true,
    },
    {
      icon: Scale,
      title: "Équivalent comptable à périmètre dashboard",
      value: `≈ ${ref.taux_equivalent_dashboard.toFixed(1)} %`,
      formulaTop: `Marges totales (${eur(ref.marges_totales)})`,
      formulaBottom: `CA hors SFA (${eur(ref.ca_hors_sfa)})`,
      usage:
        "C'est la ligne à comparer directement au chiffre ERP ci-dessus. L'écart résiduel (~1 point) vient de la casse, de la démarque, des écarts d'inventaire et des charges directes d'achat que seule la compta voit.",
      accent: "border-secondary/40 bg-secondary/5",
      valueColor: "text-secondary",
      accounting: true,
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display inline-flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            Comprendre les différentes lectures de la marge
          </SheetTitle>
          <SheetDescription>
            Quatre façons complémentaires de lire la marge{source ? ` — depuis ${source}` : ""}. Chaque
            chiffre est juste : ils ne mesurent simplement pas la même chose.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isFuturExercice && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
              <div className="mb-1 inline-flex items-center gap-2 text-sm font-medium text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Bilan {exerciceLabel(currentExercice!)} pas encore disponible
              </div>
              Le rapprochement comptable de cet exercice ne pourra se faire qu'à la clôture ({nextCloture}).
              Les références ci-dessous proviennent du dernier bilan clos ({ref.exercice_clos}) et ne sont
              données qu'à titre de repère de structure.
            </div>
          )}

          {cards.map((c) => (
            <div key={c.title} className={`rounded-lg border p-4 ${c.accent}`}>
              <div className="flex items-start gap-3">
                <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-foreground">{c.title}</div>
                      {c.accounting && (
                        <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Bilan {refLabel}
                        </span>
                      )}
                    </div>
                    <div className={`font-display text-2xl font-bold ${c.valueColor}`}>{c.value}</div>
                  </div>
                  <div className="mt-2 rounded border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                    <div className="text-foreground">{c.formulaTop}</div>
                    <div className="my-0.5 text-muted-foreground/70">÷</div>
                    <div className="text-foreground">{c.formulaBottom}</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{c.usage}</div>
                </div>
              </div>
            </div>
          ))}

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
            Chiffre officiel = compta ; pilotage et comparaisons = ERP.
            <span className="text-muted-foreground"> Les deux racontent la même histoire avec des focales différentes.</span>
          </div>

          <div className="text-[11px] text-muted-foreground">
            Référence : bilan clos {ref.exercice_clos} (exercice {refLabel}).
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

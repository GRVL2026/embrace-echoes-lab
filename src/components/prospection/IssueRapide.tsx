import { useState } from "react";
import { toast } from "sonner";
import { Phone, PhoneOff, CalendarCheck, FileText, Trophy, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// Capture de l'issue d'un contact, en UN clic — le maillon qui ferme la boucle.
//
// Le copilote analyse, mais rien ne lui dit jamais si un lead a été appelé, gagné ou
// perdu, ni pourquoi. Sans ce retour, il reste un analyste de première intention ; avec
// lui, il apprend des ventes réelles (« sur les bowlings, le refus n°1 est "déjà
// équipé" »). La table prospect_events était vide depuis juillet faute d'un endroit où
// saisir sans effort.
//
// CONTRAINTE ABSOLUE : trois commerciaux pressés ne rempliront jamais un formulaire. Un
// clic, pas plus — et pour la perte, une liste FERMÉE de motifs (pas de champ libre) :
// c'est ce qui rend les motifs analysables, un texte libre ne se compte pas.
//
// Chaque clic fait trois choses d'un coup : il écrit l'événement daté et signé (pour le
// copilote), il avance le statut, et il pose la PROCHAINE ACTION datée — pour que le lead
// ne retombe jamais dans « sans action », le trou par lequel on perd les affaires.

type Statut = string;

type Issue = {
  key: string; label: string; icon: typeof Phone;
  statut: Statut | null;                 // null = ne change pas le statut (injoignable)
  action: string | null; delai: number;  // prochaine action + échéance en jours
  motifs?: boolean;                       // demande un motif fermé (perte)
  ton?: "ok" | "warn" | "bad";
};

const ISSUES: Issue[] = [
  { key: "injoignable", label: "Injoignable", icon: PhoneOff, statut: null, action: "Rappeler", delai: 3 },
  { key: "contacte", label: "Contacté", icon: Phone, statut: "contacte", action: "Relancer", delai: 7 },
  { key: "rdv", label: "RDV obtenu", icon: CalendarCheck, statut: "rdv", action: "Préparer le RDV", delai: 2, ton: "ok" },
  { key: "devis", label: "Devis envoyé", icon: FileText, statut: "devis", action: "Relancer le devis", delai: 7, ton: "ok" },
  { key: "gagne", label: "Gagné", icon: Trophy, statut: "client", action: null, delai: 0, ton: "ok" },
  { key: "perdu", label: "Perdu", icon: X, statut: "perdu", action: null, delai: 0, motifs: true, ton: "bad" },
];

// Liste FERMÉE : ce sont ces motifs que le copilote croisera par segment et par région.
const MOTIFS = ["Trop cher", "Déjà équipé", "Pas le moment", "Concurrent", "Pas le décideur", "Ne répond plus"];

function dansNJours(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function IssueRapide({
  prospectId, statut, onDone,
}: {
  prospectId: string;
  statut: string | null;
  onDone?: (patch: { statut?: string; prochaine_action_le?: string | null }) => void;
}) {
  const { user } = useAuth();
  const [perteOuverte, setPerteOuverte] = useState(false);
  const [enCours, setEnCours] = useState<string | null>(null);

  const enregistrer = async (issue: Issue, motif?: string) => {
    setEnCours(issue.key);
    try {
      const patch: Record<string, unknown> = {};
      if (issue.statut) patch.statut = issue.statut;
      if (issue.action) {
        patch.prochaine_action = issue.action;
        patch.prochaine_action_le = dansNJours(issue.delai);
      } else {
        // Gagné ou perdu : plus d'action à programmer, on nettoie l'échéance.
        patch.prochaine_action = null;
        patch.prochaine_action_le = null;
      }

      const { error } = await supabase.from("prospects").update(patch).eq("id", prospectId);
      if (error) throw error;

      const { error: e2 } = await supabase.from("prospect_events").insert({
        prospect_id: prospectId,
        type: issue.key,
        contenu: motif ?? issue.label,
        ancien_statut: statut,
        nouveau_statut: issue.statut ?? statut,
        auteur: user?.id ?? null,
      });
      if (e2) throw e2;

      toast.success(motif ? `Perdu — ${motif}` : issue.label);
      setPerteOuverte(false);
      onDone?.({ statut: issue.statut ?? undefined, prochaine_action_le: (patch.prochaine_action_le as string | null) ?? null });
    } catch (err: any) {
      toast.error(err?.message ?? "Enregistrement impossible");
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Issue du contact</p>
      <div className="flex flex-wrap gap-1.5">
        {ISSUES.map((i) => {
          const Icon = i.icon;
          const actif = enCours === i.key;
          return (
            <button
              key={i.key}
              type="button"
              disabled={!!enCours}
              onClick={() => (i.motifs ? setPerteOuverte((v) => !v) : enregistrer(i))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                i.ton === "ok" && "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10",
                i.ton === "bad" && "border-destructive/30 text-destructive hover:bg-destructive/10",
                !i.ton && "border-border text-foreground hover:bg-muted",
                perteOuverte && i.motifs && "bg-destructive/10",
              )}
            >
              {actif ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
              {i.label}
            </button>
          );
        })}
      </div>

      {/* La perte demande un motif — un clic de plus, mais fermé, donc analysable. */}
      {perteOuverte && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <p className="mb-1.5 text-[11px] font-medium text-destructive">Pourquoi perdu&nbsp;?</p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIFS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={!!enCours}
                onClick={() => enregistrer(ISSUES.find((i) => i.key === "perdu")!, m)}
                className="rounded-full border border-destructive/30 px-2.5 py-1 text-[11px] text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

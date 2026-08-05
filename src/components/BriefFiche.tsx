import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";

// Le brief d'une fiche, à la demande.
//
// Il n'est pas généré à l'ouverture : la plupart des consultations ne servent qu'à
// relire un numéro de téléphone, et facturer un appel de modèle pour ça n'aurait pas de
// sens. Le bouton dit clairement ce qu'il déclenche.
//
// Le texte est mis en cache côté serveur et ne se régénère que si les faits ont changé
// — nouvelle facture, machine ajoutée, article de presse. Le bouton « régénérer » force
// le passage, pour le cas où l'on veut une autre formulation.

export function BriefFiche({
  prospectId, codeClient,
}: { prospectId?: string | null; codeClient?: string | null }) {
  const [contenu, setContenu] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  if (!prospectId && !codeClient) return null;

  async function generer(force = false) {
    setEnCours(true);
    try {
      const { data, error } = await supabase.functions.invoke("brief-fiche", {
        body: { prospect_id: prospectId ?? undefined, code_client: codeClient ?? undefined, force },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setContenu((data as any).contenu);
      setDate((data as any).genere_le ?? null);
    } catch (e) {
      toast.error("Brief indisponible", { description: (e as Error).message });
    } finally {
      setEnCours(false);
    }
  }

  if (!contenu) {
    return (
      <Button variant="outline" className="w-full gap-2" disabled={enCours} onClick={() => generer(false)}>
        {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {enCours ? "Lecture des faits…" : "Générer le brief"}
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 flex-shrink-0 text-primary" />
        <h3 className="text-sm font-semibold">Brief</h3>
        <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 px-1.5 text-[11px]"
          disabled={enCours} onClick={() => generer(true)} title="Régénérer">
          <RefreshCw className={enCours ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
        </Button>
      </div>

      {/* Rendu Markdown minimal : gras, listes et sauts de ligne suffisent à un texte
          de six lignes, et une dépendance de plus ne se justifierait pas. */}
      <div className="mt-2 space-y-1 text-[13px] leading-relaxed">
        {contenu.split("\n").filter((l) => l.trim()).map((ligne, i) => {
          const puce = /^\s*[-*•]\s+/.test(ligne);
          const texte = ligne.replace(/^\s*[-*•]\s+/, "").replace(/^#+\s*/, "");
          const morceaux = texte.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={puce ? "flex gap-1.5 pl-1" : ""}>
              {puce && <span className="text-primary">▸</span>}
              <span>
                {morceaux.map((m, k) =>
                  m.startsWith("**") && m.endsWith("**")
                    ? <strong key={k}>{m.slice(2, -2)}</strong>
                    : <span key={k}>{m}</span>,
                )}
              </span>
            </p>
          );
        })}
      </div>

      {date && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Généré le {new Date(date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} à
          partir des faits en base — parc relevé, facturation et signaux de presse.
        </p>
      )}
    </div>
  );
}

export default BriefFiche;

import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, AlertTriangle, AlertCircle, Info, Check, EyeOff } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type Alerte = {
  id: string;
  type: string;
  gravite: "info" | "attention" | "urgent";
  titre: string;
  constat: string;
  action_suggeree: string | null;
  lien: string | null;
  visibilite: "copilot" | "direction";
  statut: "nouveau" | "lu" | "traite" | "ignore";
  created_at: string;
};

const GRAV_ORDER: Record<Alerte["gravite"], number> = { urgent: 0, attention: 1, info: 2 };

function GraviteIcon({ g, className }: { g: Alerte["gravite"]; className?: string }) {
  if (g === "urgent") return <AlertCircle className={cn("text-destructive", className)} />;
  if (g === "attention") return <AlertTriangle className={cn("text-amber-500", className)} />;
  return <Info className={cn("text-blue-400", className)} />;
}

/**
 * Cloche d'alertes du Copilote Sentinelle.
 * - Badge = alertes 'nouveau' visibles pour le role du user.
 * - Polling 60s (les alertes tombent 1×/jour + à la demande).
 * - Clic sur une alerte -> navigation + marque 'lu'.
 */
export function AlertsBell({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { copilotEnabled } = useAuth();
  const qc = useQueryClient();

  const { data: alertes = [] } = useQuery({
    queryKey: ["copilot-alertes"],
    enabled: copilotEnabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Alerte[]> => {
      const { data, error } = await (supabase as any)
        .from("copilot_alertes")
        .select("*")
        .neq("statut", "ignore")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Alerte[];
    },
  });

  const nouveauCount = alertes.filter((a) => a.statut === "nouveau").length;
  const sorted = [...alertes].sort((a, b) => {
    const s = GRAV_ORDER[a.gravite] - GRAV_ORDER[b.gravite];
    if (s !== 0) return s;
    return b.created_at.localeCompare(a.created_at);
  });

  async function setStatut(id: string, statut: Alerte["statut"]) {
    await (supabase as any).from("copilot_alertes").update({ statut }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["copilot-alertes"] });
  }

  if (!copilotEnabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative inline-flex items-center justify-center rounded-md hover:bg-muted/60 transition-colors",
          compact ? "h-8 w-8" : "h-9 w-9",
        )}
        aria-label="Alertes du copilote"
      >
        <Bell className="h-4 w-4" />
        {nouveauCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {nouveauCount > 99 ? "99+" : nouveauCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Alertes du copilote
              {nouveauCount > 0 && (
                <Badge variant="destructive" className="ml-auto">{nouveauCount} nouv.</Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {sorted.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-muted-foreground">
                Aucune alerte active. La sentinelle scanne les données chaque matin.
              </div>
            ) : (
              sorted.map((a) => (
                <div key={a.id} className={cn("px-5 py-4", a.statut === "nouveau" && "bg-muted/20")}>
                  <div className="flex items-start gap-3">
                    <GraviteIcon g={a.gravite} className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{a.titre}</span>
                        {a.visibilite === "direction" && (
                          <Badge variant="outline" className="h-4 text-[10px] border-blue-500/40 text-blue-400">DIR</Badge>
                        )}
                        {a.statut !== "nouveau" && (
                          <Badge variant="secondary" className="h-4 text-[10px]">{a.statut}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{a.constat}</p>
                      {a.action_suggeree && (
                        <p className="mt-1.5 text-xs text-foreground/80">
                          <span className="text-primary font-medium">→ </span>{a.action_suggeree}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {a.lien && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs"
                            asChild
                            onClick={() => {
                              if (a.statut === "nouveau") setStatut(a.id, "lu");
                              setOpen(false);
                            }}
                          >
                            <Link to={a.lien}>Ouvrir</Link>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatut(a.id, "traite")}>
                          <Check className="h-3 w-3 mr-1" /> Traité
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setStatut(a.id, "ignore")}>
                          <EyeOff className="h-3 w-3 mr-1" /> Ignorer
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

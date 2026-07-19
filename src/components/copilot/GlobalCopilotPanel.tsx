import { useEffect } from "react";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCopilot } from "@/contexts/CopilotContext";
import { useAuth } from "@/contexts/AuthContext";
import { GaiaCopilot } from "@/components/admin/GaiaCopilot";
import { cn } from "@/lib/utils";

/**
 * Panneau global du copilote :
 *  - bouton flottant discret en bas à droite (uniquement si copilotEnabled)
 *  - raccourci clavier Cmd/Ctrl+K
 *  - Sheet latéral qui embarque GaiaCopilot en mode "chat only"
 */
export function GlobalCopilotPanel() {
  const { copilotEnabled, canAccessGaia } = useAuth();
  const { isOpen, open, close, pageContext } = useCopilot();

  // Raccourci clavier Cmd/Ctrl+K → ouvre/ferme le panneau
  useEffect(() => {
    if (!copilotEnabled || !canAccessGaia) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (isOpen) close();
        else open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copilotEnabled, canAccessGaia, isOpen, open, close]);

  if (!copilotEnabled || !canAccessGaia) return null;

  return (
    <>
      {/* Bouton flottant */}
      <Button
        type="button"
        onClick={() => open()}
        className={cn(
          "fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full p-0 shadow-lg",
          "bg-primary text-primary-foreground hover:bg-primary/90",
          "ring-2 ring-primary/30 hover:ring-primary/60 transition-all",
          "print:hidden",
        )}
        aria-label="Ouvrir le copilote (Cmd/Ctrl+K)"
        title="Copilote (Cmd/Ctrl+K)"
        style={{ bottom: "calc(1rem + var(--safe-bottom, 0px))" }}
      >
        <Sparkles className="h-5 w-5" />
      </Button>

      <Sheet open={isOpen} onOpenChange={(v) => (v ? open() : close())}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl md:max-w-3xl flex flex-col p-0 gap-0"
        >
          <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Copilote
              {pageContext.title && (
                <span className="ml-2 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                  contexte : {pageContext.title}
                  {pageContext.entity ? ` · ${pageContext.entity.label}` : ""}
                </span>
              )}
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                Cmd/Ctrl+K pour ouvrir/fermer
              </span>
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <GaiaCopilot embedded />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

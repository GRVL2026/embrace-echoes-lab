import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Props = {
  /** 0-100. Jamais de retour en arrière côté client. */
  progress: number;
  /** Libellé court de l'étape en cours. */
  etape?: string | null;
  /** Message d'introduction facultatif (« Génération en cours… »). */
  label?: string;
  /** Compact = version bandeau étroit. */
  compact?: boolean;
  className?: string;
};

/**
 * Barre de progression partagée par la revue commerciale et la veille marché.
 * Le % est estimatif par jalons réels côté serveur — pas d'animation continue simulée.
 */
export function GenerationProgress({
  progress,
  etape,
  label,
  compact,
  className,
}: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(progress || 0)));
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center gap-2 text-xs sm:text-sm">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <span className="truncate">{label ?? "Génération en cours"}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className={cn("mt-1.5", compact ? "h-1.5" : "h-2")} />
      {etape && (
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{etape}</div>
      )}
    </div>
  );
}

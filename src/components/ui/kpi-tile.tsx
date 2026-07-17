import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tuile KPI cliquable partagée — règle produit : chaque chiffre
 * doit ouvrir son détail. Rend un <button> quand `onClick` est fourni
 * (curseur pointer + hover + focus ring), sinon une <div> statique
 * sans affordance trompeuse.
 */
export type KpiTileProps = {
  title: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  tone?: "default" | "primary" | "secondary" | "destructive" | "warning";
  className?: string;
  children?: ReactNode;
};

const TONE_BORDER: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  default: "border-border",
  primary: "border-primary/30",
  secondary: "border-secondary/30",
  destructive: "border-destructive/30",
  warning: "border-yellow-500/30",
};

const TONE_VALUE: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  default: "text-foreground",
  primary: "text-primary text-glow-purple",
  secondary: "text-secondary text-glow-green",
  destructive: "text-destructive",
  warning: "text-yellow-500",
};

export const KpiTile = forwardRef<HTMLElement, KpiTileProps>(function KpiTile(
  { title, value, hint, icon, onClick, ariaLabel, tone = "default", className, children },
  ref
) {
  const interactive = typeof onClick === "function";

  const base = cn(
    "block w-full text-left rounded-lg border bg-card/40 p-4 min-h-[92px]",
    TONE_BORDER[tone],
    interactive &&
      "cursor-pointer transition-colors hover:border-primary/60 hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:translate-y-[1px]",
    className
  );

  const inner = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{title}</span>
        {icon}
      </div>
      <div className={cn("font-display text-2xl font-bold tabular-nums", TONE_VALUE[tone])}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs">{hint}</div>}
      {children}
    </>
  );

  if (interactive) {
    return (
      <button
        ref={ref as any}
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={base}
      >
        {inner}
      </button>
    );
  }

  return (
    <div ref={ref as any} className={base}>
      {inner}
    </div>
  );
});

import { Badge } from "@/components/ui/badge";
import { Cpu, Wrench, Layers } from "lucide-react";

export type Origine = "aa" | "magasin" | "mixte" | null | undefined | string;

const CONFIG: Record<string, { label: string; className: string; Icon: any; title: string }> = {
  aa: {
    label: "AA",
    className: "border-primary/40 bg-primary/10 text-primary",
    Icon: Cpu,
    title: "Amusement Automatique — machines / bornes",
  },
  magasin: {
    label: "Magasin",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    Icon: Wrench,
    title: "Magasin — pièces détachées, consommables",
  },
  mixte: {
    label: "Mixte",
    className: "border-border bg-muted/40 text-muted-foreground",
    Icon: Layers,
    title: "Mixte — combine AA et Magasin",
  },
};

export function OrigineBadge({
  origine,
  className = "",
  showIcon = true,
}: {
  origine: Origine;
  className?: string;
  showIcon?: boolean;
}) {
  if (!origine) return null;
  const cfg = CONFIG[String(origine).toLowerCase()];
  if (!cfg) return null;
  const Icon = cfg.Icon;
  return (
    <Badge
      variant="outline"
      title={cfg.title}
      className={`inline-flex items-center gap-1 px-1.5 py-0 text-[10px] font-semibold ${cfg.className} ${className}`}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {cfg.label}
    </Badge>
  );
}

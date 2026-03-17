import { useState } from "react";
import {
  Check,
  X,
  Star,
  Zap,
  ChevronDown,
  ChevronUp,
  Package,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AddAssetAction, PlacementSurface } from "@/types/copilot";

export interface PendingAsset extends AddAssetAction {
  score?: number;
  source?: "curated" | "discovery";
  polycount?: number;
  file_size_mb?: number;
  placement_surface?: PlacementSurface;
}

type Props = {
  assets: PendingAsset[];
  onAccept: (accepted: PendingAsset[]) => void;
  onDismiss: () => void;
};

function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const color =
    pct >= 80
      ? "text-green-400 border-green-400/30 bg-green-400/10"
      : pct >= 50
        ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/10"
        : "text-red-400 border-red-400/30 bg-red-400/10";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold", color)}>
      <Star className="h-2.5 w-2.5" />
      {pct}
    </span>
  );
}

function PerformanceBadge({ polycount, sizeMb }: { polycount?: number; sizeMb?: number }) {
  if (!polycount && !sizeMb) return null;
  const label = polycount
    ? polycount > 100_000
      ? "Lourd"
      : polycount > 30_000
        ? "Moyen"
        : "Léger"
    : sizeMb && sizeMb > 10
      ? "Lourd"
      : "OK";
  const color =
    label === "Léger"
      ? "bg-green-400/10 text-green-400"
      : label === "Moyen"
        ? "bg-yellow-400/10 text-yellow-400"
        : "bg-red-400/10 text-red-400";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium", color)}>
      <Zap className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

export function AssetPreviewPanel({ assets, onAccept, onDismiss }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(assets.map((a) => a.asset_id)));
  const [expanded, setExpanded] = useState(true);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(assets.map((a) => a.asset_id)));
  const selectNone = () => setSelected(new Set());

  const handleAccept = () => {
    const accepted = assets.filter((a) => selected.has(a.asset_id));
    onAccept(accepted);
  };

  return (
    <div className="border border-border rounded-lg bg-card/90 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <button
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            {assets.length} asset{assets.length > 1 ? "s" : ""} trouvé{assets.length > 1 ? "s" : ""}
          </span>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0">
            {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
          </Badge>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <>
          {/* Asset list */}
          <div className="max-h-[240px] overflow-y-auto px-2 pb-2 space-y-1.5">
            {assets.map((asset) => {
              const isSelected = selected.has(asset.asset_id);
              return (
                <div
                  key={asset.asset_id}
                  className={cn(
                    "flex items-center gap-2 rounded-md p-1.5 transition-all cursor-pointer border",
                    isSelected
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent bg-muted/20 opacity-60"
                  )}
                  onClick={() => toggle(asset.asset_id)}
                >
                  {/* Thumbnail */}
                  <div className="h-12 w-12 rounded bg-muted/50 flex-shrink-0 overflow-hidden border border-border">
                    {asset.thumbnail ? (
                      <img
                        src={asset.thumbnail}
                        alt={asset.asset_name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Package className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate">
                      {asset.asset_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {asset.category && (
                        <span className="text-[9px] text-muted-foreground bg-muted/50 rounded px-1 py-0.5">
                          {asset.category}
                        </span>
                      )}
                      <ScoreBadge score={asset.score} />
                      <PerformanceBadge polycount={asset.polycount} sizeMb={asset.file_size_mb} />
                    </div>
                    {asset.source && (
                      <span className={cn(
                        "text-[8px] font-medium mt-0.5 inline-block",
                        asset.source === "curated" ? "text-green-400" : "text-blue-400"
                      )}>
                        {asset.source === "curated" ? "✓ Validé" : "⟳ Découverte"}
                      </span>
                    )}
                  </div>

                  {/* Selection indicator */}
                  <div className={cn(
                    "h-5 w-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30"
                  )}>
                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20">
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={selectAll}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Tout
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={selectNone}
              >
                Aucun
              </Button>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-muted-foreground"
                onClick={onDismiss}
              >
                <X className="h-3 w-3 mr-1" />
                Ignorer
              </Button>
              <Button
                size="sm"
                className="h-6 text-[10px] px-3 bg-primary hover:bg-primary/80"
                onClick={handleAccept}
                disabled={selected.size === 0}
              >
                <Check className="h-3 w-3 mr-1" />
                Insérer ({selected.size})
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

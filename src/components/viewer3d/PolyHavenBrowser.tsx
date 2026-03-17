import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, Loader2, X, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  searchTextures,
  getTextureUrls,
  type PolyHavenAsset,
  FLOOR_CATEGORIES,
  WALL_CATEGORIES,
  CEILING_CATEGORIES,
} from "@/lib/polyhavenApi";
import type { PolyHavenTexture } from "./Viewer3DToolbar";

type SurfaceTarget = "floor" | "wall" | "ceiling";

type Props = {
  target: SurfaceTarget;
  currentTexture?: PolyHavenTexture | null;
  onSelect: (texture: PolyHavenTexture | null) => void;
  onClose: () => void;
};

const TARGET_LABELS: Record<SurfaceTarget, string> = {
  floor: "Sol",
  wall: "Murs",
  ceiling: "Plafond",
};

const TARGET_CATEGORIES: Record<SurfaceTarget, string[]> = {
  floor: FLOOR_CATEGORIES,
  wall: WALL_CATEGORIES,
  ceiling: CEILING_CATEGORIES,
};

export function PolyHavenBrowser({ target, currentTexture, onSelect, onClose }: Props) {
  const [assets, setAssets] = useState<Record<string, PolyHavenAsset>>({});
  const [loading, setLoading] = useState(true);
  const [loadingTexture, setLoadingTexture] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = TARGET_CATEGORIES[target];

  // Load textures
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const category = selectedCategory || categories[0];
    searchTextures(category)
      .then((data) => {
        if (!cancelled) {
          setAssets(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [selectedCategory, categories]);

  // Filter by search
  const filtered = useMemo(() => {
    const entries = Object.entries(assets);
    if (!searchQuery.trim()) return entries.slice(0, 40);
    const q = searchQuery.toLowerCase();
    return entries
      .filter(([id, asset]) =>
        id.includes(q) ||
        asset.name.toLowerCase().includes(q) ||
        asset.tags?.some((t) => t.includes(q)) ||
        asset.categories?.some((c) => c.includes(q))
      )
      .slice(0, 40);
  }, [assets, searchQuery]);

  const handleSelect = useCallback(async (id: string, asset: PolyHavenAsset) => {
    if (currentTexture?.id === id) {
      onSelect(null);
      return;
    }
    setLoadingTexture(id);
    try {
      const urls = await getTextureUrls(id, "2k");
      onSelect({
        id,
        name: asset.name,
        thumbnail: asset.thumbnail_url,
        urls,
      });
    } catch (err) {
      console.error("Failed to load texture files:", err);
    } finally {
      setLoadingTexture(null);
    }
  }, [currentTexture, onSelect]);

  return (
    <div className="flex flex-col overflow-hidden max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <img
            src="https://cdn.polyhaven.com/site_images/home/polyhaven_logo_white.png?width=32"
            alt="Poly Haven"
            className="h-4 w-4 opacity-60"
          />
          <h3 className="text-xs font-bold text-foreground tracking-wide">
            Poly Haven — {TARGET_LABELS[target]}
          </h3>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-border">
        {categories.map((cat) => (
          <button
            key={cat}
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-medium transition-all",
              (selectedCategory || categories[0]) === cat
                ? "bg-primary/20 text-primary border border-primary/40"
                : "bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent"
            )}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher une texture…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Chargement…</span>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-xs text-destructive">{error}</p>
            <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setSelectedCategory(selectedCategory)}>
              Réessayer
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            Aucune texture trouvée
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {filtered.map(([id, asset]) => {
              const isSelected = currentTexture?.id === id;
              const isLoading = loadingTexture === id;
              return (
                <button
                  key={id}
                  className={cn(
                    "relative aspect-square rounded-md border-2 overflow-hidden transition-all group",
                    isSelected
                      ? "border-primary ring-1 ring-primary/50"
                      : "border-border/50 hover:border-border"
                  )}
                  onClick={() => handleSelect(id, asset)}
                  disabled={isLoading}
                  title={asset.name}
                >
                  <img
                    src={asset.thumbnail_url}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {isLoading && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[8px] text-white truncate">{asset.name}</p>
                  </div>
                  {isSelected && (
                    <div className="absolute top-1 right-1 h-3 w-3 rounded-full bg-primary border border-white" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Current selection */}
      {currentTexture && (
        <div className="p-2 border-t border-border flex items-center gap-2">
          <img
            src={currentTexture.thumbnail}
            alt={currentTexture.name}
            className="h-8 w-8 rounded object-cover"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium text-foreground truncate">{currentTexture.name}</p>
            <p className="text-[9px] text-muted-foreground">Poly Haven • CC0</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onSelect(null)}
            title="Retirer"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="p-1.5 border-t border-border text-center">
        <a
          href="https://polyhaven.com/textures"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          polyhaven.com <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}

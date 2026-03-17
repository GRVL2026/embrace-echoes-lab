import { useState, useCallback } from "react";
import { Search, Loader2, X, Download, Box, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { searchSketchfab, getSketchfabDownload, type SketchfabModel } from "@/lib/sketchfabApi";
import type { PlacedEquipment } from "@/types/equipment";
import type { Room } from "@/types/editor";

type Props = {
  onAddToScene: (equipment: PlacedEquipment) => void;
  onClose: () => void;
  rooms?: Room[];
};

function getRoomCenter(rooms?: Room[]): { x: number; y: number } {
  if (!rooms || rooms.length === 0) return { x: 400, y: 400 };
  const room = rooms[0];
  if (!room.points || room.points.length === 0) return { x: 400, y: 400 };
  const cx = room.points.reduce((s, p) => s + p.x, 0) / room.points.length;
  const cy = room.points.reduce((s, p) => s + p.y, 0) / room.points.length;
  return { x: cx, y: cy };
}

const SUGGESTED_QUERIES = [
  "arcade machine",
  "neon sign",
  "bar stool",
  "sofa",
  "table",
  "plant pot",
  "ceiling light",
  "speaker",
];

export function SketchfabBrowser({ onAddToScene, onClose, rooms }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SketchfabModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await searchSketchfab({
        query: q.trim(),
        downloadable: true,
        max_results: 24,
      });
      setResults(res.results);
    } catch (e: any) {
      setError(e.message || "Erreur de recherche");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query);
  };

  const handleAddToScene = useCallback(async (model: SketchfabModel) => {
    setDownloading(model.uid);
    try {
      const dl = await getSketchfabDownload(model.uid);
      if (!dl.download_url) {
        setError("Ce modèle n'est pas téléchargeable au format GLB");
        return;
      }

      const equipment: PlacedEquipment = {
        id: `sketchfab-${model.uid}-${Date.now()}`,
        equipmentId: `sketchfab-${model.uid}`,
        position: getRoomCenter(rooms),
        rotation: 0,
        name: model.name,
        width: 100,
        depth: 100,
        height: 100,
        safetyZone: 10,
        color: "hsl(260, 60%, 50%)",
        model3d: dl.download_url,
      };

      onAddToScene(equipment);
    } catch (e: any) {
      setError(e.message || "Erreur de téléchargement");
    } finally {
      setDownloading(null);
    }
  }, [onAddToScene]);

  const formatPolycount = (count?: number) => {
    if (!count) return "—";
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
    return String(count);
  };

  return (
    <div className="flex flex-col overflow-hidden max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-bold text-foreground tracking-wide">
            Assets 3D — Sketchfab
          </h3>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <form onSubmit={handleSubmit} className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un modèle 3D…"
            className="h-7 pl-7 pr-14 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 px-2 text-[10px]"
            disabled={loading || !query.trim()}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Go"}
          </Button>
        </div>
      </form>

      {/* Suggested queries (before first search) */}
      {!hasSearched && (
        <div className="p-2 border-b border-border">
          <p className="text-[10px] text-muted-foreground mb-1.5">Suggestions :</p>
          <div className="flex flex-wrap gap-1">
            {SUGGESTED_QUERIES.map((q) => (
              <button
                key={q}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground hover:bg-muted/80 border border-transparent hover:border-border transition-all"
                onClick={() => { setQuery(q); doSearch(q); }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Recherche en cours…</span>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-xs text-destructive">{error}</p>
            <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => { setError(null); doSearch(query); }}>
              Réessayer
            </Button>
          </div>
        ) : hasSearched && results.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-8">
            Aucun résultat trouvé
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {results.map((model) => {
              const isDownloading = downloading === model.uid;
              return (
                <div
                  key={model.uid}
                  className="flex items-center gap-2 rounded-md border border-border/50 p-1.5 hover:border-border transition-all group"
                >
                  {/* Thumbnail */}
                  <div className="h-14 w-14 shrink-0 rounded-md overflow-hidden bg-muted">
                    {model.thumbnail ? (
                      <img
                        src={model.thumbnail}
                        alt={model.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Box className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate">{model.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-muted-foreground">
                        △ {formatPolycount(model.face_count)}
                      </span>
                      {model.user && (
                        <span className="text-[9px] text-muted-foreground truncate">
                          par {model.user}
                        </span>
                      )}
                    </div>
                    {model.license && (
                      <span className={cn(
                        "inline-block mt-0.5 px-1 py-0 rounded text-[8px] font-medium uppercase",
                        model.license.includes("cc0") ? "bg-green-500/20 text-green-400" :
                        model.license.includes("cc-by") ? "bg-blue-500/20 text-blue-400" :
                        "bg-muted text-muted-foreground"
                      )}>
                        {model.license}
                      </span>
                    )}
                  </div>

                  {/* Add button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/20 hover:text-primary"
                    onClick={() => handleAddToScene(model)}
                    disabled={isDownloading}
                    title="Ajouter à la scène"
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-1.5 border-t border-border text-center">
        <a
          href="https://sketchfab.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          sketchfab.com <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}

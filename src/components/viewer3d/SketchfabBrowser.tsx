import { useState, useCallback } from "react";
import { Search, Loader2, X, Download, Box, ExternalLink, ArrowLeft, Eye, Triangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { searchSketchfab, getSketchfabDownload, type SketchfabModel } from "@/lib/sketchfabApi";
import type { PlacedEquipment } from "@/types/equipment";
import { useEditor } from "@/contexts/EditorContext";

type Props = {
  onAddToScene: (equipment: PlacedEquipment) => void;
  onClose: () => void;
};

function getRoomCenter(rooms: { points: { x: number; y: number }[] }[]): { x: number; y: number } {
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

const formatPolycount = (count?: number) => {
  if (!count) return "—";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(count);
};

/* ─── Preview sub-panel ─── */
function ModelPreview({
  model,
  onBack,
  onAdd,
  isAdding,
}: {
  model: SketchfabModel;
  onBack: () => void;
  onAdd: () => void;
  isAdding: boolean;
}) {
  const embedUrl = `https://sketchfab.com/models/${model.uid}/embed?autostart=1&ui_stop=0&ui_inspector=0&ui_watermark=0&ui_watermark_link=0&ui_hint=0&ui_ar=0&ui_help=0&ui_settings=0&ui_vr=0&ui_fullscreen=0&ui_annotations=0`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <p className="text-[11px] font-semibold text-foreground truncate flex-1">{model.name}</p>
      </div>

      {/* 3D Embed */}
      <div className="relative w-full aspect-square bg-muted">
        <iframe
          title={model.name}
          src={embedUrl}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
        />
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-2 border-t border-border">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <Triangle className="h-2.5 w-2.5" /> {formatPolycount(model.face_count)} faces
          </span>
          {model.vertex_count && (
            <span>{formatPolycount(model.vertex_count)} vertices</span>
          )}
          {model.user && <span>par {model.user}</span>}
        </div>

        {model.license && (
          <span className={cn(
            "inline-block px-1.5 py-0.5 rounded text-[9px] font-medium uppercase",
            model.license.includes("cc0") ? "bg-green-500/20 text-green-400" :
            model.license.includes("cc-by") ? "bg-blue-500/20 text-blue-400" :
            "bg-muted text-muted-foreground"
          )}>
            {model.license}
          </span>
        )}

        {model.description && (
          <p className="text-[10px] text-muted-foreground line-clamp-3">{model.description}</p>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1 h-7 text-[11px] gap-1.5"
            onClick={onAdd}
            disabled={isAdding}
          >
            {isAdding ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Ajouter à la scène
          </Button>
          <a
            href={`https://sketchfab.com/3d-models/${model.uid}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" className="h-7 px-2">
              <ExternalLink className="h-3 w-3" />
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}

/* ─── Main browser ─── */
export function SketchfabBrowser({ onAddToScene, onClose }: Props) {
  const { state } = useEditor();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SketchfabModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [preview, setPreview] = useState<SketchfabModel | null>(null);

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
        position: getRoomCenter(state.rooms),
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
      setPreview(null); // close preview after adding
    } catch (e: any) {
      setError(e.message || "Erreur de téléchargement");
    } finally {
      setDownloading(null);
    }
  }, [onAddToScene, state.rooms]);

  // Preview mode
  if (preview) {
    return (
      <div className="flex flex-col overflow-hidden max-h-[80vh]">
        <ModelPreview
          model={preview}
          onBack={() => setPreview(null)}
          onAdd={() => handleAddToScene(preview)}
          isAdding={downloading === preview.uid}
        />
      </div>
    );
  }

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

      {/* Suggested queries */}
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
                  className="flex items-center gap-2 rounded-md border border-border/50 p-1.5 hover:border-primary/50 transition-all group cursor-pointer"
                  onClick={() => setPreview(model)}
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

                  {/* Preview hint */}
                  <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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

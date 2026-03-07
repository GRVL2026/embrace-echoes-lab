import { useState, useRef } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Package, Play, Trash2, Check, X, FileSpreadsheet } from "lucide-react";
import type { GameEquipment, CatalogJSON } from "@/types/equipment";
import { DEFAULT_SAFETY_ZONE } from "@/types/equipment";
import { autoPlaceEquipment } from "@/lib/placement";

/** Parse a CSV string into GameEquipment[] */
function parseCSV(text: string): GameEquipment[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Le CSV doit contenir au moins un en-tête et une ligne de données");

  // Parse header
  const headers = lines[0].split(/[;,\t]/).map(h => h.trim().toLowerCase());
  const nameIdx = headers.findIndex(h => ["name", "nom"].includes(h));
  const catIdx = headers.findIndex(h => ["category", "catégorie", "categorie", "cat"].includes(h));
  const wIdx = headers.findIndex(h => ["width", "largeur", "w"].includes(h));
  const dIdx = headers.findIndex(h => ["depth", "profondeur", "d"].includes(h));
  const hIdx = headers.findIndex(h => ["height", "hauteur", "h"].includes(h));
  const szIdx = headers.findIndex(h => ["safetyzone", "safety_zone", "zone_securite", "securite"].includes(h));
  const colorIdx = headers.findIndex(h => ["color", "couleur"].includes(h));
  const iconIdx = headers.findIndex(h => ["icon", "icone", "emoji"].includes(h));
  const pmrIdx = headers.findIndex(h => ["pmraccessible", "pmr", "accessible"].includes(h));
  const modelIdx = headers.findIndex(h => ["model3d", "model", "modele3d", "modele", "glb"].includes(h));

  if (nameIdx === -1) throw new Error("Colonne 'name' (ou 'nom') requise dans le CSV");

  // Detect separator used in data lines
  const separator = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';

  const items: GameEquipment[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(separator).map(c => c.trim());
    const name = cols[nameIdx] || `Jeu ${i}`;
    if (!name) continue;

    const pmrRaw = pmrIdx >= 0 ? cols[pmrIdx]?.toLowerCase() : "";
    items.push({
      id: crypto.randomUUID(),
      name,
      category: catIdx >= 0 ? (cols[catIdx] || "autre") : "autre",
      width: wIdx >= 0 ? (Number(cols[wIdx]) || 100) : 100,
      depth: dIdx >= 0 ? (Number(cols[dIdx]) || 100) : 100,
      height: hIdx >= 0 ? (Number(cols[hIdx]) || 200) : 200,
      safetyZone: szIdx >= 0 ? (Number(cols[szIdx]) || DEFAULT_SAFETY_ZONE) : DEFAULT_SAFETY_ZONE,
      color: colorIdx >= 0 ? cols[colorIdx] || undefined : undefined,
      icon: iconIdx >= 0 ? cols[iconIdx] || undefined : undefined,
      pmrAccessible: ["true", "oui", "1", "yes"].includes(pmrRaw),
      model3d: modelIdx >= 0 ? cols[modelIdx] || undefined : undefined,
    });
  }

  if (items.length === 0) throw new Error("Aucun jeu trouvé dans le CSV");
  return items;
}

// Color palette for equipment categories
const CATEGORY_COLORS: Record<string, string> = {
  "arcade": "hsl(263, 85%, 68%)",
  "flipper": "hsl(75, 100%, 45%)",
  "billard": "hsl(200, 80%, 50%)",
  "babyfoot": "hsl(30, 90%, 55%)",
  "flechettes": "hsl(0, 70%, 55%)",
  "simulateur": "hsl(180, 70%, 50%)",
  "default": "hsl(48, 100%, 50%)",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] || CATEGORY_COLORS.default;
}

export function CatalogPanel() {
  const { state, dispatch } = useEditor();
  const [catalog, setCatalog] = useState<GameEquipment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        let items: GameEquipment[] = [];

        const isCSV = file.name.toLowerCase().endsWith(".csv");

        if (isCSV) {
          items = parseCSV(text);
        } else {
          // JSON parsing
          const json = JSON.parse(text);
          if (Array.isArray(json)) {
            items = json;
          } else if (json.catalog && Array.isArray(json.catalog)) {
            items = json.catalog;
          } else {
            throw new Error("Format invalide. Attendu: { catalog: [...] } ou un tableau.");
          }
        }

        // Validate and normalize
        const validated = items.map((item, i) => ({
          id: item.id || crypto.randomUUID(),
          name: item.name || `Jeu ${i + 1}`,
          category: item.category || "autre",
          width: Number(item.width) || 100,
          depth: Number(item.depth) || 100,
          height: Number(item.height) || 200,
          safetyZone: Number(item.safetyZone) || DEFAULT_SAFETY_ZONE,
          color: item.color || getCategoryColor(item.category || "default"),
          icon: item.icon,
          pmrAccessible: item.pmrAccessible ?? false,
          model3d: item.model3d,
        }));

        setCatalog(prev => [...prev, ...validated]);
        const fmt = isCSV ? "CSV" : "JSON";
        toast.success(`${validated.length} jeu${validated.length > 1 ? "x" : ""} importé${validated.length > 1 ? "s" : ""} (${fmt})`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur de parsing");
      }
    };
    reader.readAsText(file);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAutoPlace = () => {
    const selected = catalog.filter(e => selectedIds.has(e.id));
    if (selected.length === 0) {
      toast.error("Sélectionnez au moins un jeu");
      return;
    }
    if (state.rooms.length === 0) {
      toast.error("Dessinez au moins une salle fermée");
      return;
    }

    const closedRooms = state.rooms.filter(r => r.isClosed);
    if (closedRooms.length === 0) {
      toast.error("Aucune salle fermée trouvée");
      return;
    }

    const newPlacements = autoPlaceEquipment(
      selected,
      state.rooms,
      state.doors,
      state.pillars,
      state.placedEquipments,
    );

    if (newPlacements.length === 0) {
      toast.error("Impossible de placer les jeux sélectionnés (espace insuffisant)");
      return;
    }

    dispatch({ type: "ADD_PLACED_EQUIPMENTS", equipments: newPlacements });

    const placed = newPlacements.length;
    const failed = selected.length - placed;
    if (failed > 0) {
      toast.warning(`${placed} jeu${placed > 1 ? "x" : ""} placé${placed > 1 ? "s" : ""}, ${failed} impossible${failed > 1 ? "s" : ""} à placer`);
    } else {
      toast.success(`${placed} jeu${placed > 1 ? "x" : ""} placé${placed > 1 ? "s" : ""} avec succès`);
    }

    setSelectedIds(new Set());
  };

  const handleClearPlacements = () => {
    dispatch({ type: "CLEAR_PLACED_EQUIPMENTS" });
    toast.info("Tous les équipements retirés du plan");
  };

  // Group by category
  const categories = catalog.reduce<Record<string, GameEquipment[]>>((acc, eq) => {
    const cat = eq.category || "autre";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(eq);
    return acc;
  }, {});

  return (
    <div className="flex flex-col border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="font-display text-sm font-bold text-foreground flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          Catalogue
        </h3>
        <div className="flex gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportCatalog(file);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {catalog.length === 0 ? (
        <div className="p-4">
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Importez un fichier JSON pour charger le catalogue de jeux
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              Importer JSON
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Selection actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 p-2 bg-primary/10 border-b border-border">
              <span className="text-xs text-primary font-medium flex-1">
                {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
              </span>
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleAutoPlace}>
                <Play className="h-3 w-3" />
                Placer
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Catalog list */}
          <ScrollArea className="max-h-[300px]">
            <div className="p-2 space-y-3">
              {Object.entries(categories).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 px-1">
                    {cat}
                  </p>
                  <div className="space-y-1">
                    {items.map((eq) => {
                      const isSelected = selectedIds.has(eq.id);
                      return (
                        <button
                          key={eq.id}
                          className={`w-full rounded-md border p-2 text-left transition-all text-xs ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-surface hover:border-primary/30"
                          }`}
                          onClick={() => toggleSelection(eq.id)}
                        >
                          <div className="flex items-center gap-2">
                            {eq.icon && <span className="text-base">{eq.icon}</span>}
                            <span className="font-medium text-foreground flex-1 truncate">
                              {eq.name}
                            </span>
                            {isSelected && (
                              <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                            )}
                          </div>
                          <div className="flex gap-2 mt-1 text-muted-foreground">
                            <span>{eq.width}×{eq.depth}cm</span>
                            <span>·</span>
                            <span>h{eq.height}cm</span>
                            {eq.pmrAccessible && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">PMR</Badge>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      {/* Placed equipments */}
      {state.placedEquipments.length > 0 && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between p-2">
            <span className="text-xs font-semibold text-foreground">
              Sur le plan ({state.placedEquipments.length})
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive/60 hover:text-destructive"
              onClick={handleClearPlacements}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <ScrollArea className="max-h-[150px]">
            <div className="px-2 pb-2 space-y-1">
              {state.placedEquipments.map((pe) => (
                <div
                  key={pe.id}
                  className="flex items-center justify-between rounded border border-border bg-surface p-1.5 text-xs"
                >
                  <span className="truncate text-foreground">{pe.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive/50 hover:text-destructive shrink-0"
                    onClick={() => dispatch({ type: "DELETE_PLACED_EQUIPMENT", id: pe.id })}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

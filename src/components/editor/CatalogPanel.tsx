import { useState, useRef, useMemo } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Package, Play, Trash2, Check, X, Info, Search } from "lucide-react";
import type { GameEquipment, CatalogJSON } from "@/types/equipment";
import { DEFAULT_SAFETY_ZONE } from "@/types/equipment";
import { autoPlaceEquipment } from "@/lib/placement";
import { ProductDialog } from "./ProductDialog";

/** Parse Shopify CSV dimensions like "L 1030 x P 2500 x H 2640 mm" */
function parseShopifyDimensions(dimStr: string): { width: number; depth: number; height: number } | null {
  if (!dimStr) return null;
  // Match patterns like "L 1030 x P 2500 x H 2640 mm" or "L1030xP2500xH2640"
  const match = dimStr.match(/L\s*(\d+)\s*x?\s*P\s*(\d+)\s*x?\s*H\s*(\d+)/i);
  if (match) {
    return {
      width: parseInt(match[1], 10) / 10, // mm to cm
      depth: parseInt(match[2], 10) / 10,
      height: parseInt(match[3], 10) / 10,
    };
  }
  return null;
}

/** Parse Shopify CSV export into GameEquipment[] */
function parseShopifyCSV(text: string): GameEquipment[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Le CSV doit contenir au moins un en-tête et une ligne de données");

  // Parse header - handle quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  
  // Find column indices
  const findCol = (...names: string[]) => headers.findIndex(h => names.some(n => h.includes(n)));
  
  const handleIdx = findCol("handle");
  const titleIdx = findCol("title");
  const bodyIdx = findCol("body");
  const vendorIdx = findCol("vendor");
  const typeIdx = findCol("type");
  const tagsIdx = findCol("tags");
  const priceIdx = findCol("variant price");
  const imageIdx = findCol("image src");
  const dimIdx = findCol("specs dimensions");
  const powerIdx = findCol("specs power");
  const screenIdx = findCol("specs screen");
  const capacityIdx = findCol("specs capacity");
  const ticketsIdx = findCol("specs tickets");
  const weightIdx = findCol("specs weight");
  const videoIdx = findCol("video url");
  const warrantyIdx = findCol("warranty");
  const stockIdx = findCol("stock");

  // Group rows by handle (products can span multiple rows for variants/images)
  const productMap = new Map<string, {
    handle: string;
    title: string;
    body: string;
    vendor: string;
    type: string;
    tags: string;
    price: string;
    images: string[];
    dimensions: string;
    power: string;
    screen: string;
    capacity: string;
    tickets: string;
    weight: string;
    videoUrl: string;
    warranty: string;
    stock: string;
  }>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const handle = handleIdx >= 0 ? cols[handleIdx] : "";
    if (!handle) continue;

    const imageSrc = imageIdx >= 0 ? cols[imageIdx] : "";

    if (productMap.has(handle)) {
      // Add additional image
      const existing = productMap.get(handle)!;
      if (imageSrc && !existing.images.includes(imageSrc)) {
        existing.images.push(imageSrc);
      }
    } else {
      // New product
      productMap.set(handle, {
        handle,
        title: titleIdx >= 0 ? cols[titleIdx] : "",
        body: bodyIdx >= 0 ? cols[bodyIdx] : "",
        vendor: vendorIdx >= 0 ? cols[vendorIdx] : "",
        type: typeIdx >= 0 ? cols[typeIdx] : "",
        tags: tagsIdx >= 0 ? cols[tagsIdx] : "",
        price: priceIdx >= 0 ? cols[priceIdx] : "",
        images: imageSrc ? [imageSrc] : [],
        dimensions: dimIdx >= 0 ? cols[dimIdx] : "",
        power: powerIdx >= 0 ? cols[powerIdx] : "",
        screen: screenIdx >= 0 ? cols[screenIdx] : "",
        capacity: capacityIdx >= 0 ? cols[capacityIdx] : "",
        tickets: ticketsIdx >= 0 ? cols[ticketsIdx] : "",
        weight: weightIdx >= 0 ? cols[weightIdx] : "",
        videoUrl: videoIdx >= 0 ? cols[videoIdx] : "",
        warranty: warrantyIdx >= 0 ? cols[warrantyIdx] : "",
        stock: stockIdx >= 0 ? cols[stockIdx] : "",
      });
    }
  }

  // Convert to GameEquipment
  const items: GameEquipment[] = [];
  
  for (const [, product] of productMap) {
    if (!product.title) continue;

    // Parse dimensions
    const dims = parseShopifyDimensions(product.dimensions);
    const width = dims?.width || 100;
    const depth = dims?.depth || 100;
    const height = dims?.height || 200;

    // Parse tags
    const tags = product.tags
      ? product.tags.split(",").map(t => t.trim()).filter(Boolean)
      : [];

    // Parse price
    const price = product.price ? parseFloat(product.price.replace(",", ".")) : undefined;

    items.push({
      id: crypto.randomUUID(),
      name: product.title,
      category: product.type || "autre",
      width,
      depth,
      height,
      safetyZone: DEFAULT_SAFETY_ZONE,
      color: getCategoryColor(product.type || "default"),
      description: product.body || undefined,
      vendor: product.vendor || undefined,
      price: price && price > 0 ? price : undefined,
      images: product.images.length > 0 ? product.images : undefined,
      videoUrl: product.videoUrl || undefined,
      tags: tags.length > 0 ? tags : undefined,
      warranty: product.warranty || undefined,
      stock: product.stock || undefined,
      specs: {
        power: product.power || undefined,
        screen: product.screen || undefined,
        capacity: product.capacity || undefined,
        tickets: product.tickets?.toLowerCase() === "oui" ? true : 
                 product.tickets?.toLowerCase() === "non" ? false : undefined,
      },
    });
  }

  if (items.length === 0) throw new Error("Aucun produit trouvé dans le CSV");
  return items;
}

/** Parse a simple CSV string into GameEquipment[] (original format) */
function parseSimpleCSV(text: string): GameEquipment[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("Le CSV doit contenir au moins un en-tête et une ligne de données");

  const headers = lines[0].split(/[;,\t]/).map(h => h.trim().toLowerCase());
  const nameIdx = headers.findIndex(h => ["name", "nom", "title"].includes(h));
  const catIdx = headers.findIndex(h => ["category", "catégorie", "categorie", "cat", "type"].includes(h));
  const wIdx = headers.findIndex(h => ["width", "largeur", "w"].includes(h));
  const dIdx = headers.findIndex(h => ["depth", "profondeur", "d"].includes(h));
  const hIdx = headers.findIndex(h => ["height", "hauteur", "h"].includes(h));
  const szIdx = headers.findIndex(h => ["safetyzone", "safety_zone", "zone_securite", "securite"].includes(h));
  const colorIdx = headers.findIndex(h => ["color", "couleur"].includes(h));
  const iconIdx = headers.findIndex(h => ["icon", "icone", "emoji"].includes(h));
  const pmrIdx = headers.findIndex(h => ["pmraccessible", "pmr", "accessible"].includes(h));
  const modelIdx = headers.findIndex(h => ["model3d", "model", "modele3d", "modele", "glb"].includes(h));

  if (nameIdx === -1) return []; // Not a simple format

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

  return items;
}

/** Detect CSV format and parse accordingly */
function parseCSV(text: string): GameEquipment[] {
  const firstLine = text.split(/\r?\n/)[0]?.toLowerCase() || "";
  
  // Detect Shopify format by checking for specific columns
  if (firstLine.includes("handle") && firstLine.includes("title") && firstLine.includes("vendor")) {
    return parseShopifyCSV(text);
  }
  
  // Try simple format
  const simpleResult = parseSimpleCSV(text);
  if (simpleResult.length > 0) {
    return simpleResult;
  }
  
  // Fallback to Shopify parser
  return parseShopifyCSV(text);
}

// Color palette for equipment categories
const CATEGORY_COLORS: Record<string, string> = {
  "arcade": "hsl(263, 85%, 68%)",
  "flipper": "hsl(75, 100%, 45%)",
  "flippers": "hsl(75, 100%, 45%)",
  "billard": "hsl(200, 80%, 50%)",
  "babyfoot": "hsl(30, 90%, 55%)",
  "flechettes": "hsl(0, 70%, 55%)",
  "simulateur": "hsl(180, 70%, 50%)",
  "sport": "hsl(142, 76%, 45%)",
  "tir": "hsl(0, 85%, 55%)",
  "jeux famille": "hsl(280, 70%, 60%)",
  "grues & distributeurs": "hsl(45, 90%, 50%)",
  "réalité virtuelle": "hsl(200, 90%, 55%)",
  "adresse": "hsl(330, 70%, 55%)",
  "jeux de conduite": "hsl(15, 85%, 55%)",
  "default": "hsl(48, 100%, 50%)",
};

function getCategoryColor(category: string): string {
  const key = category.toLowerCase();
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.default;
}

type CatalogPanelProps = {
  catalog: GameEquipment[];
  setCatalog: React.Dispatch<React.SetStateAction<GameEquipment[]>>;
};

export function CatalogPanel({ catalog, setCatalog }: CatalogPanelProps) {
  const { state, dispatch } = useEditor();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewingProduct, setViewingProduct] = useState<GameEquipment | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter catalog based on search query
  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return catalog;
    const query = searchQuery.toLowerCase().trim();
    return catalog.filter(eq => 
      eq.name.toLowerCase().includes(query) ||
      eq.category.toLowerCase().includes(query) ||
      (eq.vendor && eq.vendor.toLowerCase().includes(query)) ||
      (eq.tags && eq.tags.some(tag => tag.toLowerCase().includes(query)))
    );
  }, [catalog, searchQuery]);

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
          ...item,
          id: item.id || crypto.randomUUID(),
          name: item.name || `Jeu ${i + 1}`,
          category: item.category || "autre",
          width: Number(item.width) || 100,
          depth: Number(item.depth) || 100,
          height: Number(item.height) || 200,
          safetyZone: Number(item.safetyZone) || DEFAULT_SAFETY_ZONE,
          color: item.color || getCategoryColor(item.category || "default"),
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

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleViewProduct = (eq: GameEquipment) => {
    setViewingProduct(eq);
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
            accept=".json,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
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
              Importez un fichier CSV ou JSON pour charger le catalogue
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              Importer
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
                        <div
                          key={eq.id}
                          className={`w-full rounded-md border p-2 text-left transition-all text-xs cursor-pointer ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-surface hover:border-primary/30"
                          }`}
                          onClick={() => handleViewProduct(eq)}
                        >
                          <div className="flex items-center gap-2">
                            {eq.images && eq.images[0] ? (
                              <img 
                                src={eq.images[0]} 
                                alt={eq.name}
                                className="w-8 h-8 rounded object-contain bg-muted/30"
                              />
                            ) : eq.icon ? (
                              <span className="text-base">{eq.icon}</span>
                            ) : null}
                            <span className="font-medium text-foreground flex-1 truncate">
                              {eq.name}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewProduct(eq);
                              }}
                            >
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <button
                              className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                isSelected 
                                  ? "bg-primary border-primary text-primary-foreground" 
                                  : "border-muted-foreground/30 hover:border-primary"
                              }`}
                              onClick={(e) => toggleSelection(eq.id, e)}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </button>
                          </div>
                          <div className="flex gap-2 mt-1 text-muted-foreground">
                            <span>{eq.width}×{eq.depth}cm</span>
                            <span>·</span>
                            <span>h{eq.height}cm</span>
                            {eq.price && eq.price > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-primary font-medium">{eq.price.toLocaleString("fr-FR")}€</span>
                              </>
                            )}
                            {eq.pmrAccessible && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">PMR</Badge>
                            )}
                          </div>
                        </div>
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

      {/* Product detail dialog */}
      <ProductDialog 
        equipment={viewingProduct} 
        open={!!viewingProduct} 
        onOpenChange={(open) => !open && setViewingProduct(null)} 
      />
    </div>
  );
}

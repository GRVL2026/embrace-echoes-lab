import { useState, useRef, useMemo } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, Package, Play, Trash2, Check, X, Info, Search, Maximize2, Minus, Plus } from "lucide-react";
import type { GameEquipment, CatalogJSON } from "@/types/equipment";
import { DEFAULT_SAFETY_ZONE } from "@/types/equipment";
import { autoPlaceEquipment } from "@/lib/placement";
import { ProductDialog } from "./ProductDialog";

/** Parse Shopify CSV dimensions like "L 1030 x P 2500 x H 2640 mm" or "35X22X12" */
function parseShopifyDimensions(dimStr: string): { width: number; depth: number; height: number } | null {
  if (!dimStr || !dimStr.trim()) return null;
  const s = dimStr.trim();
  
  // Pattern 1: "L 1030 x P 2500 x H 2640 mm" (mm → cm)
  const lph = s.match(/L\s*(\d+)\s*x?\s*P\s*(\d+)\s*x?\s*H\s*(\d+)/i);
  if (lph) {
    return {
      width: parseInt(lph[1], 10) / 10,
      depth: parseInt(lph[2], 10) / 10,
      height: parseInt(lph[3], 10) / 10,
    };
  }

  // Pattern 2: "L 1030 x P 2500 x H 2640" with various separators
  const lphLoose = s.match(/L\s*[:\s]*(\d+)\s*[x×\s]+P\s*[:\s]*(\d+)\s*[x×\s]+H\s*[:\s]*(\d+)/i);
  if (lphLoose) {
    return {
      width: parseInt(lphLoose[1], 10) / 10,
      depth: parseInt(lphLoose[2], 10) / 10,
      height: parseInt(lphLoose[3], 10) / 10,
    };
  }

  // Pattern 3: "NNNxNNNxNNN" or "NNN X NNN X NNN" (plain dimensions, assumed cm)
  const plain = s.match(/(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)/);
  if (plain) {
    return {
      width: parseInt(plain[1], 10),
      depth: parseInt(plain[2], 10),
      height: parseInt(plain[3], 10),
    };
  }

  return null;
}

/** Parse Shopify CSV export into GameEquipment[] */
function parseShopifyCSV(text: string): GameEquipment[] {
  // Proper CSV parsing that handles multi-line quoted fields
  const parseCSVFull = (csv: string): string[][] => {
    const rows: string[][] = [];
    let current = "";
    let inQuotes = false;
    let row: string[] = [];
    
    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      
      if (char === '"') {
        if (inQuotes && i + 1 < csv.length && csv[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = "";
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') {
          i++; // skip \r\n
        }
        row.push(current.trim());
        if (row.some(cell => cell.length > 0)) {
          rows.push(row);
        }
        row = [];
        current = "";
      } else {
        current += char;
      }
    }
    // Last row
    row.push(current.trim());
    if (row.some(cell => cell.length > 0)) {
      rows.push(row);
    }
    return rows;
  };

  const allRows = parseCSVFull(text);
  if (allRows.length < 2) throw new Error("Le CSV doit contenir au moins un en-tête et une ligne de données");

  const headers = allRows[0].map(h => h.toLowerCase());
  
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

  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
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
  
  for (const [handle, product] of productMap) {
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
  const [selectedQuantities, setSelectedQuantities] = useState<Map<string, number>>(new Map());
  const [viewingProduct, setViewingProduct] = useState<GameEquipment | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedView, setExpandedView] = useState(false);
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

  // Total selected items count
  const totalSelectedCount = useMemo(() => {
    let total = 0;
    selectedQuantities.forEach((qty) => { total += qty; });
    return total;
  }, [selectedQuantities]);

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

  const incrementQuantity = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedQuantities(prev => {
      const next = new Map(prev);
      const current = next.get(id) || 0;
      next.set(id, current + 1);
      return next;
    });
  };

  const decrementQuantity = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedQuantities(prev => {
      const next = new Map(prev);
      const current = next.get(id) || 0;
      if (current <= 1) {
        next.delete(id);
      } else {
        next.set(id, current - 1);
      }
      return next;
    });
  };

  const handleViewProduct = (eq: GameEquipment) => {
    setViewingProduct(eq);
  };

  const handleAutoPlace = () => {
    if (selectedQuantities.size === 0) {
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

    // Build array with duplicates based on quantities
    const selected: GameEquipment[] = [];
    selectedQuantities.forEach((qty, id) => {
      const eq = catalog.find(e => e.id === id);
      if (eq) {
        for (let i = 0; i < qty; i++) {
          selected.push(eq);
        }
      }
    });

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
    const failed = totalSelectedCount - placed;
    if (failed > 0) {
      toast.warning(`${placed} jeu${placed > 1 ? "x" : ""} placé${placed > 1 ? "s" : ""}, ${failed} impossible${failed > 1 ? "s" : ""} à placer`);
    } else {
      toast.success(`${placed} jeu${placed > 1 ? "x" : ""} placé${placed > 1 ? "s" : ""} avec succès`);
    }

    setSelectedQuantities(new Map());
  };

  const handleClearPlacements = () => {
    dispatch({ type: "CLEAR_PLACED_EQUIPMENTS" });
    toast.info("Tous les équipements retirés du plan");
  };

  // Group filtered catalog by category
  const categories = filteredCatalog.reduce<Record<string, GameEquipment[]>>((acc, eq) => {
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
          {catalog.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setExpandedView(true)}
              title="Agrandir le catalogue"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Search bar */}
      {catalog.length > 0 && (
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher (nom, type, fournisseur...)"
              className="h-8 pl-8 text-xs"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          {searchQuery && (
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
              {filteredCatalog.length} résultat{filteredCatalog.length > 1 ? "s" : ""} sur {catalog.length}
            </p>
          )}
        </div>
      )}

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
          {totalSelectedCount > 0 && (
            <div className="flex items-center gap-2 p-2 bg-primary/10 border-b border-border">
              <span className="text-xs text-primary font-medium flex-1">
                {totalSelectedCount} jeu{totalSelectedCount > 1 ? "x" : ""} ({selectedQuantities.size} type{selectedQuantities.size > 1 ? "s" : ""})
              </span>
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleAutoPlace}>
                <Play className="h-3 w-3" />
                Placer
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedQuantities(new Map())}
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
                      const quantity = selectedQuantities.get(eq.id) || 0;
                      const isSelected = quantity > 0;
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
                            {/* Quantity controls */}
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {isSelected && (
                                <button
                                  className="h-5 w-5 rounded border border-muted-foreground/30 flex items-center justify-center hover:border-primary hover:bg-primary/10 transition-colors"
                                  onClick={(e) => decrementQuantity(eq.id, e)}
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                              )}
                              {isSelected && (
                                <span className="w-5 text-center font-medium text-primary text-xs">
                                  {quantity}
                                </span>
                              )}
                              <button
                                className={`h-5 w-5 rounded border flex items-center justify-center transition-colors ${
                                  isSelected 
                                    ? "border-primary bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground" 
                                    : "border-muted-foreground/30 hover:border-primary hover:bg-primary/10"
                                }`}
                                onClick={(e) => incrementQuantity(eq.id, e)}
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
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

      {/* Expanded catalog dialog */}
      <Dialog open={expandedView} onOpenChange={setExpandedView}>
        <DialogContent className={`h-[85vh] overflow-hidden p-0 ${selectedIds.size > 0 ? 'sm:max-w-6xl' : 'sm:max-w-4xl'}`}>
          <div className="flex h-full min-h-0">
            {/* Main catalog area */}
            <div className={`flex-1 flex flex-col min-h-0 ${selectedIds.size > 0 ? 'border-r border-border' : ''}`}>
              <DialogHeader className="p-4 pb-0 shrink-0">
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Catalogue ({catalog.length} jeux)
                </DialogTitle>
              </DialogHeader>
              
              <div className="p-4 pt-2 flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Search in expanded view */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher (nom, type, fournisseur...)"
                    className="pl-10"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setSearchQuery("")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                
                {searchQuery && (
                  <p className="text-sm text-muted-foreground mb-3">
                    {filteredCatalog.length} résultat{filteredCatalog.length > 1 ? "s" : ""} sur {catalog.length}
                  </p>
                )}

                {/* Expanded catalog grid */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
                  <div className={`grid gap-3 pb-4 ${selectedIds.size > 0 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
                    {filteredCatalog.map((eq) => {
                      const isSelected = selectedIds.has(eq.id);
                      return (
                        <div
                          key={eq.id}
                          className={`rounded-lg border p-3 cursor-pointer transition-all ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-surface hover:border-primary/30"
                          }`}
                          onClick={() => handleViewProduct(eq)}
                        >
                          {/* Image */}
                          {eq.images && eq.images[0] ? (
                            <div className="aspect-square rounded-md overflow-hidden bg-muted/30 mb-2">
                              <img 
                                src={eq.images[0]} 
                                alt={eq.name}
                                className="w-full h-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="aspect-square rounded-md bg-muted/30 mb-2 flex items-center justify-center">
                              <Package className="h-8 w-8 text-muted-foreground/30" />
                            </div>
                          )}
                          
                          {/* Info */}
                          <h4 className="font-medium text-sm text-foreground truncate">{eq.name}</h4>
                          {eq.vendor && (
                            <p className="text-xs text-muted-foreground truncate">{eq.vendor}</p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-muted-foreground">
                              {eq.width}×{eq.depth}cm
                            </span>
                            {eq.price && eq.price > 0 && (
                              <span className="text-xs font-medium text-primary">
                                {eq.price.toLocaleString("fr-FR")}€
                              </span>
                            )}
                          </div>
                          
                          {/* Selection checkbox */}
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                            <Badge variant="outline" className="text-[10px]">{eq.category}</Badge>
                            <button
                              className={`h-6 w-6 rounded border flex items-center justify-center transition-colors ${
                                isSelected 
                                  ? "bg-primary border-primary text-primary-foreground" 
                                  : "border-muted-foreground/30 hover:border-primary"
                              }`}
                              onClick={(e) => toggleSelection(eq.id, e)}
                            >
                              {isSelected && <Check className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Selection sidebar */}
            {selectedIds.size > 0 && (
              <div className="w-80 flex flex-col bg-muted/30">
                <div className="p-4 border-b border-border">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-foreground">
                      Sélection ({selectedIds.size})
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Tout effacer
                    </Button>
                  </div>
                </div>

                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-2">
                    {catalog.filter(eq => selectedIds.has(eq.id)).map((eq) => (
                      <div
                        key={eq.id}
                        className="rounded-lg border border-border bg-background p-2.5 group"
                      >
                        <div className="flex gap-2">
                          {eq.images && eq.images[0] ? (
                            <img 
                              src={eq.images[0]} 
                              alt={eq.name}
                              className="w-12 h-12 rounded object-contain bg-muted/50 shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded bg-muted/50 flex items-center justify-center shrink-0">
                              <Package className="h-5 w-5 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-xs text-foreground truncate">{eq.name}</h4>
                            {eq.vendor && (
                              <p className="text-[10px] text-muted-foreground truncate">{eq.vendor}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-muted-foreground">
                                {eq.width}×{eq.depth}×{eq.height}cm
                              </span>
                              {eq.price && eq.price > 0 && (
                                <span className="text-[10px] font-medium text-primary">
                                  {eq.price.toLocaleString("fr-FR")}€
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive"
                            onClick={() => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                next.delete(eq.id);
                                return next;
                              });
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* Total and action */}
                <div className="p-4 border-t border-border space-y-3">
                  {catalog.filter(eq => selectedIds.has(eq.id)).some(eq => eq.price && eq.price > 0) && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total estimé</span>
                      <span className="font-semibold text-foreground">
                        {catalog
                          .filter(eq => selectedIds.has(eq.id))
                          .reduce((sum, eq) => sum + (eq.price || 0), 0)
                          .toLocaleString("fr-FR")} €
                      </span>
                    </div>
                  )}
                  <Button 
                    className="w-full gap-2" 
                    onClick={() => { handleAutoPlace(); setExpandedView(false); }}
                  >
                    <Play className="h-4 w-4" />
                    Placer sur le plan
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

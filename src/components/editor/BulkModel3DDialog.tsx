import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Box, CheckCircle2, XCircle, Loader2, Trash2, Ruler } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { GameEquipment } from "@/types/equipment";
import { uploadFileResumable } from "@/lib/resumableUpload";
import { updateCatalogProduct } from "@/lib/catalogDB";
import { readGLBDimensions, dimsDivergeSignificantly, type GLBDimensions } from "@/lib/glbBounds";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 Mo
const IGNORE = "__ignore__";

type Row = {
  file: File;
  matchedId: string; // equipment id, or IGNORE
  status: "pending" | "measuring" | "uploading" | "done" | "error" | "skipped";
  progress: number;
  message?: string;
  modelDims?: GLBDimensions; // measured GLB bounding box (cm)
  measuringError?: string;
  adoptDims: boolean; // checkbox — apply model dimensions to the product
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: GameEquipment[];
  setCatalog: React.Dispatch<React.SetStateAction<GameEquipment[]>>;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Longest common substring length between two normalized strings. */
function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let best = 0;
  // rolling row to keep memory bounded
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return best;
}

function bestMatch(filename: string, catalog: GameEquipment[]): string {
  const base = filename.replace(/\.(glb|gltf)$/i, "");
  const nFile = normalize(base);
  if (!nFile) return IGNORE;

  let bestId = IGNORE;
  let bestScore = 0;
  for (const eq of catalog) {
    const nName = normalize(eq.name);
    if (!nName) continue;
    if (nFile === nName) return eq.id;
    const contains = nFile.includes(nName) || nName.includes(nFile);
    const lcs = lcsLength(nFile, nName);
    // Score favors long common substrings + containment.
    const score = lcs + (contains ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = eq.id;
    }
  }
  // Require a minimum overlap (≥ 4 chars) to accept.
  return bestScore >= 4 ? bestId : IGNORE;
}

export function BulkModel3DDialog({ open, onOpenChange, catalog, setCatalog }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{ ok: number; skipped: number; errors: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const catalogSorted = useMemo(
    () => [...catalog].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog],
  );

  const addFiles = (files: File[]) => {
    const glbs = files.filter((f) => /\.glb$/i.test(f.name));
    if (glbs.length === 0) {
      toast.error("Seuls les fichiers .glb sont acceptés");
      return;
    }
    const oversized = glbs.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      toast.error(`${oversized.length} fichier(s) dépassent ${formatBytes(MAX_FILE_SIZE)} et seront ignorés`);
    }
    const kept = glbs.filter((f) => f.size <= MAX_FILE_SIZE);
    const newRows: Row[] = kept.map((f) => ({
      file: f,
      matchedId: bestMatch(f.name, catalog),
      status: "pending",
      progress: 0,
      adoptDims: false,
    }));
    setRows((prev) => {
      // Dedup by filename
      const existing = new Set(prev.map((r) => r.file.name));
      const merged = [...prev, ...newRows.filter((r) => !existing.has(r.file.name))];
      // Kick off async bounding-box measurement for the newly added rows.
      newRows.forEach((r) => {
        if (existing.has(r.file.name)) return;
        void (async () => {
          try {
            const dims = await readGLBDimensions(r.file, 0);
            setRows((current) =>
              current.map((row) => {
                if (row.file.name !== r.file.name) return row;
                const matched = catalog.find((c) => c.id === row.matchedId);
                const diverges = matched
                  ? dimsDivergeSignificantly(dims, matched)
                  : true;
                return { ...row, modelDims: dims, adoptDims: diverges };
              }),
            );
          } catch (err: any) {
            setRows((current) =>
              current.map((row) =>
                row.file.name === r.file.name
                  ? { ...row, measuringError: err?.message || "Lecture GLB impossible" }
                  : row,
              ),
            );
          }
        })();
      });
      return merged;
    });
    setReport(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const toImportCount = rows.filter((r) => r.matchedId !== IGNORE).length;

  const handleRun = async () => {
    if (toImportCount === 0) {
      toast.error("Aucun fichier à importer");
      return;
    }
    setRunning(true);
    let ok = 0, skipped = 0, errors = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.matchedId === IGNORE) {
        updateRow(i, { status: "skipped" });
        skipped++;
        continue;
      }
      const eq = catalog.find((e) => e.id === r.matchedId);
      if (!eq) {
        updateRow(i, { status: "error", message: "Produit introuvable" });
        errors++;
        continue;
      }
      try {
        updateRow(i, { status: "uploading", progress: 0 });
        const safeName = r.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${eq.id}/${Date.now()}-${safeName}`;
        // NB: fichiers déjà optimisés Draco+WebP → PAS de recompression
        await uploadFileResumable({
          bucket: "models-3d",
          path: filePath,
          file: r.file,
          upsert: true,
          onProgress: (pct) => updateRow(i, { progress: pct }),
        });
        const { data: urlData } = supabase.storage.from("models-3d").getPublicUrl(filePath);
        const url = urlData.publicUrl;

        const dbPatch: Record<string, any> = { model3d: url };
        const localPatch: Partial<GameEquipment> = { model3d: url };
        if (r.adoptDims && r.modelDims) {
          dbPatch.width = r.modelDims.width;
          dbPatch.depth = r.modelDims.depth;
          dbPatch.height = r.modelDims.height;
          localPatch.width = r.modelDims.width;
          localPatch.depth = r.modelDims.depth;
          localPatch.height = r.modelDims.height;
        }
        await updateCatalogProduct(eq.id, dbPatch);
        setCatalog((prev) => prev.map((c) => (c.id === eq.id ? { ...c, ...localPatch } : c)));

        updateRow(i, { status: "done", progress: 100 });
        ok++;
      } catch (err: any) {
        console.error("[BulkModel3D] upload failed:", err);
        updateRow(i, { status: "error", message: err?.message || "Erreur inconnue" });
        errors++;
      }
    }

    setRunning(false);
    setReport({ ok, skipped, errors });
    toast.success(`Import terminé : ${ok} importé(s), ${skipped} ignoré(s), ${errors} erreur(s)`);
  };

  const handleClose = (openNext: boolean) => {
    if (running) return;
    if (!openNext) {
      setRows([]);
      setReport(null);
    }
    onOpenChange(openNext);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden p-0">
        <div className="p-6 pb-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Box className="h-5 w-5 text-primary" />
              Importer des modèles 3D en masse
            </DialogTitle>
            <DialogDescription>
              Dépose des .glb déjà optimisés (Draco + WebP). Ils seront envoyés tels quels et
              associés automatiquement aux produits du catalogue par similarité de nom.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
            }`}
          >
            <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-foreground font-medium">
              Glisse-dépose tes .glb ici
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ou clique pour sélectionner plusieurs fichiers
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []));
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
          </div>

          {rows.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <span>
                  {rows.length} fichier{rows.length > 1 ? "s" : ""} · {toImportCount} à importer
                </span>
                {!running && (
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setRows([])}
                  >
                    Tout retirer
                  </button>
                )}
              </div>
              <ScrollArea className="max-h-[45vh]">
                <ul className="divide-y divide-border">
                  {rows.map((r, idx) => {
                    const matched = catalog.find((c) => c.id === r.matchedId);
                    const willReplace = !!matched?.model3d && r.status === "pending";
                    return (
                      <li key={r.file.name + idx} className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs truncate">{r.file.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatBytes(r.file.size)}
                              </span>
                              {r.status === "done" && (
                                <Badge variant="default" className="text-[10px] gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Importé
                                </Badge>
                              )}
                              {r.status === "skipped" && (
                                <Badge variant="outline" className="text-[10px]">Ignoré</Badge>
                              )}
                              {r.status === "error" && (
                                <Badge variant="destructive" className="text-[10px] gap-1">
                                  <XCircle className="h-3 w-3" /> Erreur
                                </Badge>
                              )}
                              {willReplace && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-amber-500/60 text-amber-500"
                                >
                                  Remplacera le modèle existant
                                </Badge>
                              )}
                            </div>
                            {r.message && (
                              <p className="text-[11px] text-destructive mt-0.5">{r.message}</p>
                            )}
                          </div>
                          {!running && r.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => removeRow(idx)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground shrink-0">→</span>
                          <Select
                            value={r.matchedId}
                            disabled={running || r.status === "done"}
                            onValueChange={(v) => updateRow(idx, { matchedId: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Choisir un produit…" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                              <SelectItem value={IGNORE}>
                                <span className="text-muted-foreground">Ignorer ce fichier</span>
                              </SelectItem>
                              {catalogSorted.map((eq) => (
                                <SelectItem key={eq.id} value={eq.id}>
                                  {eq.name}
                                  {eq.model3d ? " · (a déjà un modèle)" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Adopt-dimensions checkbox — active once the GLB has been measured */}
                        {r.matchedId !== IGNORE && r.status !== "done" && (
                          (() => {
                            const matched = catalog.find((c) => c.id === r.matchedId);
                            if (!matched) return null;
                            if (r.measuringError) {
                              return (
                                <p className="text-[10px] text-destructive pl-4">
                                  Impossible de lire les dimensions du GLB : {r.measuringError}
                                </p>
                              );
                            }
                            if (!r.modelDims) {
                              return (
                                <p className="text-[10px] text-muted-foreground pl-4 flex items-center gap-1">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Mesure du modèle 3D…
                                </p>
                              );
                            }
                            const diverges = dimsDivergeSignificantly(r.modelDims, matched);
                            return (
                              <label className="flex items-start gap-2 pl-4 cursor-pointer select-none">
                                <Checkbox
                                  checked={r.adoptDims}
                                  disabled={running}
                                  onCheckedChange={(v) =>
                                    updateRow(idx, { adoptDims: v === true })
                                  }
                                  className="mt-0.5"
                                />
                                <div className="text-[11px] leading-tight">
                                  <div className="flex items-center gap-1 text-foreground">
                                    <Ruler className="h-3 w-3 text-muted-foreground" />
                                    Adopter les dimensions du modèle :{" "}
                                    <span className="font-medium">
                                      {r.modelDims.width} × {r.modelDims.depth} × {r.modelDims.height} cm
                                    </span>
                                    {diverges && (
                                      <span className="text-amber-500 ml-1">
                                        (fiche : {matched.width} × {matched.depth} × {matched.height})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </label>
                            );
                          })()
                        )}

                        {r.status === "uploading" && (
                          <Progress value={r.progress} className="h-1.5" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>
          )}

          {report && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
              <p className="font-medium">Rapport final</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>✅ {report.ok} modèle(s) importé(s)</li>
                <li>⏭️ {report.skipped} ignoré(s)</li>
                <li>❌ {report.errors} erreur(s)</li>
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={running}
            >
              Fermer
            </Button>
            <Button
              onClick={handleRun}
              disabled={running || toImportCount === 0}
              className="gap-2"
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Import en cours…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Importer {toImportCount} modèle{toImportCount > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight, Play, Zap, Monitor, Users, Ticket, Package, Box, Upload, Check, Trash2, Ruler, RotateCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { GameEquipment } from "@/types/equipment";
import { compressGLB, formatBytes } from "@/lib/glbCompression";
import { uploadFileResumable } from "@/lib/resumableUpload";
import { readGLBDimensions } from "@/lib/glbBounds";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 Mo
const ROTATIONS = [0, 90, 180, 270] as const;

type ProductDialogProps = {
  equipment: GameEquipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate3DModel?: (equipmentId: string, modelUrl: string | undefined) => void;
  onUpdateProduct?: (equipmentId: string, patch: Partial<GameEquipment>) => Promise<void> | void;
};

export function ProductDialog({ equipment, open, onOpenChange, onUpdate3DModel, onUpdateProduct }: ProductDialogProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [adoptingDims, setAdoptingDims] = useState(false);
  const [savingRotation, setSavingRotation] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!equipment) return null;

  const images = equipment.images && equipment.images.length > 0 
    ? equipment.images 
    : [];

  const nextImage = () => {
    if (images.length > 1) {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }
  };

  const prevImage = () => {
    if (images.length > 1) {
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  };

  const stripHtml = (html: string) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".glb") && !file.name.endsWith(".gltf")) {
      toast.error("Format non supporté. Utilisez un fichier .glb ou .gltf");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`Fichier trop volumineux (max ${formatBytes(MAX_FILE_SIZE)})`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStatus("Préparation…");
    try {
      // 1) Compression Draco (côté navigateur) — sans perte visuelle
      let fileToUpload = file;
      if (file.name.toLowerCase().endsWith(".glb")) {
        setUploadStatus("Compression Draco…");
        const originalSize = file.size;
        fileToUpload = await compressGLB(file, (msg) => setUploadStatus(msg));
        if (fileToUpload.size < originalSize) {
          const ratio = Math.round((1 - fileToUpload.size / originalSize) * 100);
          toast.success(
            `Compression : ${formatBytes(originalSize)} → ${formatBytes(fileToUpload.size)} (-${ratio}%)`
          );
        }
      }

      // 2) Upload resumable (chunké, reprise sur erreur)
      const filePath = `${equipment.id}/${Date.now()}-${fileToUpload.name}`;
      setUploadStatus("Envoi vers le cloud…");
      await uploadFileResumable({
        bucket: "models-3d",
        path: filePath,
        file: fileToUpload,
        upsert: true,
        onProgress: (pct) => {
          setUploadProgress(pct);
          setUploadStatus(`Envoi… ${Math.round(pct)}%`);
        },
      });

      const { data: urlData } = supabase.storage
        .from("models-3d")
        .getPublicUrl(filePath);
      onUpdate3DModel?.(equipment.id, urlData.publicUrl);
      toast.success(`Modèle 3D "${fileToUpload.name}" associé à ${equipment.name}`);
    } catch (err: any) {
      console.error(err);
      toast.error(`Erreur lors du chargement du modèle 3D : ${err?.message || "inconnue"}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveModel = () => {
    onUpdate3DModel?.(equipment.id, undefined);
    toast.success(`Modèle 3D retiré de ${equipment.name}`);
  };

  const handleAdoptDims = async () => {
    if (!equipment.model3d || !onUpdateProduct) return;
    setAdoptingDims(true);
    try {
      const dims = await readGLBDimensions(equipment.model3d, equipment.model3dRotation || 0);
      await onUpdateProduct(equipment.id, {
        width: dims.width,
        depth: dims.depth,
        height: dims.height,
      });
      toast.success(
        `Dimensions mises à jour : ${dims.width} × ${dims.depth} × ${dims.height} cm`
      );
    } catch (err: any) {
      console.error(err);
      toast.error(`Impossible de lire le modèle 3D : ${err?.message || "erreur inconnue"}`);
    } finally {
      setAdoptingDims(false);
    }
  };

  const handleSetRotation = async (deg: number) => {
    if (!onUpdateProduct) return;
    setSavingRotation(deg);
    try {
      await onUpdateProduct(equipment.id, { model3dRotation: deg });
      toast.success(`Orientation du modèle 3D : ${deg}°`);
    } catch (err: any) {
      toast.error(`Erreur : ${err?.message || "inconnue"}`);
    } finally {
      setSavingRotation(null);
    }
  };

  const currentRotation = equipment.model3dRotation || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden p-0">
        <ScrollArea className="max-h-[90vh]">
          <div className="p-6">
            <DialogHeader className="mb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="text-xl font-bold text-foreground">
                    {equipment.name}
                  </DialogTitle>
                  {equipment.vendor && (
                    <p className="text-sm text-muted-foreground mt-1">{equipment.vendor}</p>
                  )}
                </div>
                {equipment.price && equipment.price > 0 && (
                  <Badge variant="secondary" className="text-lg font-semibold shrink-0">
                    {equipment.price.toLocaleString("fr-FR")} €
                  </Badge>
                )}
              </div>
            </DialogHeader>

            {/* Image carousel */}
            {images.length > 0 && (
              <div className="relative mb-4 rounded-lg overflow-hidden bg-muted/30">
                <img
                  src={images[currentImageIndex]}
                  alt={equipment.name}
                  className="w-full h-64 object-contain"
                />
                {images.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
                      onClick={prevImage}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background"
                      onClick={nextImage}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            idx === currentImageIndex ? "bg-primary" : "bg-muted-foreground/30"
                          }`}
                          onClick={() => setCurrentImageIndex(idx)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Tags */}
            {equipment.tags && equipment.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {equipment.tags.slice(0, 6).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Description */}
            {equipment.description && (
              <div className="mb-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {stripHtml(equipment.description)}
                </p>
              </div>
            )}

            {/* Specs grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Package className="h-3.5 w-3.5" />
                  Dimensions
                </div>
                <p className="text-sm font-medium text-foreground">
                  {equipment.width} × {equipment.depth} × {equipment.height} cm
                </p>
              </div>

              {equipment.specs?.power && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Zap className="h-3.5 w-3.5" />
                    Puissance
                  </div>
                  <p className="text-sm font-medium text-foreground">{equipment.specs.power}</p>
                </div>
              )}

              {equipment.specs?.screen && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Monitor className="h-3.5 w-3.5" />
                    Écran
                  </div>
                  <p className="text-sm font-medium text-foreground">{equipment.specs.screen}</p>
                </div>
              )}

              {equipment.specs?.capacity && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Users className="h-3.5 w-3.5" />
                    Capacité
                  </div>
                  <p className="text-sm font-medium text-foreground">{equipment.specs.capacity}</p>
                </div>
              )}

              {equipment.specs?.tickets !== undefined && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Ticket className="h-3.5 w-3.5" />
                    Distribution tickets
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {equipment.specs.tickets ? "Oui" : "Non"}
                  </p>
                </div>
              )}

              {equipment.warranty && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs text-muted-foreground mb-1">Garantie</div>
                  <p className="text-sm font-medium text-foreground">{equipment.warranty}</p>
                </div>
              )}

              {equipment.stock && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs text-muted-foreground mb-1">Disponibilité</div>
                  <p className="text-sm font-medium text-foreground">{equipment.stock}</p>
                </div>
              )}
            </div>

            {/* 3D Model section */}
            <div className="rounded-lg border border-border bg-surface p-3 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Box className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Modèle 3D</span>
                </div>
                <div className="flex items-center gap-2">
                  {equipment.model3d ? (
                    <>
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Check className="h-3 w-3" />
                        Associé
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={handleRemoveModel}
                        title="Retirer le modèle 3D"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Aucun modèle</span>
                  )}
                </div>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,.gltf"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload className="h-4 w-4" />
                  {uploading
                    ? uploadStatus || "Chargement..."
                    : equipment.model3d
                    ? "Remplacer le modèle (.glb, max 500 Mo)"
                    : "Uploader un modèle 3D (.glb, max 500 Mo)"}
                </Button>
                {uploading && uploadProgress > 0 && (
                  <Progress value={uploadProgress} className="mt-2 h-1.5" />
                )}
              </div>

              {/* Adopt real dimensions from the GLB bounding box */}
              {equipment.model3d && onUpdateProduct && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={handleAdoptDims}
                  disabled={adoptingDims}
                  title="Lit la bounding box du GLB (en mètres) et met à jour la largeur/profondeur/hauteur du produit"
                >
                  {adoptingDims ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Ruler className="h-4 w-4" />
                  )}
                  Reprendre les dimensions du modèle 3D
                </Button>
              )}

              {/* Rotation correction (0 / 90 / 180 / 270) — applied before scaling */}
              {equipment.model3d && onUpdateProduct && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <RotateCw className="h-3.5 w-3.5" />
                    Orientation du modèle (avant mise à l'échelle)
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ROTATIONS.map((deg) => {
                      const isActive = currentRotation === deg;
                      const isSaving = savingRotation === deg;
                      return (
                        <Button
                          key={deg}
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="gap-1"
                          disabled={savingRotation !== null}
                          onClick={() => handleSetRotation(deg)}
                        >
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : `${deg}°`}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Video */}
            {equipment.videoUrl && (
              <div className="rounded-lg overflow-hidden border border-border">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                  <Play className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Vidéo</span>
                </div>
                <div className="aspect-video">
                  <iframe
                    src={equipment.videoUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

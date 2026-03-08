import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Play, Zap, Monitor, Users, Ticket, Package } from "lucide-react";
import type { GameEquipment } from "@/types/equipment";

type ProductDialogProps = {
  equipment: GameEquipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProductDialog({ equipment, open, onOpenChange }: ProductDialogProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

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

  // Strip HTML tags for plain text preview
  const stripHtml = (html: string) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

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

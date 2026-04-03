import { useState } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { createHyperNovaProject } from "@/lib/hypernovaProject";
import { clearSession } from "@/hooks/useAutoSave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Save, FolderOpen, FilePlus, Trash2, Menu, Gamepad2, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateDossierPDF } from "@/lib/pdfExport";
import { ExportDossierDialog, type DossierSections } from "./ExportDossierDialog";
import { saveLayoutSnapshot } from "@/lib/layoutLearning";
import {
  listProjects,
  saveProject,
  deleteProject,
  createNewProject,
  type SavedProject,
} from "@/lib/projectStorage";
import type { GameEquipment } from "@/types/equipment";

type ProjectMenuProps = {
  catalog: GameEquipment[];
  onLoadCatalog: (catalog: GameEquipment[]) => void;
};

export function ProjectMenu({ catalog, onLoadCatalog }: ProjectMenuProps) {
  const { state, dispatch } = useEditor();
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState("Nouveau projet");
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // Save dialog
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");

  // Load dialog
  const [loadOpen, setLoadOpen] = useState(false);
  const [projects, setProjects] = useState<SavedProject[]>([]);

  const handleOpenSave = () => {
    setSaveName(currentProjectName);
    setSaveNotes("");
    if (currentProjectId) {
      const existing = listProjects().find((p) => p.id === currentProjectId);
      if (existing) {
        setSaveName(existing.name);
        setSaveNotes(existing.notes);
      }
    }
    setSaveOpen(true);
  };

  const handleSave = () => {
    if (!saveName.trim()) {
      toast.error("Entrez un nom de projet");
      return;
    }

    if (currentProjectId) {
      // Update existing
      const proj = createNewProject(saveName.trim(), state, catalog, saveNotes.trim());
      proj.id = currentProjectId;
      const existing = listProjects().find((p) => p.id === currentProjectId);
      if (existing) proj.createdAt = existing.createdAt;
      saveProject(proj);
    } else {
      // Create new
      const proj = createNewProject(saveName.trim(), state, catalog, saveNotes.trim());
      saveProject(proj);
      setCurrentProjectId(proj.id);
    }

    setCurrentProjectName(saveName.trim());
    setSaveOpen(false);
    toast.success("Projet sauvegardé");
  };

  const handleOpenLoad = () => {
    setProjects(listProjects());
    setLoadOpen(true);
  };

  const handleLoadProject = (proj: SavedProject) => {
    dispatch({
      type: "LOAD_STATE",
      state: {
        rooms: proj.plan.rooms,
        doors: proj.plan.doors,
        pillars: proj.plan.pillars,
        placedEquipments: proj.plan.placedEquipments,
        gridSize: proj.plan.gridSize,
      },
    });
    onLoadCatalog(proj.catalog);
    setCurrentProjectId(proj.id);
    setCurrentProjectName(proj.name);
    setLoadOpen(false);
    toast.success(`Projet "${proj.name}" chargé`);
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteProject(id);
    setProjects(listProjects());
    if (currentProjectId === id) {
      setCurrentProjectId(null);
      setCurrentProjectName("Nouveau projet");
    }
    toast.info("Projet supprimé");
  };

  const handleNewProject = () => {
    dispatch({ type: "RESET" });
    onLoadCatalog([]);
    clearSession();
    setCurrentProjectId(null);
    setCurrentProjectName("Nouveau projet");
    toast.info("Nouveau projet créé");
  };

  const handleLoadHyperNova = () => {
    const { rooms, doors, pillars, equipments } = createHyperNovaProject();
    dispatch({ type: "RESET" });
    rooms.forEach((room) => dispatch({ type: "ADD_ROOM", room }));
    doors.forEach((door) => dispatch({ type: "ADD_DOOR", door }));
    pillars.forEach((pillar) => dispatch({ type: "ADD_PILLAR", pillar }));
    dispatch({ type: "ADD_PLACED_EQUIPMENTS", equipments });
    setCurrentProjectId(null);
    setCurrentProjectName("HYPER NOVA - Cergy");
    toast.success("Projet HYPER NOVA chargé (3 salles, 2 poteaux, 30+ équipements)");
  };

  const handleOpenExport = () => {
    if (state.rooms.length === 0 && state.placedEquipments.length === 0) {
      toast.error("Rien à exporter — ajoutez au moins une salle ou des équipements");
      return;
    }
    setExportDialogOpen(true);
  };

  const handleExportDossier = async (sections: DossierSections) => {
    setIsExporting(true);
    toast.info("Génération du dossier PDF en cours…");
    try {
      await generateDossierPDF(state, catalog, currentProjectName, sections);
      await saveLayoutSnapshot(state, catalog, currentProjectName);
      toast.success("Dossier PDF téléchargé !");
      setExportDialogOpen(false);
    } catch (e) {
      console.error("PDF export error:", e);
      toast.error("Erreur lors de la génération du PDF");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-medium">
            <Menu className="h-4 w-4" />
            <span className="max-w-[120px] truncate">{currentProjectName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={handleNewProject} className="gap-2">
            <FilePlus className="h-4 w-4" />
            Nouveau projet
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLoadHyperNova} className="gap-2">
            <Gamepad2 className="h-4 w-4" />
            Démo HYPER NOVA
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleOpenSave} className="gap-2">
            <Save className="h-4 w-4" />
            Sauvegarder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenLoad} className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Ouvrir un projet
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleOpenExport} disabled={isExporting} className="gap-2">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Dossier banque (PDF)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sauvegarder le projet</DialogTitle>
            <DialogDescription>Entrez un nom et des notes pour votre projet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nom</label>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Mon projet"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optionnel)</label>
              <Textarea
                value={saveNotes}
                onChange={(e) => setSaveNotes(e.target.value)}
                placeholder="Description du projet..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Annuler</Button>
            <Button onClick={handleSave}>Sauvegarder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ouvrir un projet</DialogTitle>
            <DialogDescription>Sélectionnez un projet sauvegardé.</DialogDescription>
          </DialogHeader>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Aucun projet sauvegardé
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-primary/50 transition-colors group"
                  onClick={() => handleLoadProject(proj)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">{proj.name}</p>
                      {proj.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{proj.notes}</p>
                      )}
                      <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span>{proj.plan.rooms.length} salle{proj.plan.rooms.length > 1 ? "s" : ""}</span>
                        <span>{proj.plan.placedEquipments.length} jeu{proj.plan.placedEquipments.length > 1 ? "x" : ""}</span>
                        <span>{new Date(proj.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive shrink-0"
                      onClick={(e) => handleDeleteProject(proj.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ExportDossierDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExportDossier}
        isExporting={isExporting}
      />
    </>
  );
}

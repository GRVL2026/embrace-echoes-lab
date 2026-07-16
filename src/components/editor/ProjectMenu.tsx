import { useCallback, useEffect, useState } from "react";
import { useEditor } from "@/contexts/EditorContext";
import { createHyperNovaProject } from "@/lib/hypernovaProject";
import { clearSession } from "@/hooks/useAutoSave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Save,
  FolderOpen,
  FilePlus,
  Trash2,
  Gamepad2,
  FileDown,
  Loader2,
  FolderKanban,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { generateDossierPDF } from "@/lib/pdfExport";
import { generate2DDossierPDF, type Dossier2DOptions } from "@/lib/pdfExport2D";
import { ExportDossierDialog, type DossierSections } from "./ExportDossierDialog";
import { Export2DDossierDialog } from "./Export2DDossierDialog";
import { saveLayoutSnapshot } from "@/lib/layoutLearning";
import {
  listProjects,
  deleteProject,
  type SavedProject,
} from "@/lib/projectStorage";
import type { GameEquipment } from "@/types/equipment";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  mergeSelectedProductsFromPlan,
  type CatalogRow,
  type SelectedProduct,
} from "@/lib/dossierPlanSync";
import { useEditor as _u } from "@/contexts/EditorContext"; // avoid duplicate import warning; not used

type ProjectMenuProps = {
  catalog: GameEquipment[];
  onLoadCatalog: (catalog: GameEquipment[]) => void;
  currentName: string;
  dossierId?: string;
  savingToDossier?: boolean;
  onSaveToDossier?: () => void | Promise<void>;
};

type DossierRow = { id: string; client_name: string | null; offer: string | null; updated_at: string };

export function ProjectMenu({
  catalog,
  onLoadCatalog,
  currentName,
  dossierId,
  savingToDossier,
  onSaveToDossier,
}: ProjectMenuProps) {
  const { state, dispatch } = useEditor();
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [export2DDialogOpen, setExport2DDialogOpen] = useState(false);

  // Save to dossier dialog
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"pick" | "create">("pick");
  const [newDossierName, setNewDossierName] = useState("");
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [dossiersLoading, setDossiersLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load dialog
  const [loadOpen, setLoadOpen] = useState(false);
  const [localProjects, setLocalProjects] = useState<SavedProject[]>([]);

  const loadDossierList = useCallback(async () => {
    setDossiersLoading(true);
    const { data, error } = await (supabase as any)
      .from("projects")
      .select("id, client_name, offer, updated_at")
      .order("updated_at", { ascending: false });
    setDossiersLoading(false);
    if (error) {
      toast.error("Impossible de charger les dossiers");
      return;
    }
    setDossiers((data as DossierRow[]) ?? []);
  }, []);

  const buildPlanPayload = useCallback(async (targetId: string) => {
    const payload = {
      rooms: state.rooms,
      doors: state.doors,
      pillars: state.pillars,
      placedEquipments: state.placedEquipments,
      circulationPath: state.circulationPath,
      gridSize: state.gridSize,
      planRotation: state.planRotation,
    };
    const [{ data: projRow }, { data: catRows }] = await Promise.all([
      (supabase as any)
        .from("projects")
        .select("selected_products, offer")
        .eq("id", targetId)
        .maybeSingle(),
      (supabase as any)
        .from("catalog_products")
        .select("id, shopify_id, name, category, price, price_monthly")
        .eq("active", true),
    ]);
    const currentSelected = Array.isArray(projRow?.selected_products)
      ? (projRow!.selected_products as SelectedProduct[])
      : [];
    const offer = (projRow?.offer as string | null) ?? null;
    const mergedSelected = mergeSelectedProductsFromPlan(
      currentSelected,
      state.placedEquipments,
      (catRows as CatalogRow[]) ?? [],
      offer,
    );
    return { plan_data: payload, selected_products: mergedSelected };
  }, [state]);

  const handleOpenSave = async () => {
    if (dossierId && onSaveToDossier) {
      await onSaveToDossier();
      return;
    }
    setSaveMode("pick");
    setNewDossierName("");
    setSaveOpen(true);
    void loadDossierList();
  };

  const handleSaveToExisting = async (targetId: string) => {
    setSaving(true);
    try {
      const patch = await buildPlanPayload(targetId);
      const { error } = await (supabase as any)
        .from("projects")
        .update(patch)
        .eq("id", targetId);
      if (error) throw error;
      toast.success("Plan enregistré dans le dossier");
      setSaveOpen(false);
      navigate(`/planner/dossier/${targetId}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndSave = async () => {
    const name = newDossierName.trim();
    if (!name) {
      toast.error("Entrez un nom de client / dossier");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non connecté");
      const { data: created, error: insertErr } = await (supabase as any)
        .from("projects")
        .insert({ status: "draft", client_name: name, owner_id: user.id })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      const targetId = created.id as string;
      const patch = await buildPlanPayload(targetId);
      const { error: updateErr } = await (supabase as any)
        .from("projects")
        .update(patch)
        .eq("id", targetId);
      if (updateErr) throw updateErr;
      toast.success(`Dossier « ${name} » créé et plan enregistré`);
      setSaveOpen(false);
      navigate(`/planner/dossier/${targetId}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Création impossible");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenLoad = () => {
    setLocalProjects(listProjects());
    setLoadOpen(true);
    void loadDossierList();
  };

  const handleOpenDossier = (id: string) => {
    setLoadOpen(false);
    navigate(`/planner/dossier/${id}`);
  };

  const handleLoadLocalProject = (proj: SavedProject) => {
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
    setLoadOpen(false);
    toast.success(`Plan local « ${proj.name} » chargé`);
  };

  const handleDeleteLocal = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteProject(id);
    setLocalProjects(listProjects());
    toast.info("Plan local supprimé");
  };

  const handleNewProject = () => {
    dispatch({ type: "RESET" });
    onLoadCatalog([]);
    clearSession();
    if (dossierId) navigate("/planner");
    toast.info("Nouveau projet créé");
  };

  const handleLoadHyperNova = () => {
    const { rooms, doors, pillars, equipments } = createHyperNovaProject();
    dispatch({ type: "RESET" });
    rooms.forEach((room) => dispatch({ type: "ADD_ROOM", room }));
    doors.forEach((door) => dispatch({ type: "ADD_DOOR", door }));
    pillars.forEach((pillar) => dispatch({ type: "ADD_PILLAR", pillar }));
    dispatch({ type: "ADD_PLACED_EQUIPMENTS", equipments });
    toast.success("Projet HYPER NOVA chargé");
  };

  const guardEmpty = () => {
    if (state.rooms.length === 0 && state.placedEquipments.length === 0) {
      toast.error("Rien à exporter — ajoutez au moins une salle ou des équipements");
      return true;
    }
    return false;
  };

  const handleOpenExport = () => {
    if (guardEmpty()) return;
    setExportDialogOpen(true);
  };

  const handleExportDossier = async (sections: DossierSections) => {
    setIsExporting(true);
    toast.info("Génération du dossier PDF en cours…");
    try {
      await generateDossierPDF(state, catalog, currentName, sections);
      await saveLayoutSnapshot(state, catalog, currentName);
      toast.success("Dossier PDF téléchargé !");
      setExportDialogOpen(false);
    } catch (e: any) {
      console.error("PDF export error:", e);
      toast.error(`Erreur PDF : ${e?.message || "Erreur inconnue"}`, { duration: 8000 });
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenExport2D = () => {
    if (guardEmpty()) return;
    setExport2DDialogOpen(true);
  };

  const handleExport2DDossier = async (opts: Dossier2DOptions) => {
    setIsExporting(true);
    toast.info("Génération du dossier 2D en cours…");
    try {
      await generate2DDossierPDF(state, catalog, currentName, opts);
      toast.success("Dossier 2D téléchargé !");
      setExport2DDialogOpen(false);
    } catch (e: any) {
      console.error("PDF 2D export error:", e);
      toast.error(`Erreur PDF : ${e?.message || "Erreur inconnue"}`, { duration: 8000 });
    } finally {
      setIsExporting(false);
    }
  };

  const busy = isExporting || savingToDossier || saving;
  const saveLabel = dossierId ? "Enregistrer dans le dossier" : "Enregistrer dans un dossier…";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-medium h-8">
            <FileText className="h-4 w-4" />
            Fichier
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem onClick={handleOpenSave} disabled={savingToDossier} className="gap-2">
            {savingToDossier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saveLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenLoad} className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Ouvrir…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleNewProject} className="gap-2">
            <FilePlus className="h-4 w-4" />
            Nouveau plan
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleOpenExport2D} disabled={busy} className="gap-2">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Exporter PDF 2D (client)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenExport} disabled={busy} className="gap-2">
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Exporter PDF 3D (banque)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLoadHyperNova} className="gap-2">
            <Gamepad2 className="h-4 w-4" />
            Démo HYPER NOVA
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save to dossier dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enregistrer le plan dans un dossier</DialogTitle>
            <DialogDescription>
              Les plans sont désormais rattachés aux dossiers commerciaux.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mb-2">
            <Button
              variant={saveMode === "pick" ? "default" : "outline"}
              size="sm"
              onClick={() => setSaveMode("pick")}
            >
              Dossier existant
            </Button>
            <Button
              variant={saveMode === "create" ? "default" : "outline"}
              size="sm"
              onClick={() => setSaveMode("create")}
            >
              Nouveau dossier
            </Button>
          </div>
          {saveMode === "pick" ? (
            <div className="max-h-[360px] overflow-y-auto space-y-1">
              {dossiersLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                </div>
              ) : dossiers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Aucun dossier existant.
                </p>
              ) : (
                dossiers.map((d) => (
                  <button
                    key={d.id}
                    className="w-full rounded-md border border-border bg-card/60 p-3 text-left hover:border-primary/50 transition-colors flex items-center gap-3"
                    onClick={() => handleSaveToExisting(d.id)}
                    disabled={saving}
                  >
                    <FolderKanban className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {d.client_name?.trim() || "Sans nom"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(d.updated_at).toLocaleDateString("fr-FR")}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground block">
                Nom du client / dossier
              </label>
              <Input
                value={newDossierName}
                onChange={(e) => setNewDossierName(e.target.value)}
                placeholder="Ex. Café Central"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreateAndSave()}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              Annuler
            </Button>
            {saveMode === "create" && (
              <Button onClick={handleCreateAndSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Créer et enregistrer
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open dialog: dossiers + local plans */}
      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ouvrir un plan</DialogTitle>
            <DialogDescription>Choisissez un dossier ou un plan local.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[500px] overflow-y-auto space-y-4">
            <div>
              <DropdownMenuLabel className="px-0 text-xs uppercase tracking-wider text-muted-foreground">
                Dossiers commerciaux
              </DropdownMenuLabel>
              {dossiersLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                </div>
              ) : dossiers.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">Aucun dossier.</p>
              ) : (
                <div className="space-y-1">
                  {dossiers.map((d) => (
                    <button
                      key={d.id}
                      className="w-full rounded-md border border-border bg-card/60 p-2.5 text-left hover:border-primary/50 transition-colors flex items-center gap-3"
                      onClick={() => handleOpenDossier(d.id)}
                    >
                      <FolderKanban className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {d.client_name?.trim() || "Sans nom"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(d.updated_at).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {localProjects.length > 0 && (
              <div>
                <DropdownMenuLabel className="px-0 text-xs uppercase tracking-wider text-muted-foreground">
                  Plans locaux (legacy)
                </DropdownMenuLabel>
                <div className="space-y-1">
                  {localProjects.map((proj) => (
                    <div
                      key={proj.id}
                      className="w-full rounded-md border border-border bg-card/60 p-2.5 text-left hover:border-primary/50 transition-colors flex items-center gap-2 group"
                    >
                      <button
                        className="flex-1 min-w-0 text-left"
                        onClick={() => handleLoadLocalProject(proj)}
                      >
                        <div className="text-sm font-medium truncate">{proj.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(proj.updatedAt).toLocaleDateString("fr-FR")}
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive shrink-0"
                        onClick={(e) => handleDeleteLocal(proj.id, e)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ExportDossierDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExportDossier}
        isExporting={isExporting}
      />

      <Export2DDossierDialog
        open={export2DDialogOpen}
        onOpenChange={setExport2DDialogOpen}
        onExport={handleExport2DDossier}
        isExporting={isExporting}
      />
    </>
  );
}

import { useState, useCallback, useMemo, useEffect } from "react";
import { EditorProvider, useEditor } from "@/contexts/EditorContext";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { EditorSidebar } from "@/components/editor/EditorSidebar";
import { Viewer3D } from "@/components/viewer3d/Viewer3D";
import { Viewer3DToolbar, DEFAULT_3D_SETTINGS, type Viewer3DSettings } from "@/components/viewer3d/Viewer3DToolbar";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { useCopilotActions } from "@/hooks/useCopilotActions";
import type { RoomContext } from "@/lib/copilotApi";
import { SAFETY_ZONE_CM } from "@/types/editor";
import { PanelRightClose, PanelRightOpen, Box, LayoutGrid, Sparkles, Check, Loader2, CircleDot, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fitToView } from "@/lib/fitToView";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { useAutoSave, loadSession } from "@/hooks/useAutoSave";
import { ProjectMenu } from "@/components/editor/ProjectMenu";
import type { GameEquipment } from "@/types/equipment";
import {
  buildInitialQuantities,
  mergeSelectedProductsFromPlan,
  type CatalogRow,
  type SelectedProduct,
} from "@/lib/dossierPlanSync";
import { PlannerBootstrapProvider } from "@/contexts/PlannerBootstrap";

function SpacePlannerInner() {
  const { dossierId } = useParams<{ dossierId?: string }>();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [viewer3DSettings, setViewer3DSettings] = useState<Viewer3DSettings>(DEFAULT_3D_SETTINGS);
  const [savingToDossier, setSavingToDossier] = useState(false);
  const [initialQuantities, setInitialQuantities] = useState<Map<string, number> | null>(null);
  const [dossierName, setDossierName] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<GameEquipment[]>([]);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const { state, dispatch } = useEditor();

  // Autosave to localStorage (existing behavior).
  useAutoSave(state, catalog);

  // Restore local session on first mount (only when no dossier route).
  useEffect(() => {
    if (dossierId) return;
    const session = loadSession();
    if (!session) return;
    dispatch({
      type: "LOAD_STATE",
      state: {
        rooms: session.plan.rooms,
        doors: session.plan.doors,
        pillars: session.plan.pillars,
        placedEquipments: session.plan.placedEquipments,
        gridSize: session.plan.gridSize,
        circulationPath: session.plan.circulationPath || [],
      },
    });
    if (session.catalog.length > 0) setCatalog(session.catalog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track dirty state.
  useEffect(() => {
    setDirty(true);
  }, [state.rooms, state.doors, state.pillars, state.placedEquipments, state.circulationPath]);

  // Load plan_data + dossier name when opened for a specific dossier.
  useEffect(() => {
    if (!dossierId) {
      setDossierName(null);
      return;
    }
    (async () => {
      const [{ data, error }, { data: catRows }] = await Promise.all([
        (supabase as any)
          .from("projects")
          .select("plan_data, selected_products, offer, client_name")
          .eq("id", dossierId)
          .maybeSingle(),
        (supabase as any)
          .from("catalog_products")
          .select("id, shopify_id, name, category, price, price_monthly")
          .eq("active", true),
      ]);
      if (error) {
        toast({ title: "Impossible de charger le plan", description: error.message, variant: "destructive" });
        return;
      }
      setDossierName((data?.client_name as string | null) ?? "Dossier sans nom");
      const pd = data?.plan_data;
      if (pd && typeof pd === "object") {
        dispatch({
          type: "LOAD_STATE",
          state: {
            rooms: pd.rooms ?? [],
            doors: pd.doors ?? [],
            pillars: pd.pillars ?? [],
            placedEquipments: pd.placedEquipments ?? [],
            circulationPath: pd.circulationPath ?? [],
            gridSize: pd.gridSize ?? 20,
            planRotation: pd.planRotation ?? 0,
          },
        });
        setLastSavedAt(new Date());
        // Reset dirty after the LOAD dispatch is committed.
        setTimeout(() => setDirty(false), 0);
      }
      const selected = Array.isArray(data?.selected_products)
        ? (data!.selected_products as SelectedProduct[])
        : [];
      const rows = ((catRows as CatalogRow[]) ?? []).filter((r) => !!r);
      setInitialQuantities(buildInitialQuantities(selected, rows));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const saveToDossier = useCallback(async () => {
    if (!dossierId) return;
    setSavingToDossier(true);
    const payload = {
      rooms: state.rooms,
      doors: state.doors,
      pillars: state.pillars,
      placedEquipments: state.placedEquipments,
      circulationPath: state.circulationPath,
      gridSize: state.gridSize,
      planRotation: state.planRotation,
    };
    const { data: projRow, error: readErr } = await (supabase as any)
      .from("projects")
      .select("selected_products, offer")
      .eq("id", dossierId)
      .maybeSingle();
    if (readErr) {
      setSavingToDossier(false);
      toast({ title: "Enregistrement impossible", description: readErr.message, variant: "destructive" });
      return;
    }
    const { data: catRows } = await (supabase as any)
      .from("catalog_products")
      .select("id, shopify_id, name, category, price, price_monthly")
      .eq("active", true);

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
    const { error } = await (supabase as any)
      .from("projects")
      .update({ plan_data: payload, selected_products: mergedSelected })
      .eq("id", dossierId);
    setSavingToDossier(false);
    if (error) {
      toast({ title: "Enregistrement impossible", description: error.message, variant: "destructive" });
      return;
    }
    setDirty(false);
    setLastSavedAt(new Date());
    toast({ title: "Plan enregistré dans le dossier" });
  }, [dossierId, state]);

  const roomContext = useMemo<RoomContext | undefined>(() => {
    const room = state.rooms[0];
    if (!room || room.points.length < 3) return undefined;
    const xs = room.points.map((p) => p.x);
    const ys = room.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const walls = room.points.map((p, i) => {
      const next = room.points[(i + 1) % room.points.length];
      return { start: { x: p.x, y: p.y }, end: { x: next.x, y: next.y } };
    });
    const doors = state.doors.map((d) => {
      const wall = walls[d.edgeIndex];
      if (!wall) return { position: { x: 0, y: 0 }, width: d.width, isMain: d.isMainDoor };
      const px = wall.start.x + (wall.end.x - wall.start.x) * d.positionRatio;
      const py = wall.start.y + (wall.end.y - wall.start.y) * d.positionRatio;
      return { position: { x: px, y: py }, width: d.width, isMain: d.isMainDoor };
    });
    return {
      walls,
      doors,
      pillars: state.pillars.map((p) => ({ position: p.position, width: p.width, depth: p.depth })),
      floor_points: room.points,
      room_width_cm: maxX - minX,
      room_depth_cm: maxY - minY,
      room_height_cm: 300,
      existing_equipment: state.placedEquipments.map((e) => ({
        name: e.name,
        position: e.position,
        width: e.width,
        depth: e.depth,
        rotation: e.rotation,
      })),
      circulation_width_cm: SAFETY_ZONE_CM,
    };
  }, [state.rooms, state.doors, state.pillars, state.placedEquipments]);

  const { executeActions } = useCopilotActions({
    currentAmbiance: viewer3DSettings.ambiance,
    onAmbianceChange: (ambiance) => setViewer3DSettings((s) => ({ ...s, ambiance })),
    onLightingChange: (preset) => setViewer3DSettings((s) => ({ ...s, lighting: preset })),
    onAddEquipment: (equipment) => dispatch({ type: "ADD_PLACED_EQUIPMENT", equipment }),
    roomContext,
  });

  const toggleSidebar = useCallback(() => {
    const nextOpen = !sidebarOpen;
    setSidebarOpen(nextOpen);
    requestAnimationFrame(() => {
      const sidebarWidth = nextOpen ? 288 : 0;
      const result = fitToView(state, sidebarWidth);
      if (result) {
        dispatch({ type: "SET_ZOOM", zoom: result.zoom });
        dispatch({ type: "SET_PAN", offset: result.pan });
      }
    });
  }, [sidebarOpen, state, dispatch]);

  const currentName = dossierId ? (dossierName ?? "Dossier") : "Plan sans dossier";
  const savedLabel = dirty
    ? "Modifications non enregistrées"
    : lastSavedAt
      ? `Enregistré à ${lastSavedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : "Non enregistré";

  return (
    <PlannerBootstrapProvider value={{ initialQuantities }}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
        <AppHeader />

        {/* Planner-specific slim toolbar */}
        <div className="flex h-11 items-center justify-between border-b border-border bg-card/40 backdrop-blur-sm px-3 gap-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* 2D / 3D toggle */}
            <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
              <Button
                variant={viewMode === "2d" ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setViewMode("2d")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                2D
              </Button>
              <Button
                variant={viewMode === "3d" ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setViewMode("3d")}
              >
                <Box className="h-3.5 w-3.5" />
                3D
              </Button>
            </div>

            {/* Plan / dossier name + save state */}
            <div className="flex items-center gap-2 min-w-0">
              {dossierId ? (
                <Link
                  to={`/dossiers/${dossierId}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary truncate max-w-[240px]"
                  title={currentName}
                >
                  <FolderKanban className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">{currentName}</span>
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground truncate max-w-[240px]" title={currentName}>
                  {currentName}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {savingToDossier ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : dirty ? (
                  <CircleDot className="h-3 w-3 text-amber-500" />
                ) : (
                  <Check className="h-3 w-3 text-green-500" />
                )}
                {savingToDossier ? "Enregistrement…" : savedLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <ProjectMenu
              catalog={catalog}
              onLoadCatalog={setCatalog}
              currentName={currentName}
              dossierId={dossierId}
              savingToDossier={savingToDossier}
              onSaveToDossier={saveToDossier}
            />
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant={copilotOpen ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCopilotOpen(!copilotOpen)}
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {copilotOpen ? "Fermer Copilot IA" : "Ouvrir Copilot IA"}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
                  {sidebarOpen ? (
                    <PanelRightClose className="h-4 w-4" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sidebarOpen ? "Masquer le panneau" : "Afficher le panneau"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Main planner area (fills remaining height) */}
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          {/* Left tool rail */}
          <div className="relative z-20 flex flex-col items-center justify-center p-2">
            {viewMode === "2d" ? (
              <EditorToolbar />
            ) : (
              <Viewer3DToolbar
                settings={viewer3DSettings}
                onChange={setViewer3DSettings}
                onAddEquipment={(eq) => dispatch({ type: "ADD_PLACED_EQUIPMENT", equipment: eq })}
              />
            )}
          </div>

          {/* Canvas */}
          <div className="flex flex-1 min-w-0 min-h-0 flex-col">
            {viewMode === "2d" ? (
              <EditorCanvas />
            ) : (
              <Viewer3D
                settings={viewer3DSettings}
                onPresetApplied={() => setViewer3DSettings((s) => ({ ...s, presetView: null }))}
              />
            )}
          </div>

          {/* Right sidebar */}
          {sidebarOpen && !copilotOpen && (
            <EditorSidebar catalog={catalog} setCatalog={setCatalog} />
          )}

          {/* Copilot */}
          {copilotOpen && (
            <CopilotPanel
              onActionsReady={executeActions}
              onClose={() => setCopilotOpen(false)}
              roomContext={roomContext}
            />
          )}
        </div>
      </div>
    </PlannerBootstrapProvider>
  );
}

import { useIsMobile } from "@/hooks/use-mobile";
import { Monitor } from "lucide-react";

const SpacePlanner = () => {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground px-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Monitor className="h-8 w-8" />
          </div>
          <h1 className="font-display text-2xl font-bold">Le planner s'utilise sur ordinateur</h1>
          <p className="text-sm text-muted-foreground">
            L'édition 3D des salles n'est pas optimisée pour le tactile. Ouvre Arcade Planner sur un ordinateur pour concevoir tes plans.
          </p>
          <Button asChild variant="default" className="min-h-11">
            <Link to="/dossiers">
              <FolderKanban className="mr-2 h-4 w-4" />
              Retour aux dossiers
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <EditorProvider>
      <SpacePlannerInner />
    </EditorProvider>
  );
};

export default SpacePlanner;

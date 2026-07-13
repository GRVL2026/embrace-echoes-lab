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
import { PanelRightClose, PanelRightOpen, Box, LayoutGrid, Sparkles, FolderKanban, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fitToView } from "@/lib/fitToView";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import logoImg from "@/assets/logo.png";
import { UserMenu } from "@/components/UserMenu";
import {
  buildInitialQuantities,
  mergeSelectedProductsFromPlan,
  computePricing,
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
  const { state, dispatch } = useEditor();

  // Load plan_data + dossier selection when opened for a specific dossier
  useEffect(() => {
    if (!dossierId) return;
    (async () => {
      const [{ data, error }, { data: catRows }] = await Promise.all([
        (supabase as any)
          .from("projects")
          .select("plan_data, selected_products, offer")
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
      }
      // Pré-charge la sélection catalogue avec les jeux plaçables du dossier.
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

    // On récupère l'état actuel du dossier (selected_products + offer) pour
    // faire un merge cohérent (le dossier est un sur-ensemble du plan et ne
    // doit jamais perdre ses articles non plaçables).
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
    const mergedPricing = computePricing(mergedSelected, offer);

    const { error } = await (supabase as any)
      .from("projects")
      .update({
        plan_data: payload,
        selected_products: mergedSelected,
        pricing: mergedPricing,
      })
      .eq("id", dossierId);
    setSavingToDossier(false);
    if (error) {
      toast({ title: "Enregistrement impossible", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Plan enregistré dans le dossier" });
    navigate(`/dossiers/${dossierId}`);
  }, [dossierId, state, navigate]);


  // Build room context for the copilot
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
      pillars: state.pillars.map((p) => ({
        position: p.position,
        width: p.width,
        depth: p.depth,
      })),
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
    onAmbianceChange: (ambiance) =>
      setViewer3DSettings((s) => ({ ...s, ambiance })),
    onLightingChange: (preset) =>
      setViewer3DSettings((s) => ({ ...s, lighting: preset })),
    onAddEquipment: (equipment) =>
      dispatch({ type: "ADD_PLACED_EQUIPMENT", equipment }),
    roomContext,
  });

  const toggleSidebar = useCallback(() => {
    const nextOpen = !sidebarOpen;
    setSidebarOpen(nextOpen);
    // Refit after DOM updates with new sidebar width
    requestAnimationFrame(() => {
      const sidebarWidth = nextOpen ? 288 : 0;
      const result = fitToView(state, sidebarWidth);
      if (result) {
        dispatch({ type: "SET_ZOOM", zoom: result.zoom });
        dispatch({ type: "SET_PAN", offset: result.pan });
      }
    });
  }, [sidebarOpen, state, dispatch]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left toolbar - switches based on view mode */}
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

      {/* Canvas area */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-6">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Arcade Planner logo" className="h-7 w-auto object-contain" />
            <h1 className="font-display text-xl font-bold tracking-tight">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">Planner</span>
            </h1>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Beta
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-display">
            <span>Avranches Automatic</span>
            <span className="text-primary">•</span>
            <span>Simulateur de salle</span>

            {/* 2D / 3D toggle */}
            <div className="flex items-center ml-3 rounded-md border border-border bg-muted/50 p-0.5">
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === "2d" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => setViewMode("2d")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    2D
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Vue plan 2D</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <Button
                    variant={viewMode === "3d" ? "default" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => setViewMode("3d")}
                  >
                    <Box className="h-3.5 w-3.5" />
                    3D
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Vue 3D immersive</TooltipContent>
              </Tooltip>
            </div>

            {dossierId && (
              <Button
                variant="default"
                size="sm"
                className="h-8 ml-2 gap-1 text-xs"
                onClick={saveToDossier}
                disabled={savingToDossier}
              >
                {savingToDossier ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Enregistrer dans le dossier
              </Button>
            )}

            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="sm" className="h-8 ml-2 gap-1 text-xs">
                  <Link to="/dossiers">
                    <FolderKanban className="h-3.5 w-3.5" />
                    Dossiers
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Dossiers commerciaux</TooltipContent>
            </Tooltip>


            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 ml-2"
                  onClick={toggleSidebar}
                >
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

            {/* Copilot toggle */}
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
            <div className="ml-2 pl-2 border-l border-border">
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Main view */}
        {viewMode === "2d" ? (
          <EditorCanvas />
        ) : (
          <Viewer3D
            settings={viewer3DSettings}
            onPresetApplied={() =>
              setViewer3DSettings((s) => ({ ...s, presetView: null }))
            }
          />
        )}
      </div>

      {/* Right sidebar */}
      {sidebarOpen && !copilotOpen && <EditorSidebar />}

      {/* Copilot panel */}
      {copilotOpen && (
        <CopilotPanel
          onActionsReady={executeActions}
          onClose={() => setCopilotOpen(false)}
          roomContext={roomContext}
        />
      )}
    </div>
  );
}

const SpacePlanner = () => (
  <EditorProvider>
    <SpacePlannerInner />
  </EditorProvider>
);

export default SpacePlanner;

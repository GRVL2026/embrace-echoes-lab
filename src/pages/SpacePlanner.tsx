import { useState } from "react";
import { EditorProvider } from "@/contexts/EditorContext";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { EditorSidebar } from "@/components/editor/EditorSidebar";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import logoImg from "@/assets/logo.png";

const SpacePlanner = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <EditorProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        {/* Left toolbar */}
        <div className="flex flex-col items-center justify-center p-2">
          <EditorToolbar />
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
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 ml-2"
                    onClick={() => setSidebarOpen(!sidebarOpen)}
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
            </div>
          </header>

          {/* Main canvas */}
          <EditorCanvas />
        </div>

        {/* Right sidebar */}
        {sidebarOpen && <EditorSidebar />}
      </div>
    </EditorProvider>
  );
};

export default SpacePlanner;

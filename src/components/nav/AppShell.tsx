import { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/nav/AppSidebar";
import { CopilotProvider } from "@/contexts/CopilotContext";
import { GlobalCopilotPanel } from "@/components/copilot/GlobalCopilotPanel";

/**
 * Enveloppe globale des pages authentifiées : barre latérale persistante
 * (repliable en mode icônes, état mémorisé via cookie shadcn) + zone `main`
 * + copilote global (bouton flottant + raccourci Cmd/Ctrl+K + Sheet).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <CopilotProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground">
          <AppSidebar />
          <div className="flex-1 min-w-0 flex flex-col">{children}</div>
        </div>
        <GlobalCopilotPanel />
      </CopilotProvider>
    </SidebarProvider>
  );
}

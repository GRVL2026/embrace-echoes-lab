import { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/nav/AppSidebar";

/**
 * Enveloppe globale des pages authentifiées : barre latérale persistante
 * (repliable en mode icônes, état mémorisé via cookie shadcn) + zone `main`.
 * L'entête locale de chaque page reste rendue à l'intérieur de `main`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
    </SidebarProvider>
  );
}

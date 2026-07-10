import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SpacePlanner from "./pages/SpacePlanner";
import DossiersList from "./pages/DossiersList";
import DossierEdit from "./pages/DossierEdit";
import NotFound from "./pages/NotFound";
import PublicDossier from "./pages/PublicDossier";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SpacePlanner />} />
          <Route path="/planner/dossier/:dossierId" element={<SpacePlanner />} />
          <Route path="/dossiers" element={<DossiersList />} />
          <Route path="/dossiers/:id" element={<DossierEdit />} />
          <Route path="/d/:slug" element={<PublicDossier />} />
          <Route path="*" element={<NotFound />} />

        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

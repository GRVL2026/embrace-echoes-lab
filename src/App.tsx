import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SpacePlanner from "./pages/SpacePlanner";
import Hub from "./pages/Hub";
import Logistique from "./pages/Logistique";
import Ecommerce from "./pages/Ecommerce";
import Sav from "./pages/Sav";
import Achats from "./pages/Achats";
import SavTicket from "./pages/SavTicket";
import Catalogue from "./pages/Catalogue";
import DossiersList from "./pages/DossiersList";
import DossierEdit from "./pages/DossierEdit";
import AdminDossiers from "./pages/AdminDossiers";
import AdminEntreprises from "./pages/AdminEntreprises";
import AdminCatalogErp from "./pages/AdminCatalogErp";
import AdminGaia from "./pages/AdminGaia";
import AdminSync from "./pages/AdminSync";
import AdminVeille from "./pages/AdminVeille";
import GaiaClientFiche from "./pages/GaiaClientFiche";
import Clients from "./pages/Clients";
import MatriceClients from "./pages/MatriceClients";
import MatriceFamilles from "./pages/MatriceFamilles";
import Salle from "./pages/Salle";
import Prospection from "./pages/Prospection";

import GaiaCarnet from "./pages/GaiaCarnet";
import GaiaRevueView from "./pages/GaiaRevueView";
import NotFound from "./pages/NotFound";
import NotificationsSettings from "./pages/NotificationsSettings";
import PublicDossier from "./pages/PublicDossier";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppShell } from "./components/nav/AppShell";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

/** Route protégée + shell avec sidebar persistante. */
const P = ({ children }: { children: ReactNode }) => (
  <ProtectedRoute>
    <AppShell>{children}</AppShell>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/d/:slug" element={<PublicDossier />} />

            {/* Protected */}
            <Route path="/" element={<P><Hub /></P>} />
            <Route path="/planner" element={<ProtectedRoute><SpacePlanner /></ProtectedRoute>} />
            <Route path="/planner/dossier/:dossierId" element={<ProtectedRoute><SpacePlanner /></ProtectedRoute>} />
            <Route path="/dossiers" element={<P><DossiersList /></P>} />
            <Route path="/catalogue" element={<P><Catalogue /></P>} />
            <Route path="/clients" element={<P><Clients /></P>} />
            <Route path="/salle" element={<P><Salle /></P>} />
            <Route path="/prospection" element={<P><Prospection /></P>} />

            <Route path="/dossiers/:id" element={<P><DossierEdit /></P>} />
            <Route path="/logistique" element={<P><Logistique /></P>} />
            <Route path="/achats" element={<P><Achats /></P>} />
            <Route path="/ecommerce" element={<P><Ecommerce /></P>} />
            <Route path="/sav" element={<P><Sav /></P>} />
            <Route path="/sav/ticket/:id" element={<P><SavTicket /></P>} />
            <Route path="/admin" element={<P><AdminDossiers /></P>} />
            <Route path="/admin/catalog-erp" element={<P><AdminCatalogErp /></P>} />
            <Route path="/admin/gaia" element={<P><AdminGaia /></P>} />
            <Route path="/admin/synchronisation" element={<P><AdminSync /></P>} />
            <Route path="/admin/gaia/carnet/:categorie" element={<P><GaiaCarnet /></P>} />
            <Route path="/admin/veille" element={<P><AdminVeille /></P>} />
            <Route path="/admin/gaia/client/:nom" element={<P><GaiaClientFiche /></P>} />
            <Route path="/admin/gaia/revue/:id" element={<P><GaiaRevueView /></P>} />
            <Route path="/admin/notifications" element={<P><NotificationsSettings /></P>} />
            <Route path="/admin/entreprises" element={<P><AdminEntreprises /></P>} />
            <Route path="/admin/matrice-clients" element={<P><MatriceClients /></P>} />
            <Route path="/matrice-familles" element={<P><MatriceFamilles /></P>} />


            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);


export default App;

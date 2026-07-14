import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SpacePlanner from "./pages/SpacePlanner";
import DossiersList from "./pages/DossiersList";
import DossierEdit from "./pages/DossierEdit";
import AdminDossiers from "./pages/AdminDossiers";
import AdminGaia from "./pages/AdminGaia";
import GaiaRevueView from "./pages/GaiaRevueView";
import NotFound from "./pages/NotFound";
import PublicDossier from "./pages/PublicDossier";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient();

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
            <Route path="/" element={<Navigate to="/dossiers" replace />} />
            <Route path="/planner" element={<ProtectedRoute><SpacePlanner /></ProtectedRoute>} />
            <Route path="/planner/dossier/:dossierId" element={<ProtectedRoute><SpacePlanner /></ProtectedRoute>} />
            <Route path="/dossiers" element={<ProtectedRoute><DossiersList /></ProtectedRoute>} />
            <Route path="/dossiers/:id" element={<ProtectedRoute><DossierEdit /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminDossiers /></ProtectedRoute>} />
            <Route path="/admin/gaia" element={<ProtectedRoute><AdminGaia /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

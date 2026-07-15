import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user, isLoading, roleError, refreshRoles } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roleError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <p className="text-sm text-muted-foreground">Impossible de charger vos accès.</p>
        <Button onClick={refreshRoles}>Réessayer</Button>
      </div>
    );
  }

  return children;
}

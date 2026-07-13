import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };
  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-xs text-muted-foreground max-w-[180px] truncate">
        {user.email}
      </span>
      <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1">
        <LogOut className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Déconnexion</span>
      </Button>
    </div>
  );
}

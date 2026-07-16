import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Shield, Database, FolderKanban, LayoutGrid, LogOut, Home, BookOpen, Truck, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export function MobileNav() {
  const { isAdmin, canAccessGaia, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const item = (to: string, label: string, Icon: any) => {
    const active = pathname === to || (to !== "/" && pathname.startsWith(to + "/"));
    return (
      <Link
        to={to}
        onClick={() => setOpen(false)}
        className={`flex min-h-11 items-center gap-3 rounded-md px-3 py-3 text-sm font-medium ${
          active
            ? "bg-primary/15 border border-primary/40 text-primary"
            : "text-foreground hover:bg-muted"
        }`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    );
  };

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 md:hidden" aria-label="Menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 flex flex-col">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle className="font-display">Menu</SheetTitle>
          {user?.email && <div className="text-xs text-muted-foreground truncate">{user.email}</div>}
        </SheetHeader>
        <div className="flex-1 space-y-1 p-3">
          {isAdmin && item("/", "Hub", Home)}
          {item("/dossiers", "Dossiers", FolderKanban)}
          {item("/planner", "Arcade Planner", LayoutGrid)}
          {item("/catalogue", "Catalogue", BookOpen)}
          {isAdmin && item("/logistique", "Logistique", Truck)}
          {canAccessGaia && item("/admin/gaia", "Gaia", Database)}
          {canAccessGaia && item("/admin/veille", "Veille marché", Radar)}
          {isAdmin && item("/admin", "Admin", Shield)}
        </div>
        <div className="border-t border-border p-3">
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Déconnexion
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

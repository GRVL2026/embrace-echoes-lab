import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, LogOut, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { SPACES, resolveActive, type NavCtx } from "@/nav/spaces";
import { useSpaceCollapse } from "@/nav/useSpaceCollapse";
import { cn } from "@/lib/utils";

/**
 * Menu de navigation mobile — reprend la structure de la sidebar
 * (5 espaces + Réglages, colorés) sous forme d'accordéon vertical.
 * Les sections sont repliables (état partagé avec la sidebar via localStorage).
 */
export function MobileNav() {
  const {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
    user,
    signOut,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  const ctx: NavCtx = {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
  };

  const visibleSpaces = useMemo(
    () => SPACES.filter((s) => !s.show || s.show(ctx)),
    // ctx depends only on primitive flags; safe to recompute
    [isAdmin, isDirection, canAccessGaia, canAccessDashboard, copilotEnabled],
  );
  const active = resolveActive(pathname, hash, ctx);
  const { isCollapsed, toggle } = useSpaceCollapse(
    visibleSpaces.map((s) => s.key),
    active.space?.key ?? null,
  );

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
      <SheetContent side="left" className="w-80 p-0 flex flex-col">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle className="font-display">Navigation</SheetTitle>
          {user?.email && (
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {visibleSpaces.map((space) => {
            const entries = space.entries.filter((e) => !e.show || e.show(ctx));
            if (entries.length === 0) return null;
            const color = `hsl(var(${space.colorToken}))`;
            const sectionCollapsed = isCollapsed(space.key);
            const sectionId = `mnav-space-${space.key}`;
            return (
              <div key={space.key}>
                <button
                  type="button"
                  onClick={() => toggle(space.key)}
                  aria-expanded={!sectionCollapsed}
                  aria-controls={sectionId}
                  className="flex w-full items-center gap-2 px-2 mb-1 uppercase tracking-wider text-[10px] font-semibold hover:opacity-80 transition-opacity"
                  style={{ color }}
                >
                  <span
                    className="inline-block h-3 w-0.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <space.icon className="h-3 w-3" />
                  <span className="flex-1 text-left">{space.label}</span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      sectionCollapsed && "-rotate-90",
                    )}
                  />
                </button>
                {!sectionCollapsed && (
                  <div id={sectionId} className="space-y-1">
                    {entries.map((entry) => {
                      const active = entry.match?.(pathname, hash) ?? false;
                      const Icon = entry.icon;
                      return (
                        <Link
                          key={entry.to}
                          to={entry.to}
                          onClick={() => setOpen(false)}
                          className="flex min-h-11 items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
                          style={
                            active
                              ? {
                                  backgroundColor: `hsl(var(${space.colorToken}) / 0.12)`,
                                  color,
                                  borderLeft: `2px solid ${color}`,
                                }
                              : undefined
                          }
                        >
                          <Icon className="h-4 w-4" />
                          {entry.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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

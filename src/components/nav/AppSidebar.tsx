import { Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { SPACES, resolveActive, type NavCtx, type Space } from "@/nav/spaces";
import { AlertsBell } from "@/components/copilot/AlertsBell";
import logoImg from "@/assets/logo.png";
import { cn } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Barre latérale persistante — organisée en 5 espaces + Réglages.
 * Chaque espace porte une couleur d'identité subtile (accent + liseret).
 * Le menu est filtré selon le rôle & les flags copilotEnabled/dashboardEnabled
 * du user (aucun bouton mort visible sans accès).
 */
export function AppSidebar() {
  const { isAdmin, isDirection, canAccessGaia, canAccessDashboard, copilotEnabled } =
    useAuth();
  const { pathname, hash } = useLocation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const ctx: NavCtx = {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    copilotEnabled,
  };

  const active = resolveActive(pathname, hash, ctx);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2 px-2 py-1.5 min-w-0">
          <img
            src={logoImg}
            alt="Arcade OS"
            className="h-6 w-auto object-contain flex-shrink-0"
          />
          {!collapsed && (
            <span className="font-display text-sm font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {SPACES.filter((s) => !s.show || s.show(ctx)).map((space) => (
          <SpaceGroup
            key={space.key}
            space={space}
            ctx={ctx}
            collapsed={collapsed}
            currentPath={pathname}
            currentHash={hash}
            activeSpaceKey={active.space?.key ?? null}
          />
        ))}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

function SpaceGroup({
  space,
  ctx,
  collapsed,
  currentPath,
  currentHash,
  activeSpaceKey,
}: {
  space: Space;
  ctx: NavCtx;
  collapsed: boolean;
  currentPath: string;
  currentHash: string;
  activeSpaceKey: string | null;
}) {
  const entries = space.entries.filter((e) => !e.show || e.show(ctx));
  if (entries.length === 0) return null;

  const isActiveSpace = activeSpaceKey === space.key;
  const color = `hsl(var(${space.colorToken}))`;
  const bg = `hsl(var(${space.colorToken}) / 0.12)`;
  const border = `hsl(var(${space.colorToken}) / 0.35)`;

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="flex items-center gap-2 uppercase tracking-wider text-[10px]"
        style={{ color }}
      >
        <span
          className="inline-block h-3 w-0.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <space.icon className="h-3 w-3" />
        {!collapsed && space.label}
      </SidebarGroupLabel>
      <SidebarGroupContent
        className={cn(
          "border-l ml-3 transition-colors",
          isActiveSpace ? "" : "border-transparent",
        )}
        style={isActiveSpace ? { borderColor: border } : undefined}
      >
        <SidebarMenu>
          {entries.map((entry) => {
            const active = entry.match?.(currentPath, currentHash) ?? false;
            const Icon = entry.icon;
            return (
              <SidebarMenuItem key={entry.to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={entry.label}
                  className="data-[active=true]:font-semibold"
                  style={
                    active
                      ? {
                          color,
                          backgroundColor: bg,
                          borderLeft: `2px solid ${color}`,
                        }
                      : undefined
                  }
                >
                  <Link to={entry.to} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={active ? { color } : undefined} />
                    {!collapsed && <span className="truncate">{entry.label}</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export { SidebarTrigger };

import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
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
import { useSpaceCollapse } from "@/nav/useSpaceCollapse";
import { AlertsBell } from "@/components/copilot/AlertsBell";
import logoImg from "@/assets/logo.png";
import { cn } from "@/lib/utils";

/**
 * Barre latérale persistante — organisée en 5 espaces + Réglages.
 * Chaque espace porte une couleur d'identité subtile (accent + liseret).
 * Le menu est filtré selon le rôle & les flags copilotEnabled/dashboardEnabled
 * du user (aucun bouton mort visible sans accès).
 */
export function AppSidebar() {
  const { isAdmin, isDirection, canAccessGaia, canAccessDashboard, canMargeGlobale, copilotEnabled, canAccessSalle, salleOnly } =
    useAuth();
  const { pathname, hash } = useLocation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const ctx: NavCtx = {
    isAdmin,
    isDirection,
    canAccessGaia,
    canAccessDashboard,
    canMargeGlobale,
    copilotEnabled,
    canAccessSalle,
    salleOnly,
  };

  const active = resolveActive(pathname, hash, ctx);
  const visibleSpaces = SPACES.filter((s) => !s.show || s.show(ctx));
  const { isCollapsed: isSectionCollapsed, toggle: toggleSection } = useSpaceCollapse(
    visibleSpaces.map((s) => s.key),
    active.space?.key ?? null,
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5 min-w-0">
          <Link to="/" className="flex items-center gap-2 min-w-0 flex-1">
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
          {!collapsed && <AlertsBell compact />}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {visibleSpaces.map((space) => (
          <SpaceGroup
            key={space.key}
            space={space}
            ctx={ctx}
            collapsed={collapsed}
            currentPath={pathname}
            currentHash={hash}
            activeSpaceKey={active.space?.key ?? null}
            sectionCollapsed={isSectionCollapsed(space.key)}
            onToggleSection={() => toggleSection(space.key)}
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
  sectionCollapsed,
  onToggleSection,
}: {
  space: Space;
  ctx: NavCtx;
  collapsed: boolean;
  currentPath: string;
  currentHash: string;
  activeSpaceKey: string | null;
  sectionCollapsed: boolean;
  onToggleSection: () => void;
}) {
  const entries = space.entries.filter((e) => !e.show || e.show(ctx));
  if (entries.length === 0) return null;

  const isActiveSpace = activeSpaceKey === space.key;
  const color = `hsl(var(${space.colorToken}))`;
  const bg = `hsl(var(${space.colorToken}) / 0.12)`;
  const border = `hsl(var(${space.colorToken}) / 0.35)`;

  // En mode icônes (sidebar rétractée), on n'active PAS le pliage :
  // les icônes restent visibles pour préserver la navigation.
  const showEntries = collapsed || !sectionCollapsed;

  return (
    <SidebarGroup>
      {collapsed ? (
        <SidebarGroupLabel
          className="flex items-center gap-2 uppercase tracking-wider text-[10px]"
          style={{ color }}
        >
          <span
            className="inline-block h-3 w-0.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <space.icon className="h-3 w-3" />
        </SidebarGroupLabel>
      ) : (
        <SidebarGroupLabel asChild>
          <button
            type="button"
            onClick={onToggleSection}
            aria-expanded={!sectionCollapsed}
            aria-controls={`space-${space.key}`}
            className="flex w-full items-center gap-2 uppercase tracking-wider text-[10px] hover:opacity-80 transition-opacity"
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
        </SidebarGroupLabel>
      )}
      {showEntries && (
        <SidebarGroupContent
          id={`space-${space.key}`}
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
      )}
    </SidebarGroup>
  );
}

export { SidebarTrigger };

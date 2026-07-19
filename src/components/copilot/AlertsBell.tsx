import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck, Check, EyeOff, Settings2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type Notification = {
  id: string;
  type_cle: string;
  gravite: "info" | "attention" | "urgent";
  titre: string;
  corps: string | null;
  lien: string | null;
  lu: boolean;
  created_at: string;
  meta: any;
};

type Alerte = {
  id: string;
  type: string;
  gravite: "info" | "attention" | "urgent";
  titre: string;
  constat: string;
  action_suggeree: string | null;
  lien: string | null;
  visibilite: "copilot" | "direction";
  statut: "nouveau" | "lu" | "traite" | "ignore";
  created_at: string;
};

const GRAV_ORDER: Record<Notification["gravite"], number> = { urgent: 0, attention: 1, info: 2 };

function GraviteIcon({ g, className }: { g: Notification["gravite"]; className?: string }) {
  if (g === "urgent") return <AlertCircle className={cn("text-destructive", className)} />;
  if (g === "attention") return <AlertTriangle className={cn("text-amber-500", className)} />;
  return <Info className={cn("text-blue-400", className)} />;
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

/**
 * Cloche Notifications — Phase 1 (in-app uniquement).
 * - Onglet "Notifications" : lignes de `notifications` (état lu par utilisateur).
 * - Onglet "Alertes métier" (direction/admin) : accès direct au traitement Traité/Ignoré
 *   sur `copilot_alertes`.
 */
export function AlertsBell({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"notif" | "metier">("notif");
  const { user, copilotEnabled, isDirection } = useAuth();
  const qc = useQueryClient();

  // Bootstrap prefs à la première connexion
  useEffect(() => {
    if (!user?.id) return;
    (supabase as any).rpc("ensure_notification_prefs", { _uid: user.id }).then(() => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [user?.id, qc]);

  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user?.id,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await (supabase as any)
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });

  const { data: alertes = [] } = useQuery({
    queryKey: ["copilot-alertes"],
    enabled: copilotEnabled && isDirection,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Alerte[]> => {
      const { data, error } = await (supabase as any)
        .from("copilot_alertes")
        .select("*")
        .neq("statut", "ignore")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Alerte[];
    },
  });

  const unreadCount = notifs.filter((n) => !n.lu).length;
  const sortedNotifs = [...notifs].sort((a, b) => {
    // non-lues d'abord, puis gravité, puis date
    if (a.lu !== b.lu) return a.lu ? 1 : -1;
    const s = GRAV_ORDER[a.gravite] - GRAV_ORDER[b.gravite];
    if (s !== 0) return s;
    return b.created_at.localeCompare(a.created_at);
  });
  const sortedAlertes = [...alertes].sort((a, b) => {
    const s = GRAV_ORDER[a.gravite] - GRAV_ORDER[b.gravite];
    if (s !== 0) return s;
    return b.created_at.localeCompare(a.created_at);
  });

  async function markRead(id: string) {
    await (supabase as any).from("notifications")
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq("id", id);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markAllRead() {
    if (!user?.id) return;
    await (supabase as any).from("notifications")
      .update({ lu: true, lu_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("lu", false);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function setStatutAlerte(id: string, statut: Alerte["statut"]) {
    await (supabase as any).from("copilot_alertes").update({ statut }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["copilot-alertes"] });
  }

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative inline-flex items-center justify-center rounded-md hover:bg-muted/60 transition-colors",
          compact ? "h-8 w-8" : "h-9 w-9",
        )}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <SheetTitle className="flex-1">Notifications</SheetTitle>
              <Button size="sm" variant="ghost" asChild className="h-7 text-xs" onClick={() => setOpen(false)}>
                <Link to="/admin/notifications">
                  <Settings2 className="h-3 w-3 mr-1" /> Préférences
                </Link>
              </Button>
            </div>
          </SheetHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className={cn("mx-4 mt-3 grid", isDirection ? "grid-cols-2" : "grid-cols-1")}>
              <TabsTrigger value="notif" className="text-xs">
                Cloche {unreadCount > 0 && <Badge variant="destructive" className="ml-2 h-4">{unreadCount}</Badge>}
              </TabsTrigger>
              {isDirection && (
                <TabsTrigger value="metier" className="text-xs">Alertes métier</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="notif" className="flex-1 overflow-hidden flex flex-col mt-2">
              {unreadCount > 0 && (
                <div className="px-5 py-2 border-b flex justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllRead}>
                    <CheckCheck className="h-3 w-3 mr-1" /> Tout marquer lu
                  </Button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {sortedNotifs.length === 0 ? (
                  <div className="px-5 py-16 text-center text-sm text-muted-foreground">
                    Aucune notification.
                  </div>
                ) : (
                  sortedNotifs.map((n) => (
                    <div key={n.id} className={cn("px-5 py-3", !n.lu && "bg-muted/20")}>
                      <div className="flex items-start gap-3">
                        <GraviteIcon g={n.gravite} className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-sm", !n.lu ? "font-semibold" : "font-medium text-muted-foreground")}>
                              {n.titre}
                            </span>
                            {!n.lu && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                          </div>
                          {n.corps && (
                            <p className="mt-1 text-xs text-muted-foreground whitespace-pre-line line-clamp-3">
                              {n.corps}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                            <span>{timeAgo(n.created_at)}</span>
                            {n.lien && (
                              <Button size="sm" variant="secondary" className="h-6 text-[11px] px-2" asChild
                                onClick={() => { if (!n.lu) markRead(n.id); setOpen(false); }}>
                                <Link to={n.lien}>Ouvrir</Link>
                              </Button>
                            )}
                            {!n.lu && (
                              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => markRead(n.id)}>
                                <Check className="h-3 w-3 mr-1" /> Marquer lu
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            {isDirection && (
              <TabsContent value="metier" className="flex-1 overflow-y-auto divide-y divide-border mt-2">
                {sortedAlertes.length === 0 ? (
                  <div className="px-5 py-16 text-center text-sm text-muted-foreground">
                    Aucune alerte métier active.
                  </div>
                ) : (
                  sortedAlertes.map((a) => (
                    <div key={a.id} className={cn("px-5 py-4", a.statut === "nouveau" && "bg-muted/20")}>
                      <div className="flex items-start gap-3">
                        <GraviteIcon g={a.gravite} className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{a.titre}</span>
                            {a.visibilite === "direction" && (
                              <Badge variant="outline" className="h-4 text-[10px] border-blue-500/40 text-blue-400">DIR</Badge>
                            )}
                            {a.statut !== "nouveau" && (
                              <Badge variant="secondary" className="h-4 text-[10px]">{a.statut}</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{a.constat}</p>
                          {a.action_suggeree && (
                            <p className="mt-1.5 text-xs text-foreground/80">
                              <span className="text-primary font-medium">→ </span>{a.action_suggeree}
                            </p>
                          )}
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            {a.lien && (
                              <Button size="sm" variant="secondary" className="h-7 text-xs" asChild
                                onClick={() => { if (a.statut === "nouveau") setStatutAlerte(a.id, "lu"); setOpen(false); }}>
                                <Link to={a.lien}>Ouvrir</Link>
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStatutAlerte(a.id, "traite")}>
                              <Check className="h-3 w-3 mr-1" /> Traité
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setStatutAlerte(a.id, "ignore")}>
                              <EyeOff className="h-3 w-3 mr-1" /> Ignorer
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>
            )}
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}

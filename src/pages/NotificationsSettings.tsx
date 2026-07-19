import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Info, Mail, Lock } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type NotifType = {
  cle: string;
  libelle: string;
  description: string | null;
  categorie: string;
  gravite_defaut: string;
  visibilite_role: string;
};

type Pref = {
  user_id: string;
  type_cle: string;
  canal: string;
  mode: string; // 'instantane' | 'resume_quotidien' | 'jamais'
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "alerte", label: "Alertes" },
  { key: "publication", label: "Publications" },
  { key: "systeme", label: "Système" },
];

export default function NotificationsSettings() {
  const { user, isDirection, isAdmin } = useAuth();
  const qc = useQueryClient();

  // S'assurer que les prefs existent
  useEffect(() => {
    if (!user?.id) return;
    (supabase as any).rpc("ensure_notification_prefs", { _uid: user.id });
  }, [user?.id]);

  const { data: types = [] } = useQuery({
    queryKey: ["notification-types"],
    queryFn: async (): Promise<NotifType[]> => {
      const { data, error } = await (supabase as any)
        .from("notification_types")
        .select("*")
        .order("categorie")
        .order("libelle");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: prefs = [] } = useQuery({
    queryKey: ["notification-prefs", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<Pref[]> => {
      const { data, error } = await (supabase as any)
        .from("notification_prefs")
        .select("*")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Filtre les types visibles pour ce rôle
  const visibleTypes = types.filter((t) => {
    if (t.visibilite_role === "admin") return isAdmin;
    if (t.visibilite_role === "direction") return isDirection;
    return true;
  });

  function getMode(typeCle: string, canal: string): string {
    return prefs.find((p) => p.type_cle === typeCle && p.canal === canal)?.mode ?? "jamais";
  }

  async function setMode(typeCle: string, mode: "instantane" | "jamais") {
    if (!user?.id) return;
    const { error } = await (supabase as any).from("notification_prefs").upsert({
      user_id: user.id,
      type_cle: typeCle,
      canal: "inapp",
      mode,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,type_cle,canal" });
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["notification-prefs"] });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <div className="flex-1 container mx-auto max-w-4xl px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" /> Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choisis pour chaque type ce que tu veux recevoir dans ta cloche.
          </p>
        </div>

        {/* Bannière email désactivé pour cette phase */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Mail className="h-4 w-4 text-amber-500 mt-0.5" />
            <div className="text-xs">
              <div className="font-medium text-amber-500">Email — bientôt disponible</div>
              <div className="text-muted-foreground mt-0.5">
                Cette phase active uniquement la cloche in-app. Le canal email sera ajouté
                dans une prochaine mise à jour, sans changer tes préférences actuelles.
              </div>
            </div>
          </CardContent>
        </Card>

        {CATEGORIES.map((cat) => {
          const list = visibleTypes.filter((t) => t.categorie === cat.key);
          if (list.length === 0) return null;
          return (
            <Card key={cat.key}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                  {cat.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border p-0">
                {list.map((t) => {
                  const mode = getMode(t.cle, "inapp");
                  const isOn = mode !== "jamais";
                  return (
                    <div key={t.cle} className="flex items-start gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{t.libelle}</span>
                          {t.visibilite_role !== "tous" && (
                            <Badge variant="outline" className="h-4 text-[10px]">
                              {t.visibilite_role === "admin" ? "Admin" : "Direction"}
                            </Badge>
                          )}
                          {t.gravite_defaut === "urgent" && (
                            <Badge variant="destructive" className="h-4 text-[10px]">Urgent</Badge>
                          )}
                        </div>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-md border border-border overflow-hidden">
                          <Button
                            size="sm" variant={isOn ? "default" : "ghost"}
                            className="h-8 rounded-none text-xs px-3"
                            onClick={() => setMode(t.cle, "instantane")}
                          >
                            <Bell className="h-3 w-3 mr-1" /> Instantané
                          </Button>
                          <Button
                            size="sm" variant={!isOn ? "default" : "ghost"}
                            className="h-8 rounded-none text-xs px-3"
                            onClick={() => setMode(t.cle, "jamais")}
                          >
                            <BellOff className="h-3 w-3 mr-1" /> Jamais
                          </Button>
                        </div>
                        <div title="Email : bientôt disponible" className="flex items-center gap-1 text-[10px] text-muted-foreground opacity-60">
                          <Lock className="h-3 w-3" /> Email
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}

        {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Info className="h-3.5 w-3.5" /> Défauts par rôle
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                Appliqués automatiquement à la première connexion de chaque utilisateur.
                Chaque utilisateur peut ensuite ajuster ses propres préférences.
              </p>
              <div className="grid gap-3 sm:grid-cols-3 mt-3">
                <div className="rounded-md border p-3">
                  <div className="font-semibold mb-1">Commercial</div>
                  <ul className="text-muted-foreground space-y-0.5">
                    <li>• Devis dormants — instantané</li>
                    <li>• SAV sans relance — instantané</li>
                    <li>• Ticket SAV urgent — instantané</li>
                    <li>• Briefing du matin — instantané</li>
                    <li>• Veille publiée — instantané</li>
                    <li>• Autres — jamais</li>
                  </ul>
                </div>
                <div className="rounded-md border p-3">
                  <div className="font-semibold mb-1">Direction</div>
                  <ul className="text-muted-foreground space-y-0.5">
                    <li>• Tous types visibles — instantané</li>
                  </ul>
                </div>
                <div className="rounded-md border p-3">
                  <div className="font-semibold mb-1">Admin</div>
                  <ul className="text-muted-foreground space-y-0.5">
                    <li>• Tous types (dont Synchro Cegid) — instantané</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

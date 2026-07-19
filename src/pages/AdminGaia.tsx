import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { useCopilot } from "@/contexts/CopilotContext";
import { Loader2 } from "lucide-react";
import logoImg from "@/assets/logo.png";
import { GaiaDashboard } from "@/components/admin/GaiaDashboard";
import { GaiaMagasin } from "@/components/admin/GaiaMagasin";
import { MobileNav } from "@/components/MobileNav";
import { AppTopNav } from "@/components/AppTopNav";

export default function AdminGaia() {
  const { canAccessDashboard, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { open: openCopilot } = useCopilot();

  // Compat : anciens favoris/liens.
  //   #copilote | #revue → ouvre le panneau copilote global et nettoie le hash
  //   #sync              → redirige vers la page Réglages → Synchronisation
  useEffect(() => {
    const h = location.hash.replace(/^#/, "");
    if (h === "copilote" || h === "revue") {
      openCopilot();
      navigate({ pathname: location.pathname, hash: "#aa" }, { replace: true });
    } else if (h === "sync") {
      navigate("/admin/synchronisation", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  // Onglet actif piloté par le hash de l'URL.
  //   #aa | #clients | (aucun) → dashboard    #magasin → magasin
  const hashToTab = (hash: string): string => {
    const h = hash.replace(/^#/, "");
    if (h === "magasin") return "magasin";
    return "dashboard";
  };
  const [tab, setTab] = useState<string>(() => hashToTab(location.hash));
  useEffect(() => {
    setTab(hashToTab(location.hash));
  }, [location.hash]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessDashboard) return <Navigate to="/dossiers" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
          <AppTopNav />
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-display text-xl sm:text-2xl font-bold">Dashboard — Avranches Automatic</h2>
          <p className="text-sm text-muted-foreground">
            Pilotage financier et opérationnel.
          </p>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            const map: Record<string, string> = {
              dashboard: "#aa",
              magasin: "#magasin",
            };
            navigate({ pathname: location.pathname, hash: map[v] ?? "" }, { replace: true });
          }}
          className="w-full"
        >
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="dashboard">AA</TabsTrigger>
            <TabsTrigger value="magasin">Magasin</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <GaiaDashboard onGoToSync={() => navigate("/admin/synchronisation")} />
          </TabsContent>

          <TabsContent value="magasin">
            <GaiaMagasin />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

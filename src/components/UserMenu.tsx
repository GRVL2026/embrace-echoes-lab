import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, LogOut, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getCurrentSubscription,
  isPushSupported,
  sendTestPush,
  type PushTestResult,
} from "@/lib/push";
import { toast } from "@/hooks/use-toast";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PushTestResult | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!user) return;
    const s = isPushSupported();
    setSupported(s);
    if (!s) return;
    getCurrentSubscription()
      .then((sub) => setPushOn(!!sub))
      .catch(() => setPushOn(false));
  }, [user]);

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const handleTogglePush = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        setTestResult(null);
        toast({ title: "Notifications désactivées" });
      } else {
        const res = await enablePush();
        if (res.ok) {
          setPushOn(true);
          toast({ title: "Notifications activées ✓" });
        } else {
          toast({
            title: "Activation impossible",
            description: res.error,
            variant: "destructive",
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleTestPush = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await sendTestPush();
      setTestResult(r);
      if (!r.ok) {
        toast({ title: "Envoi échoué", description: r.error, variant: "destructive" });
      } else if ((r.total ?? 0) === 0) {
        toast({ title: "Aucun abonnement", description: "Active d'abord les notifications sur cet appareil.", variant: "destructive" });
      } else {
        toast({ title: `Envoyé à ${r.sent}/${r.total} appareil(s)` });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 relative">
      <span className="hidden sm:inline text-xs text-muted-foreground max-w-[180px] truncate">
        {user.email}
      </span>
      {supported && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTogglePush}
            disabled={busy}
            className="gap-1"
            title={pushOn ? "Notifications activées" : "Activer les notifications"}
          >
            {pushOn ? (
              <>
                <Bell className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">Notifications activées ✓</span>
              </>
            ) : (
              <>
                <BellOff className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">🔔 Activer</span>
              </>
            )}
          </Button>
          {pushOn && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTestPush}
              disabled={testing}
              className="gap-1"
              title="Envoyer une notification de test"
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{testing ? "Envoi…" : "Test"}</span>
            </Button>
          )}
        </>
      )}
      <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1">
        <LogOut className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Déconnexion</span>
      </Button>
      {testResult && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[320px] max-w-[90vw] rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <strong>Résultat du test</strong>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setTestResult(null)}
            >
              ✕
            </button>
          </div>
          {testResult.ok ? (
            <>
              <div className="mb-2">
                envoyé: {testResult.sent} · supprimés: {testResult.removed} · total: {testResult.total}
              </div>
              <ul className="space-y-1 max-h-48 overflow-auto">
                {(testResult.results ?? []).map((r, i) => (
                  <li key={i} className="border-t border-border/50 pt-1">
                    <div className="font-mono break-all">{r.endpoint}</div>
                    <div>
                      HTTP {r.status ?? "—"}
                      {r.error ? ` · ${r.error}` : ""}
                    </div>
                  </li>
                ))}
                {(testResult.results ?? []).length === 0 && (
                  <li className="text-muted-foreground">Aucun abonnement enregistré.</li>
                )}
              </ul>
            </>
          ) : (
            <div className="text-destructive">{testResult.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

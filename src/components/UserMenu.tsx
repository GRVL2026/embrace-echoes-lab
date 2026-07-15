import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getCurrentSubscription,
  isPushSupported,
} from "@/lib/push";
import { toast } from "@/hooks/use-toast";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-xs text-muted-foreground max-w-[180px] truncate">
        {user.email}
      </span>
      {supported && (
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
      )}
      <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1">
        <LogOut className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Déconnexion</span>
      </Button>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SPACES, type Space, type NavEntry } from "@/nav/spaces";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Copy, CheckCheck, XCircle, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type Profile = { id: string; email: string | null; full_name: string | null };

type AccessRow = { user_id: string; section_key: string; allowed: boolean };

const LOCKED_KEYS = new Set<string>(["reglages", "reglages.utilisateurs"]);

export function MenuAccessDialog({
  open,
  onOpenChange,
  targetUser,
  profiles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetUser: Profile | null;
  profiles: Profile[];
}) {
  const { user: currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** undefined = fallback show() (pas d'override), true/false = override explicite */
  const [access, setAccess] = useState<Record<string, boolean | undefined>>({});
  const [copyFromId, setCopyFromId] = useState<string>("");

  useEffect(() => {
    if (!open || !targetUser) return;
    setLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("user_menu_access")
        .select("section_key, allowed")
        .eq("user_id", targetUser.id);
      const map: Record<string, boolean> = {};
      ((data ?? []) as AccessRow[]).forEach((r) => (map[r.section_key] = r.allowed));
      setAccess(map);
      setLoading(false);
    })();
  }, [open, targetUser]);

  const isSelf = targetUser?.id === currentUser?.id;

  const setKey = (key: string, val: boolean | undefined) => {
    setAccess((prev) => {
      const next = { ...prev };
      if (val === undefined) delete next[key];
      else next[key] = val;
      return next;
    });
  };

  const toggleSpace = (space: Space, val: boolean) => {
    // Propage aux enfants (chaque enfant reste réglable individuellement ensuite).
    setKey(space.key, val);
    space.entries.forEach((e) => setKey(e.key, val));
  };

  const allOn = () => {
    const next: Record<string, boolean> = {};
    SPACES.forEach((s) => {
      next[s.key] = true;
      s.entries.forEach((e) => (next[e.key] = true));
    });
    setAccess(next);
  };
  const allOff = () => {
    const next: Record<string, boolean> = {};
    SPACES.forEach((s) => {
      // On garde toujours l'accès à Réglages > Utilisateurs si l'admin s'édite lui-même.
      const spaceLocked = isSelf && LOCKED_KEYS.has(s.key);
      next[s.key] = spaceLocked ? true : false;
      s.entries.forEach((e) => {
        const entryLocked = isSelf && LOCKED_KEYS.has(e.key);
        next[e.key] = entryLocked ? true : false;
      });
    });
    setAccess(next);
  };

  const copyFrom = async () => {
    if (!copyFromId) return;
    const { data } = await (supabase as any)
      .from("user_menu_access")
      .select("section_key, allowed")
      .eq("user_id", copyFromId);
    const map: Record<string, boolean> = {};
    ((data ?? []) as AccessRow[]).forEach((r) => (map[r.section_key] = r.allowed));
    setAccess(map);
    toast({ title: "Accès copiés", description: "Cliquez sur Enregistrer pour appliquer." });
  };

  const save = async () => {
    if (!targetUser) return;
    setSaving(true);
    // Anti-lockout : on force l'accès aux clés verrouillées si l'utilisateur est soi-même.
    const patched: Record<string, boolean> = {};
    Object.entries(access).forEach(([k, v]) => {
      if (v !== undefined) patched[k] = v;
    });
    if (isSelf) {
      LOCKED_KEYS.forEach((k) => (patched[k] = true));
    }

    // Reset : on efface tous les rows puis on insère ceux définis.
    const { error: delErr } = await (supabase as any)
      .from("user_menu_access")
      .delete()
      .eq("user_id", targetUser.id);
    if (delErr) {
      toast({ title: "Erreur", description: delErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    const rows = Object.entries(patched).map(([section_key, allowed]) => ({
      user_id: targetUser.id,
      section_key,
      allowed,
      updated_by: currentUser?.id ?? null,
    }));
    if (rows.length) {
      const { error } = await (supabase as any).from("user_menu_access").insert(rows);
      if (error) {
        toast({ title: "Erreur", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    }
    toast({
      title: "Accès enregistrés",
      description: targetUser.full_name?.trim() || targetUser.email || "",
    });
    setSaving(false);
    onOpenChange(false);
  };

  const otherProfiles = useMemo(
    () => profiles.filter((p) => p.id !== targetUser?.id),
    [profiles, targetUser],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Accès menu — {targetUser?.full_name?.trim() || targetUser?.email || "—"}
          </DialogTitle>
          <DialogDescription>
            Activez/désactivez chaque section et sous-section. Les rôles Admin et Direction
            conservent l'accès complet par défaut.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 pb-2 border-b border-border">
          <Button variant="outline" size="sm" onClick={allOn}>
            <CheckCheck className="h-4 w-4 mr-1" /> Tout activer
          </Button>
          <Button variant="outline" size="sm" onClick={allOff}>
            <XCircle className="h-4 w-4 mr-1" /> Tout désactiver
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <Select value={copyFromId} onValueChange={setCopyFromId}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue placeholder="Copier depuis…" />
              </SelectTrigger>
              <SelectContent>
                {otherProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name?.trim() || p.email || p.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={copyFrom} disabled={!copyFromId}>
              <Copy className="h-4 w-4 mr-1" /> Copier
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-3 pr-1 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            SPACES.map((space) => {
              const spaceKey = space.key;
              const spaceVal = access[spaceKey];
              const spaceOn = spaceVal !== false; // undefined ou true = ON (fallback show)
              const spaceLocked = isSelf && LOCKED_KEYS.has(spaceKey);
              const color = `hsl(var(${space.colorToken}))`;
              return (
                <div
                  key={spaceKey}
                  className="rounded-md border border-border bg-card/40"
                >
                  <div
                    className="flex items-center gap-3 p-3 border-b border-border"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <space.icon className="h-4 w-4" style={{ color }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{space.label}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {spaceKey}
                      </div>
                    </div>
                    {spaceLocked && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Lock className="h-3 w-3" /> verrouillé
                      </span>
                    )}
                    <Switch
                      checked={spaceOn}
                      disabled={spaceLocked}
                      onCheckedChange={(v) => toggleSpace(space, v)}
                    />
                  </div>
                  <div className="p-2 space-y-1">
                    {space.entries.map((entry) => (
                      <EntryRow
                        key={entry.key}
                        entry={entry}
                        value={access[entry.key]}
                        locked={isSelf && LOCKED_KEYS.has(entry.key)}
                        onChange={(v) => setKey(entry.key, v)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({
  entry,
  value,
  locked,
  onChange,
}: {
  entry: NavEntry;
  value: boolean | undefined;
  locked: boolean;
  onChange: (v: boolean) => void;
}) {
  const on = value !== false;
  const Icon = entry.icon;
  return (
    <div className="flex items-center gap-3 rounded px-3 py-2 hover:bg-muted/40">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{entry.label}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {entry.key}
        </div>
      </div>
      {locked && (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3" /> verrouillé
        </span>
      )}
      <Switch checked={on} disabled={locked} onCheckedChange={onChange} />
    </div>
  );
}

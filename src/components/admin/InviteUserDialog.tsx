import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Access = {
  salle_enabled: boolean;
  dashboard_enabled: boolean;
  copilote_enabled: boolean;
};

type Niveau = "aucun" | "commercial" | "chef_ventes" | "direction" | "admin";

const NIVEAUX: { value: Niveau; label: string; sub: string }[] = [
  { value: "aucun", label: "Aucun (accès Salle uniquement)", sub: "Ne reçoit ni Commerce, ni Dashboard, ni marge. À combiner avec l'accès Salle ci-dessous." },
  { value: "commercial", label: "Commercial", sub: "Commerce, copilote, dashboard, marge par client" },
  { value: "chef_ventes", label: "Chef des ventes", sub: "Comme commercial + marges globales (totaux, matrice)" },
  { value: "direction", label: "Direction", sub: "Tout, sauf réglages techniques" },
  { value: "admin", label: "Admin", sub: "Tout, y compris réglages et utilisateurs" },
];

export function InviteUserDialog({ onInvited }: { onInvited?: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [niveau, setNiveau] = useState<Niveau>("aucun");
  const [access, setAccess] = useState<Access>({
    salle_enabled: true,
    dashboard_enabled: false,
    copilote_enabled: false,
  });
  const [sending, setSending] = useState(false);

  const reset = () => {
    setEmail("");
    setNiveau("aucun");
    setAccess({ salle_enabled: true, dashboard_enabled: false, copilote_enabled: false });
  };

  const submit = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      toast({ title: "Email invalide", variant: "destructive" });
      return;
    }
    if (niveau === "aucun" && !access.salle_enabled && !access.dashboard_enabled) {
      toast({ title: "Aucun accès sélectionné", description: "Choisis un niveau ou coche au moins un accès.", variant: "destructive" });
      return;
    }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("admin-invite-user", {
      body: {
        email: clean,
        role: niveau === "aucun" ? null : niveau,
        salle_enabled: access.salle_enabled,
        dashboard_enabled: access.dashboard_enabled,
        copilote_enabled: access.copilote_enabled,
        redirect_to: `${window.location.origin}/`,
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      const msg = (data as any)?.error ?? error?.message ?? "Échec de l'invitation";
      toast({ title: "Erreur", description: msg, variant: "destructive" });
      return;
    }
    toast({ title: "Invitation envoyée", description: `${clean} · ${niveau === "aucun" ? "salle uniquement" : niveau}` });
    reset();
    setOpen(false);
    onInvited?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <UserPlus className="h-4 w-4 mr-2" /> Inviter un utilisateur
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Inviter un utilisateur</DialogTitle>
          <DialogDescription>
            L'invité reçoit un email pour créer son mot de passe et arrive avec le niveau choisi et uniquement les accès cochés.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prenom.nom@hyper-nova.fr"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Niveau</Label>
            <div className="rounded-md border border-border divide-y divide-border">
              {NIVEAUX.map((n) => (
                <label
                  key={n.value}
                  className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30"
                >
                  <input
                    type="radio"
                    name="niveau"
                    value={n.value}
                    checked={niveau === n.value}
                    onChange={() => setNiveau(n.value)}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{n.label}</div>
                    <div className="text-xs text-muted-foreground">{n.sub}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border divide-y divide-border">
            <AccessRow
              label="Accès Salle Hyper Nova"
              sub="Saisie B2C et dashboard salle"
              checked={access.salle_enabled}
              onChange={(v) => setAccess((a) => ({ ...a, salle_enabled: v }))}
            />
            <AccessRow
              label="Accès Dashboard supplémentaire"
              sub="Utile uniquement pour un profil non commercial"
              checked={access.dashboard_enabled}
              onChange={(v) => setAccess((a) => ({ ...a, dashboard_enabled: v }))}
            />
            <AccessRow
              label="Accès copilote"
              sub="Copilote IA sur les fiches"
              checked={access.copilote_enabled}
              onChange={(v) => setAccess((a) => ({ ...a, copilote_enabled: v }))}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Les rôles commercial / chef des ventes / direction / admin définissent l'accès au Commerce, au Dashboard et à la visibilité des marges.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>Annuler</Button>
          <Button onClick={submit} disabled={sending || !email.trim()}>
            {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Envoi…</> : "Envoyer l'invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccessRow({ label, sub, checked, onChange }: {
  label: string; sub: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

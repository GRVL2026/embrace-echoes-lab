import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, Phone, MapPin, StickyNote, Circle } from "lucide-react";

export type StatutRelance =
  | "a_contacter"
  | "contacte"
  | "relance"
  | "reactive"
  | "sans_suite";
export type ActionType = "mail" | "appel" | "visite" | "note" | "autre";

export const STATUT_LABEL: Record<StatutRelance, string> = {
  a_contacter: "À contacter",
  contacte: "Contacté",
  relance: "Relance",
  reactive: "Réactivé",
  sans_suite: "Sans suite",
};
export const STATUT_COLOR: Record<StatutRelance, string> = {
  a_contacter: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  contacte: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  relance: "bg-purple-500/15 text-purple-500 border-purple-500/30",
  reactive: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  sans_suite: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const TYPE_ICON: Record<ActionType, typeof Mail> = {
  mail: Mail,
  appel: Phone,
  visite: MapPin,
  note: StickyNote,
  autre: Circle,
};

type ActionRow = {
  id: string;
  type: ActionType;
  date: string;
  contenu: string;
  resultat: string | null;
  prochaine_relance: string | null;
  auteur: string | null;
};

type ClientRea = {
  code_client: string;
  nom: string | null;
  statut_relance: StatutRelance | null;
  statut_relance_maj: string | null;
  actions: ActionRow[];
};

export function ClientActionsDialog({
  code,
  open,
  onOpenChange,
  initialTab = "action",
  onChanged,
}: {
  code: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab?: "action" | "statut";
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<ClientRea | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"action" | "statut">(initialTab);

  // Form: add action
  const [type, setType] = useState<ActionType>("appel");
  const [contenu, setContenu] = useState("");
  const [resultat, setResultat] = useState("");
  const [prochaine, setProchaine] = useState("");

  // Form: statut
  const [statut, setStatut] = useState<StatutRelance | "">("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, code]);

  useEffect(() => {
    if (!open || !code) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      const { data: res, error } = await (supabase as any).rpc(
        "get_client_reactivation",
        { _code: code },
      );
      if (cancel) return;
      if (error) {
        toast({ title: "Erreur", description: error.message, variant: "destructive" });
      } else {
        const d = res as ClientRea;
        setData(d);
        setStatut((d?.statut_relance as StatutRelance) ?? "");
      }
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [open, code]);

  const submitAction = async () => {
    if (!code || !user) return;
    if (!contenu.trim()) {
      toast({ title: "Contenu requis", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("client_actions").insert({
      code_client: code,
      auteur_id: user.id,
      type,
      contenu: contenu.trim(),
      resultat: resultat.trim() || null,
      prochaine_relance: prochaine || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Action enregistrée" });
    setContenu("");
    setResultat("");
    setProchaine("");
    // Refresh
    const { data: res } = await (supabase as any).rpc("get_client_reactivation", {
      _code: code,
    });
    setData(res as ClientRea);
    onChanged?.();
  };

  const submitStatut = async () => {
    if (!code || !statut || !user) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("gaia_clients")
      .update({
        statut_relance: statut,
        statut_relance_maj: new Date().toISOString(),
        statut_relance_par: user.id,
      })
      .eq("customer_id", code);
    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Statut mis à jour" });
    setData((d) => (d ? { ...d, statut_relance: statut } : d));
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{data?.nom || code || "Client"}</DialogTitle>
          <DialogDescription>
            {data?.statut_relance ? (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${
                  STATUT_COLOR[data.statut_relance as StatutRelance]
                }`}
              >
                {STATUT_LABEL[data.statut_relance as StatutRelance]}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Aucun statut défini</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex gap-2 border-b">
              <button
                className={`px-3 py-2 text-sm ${
                  tab === "action"
                    ? "border-b-2 border-primary font-semibold"
                    : "text-muted-foreground"
                }`}
                onClick={() => setTab("action")}
              >
                Ajouter une action
              </button>
              <button
                className={`px-3 py-2 text-sm ${
                  tab === "statut"
                    ? "border-b-2 border-primary font-semibold"
                    : "text-muted-foreground"
                }`}
                onClick={() => setTab("statut")}
              >
                Changer le statut
              </button>
            </div>

            {tab === "action" && (
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={type} onValueChange={(v) => setType(v as ActionType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="appel">Appel</SelectItem>
                        <SelectItem value="mail">Mail</SelectItem>
                        <SelectItem value="visite">Visite</SelectItem>
                        <SelectItem value="note">Note</SelectItem>
                        <SelectItem value="autre">Autre</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Prochaine relance</Label>
                    <Input
                      type="date"
                      value={prochaine}
                      onChange={(e) => setProchaine(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label>Contenu</Label>
                  <Textarea
                    value={contenu}
                    onChange={(e) => setContenu(e.target.value)}
                    placeholder="Sujet, résumé de l'échange, décisions…"
                    rows={3}
                  />
                </div>
                <div>
                  <Label>Résultat (optionnel)</Label>
                  <Input
                    value={resultat}
                    onChange={(e) => setResultat(e.target.value)}
                    placeholder="Ex : RDV programmé, à rappeler, refus…"
                  />
                </div>
                <Button onClick={submitAction} disabled={saving} className="w-full">
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Enregistrer l'action
                </Button>
              </div>
            )}

            {tab === "statut" && (
              <div className="space-y-3 py-2">
                <Label>Statut de réactivation</Label>
                <Select value={statut} onValueChange={(v) => setStatut(v as StatutRelance)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir un statut" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUT_LABEL) as StatutRelance[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUT_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={submitStatut}
                  disabled={saving || !statut}
                  className="w-full"
                >
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Mettre à jour le statut
                </Button>
              </div>
            )}

            <div className="border-t pt-3 mt-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Historique récent ({data?.actions?.length ?? 0})
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {(data?.actions ?? []).length === 0 && (
                  <div className="text-sm text-muted-foreground italic">
                    Aucune action enregistrée pour ce client.
                  </div>
                )}
                {(data?.actions ?? []).map((a) => {
                  const Icon = TYPE_ICON[a.type] ?? Circle;
                  return (
                    <div
                      key={a.id}
                      className="text-sm border border-border rounded-md p-2 bg-muted/30"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        <span className="uppercase tracking-wider">{a.type}</span>
                        <span>•</span>
                        <span>{new Date(a.date).toLocaleDateString("fr-FR")}</span>
                        {a.auteur && (
                          <>
                            <span>•</span>
                            <span>{a.auteur}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1">{a.contenu}</div>
                      {a.resultat && (
                        <div className="text-xs text-muted-foreground mt-1">
                          → {a.resultat}
                        </div>
                      )}
                      {a.prochaine_relance && (
                        <div className="text-xs text-amber-500 mt-1">
                          Prochaine relance :{" "}
                          {new Date(a.prochaine_relance).toLocaleDateString("fr-FR")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

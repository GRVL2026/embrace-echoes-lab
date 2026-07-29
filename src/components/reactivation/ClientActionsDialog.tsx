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
import { Loader2, Mail, Phone, MapPin, StickyNote, Circle, Sparkles, Send, User, Archive, ArchiveRestore } from "lucide-react";
import { CompanyStatusBadge } from "@/components/reactivation/CompanyStatusBadge";

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
  ville: string | null;
  typologie: string | null;
  email: string | null;
  telephone: string | null;
  adresse1: string | null;
  adresse2: string | null;
  code_postal: string | null;
  pays: string | null;
  owner_id: string | null;
  owner_nom: string | null;
  statut_relance: StatutRelance | null;
  statut_relance_maj: string | null;
  derniere_commande: string | null;
  ca_total: number | null;
  derniere_action: { type: string; date: string; auteur: string | null } | null;
  familles: Array<{ famille: string; ca: number }>;
  produits_recents: Array<{ code: string; libelle: string; d: string }>;
  actions: ActionRow[];
  archive: boolean | null;
  archive_at: string | null;
  etat_administratif: string | null;
  procedure_collective: boolean | null;
};

function categorieFromDate(d: string | null): { label: string; cls: string } {
  if (!d) return { label: "sans commande", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  const months = (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 12) return { label: "actif", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" };
  if (months <= 36) return { label: "dormant", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" };
  return { label: "inactif", cls: "bg-rose-500/15 text-rose-500 border-rose-500/30" };
}

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const cleanPhone = (t: string | null | undefined) => (t || "").replace(/[^\d+]/g, "");

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
  const { user, isAdmin } = useAuth();
  const [data, setData] = useState<ClientRea | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"action" | "statut">(initialTab);
  const [archiving, setArchiving] = useState(false);

  // Form: add action
  const [type, setType] = useState<ActionType>("appel");
  const [objet, setObjet] = useState("");
  const [contenu, setContenu] = useState("");
  const [resultat, setResultat] = useState("");
  const [prochaine, setProchaine] = useState("");
  const [statutResultant, setStatutResultant] = useState<"auto" | StatutRelance>("auto");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

  // Form: statut
  const [statut, setStatut] = useState<StatutRelance | "">("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, code]);

  const refresh = async () => {
    if (!code) return;
    const { data: res, error } = await (supabase as any).rpc("get_client_reactivation", { _code: code });
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    const d = res as ClientRea;
    setData(d);
    setStatut((d?.statut_relance as StatutRelance) ?? "");
  };

  useEffect(() => {
    if (!open || !code) return;
    let cancel = false;
    setLoading(true);
    setObjet("");
    setContenu("");
    setResultat("");
    setProchaine("");
    setType("appel");
    setStatutResultant("auto");
    (async () => {
      await refresh();
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code]);

  const hasEmail = !!(data?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email));

  const generateMail = async () => {
    if (!code) return;
    setGenerating(true);
    const { data: res, error } = await supabase.functions.invoke("generer-relance-client", {
      body: { code_client: code },
    });
    setGenerating(false);
    if (error || !res?.objet) {
      toast({
        title: "Génération impossible",
        description: (error as any)?.message || "Réessayez dans un instant.",
        variant: "destructive",
      });
      return;
    }
    setType("mail");
    setObjet(res.objet);
    setContenu(res.corps);
    toast({ title: "Proposition générée", description: "Vous pouvez éditer avant d'envoyer." });
  };

  // Détermine le statut à appliquer après une action.
  // - Choix explicite du commercial → prime.
  // - Sinon règle auto : 1re action (mail/appel/visite) sur "sans statut" ou "a_contacter" → "contacte" ;
  //   action suivante → "relance" ; "reactive"/"sans_suite" ne bougent pas.
  //   Les actions de type "note" / "autre" ne déclenchent pas de transition auto.
  const computeNextStatut = (
    actionType: ActionType,
    explicit: "auto" | StatutRelance,
    current: StatutRelance | null,
  ): StatutRelance | null => {
    if (explicit !== "auto") return explicit;
    if (actionType === "note" || actionType === "autre") return null;
    if (!current || current === "a_contacter") return "contacte";
    if (current === "contacte") return "relance";
    // relance/reactive/sans_suite : on ne change rien automatiquement
    return null;
  };

  const applyStatutAfterAction = async (actionType: ActionType) => {
    if (!code || !user) return;
    const current = (data?.statut_relance as StatutRelance | null) ?? null;
    const next = computeNextStatut(actionType, statutResultant, current);
    if (!next || next === current) return;
    await (supabase as any)
      .from("gaia_clients")
      .update({
        statut_relance: next,
        statut_relance_maj: new Date().toISOString(),
        statut_relance_par: user.id,
      })
      .eq("customer_id", code);
  };

  const sendMail = async () => {
    if (!code || !hasEmail) return;
    if (!objet.trim() || !contenu.trim()) {
      toast({ title: "Objet et contenu requis", variant: "destructive" });
      return;
    }
    setSending(true);
    const { data: res, error } = await supabase.functions.invoke("envoyer-relance-client", {
      body: {
        code_client: code,
        objet: objet.trim(),
        corps: contenu.trim(),
        prochaine_relance: prochaine || null,
      },
    });
    if (error || !res?.ok) {
      setSending(false);
      toast({
        title: "Envoi échoué",
        description: (error as any)?.message || "Vérifiez l'email et réessayez.",
        variant: "destructive",
      });
      return;
    }
    await applyStatutAfterAction("mail");
    setSending(false);
    toast({ title: "Mail envoyé", description: data?.email ?? "" });
    setObjet("");
    setContenu("");
    setResultat("");
    setProchaine("");
    setStatutResultant("auto");
    await refresh();
    onChanged?.();
  };

  const submitAction = async () => {
    if (!code || !user) return;
    if (!contenu.trim()) {
      toast({ title: "Contenu requis", variant: "destructive" });
      return;
    }
    setSaving(true);
    const contenuFinal = type === "mail" && objet.trim()
      ? `Objet : ${objet.trim()}\n\n${contenu.trim()}`
      : contenu.trim();
    const { error } = await (supabase as any).from("client_actions").insert({
      code_client: code,
      auteur_id: user.id,
      type,
      contenu: contenuFinal,
      resultat: resultat.trim() || null,
      prochaine_relance: prochaine || null,
    });
    if (error) {
      setSaving(false);
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    await applyStatutAfterAction(type);
    setSaving(false);
    toast({ title: "Action enregistrée" });
    setObjet("");
    setContenu("");
    setResultat("");
    setProchaine("");
    setStatutResultant("auto");
    await refresh();
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

  const toggleArchive = async () => {
    if (!code) return;
    const targetArchived = !data?.archive;
    if (targetArchived) {
      const msg =
        `Archiver le compte « ${data?.nom || code} » ?\n\n` +
        `• Il disparaîtra de la carte, des listes et du copilote.\n` +
        `• Aucune donnée n'est supprimée : vous pourrez le dé-archiver à tout moment.\n` +
        `• La synchro Cegid préservera ce statut.`;
      if (!window.confirm(msg)) return;
    } else {
      if (!window.confirm(`Dé-archiver le compte « ${data?.nom || code} » et le remettre dans les listes ?`)) return;
    }
    setArchiving(true);
    const { error } = await (supabase as any).rpc("set_client_archive", {
      _code: code,
      _archived: targetArchived,
    });
    setArchiving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: targetArchived ? "Compte archivé" : "Compte dé-archivé",
      description: targetArchived
        ? "Il est désormais masqué partout dans l'application."
        : "Il réapparaît dans les listes et sur la carte.",
    });
    await refresh();
    onChanged?.();
  };

  const companyStatus = data
    ? { etat_administratif: data.etat_administratif, procedure_collective: data.procedure_collective, archive: data.archive }
    : null;
  // Met en avant "Archiver ce compte" quand la société est cessée / en procédure et non déjà archivée.
  const emphasizeArchive =
    !!companyStatus &&
    !companyStatus.archive &&
    ((companyStatus.etat_administratif || "").toLowerCase().startsWith("cess") ||
      (companyStatus.etat_administratif || "").toLowerCase() === "c" ||
      companyStatus.procedure_collective === true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{data?.nom || code || "Client"}</DialogTitle>
          <DialogDescription>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {companyStatus && (
                <CompanyStatusBadge
                  etat_administratif={companyStatus.etat_administratif}
                  procedure_collective={companyStatus.procedure_collective}
                  archive={companyStatus.archive}
                />
              )}
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
              {data?.owner_nom ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs">
                  <User className="h-3 w-3" /> {data.owner_nom}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-muted-foreground/20 text-muted-foreground text-xs">
                  Pool partagé
                </span>
              )}
              {data?.email && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" /> {data.email}
                </span>
              )}
            </div>
            {isAdmin && data && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {data.archive ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={toggleArchive}
                    disabled={archiving}
                    className="gap-2"
                  >
                    {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                    Dé-archiver ce compte
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={emphasizeArchive ? "destructive" : "outline"}
                    onClick={toggleArchive}
                    disabled={archiving}
                    className="gap-2"
                  >
                    {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                    {emphasizeArchive ? "Archiver ce compte cessé" : "Archiver ce compte"}
                  </Button>
                )}
                {emphasizeArchive && (
                  <span className="text-[11px] text-muted-foreground">
                    Recommandé : société signalée comme cessée / en procédure collective.
                  </span>
                )}
                {data.archive && data.archive_at && (
                  <span className="text-[11px] text-muted-foreground">
                    Archivé le {new Date(data.archive_at).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {data && (() => {
              const cat = categorieFromDate(data.derniere_commande);
              const tel = cleanPhone(data.telephone);
              const adresseLigne = [data.adresse1, data.adresse2].filter(Boolean).join(", ");
              const localite = [data.code_postal, data.ville].filter(Boolean).join(" ");
              const fullAdresse = [adresseLigne, localite].filter(Boolean).join(" — ");
              const lastAct = data.derniere_action;
              return (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Contact & contexte
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {tel ? (
                        <a href={`tel:${tel}`} className="text-primary hover:underline font-medium">
                          {data.telephone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground italic">Téléphone non renseigné</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {hasEmail ? (
                        <a href={`mailto:${data.email}`} className="text-primary hover:underline font-medium truncate">
                          {data.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground italic">Email non renseigné</span>
                      )}
                    </div>
                    <div className="flex items-start gap-2 md:col-span-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      {fullAdresse ? (
                        <span>{fullAdresse}</span>
                      ) : (
                        <span className="text-muted-foreground italic">Adresse non renseignée</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${cat.cls}`}>
                      {cat.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Dernière cde :{" "}
                      <b className="text-foreground">
                        {data.derniere_commande
                          ? new Date(data.derniere_commande).toLocaleDateString("fr-FR")
                          : "aucune"}
                      </b>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      CA total : <b className="text-foreground">{fmtEUR(data.ca_total)}</b>
                    </span>
                    {lastAct ? (
                      <span className="text-xs text-muted-foreground">
                        Dernière action : <b className="text-foreground">{lastAct.type}</b>
                        {" "}— {new Date(lastAct.date).toLocaleDateString("fr-FR")}
                        {lastAct.auteur ? ` (${lastAct.auteur})` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Aucune action encore</span>
                    )}
                  </div>
                </div>
              );
            })()}

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

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={generateMail}
                    disabled={generating}
                    className="gap-2"
                  >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Proposer un mail de relance
                  </Button>
                  {!hasEmail && (
                    <span className="text-xs text-muted-foreground italic">
                      Email non disponible — enregistrement seul
                    </span>
                  )}
                </div>

                {type === "mail" && (
                  <div>
                    <Label>Objet</Label>
                    <Input
                      value={objet}
                      onChange={(e) => setObjet(e.target.value)}
                      placeholder="Objet du mail"
                    />
                  </div>
                )}
                <div>
                  <Label>{type === "mail" ? "Contenu du mail" : "Contenu"}</Label>
                  <Textarea
                    value={contenu}
                    onChange={(e) => setContenu(e.target.value)}
                    placeholder={type === "mail" ? "Corps du message…" : "Sujet, résumé de l'échange, décisions…"}
                    rows={type === "mail" ? 10 : 3}
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

                <div>
                  <Label>Statut après cette action</Label>
                  <Select
                    value={statutResultant}
                    onValueChange={(v) => setStatutResultant(v as "auto" | StatutRelance)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto — {(() => {
                          const cur = (data?.statut_relance as StatutRelance | null) ?? null;
                          const next = computeNextStatut(type, "auto", cur);
                          if (!next) return "inchangé";
                          return `passe à « ${STATUT_LABEL[next]} »`;
                        })()}
                      </SelectItem>
                      {(Object.keys(STATUT_LABEL) as StatutRelance[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          Forcer : {STATUT_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Choisissez « Réactivé » si commande obtenue, « Sans suite » si refus.
                    Sinon laissez sur Auto.
                  </p>
                </div>


                <div className="flex gap-2">
                  <Button onClick={submitAction} disabled={saving} variant="outline" className="flex-1">
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Enregistrer l'action
                  </Button>
                  {type === "mail" && hasEmail && (
                    <Button onClick={sendMail} disabled={sending} className="flex-1 gap-2">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Envoyer le mail
                    </Button>
                  )}
                </div>
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
                      <div className="mt-1 whitespace-pre-wrap">{a.contenu}</div>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2, Plus, Upload, Target, ExternalLink, Trash2, GripVertical, Mail, Phone,
  Sparkles, Copy, RefreshCw, Save, Link2, Link2Off, Search, TrendingUp, Zap, Send, Linkedin, X,
} from "lucide-react";

/* -------------------- LinkedIn search helpers -------------------- */
/** Ouvre un lien externe, avec repli si le navigateur ou l'iframe le refuse.
 *  L'aperçu de l'éditeur Lovable est un bac à sable : la navigation vers un autre
 *  domaine y échoue sans erreur visible (page noire). Plutôt que de laisser
 *  l'utilisateur devant un écran vide, on copie l'adresse et on le dit. */
function ouvrirLienExterne(url: string, e?: { preventDefault: () => void; stopPropagation: () => void }) {
  e?.preventDefault();
  e?.stopPropagation();
  let ouvert: Window | null = null;
  try {
    ouvert = window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    ouvert = null;
  }
  if (!ouvert) {
    navigator.clipboard?.writeText(url).then(
      () => toast.info("Ouverture bloquée par le navigateur — lien copié, colle-le dans un nouvel onglet"),
      () => toast.error(`Ouverture bloquée. Adresse : ${url}`),
    );
  }
}

function buildLinkedInSearch(p: { contact_nom?: string | null; entreprise?: string | null; ville?: string | null }) {
  // Ne chercher QUE sur le nom du contact. La version précédente concaténait nom +
  // raison sociale + ville : LinkedIn exigeant que TOUS les mots-clés figurent dans le
  // profil, une recherche comme « Aymeric DRUJON D'ASTROS FLOWER EXPLOITATION CAMPINGS
  // BALMA » ne pouvait rien renvoyer — aucun profil ne reprend la raison sociale entière.
  const nom = (p.contact_nom ?? "").replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  if (!nom) return null;
  const enc = encodeURIComponent(nom);
  return {
    // Recherche web plutôt que recherche LinkedIn. LinkedIn refuse d'ouvrir ses pages de
    // résultats quand on y arrive par un lien extérieur — « www.linkedin.com est bloqué,
    // ERR_BLOCKED_BY_RESPONSE » — quel que soit l'état de la session. Trois tentatives de
    // correction ont buté dessus. Un moteur généraliste, lui, retrouve le profil au nom
    // seul : c'est la méthode que Léopaul avait trouvée à la main, et elle marche.
    web: `https://www.google.com/search?q=${encodeURIComponent(`"${nom}" linkedin`)}`,
    people: `https://www.linkedin.com/search/results/people/?keywords=${enc}`,
    sales: `https://www.linkedin.com/sales/search/people?query=(spellCorrectionEnabled:true,keywords:${enc})`,
  };
}

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Statut = "nouveau" | "contacte" | "connecte" | "repondu" | "rdv" | "devis" | "client" | "perdu";
// « camping » est un segment à part entière : l'hôtellerie de plein air n'est ni du
// loisir indoor (bowling, parc) ni du CHR — qui désigne Cafés, Hôtels, Restaurants.
type Segment = "camping" | "loisirs" | "chr" | "retail" | "revendeur" | "autre";
type Source = "linkedin" | "salon" | "reco" | "site" | "signal" | "autre";

type Prospect = {
  id: string;
  entreprise: string;
  contact_nom: string | null;
  contact_role: string | null;
  ville: string | null;
  segment: Segment;
  source: Source | null;
  signal: string | null;
  linkedin_url: string | null;
  email: string | null;
  telephone: string | null;
  etoiles: number | null;
  capacite: number | null;
  groupe: string | null;
  tag: string | null;
  statut: Statut;
  owner_id: string | null;
  montant_estime: number | null;
  code_client: string | null;
  notes: string | null;
  lgm_lead_id: string | null;
  lgm_audience: string | null;
  lgm_status: string | null;
  lgm_sent_at: string | null;
  siren: string | null;
  siret: string | null;
  adresse: string | null;
  effectif: string | null;
  ca_annuel: number | null;
  activite: string | null;
  site_web: string | null;
  pret_a_envoyer: boolean | null;
  accroche_defaut: string | null;
  prepare_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProspectEvent = {
  id: string;
  prospect_id: string;
  created_at: string;
  type: string;
  contenu: string | null;
  ancien_statut: string | null;
  nouveau_statut: string | null;
  auteur: string | null;
};

// Colonnes visibles du Kanban (dans l'ordre du pipeline)
const STATUTS: { key: Statut; label: string }[] = [
  { key: "nouveau", label: "Nouveau" },
  { key: "contacte", label: "Contacté" },
  { key: "connecte", label: "Connecté (LinkedIn)" },
  { key: "repondu", label: "Répondu" },
  { key: "rdv", label: "RDV" },
  { key: "devis", label: "Devis" },
];

// Libellés complets (inclut les statuts hors pipeline, conservés pour l'historique et l'attribution)
const STATUT_LABELS: Record<Statut, string> = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  connecte: "Connecté (LinkedIn)",
  repondu: "Répondu",
  rdv: "RDV",
  devis: "Devis",
  client: "Client (gagné)",
  perdu: "Perdu",
};

const STATUT_COLOR: Record<Statut, string> = {
  nouveau: "hsl(220 15% 55%)",
  contacte: "hsl(200 90% 60%)",
  connecte: "hsl(210 80% 55%)",
  repondu: "hsl(258 90% 66%)",
  rdv: "hsl(280 85% 65%)",
  devis: "hsl(48 100% 55%)",
  client: "hsl(142 71% 45%)",
  perdu: "hsl(0 75% 60%)",
};

const SEGMENTS: { key: Segment; label: string; className: string }[] = [
  { key: "camping", label: "Camping", className: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  { key: "loisirs", label: "Loisirs", className: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  { key: "chr", label: "CHR", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  { key: "retail", label: "Retail", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  { key: "revendeur", label: "Revendeur", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  { key: "autre", label: "Autre", className: "bg-muted text-muted-foreground border-border" },
];

const SOURCES: { key: Source; label: string }[] = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "salon", label: "Salon" },
  { key: "reco", label: "Recommandation" },
  { key: "site", label: "Site web" },
  { key: "autre", label: "Autre" },
];

const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n ?? 0));

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function segmentMeta(s: string | null | undefined) {
  return SEGMENTS.find((x) => x.key === s) ?? SEGMENTS[SEGMENTS.length - 1];
}

function formatLgmStatus(raw: string | null | undefined): string {
  if (!raw) return "";
  const up = raw.toUpperCase();
  if (up.includes("CONNECTION_ACCEPTED")) return "Connexion acceptée";
  if (up.includes("REPLIED") || up.includes("REPLY") || up.includes("ANSWER")) return "A répondu";
  if (up.includes("MESSAGE_SENT") || up.includes("SENT")) return "Message envoyé";
  if (up.includes("OPENED")) return "Email ouvert";
  const clean = raw.replace(/_/g, " ").toLowerCase().trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

type Resume = {
  total: number; nouveau: number; contacte: number; connecte: number; repondu: number; rdv: number;
  devis: number; client: number; perdu: number; ca_attribue: number;
};

export default function Prospection() {
  const { isAdmin, isDirection, canAccessProspection, isLoading, hasRestrictedAction } = useAuth();
  const canDetecter = hasRestrictedAction("prospection.detecter_signaux");
  const canPreparer = hasRestrictedAction("prospection.preparer");
  const canEnvoyerLgm = hasRestrictedAction("prospection.envoyer_lgm");
  const canImporterCsv = hasRestrictedAction("prospection.importer_csv");
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [resume, setResume] = useState<Resume | null>(null);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [lgmFilter, setLgmFilter] = useState<"all" | "loisirs" | "chr" | "retail" | "none">("all");
  // Filtres de travail du pipeline. Le filtre par secteur devient indispensable dès qu'un
  // segment prend le dessus en volume (1 100 campings noieraient les autres prospects).
  const [segmentFilter, setSegmentFilter] = useState<"all" | Segment>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [etoilesFilter, setEtoilesFilter] = useState<"all" | "5" | "4" | "3" | "none">("all");
  const [scoreFilter, setScoreFilter] = useState<"all" | "haute" | "moyenne" | "basse" | "none">("all");
  const [recherche, setRecherche] = useState("");
  const [contactFilter, setContactFilter] = useState<"all" | "email" | "tel" | "aucun">("all");

  const filtresActifs =
    segmentFilter !== "all" || tagFilter !== "all" || etoilesFilter !== "all" ||
    scoreFilter !== "all" || lgmFilter !== "all" || contactFilter !== "all" || recherche.trim() !== "";

  const reinitialiserFiltres = () => {
    setSegmentFilter("all"); setTagFilter("all");
    setEtoilesFilter("all"); setScoreFilter("all"); setLgmFilter("all");
    setContactFilter("all"); setRecherche("");
  };
  const [searchParams, setSearchParams] = useSearchParams();

  // Ouverture directe d'un prospect via /prospection?prospect=<id> (lien depuis la carte).
  const deepLinkId = searchParams.get("prospect");
  useEffect(() => {
    if (!deepLinkId || prospects.length === 0) return;
    const p = prospects.find((x) => x.id === deepLinkId);
    if (p) {
      setSelected(p);
      const next = new URLSearchParams(searchParams);
      next.delete("prospect");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, prospects]);

  const runDetection = useCallback(async () => {
    setDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("detecter-signaux-etablissements");
      if (error) throw error;
      const inserted = Number((data as any)?.inserted ?? 0);
      const note = (data as any)?.note as string | undefined;
      if (inserted > 0) {
        toast.success(`${inserted} nouveaux prospects détectés`, { description: note });
      } else {
        toast(`Aucun nouvel établissement détecté`, { description: note });
      }
      await load();
    } catch (e) {
      toast.error("Détection impossible", { description: (e as Error).message });
    } finally {
      setDetecting(false);
    }
  }, []);

  const runPreparation = useCallback(async () => {
    setPreparing(true);
    try {
      const { data, error } = await supabase.functions.invoke("preparer-prospects-agent", { body: {} });
      if (error) throw error;
      const prepared = Number((data as any)?.prepared ?? 0);
      const candidats = Number((data as any)?.candidats ?? 0);
      const errs = ((data as any)?.errors ?? []) as any[];
      if (prepared > 0) {
        toast.success(`${prepared} prospect(s) préparé(s)`, {
          description: errs.length ? `${errs.length} erreur(s) ignorée(s)` : `${candidats} candidat(s) analysés`,
        });
      } else if (candidats === 0) {
        toast("Aucun signal à préparer");
      } else {
        toast.error("Aucun prospect préparé", {
          description: errs[0]?.error ?? "Erreurs pendant la préparation",
        });
      }
      await load();
    } catch (e) {
      toast.error("Préparation impossible", { description: (e as Error).message });
    } finally {
      setPreparing(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows }, { data: r }] = await Promise.all([
      (supabase as any).from("prospects").select("*").order("updated_at", { ascending: false }),
      (supabase as any).rpc("get_prospection_resume"),
    ]);
    setProspects((rows as Prospect[]) ?? []);
    const first = Array.isArray(r) ? r[0] : r;
    setResume(first ? {
      total: num(first.total), nouveau: num(first.nouveau), contacte: num(first.contacte),
      connecte: num(first.connecte), repondu: num(first.repondu), rdv: num(first.rdv),
      devis: num(first.devis), client: num(first.client), perdu: num(first.perdu),
      ca_attribue: num(first.ca_attribue),
    } : null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!canAccessProspection) {
    return <Navigate to="/" replace />;
  }

  // Cibles réellement présentes en base : la liste s'adapte aux imports, sans être figée.
  const tagsDisponibles = useMemo(
    () =>
      Array.from(new Set(prospects.map((p) => p.tag).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b, "fr"),
      ),
    [prospects],
  );

  const filteredProspects = useMemo(() => {
    let list = prospects;
    if (lgmFilter === "none") list = list.filter((p) => !p.lgm_lead_id);
    else if (lgmFilter !== "all") {
      const target = `arcade os – ${lgmFilter}`;
      list = list.filter((p) => (p.lgm_audience ?? "").toLowerCase().includes(target));
    }
    if (segmentFilter !== "all") list = list.filter((p) => (p.segment ?? "autre") === segmentFilter);
    if (tagFilter !== "all") list = list.filter((p) => (p.tag ?? "") === tagFilter);
    if (etoilesFilter === "none") list = list.filter((p) => p.etoiles == null);
    else if (etoilesFilter !== "all") {
      // « 4 étoiles » se lit « 4 étoiles ET PLUS » : un 5 étoiles reste une meilleure cible.
      const mini = Number(etoilesFilter);
      list = list.filter((p) => (p.etoiles ?? 0) >= mini);
    }
    const q = recherche.trim();
    if (q) {
      // Insensible aux accents et à la casse : « chateau » doit trouver « Château ».
      const sansAccent = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const cible = sansAccent(q);
      list = list.filter((p) =>
        [p.entreprise, p.contact_nom, p.ville, p.groupe].some((v) => v && sansAccent(v).includes(cible)),
      );
    }
    if (contactFilter === "email") list = list.filter((p) => !!p.email);
    else if (contactFilter === "tel") list = list.filter((p) => !!p.telephone);
    else if (contactFilter === "aucun") list = list.filter((p) => !p.email && !p.telephone);
    if (scoreFilter !== "all") {
      list = list.filter((p) => {
        const sc = scorePriorite(p);
        // « sans score » = fiche non enrichie : ni étoiles ni capacité connues.
        if (scoreFilter === "none") return sc === null;
        return sc !== null && niveauScore(sc) === scoreFilter;
      });
    }
    return list;
  }, [prospects, lgmFilter, segmentFilter, tagFilter, etoilesFilter, scoreFilter, contactFilter, recherche]);

  const byStatut = useMemo(() => {
    const map = new Map<Statut, Prospect[]>();
    STATUTS.forEach((s) => map.set(s.key, []));
    const visible = new Set(STATUTS.map((s) => s.key));
    for (const p of filteredProspects) {
      // Statuts hors pipeline (client, perdu) : conservés en base
      // mais sortis du Kanban pour ne pas polluer la vue de reconquête active.
      if (!visible.has(p.statut as Statut)) continue;
      map.get(p.statut as Statut)!.push(p);
    }
    return map;
  }, [filteredProspects]);

  const moveStatut = async (id: string, newStatut: Statut) => {
    const p = prospects.find((x) => x.id === id);
    if (!p || p.statut === newStatut) return;
    const old = p.statut;
    // optimistic
    setProspects((list) => list.map((x) => x.id === id ? { ...x, statut: newStatut } : x));
    const { error } = await (supabase as any).from("prospects").update({ statut: newStatut }).eq("id", id);
    if (error) {
      setProspects((list) => list.map((x) => x.id === id ? { ...x, statut: old } : x));
      toast.error(error.message);
      return;
    }
    await (supabase as any).from("prospect_events").insert({
      prospect_id: id, type: "statut", ancien_statut: old, nouveau_statut: newStatut,
    });
    toast.success(`Statut → ${STATUT_LABELS[newStatut]}`);
    // refresh resume
    const { data: r } = await (supabase as any).rpc("get_prospection_resume");
    const first = Array.isArray(r) ? r[0] : r;
    if (first) setResume({
      total: num(first.total), nouveau: num(first.nouveau), contacte: num(first.contacte),
      connecte: num(first.connecte), repondu: num(first.repondu), rdv: num(first.rdv),
      devis: num(first.devis), client: num(first.client), perdu: num(first.perdu),
      ca_attribue: num(first.ca_attribue),
    });
  };

  const readyToSend = useMemo(
    () => prospects.filter((p) => p.pret_a_envoyer && !p.lgm_lead_id && LGM_SUPPORTED.includes(p.segment as Segment)),
    [prospects],
  );

  const bulkSendToLgm = useCallback(async () => {
    if (readyToSend.length === 0) return;
    setBulkSending(true);
    let ok = 0;
    const errs: string[] = [];
    for (const p of readyToSend) {
      try {
        const { data, error } = await supabase.functions.invoke("envoyer-vers-lgm", {
          body: { prospect_id: p.id },
        });
        if (error) {
          const t = (error as any)?.context?.text
            ? await (error as any).context.text().catch(() => "")
            : "";
          let msg = error.message || "Envoi impossible";
          try { const j = JSON.parse(t); if (j?.error) msg = j.error; } catch { /* noop */ }
          errs.push(`${p.entreprise} : ${msg}`);
          continue;
        }
        if ((data as any)?.error) { errs.push(`${p.entreprise} : ${(data as any).error}`); continue; }
        ok++;
      } catch (e) {
        errs.push(`${p.entreprise} : ${(e as Error).message}`);
      }
    }
    setBulkSending(false);
    if (ok > 0) toast.success(`${ok} prospect(s) envoyé(s) vers LGM`, {
      description: errs.length ? `${errs.length} erreur(s)` : undefined,
    });
    else toast.error("Aucun envoi réussi", { description: errs[0] });
    await load();
  }, [readyToSend, load]);


  const kpis = [
    { label: "Leads (total)", value: resume?.total ?? 0 },
    { label: "RDV", value: resume?.rdv ?? 0 },
    { label: "Devis", value: resume?.devis ?? 0 },
    { label: "Clients gagnés", value: resume?.client ?? 0 },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 backdrop-blur px-4 py-3"
        style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
      >
        <Target className="h-5 w-5" style={{ color: "hsl(var(--space-prospection))" }} />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-base sm:text-lg font-semibold truncate">Prospection</h1>
          <p className="text-xs text-muted-foreground truncate">CRM commercial — pipeline & suivi des leads</p>
        </div>
        {canDetecter && (
          <Button
            size="sm"
            variant="outline"
            onClick={runDetection}
            disabled={detecting}
            className="gap-2"
            title="Détecter les établissements récemment créés en France (30 jours)"
          >
            {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            <span className="hidden sm:inline">{detecting ? "Détection…" : "Détecter les signaux"}</span>
          </Button>
        )}
        {canPreparer && (
          <Button
            size="sm"
            variant="outline"
            onClick={runPreparation}
            disabled={preparing}
            className="gap-2"
            title="Enrichir et générer une accroche IA pour les signaux non préparés (agent semi-auto)"
          >
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="hidden sm:inline">{preparing ? "Préparation…" : "Préparer les nouveaux"}</span>
          </Button>
        )}
        {canEnvoyerLgm && readyToSend.length > 0 && (
          <Button
            size="sm"
            onClick={bulkSendToLgm}
            disabled={bulkSending}
            className="gap-2 bg-violet-600 hover:bg-violet-500 text-white"
            title={`${readyToSend.length} prospect(s) prêt(s) à envoyer vers LGM`}
          >
            {bulkSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {bulkSending ? "Envoi…" : `Envoyer les ${readyToSend.length} prêts vers LGM`}
            </span>
          </Button>
        )}
        {canImporterCsv && (
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Importer CSV</span>
          </Button>
        )}
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </header>
      {/* Barre de filtres sur sa propre ligne. Empilés dans le bandeau, les cinq
          sélecteurs formaient une colonne étroite qui écrasait le titre et les actions. */}
      <div className="hidden md:block border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Société, contact, ville…"
              className="h-9 w-[220px] pl-8 pr-7 text-xs"
            />
            {recherche && (
              <button
                type="button"
                onClick={() => setRecherche("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={segmentFilter} onValueChange={(v) => setSegmentFilter(v as typeof segmentFilter)}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Secteur : tous</SelectItem>
              {SEGMENTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {tagsDisponibles.length > 0 && (
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Cible : toutes</SelectItem>
                {tagsDisponibles.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={contactFilter} onValueChange={(v) => setContactFilter(v as typeof contactFilter)}>
            <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Contact : tous</SelectItem>
              <SelectItem value="email">✉️ Avec e-mail</SelectItem>
              <SelectItem value="tel">📞 Avec téléphone</SelectItem>
              <SelectItem value="aucun">Sans contact</SelectItem>
            </SelectContent>
          </Select>

          <Select value={scoreFilter} onValueChange={(v) => setScoreFilter(v as typeof scoreFilter)}>
            <SelectTrigger className="h-9 w-[165px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Priorité : toutes</SelectItem>
              <SelectItem value="haute">🟢 Haute (70+)</SelectItem>
              <SelectItem value="moyenne">🟠 Moyenne (45-69)</SelectItem>
              <SelectItem value="basse">⚪ Basse (&lt; 45)</SelectItem>
              <SelectItem value="none">Sans score</SelectItem>
            </SelectContent>
          </Select>

          <Select value={etoilesFilter} onValueChange={(v) => setEtoilesFilter(v as typeof etoilesFilter)}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Étoiles : toutes</SelectItem>
              <SelectItem value="5">5 étoiles</SelectItem>
              <SelectItem value="4">4 étoiles et plus</SelectItem>
              <SelectItem value="3">3 étoiles et plus</SelectItem>
              <SelectItem value="none">Sans classement</SelectItem>
            </SelectContent>
          </Select>

          <Select value={lgmFilter} onValueChange={(v) => setLgmFilter(v as typeof lgmFilter)}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Audience LGM : Toutes</SelectItem>
              <SelectItem value="loisirs">Audience : Loisirs</SelectItem>
              <SelectItem value="chr">Audience : CHR</SelectItem>
              <SelectItem value="retail">Audience : Retail</SelectItem>
              <SelectItem value="none">Non envoyés</SelectItem>
            </SelectContent>
          </Select>

          {filtresActifs && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1.5" onClick={reinitialiserFiltres}>
              <X className="h-3.5 w-3.5" /> Réinitialiser
            </Button>
          )}

          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">
              {filteredProspects.length.toLocaleString("fr-FR")}
            </span>
            {filtresActifs ? ` sur ${prospects.length.toLocaleString("fr-FR")} leads` : " leads"}
          </span>
        </div>
      </div>


      <main className="flex-1 p-4 space-y-4 min-w-0">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
              <div className="mt-1 font-display text-2xl font-semibold">{k.value}</div>
            </div>
          ))}
          <div
            className="rounded-lg border p-3"
            style={{
              borderColor: "hsl(var(--space-prospection) / 0.35)",
              background: "hsl(var(--space-prospection) / 0.08)",
            }}
          >
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "hsl(var(--space-prospection))" }}>
              CA attribué
            </div>
            <div className="mt-1 font-display text-2xl font-semibold">{eur(resume?.ca_attribue ?? 0)}</div>
          </div>
        </div>

        <AttributionPanel />


        {/* Kanban */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto sm:overflow-x-visible -mx-4 px-4 pb-4">
            <div className="flex gap-3 min-w-max sm:min-w-0 sm:w-full">

              {STATUTS.map((s) => {
                const items = byStatut.get(s.key) ?? [];
                return (
                  <KanbanColumn
                    key={s.key}
                    statut={s.key}
                    label={s.label}
                    color={STATUT_COLOR[s.key]}
                    items={items}
                    onDrop={moveStatut}
                    onOpen={(p) => setSelected(p)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </main>

      {selected && (
        <ProspectSheet
          key={selected.id}
          prospect={selected}
          onClose={() => setSelected(null)}
          onChange={(p) => {
            setSelected(p);
            setProspects((list) => list.map((x) => x.id === p.id ? p : x));
          }}
          onDeleted={(id) => {
            setProspects((list) => list.filter((x) => x.id !== id));
            setSelected(null);
            load();
          }}
        />
      )}

      <AddProspectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => { setAddOpen(false); load(); }}
      />

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => { setImportOpen(false); load(); }}
      />
    </div>
  );
}

/* -------------------- Kanban -------------------- */

function KanbanColumn({
  statut, label, color, items, onDrop, onOpen,
}: {
  statut: Statut;
  label: string;
  color: string;
  items: Prospect[];
  onDrop: (id: string, s: Statut) => void;
  onOpen: (p: Prospect) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const total = items.reduce((sum, p) => sum + num(p.montant_estime), 0);
  return (
    <div
      className={cn(
        "w-72 sm:w-auto sm:flex-1 sm:basis-0 sm:min-w-[180px] flex-shrink-0 rounded-lg border bg-card/50 flex flex-col",
        dragOver ? "border-primary bg-primary/5" : "border-border",
      )}

      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData("text/prospect-id");
        if (id) onDrop(id, statut);
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg"
        style={{ background: `${color.replace(")", " / 0.12)")}` }}
      >
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-sm font-semibold" style={{ color }}>{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
      </div>
      {total > 0 && (
        <div className="px-3 py-1 text-[11px] text-muted-foreground border-b border-border/60">
          Potentiel : {eur(total)}
        </div>
      )}
      <div className="flex-1 p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-260px)] overflow-y-auto overflow-x-hidden">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">Glissez ici</div>
        )}
        {items.map((p) => (
          <KanbanCard key={p.id} prospect={p} onOpen={() => onOpen(p)} />
        ))}
      </div>
    </div>
  );
}

// Score de priorisation d'un prospect, sur 100. Trois critères lisibles et défendables :
// le standing (étoiles), la taille de l'affaire (emplacements) et la joignabilité — un
// camping 5 étoiles de 500 emplacements avec un téléphone vaut mieux qu'un 2 étoiles muet.
// Volontairement calculé à l'affichage : la formule doit pouvoir évoluer sans migration.
const POINTS_ETOILES: Record<number, number> = { 5: 40, 4: 32, 3: 20, 2: 10, 1: 5 };

export function scorePriorite(p: { etoiles: number | null; capacite: number | null; telephone: string | null; email: string | null }): number | null {
  // Sans étoiles ni capacité, un score n'aurait aucun sens : mieux vaut ne rien afficher.
  if (p.etoiles == null && p.capacite == null) return null;
  const standing = p.etoiles != null ? (POINTS_ETOILES[p.etoiles] ?? 15) : 15;
  const taille = p.capacite != null ? Math.min(40, Math.round(p.capacite / 10)) : 0;
  const joignable = (p.telephone ? 12 : 0) + (p.email ? 8 : 0);
  return Math.min(100, standing + taille + joignable);
}

// Paliers de priorité définis À UN SEUL ENDROIT : le badge de la carte et le filtre du
// pipeline s'y réfèrent tous les deux, ils ne peuvent donc pas diverger.
type NiveauScore = "haute" | "moyenne" | "basse";

export function niveauScore(n: number): NiveauScore {
  if (n >= 70) return "haute";
  if (n >= 45) return "moyenne";
  return "basse";
}

const CLASSE_NIVEAU: Record<NiveauScore, string> = {
  haute: "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  moyenne: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  basse: "border-border bg-muted text-muted-foreground",
};

function classeScore(n: number): string {
  return CLASSE_NIVEAU[niveauScore(n)];
}

function KanbanCard({ prospect, onOpen }: { prospect: Prospect; onOpen: () => void }) {
  const seg = segmentMeta(prospect.segment);
  const liSearch = buildLinkedInSearch(prospect);
  const score = scorePriorite(prospect);
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/prospect-id", prospect.id)}
      onClick={onOpen}
      className="rounded-md border border-border bg-card hover:border-primary/50 hover:bg-card/80 transition-colors p-2.5 cursor-pointer group"
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{prospect.entreprise}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="truncate">
              {[prospect.contact_role, prospect.ville].filter(Boolean).join(" · ") || "—"}
            </span>
            {prospect.linkedin_url ? (
              /* Profil connu : le logo devient un accès direct, et vaut confirmation
                 que le contact a bien été identifié sur LinkedIn. */
              <a
                href={prospect.linkedin_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => ouvrirLienExterne(prospect.linkedin_url!, e)}
                title={`Voir le profil LinkedIn de ${prospect.contact_nom}`}
                className="flex-shrink-0 text-[#0A66C2] hover:text-[#0A66C2]/80"
              >
                <Linkedin className="h-3.5 w-3.5" />
              </a>
            ) : (
              liSearch && (
                /* Profil inconnu : on propose de le chercher, libellé explicite pour ne pas
                   confondre l'action avec l'information. */
                <a
                  href={liSearch.web}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => ouvrirLienExterne(liSearch.web, e)}
                  title={`Chercher ${prospect.contact_nom} sur le web (LinkedIn refuse les liens entrants)`}
                  className="flex-shrink-0 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40"
                >
                  <Search className="h-3 w-3" /> Chercher
                </a>
              )
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", seg.className)}>{seg.label}</Badge>
            {score != null && (
              <Badge
                variant="outline"
                className={cn("text-[10px] h-4 px-1.5 tabular-nums", classeScore(score))}
                title={`Priorité ${score}/100 — standing, capacité et joignabilité`}
              >
                {score}
              </Badge>
            )}
            {(prospect.email || prospect.telephone) && (
              /* Joignabilité : c'est ce qui décide si un commercial peut agir tout de suite. */
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 gap-1 border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                title={[prospect.email, prospect.telephone].filter(Boolean).join(" · ")}
              >
                {prospect.email && <Mail className="h-2.5 w-2.5" />}
                {prospect.telephone && <Phone className="h-2.5 w-2.5" />}
              </Badge>
            )}
            {prospect.etoiles != null && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                {"★".repeat(prospect.etoiles)}
              </Badge>
            )}
            {prospect.groupe && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-border text-muted-foreground max-w-[110px] truncate"
                title={`Rattaché à ${prospect.groupe}`}
              >
                {prospect.groupe}
              </Badge>
            )}
            {prospect.source === "signal" && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 gap-0.5 border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              >
                <Zap className="h-2.5 w-2.5" /> Signal
              </Badge>
            )}
            {prospect.lgm_lead_id && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 gap-0.5 border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-300 no-underline"
                style={{ textDecoration: "none" }}
                title={prospect.lgm_status ? `Statut LGM : ${formatLgmStatus(prospect.lgm_status)}` : "Envoyé vers LGM"}
              >
                <Send className="h-2.5 w-2.5" />
                LGM{prospect.lgm_status ? ` · ${formatLgmStatus(prospect.lgm_status)}` : ""}
              </Badge>
            )}
            {prospect.pret_a_envoyer && !prospect.lgm_lead_id && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 gap-0.5 border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                title="Enrichi + accroche IA prête, à valider"
              >
                <Zap className="h-2.5 w-2.5" /> Prêt à envoyer
              </Badge>
            )}
            {prospect.montant_estime ? (
              <span className="text-[11px] font-medium text-foreground/90">{eur(prospect.montant_estime)}</span>
            ) : null}
          </div>
          {prospect.pret_a_envoyer && !prospect.lgm_lead_id && prospect.accroche_defaut && (
            <div className="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-300/90 line-clamp-2">
              {prospect.accroche_defaut}
            </div>
          )}
          {prospect.signal && !(prospect.pret_a_envoyer && prospect.accroche_defaut) && (
            <div className="mt-1.5 text-[11px] text-muted-foreground line-clamp-2 italic">
              « {prospect.signal} »
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------- Detail Sheet -------------------- */

function ProspectSheet({
  prospect, onClose, onChange, onDeleted,
}: {
  prospect: Prospect;
  onClose: () => void;
  onChange: (p: Prospect) => void;
  onDeleted: (id: string) => void;
}) {
  const { hasRestrictedAction } = useAuth();
  const canEnvoyerLgm = hasRestrictedAction("prospection.envoyer_lgm");
  const [form, setForm] = useState<Prospect>(prospect);
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState<ProspectEvent[]>([]);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setForm(prospect); }, [prospect]);

  const loadEvents = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("prospect_events").select("*").eq("prospect_id", prospect.id)
      .order("created_at", { ascending: false });
    setEvents((data as ProspectEvent[]) ?? []);
  }, [prospect.id]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const set = <K extends keyof Prospect>(k: K, v: Prospect[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const payload: Partial<Prospect> = {
      entreprise: form.entreprise, contact_nom: form.contact_nom, contact_role: form.contact_role,
      ville: form.ville, segment: form.segment, source: form.source, statut: form.statut,
      signal: form.signal, linkedin_url: form.linkedin_url, email: form.email, telephone: form.telephone,
      montant_estime: form.montant_estime == null ? null : Number(form.montant_estime),
      code_client: form.code_client, notes: form.notes,
    };
    const { data, error } = await (supabase as any)
      .from("prospects").update(payload).eq("id", prospect.id).select("*").maybeSingle();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (form.statut !== prospect.statut) {
      await (supabase as any).from("prospect_events").insert({
        prospect_id: prospect.id, type: "statut",
        ancien_statut: prospect.statut, nouveau_statut: form.statut,
      });
    }
    toast.success("Prospect enregistré");
    if (data) onChange(data as Prospect);
    loadEvents();
  };

  const addNote = async () => {
    const c = note.trim();
    if (!c) return;
    const { error } = await (supabase as any).from("prospect_events").insert({
      prospect_id: prospect.id, type: "note", contenu: c,
    });
    if (error) { toast.error(error.message); return; }
    setNote("");
    loadEvents();
  };

  const del = async () => {
    const { error } = await (supabase as any).from("prospects").delete().eq("id", prospect.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Prospect supprimé");
    onDeleted(prospect.id);
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="truncate">{form.entreprise || "Prospect"}</SheetTitle>
          <SheetDescription>Détail, historique et actions</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <Field label="Entreprise *">
            <Input value={form.entreprise ?? ""} onChange={(e) => set("entreprise", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact"><Input value={form.contact_nom ?? ""} onChange={(e) => set("contact_nom", e.target.value)} /></Field>
            <Field label="Rôle"><Input value={form.contact_role ?? ""} onChange={(e) => set("contact_role", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ville"><Input value={form.ville ?? ""} onChange={(e) => set("ville", e.target.value)} /></Field>
            <Field label="Segment">
              <Select value={form.segment} onValueChange={(v) => set("segment", v as Segment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEGMENTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <Select value={form.source ?? ""} onValueChange={(v) => set("source", (v || null) as Source | null)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Statut">
              <Select value={form.statut} onValueChange={(v) => set("statut", v as Statut)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUT_LABELS) as Statut[]).map((k) => (
                    <SelectItem key={k} value={k}>{STATUT_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Signal (raison du contact)">
            <Textarea rows={2} value={form.signal ?? ""} onChange={(e) => set("signal", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <div className="flex gap-1">
                <Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
                {form.email && (
                  <Button type="button" variant="outline" size="icon" asChild>
                    <a href={`mailto:${form.email}`}><Mail className="h-4 w-4" /></a>
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Téléphone">
              <div className="flex gap-1">
                <Input value={form.telephone ?? ""} onChange={(e) => set("telephone", e.target.value)} />
                {form.telephone && (
                  <Button type="button" variant="outline" size="icon" asChild>
                    <a href={`tel:${form.telephone}`}><Phone className="h-4 w-4" /></a>
                  </Button>
                )}
              </div>
            </Field>
          </div>
          <Field label="LinkedIn">
            <div className="flex gap-1">
              <Input value={form.linkedin_url ?? ""} onChange={(e) => set("linkedin_url", e.target.value)} />
              {form.linkedin_url && (
                <Button type="button" variant="outline" size="icon" asChild>
                  <a href={form.linkedin_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                </Button>
              )}
            </div>
          </Field>
          {(() => {
            const s = buildLinkedInSearch(form);
            if (!s) return null;
            return (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  asChild
                  className="bg-[#0A66C2] hover:bg-[#0A66C2]/90 text-white"
                >
                  <a href={s.people} target="_blank" rel="noreferrer">
                    <Linkedin className="h-4 w-4 mr-1.5" /> Trouver sur LinkedIn
                  </a>
                </Button>
                <Button type="button" size="sm" variant="outline" asChild className="border-[#0A66C2]/40 text-[#0A66C2] hover:text-[#0A66C2]">
                  <a href={s.web} target="_blank" rel="noreferrer">
                    <Search className="h-4 w-4 mr-1.5" /> Recherche web
                  </a>
                </Button>
                <Button type="button" size="sm" variant="outline" asChild className="border-[#0A66C2]/40 text-[#0A66C2] hover:text-[#0A66C2]">
                  <a href={s.sales} target="_blank" rel="noreferrer">
                    <Linkedin className="h-4 w-4 mr-1.5" /> Sales Navigator
                  </a>
                </Button>
              </div>
            );
          })()}
          <Field label="Montant estimé (€)">
            <Input
              type="number"
              value={form.montant_estime ?? ""}
              onChange={(e) => set("montant_estime", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>

          <Field label="Notes internes">
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Supprimer
          </Button>
          <Button onClick={save} disabled={saving || !form.entreprise?.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Enregistrer
          </Button>
        </div>

        <CegidClientSection
          prospect={prospect}
          onChanged={(next) => { onChange(next); setForm(next); loadEvents(); }}
        />

        <AccrocheIASection prospect={prospect} onSaved={loadEvents} />

        <PappersEnrichSection prospect={prospect} onEnriched={(next) => { onChange(next); setForm(next); loadEvents(); }} />

        {canEnvoyerLgm && (
          <LgmSection prospect={prospect} onSent={(next) => { onChange(next); setForm(next); loadEvents(); }} />
        )}


        <div className="mt-8 space-y-3">
          <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Journal d'activité</div>
          <div className="flex gap-2">
            <Input placeholder="Ajouter une note…" value={note} onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} />
            <Button onClick={addNote} disabled={!note.trim()}>Ajouter</Button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {events.length === 0 && (
              <div className="text-xs text-muted-foreground italic">Aucun événement pour l'instant.</div>
            )}
            {events.map((e) => (
              <EventRow key={e.id} ev={e} />
            ))}
          </div>
        </div>

        <SheetFooter className="mt-4" />

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce prospect ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est définitive. L'historique associé sera aussi supprimé.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={del}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------- Accroche IA -------------------- */

type Canal = "invitation" | "message" | "email";

function AccrocheIASection({ prospect, onSaved }: { prospect: Prospect; onSaved: () => void }) {
  const [canal, setCanal] = useState<Canal>("message");
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generer-accroche-prospect", {
        body: { prospect_id: prospect.id, canal },
      });
      if (error) {
        const details = (error as any)?.context?.text
          ? await (error as any).context.text().catch(() => "")
          : "";
        let msg = error.message || "Erreur IA";
        try { const j = JSON.parse(details); if (j?.error) msg = j.error; } catch { /* noop */ }
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) { toast.error((data as any).error); return; }
      setText(((data as any)?.accroche ?? "").trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur IA");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Accroche copiée");
    } catch {
      toast.error("Impossible de copier");
    }
  };

  const saveToJournal = async () => {
    if (!text.trim()) return;
    setSaving(true);
    const { error } = await (supabase as any).from("prospect_events").insert({
      prospect_id: prospect.id, type: "message", contenu: text.trim(),
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Enregistré dans le journal");
    onSaved();
  };

  return (
    <div className="mt-6 rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[hsl(var(--space-prospection,258_90%_66%))]" />
        <div className="text-sm font-semibold">Accroche IA</div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Canal">
          <Select value={canal} onValueChange={(v) => setCanal(v as Canal)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="invitation">Invitation LinkedIn</SelectItem>
              <SelectItem value="message">Message LinkedIn</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Button onClick={generate} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          {loading ? "Génération…" : "Générer une accroche IA"}
        </Button>
      </div>
      {(text || loading) && (
        <>
          <Textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={loading ? "Génération…" : ""}
            disabled={loading}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" /> Régénérer
            </Button>
            <Button size="sm" variant="outline" onClick={copy} disabled={!text.trim()}>
              <Copy className="h-4 w-4 mr-1" /> Copier
            </Button>
            <Button size="sm" onClick={saveToJournal} disabled={!text.trim() || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Enregistrer dans le journal
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function EventRow({ ev }: { ev: ProspectEvent }) {
  const d = new Date(ev.created_at);
  const label =
    ev.type === "statut"
      ? `Statut : ${(STATUT_LABELS as any)[ev.ancien_statut ?? ""] ?? ev.ancien_statut} → ${(STATUT_LABELS as any)[ev.nouveau_statut ?? ""] ?? ev.nouveau_statut}`
      : (ev.contenu || ev.type);
  return (
    <div className="rounded border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="uppercase text-[10px] tracking-wider">{ev.type}</span>
        <span>·</span>
        <span>{d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
      </div>
      <div className="mt-0.5 text-foreground whitespace-pre-wrap">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/* -------------------- Add dialog -------------------- */

function AddProspectDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [entreprise, setEntreprise] = useState("");
  const [contact_nom, setContactNom] = useState("");
  const [contact_role, setContactRole] = useState("");
  const [ville, setVille] = useState("");
  const [segment, setSegment] = useState<Segment>("autre");
  const [source, setSource] = useState<Source>("linkedin");
  const [signal, setSignal] = useState("");
  const [email, setEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [montant, setMontant] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEntreprise(""); setContactNom(""); setContactRole(""); setVille("");
    setSegment("autre"); setSource("linkedin"); setSignal("");
    setEmail(""); setTelephone(""); setLinkedin(""); setMontant("");
  };

  const create = async () => {
    if (!entreprise.trim()) { toast.error("L'entreprise est requise"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("prospects").insert({
      entreprise: entreprise.trim(),
      contact_nom: contact_nom.trim() || null,
      contact_role: contact_role.trim() || null,
      ville: ville.trim() || null,
      segment, source,
      signal: signal.trim() || null,
      email: email.trim() || null,
      telephone: telephone.trim() || null,
      linkedin_url: linkedin.trim() || null,
      montant_estime: montant ? Number(montant) : null,
      statut: "nouveau",
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Prospect ajouté");
    reset();
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau prospect</DialogTitle>
          <DialogDescription>Statut initial : Nouveau.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Entreprise *"><Input value={entreprise} onChange={(e) => setEntreprise(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact"><Input value={contact_nom} onChange={(e) => setContactNom(e.target.value)} /></Field>
            <Field label="Rôle"><Input value={contact_role} onChange={(e) => setContactRole(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ville"><Input value={ville} onChange={(e) => setVille(e.target.value)} /></Field>
            <Field label="Segment">
              <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEGMENTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Montant estimé (€)">
              <Input type="number" value={montant} onChange={(e) => setMontant(e.target.value)} />
            </Field>
          </div>
          <Field label="Signal"><Textarea rows={2} value={signal} onChange={(e) => setSignal(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Téléphone"><Input value={telephone} onChange={(e) => setTelephone(e.target.value)} /></Field>
          </div>
          <Field label="LinkedIn"><Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={create} disabled={saving || !entreprise.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------- CSV import -------------------- */

const CSV_FIELDS: { key: keyof Prospect; label: string }[] = [
  { key: "entreprise", label: "Entreprise *" },
  { key: "contact_nom", label: "Contact" },
  { key: "contact_role", label: "Rôle" },
  { key: "ville", label: "Ville" },
  { key: "segment", label: "Segment" },
  { key: "email", label: "Email" },
  { key: "telephone", label: "Téléphone" },
  { key: "linkedin_url", label: "LinkedIn" },
  { key: "signal", label: "Signal" },
];

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === delim && !inQ) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function ImportCsvDialog({
  open, onOpenChange, onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  const reset = () => { setCsv(null); setMapping({}); };

  const onFile = async (f: File) => {
    const text = await f.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0) { toast.error("CSV vide"); return; }
    // auto-map by name
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    const auto: Record<string, string> = {};
    for (const f of CSV_FIELDS) {
      const target = norm(String(f.key));
      const found = parsed.headers.find((h) => norm(h) === target || norm(h).includes(target) || target.includes(norm(h)));
      if (found) auto[f.key] = found;
    }
    setCsv(parsed);
    setMapping(auto);
  };

  const doImport = async () => {
    if (!csv) return;
    const entrepriseCol = mapping.entreprise;
    if (!entrepriseCol) { toast.error("Mappe au moins la colonne Entreprise"); return; }
    const idx = (h: string | undefined) => (h ? csv.headers.indexOf(h) : -1);
    const idxs = Object.fromEntries(CSV_FIELDS.map((f) => [f.key, idx(mapping[f.key])])) as Record<string, number>;
    const rows = csv.rows
      .map((r) => {
        const get = (k: string) => (idxs[k] >= 0 ? (r[idxs[k]] || "").trim() : "");
        const entreprise = get("entreprise");
        if (!entreprise) return null;
        const segRaw = get("segment").toLowerCase();
        const segment = SEGMENTS.find((s) => s.key === segRaw)?.key ?? "autre";
        return {
          entreprise,
          contact_nom: get("contact_nom") || null,
          contact_role: get("contact_role") || null,
          ville: get("ville") || null,
          segment,
          email: get("email") || null,
          telephone: get("telephone") || null,
          linkedin_url: get("linkedin_url") || null,
          signal: get("signal") || null,
          statut: "nouveau",
        };
      })
      .filter(Boolean);
    if (rows.length === 0) { toast.error("Aucune ligne valide"); return; }
    setImporting(true);
    const { data: inserted, error } = await (supabase as any).rpc("import_prospects_csv", { _rows: rows });
    setImporting(false);
    if (error) { toast.error(error.message); return; }
    const n = Number(inserted ?? rows.length);
    toast.success(`${n} prospect${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""}`);
    reset();
    onImported();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer des prospects (CSV)</DialogTitle>
          <DialogDescription>
            Charge un fichier CSV et associe ses colonnes aux champs des prospects.
            La colonne <strong>Entreprise</strong> est obligatoire.
          </DialogDescription>
        </DialogHeader>

        {!csv ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center">
            <Input
              type="file" accept=".csv,text/csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Format attendu : première ligne = en-têtes. Séparateur ; ou ,.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {csv.rows.length} ligne{csv.rows.length > 1 ? "s" : ""} détectée{csv.rows.length > 1 ? "s" : ""} · {csv.headers.length} colonne{csv.headers.length > 1 ? "s" : ""}.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
              {CSV_FIELDS.map((f) => (
                <div key={String(f.key)} className="flex items-center gap-2">
                  <div className="w-32 text-xs text-muted-foreground">{f.label}</div>
                  <Select
                    value={mapping[f.key] ?? "__none__"}
                    onValueChange={(v) => setMapping((m) => {
                      const next = { ...m };
                      if (v === "__none__") delete next[f.key]; else next[f.key] = v;
                      return next;
                    })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Ignorer —</SelectItem>
                      {csv.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {csv && (
            <Button variant="ghost" onClick={reset}>Choisir un autre fichier</Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={doImport} disabled={!csv || importing || !mapping.entreprise}>
            {importing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Importer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------- Cegid client link (Phase 3) -------------------- */

type CegidSearchRow = { customer_id: string; name: string | null; typologie: string | null; ca_12m: number | null };
type ProspectCa = { ca_total: number | null; ca_12m: number | null; nb_factures: number | null; premiere: string | null; derniere: string | null };

function CegidClientSection({
  prospect, onChanged,
}: {
  prospect: Prospect;
  onChanged: (p: Prospect) => void;
}) {
  const linked = !!prospect.code_client?.trim();
  return (
    <div className="mt-6 rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-[hsl(var(--space-prospection,258_90%_66%))]" />
        <div className="text-sm font-semibold">Client Cegid & CA généré</div>
      </div>
      {linked
        ? <LinkedClientView prospect={prospect} onChanged={onChanged} />
        : <SearchClientView prospect={prospect} onChanged={onChanged} />}
    </div>
  );
}

function SearchClientView({
  prospect, onChanged,
}: {
  prospect: Prospect;
  onChanged: (p: Prospect) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CegidSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [alsoClient, setAlsoClient] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("search_clients_prospection", { _q: term });
      if (!error) setRows((data as CegidSearchRow[]) ?? []);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const linkTo = async (row: CegidSearchRow) => {
    setLinking(row.customer_id);
    const payload: Partial<Prospect> = { code_client: row.customer_id };
    if (alsoClient) payload.statut = "client";
    const { data, error } = await (supabase as any)
      .from("prospects").update(payload).eq("id", prospect.id).select("*").maybeSingle();
    if (!error && alsoClient) {
      await (supabase as any).from("prospect_events").insert({
        prospect_id: prospect.id, type: "statut",
        ancien_statut: prospect.statut, nouveau_statut: "client",
      });
    }
    setLinking(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Client Cegid lié");
    if (data) onChanged(data as Prospect);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        Ce prospect n'est pas encore relié à un compte client Cegid.
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Rechercher un client Cegid (nom ou code)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input type="checkbox" checked={alsoClient} onChange={(e) => setAlsoClient(e.target.checked)} />
        Passer le statut à « Client » lors du lien
      </label>
      {q.trim().length >= 2 && (
        <div className="rounded-md border border-border bg-background max-h-64 overflow-y-auto">
          {searching && (
            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recherche…
            </div>
          )}
          {!searching && rows.length === 0 && (
            <div className="p-2 text-xs text-muted-foreground italic">Aucun résultat.</div>
          )}
          {!searching && rows.map((r) => (
            <button
              key={r.customer_id}
              type="button"
              onClick={() => linkTo(r)}
              disabled={linking === r.customer_id}
              className="w-full text-left px-2 py-1.5 hover:bg-muted/60 transition-colors border-b border-border/40 last:border-b-0 flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.name || r.customer_id}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {r.customer_id}{r.typologie ? ` · ${r.typologie}` : ""}
                </div>
              </div>
              <div className="text-xs font-medium tabular-nums whitespace-nowrap">
                {eur(r.ca_12m ?? 0)} <span className="text-muted-foreground font-normal">/ 12 m</span>
              </div>
              {linking === r.customer_id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkedClientView({
  prospect, onChanged,
}: {
  prospect: Prospect;
  onChanged: (p: Prospect) => void;
}) {
  const code = prospect.code_client!;
  const [ca, setCa] = useState<ProspectCa | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlinking, setUnlinking] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data } = await (supabase as any).rpc("get_prospect_ca", { _code_client: code });
      const first = Array.isArray(data) ? data[0] : data;
      if (active) { setCa((first as ProspectCa) ?? null); setLoading(false); }
    })();
    return () => { active = false; };
  }, [code]);

  const unlink = async () => {
    setUnlinking(true);
    const { data, error } = await (supabase as any)
      .from("prospects").update({ code_client: null }).eq("id", prospect.id).select("*").maybeSingle();
    setUnlinking(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Lien retiré");
    if (data) onChanged(data as Prospect);
  };

  const fmtDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString("fr-FR") : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Lié au client</div>
          <div className="text-sm font-medium truncate">{code}</div>
        </div>
        <Button size="sm" variant="outline" onClick={unlink} disabled={unlinking}>
          {unlinking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2Off className="h-4 w-4 mr-1" />}
          Délier
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement du CA…
        </div>
      ) : (
        <>
          <div
            className="rounded-md border p-3"
            style={{
              borderColor: "hsl(var(--space-prospection) / 0.35)",
              background: "hsl(var(--space-prospection) / 0.08)",
            }}
          >
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "hsl(var(--space-prospection))" }}>
              CA 12 mois
            </div>
            <div className="mt-1 font-display text-3xl font-semibold">{eur(ca?.ca_12m ?? 0)}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="CA total" value={eur(ca?.ca_total ?? 0)} />
            <MiniStat label="Factures" value={String(num(ca?.nb_factures))} />
            <MiniStat label="Dernière" value={fmtDate(ca?.derniere)} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Première facture : {fmtDate(ca?.premiere)}
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold truncate">{value}</div>
    </div>
  );
}

/* -------------------- Attribution / ROI panel (Phase 3) -------------------- */

type AttributionRow = { dimension: "segment" | "source" | string; valeur: string | null; nb_clients: number | null; ca_attribue: number | null };

function AttributionPanel() {
  const [rows, setRows] = useState<AttributionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await (supabase as any).rpc("get_prospection_attribution");
      if (!active) return;
      if (error) { setRows([]); setLoading(false); return; }
      setRows((data as AttributionRow[]) ?? []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const segments = rows.filter((r) => r.dimension === "segment")
    .sort((a, b) => num(b.ca_attribue) - num(a.ca_attribue));
  const sources = rows.filter((r) => r.dimension === "source")
    .sort((a, b) => num(b.ca_attribue) - num(a.ca_attribue));

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4" style={{ color: "hsl(var(--space-prospection))" }} />
        <div className="text-sm font-semibold">Attribution / ROI</div>
        <div className="text-xs text-muted-foreground">— CA réel généré par les prospects gagnés</div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-4 text-xs text-muted-foreground italic">
          Aucune attribution pour l'instant. Liez des prospects « Client » à leur compte Cegid pour alimenter cette vue.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <AttributionList title="CA attribué par segment" rows={segments} labelize={(v) => segmentMeta(v).label} />
          <AttributionList title="CA attribué par source" rows={sources} labelize={(v) => SOURCES.find((s) => s.key === v)?.label ?? v ?? "—"} />
        </div>
      )}
    </div>
  );
}

function AttributionList({
  title, rows, labelize,
}: {
  title: string;
  rows: AttributionRow[];
  labelize: (v: string | null) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => num(r.ca_attribue)));
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">Aucune donnée.</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => {
            const ca = num(r.ca_attribue);
            const pct = Math.round((ca / max) * 100);
            return (
              <li key={`${r.dimension}-${r.valeur ?? "-"}-${i}`} className="space-y-0.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-medium truncate">{labelize(r.valeur)}</span>
                  <span className="text-muted-foreground">· {num(r.nb_clients)} client{num(r.nb_clients) > 1 ? "s" : ""}</span>
                  <span className="ml-auto font-semibold tabular-nums">{eur(ca)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: "hsl(var(--space-prospection))" }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


/* -------------------- LGM (La Growth Machine) -------------------- */

const LGM_SUPPORTED: Segment[] = ["camping", "loisirs", "chr", "retail"];

function LgmSection({
  prospect, onSent,
}: {
  prospect: Prospect;
  onSent: (p: Prospect) => void;
}) {
  const [sending, setSending] = useState(false);
  const alreadySent = !!prospect.lgm_lead_id;
  const segmentOk = LGM_SUPPORTED.includes(prospect.segment as Segment);

  const send = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("envoyer-vers-lgm", {
        body: { prospect_id: prospect.id },
      });
      if (error) {
        const details = (error as any)?.context?.text
          ? await (error as any).context.text().catch(() => "")
          : "";
        let msg = error.message || "Envoi impossible";
        try { const j = JSON.parse(details); if (j?.error) msg = j.error; } catch { /* noop */ }
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) { toast.error((data as any).error); return; }
      const audience = (data as any)?.audience ?? "LGM";
      toast.success(`Envoyé vers l'audience ${audience}`);
      // Recharger le prospect à jour
      const { data: refreshed } = await (supabase as any)
        .from("prospects").select("*").eq("id", prospect.id).maybeSingle();
      if (refreshed) onSent(refreshed as Prospect);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-[hsl(var(--space-prospection,258_90%_66%))]" />
        <div className="text-sm font-semibold">La Growth Machine</div>
      </div>

      {!segmentOk ? (
        <div className="text-xs text-muted-foreground italic">
          Segment « {segmentMeta(prospect.segment).label} » non supporté par LGM.
          Passe le segment à Loisirs, CHR ou Retail pour envoyer ce prospect.
        </div>
      ) : alreadySent ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Déjà dans LGM –{" "}
            <span className="font-medium text-foreground">{prospect.lgm_audience}</span>
            {prospect.lgm_sent_at && (
              <> · envoyé le {new Date(prospect.lgm_sent_at).toLocaleDateString("fr-FR")}</>
            )}
            {prospect.lgm_status && <> · statut : {prospect.lgm_status}</>}
          </div>
          <Button size="sm" variant="outline" onClick={send} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Renvoyer vers LGM
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {prospect.pret_a_envoyer && prospect.accroche_defaut && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs whitespace-pre-wrap">
              <div className="flex items-center gap-1 mb-1 text-emerald-600 dark:text-emerald-300 font-medium">
                <Zap className="h-3 w-3" /> Accroche préparée par l'agent
              </div>
              {prospect.accroche_defaut}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Envoie ce prospect vers l'audience LGM « Arcade OS – {segmentMeta(prospect.segment).label} ».
            La dernière accroche IA enregistrée sera transmise en attribut personnalisé.
          </div>
          <Button
            size="sm"
            onClick={send}
            disabled={sending}
            className={prospect.pret_a_envoyer ? "bg-emerald-600 hover:bg-emerald-500 text-white" : undefined}
          >
            {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            {sending
              ? "Envoi…"
              : prospect.pret_a_envoyer
              ? "Valider & envoyer vers LGM"
              : "Envoyer vers LGM"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------- Enrichissement entreprise (API gouv) -------------------- */

function fmtEuros(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n));
}

function PappersEnrichSection({
  prospect, onEnriched,
}: {
  prospect: Prospect;
  onEnriched: (p: Prospect) => void;
}) {
  const [loading, setLoading] = useState(false);
  const hasAny =
    prospect.siren || prospect.siret || prospect.adresse || prospect.effectif ||
    prospect.ca_annuel != null || prospect.activite || prospect.site_web ||
    prospect.contact_nom || prospect.contact_role;

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrichir-prospect", {
        body: { prospect_id: prospect.id },
      });
      if (error) {
        const details = (error as any)?.context?.text
          ? await (error as any).context.text().catch(() => "")
          : "";
        let msg = error.message || "Enrichissement impossible";
        try { const j = JSON.parse(details); if (j?.error) msg = j.error; } catch { /* noop */ }
        toast.error(msg);
        return;
      }
      if ((data as any)?.error) { toast.error((data as any).error); return; }
      toast.success("Fiche enrichie");
      const { data: refreshed } = await (supabase as any)
        .from("prospects").select("*").eq("id", prospect.id).maybeSingle();
      if (refreshed) onEnriched(refreshed as Prospect);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrichissement impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <div className="text-sm font-semibold">Enrichissement entreprise (API gouv)</div>
        </div>
        <Button size="sm" variant={hasAny ? "outline" : "default"} onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loading ? "Enrichissement…" : hasAny ? "Ré-enrichir" : "Enrichir"}
        </Button>
      </div>

      {hasAny ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {(prospect.contact_nom || prospect.contact_role) && (
            <div className="col-span-2">
              <div className="text-muted-foreground">Dirigeant</div>
              <div className="font-medium text-foreground">
                {prospect.contact_nom ?? "—"}
                {prospect.contact_role && <span className="text-muted-foreground"> · {prospect.contact_role}</span>}
              </div>
            </div>
          )}
          {prospect.siren && (
            <div><div className="text-muted-foreground">SIREN</div><div className="font-mono">{prospect.siren}</div></div>
          )}
          {prospect.siret && (
            <div><div className="text-muted-foreground">SIRET siège</div><div className="font-mono">{prospect.siret}</div></div>
          )}
          {prospect.adresse && (
            <div className="col-span-2"><div className="text-muted-foreground">Adresse</div><div>{prospect.adresse}</div></div>
          )}
          {prospect.effectif && (
            <div><div className="text-muted-foreground">Effectif</div><div>{prospect.effectif}</div></div>
          )}
          {prospect.ca_annuel != null && (
            <div><div className="text-muted-foreground">CA annuel</div><div className="font-medium">{fmtEuros(prospect.ca_annuel)}</div></div>
          )}
          {prospect.activite && (
            <div className="col-span-2"><div className="text-muted-foreground">Activité</div><div>{prospect.activite}</div></div>
          )}
          {prospect.telephone && (
            <div>
              <div className="text-muted-foreground">Téléphone</div>
              <a className="underline underline-offset-2" href={`tel:${prospect.telephone}`}>{prospect.telephone}</a>
            </div>
          )}
          {prospect.site_web && (
            <div className="col-span-2">
              <div className="text-muted-foreground">Site web</div>
              <a
                className="inline-flex items-center gap-1 underline underline-offset-2 break-all"
                href={/^https?:\/\//.test(prospect.site_web) ? prospect.site_web : `https://${prospect.site_web}`}
                target="_blank" rel="noreferrer"
              >
                {prospect.site_web} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">
          Récupère automatiquement dirigeant, SIRET, adresse, effectif, CA, activité et état administratif depuis l’API publique recherche-entreprises (gratuite).
        </div>
      )}
    </div>
  );
}

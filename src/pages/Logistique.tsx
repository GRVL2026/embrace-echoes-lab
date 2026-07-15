import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isValid, isSameMonth, addMonths, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Truck, Plus, Search, Loader2, Ship, Ship as ShipIcon, Anchor, Package,
  Home, Trash2, Pencil, X, Calendar as CalendarIcon, CheckCircle2, CircleDot,
  Upload, AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import logoImg from "@/assets/logo.png";

type Statut = "livre" | "en_cours" | "en_mer" | "a_venir" | "en_attente" | "dispo";
type Origine = "ASIE" | "US" | "EUROPE";
type Item = { produit: string; quantite: number };

const STATUTS: Statut[] = ["a_venir", "en_attente", "dispo", "en_cours", "en_mer", "livre"];

const STATUT_META: Record<Statut, { label: string; className: string; dot: string }> = {
  livre:      { label: "Livré",       className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400" },
  en_cours:   { label: "En cours",    className: "border-blue-500/40 bg-blue-500/10 text-blue-300",         dot: "bg-blue-400" },
  en_mer:     { label: "En mer",      className: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",         dot: "bg-cyan-400" },
  a_venir:    { label: "À venir",     className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground/60" },
  en_attente: { label: "En attente",  className: "border-amber-500/40 bg-amber-500/10 text-amber-300",       dot: "bg-amber-400" },
  dispo:      { label: "Dispo",       className: "border-primary/40 bg-primary/10 text-primary",             dot: "bg-primary" },
};

type Expedition = {
  id: string;
  numero_commande: string;
  origine: Origine | null;
  fournisseur: string;
  items: Item[];
  date_dispo_fournisseur: string | null;
  port_depart: string | null;
  etd: string | null;
  eta_le_havre: string | null;
  livraison_aa: string | null;
  heure: string | null;
  transitaire: string | null;
  numero_dossier: string | null;
  docs_transmis: boolean;
  type_conteneur: string | null;
  numero_conteneur: string | null;
  nom_navire: string | null;
  monnayeurs: string | null;
  remarques: string | null;
  cout_fret: number | null;
  cout_exw: number | null;
  statut: Statut;
  created_at: string;
  updated_at: string;
};

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = parseISO(d);
  return isValid(dt) ? format(dt, "d MMM yyyy", { locale: fr }) : "—";
};
const fmtDateShort = (d: string | null) => {
  if (!d) return "—";
  const dt = parseISO(d);
  return isValid(dt) ? format(dt, "d MMM", { locale: fr }) : "—";
};
const fmtMoney = (v: number | null) => {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
};

/* ============================================================= */

export default function Logistique() {
  const { isAdmin, isLoading } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState<Statut | "all">("all");
  const [origineFilter, setOrigineFilter] = useState<Origine | "all">("all");
  const [fournisseurFilter, setFournisseurFilter] = useState<string>("all");
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Expedition | null>(null);

  const { data: expeditions = [], isLoading: loadingList } = useQuery({
    queryKey: ["logi_expeditions"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("logi_expeditions")
        .select("*")
        .order("eta_le_havre", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, items: Array.isArray(r.items) ? r.items : [] })) as Expedition[];
    },
  });

  const fournisseurs = useMemo(
    () => Array.from(new Set(expeditions.map((e) => e.fournisseur).filter(Boolean))).sort(),
    [expeditions]
  );

  const filtered = useMemo(() => {
    return expeditions.filter((e) => {
      if (statutFilter !== "all" && e.statut !== statutFilter) return false;
      if (origineFilter !== "all" && e.origine !== origineFilter) return false;
      if (fournisseurFilter !== "all" && e.fournisseur !== fournisseurFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return [e.numero_commande, e.numero_conteneur, e.nom_navire, e.fournisseur, e.numero_dossier]
          .some((v) => v?.toLowerCase().includes(q));
      }
      return true;
    });
  }, [expeditions, search, statutFilter, origineFilter, fournisseurFilter]);

  const stats = useMemo(() => {
    const now = new Date();
    let enMer = 0, enCours = 0, aVenir = 0, livreesMois = 0, valeurEXW = 0;
    for (const e of expeditions) {
      if (e.statut === "en_mer") enMer++;
      if (e.statut === "en_cours") enCours++;
      if (e.statut === "a_venir") aVenir++;
      if (e.statut === "livre" && e.livraison_aa) {
        const d = parseISO(e.livraison_aa);
        if (isValid(d) && isSameMonth(d, now)) livreesMois++;
      }
      if (e.statut !== "livre") valeurEXW += Number(e.cout_exw ?? 0);
    }
    return { enMer, enCours, aVenir, livreesMois, valeurEXW };
  }, [expeditions]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;

  const openCreate = () => { setEditing(null); setOpenForm(true); };
  const openEdit = (e: Expedition) => { setEditing(e); setOpenForm(true); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS" className="h-7 w-auto object-contain flex-shrink-0" />
            <div className="hidden sm:block h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              <h1 className="font-display text-sm sm:text-base font-semibold truncate">Logistique</h1>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to="/"><Home className="h-4 w-4 mr-1" /> Hub</Link>
          </Button>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-6 space-y-6">
        {/* Stats */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard icon={Anchor} label="En mer" value={stats.enMer} tone="cyan" />
          <StatCard icon={Package} label="En cours" value={stats.enCours} tone="blue" />
          <StatCard icon={CircleDot} label="À venir" value={stats.aVenir} tone="muted" />
          <StatCard icon={CheckCircle2} label="Livrées ce mois" value={stats.livreesMois} tone="emerald" />
          <StatCard icon={Ship} label="Valeur EXW en cours" value={fmtMoney(stats.valeurEXW)} tone="primary" />
        </section>

        {/* Timeline */}
        <Timeline expeditions={expeditions} onSelect={openEdit} />

        {/* Toolbar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° commande, conteneur, navire, dossier…"
              className="pl-9"
            />
          </div>
          <Select value={statutFilter} onValueChange={(v) => setStatutFilter(v as any)}>
            <SelectTrigger className="md:w-44"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              {STATUTS.map((s) => <SelectItem key={s} value={s}>{STATUT_META[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={origineFilter} onValueChange={(v) => setOrigineFilter(v as any)}>
            <SelectTrigger className="md:w-36"><SelectValue placeholder="Origine" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Origines</SelectItem>
              <SelectItem value="ASIE">ASIE</SelectItem>
              <SelectItem value="US">US</SelectItem>
            </SelectContent>
          </Select>
          <Select value={fournisseurFilter} onValueChange={setFournisseurFilter}>
            <SelectTrigger className="md:w-52"><SelectValue placeholder="Fournisseur" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous fournisseurs</SelectItem>
              {fournisseurs.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openCreate} className="gap-1"><Plus className="h-4 w-4" /> Nouvelle</Button>
        </div>

        {/* Liste */}
        <section className="rounded-lg border border-border bg-card/40 overflow-hidden">
          {loadingList ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <Truck className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {expeditions.length === 0 ? "Aucune expédition. Crée-en une pour commencer." : "Aucun résultat pour ces filtres."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((e) => <ExpeditionRow key={e.id} e={e} onClick={() => openEdit(e)} />)}
            </div>
          )}
        </section>
      </main>

      <ExpeditionDialog
        open={openForm}
        onOpenChange={setOpenForm}
        initial={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["logi_expeditions"] })}
      />
    </div>
  );
}

/* ============================================================= */

function StatCard({
  icon: Icon, label, value, tone,
}: { icon: any; label: string; value: string | number; tone: "primary" | "cyan" | "blue" | "emerald" | "muted" }) {
  const toneCls =
    tone === "primary"  ? "text-primary bg-primary/10 border-primary/30" :
    tone === "cyan"     ? "text-cyan-300 bg-cyan-500/10 border-cyan-500/30" :
    tone === "blue"     ? "text-blue-300 bg-blue-500/10 border-blue-500/30" :
    tone === "emerald"  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" :
    "text-muted-foreground bg-muted/40 border-border";
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${toneCls}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

/* ============================================================= */

function ExpeditionRow({ e, onClick }: { e: Expedition; onClick: () => void }) {
  const eta = e.eta_le_havre ? parseISO(e.eta_le_havre) : null;
  const isLate = eta && isValid(eta) && !["livre"].includes(e.statut) && differenceInCalendarDays(eta, new Date()) < 0;
  const qte = e.items.reduce((sum, it) => sum + (Number(it.quantite) || 0), 0);
  return (
    <button onClick={onClick} className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-center gap-3">
      <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${STATUT_META[e.statut].dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{e.numero_commande}</span>
          {e.origine && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-border">
              {e.origine}
            </Badge>
          )}
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${STATUT_META[e.statut].className}`}>
            {STATUT_META[e.statut].label}
          </Badge>
          {isLate && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-destructive/40 bg-destructive/10 text-destructive">
              Retard
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {e.fournisseur}
          {e.nom_navire ? ` · ${e.nom_navire}` : ""}
          {e.numero_conteneur ? ` · ${e.numero_conteneur}` : ""}
          {qte ? ` · ${qte} article${qte > 1 ? "s" : ""}` : ""}
        </div>
      </div>
      <div className="hidden md:block text-right shrink-0 w-24">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ETA Havre</div>
        <div className={`text-sm ${isLate ? "text-destructive" : ""}`}>{fmtDateShort(e.eta_le_havre)}</div>
      </div>
      <div className="hidden lg:block text-right shrink-0 w-24">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Livr. AA</div>
        <div className="text-sm">{fmtDateShort(e.livraison_aa)}</div>
      </div>
      <div className="hidden lg:block text-right shrink-0 w-24">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">EXW</div>
        <div className="text-sm">{fmtMoney(e.cout_exw)}</div>
      </div>
    </button>
  );
}

/* ============================================================= */

function Timeline({ expeditions, onSelect }: { expeditions: Expedition[]; onSelect: (e: Expedition) => void }) {
  const start = startOfMonth(new Date());
  const end = endOfMonth(addMonths(start, 2));
  const events = useMemo(() => {
    const evts: Array<{ e: Expedition; date: Date; kind: "eta" | "livr" }> = [];
    for (const e of expeditions) {
      if (e.eta_le_havre) {
        const d = parseISO(e.eta_le_havre);
        if (isValid(d) && d >= start && d <= end) evts.push({ e, date: d, kind: "eta" });
      }
      if (e.livraison_aa) {
        const d = parseISO(e.livraison_aa);
        if (isValid(d) && d >= start && d <= end) evts.push({ e, date: d, kind: "livr" });
      }
    }
    return evts.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [expeditions, start, end]);

  const months = [start, addMonths(start, 1), addMonths(start, 2)];
  const total = end.getTime() - start.getTime();

  return (
    <section className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarIcon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Timeline conteneurs — 3 prochains mois</h2>
      </div>

      <div className="relative">
        <div className="grid grid-cols-3 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          {months.map((m) => (
            <div key={m.toISOString()} className="border-l border-border/50 pl-2 first:border-l-0 first:pl-0">
              {format(m, "MMMM yyyy", { locale: fr })}
            </div>
          ))}
        </div>

        <div className="relative h-24 rounded-md border border-border bg-background/40 overflow-hidden">
          <div className="absolute inset-0 grid grid-cols-3 pointer-events-none">
            {months.map((m, i) => (
              <div key={i} className="border-l border-border/40 first:border-l-0" />
            ))}
          </div>

          {events.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              Aucun événement sur les 3 prochains mois.
            </div>
          )}

          {events.map(({ e, date, kind }, idx) => {
            const pct = ((date.getTime() - start.getTime()) / total) * 100;
            const top = kind === "eta" ? "top-2" : "top-12";
            const color = kind === "eta"
              ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-200"
              : "border-emerald-500/60 bg-emerald-500/20 text-emerald-200";
            return (
              <button
                key={`${e.id}-${kind}-${idx}`}
                onClick={() => onSelect(e)}
                style={{ left: `calc(${pct}% - 4px)` }}
                className={`absolute ${top} z-10 flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium hover:z-20 hover:shadow-lg transition ${color}`}
                title={`${e.numero_commande} — ${kind === "eta" ? "ETA Le Havre" : "Livraison AA"} ${format(date, "d MMM", { locale: fr })}`}
              >
                {kind === "eta" ? <Anchor className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                <span className="truncate max-w-[90px]">{e.numero_commande}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Anchor className="h-3 w-3 text-cyan-400" /> ETA Le Havre</span>
          <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3 text-emerald-400" /> Livraison AA</span>
        </div>
      </div>
    </section>
  );
}

/* ============================================================= */

type FormState = Omit<Partial<Expedition>, "items"> & { items: Item[] };

function ExpeditionDialog({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Expedition | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>({ items: [], statut: "a_venir", docs_transmis: false });

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? { ...initial, items: Array.isArray(initial.items) ? initial.items : [] }
          : { items: [], statut: "a_venir", docs_transmis: false }
      );
    }
  }, [open, initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v as any }));

  const addItem = () => set("items", [...(form.items ?? []), { produit: "", quantite: 1 }]);
  const updateItem = (i: number, patch: Partial<Item>) =>
    set("items", form.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => set("items", form.items.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.numero_commande?.trim() || !form.fournisseur?.trim()) {
      toast({ title: "N° de commande et fournisseur obligatoires", variant: "destructive" });
      return;
    }
    const payload: any = {
      numero_commande: form.numero_commande.trim(),
      origine: form.origine ?? null,
      fournisseur: form.fournisseur.trim(),
      items: (form.items ?? []).filter((i) => i.produit?.trim()).map((i) => ({
        produit: i.produit.trim(),
        quantite: Number(i.quantite) || 1,
      })),
      date_dispo_fournisseur: form.date_dispo_fournisseur || null,
      port_depart: form.port_depart || null,
      etd: form.etd || null,
      eta_le_havre: form.eta_le_havre || null,
      livraison_aa: form.livraison_aa || null,
      heure: form.heure || null,
      transitaire: form.transitaire || null,
      numero_dossier: form.numero_dossier || null,
      docs_transmis: !!form.docs_transmis,
      type_conteneur: form.type_conteneur || null,
      numero_conteneur: form.numero_conteneur || null,
      nom_navire: form.nom_navire || null,
      monnayeurs: form.monnayeurs || null,
      remarques: form.remarques || null,
      cout_fret: form.cout_fret === undefined || form.cout_fret === null || (form.cout_fret as any) === "" ? null : Number(form.cout_fret),
      cout_exw: form.cout_exw === undefined || form.cout_exw === null || (form.cout_exw as any) === "" ? null : Number(form.cout_exw),
      statut: form.statut ?? "a_venir",
    };
    try {
      if (initial?.id) {
        const { error } = await (supabase as any).from("logi_expeditions").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast({ title: "Expédition mise à jour" });
      } else {
        const { error } = await (supabase as any).from("logi_expeditions").insert(payload);
        if (error) throw error;
        toast({ title: "Expédition créée" });
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const deleteRow = async () => {
    if (!initial?.id) return;
    if (!confirm(`Supprimer définitivement la commande ${initial.numero_commande} ?`)) return;
    const { error } = await (supabase as any).from("logi_expeditions").delete().eq("id", initial.id);
    if (error) return toast({ title: "Erreur", description: error.message, variant: "destructive" });
    toast({ title: "Expédition supprimée" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Modifier · ${initial.numero_commande}` : "Nouvelle expédition"}</DialogTitle>
          <DialogDescription>Renseigne les informations par section.</DialogDescription>
        </DialogHeader>

        {/* Commande */}
        <Section title="Commande">
          <Grid>
            <Field label="N° de commande *">
              <Input value={form.numero_commande ?? ""} onChange={(e) => set("numero_commande", e.target.value)} />
            </Field>
            <Field label="Origine">
              <Select value={form.origine ?? undefined} onValueChange={(v) => set("origine", v as Origine)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASIE">ASIE</SelectItem>
                  <SelectItem value="US">US</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fournisseur *">
              <Input value={form.fournisseur ?? ""} onChange={(e) => set("fournisseur", e.target.value)} />
            </Field>
          </Grid>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs text-muted-foreground">Articles</Label>
              <Button type="button" size="sm" variant="ghost" onClick={addItem} className="h-7 gap-1">
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
            <div className="space-y-2">
              {(form.items ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun article.</p>
              )}
              {(form.items ?? []).map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="Produit"
                    value={it.produit}
                    onChange={(e) => updateItem(i, { produit: e.target.value })}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={it.quantite}
                    onChange={(e) => updateItem(i, { quantite: Number(e.target.value) })}
                    className="w-24"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Dates */}
        <Section title="Dates">
          <Grid>
            <Field label="Dispo fournisseur"><Input type="date" value={form.date_dispo_fournisseur ?? ""} onChange={(e) => set("date_dispo_fournisseur", e.target.value)} /></Field>
            <Field label="ETD"><Input type="date" value={form.etd ?? ""} onChange={(e) => set("etd", e.target.value)} /></Field>
            <Field label="ETA Le Havre"><Input type="date" value={form.eta_le_havre ?? ""} onChange={(e) => set("eta_le_havre", e.target.value)} /></Field>
            <Field label="Livraison AA"><Input type="date" value={form.livraison_aa ?? ""} onChange={(e) => set("livraison_aa", e.target.value)} /></Field>
            <Field label="Heure"><Input value={form.heure ?? ""} onChange={(e) => set("heure", e.target.value)} placeholder="ex : 14h30" /></Field>
          </Grid>
        </Section>

        {/* Transport */}
        <Section title="Transport">
          <Grid>
            <Field label="Port de départ"><Input value={form.port_depart ?? ""} onChange={(e) => set("port_depart", e.target.value)} /></Field>
            <Field label="Transitaire"><Input value={form.transitaire ?? ""} onChange={(e) => set("transitaire", e.target.value)} /></Field>
            <Field label="N° de dossier"><Input value={form.numero_dossier ?? ""} onChange={(e) => set("numero_dossier", e.target.value)} /></Field>
            <Field label="Type de conteneur"><Input value={form.type_conteneur ?? ""} onChange={(e) => set("type_conteneur", e.target.value)} placeholder="20', 40'HC…" /></Field>
            <Field label="N° de conteneur"><Input value={form.numero_conteneur ?? ""} onChange={(e) => set("numero_conteneur", e.target.value)} /></Field>
            <Field label="Nom du navire"><Input value={form.nom_navire ?? ""} onChange={(e) => set("nom_navire", e.target.value)} /></Field>
            <Field label="Monnayeurs"><Input value={form.monnayeurs ?? ""} onChange={(e) => set("monnayeurs", e.target.value)} /></Field>
          </Grid>
        </Section>

        {/* Coûts */}
        <Section title="Coûts">
          <Grid>
            <Field label="Coût fret (€)"><Input type="number" step="0.01" value={form.cout_fret ?? ""} onChange={(e) => set("cout_fret", e.target.value as any)} /></Field>
            <Field label="Coût EXW (€)"><Input type="number" step="0.01" value={form.cout_exw ?? ""} onChange={(e) => set("cout_exw", e.target.value as any)} /></Field>
          </Grid>
        </Section>

        {/* Suivi */}
        <Section title="Suivi">
          <Grid>
            <Field label="Statut">
              <Select value={form.statut ?? "a_venir"} onValueChange={(v) => set("statut", v as Statut)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUTS.map((s) => <SelectItem key={s} value={s}>{STATUT_META[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Documents transmis">
              <div className="flex items-center gap-2 h-9">
                <Switch checked={!!form.docs_transmis} onCheckedChange={(v) => set("docs_transmis", v)} />
                <span className="text-sm text-muted-foreground">{form.docs_transmis ? "Oui" : "Non"}</span>
              </div>
            </Field>
          </Grid>
          <div className="mt-3">
            <Field label="Remarques">
              <Textarea rows={3} value={form.remarques ?? ""} onChange={(e) => set("remarques", e.target.value)} />
            </Field>
          </div>
        </Section>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          {initial && (
            <Button variant="ghost" onClick={deleteRow} className="text-destructive hover:text-destructive gap-1">
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={save} className="gap-1">
            {initial ? <><Pencil className="h-4 w-4" /> Enregistrer</> : <><Plus className="h-4 w-4" /> Créer</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <h3 className="text-[11px] uppercase tracking-wider text-primary/80 font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2, Plus, Upload, Target, ExternalLink, Trash2, GripVertical, Mail, Phone,
  Sparkles, Copy, RefreshCw, Save, Link2, Link2Off, Search, TrendingUp, Zap,
} from "lucide-react";

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

type Statut = "nouveau" | "connecte" | "repondu" | "rdv" | "devis" | "client" | "perdu";
type Segment = "loisirs" | "chr" | "retail" | "revendeur" | "autre";
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
  statut: Statut;
  owner_id: string | null;
  montant_estime: number | null;
  code_client: string | null;
  notes: string | null;
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

const STATUTS: { key: Statut; label: string }[] = [
  { key: "nouveau", label: "Nouveau" },
  { key: "connecte", label: "Connecté" },
  { key: "repondu", label: "Répondu" },
  { key: "rdv", label: "RDV" },
  { key: "devis", label: "Devis" },
  { key: "client", label: "Client" },
  { key: "perdu", label: "Perdu" },
];

const STATUT_COLOR: Record<Statut, string> = {
  nouveau: "hsl(220 15% 55%)",
  connecte: "hsl(200 90% 60%)",
  repondu: "hsl(258 90% 66%)",
  rdv: "hsl(280 85% 65%)",
  devis: "hsl(48 100% 55%)",
  client: "hsl(142 71% 45%)",
  perdu: "hsl(0 75% 60%)",
};

const SEGMENTS: { key: Segment; label: string; className: string }[] = [
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

type Resume = {
  total: number; nouveau: number; connecte: number; repondu: number; rdv: number;
  devis: number; client: number; perdu: number; ca_attribue: number;
};

export default function Prospection() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [resume, setResume] = useState<Resume | null>(null);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);

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

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows }, { data: r }] = await Promise.all([
      (supabase as any).from("prospects").select("*").order("updated_at", { ascending: false }),
      (supabase as any).rpc("get_prospection_resume"),
    ]);
    setProspects((rows as Prospect[]) ?? []);
    const first = Array.isArray(r) ? r[0] : r;
    setResume(first ? {
      total: num(first.total), nouveau: num(first.nouveau), connecte: num(first.connecte),
      repondu: num(first.repondu), rdv: num(first.rdv), devis: num(first.devis),
      client: num(first.client), perdu: num(first.perdu), ca_attribue: num(first.ca_attribue),
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
  if (!isAdmin && !isDirection) {
    return <Navigate to="/" replace />;
  }

  const byStatut = useMemo(() => {
    const map = new Map<Statut, Prospect[]>();
    STATUTS.forEach((s) => map.set(s.key, []));
    for (const p of prospects) {
      const arr = map.get(p.statut as Statut) ?? map.get("nouveau")!;
      arr.push(p);
    }
    return map;
  }, [prospects]);

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
    toast.success(`Statut → ${STATUTS.find((s) => s.key === newStatut)?.label}`);
    // refresh resume
    const { data: r } = await (supabase as any).rpc("get_prospection_resume");
    const first = Array.isArray(r) ? r[0] : r;
    if (first) setResume({
      total: num(first.total), nouveau: num(first.nouveau), connecte: num(first.connecte),
      repondu: num(first.repondu), rdv: num(first.rdv), devis: num(first.devis),
      client: num(first.client), perdu: num(first.perdu), ca_attribue: num(first.ca_attribue),
    });
  };

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
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Importer CSV</span>
        </Button>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </header>

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
          <div className="overflow-x-auto -mx-4 px-4 pb-4">
            <div className="flex gap-3 min-w-max">
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
        "w-72 flex-shrink-0 rounded-lg border bg-card/50 flex flex-col",
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
      <div className="flex-1 p-2 space-y-2 min-h-[200px]">
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

function KanbanCard({ prospect, onOpen }: { prospect: Prospect; onOpen: () => void }) {
  const seg = segmentMeta(prospect.segment);
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
          <div className="text-[11px] text-muted-foreground truncate">
            {[prospect.contact_role, prospect.ville].filter(Boolean).join(" · ") || "—"}
          </div>
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", seg.className)}>{seg.label}</Badge>
            {prospect.source === "signal" && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 gap-0.5 border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              >
                <Zap className="h-2.5 w-2.5" /> Signal
              </Badge>
            )}
            {prospect.montant_estime ? (
              <span className="text-[11px] font-medium text-foreground/90">{eur(prospect.montant_estime)}</span>
            ) : null}
          </div>
          {prospect.signal && (
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
                  {STATUTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
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
      ? `Statut : ${STATUTS.find((s) => s.key === ev.ancien_statut)?.label ?? ev.ancien_statut} → ${STATUTS.find((s) => s.key === ev.nouveau_statut)?.label ?? ev.nouveau_statut}`
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
    const { error } = await (supabase as any).from("prospects").insert(rows);
    setImporting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length} prospect${rows.length > 1 ? "s" : ""} importé${rows.length > 1 ? "s" : ""}`);
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


import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, differenceInCalendarDays, isValid } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Truck, Plus, Search, Loader2, Package, AlertTriangle, CalendarClock,
  ArrowLeft, Trash2, Pencil, Upload, FileText, X, Ship, Plane, Factory, Home,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import logoImg from "@/assets/logo.png";

type Status = "a_venir" | "dispo" | "en_attente" | "en_cours" | "en_mer" | "livre";

const STATUS_META: Record<Status, { label: string; className: string }> = {
  a_venir: { label: "À venir", className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground" },
  dispo: { label: "Dispo fournisseur", className: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  en_attente: { label: "En attente", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  en_cours: { label: "En cours", className: "border-primary/40 bg-primary/10 text-primary" },
  en_mer: { label: "En mer", className: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" },
  livre: { label: "Livré", className: "border-secondary/40 bg-secondary/10 text-secondary" },
};

const STATUS_ORDER: Status[] = ["a_venir", "dispo", "en_attente", "en_cours", "en_mer", "livre"];

type Shipment = {
  id: string;
  reference: string;
  supplier: string;
  origin_country: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: Status;
  order_date: string | null;
  factory_departure_date: string | null;
  eta_date: string | null;
  arrival_date: string | null;
  amount_ht: number | null;
  currency: string | null;
  incoterm: string | null;
  customs_fees: number | null;
  transport_fees: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ShipmentItem = {
  id: string;
  shipment_id: string;
  product_name: string;
  quantity: number;
  notes: string | null;
};

type ShipmentDoc = {
  id: string;
  shipment_id: string;
  name: string;
  kind: string | null;
  file_path: string;
  created_at: string;
};

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = parseISO(d);
  return isValid(dt) ? format(dt, "d MMM yyyy", { locale: fr }) : "—";
};

const fmtMoney = (v: number | null, ccy: string | null = "EUR") => {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: ccy || "EUR", maximumFractionDigits: 0 }).format(v);
};

export default function Logistique() {
  const { isAdmin, isLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [openCreate, setOpenCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const qc = useQueryClient();

  const { data: shipments = [], isLoading: loadingList } = useQuery({
    queryKey: ["shipments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments")
        .select("*")
        .order("eta_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as Shipment[];
    },
    enabled: isAdmin,
  });

  const filtered = useMemo(() => {
    return shipments.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return [s.reference, s.supplier, s.origin_country, s.carrier, s.tracking_number]
          .some((v) => v?.toLowerCase().includes(q));
      }
      return true;
    });
  }, [shipments, search, statusFilter]);

  const stats = useMemo(() => {
    const today = new Date();
    let inTransit = 0, late = 0, thisWeek = 0, totalValue = 0;
    shipments.forEach((s) => {
      if (["dispo", "en_attente", "en_cours", "en_mer"].includes(s.status)) inTransit++;
      if (s.status !== "livre" && s.eta_date) {
        const eta = parseISO(s.eta_date);
        if (isValid(eta)) {
          const diff = differenceInCalendarDays(eta, today);
          if (diff < 0) late++;
          else if (diff <= 7) thisWeek++;
        }
      }
      if (s.status !== "livre") totalValue += Number(s.amount_ht ?? 0);
    });
    return { inTransit, late, thisWeek, totalValue };
  }, [shipments]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/" replace />;

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
              <h1 className="font-display text-sm sm:text-base font-semibold truncate">
                Logistique
              </h1>
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
        {/* Dashboard */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Package} label="En transit" value={stats.inTransit} tone="primary" />
          <StatCard icon={AlertTriangle} label="En retard" value={stats.late} tone="danger" />
          <StatCard icon={CalendarClock} label="Arrivées ≤ 7 j" value={stats.thisWeek} tone="secondary" />
          <StatCard icon={Ship} label="Valeur en transit" value={fmtMoney(stats.totalValue)} tone="muted" />
        </section>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher : référence, fournisseur, tracking…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setOpenCreate(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Nouvelle expédition
          </Button>
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
                {shipments.length === 0 ? "Aucune expédition. Crée-en une pour commencer." : "Aucun résultat pour ces filtres."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((s) => <ShipmentRow key={s.id} s={s} onClick={() => setSelectedId(s.id)} />)}
            </div>
          )}
        </section>
      </main>

      <ShipmentDialog
        open={openCreate}
        onOpenChange={setOpenCreate}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["shipments"] }); }}
      />
      <ShipmentDetail
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["shipments"] })}
      />
    </div>
  );
}

/* ---------------- Stat card ---------------- */

function StatCard({
  icon: Icon, label, value, tone,
}: { icon: any; label: string; value: string | number; tone: "primary" | "secondary" | "danger" | "muted" }) {
  const toneCls =
    tone === "primary" ? "text-primary bg-primary/10 border-primary/30" :
    tone === "secondary" ? "text-secondary bg-secondary/10 border-secondary/30" :
    tone === "danger" ? "text-destructive bg-destructive/10 border-destructive/30" :
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

/* ---------------- Ligne d'expédition ---------------- */

function ShipmentRow({ s, onClick }: { s: Shipment; onClick: () => void }) {
  const eta = s.eta_date ? parseISO(s.eta_date) : null;
  const isLate = eta && isValid(eta) && s.status !== "livre" && differenceInCalendarDays(eta, new Date()) < 0;
  const originIcon =
    s.origin_country?.toLowerCase().includes("us") ? Plane :
    s.origin_country?.toLowerCase().match(/asi|chin|jap|kor|viet|thai/) ? Ship : Factory;
  const OriginIcon = originIcon;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors flex items-center gap-3"
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted/40 text-muted-foreground shrink-0">
        <OriginIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{s.reference}</span>
          <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${STATUS_META[s.status].className}`}>
            {STATUS_META[s.status].label}
          </Badge>
          {isLate && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-destructive/40 bg-destructive/10 text-destructive">
              Retard
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {s.supplier}{s.origin_country ? ` · ${s.origin_country}` : ""}{s.carrier ? ` · ${s.carrier}` : ""}
          {s.tracking_number ? ` · ${s.tracking_number}` : ""}
        </div>
      </div>
      <div className="hidden md:block text-right shrink-0">
        <div className="text-xs text-muted-foreground">ETA</div>
        <div className={`text-sm ${isLate ? "text-destructive" : ""}`}>{fmtDate(s.eta_date)}</div>
      </div>
      <div className="hidden lg:block text-right shrink-0 w-28">
        <div className="text-xs text-muted-foreground">Montant</div>
        <div className="text-sm">{fmtMoney(s.amount_ht, s.currency)}</div>
      </div>
    </button>
  );
}

/* ---------------- Dialog création / édition ---------------- */

type FormState = Partial<Shipment>;

function ShipmentDialog({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Shipment;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<FormState>({});

  useEffect(() => {
    if (open) {
      setForm(initial ?? { status: "a_venir", currency: "EUR" });
    }
  }, [open, initial]);

  const set = (k: keyof Shipment, v: any) => setForm((f) => ({ ...f, [k]: v === "" ? null : v }));

  const save = async () => {
    if (!form.reference || !form.supplier) {
      toast({ title: "Référence et fournisseur obligatoires", variant: "destructive" });
      return;
    }
    const payload: any = { ...form };
    ["amount_ht", "customs_fees", "transport_fees"].forEach((k) => {
      if (payload[k] === "" || payload[k] == null) payload[k] = null;
      else payload[k] = Number(payload[k]);
    });
    try {
      if (initial?.id) {
        const { error } = await (supabase as any).from("shipments").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast({ title: "Expédition mise à jour" });
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        payload.created_by = user?.id;
        const { error } = await (supabase as any).from("shipments").insert(payload);
        if (error) throw error;
        toast({ title: "Expédition créée" });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Modifier l'expédition" : "Nouvelle expédition"}</DialogTitle>
          <DialogDescription>Identité, dates, coûts. Le contenu et les documents s'ajoutent depuis la fiche.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Référence *"><Input value={form.reference ?? ""} onChange={(e) => set("reference", e.target.value)} placeholder="EXP-2026-001" /></Field>
          <Field label="Fournisseur *"><Input value={form.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} placeholder="Stern Pinball" /></Field>
          <Field label="Origine"><Input value={form.origin_country ?? ""} onChange={(e) => set("origin_country", e.target.value)} placeholder="USA, Chine, Japon…" /></Field>
          <Field label="Transporteur"><Input value={form.carrier ?? ""} onChange={(e) => set("carrier", e.target.value)} placeholder="DHL, CMA CGM…" /></Field>
          <Field label="N° de suivi"><Input value={form.tracking_number ?? ""} onChange={(e) => set("tracking_number", e.target.value)} /></Field>
          <Field label="Statut">
            <Select value={form.status ?? "a_venir"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Date de commande"><Input type="date" value={form.order_date ?? ""} onChange={(e) => set("order_date", e.target.value)} /></Field>
          <Field label="Départ usine"><Input type="date" value={form.factory_departure_date ?? ""} onChange={(e) => set("factory_departure_date", e.target.value)} /></Field>
          <Field label="ETA"><Input type="date" value={form.eta_date ?? ""} onChange={(e) => set("eta_date", e.target.value)} /></Field>
          <Field label="Arrivée réelle"><Input type="date" value={form.arrival_date ?? ""} onChange={(e) => set("arrival_date", e.target.value)} /></Field>
          <Field label="Montant HT"><Input type="number" step="0.01" value={form.amount_ht ?? ""} onChange={(e) => set("amount_ht", e.target.value)} /></Field>
          <Field label="Devise">
            <Select value={form.currency ?? "EUR"} onValueChange={(v) => set("currency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="CNY">CNY</SelectItem>
                <SelectItem value="JPY">JPY</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Incoterm"><Input value={form.incoterm ?? ""} onChange={(e) => set("incoterm", e.target.value)} placeholder="EXW, FOB, CIF, DAP…" /></Field>
          <Field label="Frais douane"><Input type="number" step="0.01" value={form.customs_fees ?? ""} onChange={(e) => set("customs_fees", e.target.value)} /></Field>
          <Field label="Frais transport"><Input type="number" step="0.01" value={form.transport_fees ?? ""} onChange={(e) => set("transport_fees", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={save}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/* ---------------- Fiche détail ---------------- */

function ShipmentDetail({
  id, onClose, onChanged,
}: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [newItem, setNewItem] = useState({ product_name: "", quantity: 1 });

  const enabled = !!id;

  const { data: shipment } = useQuery({
    queryKey: ["shipment", id],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("shipments").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Shipment;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["shipment-items", id],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items").select("*").eq("shipment_id", id).order("created_at");
      if (error) throw error;
      return data as ShipmentItem[];
    },
  });

  const { data: docs = [] } = useQuery({
    queryKey: ["shipment-docs", id],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_documents").select("*").eq("shipment_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data as ShipmentDoc[];
    },
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["shipment", id] });
    qc.invalidateQueries({ queryKey: ["shipment-items", id] });
    qc.invalidateQueries({ queryKey: ["shipment-docs", id] });
    onChanged();
  };

  const addItem = async () => {
    if (!newItem.product_name.trim() || !id) return;
    const { error } = await (supabase as any).from("shipment_items").insert({
      shipment_id: id,
      product_name: newItem.product_name.trim(),
      quantity: Number(newItem.quantity) || 1,
    });
    if (error) return toast({ title: "Erreur", description: error.message, variant: "destructive" });
    setNewItem({ product_name: "", quantity: 1 });
    refetchAll();
  };

  const deleteItem = async (itemId: string) => {
    const { error } = await (supabase as any).from("shipment_items").delete().eq("id", itemId);
    if (error) return toast({ title: "Erreur", description: error.message, variant: "destructive" });
    refetchAll();
  };

  const uploadDoc = async (file: File) => {
    if (!id) return;
    const path = `${id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("shipment-docs").upload(path, file);
    if (upErr) return toast({ title: "Upload échoué", description: upErr.message, variant: "destructive" });
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("shipment_documents").insert({
      shipment_id: id, name: file.name, file_path: path, uploaded_by: user?.id,
    });
    if (error) return toast({ title: "Erreur", description: error.message, variant: "destructive" });
    toast({ title: "Document ajouté" });
    refetchAll();
  };

  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage.from("shipment-docs").createSignedUrl(path, 300);
    if (error || !data) return toast({ title: "Erreur", description: error?.message, variant: "destructive" });
    window.open(data.signedUrl, "_blank");
  };

  const deleteDoc = async (doc: ShipmentDoc) => {
    await supabase.storage.from("shipment-docs").remove([doc.file_path]);
    await (supabase as any).from("shipment_documents").delete().eq("id", doc.id);
    refetchAll();
  };

  const deleteShipment = async () => {
    if (!id || !confirm("Supprimer définitivement cette expédition ?")) return;
    const { error } = await (supabase as any).from("shipments").delete().eq("id", id);
    if (error) return toast({ title: "Erreur", description: error.message, variant: "destructive" });
    toast({ title: "Expédition supprimée" });
    onClose();
    onChanged();
  };

  const updateStatus = async (status: Status) => {
    if (!id) return;
    const patch: any = { status };
    if (status === "livre" && !shipment?.arrival_date) patch.arrival_date = format(new Date(), "yyyy-MM-dd");
    const { error } = await (supabase as any).from("shipments").update(patch).eq("id", id);
    if (error) return toast({ title: "Erreur", description: error.message, variant: "destructive" });
    refetchAll();
  };

  return (
    <>
      <Dialog open={enabled} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          {shipment ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-xl">{shipment.reference}</DialogTitle>
                  <Badge variant="outline" className={`text-[10px] uppercase tracking-wider ${STATUS_META[shipment.status].className}`}>
                    {STATUS_META[shipment.status].label}
                  </Badge>
                </div>
                <DialogDescription>{shipment.supplier}{shipment.origin_country ? ` — ${shipment.origin_country}` : ""}</DialogDescription>
              </DialogHeader>

              {/* Statut rapide */}
              <div className="flex flex-wrap gap-1.5">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(s)}
                    className={`text-[11px] uppercase tracking-wider rounded-md border px-2 py-1 transition ${
                      shipment.status === s ? STATUS_META[s].className : "border-border text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>

              {/* Infos */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <Info label="Transporteur" value={shipment.carrier} />
                <Info label="N° de suivi" value={shipment.tracking_number} />
                <Info label="Incoterm" value={shipment.incoterm} />
                <Info label="Commande" value={fmtDate(shipment.order_date)} />
                <Info label="Départ usine" value={fmtDate(shipment.factory_departure_date)} />
                <Info label="ETA" value={fmtDate(shipment.eta_date)} />
                <Info label="Arrivée" value={fmtDate(shipment.arrival_date)} />
                <Info label="Montant HT" value={fmtMoney(shipment.amount_ht, shipment.currency)} />
                <Info label="Douane + transport" value={fmtMoney((shipment.customs_fees ?? 0) + (shipment.transport_fees ?? 0), shipment.currency)} />
              </div>

              {shipment.notes && (
                <div className="rounded-md border border-border bg-muted/20 p-3 text-sm whitespace-pre-wrap">{shipment.notes}</div>
              )}

              {/* Contenu */}
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Contenu</h3>
                <div className="rounded-md border border-border divide-y divide-border">
                  {items.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">Aucun produit renseigné.</div>
                  )}
                  {items.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground w-10 text-right">×{it.quantity}</span>
                      <span className="flex-1 truncate">{it.product_name}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem(it.id)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 p-2">
                    <Input
                      placeholder="Nom du produit"
                      value={newItem.product_name}
                      onChange={(e) => setNewItem({ ...newItem, product_name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && addItem()}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={newItem.quantity}
                      onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                      className="w-20"
                    />
                    <Button onClick={addItem} size="sm">Ajouter</Button>
                  </div>
                </div>
              </section>

              {/* Documents */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Documents</h3>
                  <label className="inline-flex items-center gap-1 text-xs cursor-pointer text-primary hover:underline">
                    <Upload className="h-3.5 w-3.5" /> Ajouter
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.target.value = ""; }}
                    />
                  </label>
                </div>
                <div className="rounded-md border border-border divide-y divide-border">
                  {docs.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">Aucun document.</div>
                  )}
                  {docs.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <button onClick={() => openDoc(d.file_path)} className="flex-1 text-left truncate hover:text-primary">
                        {d.name}
                      </button>
                      <span className="text-xs text-muted-foreground">{fmtDate(d.created_at)}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteDoc(d)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="ghost" onClick={deleteShipment} className="text-destructive hover:text-destructive gap-1">
                  <Trash2 className="h-4 w-4" /> Supprimer
                </Button>
                <div className="flex-1" />
                <Button variant="outline" onClick={() => setEditOpen(true)} className="gap-1">
                  <Pencil className="h-4 w-4" /> Modifier
                </Button>
                <Button onClick={onClose}>Fermer</Button>
              </DialogFooter>
            </>
          ) : (
            <div className="p-10 text-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Chargement…
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ShipmentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={shipment ?? undefined}
        onSaved={refetchAll}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value || "—"}</div>
    </div>
  );
}

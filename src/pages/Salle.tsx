import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, Save, Gamepad2, CalendarDays, Info, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppTopNav } from "@/components/AppTopNav";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { barTooltipCursor, ChartTooltipContent } from "@/components/admin/chartTooltip";
import logoImg from "@/assets/logo.png";
import { KpiImportCard } from "@/components/salle/KpiImportCard";
import { DonutHoverCenter } from "@/components/admin/DonutHoverCenter";

// Axe Y euros lisible pour petits montants : 0, 200 €, 400 €… ou 1k € au-delà.
const eurAxis = (v: number) => {
  const n = Number(v) || 0;
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k €`;
  return `${n} €`;
};

// ------------------------------------------------------------
// Types & constantes
// ------------------------------------------------------------

type SalleJournee = {
  date: string;
  visiteurs: number;
  nb_parties: number;
  nb_cartes_vendues: number;
  ca_cartes_ht: number;
  ca_pax_ht: number;
  ca_merch_ht: number;
  ca_vending_pokemon_ht: number;
  ca_vending_blindbox_ht: number;
  ca_photomaton_ht: number;
  notes: string | null;
  saisi_par: string | null;
  updated_at: string;
};

type SalleObjectif = {
  id: string;
  date_debut: string;
  date_fin: string | null;
  objectif_jour_ht: number;
  objectif_semaine_ht: number;
};

const SOURCES: Array<{
  key: keyof SalleJournee;
  label: string;
  color: string;
}> = [
  // Palette officielle Hypernova (livret de marque)
  { key: "ca_cartes_ht", label: "Cartes cashless", color: "hsl(273 87% 72%)" },   // Neon Purple #B97DF5
  { key: "ca_pax_ht", label: "TPA jeux (CB)", color: "hsl(224 68% 59%)" },        // Glitch Blue #5078DE
  { key: "ca_merch_ht", label: "Merch Hypernova", color: "hsl(355 100% 59%)" },   // Turbo Red #FF2D41
  { key: "ca_vending_pokemon_ht", label: "Vending Pokémon", color: "hsl(45 100% 55%)" },   // jaune-or
  { key: "ca_vending_blindbox_ht", label: "Vending Blind Box", color: "hsl(273 87% 85%)" }, // violet clair
  { key: "ca_photomaton_ht", label: "Photomaton", color: "hsl(0 0% 88%)" },       // blanc/gris clair
];
const TVA = 0.2;

// ------------------------------------------------------------
// Helpers dates (semaines ISO, lundi-dimanche)
// ------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
/** Renvoie le lundi (00:00) de la semaine ISO. */
const mondayOf = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // lundi = 0
  x.setDate(x.getDate() - dow);
  return x;
};
/** Numéro de semaine ISO. */
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - first.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
};
const weekKey = (d: Date) => {
  const mon = mondayOf(d);
  return `${mon.getFullYear()}-S${pad(isoWeek(mon))}`;
};

const eur = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

// RÈGLE MÉTIER (patron) — le CA de la salle est UNIQUEMENT :
//   CA salle = ca_pax_ht + ca_cartes_ht
// Les vending Pokémon, vending blind box et photomaton sont DÉJÀ INCLUS
// dans ca_pax_ht (ce sont des pax sur machines). Il ne faut donc jamais les
// rajouter. Le merch (boutique) est un CA à part et n'entre pas dans le CA salle.
const TOTAL_KEYS: Array<keyof SalleJournee> = ["ca_pax_ht", "ca_cartes_ht"];

const journeeCaTotal = (j: SalleJournee): number =>
  TOTAL_KEYS.reduce((s, k) => s + Number((j as any)[k] ?? 0), 0);

// "Jeux" = pax hors vending/photo (ventilation informative "dont")
const journeeJeux = (j: SalleJournee): number =>
  Math.max(
    0,
    Number(j.ca_pax_ht ?? 0)
      - Number(j.ca_vending_pokemon_ht ?? 0)
      - Number(j.ca_vending_blindbox_ht ?? 0)
      - Number(j.ca_photomaton_ht ?? 0),
  );

// Sources du CA affichées dans le dashboard (donut, meilleure source, agrégats).
// La somme Jeux + Vending Pokémon + Vending Blind Box + Photomaton = ca_pax_ht,
// puis + Cartes = CA salle. Pas de double comptage.
type DashSource = {
  key: string;
  label: string;
  color: string;
  compute: (j: SalleJournee) => number;
};
const DASH_SOURCES: DashSource[] = [
  { key: "jeux", label: "Jeux", color: "hsl(224 68% 59%)", compute: journeeJeux },
  { key: "ca_cartes_ht", label: "Cartes cashless", color: "hsl(273 87% 72%)", compute: (j) => Number(j.ca_cartes_ht ?? 0) },
  { key: "ca_vending_pokemon_ht", label: "Vending Pokémon", color: "hsl(45 100% 55%)", compute: (j) => Number(j.ca_vending_pokemon_ht ?? 0) },
  { key: "ca_vending_blindbox_ht", label: "Vending Blind Box", color: "hsl(273 87% 85%)", compute: (j) => Number(j.ca_vending_blindbox_ht ?? 0) },
  { key: "ca_photomaton_ht", label: "Photomaton", color: "hsl(0 0% 88%)", compute: (j) => Number(j.ca_photomaton_ht ?? 0) },
];

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function Salle() {
  const { canAccessSalle, isLoading, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const initialTab = location.hash === "#dashboard" ? "dashboard" : "saisie";
  const [tab, setTab] = useState<"saisie" | "dashboard">(initialTab);
  const searchDate = new URLSearchParams(location.search).get("d") ?? undefined;

  useEffect(() => {
    setTab(location.hash === "#dashboard" ? "dashboard" : "saisie");
  }, [location.hash]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessSalle) return <Navigate to="/" replace />;

  const changeTab = (v: string) => {
    setTab(v as "saisie" | "dashboard");
    navigate(`/salle#${v}`, { replace: true });
  };

  return (
    <div className="hn-brand min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/70 backdrop-blur-md px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
          <h1 className="font-display text-base sm:text-lg font-bold tracking-tight truncate flex items-center gap-2">
            <Gamepad2 className="h-5 w-5" style={{ color: "hsl(var(--hn-purple))" }} />
            Salle Hypernova
          </h1>
          <AppTopNav />
        </div>
        <UserMenu />
      </header>

      {/* Bandeau de marque HYPERNOVA — portail stellaire, en tête uniquement */}
      <section className="hn-hero-bg border-b border-border/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div
              className="hn-goldman font-bold text-3xl sm:text-5xl tracking-[0.08em] leading-none"
              style={{ color: "#fff", textShadow: "0 0 24px hsl(var(--hn-purple) / 0.55)" }}
            >
              HYPERNOVA
            </div>
            <div
              className="mt-2 text-xs sm:text-sm uppercase tracking-[0.3em]"
              style={{ color: "hsl(var(--hn-purple))" }}
            >
              Battle for fun
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-widest text-white/60">
            Dashboard opérationnel · saisie du jour
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-6">
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="saisie" className="text-base">Saisie du jour</TabsTrigger>
            <TabsTrigger value="dashboard" className="text-base">Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="saisie">
            <SaisieTab userId={user?.id ?? null} initialDate={searchDate} />
          </TabsContent>
          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ------------------------------------------------------------
// Onglet SAISIE
// ------------------------------------------------------------

const EMPTY_FORM = {
  visiteurs: 0,
  nb_parties: 0,
  nb_cartes_vendues: 0,
  ca_cartes_ht: 0,
  ca_pax_ht: 0,
  ca_merch_ht: 0,
  ca_vending_pokemon_ht: 0,
  ca_vending_blindbox_ht: 0,
  ca_photomaton_ht: 0,
  notes: "",
};

function SaisieTab({ userId, initialDate }: { userId: string | null; initialDate?: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(initialDate ?? toYmd(new Date()));
  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Journée pré-existante ?
  const { data: existing, isFetching } = useQuery({
    queryKey: ["salle_journee", date],
    queryFn: async (): Promise<SalleJournee | null> => {
      const { data, error } = await (supabase as any)
        .from("salle_journees")
        .select("*")
        .eq("date", date)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({
        visiteurs: Number(existing.visiteurs ?? 0),
        nb_parties: Number(existing.nb_parties ?? 0),
        nb_cartes_vendues: Number(existing.nb_cartes_vendues ?? 0),
        ca_cartes_ht: Number(existing.ca_cartes_ht ?? 0),
        ca_pax_ht: Number(existing.ca_pax_ht ?? 0),
        ca_merch_ht: Number(existing.ca_merch_ht ?? 0),
        ca_vending_pokemon_ht: Number(existing.ca_vending_pokemon_ht ?? 0),
        ca_vending_blindbox_ht: Number(existing.ca_vending_blindbox_ht ?? 0),
        ca_photomaton_ht: Number(existing.ca_photomaton_ht ?? 0),
        notes: existing.notes ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [existing, date]);

  // Jours manquants de la semaine courante
  const weekMondayStr = toYmd(mondayOf(parseYmd(date)));
  const { data: weekDays } = useQuery({
    queryKey: ["salle_semaine", weekMondayStr],
    queryFn: async () => {
      const start = weekMondayStr;
      const end = toYmd(addDays(parseYmd(weekMondayStr), 6));
      const { data, error } = await (supabase as any)
        .from("salle_journees")
        .select("date")
        .gte("date", start)
        .lte("date", end);
      if (error) throw error;
      return (data ?? []) as { date: string }[];
    },
  });
  const filled = useMemo(() => new Set((weekDays ?? []).map((d) => d.date)), [weekDays]);
  const weekList = useMemo(() => {
    const mon = parseYmd(weekMondayStr);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      const ymd = toYmd(d);
      return {
        ymd,
        label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit" }),
        filled: filled.has(ymd),
        isToday: ymd === toYmd(new Date()),
      };
    });
  }, [weekMondayStr, filled]);

  const totalHT = TOTAL_KEYS.reduce((s, k) => s + Number((form as any)[k] ?? 0), 0);

  // Records historiques (hors journée en cours d'édition) pour badge "NOUVEAU RECORD"
  const { data: records } = useQuery({
    queryKey: ["salle_records", date],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("salle_journees")
        .select("date, visiteurs, ca_cartes_ht, ca_pax_ht, ca_merch_ht, ca_vending_pokemon_ht, ca_vending_blindbox_ht, ca_photomaton_ht")
        .neq("date", date);
      if (error) throw error;
      const arr = (data ?? []) as SalleJournee[];
      let maxCa = 0;
      let maxVis = 0;
      for (const r of arr) {
        const ca = journeeCaTotal(r);
        if (ca > maxCa) maxCa = ca;
        if (Number(r.visiteurs ?? 0) > maxVis) maxVis = Number(r.visiteurs ?? 0);
      }
      return { maxCa, maxVis };
    },
  });
  const isRecordCa = !!records && totalHT > 0 && totalHT > (records.maxCa ?? 0);
  const isRecordVis = !!records && form.visiteurs > 0 && form.visiteurs > (records.maxVis ?? 0);

  const save = async () => {
    setSaving(true);
    const payload = { date, ...form, saisi_par: userId };
    const beatRecord = isRecordCa || isRecordVis;
    const { error } = await (supabase as any)
      .from("salle_journees")
      .upsert(payload, { onConflict: "date" });
    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: beatRecord ? "🚀 Nouveau record !" : (existing ? "Ta journée est mise à jour" : "Ta journée est enregistrée"),
      description: beatRecord
        ? `Tu viens de battre ${isRecordCa && isRecordVis ? "le CA et les visiteurs" : isRecordCa ? "le CA historique" : "le record de visiteurs"}. Le Pulse monte !`
        : "Le Pulse monte !",
    });
    qc.invalidateQueries({ queryKey: ["salle_journee", date] });
    qc.invalidateQueries({ queryKey: ["salle_semaine", weekMondayStr] });
    qc.invalidateQueries({ queryKey: ["salle_dashboard"] });
    qc.invalidateQueries({ queryKey: ["salle_records"] });
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2 p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="flex flex-col gap-1 min-w-[180px]">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" /> Date de la journée
            </span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 text-base"
              max={toYmd(new Date())}
            />
          </label>
          {existing && (
            <div className="text-xs text-muted-foreground pb-2">
              Modification d'une journée existante · dernière MAJ{" "}
              {new Date(existing.updated_at).toLocaleString("fr-FR")}
            </div>
          )}
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <NumField label="Visiteurs" value={form.visiteurs} onChange={(v) => setForm((f) => ({ ...f, visiteurs: v }))} />
          <NumField label="Nb parties" value={form.nb_parties} onChange={(v) => setForm((f) => ({ ...f, nb_parties: v }))} />
          <NumField label="Cartes vendues" value={form.nb_cartes_vendues} onChange={(v) => setForm((f) => ({ ...f, nb_cartes_vendues: v }))} />
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Recettes HT — les TTC sont indicatifs (TVA 20%)
          </div>
          {SOURCES.map((src) => (
            <MoneyRow
              key={src.key as string}
              label={src.label}
              color={src.color}
              value={Number((form as any)[src.key])}
              onChange={(v) => setForm((f) => ({ ...f, [src.key]: v }))}
            />
          ))}
        </div>

        <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Total journée</span>
            {isRecordCa && <span className="hn-record-badge hn-record-badge--sm">⚡ Nouveau record CA</span>}
            {isRecordVis && <span className="hn-record-badge hn-record-badge--sm">👥 Record visiteurs</span>}
          </div>
          <div className="text-right">
            <div className="hn-kpi-value text-2xl font-bold" style={{ color: "hsl(var(--hn-purple))" }}>
              {eur2(totalHT)} HT
            </div>
            <div className="text-xs text-muted-foreground">{eur2(totalHT * (1 + TVA))} TTC</div>
          </div>
        </div>

        <div className="mt-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Notes (optionnel)</span>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Événements marquants, incidents, promo…"
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={saving} size="lg" className="min-w-40">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {existing ? "Mettre à jour" : "Enregistrer"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-6 h-fit">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          Semaine du {parseYmd(weekMondayStr).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weekList.map((d) => (
            <button
              key={d.ymd}
              type="button"
              onClick={() => setDate(d.ymd)}
              className={`flex flex-col items-center rounded-md border p-2 text-xs transition ${
                d.ymd === date
                  ? "border-primary bg-primary/10 text-foreground"
                  : d.filled
                    ? "border-border bg-card"
                    : "border-dashed border-border/60 bg-muted/10 text-muted-foreground"
              }`}
              title={d.filled ? "Journée saisie" : "Manquante"}
            >
              <span className="font-medium">{d.label}</span>
              <span
                className="mt-1 inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: d.filled ? "hsl(var(--space-salle))" : "hsl(var(--border))" }}
              />
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Clique un jour pour saisir/modifier. Les jours en pointillés n'ont pas encore de saisie.
        </p>
      </Card>

      <KpiImportCard userId={userId} />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 text-base"
      />
    </label>
  );
}

function MoneyRow({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px_100px] items-center gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-sm truncate">{label}</span>
      </div>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 text-base text-right"
      />
      <div className="text-xs text-muted-foreground text-right tabular-nums">
        {eur2(value * (1 + TVA))} TTC
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Onglet DASHBOARD
// ------------------------------------------------------------

type WeekAgg = {
  key: string;
  label: string;
  monday: Date;
  ca: number;
  merch: number;
  visiteurs: number;
  objectif: number;
  bySource: Record<string, number>;
};

function DashboardTab() {
  const navigate = useNavigate();
  // 12 dernières semaines
  const start = useMemo(() => {
    const m = mondayOf(new Date());
    return addDays(m, -11 * 7);
  }, []);
  const end = useMemo(() => addDays(mondayOf(new Date()), 6), []);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["salle_dashboard", toYmd(start), toYmd(end)],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("salle_journees")
        .select("*")
        .gte("date", toYmd(start))
        .lte("date", toYmd(end))
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SalleJournee[];
    },
  });

  const { data: objectifs } = useQuery({
    queryKey: ["salle_objectifs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("salle_objectifs")
        .select("*")
        .order("date_debut", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SalleObjectif[];
    },
  });

  const objectifAtDate = (d: Date): SalleObjectif | null => {
    const ymd = toYmd(d);
    return (
      (objectifs ?? []).find(
        (o) => o.date_debut <= ymd && (o.date_fin === null || o.date_fin >= ymd),
      ) ?? null
    );
  };

  // Agrégation par semaine
  const weeks = useMemo<WeekAgg[]>(() => {
    if (!rows) return [];
    const map = new Map<string, WeekAgg>();
    for (let i = 0; i < 12; i++) {
      const mon = addDays(mondayOf(new Date()), -i * 7);
      const k = weekKey(mon);
      const obj = objectifAtDate(mon);
      map.set(k, {
        key: k,
        label: `S${pad(isoWeek(mon))}`,
        monday: mon,
        ca: 0,
        merch: 0,
        visiteurs: 0,
        objectif: Number(obj?.objectif_semaine_ht ?? 0),
        bySource: Object.fromEntries(DASH_SOURCES.map((s) => [s.key, 0])),
      });
    }
    for (const r of rows) {
      const k = weekKey(parseYmd(r.date));
      const w = map.get(k);
      if (!w) continue;
      w.ca += journeeCaTotal(r);
      w.merch += Number(r.ca_merch_ht ?? 0);
      w.visiteurs += Number(r.visiteurs ?? 0);
      for (const s of DASH_SOURCES) w.bySource[s.key] += s.compute(r);
    }
    return Array.from(map.values()).sort((a, b) => a.monday.getTime() - b.monday.getTime());
    // objectifs listed in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, objectifs]);

  // Semaine courante & précédente (index dans weeks[])
  const currentWeek = weeks[weeks.length - 1];
  const prevWeek = weeks[weeks.length - 2];

  // Est-ce que la semaine courante contient AU MOINS une saisie ?
  const currentWeekDates = useMemo(() => {
    if (!currentWeek || !rows) return [];
    const start = currentWeek.monday;
    const end = addDays(start, 6);
    return rows
      .filter((r) => {
        const d = parseYmd(r.date);
        return d >= start && d <= end;
      })
      .map((r) => r.date);
  }, [currentWeek, rows]);
  const hasCurrentData = currentWeekDates.length > 0;

  // Dernière semaine avec des saisies (pour repli lundi matin)
  const lastFilledWeek = useMemo<WeekAgg | undefined>(() => {
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].ca > 0 || weeks[i].visiteurs > 0) return weeks[i];
    }
    return undefined;
  }, [weeks]);

  // Sélecteur de semaine — null = comportement par défaut (courante si saisie, sinon dernière remplie).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const defaultWeek = hasCurrentData ? currentWeek : lastFilledWeek ?? currentWeek;
  const selectedWeek = selectedKey ? weeks.find((w) => w.key === selectedKey) : undefined;
  const displayWeek = selectedWeek ?? defaultWeek;
  const isFallback =
    !selectedKey && !hasCurrentData && lastFilledWeek && lastFilledWeek.key !== currentWeek?.key;

  // Navigation semaine
  const displayIdx = weeks.findIndex((w) => w.key === displayWeek?.key);
  const canPrev = displayIdx > 0;
  const canNext = displayIdx >= 0 && displayIdx < weeks.length - 1;
  const isCurrentSelected = displayWeek?.key === currentWeek?.key;
  const comparePrev = displayIdx > 0 ? weeks[displayIdx - 1] : undefined;

  // Comparaison à jours comparables : quand la semaine courante est partielle,
  // on somme uniquement les mêmes jours de la semaine précédente.
  const { compareCurrent, comparePrevValue, comparePrevVisitors, compareCurrentVisitors } =
    useMemo(() => {
      // Cas plein / repli / semaine passée sélectionnée : totaux entiers.
      if (!isCurrentSelected || !hasCurrentData || currentWeekDates.length === 7 || !prevWeek) {
        return {
          compareCurrent: displayWeek?.ca ?? 0,
          comparePrevValue: comparePrev?.ca ?? 0,
          compareCurrentVisitors: displayWeek?.visiteurs ?? 0,
          comparePrevVisitors: comparePrev?.visiteurs ?? 0,
        };
      }
      // Cas partiel : on filtre les mêmes weekdays côté S-1.
      const weekdays = new Set(currentWeekDates.map((ymd) => (parseYmd(ymd).getDay() + 6) % 7));
      const prevStart = prevWeek.monday;
      const prevEnd = addDays(prevStart, 6);
      let pCa = 0;
      let pVis = 0;
      for (const r of rows ?? []) {
        const d = parseYmd(r.date);
        if (d < prevStart || d > prevEnd) continue;
        const dow = (d.getDay() + 6) % 7;
        if (!weekdays.has(dow)) continue;
        pCa += journeeCaTotal(r);
        pVis += Number(r.visiteurs ?? 0);
      }
      return {
        compareCurrent: currentWeek.ca,
        comparePrevValue: pCa,
        compareCurrentVisitors: currentWeek.visiteurs,
        comparePrevVisitors: pVis,
      };
    }, [hasCurrentData, currentWeekDates, prevWeek, displayWeek, comparePrev, rows, currentWeek, isCurrentSelected]);

  const bestSource = useMemo(() => {
    if (!displayWeek) return null;
    let best: { label: string; value: number; color: string } | null = null;
    for (const s of DASH_SOURCES) {
      const v = displayWeek.bySource[s.key] ?? 0;
      if (!best || v > best.value) best = { label: s.label, value: v, color: s.color };
    }
    return best;
  }, [displayWeek]);

  // Barres empilées par jour — TOUJOURS la semaine courante (montre l'état réel du calendrier).
  const currentWeekDays = useMemo(() => {
    if (!currentWeek) return [];
    const mon = currentWeek.monday;
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      const ymd = toYmd(d);
      const j = (rows ?? []).find((r) => r.date === ymd);
      const row: any = { day: d.toLocaleDateString("fr-FR", { weekday: "short" }), ymd };
      for (const s of SOURCES) row[s.key as string] = Number((j as any)?.[s.key] ?? 0);
      return row;
    });
  }, [currentWeek, rows]);

  // Progression semaine (barres + variation %)
  const weekSeries = useMemo(() => {
    return weeks.map((w, i) => {
      const prev = i > 0 ? weeks[i - 1].ca : 0;
      const variation = prev > 0 ? ((w.ca - prev) / prev) * 100 : 0;
      return { label: w.label, ca: Math.round(w.ca), objectif: Math.round(w.objectif), variation };
    });
  }, [weeks]);

  // Par jour de semaine — 4 dernières semaines vs 4 précédentes
  const weekdayCompare = useMemo(() => {
    if (!rows) return [];
    const now = mondayOf(new Date());
    const recentStart = addDays(now, -3 * 7);
    const oldStart = addDays(now, -7 * 7);
    const acc = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map((d) => ({
      day: d,
      recent: 0,
      recentN: 0,
      previous: 0,
      previousN: 0,
    }));
    for (const r of rows) {
      const d = parseYmd(r.date);
      const dow = (d.getDay() + 6) % 7;
      const ca = journeeCaTotal(r);
      if (d >= recentStart && d <= addDays(now, 6)) {
        acc[dow].recent += ca;
        acc[dow].recentN += 1;
      } else if (d >= oldStart && d < recentStart) {
        acc[dow].previous += ca;
        acc[dow].previousN += 1;
      }
    }
    return acc.map((a) => ({
      day: a.day,
      "4 dernières": a.recentN ? Math.round(a.recent / a.recentN) : 0,
      "4 précédentes": a.previousN ? Math.round(a.previous / a.previousN) : 0,
    }));
  }, [rows]);

  // Visiteurs & panier moyen
  const visitorsSeries = useMemo(() => {
    return weeks.map((w) => ({
      label: w.label,
      visiteurs: w.visiteurs,
      panier: w.visiteurs > 0 ? Math.round(w.ca / w.visiteurs) : 0,
    }));
  }, [weeks]);

  // Cap long terme = MAX des objectifs hebdo historiques (fallback 20167)
  const capLTSemaine = useMemo(() => {
    const max = Math.max(
      0,
      ...((objectifs ?? []).map((o) => Number(o.objectif_semaine_ht ?? 0))),
    );
    return max > 0 ? max : 20167;
  }, [objectifs]);

  // Objectif intermédiaire actuellement en vigueur, appliqué RÉTROACTIVEMENT à toutes les semaines
  const objectifActuelObj = objectifAtDate(new Date());
  const objectifInterCourant = Number(objectifActuelObj?.objectif_semaine_ht ?? 0) || 3500;

  // Objectif — donnée dérivée (pct = ca / objectif intermédiaire courant)
  const objectifSeries = useMemo(() => {
    return weeks.map((w) => ({
      label: w.label,
      ca: Math.round(w.ca),
      objectif: objectifInterCourant,
      pct: objectifInterCourant > 0 ? Math.min(300, Math.round((w.ca / objectifInterCourant) * 100)) : 0,
      pctLT: capLTSemaine > 0 ? Math.min(200, Math.round((w.ca / capLTSemaine) * 100)) : 0,
    }));
  }, [weeks, objectifInterCourant, capLTSemaine]);

  // Donut sur displayWeek
  const donutData = useMemo(() => {
    if (!displayWeek) return [];
    return DASH_SOURCES.map((s) => ({
      name: s.label,
      value: Math.round(displayWeek.bySource[s.key] ?? 0),
      color: s.color,
    })).filter((d) => d.value > 0);
  }, [displayWeek]);
  const donutTotal = displayWeek?.ca ?? 0;

  // Records historiques (tous les jours saisis) — pour badge "NOUVEAU RECORD"
  const { data: histRecords } = useQuery({
    queryKey: ["salle_records_all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("salle_journees")
        .select("date, visiteurs, ca_cartes_ht, ca_pax_ht, ca_merch_ht, ca_vending_pokemon_ht, ca_vending_blindbox_ht, ca_photomaton_ht");
      if (error) throw error;
      const arr = (data ?? []) as SalleJournee[];
      let maxCa = 0, maxCaDate = "";
      let maxVis = 0, maxVisDate = "";
      for (const r of arr) {
        const ca = journeeCaTotal(r);
        if (ca > maxCa) { maxCa = ca; maxCaDate = r.date; }
        const v = Number(r.visiteurs ?? 0);
        if (v > maxVis) { maxVis = v; maxVisDate = r.date; }
      }
      return { maxCa, maxCaDate, maxVis, maxVisDate };
    },
  });
  const weekHoldsRecordCa = !!(histRecords && displayWeek && histRecords.maxCaDate &&
    parseYmd(histRecords.maxCaDate) >= displayWeek.monday &&
    parseYmd(histRecords.maxCaDate) <= addDays(displayWeek.monday, 6));
  const weekHoldsRecordVis = !!(histRecords && displayWeek && histRecords.maxVisDate &&
    parseYmd(histRecords.maxVisDate) >= displayWeek.monday &&
    parseYmd(histRecords.maxVisDate) <= addDays(displayWeek.monday, 6));

  if (isLoading || !currentWeek) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
        Chargement des données…
      </div>
    );
  }

  const caVariation =
    comparePrevValue > 0 ? ((compareCurrent - comparePrevValue) / comparePrevValue) * 100 : 0;
  const visVariation =
    comparePrevVisitors > 0
      ? ((compareCurrentVisitors - comparePrevVisitors) / comparePrevVisitors) * 100
      : 0;
  const objPct = displayWeek && displayWeek.objectif > 0 ? (displayWeek.ca / displayWeek.objectif) * 100 : 0;

  const weekLabel = displayWeek
    ? `Semaine du ${displayWeek.monday.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })} au ${addDays(displayWeek.monday, 6).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" })}`
    : "";
  const isPartialCurrent = isCurrentSelected && hasCurrentData && currentWeekDates.length < 7;
  const compareLabel = isPartialCurrent
    ? `${pct(caVariation)} vs S-1 (à ${currentWeekDates.length} j comparables)`
    : comparePrev
      ? `${pct(caVariation)} vs S-1`
      : "—";
  const compareVisLabel = isPartialCurrent
    ? `${pct(visVariation)} vs S-1 (à ${currentWeekDates.length} j comparables)`
    : comparePrev
      ? `${pct(visVariation)} vs S-1`
      : "—";

  const objectifActuel = objectifActuelObj;



  return (
    <div className="space-y-4">
      {/* Bandeau de contexte semaine */}
      <Card
        className="p-3 sm:p-4 flex flex-wrap items-center gap-3 border-l-4"
        style={{ borderLeftColor: "hsl(var(--space-salle))" }}
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => canPrev && setSelectedKey(weeks[displayIdx - 1].key)}
            disabled={!canPrev}
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => canNext && setSelectedKey(weeks[displayIdx + 1].key)}
            disabled={!canNext}
            aria-label="Semaine suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Affichage : </span>
          <span className="font-semibold">{weekLabel}</span>
          {isFallback && (
            <span className="ml-2 text-xs text-muted-foreground">— dernière semaine saisie</span>
          )}
        </div>
        {!isCurrentSelected && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setSelectedKey(currentWeek.key)}
          >
            Cette semaine
          </Button>
        )}
        {isFallback && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">
            <Info className="h-3 w-3" />
            Aucune saisie cette semaine pour l'instant
          </span>
        )}
        {isPartialCurrent && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            <Info className="h-3 w-3" />
            {currentWeekDates.length}/7 jours saisis — comparaisons à jours comparables
          </span>
        )}
      </Card>

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label={isFallback ? "Le Pulse — dernière semaine saisie" : "Le Pulse de la semaine"}
          value={eur(displayWeek?.ca ?? 0)}
          sub={compareLabel}
          accent="hsl(var(--hn-purple))"
          positive={caVariation >= 0}
          pulse={!isFallback && caVariation > 0}
          badge={weekHoldsRecordCa ? "Nouveau record" : undefined}
        />
        <KpiTile
          label={isFallback ? "Visiteurs (dernière semaine)" : "Visiteurs semaine"}
          value={(displayWeek?.visiteurs ?? 0).toLocaleString("fr-FR")}
          sub={compareVisLabel}
          accent="hsl(var(--hn-blue))"
          positive={visVariation >= 0}
          badge={weekHoldsRecordVis ? "Record visiteurs" : undefined}
        />
        <ObjectifKpiTile
          ca={displayWeek?.ca ?? 0}
          objectifInter={objectifInterCourant}
          capLT={capLTSemaine}
          objectifActuelJour={Number(objectifActuel?.objectif_jour_ht ?? 0)}
          objectifActuelSemaine={Number(objectifActuel?.objectif_semaine_ht ?? 0)}
        />


        <KpiTile
          label="Meilleure source"
          value={bestSource ? bestSource.label : "—"}
          sub={bestSource ? eur(bestSource.value) : ""}
          accent={bestSource?.color ?? "hsl(var(--hn-purple))"}
        />
      </div>

      {/* Semaine jour par jour — rituel quotidien */}
      <DayByDayCard
        weekMonday={displayWeek?.monday ?? currentWeek.monday}
        rows={rows ?? []}
        onOpenSaisie={(ymd) => navigate(`/salle?d=${ymd}#saisie`)}
      />


      {/* Répartition par source — donut + légende détaillée */}
      <div>
        <Card className="p-4">
          <SectionTitle>Part de chaque source — {weekLabel}</SectionTitle>
          <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] items-center">
            <div className="h-72">
              <DonutHoverCenter
                data={donutData}
                total={eur(donutTotal)}
                totalLabel="TOTAL CA HT"
                innerRadius={60}
                outerRadius={95}
                formatValue={(v) => {
                  const share = donutTotal > 0 ? (v / donutTotal) * 100 : 0;
                  return `${eur(v)} · ${share.toFixed(1)}%`;
                }}
                sliceLabel={(a: any) => {
                  const pctSlice = (a.percent ?? 0) * 100;
                  if (pctSlice < 5) return null;
                  const RAD = Math.PI / 180;
                  const r = a.innerRadius + (a.outerRadius - a.innerRadius) / 2;
                  const x = a.cx + r * Math.cos(-a.midAngle * RAD);
                  const y = a.cy + r * Math.sin(-a.midAngle * RAD);
                  return (
                    <text
                      x={x}
                      y={y}
                      fill="#fff"
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ fontSize: 11, fontWeight: 600, pointerEvents: "none" }}
                    >
                      {`${pctSlice.toFixed(0)}%`}
                    </text>
                  );
                }}
              />
            </div>
            <ul className="space-y-1.5">
              {[...donutData]
                .sort((a, b) => b.value - a.value)
                .map((d) => {
                  const share = donutTotal > 0 ? (d.value / donutTotal) * 100 : 0;
                  return (
                    <li
                      key={d.name}
                      className="grid grid-cols-[10px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/30"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="text-sm truncate">{d.name}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">{eur(d.value)}</span>
                      <span
                        className="text-sm font-semibold tabular-nums w-14 text-right"
                        style={{ color: d.color }}
                      >
                        {share.toFixed(1)}%
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
          {/* Ventilation informative "dont" du pax (déjà comptée dans le CA) */}
          <div className="mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground grid gap-1 sm:grid-cols-2">
            <div className="uppercase tracking-wider text-[10px] font-semibold sm:col-span-2">
              Ventilation du pax (info — déjà incluse dans le CA)
            </div>
            <div>dont jeux : <span className="tabular-nums text-foreground/80">{eur(displayWeek?.bySource["jeux"] ?? 0)}</span></div>
            <div>dont vending Pokémon : <span className="tabular-nums text-foreground/80">{eur(displayWeek?.bySource["ca_vending_pokemon_ht"] ?? 0)}</span></div>
            <div>dont vending Blind Box : <span className="tabular-nums text-foreground/80">{eur(displayWeek?.bySource["ca_vending_blindbox_ht"] ?? 0)}</span></div>
            <div>dont photo : <span className="tabular-nums text-foreground/80">{eur(displayWeek?.bySource["ca_photomaton_ht"] ?? 0)}</span></div>
          </div>
          {/* Merch — hors CA salle, affiché séparément */}
          <div className="mt-2 text-[11px] text-muted-foreground">
            Merch (boutique, hors CA salle) : <span className="tabular-nums text-foreground/80">{eur(displayWeek?.merch ?? 0)}</span>
          </div>
        </Card>
      </div>





      {/* Progression CA hebdo */}
      <Card className="p-4">
        <SectionTitle>Progression du CA par semaine (12 dernières)</SectionTitle>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={weekSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={eurAxis} />
              <Tooltip
                cursor={barTooltipCursor}
                content={
                  <ChartTooltipContent
                    formatter={(v: any, name: any, item: any) => {
                      if (name === "CA HT") {
                        const variation = item?.payload?.variation ?? 0;
                        return [`${eur(Number(v))} (${pct(variation)} vs S-1)`, name];
                      }
                      return [eur(Number(v)), name];
                    }}
                  />
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ca" name="CA HT" fill="hsl(var(--space-salle))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="objectif" name="Objectif" fill="hsl(var(--space-ecommerce) / 0.35)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Progression par jour de semaine */}
      <Card className="p-4">
        <SectionTitle>Progression par jour de semaine (moyennes 4 semaines glissantes)</SectionTitle>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={weekdayCompare}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={eurAxis} />
              <Tooltip
                cursor={barTooltipCursor}
                content={
                  <ChartTooltipContent
                    formatter={(v: any, name: any) => [eur(Number(v)), name]}
                  />
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="4 précédentes" fill="hsl(var(--muted-foreground) / 0.4)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="4 dernières" fill="hsl(var(--space-salle))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Visiteurs + panier */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Progression visiteurs</SectionTitle>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={visitorsSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--primary) / 0.45)", strokeWidth: 1 }}
                  content={
                    <ChartTooltipContent
                      formatter={(v: any, name: any) => [Number(v).toLocaleString("fr-FR"), name]}
                    />
                  }
                />
                <Line type="monotone" dataKey="visiteurs" stroke="hsl(var(--space-pilotage))" strokeWidth={2} dot={false} name="Visiteurs" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <SectionTitle>Panier moyen par visiteur</SectionTitle>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={visitorsSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={eurAxis} />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--primary) / 0.45)", strokeWidth: 1 }}
                  content={
                    <ChartTooltipContent
                      formatter={(v: any, name: any) => [eur(Number(v)), name]}
                    />
                  }
                />
                <Line type="monotone" dataKey="panier" stroke="hsl(var(--space-salle))" strokeWidth={2} dot={false} name="Panier moyen" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>


      {/* Atteinte objectifs — double lecture % (intermédiaire courant + cap long terme) */}
      <Card className="p-4">
        <SectionTitle>Atteinte des objectifs par semaine</SectionTitle>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "hsl(var(--hn-purple))" }} />
            Objectif {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(objectifInterCourant)}/sem.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1 w-3 rounded-sm" style={{ background: "hsl(var(--hn-blue) / 0.7)" }} />
            Cap long terme {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(capLTSemaine)}/sem.
          </span>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {objectifSeries.map((w) => {
            const reached = w.pct >= 100;
            const interFill = Math.min(100, w.pct);
            const ltFill = Math.min(100, w.pctLT);
            return (
              <div key={w.label} className="grid grid-cols-[70px_1fr] items-center gap-3">
                <div className="text-xs font-medium tabular-nums">{w.label}</div>
                <div className="space-y-1">
                  {/* Barre 1 — Objectif intermédiaire */}
                  <div className="grid grid-cols-[1fr_44px] items-center gap-2">
                    <div className="relative w-full h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${interFill}%`,
                          background: reached
                            ? "linear-gradient(90deg, hsl(var(--space-ecommerce)) 0%, hsl(var(--hn-purple)) 100%)"
                            : "hsl(var(--hn-purple))",
                          boxShadow: reached ? "0 0 8px hsl(var(--hn-purple) / 0.55)" : undefined,
                        }}
                      />
                    </div>
                    <div
                      className="text-right text-xs tabular-nums font-semibold"
                      style={{ color: reached ? "hsl(var(--space-ecommerce))" : "hsl(var(--hn-purple))" }}
                    >
                      {w.pct} %
                    </div>
                  </div>
                  {/* Barre 2 — Cap long terme (plus fine, discrète) */}
                  <div className="grid grid-cols-[1fr_44px] items-center gap-2">
                    <div className="relative w-full h-1 rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${ltFill}%`, background: "hsl(var(--hn-blue) / 0.7)" }}
                      />
                    </div>
                    <div className="text-right text-[10px] tabular-nums text-muted-foreground">
                      {w.pctLT} %
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}


function KpiTile({
  label,
  value,
  sub,
  accent,
  progress,
  positive,
  pulse,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  progress?: number;
  positive?: boolean;
  pulse?: boolean;
  badge?: string;
}) {
  return (
    <Card
      className={`p-4 border-l-4 ${pulse ? "hn-pulse" : ""}`}
      style={{ borderLeftColor: accent }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        {badge && (
          <span className="hn-record-badge hn-record-badge--sm shrink-0" title={badge}>⚡ {badge}</span>
        )}
      </div>
      <div className="hn-kpi-value mt-1 text-2xl font-bold" style={{ color: accent }}>
        {value}
      </div>
      {sub && (
        <div
          className="text-xs mt-1"
          style={{
            color:
              positive === undefined
                ? "hsl(var(--muted-foreground))"
                : positive
                  ? "hsl(var(--space-ecommerce))"
                  : "hsl(var(--space-sav))",
          }}
        >
          {sub}
        </div>
      )}
      {typeof progress === "number" && <Progress value={progress} className="mt-2 h-1.5" indicatorColor={accent} />}
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  );
}

/**
 * Barre de progression à double lecture :
 *  - échelle 0 → cap long terme
 *  - remplissage = ca / cap
 *  - marqueur vertical fin (Neon Purple) = position de l'objectif intermédiaire
 *  - quand ca ≥ objectif intermédiaire : remplissage complet jusqu'à l'objectif + glow léger
 */
function DualTargetBar({
  ca,
  objectif,
  capLT,
  heightClass = "h-2",
}: {
  ca: number;
  objectif: number;
  capLT: number;
  heightClass?: string;
}) {
  const cap = Math.max(capLT, objectif, 1);
  const fillPct = Math.min(100, (ca / cap) * 100);
  const markerPct = Math.min(100, (objectif / cap) * 100);
  const reached = objectif > 0 && ca >= objectif;
  return (
    <div
      className={`relative w-full ${heightClass} rounded-full bg-muted/50 overflow-hidden`}
      title={`Cap long terme : ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cap)} / semaine`}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${fillPct}%`,
          background: reached
            ? "linear-gradient(90deg, hsl(var(--space-ecommerce)) 0%, hsl(var(--hn-purple)) 100%)"
            : "hsl(var(--space-salle))",
          boxShadow: reached ? "0 0 10px hsl(var(--hn-purple) / 0.55)" : undefined,
        }}
      />
      {objectif > 0 && markerPct < 100 && (
        <div
          className="absolute top-[-2px] bottom-[-2px] w-px"
          style={{
            left: `${markerPct}%`,
            background: "hsl(var(--hn-purple))",
            boxShadow: "0 0 4px hsl(var(--hn-purple) / 0.6)",
          }}
          title={`Objectif intermédiaire : ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(objectif)}`}
        />
      )}
    </div>
  );
}

/**
 * Tuile KPI "Objectif semaine" — DEUX barres de progression :
 *  1) Objectif intermédiaire courant (Neon Purple, célébration ≥100 %)
 *  2) Cap long terme (barre fine, discrète)
 */
function ObjectifKpiTile({
  ca,
  objectifInter,
  capLT,
  objectifActuelJour,
  objectifActuelSemaine,
}: {
  ca: number;
  objectifInter: number;
  capLT: number;
  objectifActuelJour?: number;
  objectifActuelSemaine?: number;
}) {
  const eur0 = (n: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  const pctInter = objectifInter > 0 ? (ca / objectifInter) * 100 : 0;
  const pctLT = capLT > 0 ? (ca / capLT) * 100 : 0;
  const reached = objectifInter > 0 && ca >= objectifInter;
  const accent = reached ? "hsl(var(--space-ecommerce))" : "hsl(var(--hn-purple))";
  const interFill = Math.min(100, pctInter);
  const ltFill = Math.min(100, pctLT);
  const hasActuel = (objectifActuelJour ?? 0) > 0 || (objectifActuelSemaine ?? 0) > 0;
  return (
    <Card className="p-4 border-l-4" style={{ borderLeftColor: accent }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          Objectif semaine
        </div>
        {reached && (
          <span
            className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded-full"
            style={{
              color: "hsl(var(--space-ecommerce))",
              background: "hsl(var(--space-ecommerce) / 0.12)",
              border: "1px solid hsl(var(--space-ecommerce) / 0.35)",
            }}
          >
            Atteint
          </span>
        )}
      </div>

      {/* Barre 1 — Objectif intermédiaire courant */}
      <div className="mt-2.5">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="text-[11px] font-medium text-foreground/85">
            Objectif {eur0(objectifInter)}/semaine
          </div>
          <div
            className="hn-kpi-value text-base font-bold tabular-nums"
            style={{ color: accent }}
          >
            {Math.round(pctInter)} %
          </div>
        </div>
        <div className="relative w-full h-2.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${interFill}%`,
              background: reached
                ? "linear-gradient(90deg, hsl(var(--space-ecommerce)) 0%, hsl(var(--hn-purple)) 100%)"
                : "hsl(var(--hn-purple))",
              boxShadow: reached ? "0 0 10px hsl(var(--hn-purple) / 0.6)" : undefined,
            }}
          />
        </div>
      </div>

      {/* Barre 2 — Cap long terme (fine, discrète) */}
      <div className="mt-2.5">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="text-[10px] text-muted-foreground">
            Cap long terme {eur0(capLT)}/semaine
          </div>
          <div className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {Math.round(pctLT)} %
          </div>
        </div>
        <div className="relative w-full h-1 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${ltFill}%`, background: "hsl(var(--hn-blue) / 0.7)" }}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end text-[10px] text-muted-foreground">
        <span className="tabular-nums">{eur0(ca)}</span>
      </div>

      {hasActuel && (
        <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
          Objectif actuel : {eur0(objectifActuelJour ?? 0)}/jour · {eur0(objectifActuelSemaine ?? 0)}/semaine
        </div>
      )}
    </Card>

  );
}

/**
 * Carte "Semaine jour par jour" — 7 cases lundi → dimanche pour la semaine sélectionnée.
 * Chaque case : jour + date, CA total, variation % vs même jour S-1, visiteurs.
 * Etats : aujourd'hui (bordure Neon Purple), futur (grisé), passé non saisi (ambre cliquable).
 */
function DayByDayCard({
  weekMonday,
  rows,
  onOpenSaisie,
}: {
  weekMonday: Date;
  rows: SalleJournee[];
  onOpenSaisie: (ymd: string) => void;
}) {
  const todayYmd = toYmd(new Date());
  const rowByDate = useMemo(() => {
    const m = new Map<string, SalleJournee>();
    for (const r of rows) m.set(r.date, r);
    return m;
  }, [rows]);
  const dayNames = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekMonday, i);
    const ymd = toYmd(d);
    const row = rowByDate.get(ymd) ?? null;
    const prevRow = rowByDate.get(toYmd(addDays(d, -7))) ?? null;
    const ca = row ? journeeCaTotal(row) : 0;
    const prevCa = prevRow ? journeeCaTotal(prevRow) : 0;
    const variation = row && prevCa > 0 ? ((ca - prevCa) / prevCa) * 100 : null;
    const isToday = ymd === todayYmd;
    const isFuture = ymd > todayYmd;
    const isPastEmpty = ymd < todayYmd && !row;
    return {
      ymd,
      dayName: dayNames[i],
      dayShort: d.toLocaleDateString("fr-FR", { weekday: "short" }),
      dateLabel: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
      ca,
      variation,
      visiteurs: row ? Number(row.visiteurs ?? 0) : 0,
      row,
      isToday,
      isFuture,
      isPastEmpty,
    };
  });

  return (
    <Card className="p-3 sm:p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <SectionTitle>Semaine jour par jour</SectionTitle>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          CA total du jour vs même jour S-1
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
        {days.map((d) => {
          const clickable = d.isPastEmpty;
          const Tag: any = clickable ? "button" : "div";
          const base =
            "flex flex-col rounded-lg border p-2.5 text-left transition min-w-0";
          let cls = "";
          let style: React.CSSProperties = {};
          if (d.isToday) {
            cls = "bg-card";
            style = {
              borderColor: "hsl(var(--hn-purple))",
              boxShadow: "0 0 0 1px hsl(var(--hn-purple) / 0.35), 0 0 12px hsl(var(--hn-purple) / 0.25)",
            };
          } else if (d.isFuture) {
            cls = "border-dashed border-border/50 bg-muted/10 text-muted-foreground/70";
          } else if (d.isPastEmpty) {
            cls =
              "border-dashed border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer";
          } else {
            cls = "border-border bg-card";
          }

          return (
            <Tag
              key={d.ymd}
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => onOpenSaisie(d.ymd) : undefined}
              className={`${base} ${cls}`}
              style={style}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider truncate">
                  {d.dayShort}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {d.dateLabel}
                </span>
              </div>

              {d.isToday && (
                <span
                  className="mt-0.5 text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: "hsl(var(--hn-purple))" }}
                >
                  Aujourd'hui
                </span>
              )}

              {d.isFuture ? (
                <div className="mt-2 text-[11px] text-muted-foreground/60">—</div>
              ) : d.isPastEmpty ? (
                <div className="mt-2 text-[11px] font-medium text-amber-300">
                  à saisir
                </div>
              ) : d.row ? (
                <>
                  <div
                    className="hn-kpi-value mt-1.5 text-base sm:text-lg font-bold tabular-nums leading-none"
                    style={{ color: "hsl(var(--hn-purple))" }}
                  >
                    {eur(d.ca)}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
                    {d.variation === null ? (
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                        <Minus className="h-2.5 w-2.5" /> —
                      </span>
                    ) : d.variation >= 0 ? (
                      <span
                        className="inline-flex items-center gap-0.5 font-semibold tabular-nums"
                        style={{ color: "hsl(var(--space-ecommerce))" }}
                      >
                        <ArrowUp className="h-2.5 w-2.5" />
                        {pct(d.variation)}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-0.5 font-semibold tabular-nums"
                        style={{ color: "hsl(var(--space-sav))" }}
                      >
                        <ArrowDown className="h-2.5 w-2.5" />
                        {pct(d.variation)}
                      </span>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {d.visiteurs.toLocaleString("fr-FR")} vis.
                    </span>
                  </div>
                </>
              ) : (
                <div className="mt-2 text-[11px] text-muted-foreground/70">non saisi</div>
              )}
            </Tag>
          );
        })}
      </div>
    </Card>
  );
}



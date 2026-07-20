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
import { Loader2, Save, Gamepad2, CalendarDays, Info } from "lucide-react";
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
  { key: "ca_cartes_ht", label: "Cartes cashless", color: "hsl(320 85% 62%)" },
  { key: "ca_pax_ht", label: "TPA jeux (CB)", color: "hsl(263 85% 68%)" },
  { key: "ca_merch_ht", label: "Merch Hypernova", color: "hsl(30 95% 55%)" },
  { key: "ca_vending_pokemon_ht", label: "Vending Pokémon", color: "hsl(210 100% 62%)" },
  { key: "ca_vending_blindbox_ht", label: "Vending Blind Box", color: "hsl(142 71% 45%)" },
  { key: "ca_photomaton_ht", label: "Photomaton", color: "hsl(188 94% 55%)" },
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

const journeeCaTotal = (j: SalleJournee): number =>
  SOURCES.reduce((s, src) => s + Number(j[src.key] ?? 0), 0);

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function Salle() {
  const { canAccessSalle, isLoading, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const initialTab = location.hash === "#dashboard" ? "dashboard" : "saisie";
  const [tab, setTab] = useState<"saisie" | "dashboard">(initialTab);

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
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/70 backdrop-blur-md px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
          <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate flex items-center gap-2">
            <Gamepad2 className="h-5 w-5" style={{ color: "hsl(var(--space-salle))" }} />
            Salle <span className="text-primary text-glow-purple">Hyper</span>{" "}
            <span className="text-secondary text-glow-green">Nova</span>
          </h1>
          <AppTopNav />
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-6">
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="saisie" className="text-base">Saisie du jour</TabsTrigger>
            <TabsTrigger value="dashboard" className="text-base">Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="saisie">
            <SaisieTab userId={user?.id ?? null} />
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

function SaisieTab({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(toYmd(new Date()));
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

  const totalHT = SOURCES.reduce((s, src) => s + Number((form as any)[src.key] ?? 0), 0);

  const save = async () => {
    setSaving(true);
    const payload = { date, ...form, saisi_par: userId };
    const { error } = await (supabase as any)
      .from("salle_journees")
      .upsert(payload, { onConflict: "date" });
    setSaving(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: existing ? "Journée mise à jour" : "Journée enregistrée", description: date });
    qc.invalidateQueries({ queryKey: ["salle_journee", date] });
    qc.invalidateQueries({ queryKey: ["salle_semaine", weekMondayStr] });
    qc.invalidateQueries({ queryKey: ["salle_dashboard"] });
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

        <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Total journée</div>
          <div className="text-right">
            <div className="text-2xl font-semibold" style={{ color: "hsl(var(--space-salle))" }}>
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
  visiteurs: number;
  objectif: number;
  bySource: Record<string, number>;
};

function DashboardTab() {
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
        visiteurs: 0,
        objectif: Number(obj?.objectif_semaine_ht ?? 0),
        bySource: Object.fromEntries(SOURCES.map((s) => [s.key as string, 0])),
      });
    }
    for (const r of rows) {
      const k = weekKey(parseYmd(r.date));
      const w = map.get(k);
      if (!w) continue;
      w.ca += journeeCaTotal(r);
      w.visiteurs += Number(r.visiteurs ?? 0);
      for (const s of SOURCES) w.bySource[s.key as string] += Number((r as any)[s.key] ?? 0);
    }
    return Array.from(map.values()).sort((a, b) => a.monday.getTime() - b.monday.getTime());
    // objectifs listed in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, objectifs]);

  // Semaine courante & précédente
  const currentWeek = weeks[weeks.length - 1];
  const prevWeek = weeks[weeks.length - 2];
  const bestSource = useMemo(() => {
    if (!currentWeek) return null;
    let best: { label: string; value: number; color: string } | null = null;
    for (const s of SOURCES) {
      const v = currentWeek.bySource[s.key as string] ?? 0;
      if (!best || v > best.value) best = { label: s.label, value: v, color: s.color };
    }
    return best;
  }, [currentWeek]);

  // Semaine courante : barres empilées par jour
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

  // Progression semaine (courbe + variation %)
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

  // Objectif — donnée dérivée
  const objectifSeries = useMemo(() => {
    return weeks.map((w) => ({
      label: w.label,
      pct: w.objectif > 0 ? Math.min(200, Math.round((w.ca / w.objectif) * 100)) : 0,
    }));
  }, [weeks]);

  // Donut sur période sélectionnée (par défaut : semaine courante)
  const donutData = useMemo(() => {
    if (!currentWeek) return [];
    return SOURCES.map((s) => ({
      name: s.label,
      value: Math.round(currentWeek.bySource[s.key as string] ?? 0),
      color: s.color,
    })).filter((d) => d.value > 0);
  }, [currentWeek]);
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  if (isLoading || !currentWeek) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
        Chargement des données…
      </div>
    );
  }

  const caVariation =
    prevWeek && prevWeek.ca > 0 ? ((currentWeek.ca - prevWeek.ca) / prevWeek.ca) * 100 : 0;
  const visVariation =
    prevWeek && prevWeek.visiteurs > 0
      ? ((currentWeek.visiteurs - prevWeek.visiteurs) / prevWeek.visiteurs) * 100
      : 0;
  const objPct = currentWeek.objectif > 0 ? (currentWeek.ca / currentWeek.objectif) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="CA semaine en cours"
          value={eur(currentWeek.ca)}
          sub={prevWeek ? `${pct(caVariation)} vs S-1` : "—"}
          accent="hsl(var(--space-salle))"
          positive={caVariation >= 0}
        />
        <KpiTile
          label="Visiteurs semaine"
          value={currentWeek.visiteurs.toLocaleString("fr-FR")}
          sub={prevWeek ? `${pct(visVariation)} vs S-1` : "—"}
          accent="hsl(var(--space-pilotage))"
          positive={visVariation >= 0}
        />
        <KpiTile
          label="Objectif semaine"
          value={`${Math.round(objPct)} %`}
          sub={currentWeek.objectif ? `Cible ${eur(currentWeek.objectif)}` : "Pas d'objectif"}
          accent="hsl(var(--space-ecommerce))"
          progress={Math.min(100, objPct)}
        />
        <KpiTile
          label="Meilleure source"
          value={bestSource ? bestSource.label : "—"}
          sub={bestSource ? eur(bestSource.value) : ""}
          accent={bestSource?.color ?? "hsl(var(--space-commerce))"}
        />
      </div>

      {/* Semaine courante : barres empilées */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionTitle>Répartition par source — semaine courante</SectionTitle>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={currentWeekDays}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
                <Tooltip content={<StackTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SOURCES.map((s) => (
                  <Bar key={s.key as string} dataKey={s.key as string} stackId="a" fill={s.color} name={s.label} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle>Part de chaque source</SectionTitle>
          <div className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={donutData} dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="none">
                  {donutData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => {
                    const share = donutTotal > 0 ? (Number(value) / donutTotal) * 100 : 0;
                    return [`${eur(Number(value))} (${share.toFixed(1)}%)`, name];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Total : <span className="font-semibold text-foreground">{eur(donutTotal)}</span>
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
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
              <Tooltip
                formatter={(v: any, name: any, item: any) => {
                  if (name === "CA HT") {
                    const variation = item?.payload?.variation ?? 0;
                    return [`${eur(Number(v))} (${pct(variation)} vs S-1)`, name];
                  }
                  return [eur(Number(v)), name];
                }}
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
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} />
              <Tooltip formatter={(v: any) => eur(Number(v))} />
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
                <Tooltip />
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
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `${v}€`} />
                <Tooltip formatter={(v: any) => eur(Number(v))} />
                <Line type="monotone" dataKey="panier" stroke="hsl(var(--space-salle))" strokeWidth={2} dot={false} name="Panier moyen" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Atteinte objectifs */}
      <Card className="p-4">
        <SectionTitle>Atteinte des objectifs par semaine</SectionTitle>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {objectifSeries.map((w) => (
            <div key={w.label} className="grid grid-cols-[60px_1fr_60px] items-center gap-3">
              <div className="text-xs font-medium tabular-nums">{w.label}</div>
              <Progress
                value={Math.min(100, w.pct)}
                className="h-2"
                indicatorColor={w.pct >= 100 ? "hsl(var(--space-ecommerce))" : "hsl(var(--space-salle))"}
              />
              <div
                className="text-right text-xs tabular-nums font-semibold"
                style={{ color: w.pct >= 100 ? "hsl(var(--space-ecommerce))" : "hsl(var(--space-salle))" }}
              >
                {w.pct} %
              </div>
            </div>
          ))}
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
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  progress?: number;
  positive?: boolean;
}) {
  return (
    <Card className="p-4 border-l-4" style={{ borderLeftColor: accent }}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: accent }}>
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

function StackTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + Number(p.value ?? 0), 0);
  return (
    <div className="rounded-md border border-border bg-popover text-popover-foreground p-2 text-xs shadow-lg">
      <div className="font-semibold mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="flex-1">{p.name}</span>
          <span className="tabular-nums font-medium">{eur(Number(p.value))}</span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t border-border flex justify-between font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{eur(total)}</span>
      </div>
    </div>
  );
}

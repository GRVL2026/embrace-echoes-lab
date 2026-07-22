import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown, Minus, Users, Loader2, ArrowRight, ChevronRight, Sparkles, RotateCcw, Info, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";

type EntrepriseState = "ok" | "a_valider" | "introuvable" | "cessee";

const STATE_META: Record<EntrepriseState, { label: string; dot: string; badge: string; icon: string }> = {
  ok: { label: "OK", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", icon: "🟢" },
  a_valider: { label: "À valider", dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-500 border-amber-500/30", icon: "🟡" },
  introuvable: { label: "Introuvable", dot: "bg-muted-foreground/60", badge: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/30", icon: "⚪" },
  cessee: { label: "Cessée / procédure", dot: "bg-red-500", badge: "bg-red-500/10 text-red-500 border-red-500/30", icon: "🔴" },
};

// Seuils de rentabilité par rapport à la moyenne portefeuille (22,4 % sur 2026).
// Ajustables ici — commentés pour rester lisibles.
const MARGIN_AVG = 22.4;           // référence portefeuille (%)
const MARGIN_GREEN = 27;           // >= : nettement au-dessus (vert)
const MARGIN_NEUTRAL_LOW = 18;     // >= : proche moyenne (neutre)
const MARGIN_ORANGE_LOW = 10;      // >= : nettement en-dessous (orange), < : rouge

function marginTone(rate: number | null): { color: string; label: string } {
  if (rate == null) return { color: "bg-muted-foreground/40", label: "Marge inconnue" };
  if (rate >= MARGIN_GREEN) return { color: "bg-emerald-500", label: `Rentabilité élevée (${rate.toFixed(1)} %)` };
  if (rate >= MARGIN_NEUTRAL_LOW) return { color: "bg-sky-500/70", label: `Proche de la moyenne (${rate.toFixed(1)} %)` };
  if (rate >= MARGIN_ORANGE_LOW) return { color: "bg-orange-500", label: `Sous la moyenne (${rate.toFixed(1)} %)` };
  return { color: "bg-red-500", label: `Rentabilité faible (${rate.toFixed(1)} %)` };
}

type EntrepriseRow = {
  code_client: string | null;
  etat_administratif: string | null;
  procedure_collective: boolean | null;
  match_statut: string | null;
};

function computeState(e: EntrepriseRow | undefined): EntrepriseState {
  if (!e) return "introuvable";
  if (e.etat_administratif === "C" || e.procedure_collective === true) return "cessee";
  if (e.match_statut === "a_valider") return "a_valider";
  if (e.match_statut === "introuvable") return "introuvable";
  if ((e.match_statut === "auto" || e.match_statut === "valide") && e.etat_administratif === "A") return "ok";
  return "introuvable";
}

type CaClient = {
  code_client: string | null;
  client: string | null;
  annee: number | null;
  ca_ht: number | null;
};

type MargeClient = {
  annee: number | null;
  client: string | null;
  ca_ht: number | null;
  ca_avec_cout: number | null;
  marge_estimee: number | null;
  part_reelle: number | null;
};

type Anciennete = {
  client: string | null;
  premier_exercice: number | null;
  dernier_exercice_actif: number | null;
  dernier_exercice_avant_courant: number | null;
};

type ClientKind = "nouveau" | "reactive" | "normal";
type SortKey = "ca_current" | "marge" | "taux";

type Row = {
  client: string;
  code_client: string | null;
  ca_current: number;
  ca_prev: number;
  evolution: number | null; // %
  kind?: ClientKind;
  dernier_exercice_actif?: number | null;
  marge?: number | null;         // €
  ca_avec_cout?: number | null;  // €
  taux?: number | null;          // %
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

function EvolutionCell({ ev, kind, dernier }: { ev: number | null; kind?: ClientKind; dernier?: number | null }) {
  if (kind === "nouveau") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-500" title="Première facture cet exercice">
        <Sparkles className="h-3.5 w-3.5" /> nouveau
      </span>
    );
  }
  if (kind === "reactive") {
    return (
      <span
        className="inline-flex flex-col items-end leading-tight"
        title={dernier ? `Dernier achat : exercice ${dernier}` : undefined}
      >
        <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-500">
          <RotateCcw className="h-3.5 w-3.5" /> réactivé
        </span>
        {dernier && <span className="text-[10px] text-muted-foreground">absent depuis {dernier}</span>}
      </span>
    );
  }
  const evClass =
    ev == null ? "text-muted-foreground"
    : ev >= 5 ? "text-secondary"
    : ev <= -5 ? "text-destructive"
    : "text-muted-foreground";
  const Icon = ev == null ? Minus : ev >= 5 ? TrendingUp : ev <= -5 ? TrendingDown : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm font-medium", evClass)}>
      <Icon className="h-3.5 w-3.5" />
      {ev == null ? "—" : `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%`}
    </span>
  );
}

/** Page /clients — liste des clients avec CA et évolution vs N-1. */
export default function Clients() {
  const { canAccessDashboard, isDirection, canMargeClient, canMargeGlobale, loading } = useAuth();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<EntrepriseState | "all">("all");
  const [kindFilter, setKindFilter] = useState<ClientKind | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("ca_current");

  const { data, isPending } = useQuery({
    queryKey: ["clients-ca-agg"],
    enabled: canAccessDashboard,
    queryFn: async () => {
      const c: any = supabase;
      // 1. Exercices disponibles via RPC (pas de risque de troncature)
      const { data: exYears, error: exErr } = await c.rpc("get_gaia_exercices");
      if (exErr) throw exErr;
      const years = ((exYears as { annee: number }[]) ?? [])
        .map((r) => Number(r.annee))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);
      const current = years[0];
      const prev = years[1];
      if (current == null || prev == null) {
        return { rows: [] as Row[], current, prev };
      }

      // 2. CA par client (agrégé côté serveur : une ligne par client, courant + précédent)
      const { data: rows, error } = await c.rpc("get_ca_client", {
        _annee: current,
        _annee_prev: prev,
      });
      if (error) throw error;
      const list = ((rows as {
        code_client: string | null;
        client: string | null;
        ca_current: number | null;
        ca_prev: number | null;
      }[]) ?? []).map((r) => {
        const caCur = Number(r.ca_current) || 0;
        const caPrev = Number(r.ca_prev) || 0;
        return {
          client: (r.client ?? "").trim(),
          code_client: r.code_client ?? null,
          ca_current: caCur,
          ca_prev: caPrev,
          evolution:
            caPrev > 0
              ? ((caCur - caPrev) / caPrev) * 100
              : caCur > 0
                ? null
                : 0,
        } as Row;
      }).filter((r) => r.client);
      list.sort((a, b) => b.ca_current - a.ca_current);
      return { rows: list, current, prev };
    },
  });

  const { data: margeMap } = useQuery({
    queryKey: ["clients-marge", data?.current],
    enabled: canAccessDashboard && canMargeClient && data?.current != null,
    queryFn: async () => {
      // Filtrage par exercice côté SQL — évite la troncature à 1000 lignes.
      const { data: rows, error } = await (supabase as any).rpc("get_marge_client", {
        _annee: data?.current,
      });
      if (error) throw error;
      const map = new Map<string, MargeClient>();
      for (const r of (rows as MargeClient[]) ?? []) {
        if (r.client) map.set(r.client.trim(), r);
      }
      return map;
    },
  });

  const { data: entMap } = useQuery({
    queryKey: ["clients-entreprises-state"],
    enabled: canAccessDashboard && isDirection,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("gaia_entreprises")
        .select("code_client, etat_administratif, procedure_collective, match_statut");
      if (error) throw error;
      const map = new Map<string, EntrepriseRow>();
      for (const r of (rows as EntrepriseRow[]) ?? []) {
        if (r.code_client) map.set(r.code_client.trim(), r);
      }
      return map;
    },
  });

  const { data: ancMap } = useQuery({
    queryKey: ["clients-anciennete"],
    enabled: canAccessDashboard,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("v_gaia_client_anciennete")
        .select("client, premier_exercice, dernier_exercice_actif, dernier_exercice_avant_courant");
      if (error) throw error;
      const map = new Map<string, Anciennete>();
      for (const r of (rows as Anciennete[]) ?? []) {
        if (r.client) map.set(r.client.trim(), r);
      }
      return map;
    },
  });

  const rowsWithState = useMemo(() => {
    const list = data?.rows ?? [];
    const current = data?.current;
    return list.map((r) => {
      const anc = ancMap?.get(r.client.trim());
      let kind: ClientKind = "normal";
      if (anc && current != null && anc.premier_exercice != null) {
        if (anc.premier_exercice === current && r.ca_current > 0) kind = "nouveau";
        else if (anc.premier_exercice < current && r.ca_prev === 0 && r.ca_current > 0) kind = "reactive";
      } else if (r.ca_prev === 0 && r.ca_current > 0) {
        // fallback si pas d'ancienneté connue
        kind = "nouveau";
      }
      const m = canMargeClient ? margeMap?.get(r.client.trim()) : undefined;
      const marge = m?.marge_estimee != null ? Number(m.marge_estimee) : null;
      const caCout = m?.ca_avec_cout != null ? Number(m.ca_avec_cout) : null;
      const taux = marge != null && caCout && caCout > 0 ? (marge / caCout) * 100 : null;
      return {
        ...r,
        kind,
        dernier_exercice_actif: anc?.dernier_exercice_avant_courant ?? null,
        state: isDirection ? computeState(entMap?.get((r.code_client ?? "").trim())) : null,
        marge,
        ca_avec_cout: caCout,
        taux,
      };
    });
  }, [data, entMap, ancMap, isDirection, canMargeClient, margeMap]);

  const stateCounts = useMemo(() => {
    const counts = { all: rowsWithState.length, ok: 0, a_valider: 0, introuvable: 0, cessee: 0 };
    if (!isDirection) return counts;
    for (const r of rowsWithState) if (r.state) counts[r.state]++;
    return counts;
  }, [rowsWithState, isDirection]);

  const kindCounts = useMemo(() => {
    const counts = { all: rowsWithState.length, nouveau: 0, reactive: 0, normal: 0 };
    for (const r of rowsWithState) counts[r.kind ?? "normal"]++;
    return counts;
  }, [rowsWithState]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rowsWithState;
    if (isDirection && stateFilter !== "all") {
      list = list.filter((r) => r.state === stateFilter);
    }
    if (kindFilter !== "all") {
      list = list.filter((r) => r.kind === kindFilter);
    }
    if (q) {
      list = list.filter(
        (r) =>
          r.client.toLowerCase().includes(q) ||
          (r.code_client ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      const va =
        sortKey === "ca_current" ? a.ca_current
        : sortKey === "marge" ? (a.marge ?? -Infinity)
        : (a.taux ?? -Infinity);
      const vb =
        sortKey === "ca_current" ? b.ca_current
        : sortKey === "marge" ? (b.marge ?? -Infinity)
        : (b.taux ?? -Infinity);
      return vb - va;
    });
    return sorted;
  }, [rowsWithState, search, stateFilter, kindFilter, isDirection, sortKey]);

  // Totaux dynamiques selon filtres actifs
  const totals = useMemo(() => {
    let caCur = 0, caPrev = 0, marge = 0, caCout = 0;
    for (const r of filtered) {
      caCur += r.ca_current;
      caPrev += r.ca_prev;
      if (canMargeGlobale) {
        if (typeof r.marge === "number") marge += r.marge;
        if (typeof r.ca_avec_cout === "number") caCout += r.ca_avec_cout;
      }
    }
    const evolution = caPrev > 0 ? ((caCur - caPrev) / caPrev) * 100 : null;
    const taux = caCout > 0 ? (marge / caCout) * 100 : null;
    const couverture = caCur > 0 ? (caCout / caCur) * 100 : null;
    return { count: filtered.length, caCur, caPrev, evolution, marge, taux, couverture };
  }, [filtered, canMargeGlobale]);

  if (loading) return null;
  if (!canAccessDashboard) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Vous n'avez pas accès aux données clients.
      </div>
    );
  }

  const location = useLocation();
  const fromState = { from: location.pathname + location.search };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => setSortKey(k)}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
        sortKey === k && "text-primary",
      )}
    >
      {label}
      {sortKey === k && <ArrowDown className="h-3 w-3" />}
    </button>
  );

  return (
    <>
      <DetailPageHeader
        className="md:hidden"
        backTo="/"
        backLabel="Retour au hub"
        title="Clients"
        subtitle={`CA ${data?.current ?? "en cours"} vs ${data?.prev ?? "N-1"}`}
        actions={<div className="flex items-center gap-1"><MobileNav /><UserMenu /></div>}
      />
      <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto w-full">
      <header className="hidden md:flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Clients</h1>
            <p className="text-sm text-muted-foreground">
              Chiffre d'affaires exercice {data?.current ?? "en cours"} — évolution vs {data?.prev ?? "N-1"}
            </p>
          </div>
        </div>
        {canMargeGlobale && (
          <Link
            to="/admin/matrice-clients"
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-500 hover:bg-sky-500/20 transition-colors"
          >
            <span className="text-base leading-none">▦</span> Voir la matrice CA × marge
          </Link>
        )}
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un client (nom ou code)…"
          className="pl-9"
        />
      </div>

      {false && isDirection && (
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["all", "Tous"],
            ["ok", `${STATE_META.ok.icon} OK`],
            ["a_valider", `${STATE_META.a_valider.icon} À valider`],
            ["introuvable", `${STATE_META.introuvable.icon} Introuvable`],
            ["cessee", `${STATE_META.cessee.icon} Cessée / procédure`],
          ] as const).map(([key, label]) => {
            const active = stateFilter === key;
            const count = stateCounts[key as keyof typeof stateCounts];
            return (
              <button
                key={key}
                onClick={() => setStateFilter(key as EntrepriseState | "all")}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5",
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-card/40 border-border hover:border-primary/30 text-muted-foreground",
                )}
              >
                <span>{label}</span>
                <span className={cn("text-[10px] font-mono", active ? "text-primary" : "text-muted-foreground/70")}>
                  {count}
                </span>
              </button>
            );
          })}
          {stateFilter === "a_valider" && (
            <Link
              to="/admin/entreprises"
              className="text-[11px] text-amber-500 underline underline-offset-2 ml-1 flex items-center gap-1"
            >
              Valider les correspondances <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["all", "Tous"],
          ["nouveau", "✨ Nouveaux"],
          ["reactive", "🔄 Réactivés"],
        ] as const).map(([key, label]) => {
          const active = kindFilter === key;
          const count = kindCounts[key as keyof typeof kindCounts];
          return (
            <button
              key={key}
              onClick={() => setKindFilter(key as ClientKind | "all")}
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5",
                active
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-card/40 border-border hover:border-primary/30 text-muted-foreground",
              )}
            >
              <span>{label}</span>
              <span className={cn("text-[10px] font-mono", active ? "text-primary" : "text-muted-foreground/70")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bandeau de totaux — reflète exactement la sélection en cours */}
      <div className="rounded-lg border border-border bg-card/40 p-3 sm:p-4">
        <div className={cn("grid gap-3", canMargeGlobale ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3")}>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Clients</div>
            <div className="font-mono text-lg font-semibold">{totals.count}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CA {data?.current ?? ""}</div>
            <div className="font-mono text-lg font-semibold">{eur(totals.caCur)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              CA {data?.prev ?? ""}
              {totals.evolution != null && (
                <span className={cn(
                  "ml-1 font-medium",
                  totals.evolution >= 5 ? "text-secondary" : totals.evolution <= -5 ? "text-destructive" : "text-muted-foreground",
                )}>
                  ({totals.evolution >= 0 ? "+" : ""}{totals.evolution.toFixed(1)}%)
                </span>
              )}
            </div>
            <div className="font-mono text-lg text-muted-foreground">{eur(totals.caPrev)}</div>
          </div>
          {canMargeGlobale && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Marge €</div>
                <div className="font-mono text-lg font-semibold">{eur(totals.marge)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Taux moyen</div>
                <div className="font-mono text-lg font-semibold">
                  {totals.taux != null ? `${totals.taux.toFixed(1)} %` : "—"}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      {!isPending && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Aucun client ne correspond.
        </div>
      )}

      {/* Tri (visible sur desktop dans l'entête ; mobile a des boutons compacts) */}
      {canMargeClient && !isPending && filtered.length > 0 && (
        <div className="md:hidden flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Trier :</span>
          <button onClick={() => setSortKey("ca_current")} className={cn("px-2 py-0.5 rounded border", sortKey === "ca_current" ? "border-primary/40 text-primary" : "border-border")}>CA</button>
          <button onClick={() => setSortKey("marge")} className={cn("px-2 py-0.5 rounded border", sortKey === "marge" ? "border-primary/40 text-primary" : "border-border")}>Marge €</button>
          <button onClick={() => setSortKey("taux")} className={cn("px-2 py-0.5 rounded border", sortKey === "taux" ? "border-primary/40 text-primary" : "border-border")}>Taux %</button>
        </div>
      )}

      {/* MOBILE : liste de cartes */}
      {!isPending && filtered.length > 0 && (
        <div className="md:hidden space-y-2">
          {filtered.map((r) => {
            const tone = canMargeClient ? marginTone(r.taux ?? null) : null;
            return (
              <Link
                key={r.client}
                to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                state={fromState}
                className="block rounded-lg border border-border bg-card/40 p-3 active:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-2">
                  {tone && (
                    <span className={cn("mt-1 h-2 w-2 rounded-full flex-shrink-0", tone.color)} title={tone.label} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm leading-tight line-clamp-2 break-words">
                      {r.client}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      {r.code_client && (
                        <span className="text-[11px] text-muted-foreground">{r.code_client}</span>
                      )}
                      {isDirection && r.state && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-normal",
                            STATE_META[r.state].badge,
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATE_META[r.state].dot)} />
                          {STATE_META[r.state].label}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">
                      <span className="text-muted-foreground text-[11px] mr-1">CA {data?.current}:</span>
                      {eur(r.ca_current)}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      <span className="mr-1">{data?.prev}:</span>
                      {eur(r.ca_prev)}
                    </div>
                    {canMargeClient && (r.marge != null || r.taux != null) && (
                      <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
                        Marge : {r.marge != null ? eur(r.marge) : "—"}
                        {r.taux != null && <span className="ml-1">· {r.taux.toFixed(1)} %</span>}
                      </div>
                    )}
                  </div>
                  <EvolutionCell ev={r.evolution} kind={r.kind} dernier={r.dernier_exercice_actif} />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* DESKTOP : tableau */}
      {!isPending && filtered.length > 0 && (
        <div className="hidden md:block rounded-lg border border-border bg-card/40 overflow-x-auto">
          <div
            className={cn(
              "grid gap-2 px-4 py-2 border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground font-medium",
              canMargeClient
                ? "grid-cols-[1fr_130px_130px_120px_90px_130px] min-w-[820px]"
                : "grid-cols-[1fr_140px_140px_140px] min-w-[640px]",
            )}
          >
            <div>Client</div>
            <div className="text-right">
              <SortBtn k="ca_current" label={`CA ${data?.current ?? ""}`} />
            </div>
            <div className="text-right">CA {data?.prev ?? ""}</div>
            {canMargeClient && (
              <>
                <div className="text-right"><SortBtn k="marge" label="Marge €" /></div>
                <div className="text-right"><SortBtn k="taux" label="Taux %" /></div>
              </>
            )}
            <div className="text-right">Évolution</div>
          </div>
          {filtered.map((r) => {
            const tone = canMargeClient ? marginTone(r.taux ?? null) : null;
            return (
              <Link
                key={r.client}
                to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                state={fromState}
                className={cn(
                  "grid gap-2 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors items-center",
                  canMargeClient
                    ? "grid-cols-[1fr_130px_130px_120px_90px_130px] min-w-[820px]"
                    : "grid-cols-[1fr_140px_140px_140px] min-w-[640px]",
                )}
              >
                <div className="min-w-0 flex items-center gap-2">
                  {tone && (
                    <span className={cn("h-2 w-2 rounded-full flex-shrink-0", tone.color)} title={tone.label} />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      <span className="truncate">{r.client}</span>
                      {isDirection && r.state && (
                        <span
                          title={STATE_META[r.state].label}
                          className={cn(
                            "shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-normal",
                            STATE_META[r.state].badge,
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATE_META[r.state].dot)} />
                          {STATE_META[r.state].label}
                        </span>
                      )}
                    </div>
                    {r.code_client && (
                      <div className="text-xs text-muted-foreground truncate">{r.code_client}</div>
                    )}
                  </div>
                </div>
                <div className="text-right font-mono text-sm">{eur(r.ca_current)}</div>
                <div className="text-right font-mono text-sm text-muted-foreground">
                  {eur(r.ca_prev)}
                </div>
                {canMargeClient && (
                  <>
                    <div className="text-right font-mono text-sm">
                      {r.marge != null ? eur(r.marge) : <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="text-right font-mono text-sm">
                      {r.taux != null ? `${r.taux.toFixed(1)} %` : <span className="text-muted-foreground">—</span>}
                    </div>
                  </>
                )}
                <div className="text-right flex items-center justify-end">
                  <EvolutionCell ev={r.evolution} kind={r.kind} dernier={r.dernier_exercice_actif} />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!isPending && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Info className="h-3 w-3 flex-shrink-0" />
            <span>Ancienneté calculée depuis septembre 2022 — un client dont la première facture connue tombe dans l'exercice 2023 pourrait être plus ancien.</span>
          </div>
          <div className="shrink-0 flex flex-col sm:items-end gap-0.5">
            <span>{filtered.length} client{filtered.length > 1 ? "s" : ""} affiché{filtered.length > 1 ? "s" : ""}</span>
            {canMargeGlobale && totals.couverture != null && (
              <span className="text-[10px] italic">
                Marge estimée sur {totals.couverture.toFixed(1)} % du CA au coût connu
              </span>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}

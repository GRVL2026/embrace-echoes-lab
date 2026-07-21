import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown, Minus, Users, Loader2, ArrowRight, ChevronRight, Sparkles, RotateCcw, Info } from "lucide-react";
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

type Anciennete = {
  client: string | null;
  premier_exercice: number | null;
  dernier_exercice_actif: number | null;
};

type ClientKind = "nouveau" | "reactive" | "normal";

type Row = {
  client: string;
  code_client: string | null;
  ca_current: number;
  ca_prev: number;
  evolution: number | null; // %
  kind?: ClientKind;
  dernier_exercice_actif?: number | null;
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** Page /clients — liste des clients avec CA et évolution vs N-1. */
export default function Clients() {
  const { canAccessDashboard, isDirection, loading } = useAuth();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<EntrepriseState | "all">("all");

  const { data, isPending } = useQuery({
    queryKey: ["clients-ca"],
    enabled: canAccessDashboard,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("v_gaia_ca_client")
        .select("*");
      if (error) throw error;
      const list = (rows as CaClient[]) ?? [];

      // Exercice courant = année max présente
      const years = Array.from(
        new Set(list.map((r) => r.annee).filter((n): n is number => typeof n === "number")),
      ).sort((a, b) => b - a);
      const current = years[0];
      const prev = years[1];

      // Regroupe par client (name canonique)
      const map = new Map<string, Row>();
      for (const r of list) {
        const name = (r.client ?? "").trim();
        if (!name) continue;
        const entry: Row = map.get(name) ?? {
          client: name,
          code_client: r.code_client ?? null,
          ca_current: 0,
          ca_prev: 0,
          evolution: null,
        };
        const amount = Number(r.ca_ht) || 0;
        if (r.annee === current) entry.ca_current += amount;
        else if (r.annee === prev) entry.ca_prev += amount;
        if (!entry.code_client && r.code_client) entry.code_client = r.code_client;
        map.set(name, entry);
      }
      const out = Array.from(map.values()).map((r) => ({
        ...r,
        evolution:
          r.ca_prev > 0
            ? ((r.ca_current - r.ca_prev) / r.ca_prev) * 100
            : r.ca_current > 0
              ? null // nouveau client
              : 0,
      }));
      out.sort((a, b) => b.ca_current - a.ca_current);
      return { rows: out, current, prev };
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

  const rowsWithState = useMemo(() => {
    const list = data?.rows ?? [];
    return list.map((r) => ({
      ...r,
      state: isDirection ? computeState(entMap?.get((r.code_client ?? "").trim())) : null,
    }));
  }, [data, entMap, isDirection]);

  const stateCounts = useMemo(() => {
    const counts = { all: rowsWithState.length, ok: 0, a_valider: 0, introuvable: 0, cessee: 0 };
    if (!isDirection) return counts;
    for (const r of rowsWithState) if (r.state) counts[r.state]++;
    return counts;
  }, [rowsWithState, isDirection]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rowsWithState;
    if (isDirection && stateFilter !== "all") {
      list = list.filter((r) => r.state === stateFilter);
    }
    if (!q) return list;
    return list.filter(
      (r) =>
        r.client.toLowerCase().includes(q) ||
        (r.code_client ?? "").toLowerCase().includes(q),
    );
  }, [rowsWithState, search, stateFilter, isDirection]);

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
      <header className="hidden md:flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Chiffre d'affaires exercice {data?.current ?? "en cours"} — évolution vs {data?.prev ?? "N-1"}
          </p>
        </div>
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

      {isDirection && (
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

      {/* MOBILE : liste de cartes */}
      {!isPending && filtered.length > 0 && (
        <div className="md:hidden space-y-2">
          {filtered.map((r) => {
            const ev = r.evolution;
            const evClass =
              ev == null ? "text-secondary"
              : ev >= 5 ? "text-secondary"
              : ev <= -5 ? "text-destructive"
              : "text-muted-foreground";
            const Icon = ev == null ? TrendingUp : ev >= 5 ? TrendingUp : ev <= -5 ? TrendingDown : Minus;
            return (
              <Link
                key={r.client}
                to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                state={fromState}
                className="block rounded-lg border border-border bg-card/40 p-3 active:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-2">
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
                  </div>
                  <div className={cn("flex items-center gap-1 text-sm font-medium", evClass)}>
                    <Icon className="h-3.5 w-3.5" />
                    {ev == null ? "nouveau" : `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%`}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* DESKTOP : tableau */}
      {!isPending && filtered.length > 0 && (
        <div className="hidden md:block rounded-lg border border-border bg-card/40 overflow-x-auto">
          <div className="grid grid-cols-[1fr_140px_140px_140px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground font-medium min-w-[640px]">
            <div>Client</div>
            <div className="text-right">CA {data?.current ?? ""}</div>
            <div className="text-right">CA {data?.prev ?? ""}</div>
            <div className="text-right">Évolution</div>
          </div>
          {filtered.map((r) => {
            const ev = r.evolution;
            const evClass =
              ev == null ? "text-secondary"
              : ev >= 5 ? "text-secondary"
              : ev <= -5 ? "text-destructive"
              : "text-muted-foreground";
            const Icon = ev == null ? TrendingUp : ev >= 5 ? TrendingUp : ev <= -5 ? TrendingDown : Minus;
            return (
              <Link
                key={r.client}
                to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                state={fromState}
                className="grid grid-cols-[1fr_140px_140px_140px] gap-2 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors items-center min-w-[640px]"
              >
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
                <div className="text-right font-mono text-sm">{eur(r.ca_current)}</div>
                <div className="text-right font-mono text-sm text-muted-foreground">
                  {eur(r.ca_prev)}
                </div>
                <div className={cn("text-right flex items-center justify-end gap-1 text-sm font-medium", evClass)}>
                  <Icon className="h-3.5 w-3.5" />
                  {ev == null ? "nouveau" : `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%`}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!isPending && (
        <div className="text-xs text-muted-foreground text-right">
          {filtered.length} client{filtered.length > 1 ? "s" : ""} affiché{filtered.length > 1 ? "s" : ""}
        </div>
      )}
      </div>
    </>
  );
}

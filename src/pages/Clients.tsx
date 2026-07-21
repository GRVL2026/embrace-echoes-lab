import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown, Minus, Users, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

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

type Row = {
  client: string;
  code_client: string | null;
  ca_current: number;
  ca_prev: number;
  evolution: number | null; // %
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** Page /clients — liste des clients avec CA et évolution vs N-1. */
export default function Clients() {
  const { canAccessDashboard, loading } = useAuth();
  const [search, setSearch] = useState("");

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.rows ?? [];
    if (!q) return list;
    return list.filter(
      (r) =>
        r.client.toLowerCase().includes(q) ||
        (r.code_client ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  if (loading) return null;
  if (!canAccessDashboard) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Vous n'avez pas accès aux données clients.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto w-full">
      <header className="flex items-center gap-3">
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

      {isPending && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
        </div>
      )}

      {!isPending && (
        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_140px_140px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            <div>Client</div>
            <div className="text-right">CA {data?.current ?? ""}</div>
            <div className="text-right">CA {data?.prev ?? ""}</div>
            <div className="text-right">Évolution</div>
          </div>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Aucun client ne correspond.
            </div>
          )}
          {filtered.map((r) => {
            const ev = r.evolution;
            const evClass =
              ev == null
                ? "text-secondary"
                : ev >= 5
                  ? "text-secondary"
                  : ev <= -5
                    ? "text-destructive"
                    : "text-muted-foreground";
            const Icon = ev == null ? TrendingUp : ev >= 5 ? TrendingUp : ev <= -5 ? TrendingDown : Minus;
            return (
              <Link
                key={r.client}
                to={`/admin/gaia/client/${encodeURIComponent(r.client)}`}
                className="grid grid-cols-[1fr_140px_140px_140px] gap-2 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors items-center"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.client}</div>
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
  );
}

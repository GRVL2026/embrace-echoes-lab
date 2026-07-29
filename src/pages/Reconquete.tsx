import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, RefreshCw, PlusCircle, Tag, AlertTriangle } from "lucide-react";
import {
  ClientActionsDialog,
  STATUT_LABEL,
  STATUT_COLOR,
  type StatutRelance,
} from "@/components/reactivation/ClientActionsDialog";
import {
  CompanyStatusBadge,
  resolveCompanyStatus,
} from "@/components/reactivation/CompanyStatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Row = {
  code_client: string;
  nom: string | null;
  ville: string | null;
  categorie: string;
  typologie: string | null;
  derniere_commande: string | null;
  ca_total: number;
  statut_relance: StatutRelance | null;
  statut_relance_maj: string | null;
  derniere_action_type: string | null;
  derniere_action_date: string | null;
  derniere_action_auteur: string | null;
  score: number;
  etat_administratif: string | null;
  procedure_collective: boolean | null;
};

function fmtEUR(n: number) {
  if (!n) return "0 €";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M€`;
  if (n >= 1_000) return `${Math.round(n / 1000)} k€`;
  return `${Math.round(n)} €`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}
function monthsAgo(d: string | null) {
  if (!d) return null;
  const diff = (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24 * 30);
  return Math.round(diff);
}

export default function Reconquete() {
  const { canReactivation, isLoading } = useAuth();
  const [dialogCode, setDialogCode] = useState<string | null>(null);
  const [dialogTab, setDialogTab] = useState<"action" | "statut">("action");
  const [q, setQ] = useState("");
  const [statutFilter, setStatutFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [societeFilter, setSocieteFilter] = useState<string>("all"); // all | cessees | procedure | actives

  const { data, isLoading: loadingData, refetch, isFetching } = useQuery({
    queryKey: ["reconquete-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_reconquete_list");
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
    enabled: canReactivation,
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const qLow = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (catFilter !== "all" && r.categorie !== catFilter) return false;
      if (statutFilter === "none" && r.statut_relance) return false;
      if (
        statutFilter !== "all" &&
        statutFilter !== "none" &&
        r.statut_relance !== statutFilter
      )
        return false;
      if (societeFilter !== "all") {
        const s = resolveCompanyStatus({
          etat_administratif: r.etat_administratif,
          procedure_collective: r.procedure_collective,
        });
        if (societeFilter === "cessees" && s !== "cessee") return false;
        if (societeFilter === "procedure" && s !== "procedure") return false;
        if (societeFilter === "actives" && s !== "active") return false;
      }
      if (qLow) {
        const hay = `${r.nom ?? ""} ${r.ville ?? ""} ${r.code_client}`.toLowerCase();
        if (!hay.includes(qLow)) return false;
      }
      return true;
    });
  }, [data, q, statutFilter, catFilter, societeFilter]);

  const cesseesCount = useMemo(
    () =>
      (data ?? []).filter(
        (r) =>
          resolveCompanyStatus({
            etat_administratif: r.etat_administratif,
            procedure_collective: r.procedure_collective,
          }) === "cessee",
      ).length,
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!canReactivation) return <Navigate to="/" replace />;

  const stats = {
    total: filtered.length,
    dormant: filtered.filter((r) => r.categorie === "dormant").length,
    inactif: filtered.filter((r) => r.categorie === "inactif").length,
    ca: filtered.reduce((s, r) => s + (r.ca_total || 0), 0),
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">À relancer — Reconquête</h1>
          <p className="text-sm text-muted-foreground">
            Clients dormants (12-24 mois) et inactifs, triés par CA × ancienneté.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Clients affichés</div>
          <div className="text-2xl font-semibold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Dormants (12-24m)</div>
          <div className="text-2xl font-semibold text-amber-500">{stats.dormant}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Inactifs (&gt;24m)</div>
          <div className="text-2xl font-semibold text-slate-400">{stats.inactif}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">CA total (historique)</div>
          <div className="text-2xl font-semibold">{fmtEUR(stats.ca)}</div>
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher nom, ville, code…"
              className="pl-8"
            />
          </div>
          <Select value={statutFilter} onValueChange={setStatutFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="none">Sans statut</SelectItem>
              {(Object.keys(STATUT_LABEL) as StatutRelance[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Catégorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="dormant">Dormants</SelectItem>
              <SelectItem value="inactif">Inactifs</SelectItem>
            </SelectContent>
          </Select>
          <Select value={societeFilter} onValueChange={setSocieteFilter}>
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Société" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes sociétés</SelectItem>
              <SelectItem value="cessees">
                Sociétés cessées{cesseesCount > 0 ? ` (${cesseesCount})` : ""}
              </SelectItem>
              <SelectItem value="procedure">Procédure collective</SelectItem>
              <SelectItem value="actives">Actives (INSEE)</SelectItem>
            </SelectContent>
          </Select>
          {cesseesCount > 0 && societeFilter !== "cessees" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 border-rose-500/40 text-rose-500 hover:bg-rose-500/10"
              onClick={() => setSocieteFilter("cessees")}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {cesseesCount} société{cesseesCount > 1 ? "s" : ""} cessée
              {cesseesCount > 1 ? "s" : ""} à revoir
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loadingData ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Client</th>
                  <th className="text-left px-3 py-2">Ville</th>
                  <th className="text-left px-3 py-2">Typologie</th>
                  <th className="text-right px-3 py-2">CA total</th>
                  <th className="text-left px-3 py-2">Dernière cde</th>
                  <th className="text-left px-3 py-2">Statut</th>
                  <th className="text-left px-3 py-2">Dernière action</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const m = monthsAgo(r.derniere_commande);
                  return (
                    <tr
                      key={r.code_client}
                      className="border-t border-border hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 font-medium">{r.nom || r.code_client}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.ville || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.typologie || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtEUR(r.ca_total)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            r.categorie === "inactif"
                              ? "text-slate-400"
                              : "text-amber-500"
                          }
                        >
                          {fmtDate(r.derniere_commande)}
                        </span>
                        {m !== null && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({m}m)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.statut_relance ? (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full border text-xs ${
                              STATUT_COLOR[r.statut_relance]
                            }`}
                          >
                            {STATUT_LABEL[r.statut_relance]}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.derniere_action_type ? (
                          <>
                            <span className="uppercase tracking-wider">
                              {r.derniere_action_type}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {r.derniere_action_date &&
                                new Date(r.derniere_action_date).toLocaleDateString(
                                  "fr-FR",
                                )}
                              {r.derniere_action_auteur &&
                                ` • ${r.derniere_action_auteur}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground italic">
                            aucune
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDialogCode(r.code_client);
                            setDialogTab("action");
                          }}
                        >
                          <PlusCircle className="h-3.5 w-3.5 mr-1" /> Action
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDialogCode(r.code_client);
                            setDialogTab("statut");
                          }}
                        >
                          <Tag className="h-3.5 w-3.5 mr-1" /> Statut
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center py-10 text-muted-foreground italic"
                    >
                      Aucun client à afficher avec ces filtres.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ClientActionsDialog
        code={dialogCode}
        open={!!dialogCode}
        onOpenChange={(v) => !v && setDialogCode(null)}
        initialTab={dialogTab}
        onChanged={() => refetch()}
      />
    </div>
  );
}

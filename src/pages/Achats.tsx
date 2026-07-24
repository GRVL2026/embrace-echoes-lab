import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, ShoppingBag, Package, Truck, Ship, Users, Wallet, Boxes, Calendar,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ChartTooltipContent, barTooltipCursor } from "@/components/admin/chartTooltip";

type Resume = {
  cmd_encours: number | string | null;
  montant_encours: number | string | null;
  reste_a_recevoir: number | string | null;
  reste_a_facturer: number | string | null;
  arrivages: number | string | null;
  nb_fournisseurs: number | string | null;
  montant_12m: number | string | null;
};

type TopFourn = {
  code_fourn: string | null;
  nom_fourn: string | null;
  nb_cmd: number | string | null;
  montant: number | string | null;
};

type AchatRow = {
  n_cde: string | null;
  type_cde: string | null;
  statut: string | null;
  date_cde: string | null;
  date_liv: string | null;
  code_fourn: string | null;
  nom_fourn: string | null;
  libelle_cde: string | null;
  qte_cdee: number | string | null;
  qte_recue: number | string | null;
  qte_restante: number | string | null;
  montant_ligne: number | string | null;
  montant_ouvert: number | string | null;
  reste_a_facturer: number | string | null;
  eta: string | null;
  etd: string | null;
  bateau: string | null;
  num_conteneur: string | null;
  transitaire: string | null;
  description: string | null;
};

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n || 0);
const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
};

const COLORS = ["#9B5CFF", "#ADFF00", "#5CC8FF", "#FF6B9D", "#FFB800", "#B0B0B0"];

const ENCOURS_STATUTS = ["Ouvert", "En attente d'envoi", "En attente d'impression"];

type SheetKind =
  | { kind: "encours" }
  | { kind: "fournisseur"; code: string; nom: string }
  | null;

export default function Achats() {
  const { isAdmin, isDirection, loading } = useAuth();
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);

  const { data: resume, isPending: pendingResume } = useQuery({
    queryKey: ["achats-resume"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_achats_resume");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? {}) as Resume;
    },
    enabled: isAdmin || isDirection,
  });

  const { data: topFourn, isPending: pendingTop } = useQuery({
    queryKey: ["achats-top-fournisseurs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_achats_top_fournisseurs", { _limit: 12 });
      if (error) throw error;
      return (data ?? []) as TopFourn[];
    },
    enabled: isAdmin || isDirection,
  });

  const { data: arrivages, isPending: pendingArr } = useQuery({
    queryKey: ["achats-arrivages"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("gaia_achats")
        .select("n_cde,code_fourn,nom_fourn,eta,bateau,num_conteneur,transitaire,montant_ligne")
        .gte("eta", today)
        .order("eta", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AchatRow[];
    },
    enabled: isAdmin || isDirection,
  });

  const { data: encoursRows } = useQuery({
    queryKey: ["achats-encours"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gaia_achats")
        .select("n_cde,code_fourn,nom_fourn,statut,date_cde,montant_ligne,qte_restante")
        .in("statut", ENCOURS_STATUTS)
        .order("date_cde", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AchatRow[];
    },
    enabled: (isAdmin || isDirection) && openSheet?.kind === "encours",
  });

  const fournCode = openSheet?.kind === "fournisseur" ? openSheet.code : null;
  const { data: fournRows } = useQuery({
    queryKey: ["achats-fournisseur", fournCode],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gaia_achats")
        .select("n_cde,code_fourn,nom_fourn,statut,date_cde,date_liv,libelle_cde,montant_ligne,qte_cdee,qte_recue,qte_restante,eta,bateau")
        .eq("code_fourn", fournCode)
        .order("date_cde", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AchatRow[];
    },
    enabled: !!fournCode,
  });

  const topChartData = useMemo(
    () =>
      (topFourn ?? [])
        .map((r) => ({
          code: r.code_fourn ?? "",
          nom: r.nom_fourn ?? r.code_fourn ?? "—",
          montant: Number(r.montant || 0),
          nb: Number(r.nb_cmd || 0),
        }))
        .sort((a, b) => b.montant - a.montant),
    [topFourn]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!(isAdmin || isDirection)) return <Navigate to="/" replace />;

  const r = resume ?? ({} as Resume);
  const pending = pendingResume || pendingTop || pendingArr;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg border border-border bg-card/40 p-2">
            <ShoppingBag className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold">Dashboard achats</h2>
            <p className="text-sm text-muted-foreground">
              Commandes fournisseurs, arrivages et engagements — direction & admin.
            </p>
          </div>
        </div>

        {pending && (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement des données…
          </div>
        )}

        {!pending && (
          <>
            {/* KPI */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
              <KpiTile
                title="Commandes en cours"
                icon={<Package className="h-4 w-4 text-primary" />}
                value={num(Number(r.cmd_encours || 0))}
                tone="primary"
                onClick={() => setOpenSheet({ kind: "encours" })}
                ariaLabel="Voir les commandes en cours"
                hint={<span className="text-muted-foreground">Statuts : ouvert, en attente d'envoi/impression</span>}
              />
              <KpiTile
                title="Montant engagé"
                icon={<Wallet className="h-4 w-4 text-secondary" />}
                value={eur(Number(r.montant_encours || 0))}
                tone="secondary"
                onClick={() => setOpenSheet({ kind: "encours" })}
                ariaLabel="Voir le détail engagé"
                hint={<span className="text-muted-foreground">Sur les commandes en cours</span>}
              />
              <KpiTile
                title="Reste à recevoir"
                icon={<Boxes className="h-4 w-4 text-primary" />}
                value={num(Number(r.reste_a_recevoir || 0))}
                onClick={() => setOpenSheet({ kind: "encours" })}
                ariaLabel="Voir les lignes en attente de réception"
                hint={<span className="text-muted-foreground">Quantités non encore livrées</span>}
              />
              <KpiTile
                title="Arrivages à venir"
                icon={<Ship className="h-4 w-4 text-secondary" />}
                value={num(Number(r.arrivages || 0))}
                hint={<span className="text-muted-foreground">Conteneurs avec ETA ≥ aujourd'hui</span>}
              />
              <KpiTile
                title="Fournisseurs actifs"
                icon={<Users className="h-4 w-4 text-primary" />}
                value={num(Number(r.nb_fournisseurs || 0))}
                hint={<span className="text-muted-foreground">Sur les 12 derniers mois</span>}
              />
              <KpiTile
                title="Achats 12 mois"
                icon={<Calendar className="h-4 w-4 text-secondary" />}
                value={eur(Number(r.montant_12m || 0))}
                tone="secondary"
                hint={<span className="text-muted-foreground">Total commandes hors annulées</span>}
              />
            </div>

            {/* Top fournisseurs */}
            <div className="rounded-lg border border-border bg-card/40 p-4 mb-6">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h3 className="font-display text-lg font-semibold">Top fournisseurs — 12 derniers mois</h3>
              </div>
              {topChartData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Aucune donnée fournisseur disponible.
                </div>
              ) : (
                <div style={{ width: "100%", height: Math.max(320, topChartData.length * 36) }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={topChartData}
                      layout="vertical"
                      margin={{ top: 8, right: 24, left: 24, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => eur(Number(v))}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                      />
                      <YAxis
                        type="category"
                        dataKey="nom"
                        width={160}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                      />
                      <Tooltip
                        cursor={barTooltipCursor}
                        content={
                          <ChartTooltipContent
                            valueFormatter={(v, name) =>
                              name === "montant" ? eur(Number(v)) : num(Number(v))
                            }
                          />
                        }
                      />
                      <Bar
                        dataKey="montant"
                        name="Montant 12 m"
                        radius={[0, 6, 6, 0]}
                        cursor="pointer"
                        onClick={(d: any) => {
                          if (d?.code) setOpenSheet({ kind: "fournisseur", code: d.code, nom: d.nom });
                        }}
                      >
                        {topChartData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Cliquez une barre pour voir les commandes du fournisseur.
              </p>
            </div>

            {/* Arrivages */}
            <div className="rounded-lg border border-border bg-card/40 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Ship className="h-5 w-5 text-secondary" />
                <h3 className="font-display text-lg font-semibold">Arrivages à venir</h3>
              </div>
              {(arrivages ?? []).length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Aucun arrivage à venir.
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 text-left">ETA</th>
                        <th className="px-2 py-2 text-left">Fournisseur</th>
                        <th className="px-2 py-2 text-left">Bateau</th>
                        <th className="px-2 py-2 text-left">N° conteneur</th>
                        <th className="px-2 py-2 text-left">Transitaire</th>
                        <th className="px-2 py-2 text-right">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(arrivages ?? []).map((a, i) => (
                        <tr key={(a.n_cde ?? "") + i} className="border-b border-border/60 hover:bg-card/60">
                          <td className="px-2 py-2 tabular-nums">{fmtDate(a.eta)}</td>
                          <td className="px-2 py-2">{a.nom_fourn ?? a.code_fourn ?? "—"}</td>
                          <td className="px-2 py-2">{a.bateau ?? "—"}</td>
                          <td className="px-2 py-2 font-mono text-xs">{a.num_conteneur ?? "—"}</td>
                          <td className="px-2 py-2 text-muted-foreground">{a.transitaire ?? "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{eur(Number(a.montant_ligne || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Détail : commandes en cours */}
      <Sheet
        open={openSheet?.kind === "encours"}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Commandes en cours</SheetTitle>
            <SheetDescription>
              Commandes fournisseurs avec statut ouvert / en attente.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left">N° cde</th>
                  <th className="px-2 py-2 text-left">Fournisseur</th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Statut</th>
                  <th className="px-2 py-2 text-right">Montant</th>
                  <th className="px-2 py-2 text-right">Reste</th>
                </tr>
              </thead>
              <tbody>
                {(encoursRows ?? []).map((row, i) => (
                  <tr key={(row.n_cde ?? "") + i} className="border-b border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">{row.n_cde ?? "—"}</td>
                    <td className="px-2 py-2">{row.nom_fourn ?? row.code_fourn ?? "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{fmtDate(row.date_cde)}</td>
                    <td className="px-2 py-2 text-xs">{row.statut ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{eur(Number(row.montant_ligne || 0))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(Number(row.qte_restante || 0))}</td>
                  </tr>
                ))}
                {(encoursRows ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">Aucune commande en cours.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>

      {/* Détail : par fournisseur */}
      <Sheet
        open={openSheet?.kind === "fournisseur"}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {openSheet?.kind === "fournisseur" ? openSheet.nom : "Fournisseur"}
            </SheetTitle>
            <SheetDescription>
              {openSheet?.kind === "fournisseur" ? `Code : ${openSheet.code}` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left">N° cde</th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Libellé</th>
                  <th className="px-2 py-2 text-left">Statut</th>
                  <th className="px-2 py-2 text-left">ETA</th>
                  <th className="px-2 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {(fournRows ?? []).map((row, i) => (
                  <tr key={(row.n_cde ?? "") + i} className="border-b border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">{row.n_cde ?? "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{fmtDate(row.date_cde)}</td>
                    <td className="px-2 py-2 truncate max-w-[200px]" title={row.libelle_cde ?? undefined}>
                      {row.libelle_cde ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-xs">{row.statut ?? "—"}</td>
                    <td className="px-2 py-2 tabular-nums">{fmtDate(row.eta)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{eur(Number(row.montant_ligne || 0))}</td>
                  </tr>
                ))}
                {(fournRows ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">Aucune commande trouvée.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

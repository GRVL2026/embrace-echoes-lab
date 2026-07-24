import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, ShoppingBag, Package, Ship, Users, Calendar, Container, FileText, Truck,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ChartTooltipContent } from "@/components/admin/chartTooltip";

type Resume = {
  cmd_encours: number | string | null;
  en_commande_nb: number | string | null;
  en_commande_montant: number | string | null;
  en_transit_nb: number | string | null;
  en_transit_montant: number | string | null;
  reste_a_facturer: number | string | null;
  nb_fournisseurs: number | string | null;
  montant_12m: number | string | null;
};

type TopFourn = {
  code_fourn: string | null;
  nom_fourn: string | null;
  nb_cmd: number | string | null;
  montant: number | string | null;
};

type Arrivage = {
  num_dossier: string;
  statut_arrivage: string | null;
  bateau: string | null;
  eta: string | null;
  etd: string | null;
  transitaire: string | null;
  conteneurs: string | null;
  tailles: string | null;
  fournisseurs: string | null;
  nb_lignes: number | string | null;
  nb_articles: number | string | null;
  montant: number | string | null;
  recu_pct: number | string | null;
  derniere_cde: string | null;
};

type ContenuRow = {
  nom_fourn: string | null;
  libelle: string | null;
  qte_cdee: number | string | null;
  qte_recue: number | string | null;
  qte_restante: number | string | null;
  montant_ligne: number | string | null;
  num_conteneur: string | null;
  statut: string | null;
};

type AchatRow = {
  n_cde: string | null;
  code_fourn: string | null;
  nom_fourn: string | null;
  statut: string | null;
  date_cde: string | null;
  date_liv: string | null;
  libelle_cde: string | null;
  qte_cdee: number | string | null;
  qte_recue: number | string | null;
  qte_restante: number | string | null;
  montant_ligne: number | string | null;
  eta: string | null;
  bateau: string | null;
  num_conteneur: string | null;
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

const COLORS = ["#9B5CFF", "#ADFF00", "#5CC8FF", "#FF6B9D", "#FFB800", "#B0B0B0", "#7CE0FF", "#FFA07A", "#A78BFA", "#34D399", "#F472B6", "#FBBF24"];

const ENCOURS_STATUTS = ["Ouvert", "En attente d'envoi", "En attente d'impression"];
const TRANSIT_STATUTS = ["En transit"];
const CMD_STATUTS = ["En commande"];

type SheetKind =
  | { kind: "encours"; filter: "en_commande" | "en_transit" }
  | { kind: "fournisseur"; code: string; nom: string }
  | { kind: "arrivage"; dossier: string; bateau: string | null }
  | null;

function statutTone(s: string | null): { bg: string; fg: string; label: string } {
  const v = (s ?? "").toLowerCase();
  if (v.includes("reçu") || v.includes("recu"))
    return { bg: "bg-emerald-500/15", fg: "text-emerald-400 border-emerald-500/30", label: "Reçu" };
  if (v.includes("transit"))
    return { bg: "bg-amber-500/15", fg: "text-amber-400 border-amber-500/30", label: "En transit" };
  return { bg: "bg-sky-500/15", fg: "text-sky-400 border-sky-500/30", label: s ?? "En commande" };
}

export default function Achats() {
  const { isAdmin, isDirection, loading } = useAuth();
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);
  const [showAllArrivages, setShowAllArrivages] = useState(false);

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
      const { data, error } = await (supabase as any).rpc("get_achats_arrivages");
      if (error) throw error;
      return (data ?? []) as Arrivage[];
    },
    enabled: isAdmin || isDirection,
  });

  const encoursFilter = openSheet?.kind === "encours" ? openSheet.filter : null;
  const { data: encoursRows } = useQuery({
    queryKey: ["achats-encours", encoursFilter],
    queryFn: async () => {
      const statuts = encoursFilter === "en_transit" ? TRANSIT_STATUTS : CMD_STATUTS;
      const { data, error } = await (supabase as any)
        .from("gaia_achats")
        .select("n_cde,code_fourn,nom_fourn,statut,date_cde,montant_ligne,qte_restante,eta,bateau,num_conteneur")
        .in("statut", ENCOURS_STATUTS)
        .order("date_cde", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []) as AchatRow[];
      // en_transit = a un conteneur/bateau/eta ; en_commande = rien
      return rows.filter((r) => {
        const inTransit = !!(r.num_conteneur || r.bateau || r.eta);
        return encoursFilter === "en_transit" ? inTransit : !inTransit;
      });
    },
    enabled: !!encoursFilter,
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

  const arrivageDossier = openSheet?.kind === "arrivage" ? openSheet.dossier : null;
  const { data: contenuRows } = useQuery({
    queryKey: ["achats-arrivage-contenu", arrivageDossier],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_achats_arrivage_contenu", { _dossier: arrivageDossier });
      if (error) throw error;
      return (data ?? []) as ContenuRow[];
    },
    enabled: !!arrivageDossier,
  });

  const pieData = useMemo(
    () =>
      (topFourn ?? [])
        .map((r) => ({
          code: r.code_fourn ?? "",
          nom: r.nom_fourn ?? r.code_fourn ?? "—",
          montant: Number(r.montant || 0),
          nb: Number(r.nb_cmd || 0),
        }))
        .filter((r) => r.montant > 0)
        .sort((a, b) => b.montant - a.montant),
    [topFourn]
  );
  const pieTotal = useMemo(() => pieData.reduce((s, r) => s + r.montant, 0), [pieData]);

  const arrivagesSorted = useMemo(() => (arrivages ?? []).slice(), [arrivages]);
  const arrivagesShown = showAllArrivages ? arrivagesSorted : arrivagesSorted.slice(0, 8);

  const contenuGroups = useMemo(() => {
    const map = new Map<string, ContenuRow[]>();
    (contenuRows ?? []).forEach((row) => {
      const k = row.nom_fourn ?? "—";
      const arr = map.get(k) ?? [];
      arr.push(row);
      map.set(k, arr);
    });
    return Array.from(map.entries());
  }, [contenuRows]);

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
            {/* KPI — chaque carte a un accent de couleur distinct */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-2">
              <AccentKpiCard
                accent="sky"
                icon={<FileText className="h-4 w-4" />}
                title="En commande"
                value={eur(Number(r.en_commande_montant || 0))}
                hint={`${num(Number(r.en_commande_nb || 0))} cmd · pas encore expédiées`}
                onClick={() => setOpenSheet({ kind: "encours", filter: "en_commande" })}
                ariaLabel="Voir les commandes non encore expédiées"
              />
              <AccentKpiCard
                accent="amber"
                icon={<Ship className="h-4 w-4" />}
                title="En transit"
                value={eur(Number(r.en_transit_montant || 0))}
                hint={`${num(Number(r.en_transit_nb || 0))} cmd · en mer / en route`}
                onClick={() => setOpenSheet({ kind: "encours", filter: "en_transit" })}
                ariaLabel="Voir les commandes en transit"
              />
              <AccentKpiCard
                accent="violet"
                icon={<Package className="h-4 w-4" />}
                title="Reste à facturer"
                value={eur(Number(r.reste_a_facturer || 0))}
                hint="à recevoir des fournisseurs"
              />
              <AccentKpiCard
                accent="emerald"
                icon={<Calendar className="h-4 w-4" />}
                title="Achats 12 mois"
                value={eur(Number(r.montant_12m || 0))}
                hint={`${num(Number(r.nb_fournisseurs || 0))} fournisseurs`}
              />
            </div>
            <p className="mb-6 text-xs text-muted-foreground">
              En commande → En transit → Reçu. Une commande passe « en transit » dès qu'un conteneur/navire lui est associé.
            </p>

            {/* Arrivages — liste verticale */}
            <div className="rounded-lg border border-border bg-card/40 p-4 mb-6">
              <div className="mb-3 flex items-center gap-2">
                <Ship className="h-5 w-5 text-secondary" />
                <h3 className="font-display text-lg font-semibold">Arrivages</h3>
              </div>
              {arrivagesSorted.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
                  Aucun arrivage en cours. Les conteneurs apparaîtront ici dès qu'un dossier d'expédition
                  (navire, conteneur, ETA) sera renseigné sur une commande fournisseur.
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-border/60 rounded-md border border-border/60 overflow-hidden">
                    {arrivagesShown.map((a, idx) => {
                      const tone = statutTone(a.statut_arrivage);
                      const pct = a.recu_pct != null ? Math.max(0, Math.min(100, Number(a.recu_pct))) : null;
                      return (
                        <li key={a.num_dossier} className={idx % 2 === 1 ? "bg-card/30" : "bg-card/50"}>
                          <button
                            onClick={() => setOpenSheet({ kind: "arrivage", dossier: a.num_dossier, bateau: a.bateau })}
                            className="w-full text-left px-3 py-3 hover:bg-card/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                              {/* Gauche : bateau + statut + dossier/eta */}
                              <div className="min-w-0 md:w-1/3">
                                <div className="flex items-center gap-2">
                                  <Ship className="h-4 w-4 text-secondary flex-shrink-0" />
                                  <span className="truncate text-sm font-semibold">
                                    {a.bateau ?? "Navire non précisé"}
                                  </span>
                                  <Badge variant="outline" className={`${tone.bg} ${tone.fg} text-[10px] uppercase`}>
                                    {tone.label}
                                  </Badge>
                                </div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                                  <span className="font-mono">{a.num_dossier}</span>
                                  {a.eta && <> · Arrivée : {fmtDate(a.eta)}</>}
                                </div>
                              </div>

                              {/* Milieu : conteneurs / transitaire / fournisseurs */}
                              <div className="min-w-0 md:flex-1">
                                {(a.conteneurs || a.tailles || a.transitaire) && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Container className="h-3.5 w-3.5 flex-shrink-0" />
                                    <span className="font-mono text-[11px] truncate">
                                      {a.conteneurs ?? "—"}
                                      {a.tailles ? ` · ${a.tailles}` : ""}
                                    </span>
                                    {a.transitaire && (
                                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
                                        <Truck className="h-3 w-3" /> {a.transitaire}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {a.fournisseurs && (
                                  <div
                                    className="mt-0.5 truncate text-xs text-muted-foreground/80"
                                    title={a.fournisseurs}
                                  >
                                    {a.fournisseurs}
                                  </div>
                                )}
                              </div>

                              {/* Droite : chiffres */}
                              <div className="md:w-56 md:text-right">
                                <div className="flex items-center justify-between gap-3 md:justify-end">
                                  <span className="text-[11px] text-muted-foreground">
                                    {num(Number(a.nb_articles || 0))} art · {num(Number(a.nb_lignes || 0))} lignes
                                  </span>
                                  <span className="text-sm font-semibold tabular-nums">
                                    {eur(Number(a.montant || 0))}
                                  </span>
                                </div>
                                {pct != null && (
                                  <div className="mt-1.5 flex items-center gap-2 md:justify-end">
                                    <div className="h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-border/60">
                                      <div
                                        className="h-full rounded-full bg-emerald-500 transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                      {pct.toFixed(0)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {arrivagesSorted.length > 8 && (
                    <div className="mt-3 text-center">
                      <button
                        onClick={() => setShowAllArrivages((v) => !v)}
                        className="text-xs text-secondary hover:underline"
                      >
                        {showAllArrivages
                          ? "Réduire"
                          : `Voir tout (${arrivagesSorted.length})`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Top fournisseurs — camembert */}
            <div className="rounded-lg border border-border bg-card/40 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h3 className="font-display text-lg font-semibold">Top fournisseurs — 12 derniers mois</h3>
              </div>
              {pieData.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Aucune donnée fournisseur disponible.
                </div>
              ) : (
                <div style={{ width: "100%", height: 360 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="montant"
                        nameKey="nom"
                        cx="40%"
                        cy="50%"
                        outerRadius={130}
                        innerRadius={60}
                        paddingAngle={1}
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                        cursor="pointer"
                        onClick={(d: any) => {
                          const p = d?.payload ?? d;
                          if (p?.code) setOpenSheet({ kind: "fournisseur", code: p.code, nom: p.nom });
                        }}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <ChartTooltipContent
                            hideLabel
                            formatter={(v: any, _n: any, item: any) => {
                              const val = Number(v);
                              const pct = pieTotal ? (val / pieTotal) * 100 : 0;
                              return [`${eur(val)} · ${pct.toFixed(1)}%`, item?.payload?.nom];
                            }}
                          />
                        }
                      />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        iconType="circle"
                        wrapperStyle={{ fontSize: 11, paddingLeft: 12 }}
                        onClick={(d: any) => {
                          const p = d?.payload ?? d;
                          if (p?.code) setOpenSheet({ kind: "fournisseur", code: p.code, nom: p.nom });
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Cliquez une part ou une entrée de légende pour voir les commandes du fournisseur.
              </p>
            </div>
          </>
        )}
      </main>

      {/* Détail : commandes en cours (En commande / En transit) */}
      <Sheet
        open={openSheet?.kind === "encours"}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {encoursFilter === "en_transit" ? "Commandes en transit" : "Commandes en cours"}
            </SheetTitle>
            <SheetDescription>
              {encoursFilter === "en_transit"
                ? "Commandes ouvertes déjà en transit (conteneur / navire / ETA)."
                : "Commandes ouvertes pas encore expédiées."}
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
                  <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">Aucune commande.</td></tr>
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

      {/* Détail : contenu d'un arrivage */}
      <Sheet
        open={openSheet?.kind === "arrivage"}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {openSheet?.kind === "arrivage" ? (openSheet.bateau ?? "Arrivage") : "Arrivage"}
            </SheetTitle>
            <SheetDescription>
              {openSheet?.kind === "arrivage" ? `Dossier : ${openSheet.dossier}` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {contenuGroups.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aucune ligne pour ce dossier.
              </div>
            )}
            {contenuGroups.map(([fournisseur, rows]) => (
              <div key={fournisseur} className="rounded-md border border-border/60">
                <div className="border-b border-border/60 bg-card/60 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  {fournisseur}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-2 py-2 text-left">Produit</th>
                      <th className="px-2 py-2 text-right">Qté cdée</th>
                      <th className="px-2 py-2 text-right">Qté reçue</th>
                      <th className="px-2 py-2 text-right">Reste</th>
                      <th className="px-2 py-2 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-2 truncate max-w-[280px]" title={row.libelle ?? undefined}>
                          {row.libelle ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(Number(row.qte_cdee || 0))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(Number(row.qte_recue || 0))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{num(Number(row.qte_restante || 0))}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{eur(Number(row.montant_ligne || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

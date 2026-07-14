import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Database,
  FileText,
  Loader2,
  Package,
  Receipt,
  Shield,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import logoImg from "@/assets/logo.png";

type CaClient = { annee: number; code_client: string; client: string; ca_ht: number | string };
type MargeClient = { annee: number; client: string; ca_ht: number | string; ca_avec_cout: number | string; marge_estimee: number | string };
type ParcRow = { client: string; code_client: string; code_article: string; description: string | null; famille: string | null; derniere_vente: string | null; quantite: number };
type Commande = { n_cde: string | null; code_client: string; code_article: string | null; invoice_date: string | null; qty: number | null; montant_ht: number | string | null; statut: string | null; date_liv: string | null };
type Vente = { code_client: string; n_fact: string | null; code_article: string | null; invoice_date: string | null; qty: number | null; montant_ht: number | string | null };

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";
const exShort = (a: number) => `Ex. ${a}`;

const STATUTS_OUVERTS = ["Brouillon", "Ouvert", "Expédition en cours", "Reliquat"] as const;

export default function GaiaClientFiche() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { nom } = useParams<{ nom: string }>();
  const clientName = useMemo(() => (nom ? decodeURIComponent(nom) : ""), [nom]);

  const [loading, setLoading] = useState(true);
  const [ca, setCa] = useState<CaClient[]>([]);
  const [marge, setMarge] = useState<MargeClient[]>([]);
  const [parc, setParc] = useState<ParcRow[]>([]);
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [ventes, setVentes] = useState<Vente[]>([]);

  useEffect(() => {
    if (!isAdmin || !clientName) return;
    (async () => {
      setLoading(true);
      const client: any = supabase;

      // CA + Marge + Parc (par nom de client, enseignes regroupées)
      const [ca_r, mg_r, parc_r] = await Promise.all([
        client.from("v_gaia_ca_client").select("*").eq("client", clientName),
        client.from("v_gaia_marge_client").select("*").eq("client", clientName),
        client.from("v_gaia_parc_client").select("*").eq("client", clientName),
      ]);

      const caRows: CaClient[] = (ca_r.data as CaClient[]) ?? [];
      const parcRows: ParcRow[] = (parc_r.data as ParcRow[]) ?? [];
      setCa(caRows);
      setMarge((mg_r.data as MargeClient[]) ?? []);
      setParc(parcRows);

      // Ensemble des code_client rattachés à ce nom
      const codes = Array.from(
        new Set(
          [...caRows.map((r) => r.code_client), ...parcRows.map((r) => r.code_client)].filter(
            (x): x is string => !!x,
          ),
        ),
      );

      if (codes.length > 0) {
        const [cmd_r, v_r] = await Promise.all([
          client
            .from("gaia_commandes")
            .select("n_cde,code_client,code_article,invoice_date,qty,montant_ht,statut,date_liv")
            .in("code_client", codes)
            .in("statut", STATUTS_OUVERTS as unknown as string[])
            .order("invoice_date", { ascending: false })
            .limit(200),
          client
            .from("gaia_ventes")
            .select("code_client,n_fact,code_article,invoice_date,qty,montant_ht")
            .in("code_client", codes)
            .order("invoice_date", { ascending: false })
            .limit(10),
        ]);
        setCommandes((cmd_r.data as Commande[]) ?? []);
        setVentes((v_r.data as Vente[]) ?? []);
      } else {
        setCommandes([]);
        setVentes([]);
      }

      setLoading(false);
    })();
  }, [isAdmin, clientName]);

  const caByYear = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of ca) {
      const y = Number(r.annee);
      m.set(y, (m.get(y) ?? 0) + Number(r.ca_ht || 0));
    }
    return Array.from(m.entries()).sort((a, b) => b[0] - a[0]);
  }, [ca]);

  const margeByYear = useMemo(() => {
    return [...marge].sort((a, b) => Number(b.annee) - Number(a.annee));
  }, [marge]);

  const parcByFamille = useMemo(() => {
    const groups: Record<string, ParcRow[]> = {};
    for (const p of parc) {
      const key = p.famille || "—";
      (groups[key] ||= []).push(p);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => (b.derniere_vente ?? "").localeCompare(a.derniere_vente ?? ""));
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [parc]);

  const parcTotal = parc.reduce((n, r) => n + Number(r.quantite || 0), 0);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/dossiers" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to="/dossiers" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade Planner logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">Planner</span>
            </h1>
          </Link>
          <nav className="ml-4 hidden md:flex items-center gap-1">
            <Link to="/admin" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1">
              <Shield className="h-3 w-3" /> Admin
            </Link>
            <Link to="/admin/gaia" className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium inline-flex items-center gap-1">
              <Database className="h-3 w-3" /> Gaia
            </Link>
          </nav>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/admin/gaia">
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour au dashboard Gaia
          </Link>
        </Button>

        {/* En-tête */}
        <div className="mb-6 rounded-lg border border-border bg-card/40 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Fiche client 360°</div>
              <h2 className="font-display text-xl sm:text-2xl font-bold break-words">{clientName}</h2>
              <div className="mt-1 text-xs text-muted-foreground">
                {parcTotal > 0 && <span>{parcTotal} machine{parcTotal > 1 ? "s" : ""} installée{parcTotal > 1 ? "s" : ""} · </span>}
                {caByYear.length > 0 && <span>{caByYear.length} exercice{caByYear.length > 1 ? "s" : ""} avec CA</span>}
              </div>
            </div>
          </div>

          {/* KPIs CA + Marge */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {caByYear.slice(0, 3).map(([year, amount], idx) => {
              const prev = caByYear[idx + 1];
              const evol = prev && prev[1] > 0 ? ((amount - prev[1]) / prev[1]) * 100 : null;
              const mg = margeByYear.find((m) => Number(m.annee) === year);
              const taux =
                mg && Number(mg.ca_avec_cout) > 0
                  ? (Number(mg.marge_estimee) / Number(mg.ca_avec_cout)) * 100
                  : null;
              return (
                <div key={year} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{exShort(year)}</span>
                    {evol !== null && (
                      <span className={evol >= 0 ? "text-secondary" : "text-destructive"}>
                        {evol >= 0 ? <TrendingUp className="mr-1 inline h-3 w-3" /> : <TrendingDown className="mr-1 inline h-3 w-3" />}
                        {evol >= 0 ? "+" : ""}
                        {evol.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-display text-2xl font-bold">{eur(amount)}</div>
                  {taux !== null && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Marge est. : <span className="text-foreground">{eur(Number(mg?.marge_estimee || 0))}</span> ·{" "}
                      <span className="text-primary">{taux.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              );
            })}
            {caByYear.length === 0 && (
              <div className="col-span-full rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                Aucun CA connu pour ce client.
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de la fiche…
          </div>
        ) : (
          <div className="space-y-6">
            {/* Parc installé */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold inline-flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" /> Parc installé
                </h3>
                <Badge variant="outline">{parcTotal} machine{parcTotal > 1 ? "s" : ""}</Badge>
              </div>
              {parcByFamille.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Aucune machine référencée pour ce client.
                </div>
              ) : (
                <div className="space-y-4">
                  {parcByFamille.map(([famille, rows]) => {
                    const qty = rows.reduce((n, r) => n + Number(r.quantite || 0), 0);
                    return (
                      <div key={famille}>
                        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                          <span>{famille}</span>
                          <Badge variant="outline" className="h-5">{qty}</Badge>
                        </div>
                        <div className="overflow-auto rounded border border-border/60">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                              <tr>
                                <th className="px-2 py-2 text-left">Description</th>
                                <th className="px-2 py-2 text-right w-16">Qté</th>
                                <th className="px-2 py-2 text-right w-32">Dernière vente</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.code_client + r.code_article} className="border-t border-border/60">
                                  <td className="px-2 py-2">
                                    <div className="truncate">{r.description || r.code_article}</div>
                                    <div className="text-[10px] text-muted-foreground">{r.code_article}</div>
                                  </td>
                                  <td className="px-2 py-2 text-right tabular-nums">{Number(r.quantite)}</td>
                                  <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                                    {dateShort(r.derniere_vente)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Devis & commandes en cours */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold inline-flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> Devis & commandes en cours
                </h3>
                <Badge variant="outline">{commandes.length}</Badge>
              </div>
              {commandes.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Aucun devis ni commande ouverte.
                </div>
              ) : (
                <div className="overflow-auto rounded border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left">N°</th>
                        <th className="px-2 py-2 text-left">Article</th>
                        <th className="px-2 py-2 text-left">Statut</th>
                        <th className="px-2 py-2 text-right">Date</th>
                        <th className="px-2 py-2 text-right">Qté</th>
                        <th className="px-2 py-2 text-right">Montant HT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commandes.map((c, i) => (
                        <tr key={(c.n_cde ?? "") + i} className="border-t border-border/60">
                          <td className="px-2 py-2 font-mono text-xs">{c.n_cde ?? "—"}</td>
                          <td className="px-2 py-2 truncate max-w-[240px]">{c.code_article ?? "—"}</td>
                          <td className="px-2 py-2">
                            <Badge variant="outline" className="text-[10px]">{c.statut ?? "—"}</Badge>
                          </td>
                          <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                            {dateShort(c.invoice_date)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{Number(c.qty ?? 0)}</td>
                          <td className="px-2 py-2 text-right font-medium tabular-nums">
                            {eur(Number(c.montant_ht ?? 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Dernières factures */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold inline-flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" /> Dernières factures
                </h3>
                <Badge variant="outline">{ventes.length}</Badge>
              </div>
              {ventes.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Aucune facture récente.
                </div>
              ) : (
                <div className="overflow-auto rounded border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Facture</th>
                        <th className="px-2 py-2 text-left">Article</th>
                        <th className="px-2 py-2 text-right">Qté</th>
                        <th className="px-2 py-2 text-right">Montant HT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ventes.map((v, i) => (
                        <tr key={(v.n_fact ?? "") + i} className="border-t border-border/60">
                          <td className="px-2 py-2 text-xs text-muted-foreground tabular-nums">
                            {dateShort(v.invoice_date)}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">{v.n_fact ?? "—"}</td>
                          <td className="px-2 py-2 truncate max-w-[240px]">{v.code_article ?? "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{Number(v.qty ?? 0)}</td>
                          <td className="px-2 py-2 text-right font-medium tabular-nums">
                            {eur(Number(v.montant_ht ?? 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-[11px] text-muted-foreground">
              Marge estimée sur la base du dernier coût d'achat connu.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

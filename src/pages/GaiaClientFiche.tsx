import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { CopiloteMarkdown } from "@/components/admin/CopiloteMarkdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { AppTopNav } from "@/components/AppTopNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeft,
  CalendarClock,
  Database,
  FileText,
  Flame,
  Gamepad2,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wrench,
  X,
} from "lucide-react";
import logoImg from "@/assets/logo.png";
import { toast } from "@/hooks/use-toast";

type CaClient = { annee: number; code_client: string; client: string; ca_ht: number | string };
type MargeClient = { annee: number; client: string; ca_ht: number | string; ca_avec_cout: number | string; marge_estimee: number | string };
type ParcRow = { client: string; code_client: string; code_article: string; description: string | null; famille: string | null; derniere_vente: string | null; quantite: number };
type Commande = { n_cde: string | null; code_client: string; code_article: string | null; invoice_date: string | null; qty: number | null; montant_ht: number | string | null; statut: string | null; date_liv: string | null };
type Vente = { code_client: string; n_fact: string | null; code_article: string | null; invoice_date: string | null; qty: number | null; montant_ht: number | string | null; classe_article?: string | null };
type ReparationDoc = { n_cde: string | null; statut: string | null; code_client: string | null; date_document: string | null; age_mois: number | null; total_ht: number | null };

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

const STATUTS_OUVERTS = ["Brouillon", "Ouvert", "Expédition en cours", "Reliquat"] as const;
const CONSO_KEYWORDS = ["consommable", "consommables", "pièce", "piece", "pièces", "pieces", "entretien", "sav", "magasin"];

const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

const ageBadgeClass = (days: number) => {
  if (days < 15) return "bg-secondary/20 text-secondary border-secondary/40";
  if (days < 60) return "bg-orange-500/20 text-orange-400 border-orange-500/40";
  return "bg-destructive/20 text-destructive border-destructive/40";
};

const yearOf = (d: string | null) => (d ? new Date(d).getFullYear() : null);

export default function GaiaClientFiche() {
  const { isAdmin, canAccessGaia, loading: authLoading } = useAuth();
  const { nom } = useParams<{ nom: string }>();
  const clientName = useMemo(() => (nom ? decodeURIComponent(nom) : ""), [nom]);

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState<string>("");
  const [copilotLoading, setCopilotLoading] = useState(false);

  const { data: fiche, isPending: loading } = useQuery({
    queryKey: ["gaia-client", clientName],
    enabled: !!isAdmin && !!clientName,
    queryFn: async () => {
      const client: any = supabase;

      const [ca_r, mg_r, parc_r] = await Promise.all([
        client.from("v_gaia_ca_client").select("*").eq("client", clientName),
        client.from("v_gaia_marge_client").select("*").eq("client", clientName),
        client.from("v_gaia_parc_client").select("*").eq("client", clientName),
      ]);

      const caRows: CaClient[] = (ca_r.data as CaClient[]) ?? [];
      const parcRows: ParcRow[] = (parc_r.data as ParcRow[]) ?? [];
      const margeRows: MargeClient[] = (mg_r.data as MargeClient[]) ?? [];

      const codes = Array.from(
        new Set(
          [...caRows.map((r) => r.code_client), ...parcRows.map((r) => r.code_client)].filter(
            (x): x is string => !!x,
          ),
        ),
      );

      let commandesRows: Commande[] = [];
      let ventesRows: Vente[] = [];
      let ventes12mRows: Vente[] = [];
      let firstSaleValue: string | null = null;
      let reparationsRows: ReparationDoc[] = [];

      if (codes.length > 0) {
        const since = new Date();
        since.setMonth(since.getMonth() - 12);
        const sinceIso = since.toISOString().slice(0, 10);

        const [cmd_r, v_r, v12_r, vfirst_r, rep_r] = await Promise.all([
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
          client
            .from("gaia_ventes")
            .select("code_client,code_article,invoice_date,montant_ht,classe_article")
            .in("code_client", codes)
            .gte("invoice_date", sinceIso)
            .limit(2000),
          client
            .from("gaia_ventes")
            .select("invoice_date")
            .in("code_client", codes)
            .order("invoice_date", { ascending: true })
            .limit(1),
          client
            .from("v_gaia_carnet_documents")
            .select("n_cde,statut,code_client,date_document,age_mois,total_ht,categorie")
            .in("code_client", codes)
            .eq("categorie", "reparation")
            .limit(200),
        ]);
        commandesRows = (cmd_r.data as Commande[]) ?? [];
        ventesRows = (v_r.data as Vente[]) ?? [];
        ventes12mRows = (v12_r.data as Vente[]) ?? [];
        firstSaleValue = (vfirst_r.data as Array<{ invoice_date: string | null }>)?.[0]?.invoice_date ?? null;
        reparationsRows = (rep_r.data as ReparationDoc[]) ?? [];
      }

      return {
        ca: caRows,
        marge: margeRows,
        parc: parcRows,
        commandes: commandesRows,
        ventes: ventesRows,
        ventes12m: ventes12mRows,
        firstSale: firstSaleValue,
        reparations: reparationsRows,
      };
    },
  });

  const ca = fiche?.ca ?? [];
  const marge = fiche?.marge ?? [];
  const parc = fiche?.parc ?? [];
  const commandes = fiche?.commandes ?? [];
  const ventes = fiche?.ventes ?? [];
  const ventes12m = fiche?.ventes12m ?? [];
  const firstSale = fiche?.firstSale ?? null;
  const reparations = fiche?.reparations ?? [];

  const caByYear = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of ca) {
      const y = Number(r.annee);
      m.set(y, (m.get(y) ?? 0) + Number(r.ca_ht || 0));
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [ca]);

  const caByYearDesc = useMemo(() => [...caByYear].reverse(), [caByYear]);
  const currentYear = caByYearDesc[0];
  const previousYear = caByYearDesc[1];
  const evolPct = currentYear && previousYear && previousYear[1] > 0
    ? ((currentYear[1] - previousYear[1]) / previousYear[1]) * 100
    : null;

  const margeCurrent = useMemo(() => {
    if (!currentYear) return null;
    return marge.find((m) => Number(m.annee) === currentYear[0]) ?? null;
  }, [marge, currentYear]);

  const lastInvoiceDate = ventes[0]?.invoice_date ?? null;
  const daysSinceLastInvoice = lastInvoiceDate ? daysBetween(new Date(), new Date(lastInvoiceDate)) : null;

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

  const commandesTri = useMemo(
    () => [...commandes].sort((a, b) => Number(b.montant_ht ?? 0) - Number(a.montant_ht ?? 0)),
    [commandes],
  );

  // ===== Règles d'actions =====
  const now = new Date();
  const caN1 = previousYear?.[1] ?? 0;

  // Devis
  const devisOld: Array<{ c: Commande; age: number }> = [];
  const devisFresh: Array<{ c: Commande; age: number }> = [];
  for (const c of commandes) {
    if (!c.invoice_date) continue;
    const age = daysBetween(now, new Date(c.invoice_date));
    if (age > 30) devisOld.push({ c, age });
    else if (age < 15) devisFresh.push({ c, age });
  }
  devisOld.sort((a, b) => Number(b.c.montant_ht ?? 0) - Number(a.c.montant_ht ?? 0));
  devisFresh.sort((a, b) => Number(b.c.montant_ht ?? 0) - Number(a.c.montant_ht ?? 0));

  const decrochage = daysSinceLastInvoice !== null && daysSinceLastInvoice > 180 && caN1 > 5000;

  const parcOld = parcByFamille
    .map(([fam, rows]) => {
      const oldRows = rows.filter((r) => {
        const y = yearOf(r.derniere_vente);
        return y !== null && new Date().getFullYear() - y > 5;
      });
      return { famille: fam, count: oldRows.reduce((n, r) => n + Number(r.quantite || 0), 0) };
    })
    .filter((x) => x.count > 0);

  // Consommables / pièces détachées (classe MAGASIN, entretien, SAV) sur 12 mois
  const hasParc = parc.length > 0;
  const consoVentes12 = ventes12m.filter((v) => {
    const fam = (v.classe_article || "").toLowerCase();
    return CONSO_KEYWORDS.some((k) => fam.includes(k));
  });
  const consoLast12 = consoVentes12.length > 0;
  const consoMontant = consoVentes12.reduce((n, v) => n + Number(v.montant_ht ?? 0), 0);
  const missingConso = hasParc && !consoLast12 && ventes12m.length > 0;

  // ===== Copilote =====
  const [copilotSteps, setCopilotSteps] = useState<Array<{ summary: string; query: string }>>([]);

  const askCopilot = async (question: string) => {
    setCopilotOpen(true);
    setCopilotQuestion(question);
    setCopilotAnswer("");
    setCopilotSteps([]);
    setCopilotLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Session expirée. Veuillez vous reconnecter.");

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gaia-copilot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "chat", question, history: [] }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`HTTP ${resp.status} ${resp.statusText}\n${body}`);
      }
      if (!resp.body) throw new Error("HTTP 200 sans flux de réponse");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMarkdown = "";
      let errorFromStream: string | null = null;

      const consume = (event: string) => {
        const dataText = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        const evtName = event.split(/\r?\n/).find((l) => l.startsWith("event:"))?.slice(6).trim();
        if (!dataText) return;
        let data: any;
        try { data = JSON.parse(dataText); } catch { return; }
        if (evtName === "gaia_sql") {
          setCopilotSteps((s) => [...s, { summary: data.summary ?? "Requête", query: data.query ?? "" }]);
        } else if (evtName === "gaia_final") {
          finalMarkdown = data.markdown ?? "";
        } else if (evtName === "gaia_error") {
          errorFromStream = data.error ?? "Erreur inconnue";
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        events.forEach(consume);
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);

      if (errorFromStream) throw new Error(errorFromStream);
      if (!finalMarkdown) throw new Error("Réponse vide");
      setCopilotAnswer(finalMarkdown);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopilotAnswer(`⚠️ ${msg}`);
      toast({ title: "Erreur", description: msg.slice(0, 200), variant: "destructive" });
    } finally {
      setCopilotLoading(false);
    }
  };

  const maxCa = Math.max(1, ...caByYear.map(([, v]) => v));

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/dossiers" replace />;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/85 backdrop-blur px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MobileNav />
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Retour au dashboard"
            className="h-11 w-11 flex-shrink-0 md:hidden -ml-1"
          >
            <Link to="/admin/gaia"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <Link to={isAdmin ? "/" : "/dossiers"} className="hidden md:flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
          <div className="md:hidden flex-1 min-w-0">
            <div className="truncate font-display text-sm font-semibold">{clientName}</div>
            <div className="truncate text-[11px] text-muted-foreground">Fiche client</div>
          </div>
          <div className="hidden md:block"><AppTopNav /></div>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-4 sm:py-8">
        <Button asChild variant="ghost" size="sm" className="mb-4 hidden md:inline-flex">
          <Link to="/admin/gaia">
            <ArrowLeft className="mr-2 h-4 w-4" /> Retour au dashboard
          </Link>
        </Button>


        {/* 1) EN-TÊTE COMPACT */}
        <div className="mb-6 rounded-lg border border-border bg-card/40 p-4 sm:p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Cockpit client</div>
          <h2 className="font-display text-xl sm:text-2xl font-bold break-words">{clientName}</h2>

          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* CA exercice courant */}
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CA {currentYear?.[0] ?? "—"}</div>
              <div className="mt-1 font-display text-xl font-bold">{eur(currentYear?.[1] ?? 0)}</div>
              {evolPct !== null && (
                <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${evolPct >= 0 ? "text-secondary" : "text-destructive"}`}>
                  {evolPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {evolPct >= 0 ? "+" : ""}{evolPct.toFixed(1)}% vs N-1
                </div>
              )}
            </div>
            {/* Marge estimée */}
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Marge est. {currentYear?.[0] ?? ""}</div>
              <div className="mt-1 font-display text-xl font-bold">{eur(Number(margeCurrent?.marge_estimee ?? 0))}</div>
              {margeCurrent && Number(margeCurrent.ca_avec_cout) > 0 && (
                <div className="mt-1 text-[11px] text-primary">
                  {((Number(margeCurrent.marge_estimee) / Number(margeCurrent.ca_avec_cout)) * 100).toFixed(1)}%
                </div>
              )}
            </div>
            {/* Dernière facture */}
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dernière facture</div>
              <div className="mt-1 font-display text-base font-bold">{dateShort(lastInvoiceDate)}</div>
              {daysSinceLastInvoice !== null && (
                <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${daysSinceLastInvoice > 180 ? "text-destructive" : "text-muted-foreground"}`}>
                  <CalendarClock className="h-3 w-3" />
                  il y a {daysSinceLastInvoice} j
                </div>
              )}
            </div>
            {/* Ancienneté */}
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Client depuis</div>
              <div className="mt-1 font-display text-base font-bold">{firstSale ? new Date(firstSale).getFullYear() : "—"}</div>
              {firstSale && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {Math.max(0, new Date().getFullYear() - new Date(firstSale).getFullYear())} an(s) de relation
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement de la fiche…
          </div>
        ) : (
          <div className="space-y-6">
            {reparations.length > 0 && (
              <section className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-orange-500/15 text-orange-400">
                    <Wrench className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-display text-base font-semibold">Atelier / Réparations en cours</h3>
                      <div className="font-display text-lg font-bold tabular-nums text-orange-400">
                        {eur(reparations.reduce((n, r) => n + Number(r.total_ht ?? 0), 0))}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {reparations.length} dossier{reparations.length > 1 ? "s" : ""} RP · signal commercial : un client qui répare beaucoup mais ne commande plus mérite une visite.
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {[...reparations]
                        .sort((a, b) => (b.age_mois ?? 0) - (a.age_mois ?? 0))
                        .slice(0, 5)
                        .map((r) => {
                          const m = r.age_mois ?? 0;
                          const ageTxt = m <= 0 ? "ce mois-ci" : m === 1 ? "il y a 1 mois" : `il y a ${m} mois`;
                          return (
                            <li key={r.n_cde} className="flex items-center justify-between gap-2 rounded border border-orange-500/20 bg-background/40 px-2 py-1.5 text-xs">
                              <div className="min-w-0">
                                <span className="font-mono">{r.n_cde ?? "—"}</span>
                                <span className="ml-2 text-muted-foreground">{r.statut ?? "—"} · {ageTxt}</span>
                              </div>
                              <span className="tabular-nums font-medium">{eur(Number(r.total_ht ?? 0))}</span>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* 2) À FAIRE */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <Flame className="h-5 w-5 text-primary" />
                <h3 className="font-display text-lg font-semibold">À faire avec ce client</h3>
              </div>

              {(() => {
                const cards: JSX.Element[] = [];

                for (const { c, age } of devisOld.slice(0, 3)) {
                  const question = `Analyse le devis n°${c.n_cde} du client "${clientName}" pour un montant de ${eur(Number(c.montant_ht ?? 0))} en attente depuis ${age} jours. Que faire pour le convertir ?`;
                  cards.push(
                    <ActionCard
                      key={`old-${c.n_cde}`}
                      tone="danger"
                      icon={<Send className="h-4 w-4" />}
                      title={`Relancer le devis N°${c.n_cde ?? "—"}`}
                      subtitle={`En attente depuis ${age} jours`}
                      amount={eur(Number(c.montant_ht ?? 0))}
                      onAsk={() => askCopilot(question)}
                    />,
                  );
                }

                for (const { c, age } of devisFresh.slice(0, 2)) {
                  const question = `Le client "${clientName}" a reçu le devis n°${c.n_cde} il y a ${age} jours pour ${eur(Number(c.montant_ht ?? 0))}. Comment le convertir à chaud ?`;
                  cards.push(
                    <ActionCard
                      key={`fresh-${c.n_cde}`}
                      tone="warn"
                      icon={<Flame className="h-4 w-4" />}
                      title={`Convertir à chaud : devis N°${c.n_cde ?? "—"}`}
                      subtitle={`Émis il y a ${age} j`}
                      amount={eur(Number(c.montant_ht ?? 0))}
                      onAsk={() => askCopilot(question)}
                    />,
                  );
                }

                if (decrochage) {
                  const question = `Le client "${clientName}" n'a plus facturé depuis ${daysSinceLastInvoice} jours alors qu'il avait fait ${eur(caN1)} de CA en N-1. Propose un plan de réactivation concret.`;
                  cards.push(
                    <ActionCard
                      key="decrochage"
                      tone="danger"
                      icon={<CalendarClock className="h-4 w-4" />}
                      title="Client en décrochage"
                      subtitle={`Plan de réactivation — dernière facture il y a ${daysSinceLastInvoice} j`}
                      amount={`CA N-1 : ${eur(caN1)}`}
                      onAsk={() => askCopilot(question)}
                    />,
                  );
                }

                if (parcOld.length > 0) {
                  const familles = parcOld.map((x) => `${x.famille} (${x.count})`).join(", ");
                  const question = `Le client "${clientName}" a des machines de plus de 5 ans dans les familles : ${familles}. Propose une offre de renouvellement.`;
                  cards.push(
                    <ActionCard
                      key="renouv"
                      tone="info"
                      icon={<RefreshCw className="h-4 w-4" />}
                      title="Proposer un renouvellement"
                      subtitle={familles}
                      amount={`${parcOld.reduce((n, x) => n + x.count, 0)} machines`}
                      onAsk={() => askCopilot(question)}
                    />,
                  );
                }

                if (consoLast12) {
                  cards.push(
                    <ActionCard
                      key="pieces-info"
                      tone="success"
                      icon={<Wrench className="h-4 w-4" />}
                      title="Pièces détachées (12 mois)"
                      subtitle={`${consoVentes12.length} achat${consoVentes12.length > 1 ? "s" : ""} classe MAGASIN / entretien`}
                      amount={eur(consoMontant)}
                    />,
                  );
                } else if (missingConso) {
                  const question = `Le client "${clientName}" possède ${parcTotal} machines mais n'a acheté aucun consommable ni pièce détachée sur les 12 derniers mois. Propose une offre d'entretien / consommables.`;
                  cards.push(
                    <ActionCard
                      key="conso"
                      tone="info"
                      icon={<Wrench className="h-4 w-4" />}
                      title="Vendre l'entretien"
                      subtitle="Aucun consommable ni pièce commandé sur 12 mois"
                      amount={`${parcTotal} machines`}
                      onAsk={() => askCopilot(question)}
                    />,
                  );
                }


                if (cards.length === 0) {
                  return (
                    <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                      Aucune action prioritaire détectée. Le client est à jour.
                    </div>
                  );
                }
                return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{cards}</div>;
              })()}
            </section>

            {/* 3) PARC INSTALLÉ */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold inline-flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" /> Parc installé
                </h3>
                <Badge variant="outline">{parcTotal} machine{parcTotal > 1 ? "s" : ""}</Badge>
              </div>

              {parcByFamille.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Aucune machine référencée pour ce client.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {parcByFamille.map(([famille, rows]) => {
                      const qty = rows.reduce((n, r) => n + Number(r.quantite || 0), 0);
                      const hasOld = rows.some((r) => {
                        const y = yearOf(r.derniere_vente);
                        return y !== null && new Date().getFullYear() - y > 5;
                      });
                      return (
                        <div key={famille} className="rounded-lg border border-border/60 bg-background/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-2 min-w-0">
                              <Gamepad2 className="h-4 w-4 text-primary flex-shrink-0" />
                              <div className="font-medium truncate">{famille}</div>
                            </div>
                            <Badge variant="outline">{qty}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {rows.slice(0, 6).map((r) => {
                              const y = yearOf(r.derniere_vente);
                              const old = y !== null && new Date().getFullYear() - y > 5;
                              return (
                                <span
                                  key={r.code_client + r.code_article}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${old ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border/60 bg-muted/40"}`}
                                  title={r.code_article}
                                >
                                  <span className="truncate max-w-[140px]">{r.description || r.code_article}</span>
                                  <span className="opacity-70">×{Number(r.quantite)}</span>
                                  {y && <span className="opacity-60">· {y}</span>}
                                </span>
                              );
                            })}
                            {rows.length > 6 && (
                              <span className="text-[11px] text-muted-foreground self-center">+{rows.length - 6}</span>
                            )}
                          </div>
                          {hasOld && (
                            <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-destructive">
                              <RefreshCw className="h-3 w-3" /> à renouveler ?
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <Accordion type="single" collapsible className="mt-4">
                    <AccordionItem value="detail" className="border-border/60">
                      <AccordionTrigger className="text-sm">Détail complet du parc</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4">
                          {parcByFamille.map(([famille, rows]) => (
                            <div key={famille}>
                              <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{famille}</div>
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
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              )}
            </section>

            {/* 4) PIPELINE */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold inline-flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" /> Pipeline
                </h3>
                <Badge variant="outline">{commandes.length}</Badge>
              </div>
              {commandesTri.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Aucun devis ni commande ouverte.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {commandesTri.slice(0, 5).map((c, i) => {
                      const age = c.invoice_date ? daysBetween(now, new Date(c.invoice_date)) : 0;
                      return (
                        <div key={(c.n_cde ?? "") + i} className="rounded-lg border border-border/60 bg-background/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-xs text-muted-foreground truncate">N° {c.n_cde ?? "—"}</div>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${ageBadgeClass(age)}`}>
                              {age} j
                            </span>
                          </div>
                          <div className="mt-1 font-display text-xl font-bold">{eur(Number(c.montant_ht ?? 0))}</div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <Badge variant="outline" className="text-[10px]">{c.statut ?? "—"}</Badge>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{c.code_article ?? ""}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {commandesTri.length > 5 && (
                    <Accordion type="single" collapsible className="mt-3">
                      <AccordionItem value="more" className="border-border/60">
                        <AccordionTrigger className="text-sm">Voir les {commandesTri.length - 5} autres</AccordionTrigger>
                        <AccordionContent>
                          <div className="overflow-auto rounded border border-border/60">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-2 text-left">N°</th>
                                  <th className="px-2 py-2 text-left">Article</th>
                                  <th className="px-2 py-2 text-left">Statut</th>
                                  <th className="px-2 py-2 text-right">Date</th>
                                  <th className="px-2 py-2 text-right">Montant HT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {commandesTri.slice(5).map((c, i) => (
                                  <tr key={(c.n_cde ?? "") + i} className="border-t border-border/60">
                                    <td className="px-2 py-2 font-mono text-xs">{c.n_cde ?? "—"}</td>
                                    <td className="px-2 py-2 truncate max-w-[240px]">{c.code_article ?? "—"}</td>
                                    <td className="px-2 py-2">
                                      <Badge variant="outline" className="text-[10px]">{c.statut ?? "—"}</Badge>
                                    </td>
                                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">{dateShort(c.invoice_date)}</td>
                                    <td className="px-2 py-2 text-right font-medium tabular-nums">{eur(Number(c.montant_ht ?? 0))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </>
              )}
            </section>

            {/* 5) HISTORIQUE */}
            <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-6">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="font-display text-lg font-semibold">Historique</h3>
              </div>

              {caByYear.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Aucun CA connu.
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 bg-background/40 p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">CA par exercice</div>
                  <div className="flex items-end gap-3 h-40">
                    {caByYear.map(([year, amount]) => {
                      const h = Math.max(4, (amount / maxCa) * 100);
                      return (
                        <div key={year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                          <div className="text-[10px] tabular-nums text-foreground/80 truncate">{eur(amount)}</div>
                          <div
                            className="w-full rounded-t bg-gradient-to-t from-primary/70 to-primary"
                            style={{ height: `${h}%` }}
                          />
                          <div className="text-[10px] text-muted-foreground">{year}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <Accordion type="single" collapsible className="mt-4">
                <AccordionItem value="factures" className="border-border/60">
                  <AccordionTrigger className="text-sm">10 dernières factures ({ventes.length})</AccordionTrigger>
                  <AccordionContent>
                    {ventes.length === 0 ? (
                      <div className="text-sm text-muted-foreground">Aucune facture récente.</div>
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
                                <td className="px-2 py-2 text-xs text-muted-foreground tabular-nums">{dateShort(v.invoice_date)}</td>
                                <td className="px-2 py-2 font-mono text-xs">{v.n_fact ?? "—"}</td>
                                <td className="px-2 py-2 truncate max-w-[240px]">{v.code_article ?? "—"}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{Number(v.qty ?? 0)}</td>
                                <td className="px-2 py-2 text-right font-medium tabular-nums">{eur(Number(v.montant_ht ?? 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </section>

            <p className="text-[11px] text-muted-foreground">
              Marge estimée sur la base du dernier coût d'achat connu.
            </p>
          </div>
        )}
      </main>

      {/* Panneau copilote */}
      {copilotOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-0 sm:p-6" onClick={() => setCopilotOpen(false)}>
          <div
            className="w-full sm:max-w-3xl max-h-[85vh] flex flex-col rounded-t-lg sm:rounded-lg border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div className="font-display font-semibold">Analyse copilote</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCopilotOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 overflow-auto">
              <div className="mb-3 rounded border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground italic">
                {copilotQuestion}
              </div>
              {copilotSteps.length > 0 && (
                <Accordion type="single" collapsible className="mb-3">
                  <AccordionItem value="steps" className="rounded border border-border/40 bg-background/40 px-2">
                    <AccordionTrigger className="py-1.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Database className="h-3 w-3 text-primary" />
                        Lecture base — {copilotSteps.length} étape{copilotSteps.length > 1 ? "s" : ""}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1 pb-2">
                        {copilotSteps.map((s, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground">
                            <span className="text-primary">▸</span> {s.summary}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              {copilotLoading && !copilotAnswer ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours…
                </div>
              ) : (
                <CopiloteMarkdown markdown={copilotAnswer} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionCard({
  tone,
  icon,
  title,
  subtitle,
  amount,
  onAsk,
}: {
  tone: "danger" | "warn" | "info" | "success";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  amount: string;
  onAsk?: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warn"
      ? "border-orange-500/40 bg-orange-500/5"
      : tone === "success"
      ? "border-secondary/40 bg-secondary/5"
      : "border-primary/40 bg-primary/5";
  const iconClass =
    tone === "danger" ? "text-destructive"
    : tone === "warn" ? "text-orange-400"
    : tone === "success" ? "text-secondary"
    : "text-primary";

  const { copilotEnabled } = useAuth();
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`inline-flex items-center gap-2 text-xs font-medium ${iconClass}`}>
            {icon}
            <span className="uppercase tracking-wider">{title}</span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
          <div className="mt-2 font-display text-2xl font-bold">{amount}</div>
        </div>
      </div>
      {onAsk && copilotEnabled && (
        <Button size="sm" variant="outline" className="mt-3 w-full" onClick={onAsk}>
          <Sparkles className="mr-2 h-3.5 w-3.5" /> Analyser avec le copilote
        </Button>
      )}
    </div>
  );
}



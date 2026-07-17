import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  ArrowLeft,
  Database,
  FileText,
  FileSignature,
  Loader2,
  Shield,
  Truck,
  X,
} from "lucide-react";
import logoImg from "@/assets/logo.png";

type CarnetDoc = {
  n_cde: string | null;
  order_type: string | null;
  categorie: string | null;
  statut: string | null;
  code_client: string | null;
  client: string | null;
  date_document: string | null;
  age_mois: number | null;
  nb_lignes: number | null;
  total_ht: number | null;
};

type CommandeLigne = {
  n_cde: string | null;
  code_article: string | null;
  qty: number | null;
  pu_rem: number | null;
  montant_ht: number | null;
  statut: string | null;
};

type Article = { code: string | null; description: string | null };

type Categorie = "devis" | "commande" | "livraison";

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("fr-FR").format(n || 0);
const dateShort = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

const ageLabel = (m: number | null) => {
  if (m === null || m === undefined) return "—";
  if (m <= 0) return "ce mois-ci";
  if (m === 1) return "il y a 1 mois";
  return `il y a ${m} mois`;
};

const ageBadgeClass = (m: number | null) => {
  const v = m ?? 0;
  if (v < 6) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
  if (v < 12) return "bg-orange-500/15 text-orange-400 border-orange-500/40";
  return "bg-destructive/20 text-destructive border-destructive/40";
};

const statutBadgeClass = (s: string | null) => {
  const v = (s || "").toLowerCase();
  if (v.includes("brouillon")) return "bg-muted/60 text-foreground border-border";
  if (v.includes("ouvert")) return "bg-sky-500/15 text-sky-400 border-sky-500/40";
  if (v.includes("expédition")) return "bg-orange-500/15 text-orange-400 border-orange-500/40";
  if (v.includes("reliquat")) return "bg-orange-500/15 text-orange-400 border-orange-500/40";
  return "bg-muted/40 text-muted-foreground border-border";
};

const CONFIG: Record<Categorie, { label: string; subtitle: string; icon: any; color: string; filter: (d: CarnetDoc) => boolean }> = {
  devis: {
    label: "Devis en cours",
    subtitle: "Statuts Cegid Brouillon + Ouvert (QT) — potentiel commercial à convertir",
    icon: FileText,
    color: "text-primary",
    filter: (d) => d.categorie === "devis" && (d.statut === "Brouillon" || d.statut === "Ouvert"),
  },
  commande: {
    label: "Commandes signées",
    subtitle: "Statuts Cegid Brouillon + Ouvert d'une commande — carnet à préparer, stock réservé",
    icon: FileSignature,
    color: "text-sky-400",
    filter: (d) => d.categorie === "commande" && (d.statut === "Brouillon" || d.statut === "Ouvert"),
  },
  livraison: {
    label: "En livraison",
    subtitle: "Commandes en Expédition en cours ou Reliquat — reste à livrer et à facturer",
    icon: Truck,
    color: "text-orange-400",
    filter: (d) => d.categorie === "commande" && (d.statut === "Expédition en cours" || d.statut === "Reliquat"),
  },
};

type AgeFilter = "all" | "lt6" | "6to12" | "gt12";
const inAge = (m: number | null, f: AgeFilter) => {
  const v = m ?? 0;
  if (f === "all") return true;
  if (f === "lt6") return v < 6;
  if (f === "6to12") return v >= 6 && v < 12;
  return v >= 12;
};

export default function GaiaCarnet() {
  const { isAdmin, canAccessGaia, loading: authLoading } = useAuth();
  const { categorie } = useParams<{ categorie: string }>();
  const cat = (categorie as Categorie) in CONFIG ? (categorie as Categorie) : null;

  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [openDoc, setOpenDoc] = useState<CarnetDoc | null>(null);

  const { data: docs = [], isPending } = useQuery({
    queryKey: ["gaia-carnet-documents"],
    enabled: !!isAdmin && !!cat,
    queryFn: async () => {
      const client: any = supabase;
      const { data } = await client.from("v_gaia_carnet_documents").select("*");
      return (data as CarnetDoc[]) ?? [];
    },
  });
  const loading = isPending;

  const filtered = useMemo(() => {
    if (!cat) return [];
    return docs.filter(CONFIG[cat].filter);
  }, [docs, cat]);

  const buckets = useMemo(() => {
    const b = { lt6: { total: 0, nb: 0 }, m6to12: { total: 0, nb: 0 }, gt12: { total: 0, nb: 0 } };
    for (const d of filtered) {
      const m = d.age_mois ?? 0;
      const t = Number(d.total_ht ?? 0);
      if (m < 6) { b.lt6.total += t; b.lt6.nb += 1; }
      else if (m < 12) { b.m6to12.total += t; b.m6to12.nb += 1; }
      else { b.gt12.total += t; b.gt12.nb += 1; }
    }
    return b;
  }, [filtered]);

  const totals = useMemo(() => ({
    total: filtered.reduce((n, d) => n + Number(d.total_ht ?? 0), 0),
    nb: filtered.length,
  }), [filtered]);

  const visibleDocs = useMemo(() => {
    const rows = filtered.filter((d) => inAge(d.age_mois, ageFilter));
    // du plus ancien au plus récent : age_mois DESC
    rows.sort((a, b) => (b.age_mois ?? 0) - (a.age_mois ?? 0));
    return rows;
  }, [filtered, ageFilter]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!canAccessGaia) return <Navigate to="/dossiers" replace />;
  if (!cat) return <Navigate to="/admin/gaia" replace />;

  const Icon = CONFIG[cat].icon;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to={isAdmin ? "/" : "/dossiers"} className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
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
          <div className="flex items-start gap-3">
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-md bg-background/40 ${CONFIG[cat].color}`}>
              <Icon className="h-6 w-6" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Carnet</div>
              <h2 className="font-display text-xl sm:text-2xl font-bold">{CONFIG[cat].label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{CONFIG[cat].subtitle}</p>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl sm:text-3xl font-bold tabular-nums">{eur(totals.total)}</div>
              <div className="text-xs text-muted-foreground">{num(totals.nb)} document{totals.nb > 1 ? "s" : ""}</div>
            </div>
          </div>
        </div>

        {/* Ventilation par ancienneté */}
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AgeCard
            active={ageFilter === "lt6"}
            onClick={() => setAgeFilter(ageFilter === "lt6" ? "all" : "lt6")}
            label="Moins de 6 mois"
            tone="green"
            total={buckets.lt6.total}
            nb={buckets.lt6.nb}
          />
          <AgeCard
            active={ageFilter === "6to12"}
            onClick={() => setAgeFilter(ageFilter === "6to12" ? "all" : "6to12")}
            label="6 à 12 mois"
            tone="orange"
            total={buckets.m6to12.total}
            nb={buckets.m6to12.nb}
          />
          <AgeCard
            active={ageFilter === "gt12"}
            onClick={() => setAgeFilter(ageFilter === "gt12" ? "all" : "gt12")}
            label="Plus de 12 mois"
            tone="red"
            total={buckets.gt12.total}
            nb={buckets.gt12.nb}
          />
        </div>

        {ageFilter !== "all" && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Filtre actif : ancienneté</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAgeFilter("all")}>
              <X className="mr-1 h-3 w-3" /> tout afficher
            </Button>
          </div>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement du carnet…
          </div>
        ) : visibleDocs.length === 0 ? (
          <div className="rounded border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Aucun document dans cette catégorie.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[110px_1fr_130px_150px_130px] items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <div>N°</div>
              <div>Client</div>
              <div className="hidden sm:block">Statut</div>
              <div className="hidden sm:block text-right">Montant HT</div>
              <div className="text-right">Ancienneté</div>
            </div>
            <ul className="divide-y divide-border/60">
              {visibleDocs.map((d) => (
                <li key={`${d.n_cde}-${d.order_type}`}>
                  <button
                    type="button"
                    onClick={() => setOpenDoc(d)}
                    className="grid w-full grid-cols-[auto_1fr_auto] sm:grid-cols-[110px_1fr_130px_150px_130px] items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/30"
                  >
                    <div className="font-mono text-xs">{d.n_cde ?? "—"}</div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{d.client ?? "—"}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {d.code_client} · {dateShort(d.date_document)} · {num(Number(d.nb_lignes ?? 0))} ligne{Number(d.nb_lignes ?? 0) > 1 ? "s" : ""}
                        <span className="sm:hidden"> · <span className="tabular-nums">{eur(Number(d.total_ht ?? 0))}</span></span>
                      </div>
                    </div>
                    <div className="hidden sm:block">
                      <Badge variant="outline" className={statutBadgeClass(d.statut)}>{d.statut ?? "—"}</Badge>
                    </div>
                    <div className="hidden sm:block text-right tabular-nums font-medium">{eur(Number(d.total_ht ?? 0))}</div>
                    <div className="text-right">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${ageBadgeClass(d.age_mois)}`}>
                        {ageLabel(d.age_mois)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      <DocSheet doc={openDoc} onClose={() => setOpenDoc(null)} />
    </div>
  );
}

function AgeCard({
  active, onClick, label, tone, total, nb,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone: "green" | "orange" | "red";
  total: number;
  nb: number;
}) {
  const tones: Record<string, string> = {
    green: "border-emerald-500/40 bg-emerald-500/5 text-emerald-400",
    orange: "border-orange-500/40 bg-orange-500/5 text-orange-400",
    red: "border-destructive/40 bg-destructive/5 text-destructive",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition hover:brightness-110 ${tones[tone]} ${active ? "ring-2 ring-current" : ""}`}
    >
      <div className="text-[11px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">{eur(total)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{num(nb)} document{nb > 1 ? "s" : ""}</div>
    </button>
  );
}

function DocSheet({ doc, onClose }: { doc: CarnetDoc | null; onClose: () => void }) {
  const { data, isPending } = useQuery({
    queryKey: ["gaia-carnet-doc", doc?.n_cde],
    enabled: !!doc?.n_cde,
    queryFn: async () => {
      const client: any = supabase;
      const { data: ligRows } = await client
        .from("gaia_commandes")
        .select("n_cde,code_article,qty,pu_rem,montant_ht,statut")
        .eq("n_cde", doc!.n_cde)
        .limit(500);
      const ligs: CommandeLigne[] = (ligRows as CommandeLigne[]) ?? [];
      const codes = Array.from(new Set(ligs.map((l) => l.code_article).filter((c): c is string => !!c)));
      let articles: Record<string, string> = {};
      if (codes.length > 0) {
        const { data: artRows } = await client
          .from("v_gaia_articles")
          .select("code,description")
          .in("code", codes);
        for (const a of ((artRows as Article[]) ?? [])) {
          if (a.code) articles[a.code] = a.description ?? "";
        }
      }
      return { lignes: ligs, articles };
    },
  });
  const lignes = data?.lignes ?? [];
  const articles = data?.articles ?? {};
  const loading = !!doc?.n_cde && isPending;

  const total = lignes.reduce((n, l) => n + Number(l.montant_ht ?? 0), 0);

  return (
    <Sheet open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">
            Document N°{doc?.n_cde ?? "—"}
          </SheetTitle>
          <SheetDescription className="space-y-1">
            <div className="text-sm font-medium text-foreground">{doc?.client ?? "—"}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={statutBadgeClass(doc?.statut ?? null)}>{doc?.statut ?? "—"}</Badge>
              <span className="text-muted-foreground">{doc?.order_type}</span>
              <span className="text-muted-foreground">· {dateShort(doc?.date_document ?? null)}</span>
              <span className="text-muted-foreground">· {ageLabel(doc?.age_mois ?? null)}</span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement des lignes…
            </div>
          ) : lignes.length === 0 ? (
            <div className="rounded border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              Aucune ligne trouvée pour ce document.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-[110px_1fr_60px_100px] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                <div>Article</div>
                <div>Description</div>
                <div className="text-right">Qté</div>
                <div className="text-right">HT</div>
              </div>
              <ul className="divide-y divide-border/60">
                {lignes.map((l, i) => (
                  <li key={`${l.code_article}-${i}`} className="grid grid-cols-[110px_1fr_60px_100px] gap-2 px-3 py-2 text-sm">
                    <div className="font-mono text-xs truncate" title={l.code_article ?? ""}>{l.code_article ?? "—"}</div>
                    <div className="min-w-0 truncate" title={articles[l.code_article ?? ""] ?? ""}>
                      {articles[l.code_article ?? ""] ?? <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="text-right tabular-nums">{num(Number(l.qty ?? 0))}</div>
                    <div className="text-right tabular-nums">{eur(Number(l.montant_ht ?? 0))}</div>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-[110px_1fr_60px_100px] gap-2 border-t border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
                <div />
                <div className="text-right">Total HT</div>
                <div />
                <div className="text-right tabular-nums">{eur(total)}</div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

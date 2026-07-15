import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Search,
  ExternalLink,
  Zap,
  Gamepad2,
  Package,
  Circle,
  Boxes,
  Wrench,
  Sparkles,
  Database,
  Shield,
  ShoppingBag,
  BadgeCheck,
  AlertTriangle,
} from "lucide-react";
import logoImg from "@/assets/logo.png";
import { shopifyThumb, stockErpBadge, cn } from "@/lib/utils";

type SiteProduct = {
  id: string;
  name: string;
  category: string | null;
  vendor: string | null;
  price: number | null;
  price_erp_ht: number | null;
  cegid_code: string | null;
  images: string[] | null;
  product_url: string | null;
  stock: string | null;
  stock_erp: number | null;
};

type ErpProduct = {
  code: string;
  description: string | null;
  famille: string | null;
  prix_ht: number | null;
  stock: number | null;
};

const fmtEur = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

function normalize(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function iconForFamille(fam: string | null | undefined) {
  const f = normalize(fam);
  if (!f) return Boxes;
  if (f.includes("flipper") || f.includes("pinball")) return Zap;
  if (f.includes("arcade") || f.includes("borne") || f.includes("jeu")) return Gamepad2;
  if (f.includes("distrib") || f.includes("blind") || f.includes("figurine") || f.includes("tcg")) return Package;
  if (f.includes("billard") || f.includes("baby") || f.includes("air hockey") || f.includes("palet")) return Circle;
  if (f.includes("conduite") || f.includes("simulateur")) return Sparkles;
  if (f.includes("piece") || f.includes("accessoire") || f.includes("consomm")) return Wrench;
  if (f.includes("occasion")) return ShoppingBag;
  return Boxes;
}

function stockBadge(stock: string | number | null | undefined) {
  if (stock == null || stock === "") return null;
  const n = typeof stock === "number" ? stock : Number(stock);
  if (Number.isFinite(n)) {
    if (n <= 0) return { label: "Rupture", tone: "destructive" as const };
    if (n <= 2) return { label: `${n} en stock`, tone: "warning" as const };
    return { label: `${n} en stock`, tone: "ok" as const };
  }
  const s = String(stock).toLowerCase();
  if (s.includes("rupt") || s.includes("out")) return { label: "Rupture", tone: "destructive" as const };
  return { label: String(stock), tone: "ok" as const };
}

export default function Catalogue() {
  const { isAdmin, canAccessGaia } = useAuth();
  const [siteRows, setSiteRows] = useState<SiteProduct[]>([]);
  const [erpRows, setErpRows] = useState<ErpProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [famille, setFamille] = useState<string>("all");
  const [includeErp, setIncludeErp] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: site }, { data: erp }] = await Promise.all([
        (supabase as any)
          .from("catalog_products")
          .select("id, name, category, vendor, price, price_erp_ht, cegid_code, images, product_url, stock, stock_erp")
          .eq("active", true)
          .order("name"),
        (supabase as any)
          .from("catalogue_erp")
          .select("code, description, famille, prix_ht, stock")
          .order("description"),
      ]);
      setSiteRows((site as SiteProduct[]) ?? []);
      setErpRows((erp as ErpProduct[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // ERP articles NOT already represented by a site product (via cegid_code)
  const erpOnly = useMemo(() => {
    const linked = new Set(
      siteRows.map((s) => (s.cegid_code ?? "").trim()).filter(Boolean),
    );
    return erpRows.filter((r) => r.code && !linked.has(r.code.trim()));
  }, [siteRows, erpRows]);

  const familles = useMemo(() => {
    const set = new Set<string>();
    for (const s of siteRows) if (s.category) set.add(s.category);
    for (const e of erpOnly) if (e.famille) set.add(e.famille);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [siteRows, erpOnly]);

  const filteredSite = useMemo(() => {
    const needle = normalize(q);
    return siteRows.filter((r) => {
      if (famille !== "all" && normalize(r.category) !== normalize(famille)) return false;
      if (!needle) return true;
      return (
        normalize(r.name).includes(needle) ||
        normalize(r.vendor).includes(needle) ||
        normalize(r.category).includes(needle) ||
        normalize(r.cegid_code).includes(needle)
      );
    });
  }, [siteRows, q, famille]);

  const filteredErp = useMemo(() => {
    if (!includeErp) return [];
    const needle = normalize(q);
    return erpOnly.filter((r) => {
      if (famille !== "all" && normalize(r.famille) !== normalize(famille)) return false;
      if (!needle) return true;
      return (
        normalize(r.description).includes(needle) ||
        normalize(r.famille).includes(needle) ||
        normalize(r.code).includes(needle)
      );
    });
  }, [erpOnly, q, famille, includeErp]);

  const totalCount = filteredSite.length + filteredErp.length;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MobileNav />
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
          <nav className="ml-4 hidden md:flex items-center gap-1">
            <Link to="/dossiers" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Dossiers</Link>
            <Link to="/planner" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Arcade Planner</Link>
            <Link to="/catalogue" className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium">Catalogue</Link>
            {canAccessGaia && (
              <Link to="/admin/gaia" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Database className="h-3 w-3" /> Gaia</Link>
            )}
            {isAdmin && (
              <Link to="/admin" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</Link>
            )}
          </nav>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-display text-xl sm:text-2xl font-bold">Catalogue</h2>
          <p className="text-sm text-muted-foreground">
            Tous les articles du site et de l'ERP, dans une seule vue.
          </p>
        </div>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un article, un code…"
              className="pl-9 h-10"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Famille</Label>
              <select
                value={famille}
                onChange={(e) => setFamille(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="all">Toutes</option>
                {familles.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-1.5">
              <Switch id="incl-erp" checked={includeErp} onCheckedChange={setIncludeErp} />
              <Label htmlFor="incl-erp" className="text-xs cursor-pointer">
                Voir aussi les articles ERP
              </Label>
            </div>
          </div>
        </div>

        <div className="mb-3 text-xs text-muted-foreground">
          {loading ? "Chargement…" : `${totalCount} article${totalCount > 1 ? "s" : ""}`}
          {includeErp && !loading && filteredErp.length > 0 ? (
            <span className="ml-1">· dont {filteredErp.length} sans fiche site</span>
          ) : null}
        </div>

        {loading ? (
          <div className="rounded-lg border border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="inline mr-2 h-4 w-4 animate-spin" /> Chargement du catalogue…
          </div>
        ) : totalCount === 0 ? (
          <div className="rounded-lg border border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
            Aucun article ne correspond à ces critères.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSite.map((p) => {
              const rawImg = p.images?.[0] ?? null;
              const thumb = shopifyThumb(rawImg, 480);
              const badge = stockErpBadge(p.stock_erp, p.cegid_code);
              const priceVerified = p.price_erp_ht != null;
              const href = p.product_url && p.product_url.trim()
                ? p.product_url
                : `https://avranchesautomatic.com/search?q=${encodeURIComponent(p.name)}`;
              return (
                <article
                  key={`site-${p.id}`}
                  className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card/40 transition hover:border-primary/50"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                    {/* Skeleton placeholder (masqué une fois l'image chargée) */}
                    <div className="absolute inset-0 animate-pulse bg-muted/40" aria-hidden />
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={p.name}
                        loading="lazy"
                        decoding="async"
                        onLoad={(e) => {
                          const prev = (e.currentTarget.previousElementSibling as HTMLElement | null);
                          if (prev) prev.style.display = "none";
                        }}
                        className="relative h-full w-full object-contain p-2 transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="relative flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        Visuel indisponible
                      </div>
                    )}
                    {/* Pastille stock — compact sur mobile, libellé dès sm */}
                    <div
                      className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/85 backdrop-blur-sm px-1.5 py-1 shadow-sm border border-border/60"
                      title={badge.label}
                      aria-label={badge.label}
                    >
                      <span className={cn("h-2 w-2 rounded-full", badge.color)} />
                      <span className="hidden sm:inline text-[10px] font-medium leading-none">{badge.label}</span>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-tight line-clamp-2">{p.name}</h3>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {[p.vendor, p.category].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                      <div className="text-sm inline-flex items-center gap-1.5">
                        {priceVerified ? (
                          <>
                            <span className="font-semibold text-primary">
                              {fmtEur(p.price_erp_ht)} <span className="text-[10px] font-normal text-muted-foreground">HT</span>
                            </span>
                            <span
                              title="Prix vérifié ERP"
                              aria-label="Prix vérifié ERP"
                              className="inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-500 px-1 py-0.5"
                            >
                              <BadgeCheck className="h-3 w-3" />
                            </span>
                          </>
                        ) : p.price != null ? (
                          <>
                            <span className="font-semibold">
                              {fmtEur(p.price)} <span className="text-[10px] font-normal text-muted-foreground">TTC</span>
                            </span>
                            <span
                              title="Prix site TTC, non vérifié ERP"
                              aria-label="Prix site TTC, non vérifié ERP"
                              className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-500 px-1 py-0.5"
                            >
                              <AlertTriangle className="h-3 w-3" />
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Prix non renseigné</span>
                        )}
                      </div>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:border-primary/60 hover:text-primary"
                      >
                        Fiche <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}


            {filteredErp.map((p) => {
              const Icon = iconForFamille(p.famille);
              const stock = stockBadge(p.stock);
              return (
                <article
                  key={`erp-${p.code}`}
                  className="group flex flex-col overflow-hidden rounded-lg border border-dashed border-border bg-card/30 transition hover:border-primary/40"
                >
                  <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-muted/40">
                    <Icon className="h-14 w-14 text-muted-foreground/70" strokeWidth={1.2} />
                    <Badge
                      variant="outline"
                      className="absolute right-2 top-2 text-[10px] border-primary/40 text-primary bg-background/80"
                    >
                      ERP
                    </Badge>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold leading-tight line-clamp-2">
                        {p.description || p.code}
                      </h3>
                      {stock ? (
                        <Badge
                          variant="outline"
                          className={
                            stock.tone === "destructive"
                              ? "text-[10px] border-destructive/60 text-destructive"
                              : stock.tone === "warning"
                              ? "text-[10px] border-amber-500/60 text-amber-500"
                              : "text-[10px] border-secondary/60 text-secondary"
                          }
                        >
                          {stock.label}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">{p.code}</span>
                      {p.famille ? <span>· {p.famille}</span> : null}
                    </div>
                    <div className="mt-auto pt-2 text-sm">
                      {p.prix_ht != null ? (
                        <span className="font-semibold text-primary">
                          Tarif HT : {fmtEur(p.prix_ht)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Tarif non renseigné</span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Database, Link2, Unlink, Search } from "lucide-react";
import logoImg from "@/assets/logo.png";

type CatalogRow = {
  id: string;
  name: string;
  category: string | null;
  vendor: string | null;
  price: number | null;
  price_erp_ht: number | null;
  cegid_code: string | null;
  active: boolean | null;
};

type StockRow = {
  inventory_id: string;
  description: string | null;
  famille2: string | null;
  prix_vente: number | null;
};

const fmtEur = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

export default function AdminCatalogErp() {
  const { isAdmin, loading: authLoading, user } = useAuth();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("unlinked");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<StockRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("catalog_products")
      .select("id, name, category, vendor, price, price_erp_ht, cegid_code, active")
      .eq("active", true)
      .order("name");
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    setRows((data as CatalogRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    load();
  }, [user, isAdmin]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "linked" && !r.cegid_code) return false;
      if (filter === "unlinked" && r.cegid_code) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.vendor ?? "").toLowerCase().includes(needle) ||
        (r.category ?? "").toLowerCase().includes(needle) ||
        (r.cegid_code ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, filter]);

  const counts = useMemo(() => {
    const linked = rows.filter((r) => r.cegid_code).length;
    return { linked, unlinked: rows.length - linked, total: rows.length };
  }, [rows]);

  const doSearch = async (row: CatalogRow, term: string) => {
    setSearch(term);
    const t = term.trim();
    if (t.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const { data, error } = await (supabase as any)
      .from("gaia_stock")
      .select("inventory_id, description, famille2, prix_vente")
      .or(
        `inventory_id.ilike.%${t}%,description.ilike.%${t}%`,
      )
      .limit(20);
    setSearching(false);
    if (error) {
      toast({ title: "Recherche impossible", description: error.message, variant: "destructive" });
      return;
    }
    setResults((data as StockRow[]) ?? []);
  };

  const link = async (row: CatalogRow, choice: StockRow) => {
    setSavingId(row.id);
    const { error } = await (supabase as any)
      .from("catalog_products")
      .update({
        cegid_code: choice.inventory_id,
        price_erp_ht: choice.prix_vente ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    setSavingId(null);
    if (error) {
      toast({ title: "Liaison impossible", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? { ...r, cegid_code: choice.inventory_id, price_erp_ht: choice.prix_vente ?? null }
          : r,
      ),
    );
    setOpenFor(null);
    setSearch("");
    setResults([]);
    toast({ title: "Produit lié à l'ERP", description: `${row.name} → ${choice.inventory_id}` });
  };

  const unlink = async (row: CatalogRow) => {
    if (!confirm(`Délier ${row.name} de l'ERP ?`)) return;
    setSavingId(row.id);
    const { error } = await (supabase as any)
      .from("catalog_products")
      .update({ cegid_code: null, price_erp_ht: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    setSavingId(null);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, cegid_code: null, price_erp_ht: null } : r)),
    );
    toast({ title: "Liaison supprimée" });
  };

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
            <img src={logoImg} alt="Arcade OS logo" className="h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-base sm:text-xl font-bold tracking-tight truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">OS</span>
            </h1>
          </Link>
          <nav className="ml-4 hidden md:flex items-center gap-1">
            <Link to="/dossiers" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Dossiers</Link>
            <Link to="/planner" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Arcade Planner</Link>
            <Link to="/admin" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</Link>
            <Link to="/admin/catalog-erp" className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> Catalogue ↔ ERP</Link>
            <Link to="/admin/gaia" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Database className="h-3 w-3" /> Gaia</Link>
          </nav>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-4">
          <h2 className="font-display text-xl sm:text-2xl font-bold">Liaison catalogue ↔ ERP</h2>
          <p className="text-sm text-muted-foreground">
            Associe chaque produit du catalogue à un article Cegid (BD-Stock). Le prix ERP HT devient le tarif de référence des dossiers.
          </p>
        </div>

        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-border bg-card/40 p-1 text-xs">
            {(["unlinked", "linked", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-3 py-1 ${filter === f ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f === "unlinked" ? `Non liés (${counts.unlinked})` : f === "linked" ? `Liés (${counts.linked})` : `Tous (${counts.total})`}
              </button>
            ))}
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un produit, un code ERP…"
            className="w-full sm:max-w-sm h-10"
          />
        </div>

        {loading ? (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="inline mr-2 h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
            Aucun produit.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => {
              const linked = !!row.cegid_code;
              const isOpen = openFor === row.id;
              return (
                <div key={row.id} className="rounded-lg border border-border bg-card/40 p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{row.name}</span>
                        {linked ? (
                          <Badge variant="default" className="text-[10px]">
                            ERP {row.cegid_code}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            Non lié
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground truncate">
                        {[row.vendor, row.category].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Prix site (TTC) : {fmtEur(row.price)} · Prix ERP HT :{" "}
                        <span className={row.price_erp_ht != null ? "text-foreground font-medium" : ""}>
                          {fmtEur(row.price_erp_ht)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {linked ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unlink(row)}
                          disabled={savingId === row.id}
                        >
                          <Unlink className="h-3.5 w-3.5 mr-1.5" />
                          Délier
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            setOpenFor(isOpen ? null : row.id);
                            setSearch(row.name);
                            setResults([]);
                            if (!isOpen) doSearch(row, row.name);
                          }}
                        >
                          <Link2 className="h-3.5 w-3.5 mr-1.5" />
                          {isOpen ? "Fermer" : "Lier à un article ERP"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isOpen && !linked && (
                    <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          autoFocus
                          value={search}
                          onChange={(e) => doSearch(row, e.target.value)}
                          placeholder="Rechercher par code ou libellé Cegid…"
                          className="pl-8 h-9"
                        />
                      </div>
                      <div className="mt-2 max-h-72 overflow-auto rounded border border-border/40 bg-card/40">
                        {searching ? (
                          <div className="p-3 text-xs text-muted-foreground">
                            <Loader2 className="inline mr-1.5 h-3 w-3 animate-spin" /> Recherche…
                          </div>
                        ) : results.length === 0 ? (
                          <div className="p-3 text-xs text-muted-foreground">
                            {search.trim().length < 2
                              ? "Tape au moins 2 caractères."
                              : "Aucun article correspondant dans gaia_stock."}
                          </div>
                        ) : (
                          results.map((s) => (
                            <button
                              key={s.inventory_id}
                              type="button"
                              onClick={() => link(row, s)}
                              disabled={savingId === row.id}
                              className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-3 py-2 text-left text-xs hover:bg-accent last:border-b-0"
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-[11px] text-primary">{s.inventory_id}</div>
                                <div className="truncate text-foreground">{s.description ?? "—"}</div>
                                <div className="truncate text-muted-foreground text-[10px]">
                                  {s.famille2 ?? "—"}
                                </div>
                              </div>
                              <div className="text-right text-[11px] font-medium text-foreground whitespace-nowrap">
                                {fmtEur(s.prix_vente)} HT
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

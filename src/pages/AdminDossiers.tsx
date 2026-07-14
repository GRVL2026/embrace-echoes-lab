import { useEffect, useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Database } from "lucide-react";
import { MobileNav } from "@/components/MobileNav";
import logoImg from "@/assets/logo.png";

type Brand = { id: string; name: string };
type Profile = { id: string; email: string | null; full_name: string | null };
type Project = {
  id: string;
  brand_id: string | null;
  client_name: string | null;
  offer: string | null;
  status: string | null;
  updated_at: string;
  owner_id: string | null;
};

const OFFER_LABEL: Record<string, string> = {
  vente: "Vente",
  location: "Location",
  leasing: "Leasing",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  won: "Gagné",
  lost: "Perdu",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  sent: "secondary",
  won: "default",
  lost: "destructive",
};

export default function AdminDossiers() {
  const { isAdmin, loading: authLoading, user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!user || !isAdmin) return;
    (async () => {
      setLoading(true);
      const [{ data: p, error: pe }, { data: b }, { data: pr }] = await Promise.all([
        (supabase as any)
          .from("projects")
          .select("id, brand_id, client_name, offer, status, updated_at, owner_id")
          .order("updated_at", { ascending: false }),
        (supabase as any).from("brands").select("id, name"),
        (supabase as any).from("profiles").select("id, email, full_name"),
      ]);
      if (pe) toast({ title: "Erreur", description: pe.message, variant: "destructive" });
      setProjects((p as Project[]) ?? []);
      setBrands((b as Brand[]) ?? []);
      const map: Record<string, Profile> = {};
      ((pr as Profile[]) ?? []).forEach((x) => (map[x.id] = x));
      setProfiles(map);
      setLoading(false);
    })();
  }, [user, isAdmin]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/dossiers" replace />;

  const brandName = (id: string | null) => brands.find((x) => x.id === id)?.name ?? "—";
  const ownerLabel = (id: string | null) => {
    if (!id) return "—";
    const p = profiles[id];
    if (!p) return "Utilisateur inconnu";
    return p.full_name?.trim() || p.email || "—";
  };

  const filtered = projects.filter((p) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      (p.client_name ?? "").toLowerCase().includes(needle) ||
      ownerLabel(p.owner_id).toLowerCase().includes(needle) ||
      brandName(p.brand_id).toLowerCase().includes(needle)
    );
  });

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
            <Link to="/dossiers" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Dossiers</Link>
            <Link to="/planner" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">Arcade Planner</Link>
            <Link to="/admin" className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium inline-flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</Link>
            <Link to="/admin/gaia" className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"><Database className="h-3 w-3" /> Gaia</Link>
          </nav>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold">Vue admin — Tous les dossiers</h2>
            <p className="text-sm text-muted-foreground">
              Dossiers de l'ensemble des commerciaux, triés du plus récent au plus ancien.
            </p>
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher client, commercial, marque…"
            className="w-full sm:max-w-xs h-11"
          />
        </div>

        <div className="hidden md:block rounded-lg border border-border bg-card/40">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Commercial</TableHead>
                <TableHead>Marque</TableHead>
                <TableHead>Offre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Mis à jour</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Chargement…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Aucun dossier.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/dossiers/${p.id}`)}
                  >
                    <TableCell className="font-medium">
                      {p.client_name?.trim() || <span className="text-muted-foreground">Sans nom</span>}
                    </TableCell>
                    <TableCell>{ownerLabel(p.owner_id)}</TableCell>
                    <TableCell>{brandName(p.brand_id)}</TableCell>
                    <TableCell>{p.offer ? OFFER_LABEL[p.offer] ?? p.offer : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status ?? "draft"] ?? "outline"}>
                        {STATUS_LABEL[p.status ?? "draft"] ?? p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(p.updated_at).toLocaleString("fr-FR")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="rounded-lg border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">Aucun dossier.</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/dossiers/${p.id}`)}
                className="w-full text-left rounded-lg border border-border bg-card/40 p-4 active:bg-card/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.client_name?.trim() || "Sans nom"}</div>
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      {ownerLabel(p.owner_id)} · {brandName(p.brand_id)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {p.offer ? OFFER_LABEL[p.offer] ?? p.offer : "—"} · {new Date(p.updated_at).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[p.status ?? "draft"] ?? "outline"}>
                    {STATUS_LABEL[p.status ?? "draft"] ?? p.status}
                  </Badge>
                </div>
              </button>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

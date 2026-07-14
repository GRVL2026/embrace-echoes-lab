import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusSelect, updateProjectStatus, type DossierStatus } from "@/components/dossier/StatusSelect";
import { UserMenu } from "@/components/UserMenu";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Shield, Trash2, Database } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { MobileNav } from "@/components/MobileNav";
import { Badge } from "@/components/ui/badge";
import logoImg from "@/assets/logo.png";

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  won: "Gagné",
  lost: "Perdu",
};

type Brand = { id: string; name: string; color?: string | null };
type Project = {
  id: string;
  brand_id: string | null;
  client_name: string | null;
  offer: string | null;
  status: string | null;
  updated_at: string;
  is_shared?: boolean | null;
  views_seen_at?: string | null;
};

type ViewStat = { count: number; last: string | null; hasNew: boolean };

const OFFER_LABEL: Record<string, string> = {
  vente: "Vente",
  location: "Location",
  leasing: "Leasing",
};

export default function DossiersList() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [viewStats, setViewStats] = useState<Record<string, ViewStat>>({});
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: p, error: pe }, { data: b, error: be }] = await Promise.all([
      (supabase as any)
        .from("projects")
        .select("id, brand_id, client_name, offer, status, updated_at")
        .order("updated_at", { ascending: false }),
      (supabase as any).from("brands").select("id, name, color"),
    ]);
    if (pe) toast({ title: "Erreur", description: pe.message, variant: "destructive" });
    if (be) toast({ title: "Erreur", description: be.message, variant: "destructive" });
    setProjects((p as Project[]) ?? []);
    setBrands((b as Brand[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const brandName = (id: string | null) =>
    brands.find((b) => b.id === id)?.name ?? "—";

  const createDossier = async () => {
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      toast({ title: "Non connecté", description: "Veuillez vous reconnecter.", variant: "destructive" });
      return;
    }
    const { data, error } = await (supabase as any)
      .from("projects")
      .insert({ status: "draft", client_name: "", owner_id: user.id })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      toast({ title: "Impossible de créer", description: error.message, variant: "destructive" });
      return;
    }
    navigate(`/dossiers/${data.id}`);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await (supabase as any)
      .from("projects")
      .delete()
      .eq("id", toDelete.id);
    if (error) {
      toast({ title: "Suppression impossible", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Dossier supprimé" });
      setProjects((prev) => prev.filter((p) => p.id !== toDelete.id));
    }
    setToDelete(null);
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 w-full max-w-full items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-3 sm:px-6 gap-2 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="md:hidden flex-shrink-0">
            <MobileNav />
          </div>
          <Link to="/dossiers" className="flex items-center gap-2 min-w-0">
            <img src={logoImg} alt="Arcade Planner logo" className="h-6 sm:h-7 w-auto object-contain flex-shrink-0" />
            <h1 className="font-display text-sm sm:text-xl font-bold tracking-tight whitespace-nowrap truncate">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">Planner</span>
            </h1>
          </Link>
          <nav className="ml-4 hidden md:flex items-center gap-1">
            <Link
              to="/dossiers"
              className="rounded-md bg-primary/15 border border-primary/40 text-primary px-3 py-1 text-xs font-medium"
            >
              Dossiers
            </Link>
            <Link
              to="/planner"
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              Arcade Planner
            </Link>
            {isAdmin && (
              <>
                <Link
                  to="/admin"
                  className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"
                >
                  <Shield className="h-3 w-3" /> Admin
                </Link>
                <Link
                  to="/admin/gaia"
                  className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"
                >
                  <Database className="h-3 w-3" /> Gaia
                </Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link to="/planner">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Ouvrir le planner
            </Link>
          </Button>
          <div className="hidden md:block">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold">Dossiers commerciaux</h2>
            <p className="text-sm text-muted-foreground">
              Tous les dossiers clients, triés du plus récent au plus ancien.
            </p>
          </div>
          <Button onClick={createDossier} disabled={creating} className="w-full sm:w-auto min-h-11">
            <Plus className="mr-2 h-4 w-4" />
            Nouveau dossier
          </Button>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-lg border border-border bg-card/40">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Marque</TableHead>
                <TableHead>Offre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Mis à jour</TableHead>
                <TableHead className="w-16 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Chargement…
                  </TableCell>
                </TableRow>
              ) : projects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Aucun dossier pour le moment.
                  </TableCell>
                </TableRow>
              ) : (
                projects.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/dossiers/${p.id}`)}
                  >
                    <TableCell className="font-medium">
                      {p.client_name?.trim() || <span className="text-muted-foreground">Sans nom</span>}
                    </TableCell>
                    <TableCell>{brandName(p.brand_id)}</TableCell>
                    <TableCell>{p.offer ? OFFER_LABEL[p.offer] ?? p.offer : "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <StatusSelect
                        size="sm"
                        value={p.status}
                        onChange={async (next) => {
                          const ok = await updateProjectStatus(p.id, next);
                          if (ok) {
                            setProjects((prev) => prev.map((r) => (r.id === p.id ? { ...r, status: next } : r)));
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(p.updated_at).toLocaleString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setToDelete(p);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="rounded-lg border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Chargement…
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Aucun dossier pour le moment.
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-border bg-card/40 p-4 active:bg-card/60"
                onClick={() => navigate(`/dossiers/${p.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {p.client_name?.trim() || <span className="text-muted-foreground">Sans nom</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      {brandName(p.brand_id)}
                      {p.offer ? ` · ${OFFER_LABEL[p.offer] ?? p.offer}` : ""}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(p.updated_at).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="outline">{STATUS_LABEL[p.status ?? "draft"] ?? p.status}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setToDelete(p);
                      }}
                      aria-label="Supprimer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce dossier ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est définitive. Le dossier
              {toDelete?.client_name ? ` « ${toDelete.client_name} »` : ""} sera supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

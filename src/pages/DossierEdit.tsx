import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Check, Loader2, Save } from "lucide-react";
import logoImg from "@/assets/logo.png";

type Brand = { id: string; name: string };
type Project = {
  id: string;
  brand_id: string | null;
  client_name: string | null;
  client_contact: string | null;
  offer: string | null;
  brief: string | null;
  status: string | null;
};

export default function DossierEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [form, setForm] = useState<Project | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [{ data: p, error: pe }, { data: b, error: be }] = await Promise.all([
        (supabase as any)
          .from("projects")
          .select("id, brand_id, client_name, client_contact, offer, brief, status")
          .eq("id", id)
          .maybeSingle(),
        (supabase as any).from("brands").select("id, name").order("name"),
      ]);
      if (pe) toast({ title: "Erreur", description: pe.message, variant: "destructive" });
      if (be) toast({ title: "Erreur", description: be.message, variant: "destructive" });
      if (!p) {
        toast({ title: "Dossier introuvable", variant: "destructive" });
        navigate("/dossiers");
        return;
      }
      setForm(p as Project);
      setBrands((b as Brand[]) ?? []);
      setLoading(false);
    })();
  }, [id, navigate]);

  const update = <K extends keyof Project>(key: K, value: Project[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  };

  const save = async () => {
    if (!form || !id) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("projects")
      .update({
        brand_id: form.brand_id,
        client_name: form.client_name,
        client_contact: form.client_contact,
        offer: form.offer,
        brief: form.brief,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast({ title: "Enregistrement impossible", description: error.message, variant: "destructive" });
      return;
    }
    setDirty(false);
    setSavedAt(new Date());
    toast({ title: "Dossier enregistré" });
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/30 backdrop-blur-sm px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3">
            <img src={logoImg} alt="Arcade Planner logo" className="h-7 w-auto object-contain" />
            <h1 className="font-display text-xl font-bold tracking-tight">
              <span className="text-primary text-glow-purple">Arcade</span>{" "}
              <span className="text-secondary text-glow-green">Planner</span>
            </h1>
          </Link>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Dossier
          </span>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/dossiers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux dossiers
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading || !form ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold">
                  {form.client_name?.trim() || "Nouveau dossier"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Renseigne les informations de base du dossier client.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {dirty ? (
                  <span className="text-xs text-muted-foreground">Modifications non enregistrées</span>
                ) : savedAt ? (
                  <span className="flex items-center gap-1 text-xs text-secondary">
                    <Check className="h-3.5 w-3.5" />
                    Enregistré à {savedAt.toLocaleTimeString("fr-FR")}
                  </span>
                ) : null}
                <Button onClick={save} disabled={saving || !dirty}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Enregistrer
                </Button>
              </div>
            </div>

            <div className="space-y-6 rounded-lg border border-border bg-card/40 p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="client_name">Nom du client</Label>
                  <Input
                    id="client_name"
                    value={form.client_name ?? ""}
                    onChange={(e) => update("client_name", e.target.value)}
                    placeholder="Ex. Bowling de Saint-Malo"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client_contact">Contact</Label>
                  <Input
                    id="client_contact"
                    value={form.client_contact ?? ""}
                    onChange={(e) => update("client_contact", e.target.value)}
                    placeholder="Email, téléphone ou nom du référent"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Marque</Label>
                  <Select
                    value={form.brand_id ?? ""}
                    onValueChange={(v) => update("brand_id", v || null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir une marque" />
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type d'offre</Label>
                  <Select
                    value={form.offer ?? ""}
                    onValueChange={(v) => update("offer", v || null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir un type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vente">Vente</SelectItem>
                      <SelectItem value="location">Location</SelectItem>
                      <SelectItem value="leasing">Leasing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brief">Brief</Label>
                <Textarea
                  id="brief"
                  value={form.brief ?? ""}
                  onChange={(e) => update("brief", e.target.value)}
                  placeholder="Décris librement le besoin du client, le contexte, les contraintes, les envies…"
                  rows={12}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import logoImg from "@/assets/logo.png";

type Brand = { id: string; name: string; key: string | null };
type BrandModule = {
  id: string;
  brand_id: string | null;
  type: string | null;
  slug: string | null;
  title: string | null;
  subtitle: string | null;
  position: number | null;
  slide_number: number | null;
  image_url: string | null;
};
type CatalogProduct = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  price_monthly: number | null;
  vendor: string | null;
};
type SelectedProduct = {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
};
type PricingLine = { label: string; qty: number; amount: number };
type Pricing = { lines: PricingLine[]; total_ht: number; monthly: number };

type Context = { contexte?: string; objectif?: string; enjeux?: string; lecture?: string };
type Solution = { selection?: string; deploiement?: string; suivi?: string };
type Scope = { fourniture?: string; livraison?: string; formation?: string; garantie?: string };

type Project = {
  id: string;
  brand_id: string | null;
  client_name: string | null;
  client_contact: string | null;
  offer: string | null;
  brief: string | null;
  status: string | null;
  selected_modules: string[] | null;
  selected_products: SelectedProduct[] | null;
  pricing: Pricing | null;
  context: Context | null;
  solution: Solution | null;
  scope: Scope | null;
};

function computePricing(products: SelectedProduct[], offer: string | null): Pricing {
  const lines: PricingLine[] = products.map((p) => ({
    label: p.name,
    qty: p.qty,
    amount: +(p.qty * p.unit_price).toFixed(2),
  }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const isRecurring = offer === "location" || offer === "leasing";
  return {
    lines,
    total_ht: isRecurring ? 0 : +total.toFixed(2),
    monthly: isRecurring ? +total.toFixed(2) : 0,
  };
}

export default function DossierEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [modules, setModules] = useState<BrandModule[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [form, setForm] = useState<Project | null>(null);
  const [previewSlide, setPreviewSlide] = useState<BrandModule | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [
        { data: p, error: pe },
        { data: b, error: be },
        { data: m, error: me },
        { data: c, error: ce },
      ] = await Promise.all([
        (supabase as any)
          .from("projects")
          .select(
            "id, brand_id, client_name, client_contact, offer, brief, status, selected_modules, selected_products, pricing, context, solution, scope",
          )
          .eq("id", id)
          .maybeSingle(),
        (supabase as any).from("brands").select("id, name, key").order("name"),
        (supabase as any)
          .from("brand_modules")
          .select("id, brand_id, type, slug, title, subtitle, position, slide_number, image_url")
          .eq("is_active", true)
          .eq("reusable", true)
          .order("slide_number", { ascending: true, nullsFirst: false })
          .order("position", { ascending: true }),
        (supabase as any)
          .from("catalog_products")
          .select("id, name, category, price, price_monthly, vendor")
          .eq("active", true)
          .order("name"),
      ]);
      if (pe) toast({ title: "Erreur", description: pe.message, variant: "destructive" });
      if (be) toast({ title: "Erreur", description: be.message, variant: "destructive" });
      if (me) toast({ title: "Erreur", description: me.message, variant: "destructive" });
      if (ce) toast({ title: "Erreur", description: ce.message, variant: "destructive" });
      if (!p) {
        toast({ title: "Dossier introuvable", variant: "destructive" });
        navigate("/dossiers");
        return;
      }
      const proj = p as Project;
      proj.selected_modules = Array.isArray(proj.selected_modules) ? proj.selected_modules : [];
      proj.selected_products = Array.isArray(proj.selected_products) ? proj.selected_products : [];
      setForm(proj);
      setBrands((b as Brand[]) ?? []);
      setModules((m as BrandModule[]) ?? []);
      setCatalog((c as CatalogProduct[]) ?? []);
      setLoading(false);
    })();
  }, [id, navigate]);

  const update = <K extends keyof Project>(key: K, value: Project[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  };

  const updateNested = <S extends "context" | "solution" | "scope">(
    section: S,
    key: string,
    value: string,
  ) => {
    setForm((f) => (f ? { ...f, [section]: { ...(f[section] ?? {}), [key]: value } } : f));
    setDirty(true);
  };

  // Recompute pricing whenever products or offer change
  const onProductsChange = (next: SelectedProduct[]) => {
    setForm((f) => {
      if (!f) return f;
      return { ...f, selected_products: next, pricing: computePricing(next, f.offer) };
    });
    setDirty(true);
  };
  const onOfferChange = (v: string | null) => {
    setForm((f) => {
      if (!f) return f;
      const products = f.selected_products ?? [];
      const nextProducts = products.map((p) => {
        const cat = catalog.find((c) => c.id === p.product_id);
        if (!cat) return p;
        const newPrice =
          v === "vente" ? cat.price ?? 0 : v === "location" || v === "leasing" ? cat.price_monthly ?? 0 : p.unit_price;
        return { ...p, unit_price: newPrice };
      });
      return { ...f, offer: v, selected_products: nextProducts, pricing: computePricing(nextProducts, v) };
    });
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
        selected_modules: form.selected_modules ?? [],
        selected_products: form.selected_products ?? [],
        pricing: form.pricing ?? computePricing(form.selected_products ?? [], form.offer),
        context: form.context ?? null,
        solution: form.solution ?? null,
        scope: form.scope ?? null,
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

  const generateWithAI = async () => {
    if (!form) return;
    const brief = (form.brief ?? "").trim();
    if (!brief) {
      toast({
        title: "Brief requis",
        description: "Écris un brief avant de lancer la génération IA.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    setAiSummary(null);
    try {
      const brand = brands.find((b) => b.id === form.brand_id);
      const { data, error } = await supabase.functions.invoke("generate-dossier", {
        body: {
          brief,
          offer: form.offer,
          client_name: form.client_name || undefined,
          brand_key: brand?.key || undefined,
        },
      });
      if (error) throw error;
      const dossier = (data as any)?.dossier;
      if (!dossier) throw new Error("Réponse IA invalide");

      const recommended = Array.isArray(dossier.recommended_products) ? dossier.recommended_products : [];
      const nextProducts: SelectedProduct[] = recommended
        .filter((r: any) => r && r.product_id && r.name)
        .map((r: any) => ({
          product_id: String(r.product_id),
          name: String(r.name),
          qty: Number(r.qty) || 1,
          unit_price: Number(r.unit_price) || 0,
        }));
      const moduleIds = Array.isArray(dossier.module_ids)
        ? dossier.module_ids.map((x: any) => String(x))
        : [];

      setForm((f) => {
        if (!f) return f;
        const pricingFromAi = dossier.pricing && typeof dossier.pricing === "object"
          ? dossier.pricing
          : computePricing(nextProducts, f.offer);
        return {
          ...f,
          context: dossier.context ?? f.context,
          solution: dossier.solution ?? f.solution,
          scope: dossier.scope ?? f.scope,
          selected_modules: moduleIds,
          selected_products: nextProducts,
          pricing: pricingFromAi,
        };
      });
      setAiSummary(typeof dossier.summary === "string" ? dossier.summary : null);
      setDirty(true);
      toast({ title: "Brouillon généré", description: "Ajuste librement avant d'enregistrer." });
    } catch (e: any) {
      toast({
        title: "Génération impossible",
        description: e?.message || "Une erreur est survenue lors de l'appel à l'IA.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  // --- Modules helpers ---
  const brandNameById = useMemo(
    () => Object.fromEntries(brands.map((b) => [b.id, b.name])),
    [brands],
  );
  const modulesByBrand = useMemo(() => {
    const groups: Record<string, BrandModule[]> = {};
    for (const m of modules) {
      const key = m.brand_id ?? "__none__";
      (groups[key] ||= []).push(m);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort(
        (a, b) => (a.slide_number ?? 9999) - (b.slide_number ?? 9999),
      );
    }
    return groups;
  }, [modules]);

  const selectedModules = form?.selected_modules ?? [];
  const toggleModule = (moduleId: string, checked: boolean) => {
    const current = selectedModules;
    const next = checked
      ? current.includes(moduleId)
        ? current
        : [...current, moduleId]
      : current.filter((x) => x !== moduleId);
    update("selected_modules", next);
  };
  const moveModule = (index: number, delta: number) => {
    const current = [...selectedModules];
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    update("selected_modules", current);
  };
  const orderedSelectedModules = useMemo(
    () => selectedModules.map((id) => modules.find((m) => m.id === id)).filter(Boolean) as BrandModule[],
    [selectedModules, modules],
  );

  // --- Products helpers ---
  const selectedProducts = form?.selected_products ?? [];
  const selectedProductIds = new Set(selectedProducts.map((p) => p.product_id));
  const searchResults = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    return catalog
      .filter((c) => !selectedProductIds.has(c.id) && c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [productQuery, catalog, selectedProductIds]);

  const addProduct = (p: CatalogProduct) => {
    const offer = form?.offer;
    const unit = offer === "vente" ? p.price ?? 0 : offer === "location" || offer === "leasing" ? p.price_monthly ?? 0 : p.price ?? 0;
    onProductsChange([
      ...selectedProducts,
      { product_id: p.id, name: p.name, qty: 1, unit_price: unit },
    ]);
    setProductQuery("");
  };
  const updateProductLine = (idx: number, patch: Partial<SelectedProduct>) => {
    const next = selectedProducts.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onProductsChange(next);
  };
  const removeProduct = (idx: number) => {
    onProductsChange(selectedProducts.filter((_, i) => i !== idx));
  };

  const isRecurring = form?.offer === "location" || form?.offer === "leasing";
  const totalAmount = selectedProducts.reduce((s, p) => s + p.qty * p.unit_price, 0);

  const contextFields: { key: keyof Context; label: string; rows?: number }[] = [
    { key: "contexte", label: "Contexte", rows: 3 },
    { key: "objectif", label: "Objectif", rows: 3 },
    { key: "enjeux", label: "Enjeux", rows: 3 },
    { key: "lecture", label: "Lecture", rows: 3 },
  ];
  const solutionFields: { key: keyof Solution; label: string }[] = [
    { key: "selection", label: "Sélection" },
    { key: "deploiement", label: "Déploiement" },
    { key: "suivi", label: "Suivi" },
  ];
  const scopeFields: { key: keyof Scope; label: string }[] = [
    { key: "fourniture", label: "Fourniture" },
    { key: "livraison", label: "Livraison" },
    { key: "formation", label: "Formation" },
    { key: "garantie", label: "Garantie" },
  ];

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

      <main className="mx-auto max-w-4xl px-6 py-8">
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
                  Renseigne les informations du dossier client.
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
                <Button
                  variant="outline"
                  onClick={generateWithAI}
                  disabled={generating || saving}
                >
                  {generating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Générer avec l'IA
                </Button>
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
                  <Select value={form.offer ?? ""} onValueChange={(v) => onOfferChange(v || null)}>
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
                  rows={10}
                />
              </div>
            </div>

            {aiSummary ? (
              <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-widest text-primary">
                      Note de l'IA
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{aiSummary}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setAiSummary(null)}
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}

            {/* SECTION Contexte */}
            <section className="mt-6 space-y-4 rounded-lg border border-border bg-card/40 p-6">
              <div>
                <h3 className="font-display text-lg font-semibold">Contexte</h3>
                <p className="text-sm text-muted-foreground">
                  Cadre général du projet client. Modifiable librement.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {contextFields.map((f) => (
                  <div key={f.key} className="space-y-2">
                    <Label>{f.label}</Label>
                    <Textarea
                      value={form.context?.[f.key] ?? ""}
                      onChange={(e) => updateNested("context", f.key, e.target.value)}
                      rows={f.rows ?? 3}
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* SECTION Solution */}
            <section className="mt-6 space-y-4 rounded-lg border border-border bg-card/40 p-6">
              <div>
                <h3 className="font-display text-lg font-semibold">Solution</h3>
                <p className="text-sm text-muted-foreground">
                  Approche proposée. Modifiable librement.
                </p>
              </div>
              <div className="space-y-4">
                {solutionFields.map((f) => (
                  <div key={f.key} className="space-y-2">
                    <Label>{f.label}</Label>
                    <Textarea
                      value={form.solution?.[f.key] ?? ""}
                      onChange={(e) => updateNested("solution", f.key, e.target.value)}
                      rows={3}
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* SECTION A : Slides du dossier */}
            <section className="mt-6 space-y-6 rounded-lg border border-border bg-card/40 p-6">
              <div>
                <h3 className="font-display text-lg font-semibold">Blocs de contenu</h3>
                <p className="text-sm text-muted-foreground">
                  Choisis les slides à inclure. Clique sur une vignette pour l'ajouter, re-clique pour la retirer. Utilise la loupe pour agrandir.
                </p>
              </div>

              {/* Ordered selection */}
              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Slides du dossier ({orderedSelectedModules.length})
                </div>
                {orderedSelectedModules.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                    Clique sur une vignette ci-dessous pour l'ajouter au dossier.
                  </div>
                ) : (
                  <ol className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                    {orderedSelectedModules.map((m, i) => (
                      <li
                        key={m.id}
                        className="group relative overflow-hidden rounded-md border border-border bg-background/60"
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-muted">
                          {m.image_url ? (
                            <img
                              src={m.image_url}
                              alt={m.title || "Slide"}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                              Aucune image
                            </div>
                          )}
                          <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {i + 1}
                          </span>
                        </div>
                        <div className="p-2">
                          <div className="truncate text-xs font-medium">
                            {m.title || m.slug || "Slide"}
                          </div>
                          {m.subtitle ? (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {m.subtitle}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-1 border-t border-border/60 bg-background/40 px-1 py-1">
                          <div className="flex gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={i === 0}
                              onClick={() => moveModule(i, -1)}
                              aria-label="Reculer"
                            >
                              <ArrowUp className="h-3.5 w-3.5 -rotate-90" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              disabled={i === orderedSelectedModules.length - 1}
                              onClick={() => moveModule(i, 1)}
                              aria-label="Avancer"
                            >
                              <ArrowDown className="h-3.5 w-3.5 -rotate-90" />
                            </Button>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => toggleModule(m.id, false)}
                            aria-label="Retirer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Available slides gallery */}
              <div className="space-y-4">
                <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Bibliothèque de slides
                </div>
                {modules.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Aucune slide disponible.</div>
                ) : (
                  Object.entries(modulesByBrand).map(([brandId, list]) => (
                    <div key={brandId} className="space-y-2">
                      <div className="text-xs font-semibold text-primary">
                        {brandId === "__none__" ? "Sans marque" : brandNameById[brandId] ?? "Marque"}
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {list.map((m) => {
                          const checked = selectedModules.includes(m.id);
                          return (
                            <div
                              key={m.id}
                              className={`group relative overflow-hidden rounded-md border transition ${
                                checked
                                  ? "border-primary ring-2 ring-primary/60"
                                  : "border-border/60 hover:border-border"
                              } bg-background/40`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleModule(m.id, !checked)}
                                className="block w-full text-left"
                              >
                                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                                  {m.image_url ? (
                                    <img
                                      src={m.image_url}
                                      alt={m.title || "Slide"}
                                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                      Aucune image
                                    </div>
                                  )}
                                  {m.slide_number != null ? (
                                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      #{m.slide_number}
                                    </span>
                                  ) : null}
                                  {checked ? (
                                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                      <Check className="h-3 w-3" />
                                    </span>
                                  ) : null}
                                </div>
                                <div className="p-2">
                                  <div className="truncate text-xs font-medium">
                                    {m.title || m.slug || "Slide"}
                                  </div>
                                  {m.subtitle ? (
                                    <div className="truncate text-[11px] text-muted-foreground">
                                      {m.subtitle}
                                    </div>
                                  ) : null}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewSlide(m);
                                }}
                                className="absolute bottom-9 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100"
                                aria-label="Agrandir"
                              >
                                Agrandir
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <Dialog open={!!previewSlide} onOpenChange={(o) => !o && setPreviewSlide(null)}>
              <DialogContent className="max-w-5xl p-0 overflow-hidden bg-background">
                {previewSlide ? (
                  <div>
                    <div className="aspect-video w-full bg-black">
                      {previewSlide.image_url ? (
                        <img
                          src={previewSlide.image_url}
                          alt={previewSlide.title || "Slide"}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          Aucune image
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-border p-4">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {previewSlide.title || previewSlide.slug || "Slide"}
                        </div>
                        {previewSlide.subtitle ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {previewSlide.subtitle}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        variant={selectedModules.includes(previewSlide.id) ? "outline" : "default"}
                        onClick={() => {
                          toggleModule(previewSlide.id, !selectedModules.includes(previewSlide.id));
                        }}
                      >
                        {selectedModules.includes(previewSlide.id) ? (
                          <>
                            <X className="mr-2 h-4 w-4" />
                            Retirer du dossier
                          </>
                        ) : (
                          <>
                            <Plus className="mr-2 h-4 w-4" />
                            Ajouter au dossier
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </DialogContent>
            </Dialog>



            {/* SECTION B : Jeux proposés */}
            <section className="mt-6 space-y-4 rounded-lg border border-border bg-card/40 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-semibold">Jeux proposés</h3>
                  <p className="text-sm text-muted-foreground">
                    Recherche un jeu du catalogue et ajoute-le au dossier.
                  </p>
                </div>
                {!form.offer ? (
                  <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                    Choisis un type d'offre pour pré-remplir les prix
                  </span>
                ) : null}
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Rechercher un jeu par nom…"
                  className="pl-9"
                />
                {searchResults.length > 0 ? (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                    {searchResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => addProduct(r)}
                        className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-accent last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[r.vendor, r.category].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {r.price != null ? <span>{r.price} € HT</span> : null}
                          {r.price_monthly != null ? <span>· {r.price_monthly} €/mois</span> : null}
                          <Plus className="h-4 w-4" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {selectedProducts.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                  Aucun jeu ajouté pour l'instant.
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Jeu</th>
                        <th className="w-24 px-3 py-2 text-right">Qté</th>
                        <th className="w-36 px-3 py-2 text-right">
                          {isRecurring ? "PU / mois" : "PU HT"}
                        </th>
                        <th className="w-32 px-3 py-2 text-right">Sous-total</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedProducts.map((p, i) => (
                        <tr key={p.product_id + i} className="border-t border-border/60">
                          <td className="px-3 py-2">{p.name}</td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              min={1}
                              value={p.qty}
                              onChange={(e) =>
                                updateProductLine(i, { qty: Math.max(1, Number(e.target.value) || 1) })
                              }
                              className="h-8 w-20 text-right"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={p.unit_price}
                              onChange={(e) =>
                                updateProductLine(i, { unit_price: Number(e.target.value) || 0 })
                              }
                              className="h-8 w-28 text-right"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {(p.qty * p.unit_price).toFixed(2)} €
                          </td>
                          <td className="px-2 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeProduct(i)}
                              aria-label="Retirer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/40">
                        <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">
                          {isRecurring ? "Total mensuel" : "Total HT"}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {totalAmount.toFixed(2)} € {isRecurring ? "/ mois" : ""}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>

            {/* SECTION Périmètre */}
            <section className="mt-6 space-y-4 rounded-lg border border-border bg-card/40 p-6">
              <div>
                <h3 className="font-display text-lg font-semibold">Périmètre</h3>
                <p className="text-sm text-muted-foreground">
                  Ce qui est couvert par l'offre. Modifiable librement.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {scopeFields.map((f) => (
                  <div key={f.key} className="space-y-2">
                    <Label>{f.label}</Label>
                    <Textarea
                      value={form.scope?.[f.key] ?? ""}
                      onChange={(e) => updateNested("scope", f.key, e.target.value)}
                      rows={3}
                    />
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

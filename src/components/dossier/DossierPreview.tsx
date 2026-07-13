import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, X, ChevronLeft, ChevronRight, Phone, Mail, Globe, MapPin, Download, Share2, Copy, Check, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { renderPlan2D } from "@/lib/plan2DRender";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { markSentIfDraft } from "@/components/dossier/StatusSelect";


type BrandContact = {
  phone?: string;
  email?: string;
  website?: string;
  sites?: string[] | string;
};
type Brand = { id: string; name: string; contact: BrandContact | null };
type BrandModule = { id: string; image_url: string | null; title: string | null };
type Project = {
  id: string;
  client_name: string | null;
  brand_id: string | null;
  offer: string | null;
  status?: string | null;
  selected_modules: string[] | null;
  selected_products: { product_id?: string; name: string; qty: number; unit_price: number }[] | null;
  pricing: { lines?: { label: string; qty: number; amount: number }[]; total_ht?: number; monthly?: number } | null;
  context: { contexte?: string; objectif?: string; enjeux?: string; lecture?: string } | null;
  solution: { selection?: string; deploiement?: string; suivi?: string } | null;
  scope: { fourniture?: string; livraison?: string; formation?: string; garantie?: string } | null;
  share_slug?: string | null;
  is_shared?: boolean | null;
  share_visibility?: string | null;
  share_password?: string | null;
  plan_data?: any | null;
};
type CatalogInfo = { id: string; images: string[] | null; product_url: string | null };

function productFicheUrl(name: string, product_url?: string | null): string {
  if (product_url && product_url.trim()) return product_url;
  return `https://avranchesautomatic.com/search?q=${encodeURIComponent(name)}`;
}

const CREAM = "#F6F1E7";
const DARK = "#1a1a1a";
const PURPLE = "#7c3aed";
const LIME = "#C7F73E";

function fmtEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);
}

function slugify(input: string) {
  return (input || "dossier")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "dossier";
}

function randomSuffix(len = 6) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function Page({ children, index, total }: { children: React.ReactNode; index: number; total: number }) {
  return (
    <section
      className="dossier-page relative flex w-full flex-shrink-0 snap-center items-center justify-center"
      style={{ aspectRatio: "16 / 9", background: CREAM, color: DARK }}
    >
      <div className="absolute right-6 top-4 text-xs font-medium tracking-widest" style={{ color: DARK, opacity: 0.5 }}>
        {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </div>
      <div className="h-full w-full">{children}</div>
    </section>
  );
}

function PageFrame({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col px-[6%] py-[5%]">
      {eyebrow && (
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.25em]" style={{ color: PURPLE }}>
          {eyebrow}
        </div>
      )}
      <h2 className="mb-6 font-display text-4xl font-bold leading-tight md:text-5xl" style={{ color: DARK }}>
        {title}
      </h2>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export type PreloadedDossier = {
  project: Project;
  brand: Brand | null;
  modules: BrandModule[];
  catalog: Record<string, CatalogInfo>;
};

export function DossierPreview({
  projectId,
  onClose,
  shareMode = false,
  embedded = false,
  liveProject,
  preloaded,
  onStatusChange,
}: {
  projectId?: string;
  onClose?: () => void;
  shareMode?: boolean;
  embedded?: boolean;
  liveProject?: Project | null;
  preloaded?: PreloadedDossier | null;
  onStatusChange?: (next: "draft" | "sent" | "won" | "lost") => void;
}) {
  const usePreloaded = !!preloaded;
  const useLive = !usePreloaded && liveProject !== undefined;
  const [loading, setLoading] = useState(!useLive && !usePreloaded);
  const [fetchedProject, setFetchedProject] = useState<Project | null>(preloaded?.project ?? null);
  const project: Project | null = usePreloaded
    ? preloaded!.project
    : useLive
    ? (liveProject ?? null)
    : fetchedProject;
  const [brand, setBrand] = useState<Brand | null>(preloaded?.brand ?? null);
  const [modules, setModules] = useState<BrandModule[]>(preloaded?.modules ?? []);
  const [catalogMap, setCatalogMap] = useState<Record<string, CatalogInfo>>(preloaded?.catalog ?? {});
  const [current, setCurrent] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [dialogVisibility, setDialogVisibility] = useState<"public" | "password">("public");
  const [dialogPassword, setDialogPassword] = useState("");
  const [shareOverlay, setShareOverlay] = useState<{ share_slug?: string | null; is_shared?: boolean | null; share_visibility?: string | null; share_password?: string | null } | null>(null);

  // Fetch the project when not driven by live form state or preloaded bundle.
  useEffect(() => {
    if (useLive || usePreloaded || !projectId) return;
    (async () => {
      setLoading(true);
      const { data: p } = await (supabase as any)
        .from("projects")
        .select(
          "id, client_name, brand_id, offer, status, selected_modules, selected_products, pricing, context, solution, scope, share_slug, is_shared, share_visibility, share_password, plan_data",
        )
        .eq("id", projectId)
        .maybeSingle();
      const proj = p as Project | null;
      setFetchedProject(proj);
      if (proj?.share_slug && proj?.is_shared) {
        setShareUrl(`${window.location.origin}/d/${proj.share_slug}`);
      }
      setLoading(false);
    })();
  }, [projectId, useLive, usePreloaded]);

  // Track share url from live project when available.
  useEffect(() => {
    if (useLive && liveProject?.share_slug && liveProject?.is_shared) {
      setShareUrl(`${window.location.origin}/d/${liveProject.share_slug}`);
    }
  }, [useLive, liveProject?.share_slug, liveProject?.is_shared]);

  // Fetch brand when brand_id changes.
  const brandId = project?.brand_id ?? null;
  useEffect(() => {
    if (usePreloaded) return;
    if (!brandId) { setBrand(null); return; }
    let cancelled = false;
    (async () => {
      const { data: b } = await (supabase as any)
        .from("brands")
        .select("id, name, contact")
        .eq("id", brandId)
        .maybeSingle();
      if (!cancelled) setBrand((b as Brand | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [brandId, usePreloaded]);

  // Fetch modules when selection changes (keyed on id list).
  const moduleIdsKey = (project?.selected_modules ?? []).join(",");
  useEffect(() => {
    if (usePreloaded) return;
    const ids = moduleIdsKey ? moduleIdsKey.split(",").filter(Boolean) : [];
    if (ids.length === 0) { setModules([]); return; }
    let cancelled = false;
    (async () => {
      const { data: m } = await (supabase as any)
        .from("brand_modules")
        .select("id, image_url, title")
        .in("id", ids);
      if (cancelled) return;
      const map = new Map<string, BrandModule>(((m as BrandModule[]) ?? []).map((x) => [x.id, x]));
      setModules(ids.map((id) => map.get(id)).filter(Boolean) as BrandModule[]);
    })();
    return () => { cancelled = true; };
  }, [moduleIdsKey, usePreloaded]);

  // Fetch catalog metadata when product ids change.
  const productIdsKey = Array.from(
    new Set((project?.selected_products ?? []).map((x) => x.product_id).filter((x): x is string => !!x)),
  ).sort().join(",");
  useEffect(() => {
    if (usePreloaded) return;
    const pids = productIdsKey ? productIdsKey.split(",").filter(Boolean) : [];
    if (pids.length === 0) { setCatalogMap({}); return; }
    let cancelled = false;
    (async () => {
      const { data: cp } = await (supabase as any)
        .from("catalog_products")
        .select("id, images, product_url")
        .in("id", pids);
      if (cancelled) return;
      const cmap: Record<string, CatalogInfo> = {};
      for (const c of (cp as CatalogInfo[]) ?? []) cmap[c.id] = c;
      setCatalogMap(cmap);
    })();
    return () => { cancelled = true; };
  }, [productIdsKey, usePreloaded]);

  const slidePages = useMemo(() => modules.filter((m) => !!m.image_url), [modules]);

  const planImage = useMemo(() => {
    const pd = project?.plan_data;
    if (!pd || !Array.isArray(pd.rooms) || pd.rooms.length === 0) return null;
    const opts = pd.displayOptions ?? {};
    try {
      return renderPlan2D(
        pd.rooms ?? [],
        pd.doors ?? [],
        pd.pillars ?? [],
        pd.placedEquipments ?? [],
        pd.circulationPath ?? [],
        {
          width: 1920,
          height: 1080,
          showWallDimensions: true,
          showGames: opts.showGames ?? true,
          showGapMeasurements: opts.showGapMeasurements ?? false,
          showCirculation: opts.showCirculation ?? false,
          title: "Plan de la salle",
        },
      );
    } catch {
      return null;
    }
  }, [project?.plan_data]);
  const hasPlan = !!planImage;

  const nonEmpty = (v: any) => typeof v === "string" && v.trim().length > 0;
  const ctx = project?.context ?? {};
  const sol = project?.solution ?? {};
  const scp = project?.scope ?? {};
  const prc = project?.pricing ?? {};
  const hasContext = nonEmpty(ctx.contexte) || nonEmpty(ctx.objectif) || nonEmpty(ctx.enjeux) || nonEmpty(ctx.lecture);
  const hasSolution = nonEmpty(sol.selection) || nonEmpty(sol.deploiement) || nonEmpty(sol.suivi);
  const hasScope = nonEmpty(scp.fourniture) || nonEmpty(scp.livraison) || nonEmpty(scp.formation) || nonEmpty(scp.garantie);
  const hasProducts = Array.isArray(project?.selected_products) && (project!.selected_products!.length > 0);
  const hasPricing = (Array.isArray(prc.lines) && prc.lines.length > 0) || (prc.total_ht ?? 0) > 0 || (prc.monthly ?? 0) > 0;
  const hasContact = !!brand;

  const customPagesCount =
    (hasContext ? 1 : 0) +
    (hasSolution ? 1 : 0) +
    (hasPlan ? 1 : 0) +
    (hasProducts ? 1 : 0) +
    (hasScope ? 1 : 0) +
    (hasPricing ? 1 : 0) +
    (hasContact ? 1 : 0);
  const totalPages = slidePages.length + customPagesCount;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(c + 1, totalPages - 1));
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(c - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalPages, onClose]);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, i));
    setCurrent(clamped);
    const el = document.getElementById(`dossier-page-${clamped}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handlePrint = () => {
    document.body.classList.add("dossier-printing");
    // Only mark as sent when the print dialog actually completes (user printed/saved PDF),
    // not on the mere click that opens the browser print options.
    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      document.body.classList.remove("dossier-printing");
      if (!shareMode && project?.id) {
        markSentIfDraft(project.id, project.status).then((next) => {
          if (next !== project.status) {
            setFetchedProject((prev) => (prev ? { ...prev, status: next } : prev));
            onStatusChange?.(next);
          }
        });
      }
    };
    window.addEventListener("afterprint", onAfterPrint);
    setTimeout(() => {
      window.print();
      // Safety net if afterprint never fires (rare)
      setTimeout(() => document.body.classList.remove("dossier-printing"), 1000);
    }, 100);
  };

  const shareInfo = {
    share_slug: shareOverlay?.share_slug ?? project?.share_slug ?? null,
    is_shared: shareOverlay?.is_shared ?? project?.is_shared ?? false,
    share_visibility: shareOverlay?.share_visibility ?? project?.share_visibility ?? "public",
    share_password: shareOverlay?.share_password ?? project?.share_password ?? null,
  };

  const openShareDialog = () => {
    if (!project) return;
    const vis = (shareInfo.share_visibility === "password" ? "password" : "public") as "public" | "password";
    setDialogVisibility(vis);
    setDialogPassword(shareInfo.share_password ?? "");
    setShareDialogOpen(true);
  };

  const submitShare = async () => {
    if (!project) return;
    if (dialogVisibility === "password" && !dialogPassword.trim()) {
      toast({ title: "Mot de passe requis", description: "Saisis un mot de passe pour protéger le partage.", variant: "destructive" });
      return;
    }
    setSharing(true);
    try {
      let slug = shareInfo.share_slug;
      if (!slug) {
        const base = slugify(project.client_name || brand?.name || "dossier");
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = `${base}-${randomSuffix(5)}`;
          const { data: existing } = await (supabase as any)
            .from("projects")
            .select("id")
            .eq("share_slug", candidate)
            .maybeSingle();
          if (!existing) {
            slug = candidate;
            break;
          }
        }
      }
      if (!slug) throw new Error("Impossible de générer un slug");
      const payload: any = {
        share_slug: slug,
        is_shared: true,
        share_visibility: dialogVisibility,
        share_password: dialogVisibility === "password" ? dialogPassword : null,
      };
      const { error } = await (supabase as any)
        .from("projects")
        .update(payload)
        .eq("id", project.id);
      if (error) throw error;
      // Auto-mark as sent on first successful share
      const nextStatus = await markSentIfDraft(project.id, project.status);
      if (nextStatus !== project.status) {
        setFetchedProject((prev) => (prev ? { ...prev, status: nextStatus } : prev));
        onStatusChange?.(nextStatus);
      }
      const url = `${window.location.origin}/d/${slug}`;
      setShareUrl(url);
      setShareOverlay(payload);
      setFetchedProject((prev) => (prev ? { ...prev, ...payload } : prev));
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast({ title: "Lien copié", description: url });
      } catch {
        toast({ title: "Lien de partage prêt", description: url });
      }
      setShareDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e?.message ?? "Partage impossible", variant: "destructive" });
    } finally {
      setSharing(false);
    }
  };

  const copyPassword = async () => {
    const pwd = shareInfo.share_password ?? "";
    if (!pwd) return;
    try {
      await navigator.clipboard.writeText(pwd);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 2000);
      toast({ title: "Mot de passe copié" });
    } catch {
      /* noop */
    }
  };




  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  const clientName = project?.client_name?.trim() || "votre projet";
  const context = project?.context ?? {};
  const solution = project?.solution ?? {};
  const scope = project?.scope ?? {};
  const products = project?.selected_products ?? [];
  const pricing = project?.pricing ?? { lines: [], total_ht: 0, monthly: 0 };
  const isRecurring = project?.offer === "location" || project?.offer === "leasing";
  const contact = brand?.contact ?? {};
  const sites = Array.isArray(contact.sites) ? contact.sites : contact.sites ? [contact.sites] : [];

  const rootClass = embedded
    ? "flex h-full w-full flex-col bg-black/90"
    : `${shareMode ? "min-h-screen" : "fixed inset-0 z-[100]"} flex flex-col bg-black/90`;
  return (
    <div className={rootClass}>

      <div className="dossier-toolbar flex h-12 flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/60 px-4 text-white backdrop-blur">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-display font-semibold">Aperçu du dossier</span>
          {brand && <span className="text-white/60">— {brand.name}</span>}
        </div>
        <div className="flex items-center gap-2">
          {!shareMode && (
            <>
              <Button variant="ghost" size="sm" onClick={openShareDialog} disabled={sharing || loading} className="text-white hover:bg-white/10">
                {sharing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Share2 className="mr-1 h-4 w-4" />}
                Partager
              </Button>
              <Button variant="ghost" size="sm" onClick={handlePrint} disabled={loading} className="text-white hover:bg-white/10">
                <Download className="mr-1 h-4 w-4" />
                Télécharger PDF
              </Button>
              <div className="mx-1 h-6 w-px bg-white/20" />
            </>
          )}
          {shareMode && (
            <Button variant="ghost" size="sm" onClick={handlePrint} disabled={loading} className="text-white hover:bg-white/10">
              <Download className="mr-1 h-4 w-4" />
              Télécharger PDF
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => goTo(current - 1)} disabled={current === 0} className="text-white hover:bg-white/10">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[70px] text-center text-xs tabular-nums text-white/80">
            {current + 1} / {totalPages || 1}
          </span>
          <Button variant="ghost" size="sm" onClick={() => goTo(current + 1)} disabled={current >= totalPages - 1} className="text-white hover:bg-white/10">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {onClose && !shareMode && (
            <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:bg-white/10">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {shareUrl && !shareMode && (
        <div className="dossier-toolbar flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-black/40 px-4 py-2 text-xs text-white">
          <span className="text-white/60">
            {shareInfo.share_visibility === "password" ? "Lien protégé :" : "Lien public :"}
          </span>
          <code className="min-w-0 flex-1 truncate rounded bg-white/10 px-2 py-1 font-mono">{shareUrl}</code>
          <Button variant="ghost" size="sm" onClick={copyShareUrl} className="text-white hover:bg-white/10" title="Copier le lien">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="text-white/80 underline hover:text-white">Ouvrir</a>
          <Button variant="ghost" size="sm" onClick={openShareDialog} className="text-white hover:bg-white/10">
            Modifier
          </Button>
          {shareInfo.share_visibility === "password" && shareInfo.share_password ? (
            <div className="flex w-full items-center gap-2 border-t border-white/10 pt-2 sm:w-auto sm:border-none sm:pt-0">
              <Lock className="h-3 w-3 text-white/60" />
              <span className="text-white/60">Mot de passe à transmettre :</span>
              <code className="rounded bg-white/10 px-2 py-1 font-mono">
                {showPassword ? shareInfo.share_password : "•".repeat(Math.min(12, shareInfo.share_password.length))}
              </code>
              <Button variant="ghost" size="sm" onClick={() => setShowPassword((v) => !v)} className="text-white hover:bg-white/10" title={showPassword ? "Masquer" : "Afficher"}>
                {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={copyPassword} className="text-white hover:bg-white/10" title="Copier le mot de passe">
                {passwordCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Partager le dossier</DialogTitle>
            <DialogDescription>
              Choisis comment ce dossier est accessible via le lien /d/{shareInfo.share_slug ?? "…"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <RadioGroup value={dialogVisibility} onValueChange={(v) => setDialogVisibility(v as "public" | "password")}>
              <div className="flex items-start gap-3 rounded-md border border-border p-3">
                <RadioGroupItem value="public" id="vis-public" className="mt-1" />
                <Label htmlFor="vis-public" className="flex-1 cursor-pointer">
                  <div className="font-medium">Public</div>
                  <div className="text-xs text-muted-foreground">Toute personne ayant le lien peut consulter le dossier.</div>
                </Label>
              </div>
              <div className="flex items-start gap-3 rounded-md border border-border p-3">
                <RadioGroupItem value="password" id="vis-password" className="mt-1" />
                <Label htmlFor="vis-password" className="flex-1 cursor-pointer">
                  <div className="font-medium">Protégé par mot de passe</div>
                  <div className="text-xs text-muted-foreground">Le client devra saisir un mot de passe pour ouvrir le dossier.</div>
                </Label>
              </div>
            </RadioGroup>
            {dialogVisibility === "password" && (
              <div className="space-y-2">
                <Label htmlFor="share-pwd">Mot de passe</Label>
                <Input
                  id="share-pwd"
                  type="text"
                  autoComplete="off"
                  value={dialogPassword}
                  onChange={(e) => setDialogPassword(e.target.value)}
                  placeholder="Ex : arcade2026"
                />
                <p className="text-[11px] text-muted-foreground">
                  Ce mot de passe s'affichera dans l'aperçu pour que tu puisses le transmettre au client.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShareDialogOpen(false)} disabled={sharing}>
              Annuler
            </Button>
            <Button onClick={submitShare} disabled={sharing}>
              {sharing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enregistrer et copier le lien
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {loading || !project ? (
        <div className="flex flex-1 items-center justify-center text-white">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Chargement…
        </div>
      ) : (
        <div className="dossier-scroll flex-1 overflow-y-auto snap-y snap-mandatory">
          <div className="dossier-print-root mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-6">
            {/* PARTIE A — slides images */}
            {slidePages.map((m, i) => (
              <div id={`dossier-page-${i}`} key={m.id} className="dossier-slide w-full overflow-hidden rounded-lg shadow-2xl">
                <section className="dossier-page relative w-full snap-center" style={{ aspectRatio: "16 / 9" }}>
                  <img src={m.image_url!} alt={m.title ?? `Slide ${i + 1}`} className="h-full w-full object-cover" />
                </section>
              </div>
            ))}

            {/* PARTIE B — pages reconstruites (uniquement les sections remplies) */}
            {(() => {
              const offset = slidePages.length;
              const pages: React.ReactNode[] = [];

              if (hasContext) {
                pages.push(
                  <PageFrame eyebrow="Contexte & besoin" title={`Le besoin de ${clientName}`}>
                    <div className="grid h-full grid-cols-2 grid-rows-2 gap-5">
                      {[
                        { label: "Le contexte", value: context.contexte },
                        { label: "L'objectif", value: context.objectif },
                        { label: "Les enjeux", value: context.enjeux },
                        { label: "Notre lecture", value: context.lecture },
                      ].filter((c) => nonEmpty(c.value)).map((c) => (
                        <div key={c.label} className="flex flex-col rounded-xl border p-5" style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.55)" }}>
                          <div className="mb-2 flex items-center gap-2">
                            <span className="inline-block h-2 w-8 rounded-full" style={{ background: LIME }} />
                            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: PURPLE }}>{c.label}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: DARK }}>{c.value}</p>
                        </div>
                      ))}
                    </div>
                  </PageFrame>
                );
              }

              if (hasSolution) {
                pages.push(
                  <PageFrame eyebrow="Notre approche" title="Solution proposée">
                    <div className="grid h-full grid-cols-3 gap-5">
                      {[
                        { n: "01", label: "Sélection", value: solution.selection },
                        { n: "02", label: "Déploiement", value: solution.deploiement },
                        { n: "03", label: "Suivi", value: solution.suivi },
                      ].filter((s) => nonEmpty(s.value)).map((s) => (
                        <div key={s.n} className="flex flex-col rounded-xl p-6" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.08)" }}>
                          <div className="mb-3 font-display text-5xl font-bold" style={{ color: PURPLE }}>{s.n}</div>
                          <div className="mb-2 h-1 w-10 rounded-full" style={{ background: LIME }} />
                          <div className="mb-3 text-lg font-bold" style={{ color: DARK }}>{s.label}</div>
                          <p className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: DARK, opacity: 0.85 }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  </PageFrame>
                );
              }

              if (hasPlan) {
                pages.push(
                  <PageFrame eyebrow="Agencement" title="Plan de la salle">
                    <div className="flex h-full w-full items-center justify-center rounded-xl border overflow-hidden" style={{ borderColor: "rgba(0,0,0,0.08)", background: DARK }}>
                      <img src={planImage!} alt="Plan de la salle" className="max-h-full max-w-full object-contain" />
                    </div>
                  </PageFrame>
                );
              }

              if (hasProducts) {
                pages.push(
                  <PageFrame eyebrow="Équipements" title="Sélection produits">
                    <div className="h-full overflow-auto rounded-xl border" style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.55)" }}>
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr style={{ background: PURPLE, color: "white" }}>
                            <th className="px-4 py-3 w-24">Visuel</th>
                            <th className="px-4 py-3">Produit</th>
                            <th className="px-4 py-3 text-center w-24">Quantité</th>
                            <th className="px-4 py-3 text-right w-48">Fiche produit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((p, i) => {
                            const cat = p.product_id ? catalogMap[p.product_id] : undefined;
                            const img = cat?.images?.[0] ?? null;
                            const href = productFicheUrl(p.name, cat?.product_url);
                            return (
                              <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                <td className="px-4 py-3">
                                  <a href={href} target="_blank" rel="noreferrer" className="flex h-16 w-24 items-center justify-center overflow-hidden rounded border p-1" style={{ borderColor: "rgba(0,0,0,0.1)", background: "#ffffff" }}>
                                    {img ? (
                                      <img src={img} alt={p.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                                    ) : (
                                      <div className="text-[9px] leading-tight text-center px-1" style={{ color: DARK, opacity: 0.5 }}>
                                        visuel indisponible
                                      </div>
                                    )}
                                  </a>
                                </td>
                                <td className="px-4 py-3">
                                  <a href={href} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline" style={{ color: DARK }}>
                                    {p.name}
                                  </a>
                                  <div className="dossier-pdf-link text-[10px] mt-0.5 break-all" style={{ color: PURPLE, display: "none" }}>
                                    {href}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center tabular-nums">{p.qty}</td>
                                <td className="px-4 py-3 text-right">
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:opacity-90"
                                    style={{ background: PURPLE, color: "white" }}
                                  >
                                    Voir la fiche produit →
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </PageFrame>

                );
              }

              if (hasScope) {
                pages.push(
                  <PageFrame eyebrow="Notre engagement" title="Périmètre & livrables">
                    <div className="grid h-full grid-cols-2 grid-rows-2 gap-5">
                      {[
                        { label: "Fourniture", value: scope.fourniture },
                        { label: "Livraison", value: scope.livraison },
                        { label: "Formation", value: scope.formation },
                        { label: "Garantie", value: scope.garantie },
                      ].filter((s) => nonEmpty(s.value)).map((s) => (
                        <div key={s.label} className="flex items-start gap-4 rounded-xl p-5" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.08)" }}>
                          <div className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: LIME, color: DARK }}>✓</div>
                          <div>
                            <div className="mb-1 text-xs font-bold uppercase tracking-widest" style={{ color: PURPLE }}>{s.label}</div>
                            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{s.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </PageFrame>
                );
              }

              if (hasPricing) {
                pages.push(
                  <PageFrame eyebrow="Investissement" title="Tarifs & budget">
                    <div className="flex h-full flex-col gap-4">
                      {(pricing.lines ?? []).length > 0 && (
                        <div className="flex-1 overflow-auto rounded-xl border" style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.55)" }}>
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr style={{ background: PURPLE, color: "white" }}>
                                <th className="px-4 py-3">Ligne</th>
                                <th className="px-4 py-3 text-center">Qté</th>
                                <th className="px-4 py-3 text-right">Montant</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(pricing.lines ?? []).map((l, i) => (
                                <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                  <td className="px-4 py-3">{l.label}</td>
                                  <td className="px-4 py-3 text-center">{l.qty}</td>
                                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtEUR(l.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-8 rounded-xl px-6 py-4" style={{ background: DARK, color: "white" }}>
                        {(pricing.total_ht ?? 0) > 0 && (
                          <div className="text-right">
                            <div className="text-xs uppercase tracking-widest opacity-70">Total HT</div>
                            <div className="font-display text-3xl font-bold" style={{ color: LIME }}>{fmtEUR(pricing.total_ht ?? 0)}</div>
                          </div>
                        )}
                        {isRecurring && (pricing.monthly ?? 0) > 0 && (
                          <div className="text-right">
                            <div className="text-xs uppercase tracking-widest opacity-70">Mensualité</div>
                            <div className="font-display text-3xl font-bold" style={{ color: LIME }}>{fmtEUR(pricing.monthly ?? 0)} <span className="text-base opacity-70">/ mois</span></div>
                          </div>
                        )}
                      </div>
                    </div>
                  </PageFrame>
                );
              }

              if (hasContact) {
                pages.push(
                  <PageFrame eyebrow="Contact" title="Passons à l'action">
                    <div className="grid h-full grid-cols-2 gap-5">
                      <div className="flex flex-col justify-center gap-4 rounded-xl p-8" style={{ background: DARK, color: "white" }}>
                        <div className="text-xs uppercase tracking-widest" style={{ color: LIME }}>{brand?.name ?? "Notre équipe"}</div>
                        <p className="font-display text-2xl font-bold leading-snug">
                          Prêts à concrétiser <span style={{ color: LIME }}>{clientName}</span> ?
                        </p>
                        <p className="text-sm opacity-80">Contactez-nous pour la suite : validation, planning, installation.</p>
                      </div>
                      <div className="flex flex-col justify-center gap-4 rounded-xl p-8" style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.08)" }}>
                        {contact.phone && (
                          <div className="flex items-center gap-3"><Phone className="h-5 w-5" style={{ color: PURPLE }} /><span className="text-[15px]">{contact.phone}</span></div>
                        )}
                        {contact.email && (
                          <div className="flex items-center gap-3"><Mail className="h-5 w-5" style={{ color: PURPLE }} /><span className="text-[15px]">{contact.email}</span></div>
                        )}
                        {contact.website && (
                          <div className="flex items-center gap-3"><Globe className="h-5 w-5" style={{ color: PURPLE }} /><span className="text-[15px]">{contact.website}</span></div>
                        )}
                        {sites.length > 0 && (
                          <div className="flex items-start gap-3">
                            <MapPin className="mt-1 h-5 w-5 flex-shrink-0" style={{ color: PURPLE }} />
                            <div className="flex flex-col gap-1">
                              {sites.map((s, i) => <span key={i} className="text-[15px]">{s}</span>)}
                            </div>
                          </div>
                        )}
                        {!contact.phone && !contact.email && !contact.website && sites.length === 0 && (
                          <p className="text-sm opacity-60">Coordonnées non renseignées.</p>
                        )}
                      </div>
                    </div>
                  </PageFrame>
                );
              }

              return pages.map((node, i) => {
                const pageIdx = offset + i;
                return (
                  <div id={`dossier-page-${pageIdx}`} key={`custom-${i}`} className="dossier-slide w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={pageIdx + 1} total={totalPages}>{node}</Page>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

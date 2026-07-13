import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { DossierPreview, type PreloadedDossier } from "@/components/dossier/DossierPreview";

export default function PublicDossier() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preloaded, setPreloaded] = useState<PreloadedDossier | null>(null);

  useEffect(() => {
    (async () => {
      if (!slug) {
        setError("Lien invalide");
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("get-shared-dossier", {
          body: { slug },
        });
        if (error) throw error;
        if (!data?.project) {
          setError("Ce dossier n'est pas disponible.");
        } else {
          // Rebuild catalog map from enriched products payload (id -> {images, product_url}).
          const catalog: Record<string, { id: string; images: string[] | null; product_url: string | null }> = {};
          for (const p of data.products ?? []) {
            if (p?.product_id) {
              catalog[p.product_id] = {
                id: p.product_id,
                images: p.image ? [p.image] : null,
                product_url: p.product_url ?? null,
              };
            }
          }
          setPreloaded({
            project: data.project,
            brand: data.brand ?? null,
            modules: data.modules ?? [],
            catalog,
          });
        }
      } catch (e: any) {
        setError(e?.message ?? "Ce dossier n'est pas disponible.");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Chargement…
      </div>
    );
  }
  if (error || !preloaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="mb-2 font-display text-2xl font-bold">Dossier introuvable</h1>
          <p className="text-white/60">{error ?? "Ce lien n'existe pas ou n'est plus actif."}</p>
        </div>
      </div>
    );
  }
  return <DossierPreview shareMode preloaded={preloaded} />;
}

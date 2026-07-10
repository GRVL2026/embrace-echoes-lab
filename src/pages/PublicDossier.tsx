import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { DossierPreview } from "@/components/dossier/DossierPreview";

export default function PublicDossier() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!slug) {
        setError("Lien invalide");
        setLoading(false);
        return;
      }
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, is_shared")
        .eq("share_slug", slug)
        .maybeSingle();
      if (error || !data || !data.is_shared) {
        setError("Ce dossier n'est pas disponible.");
      } else {
        setProjectId(data.id as string);
      }
      setLoading(false);
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
  if (error || !projectId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="mb-2 font-display text-2xl font-bold">Dossier introuvable</h1>
          <p className="text-white/60">{error ?? "Ce lien n'existe pas ou n'est plus actif."}</p>
        </div>
      </div>
    );
  }
  return <DossierPreview projectId={projectId} shareMode />;
}

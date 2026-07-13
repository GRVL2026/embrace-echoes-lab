import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Lock } from "lucide-react";
import { DossierPreview, type PreloadedDossier } from "@/components/dossier/DossierPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PublicDossier() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preloaded, setPreloaded] = useState<PreloadedDossier | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const fetchDossier = useCallback(
    async (password?: string) => {
      if (!slug) {
        setError("Lien invalide");
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("get-shared-dossier", {
          body: { slug, ...(password ? { password } : {}) },
        });

        // The Supabase functions client wraps non-2xx as `error`; body is still in `data` sometimes.
        // Detect password requirement from either channel.
        const payload: any = data ?? (error as any)?.context?.body ?? null;
        let parsed: any = payload;
        if (typeof payload === "string") {
          try { parsed = JSON.parse(payload); } catch { /* noop */ }
        }

        if (parsed?.password_required) {
          setPasswordRequired(true);
          setPreloaded(null);
          setError(null);
          if (password) setPasswordError(parsed?.error ?? "Mot de passe incorrect");
          return;
        }

        if (error) throw error;

        if (!data?.project) {
          setError("Ce dossier n'est pas disponible.");
          return;
        }

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
        setPasswordRequired(false);
        setPasswordError(null);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Ce dossier n'est pas disponible.");
      }
    },
    [slug],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchDossier();
      setLoading(false);
    })();
  }, [fetchDossier]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    setSubmitting(true);
    setPasswordError(null);
    await fetchDossier(passwordInput);
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Chargement…
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
        <form onSubmit={submitPassword} className="w-full max-w-sm rounded-lg border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold">Dossier protégé</h1>
              <p className="text-xs text-white/60">Saisis le mot de passe communiqué par ton commercial.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pwd" className="text-white">Mot de passe</Label>
            <Input
              id="pwd"
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="bg-white/10 text-white placeholder:text-white/40"
            />
            {passwordError ? (
              <p className="text-xs text-red-400">{passwordError}</p>
            ) : null}
          </div>
          <Button type="submit" className="mt-4 w-full" disabled={submitting || !passwordInput.trim()}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Accéder au dossier
          </Button>
        </form>
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

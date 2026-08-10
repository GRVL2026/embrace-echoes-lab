import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, AlertTriangle, CalendarX, Undo2, TrendingUp, Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Suivi de la prospection — l'écran que Tristan ouvre cinq minutes par jour.
//
// Quatre nombres, et un seul compte vraiment : SANS PROCHAINE ACTION.
//
// Un lead en retard se voit : il porte une date passée, il remonte, on le rattrape. Un
// lead sans date ne se voit nulle part. Personne ne l'a abandonné, personne ne s'en
// occupe, et il disparaît sans que rien ne le signale. C'est précisément « avoir
// tellement de prospects qu'on loupe beaucoup de choses », et c'est le seul indicateur
// qui le détecte.
//
// L'écran ne cherche donc pas à tout montrer. Il montre ce qui fuit.

type Suivi = {
  proprietaire: string | null;
  actifs: number; en_retard: number; sans_action: number;
  servis_semaine: number; traites_semaine: number; a_rendre: number;
  dernier_service: string | null;
};

type Profil = { id: string; email: string | null; full_name: string | null };

function jours(depuis: string | null): number | null {
  if (!depuis) return null;
  return Math.floor((Date.now() - new Date(depuis).getTime()) / 86_400_000);
}

export default function SuiviProspection() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const [lignes, setLignes] = useState<Suivi[]>([]);
  const [profils, setProfils] = useState<Record<string, Profil>>({});
  const [chargement, setChargement] = useState(true);
  const [rendu, setRendu] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    const [{ data: s }, { data: p }] = await Promise.all([
      (supabase as any).from("v_suivi_prospection").select("*"),
      (supabase as any).from("profiles").select("id, email, full_name"),
    ]);
    setLignes((s as Suivi[]) ?? []);
    const m: Record<string, Profil> = {};
    ((p as Profil[]) ?? []).forEach((x) => (m[x.id] = x));
    setProfils(m);
    setChargement(false);
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  const total = useMemo(() => lignes.reduce((t, l) => ({
    actifs: t.actifs + l.actifs,
    en_retard: t.en_retard + l.en_retard,
    sans_action: t.sans_action + l.sans_action,
    servis_semaine: t.servis_semaine + l.servis_semaine,
    traites_semaine: t.traites_semaine + l.traites_semaine,
    a_rendre: t.a_rendre + l.a_rendre,
  }), { actifs: 0, en_retard: 0, sans_action: 0, servis_semaine: 0, traites_semaine: 0, a_rendre: 0 }),
  [lignes]);

  /** Renvoie à la réserve les fiches servies depuis plus d'un mois et jamais touchées.
   *  Elles ne sont pas perdues : elles ressortiront dans un prochain lot, avec un
   *  propriétaire qui aura le temps de s'en occuper. */
  const rendreAuVivier = async () => {
    setRendu(true);
    try {
      const limite = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await (supabase as any).from("prospects")
        .update({
          etat: "vivier", proprietaire: null,
          prochaine_action: null, prochaine_action_le: null, distribue_le: null,
        })
        .eq("etat", "actif").eq("statut", "nouveau").lt("distribue_le", limite)
        .select("id");
      if (error) throw error;
      toast.success(`${(data as any[])?.length ?? 0} fiches rendues à la réserve`);
      await charger();
    } catch (e: any) {
      toast.error(e?.message ?? "Le retour au vivier a échoué");
    } finally {
      setRendu(false);
    }
  };

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!isAdmin && !isDirection) return <Navigate to="/" replace />;

  const nom = (id: string | null) => {
    if (!id) return "Non attribué";
    const p = profils[id];
    return p?.full_name || p?.email || "Compte inconnu";
  };

  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
      >
        <Link to="/prospection" aria-label="Retour à la prospection"
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-base font-semibold sm:text-lg">Suivi de la prospection</h1>
          <p className="truncate text-xs text-muted-foreground">Ce qui fuit, avant ce qui va bien</p>
        </div>
        <Button asChild size="sm" variant="outline" className="gap-2">
          <Link to="/distribution"><Send className="h-4 w-4" /><span className="hidden sm:inline">Distribuer</span></Link>
        </Button>
      </header>

      {chargement ? (
        <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-6 px-4 pb-24 pt-5">

          {total.actifs === 0 && (
            <Card className="p-4 text-sm text-muted-foreground">
              Aucune fiche en cours. La réserve est pleine mais rien n'a encore été distribué —
              commence par <Link to="/distribution" className="text-primary underline">servir la semaine</Link>.
            </Card>
          )}

          {total.actifs > 0 && (
            <>
              {/* Les deux chiffres qui appellent une action passent devant, en couleur.
                  Les deux autres mesurent le rythme et restent sobres. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Card className={cn("p-3", total.en_retard > 0 && "border-destructive/40")}>
                  <div className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide">En retard</span>
                  </div>
                  <b className={cn("mt-1 block font-mono text-2xl font-bold tabular-nums leading-none",
                    total.en_retard > 0 && "text-destructive")}>{total.en_retard}</b>
                </Card>

                <Card className={cn("p-3", total.sans_action > 0 && "border-amber-500/40")}>
                  <div className="flex items-center gap-1.5 text-amber-600">
                    <CalendarX className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide">Sans action</span>
                  </div>
                  <b className={cn("mt-1 block font-mono text-2xl font-bold tabular-nums leading-none",
                    total.sans_action > 0 && "text-amber-600")}>{total.sans_action}</b>
                </Card>

                <Card className="p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide">Cette semaine</span>
                  </div>
                  <b className="mt-1 block font-mono text-2xl font-bold tabular-nums leading-none">
                    {total.traites_semaine}<span className="text-base text-muted-foreground">/{total.servis_semaine}</span>
                  </b>
                </Card>

                <Card className="p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Undo2 className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide">À rendre</span>
                  </div>
                  <b className="mt-1 block font-mono text-2xl font-bold tabular-nums leading-none">{total.a_rendre}</b>
                </Card>
              </div>

              {total.sans_action > 0 && (
                <p className="text-xs text-amber-600">
                  {total.sans_action} fiche{total.sans_action > 1 ? "s" : ""} en cours sans prochaine action datée.
                  Ce sont celles qu'on perd : elles n'apparaîtront jamais dans les retards, et
                  personne ne les rouvrira.
                </p>
              )}

              {/* ── par commercial ─────────────────────────────────────────── */}
              <section className="space-y-2">
                <h2 className="font-display text-sm font-semibold">Par commercial</h2>
                <div className="grid gap-2">
                  {[...lignes].sort((a, b) => b.en_retard - a.en_retard).map((l) => {
                    const j = jours(l.dernier_service);
                    return (
                      <Card key={l.proprietaire ?? "sans"} className="p-3">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {nom(l.proprietaire)}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {l.actifs} en cours
                          </span>
                          {l.en_retard > 0 && (
                            <span className="font-mono text-xs font-semibold tabular-nums text-destructive">
                              {l.en_retard} en retard
                            </span>
                          )}
                          {l.sans_action > 0 && (
                            <span className="font-mono text-xs font-semibold tabular-nums text-amber-600">
                              {l.sans_action} sans action
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {l.traites_semaine} traitées sur {l.servis_semaine} servies cette semaine
                          {j !== null && <> · dernier lot il y a {j} jour{j > 1 ? "s" : ""}</>}
                        </p>
                      </Card>
                    );
                  })}
                </div>
              </section>

              {total.a_rendre > 0 && (
                <section className="space-y-2">
                  <h2 className="font-display text-sm font-semibold">Dormants</h2>
                  <Card className="space-y-3 p-3">
                    <p className="text-xs text-muted-foreground">
                      {total.a_rendre} fiche{total.a_rendre > 1 ? "s" : ""} servie{total.a_rendre > 1 ? "s" : ""} il
                      y a plus d'un mois et jamais touchée{total.a_rendre > 1 ? "s" : ""}. Les rendre à la réserve
                      ne les perd pas : elles ressortiront dans un prochain lot, chez quelqu'un
                      qui aura le temps.
                    </p>
                    <Button size="sm" variant="outline" className="gap-2" disabled={rendu} onClick={rendreAuVivier}>
                      {rendu ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                      Rendre à la réserve
                    </Button>
                  </Card>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, Users, AlertTriangle, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Distribution hebdomadaire des leads.
//
// Le risque que cet écran combat : une base de neuf mille fiches où l'on finit par ne
// plus rien traiter parce qu'on ne sait plus par où commencer. La réserve reste donc
// fermée, et rien n'entre dans le pipeline sans passer par ici.
//
// TROIS PRINCIPES, dont découle tout le reste.
//
// 1. On ne sert QUE des fiches joignables. Distribuer un lead sans téléphone ni e-mail,
//    c'est offrir vingt minutes de recherche à un commercial avant son premier appel.
//    Sur un lot hebdomadaire, cela représente une journée-homme perdue par semaine.
//
// 2. Le lot COMPLÈTE un plan de charge, il ne remplit pas un quota. Douze par jour
//    convient une semaine et étouffe la suivante : ce qui compte est ce que la personne
//    porte déjà. L'écran montre donc sa charge, et Tristan décide en la voyant.
//
// 3. Toute fiche servie repart avec une PROCHAINE ACTION DATÉE. C'est le seul champ qui
//    empêche un lead de disparaître silencieusement, et il n'est jamais laissé vide.

type Profil = { id: string; email: string | null; full_name: string | null };

type Charge = {
  actifs: number;
  en_retard: number;
  sans_action: number;
  dernier_contact: string | null;
};

type Dispo = { secteur: string | null; n: number };

type Avancement = {
  secteur: string; departement: string;
  total: number; joignables: number;
  distribues: number; en_reserve: number; injoignables: number;
};

type Cumul = { distribues: number; en_reserve: number; injoignables: number; total: number };

const vide = (): Cumul => ({ distribues: 0, en_reserve: 0, injoignables: 0, total: 0 });

function additionner(c: Cumul, a: Avancement): Cumul {
  return {
    distribues: c.distribues + a.distribues,
    en_reserve: c.en_reserve + a.en_reserve,
    injoignables: c.injoignables + a.injoignables,
    total: c.total + a.total,
  };
}

/** Barre en trois parts : ce qui est servi, ce qui peut l'être, et ce qui ne le peut pas
 *  encore faute de coordonnées. Cette troisième part est la plus instructive — elle dit
 *  pourquoi un secteur n'avance pas, là où un simple pourcentage laisserait croire à un
 *  manque de travail. */
function Barre({ c, compact = false }: { c: Cumul; compact?: boolean }) {
  const t = Math.max(1, c.total);
  const pct = (n: number) => `${(n / t) * 100}%`;
  return (
    <div
      className={cn("flex w-full overflow-hidden rounded", compact ? "h-1.5" : "h-2.5")}
      role="img"
      aria-label={`${c.distribues} distribués, ${c.en_reserve} en réserve, ${c.injoignables} sans coordonnées`}
    >
      <div style={{ width: pct(c.distribues) }} className="bg-primary" />
      <div style={{ width: pct(c.en_reserve) }} className="bg-primary/35" />
      <div style={{ width: pct(c.injoignables) }} className="bg-muted" />
    </div>
  );
}

const SECTEURS: { cle: string; nom: string }[] = [
  { cle: "nord-ouest", nom: "Grand Ouest" },
  { cle: "est-sud-est", nom: "Est et Sud-Est" },
  { cle: "sud-ouest", nom: "Sud-Ouest" },
];

/** Une fiche fraîchement servie porte toujours une échéance. Vendredi de la semaine en
 *  cours : assez proche pour que ce soit le travail de la semaine, assez loin pour
 *  qu'un lot du lundi ne soit pas déjà en retard le mardi. */
function vendrediProchain(): string {
  const d = new Date();
  const versVendredi = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (versVendredi === 0 ? 7 : versVendredi));
  return d.toISOString().slice(0, 10);
}

export default function Distribution() {
  const { isAdmin, isDirection, isLoading } = useAuth();
  const [profils, setProfils] = useState<Profil[]>([]);
  const [charges, setCharges] = useState<Record<string, Charge>>({});
  const [dispos, setDispos] = useState<Dispo[]>([]);
  const [avancement, setAvancement] = useState<Avancement[]>([]);
  const [detailDe, setDetailDe] = useState<string | null>(null);
  const [aServir, setAServir] = useState<Record<string, number>>({});
  const [secteurDe, setSecteurDe] = useState<Record<string, string>>({});
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    const [{ data: prof }, { data: actifs }, { data: vivier }, { data: avance }] = await Promise.all([
      (supabase as any).from("profiles").select("id, email, full_name"),
      (supabase as any).from("prospects")
        .select("proprietaire, prochaine_action_le, distribue_le")
        .eq("etat", "actif"),
      (supabase as any).from("prospects")
        .select("secteur")
        .eq("etat", "vivier").eq("joignable", true),
      // Agrégé en base : lire les neuf mille fiches ici se heurterait au plafond de
      // mille lignes de PostgREST, sans le moindre avertissement.
      (supabase as any).from("v_prospection_avancement").select("*"),
    ]);
    setAvancement((avance as Avancement[]) ?? []);

    setProfils((prof as Profil[]) ?? []);

    // Charge par personne. Calculée côté page plutôt qu'en SQL : le volume d'actifs se
    // compte en centaines, et une vue de plus serait une chose de plus à maintenir.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const parPersonne: Record<string, Charge> = {};
    for (const p of ((actifs as any[]) ?? [])) {
      const k = p.proprietaire ?? "—";
      const c = parPersonne[k] ??= { actifs: 0, en_retard: 0, sans_action: 0, dernier_contact: null };
      c.actifs++;
      if (!p.prochaine_action_le) c.sans_action++;
      else if (p.prochaine_action_le < aujourdhui) c.en_retard++;
      if (p.distribue_le && (!c.dernier_contact || p.distribue_le > c.dernier_contact)) {
        c.dernier_contact = p.distribue_le;
      }
    }
    setCharges(parPersonne);

    const parSecteur = new Map<string, number>();
    for (const v of ((vivier as any[]) ?? [])) {
      const k = v.secteur ?? "(sans secteur)";
      parSecteur.set(k, (parSecteur.get(k) ?? 0) + 1);
    }
    setDispos([...parSecteur.entries()].map(([secteur, n]) => ({ secteur, n })).sort((a, b) => b.n - a.n));
    setChargement(false);
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  const dispoDe = (secteur: string | undefined) =>
    dispos.find((d) => d.secteur === secteur)?.n ?? 0;

  const totalAServir = useMemo(
    () => Object.values(aServir).reduce((s, n) => s + (n || 0), 0),
    [aServir],
  );

  const servir = async () => {
    setEnvoi(true);
    let total = 0;
    try {
      for (const [uid, combien] of Object.entries(aServir)) {
        if (!combien || combien < 1) continue;
        const secteur = secteurDe[uid];
        if (!secteur) continue;

        // On relit la réserve au moment de servir, et non à l'affichage : entre les deux,
        // un enrichissement a pu rendre des fiches joignables, ou un autre écran en a pu
        // sortir. Le tri met devant ce qui porte le plus d'information — un signal de
        // presse, puis un parc installé connu — et regroupe par département, ce qui
        // rapproche les fiches d'une même tournée.
        const { data: choix, error } = await (supabase as any)
          .from("prospects")
          .select("id")
          .eq("etat", "vivier").eq("joignable", true).eq("secteur", secteur)
          .order("source", { ascending: true })
          .order("departement", { ascending: true })
          .limit(combien);
        if (error) throw error;
        const ids = ((choix as any[]) ?? []).map((c) => c.id);
        if (!ids.length) continue;

        const { error: e2 } = await (supabase as any).from("prospects").update({
          etat: "actif",
          proprietaire: uid,
          distribue_le: new Date().toISOString(),
          prochaine_action: "Premier contact",
          prochaine_action_le: vendrediProchain(),
        }).in("id", ids);
        if (e2) throw e2;
        total += ids.length;
      }
      toast.success(total ? `${total} fiches distribuées` : "Aucune fiche à distribuer");
      setAServir({});
      await charger();
    } catch (e: any) {
      toast.error(e?.message ?? "La distribution a échoué");
    } finally {
      setEnvoi(false);
    }
  };

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!isAdmin && !isDirection) return <Navigate to="/" replace />;

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
          <h1 className="truncate font-display text-base font-semibold sm:text-lg">Distribution de la semaine</h1>
          <p className="truncate text-xs text-muted-foreground">
            La réserve reste fermée : rien n'entre dans le pipeline sans passer par ici
          </p>
        </div>
      </header>

      {chargement ? (
        <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-6 px-4 pb-32 pt-5">

          {/* ── 1 — la réserve ────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="font-display text-sm font-semibold">
              <span className="mr-2 font-mono text-xs text-primary">1</span>
              Ce que contient la réserve
            </h2>
            <p className="text-xs text-muted-foreground">
              Uniquement les fiches <strong>joignables</strong> — celles qui portent un téléphone ou
              un e-mail. Servir un lead sans coordonnée, c'est offrir vingt minutes de
              recherche avant le premier appel.
            </p>
            <div className="grid gap-2">
              {SECTEURS.map((s) => {
                const lignes = avancement.filter((a) => a.secteur === s.cle);
                const c = lignes.reduce(additionner, vide());
                const servable = c.distribues + c.en_reserve;
                const pct = servable ? Math.round((c.distribues / servable) * 100) : 0;
                const ouvert = detailDe === s.cle;
                return (
                  <Card key={s.cle} className="p-3">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setDetailDe(ouvert ? null : s.cle)}
                      aria-expanded={ouvert}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="flex-1 text-sm font-semibold">{s.nom}</span>
                        <span className="font-mono text-sm font-bold tabular-nums">{pct} %</span>
                        <span className="text-xs text-muted-foreground">servis</span>
                      </div>
                      <div className="mt-2"><Barre c={c} /></div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">
                          <b className="text-foreground">{c.distribues}</b> distribués
                        </span>
                        <span className="tabular-nums">
                          <b className="text-foreground">{c.en_reserve}</b> en réserve
                        </span>
                        <span className="tabular-nums">{c.injoignables} sans coordonnées</span>
                        <span className="ml-auto">{ouvert ? "Masquer" : "Par département"}</span>
                      </div>
                    </button>

                    {ouvert && (
                      <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto border-t border-border pt-3">
                        {lignes
                          .filter((a) => a.distribues + a.en_reserve > 0)
                          .sort((a, b) => (b.distribues + b.en_reserve) - (a.distribues + a.en_reserve))
                          .map((a) => (
                            <div key={a.departement} className="grid grid-cols-[2.5rem_1fr_5.5rem] items-center gap-2">
                              <span className="font-mono text-[11px] text-muted-foreground">{a.departement}</span>
                              <Barre c={{ ...a, total: a.total }} compact />
                              <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                                {a.distribues} / {a.distribues + a.en_reserve}
                              </span>
                            </div>
                          ))}
                        {lignes.every((a) => a.distribues + a.en_reserve === 0) && (
                          <p className="text-xs text-muted-foreground">
                            Aucune fiche joignable dans ce secteur — l'enrichissement des coordonnées
                            doit passer avant la distribution.
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-4 rounded-sm bg-primary" />distribués
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-4 rounded-sm bg-primary/35" />prêts à servir
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-4 rounded-sm bg-muted" />sans coordonnées
              </span>
            </div>
          </section>

          {/* ── 2 — la charge, puis le curseur ────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="font-display text-sm font-semibold">
              <span className="mr-2 font-mono text-xs text-primary">2</span>
              Qui peut en prendre
            </h2>
            <p className="text-xs text-muted-foreground">
              Le lot complète un plan de charge, il ne remplit pas un quota. Regarde ce que
              chacun porte déjà avant de fixer le nombre.
            </p>

            {profils.length === 0 && (
              <Card className="p-4 text-sm text-muted-foreground">
                Aucun compte trouvé. Les commerciaux doivent d'abord créer le leur.
              </Card>
            )}

            <div className="grid gap-2">
              {profils.map((p) => {
                const c = charges[p.id] ?? { actifs: 0, en_retard: 0, sans_action: 0, dernier_contact: null };
                const secteur = secteurDe[p.id] ?? "";
                const restant = dispoDe(secteur);
                return (
                  <Card key={p.id} className="space-y-3 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {p.full_name || p.email || "Sans nom"}
                      </span>
                      <Badge variant="outline" className="tabular-nums">{c.actifs} en cours</Badge>
                      {c.en_retard > 0 && (
                        <Badge className="gap-1 bg-destructive/15 tabular-nums text-destructive hover:bg-destructive/15">
                          <AlertTriangle className="h-3 w-3" />{c.en_retard} en retard
                        </Badge>
                      )}
                      {c.sans_action > 0 && (
                        <Badge className="bg-amber-500/15 tabular-nums text-amber-600 hover:bg-amber-500/15">
                          {c.sans_action} sans action
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Secteur"
                        className="h-9 min-w-[9rem] flex-1 rounded-md border border-border bg-background px-2 text-sm"
                        value={secteur}
                        onChange={(e) => setSecteurDe((s) => ({ ...s, [p.id]: e.target.value }))}
                      >
                        <option value="">Choisir un secteur…</option>
                        {SECTEURS.map((s) => (
                          <option key={s.cle} value={s.cle}>{s.nom} — {dispoDe(s.cle)} en réserve</option>
                        ))}
                      </select>
                      <Input
                        type="number" min={0} max={restant} inputMode="numeric"
                        aria-label="Nombre de fiches à servir"
                        className="h-9 w-24 tabular-nums"
                        placeholder="0"
                        value={aServir[p.id] ?? ""}
                        disabled={!secteur}
                        onChange={(e) => setAServir((s) => ({ ...s, [p.id]: Number(e.target.value) }))}
                      />
                    </div>

                    {c.en_retard > 0 && (
                      <p className="text-xs text-amber-600">
                        {c.en_retard} fiche{c.en_retard > 1 ? "s" : ""} déjà en retard — servir davantage
                        aggravera le retard plutôt que les ventes.
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>

          {/* ── 3 — valider ──────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="font-display text-sm font-semibold">
              <span className="mr-2 font-mono text-xs text-primary">3</span>
              Servir
            </h2>
            <p className="text-xs text-muted-foreground">
              Chaque fiche part avec une première action datée à vendredi. Elle apparaîtra
              dans le pipeline de son propriétaire, et nulle part ailleurs.
            </p>
          </section>
        </div>
      )}

      {/* La validation reste sous le pouce : sur mobile, la liste des commerciaux
          repousserait le bouton hors de l'écran. */}
      {!chargement && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className={cn("flex-1 text-sm", totalAServir ? "font-semibold" : "text-muted-foreground")}>
              {totalAServir
                ? `${totalAServir} fiche${totalAServir > 1 ? "s" : ""} à distribuer`
                : "Rien à distribuer pour l'instant"}
            </span>
            <Button className="gap-2" disabled={!totalAServir || envoi} onClick={servir}>
              {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Distribuer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

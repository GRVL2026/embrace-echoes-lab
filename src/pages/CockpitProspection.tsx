import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { UserMenu } from "@/components/UserMenu";
import { MobileNav } from "@/components/MobileNav";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Loader2, Target, RefreshCw, Sparkles, Building2, User, ArrowUpRight } from "lucide-react";

// Cockpit Prospection — 1re étape : la zone "Pipe" branchée en direct sur Pipedrive
// (pipeline JEUX par défaut). Les 2 menus déroulants (commercial + pipeline) pilotent
// l'affichage ; un commercial ne voit que ses affaires (owner forcé côté edge function).
// Clic sur une affaire → panneau détaillé (échanges + contenu proforma + aide à clôturer).

type Stage = { id: number; nom: string; ordre: number };
type Commercial = { id: number; nom: string; email: string };
type Pipeline = { id: number; nom: string };
type Deal = {
  id: number; titre: string; valeur: number; devise: string;
  etape_id: number; owner_id: number | null; owner_nom: string | null;
  organisation: string | null; personne: string | null; maj_le: string | null;
  activites_a_faire: number; prochaine_activite: string | null;
};
type ListResp = {
  ok: boolean; error?: string; note?: string;
  isManagement?: boolean; ownerForced?: boolean; owner_id?: number | null;
  pipeline?: Pipeline | null; pipelines?: Pipeline[]; stages?: Stage[];
  commerciaux?: Commercial[]; deals?: Deal[]; total?: number; valeur_totale?: number;
};
type DetailResp = {
  ok: boolean; error?: string;
  deal?: any; activites?: { type: string; sujet: string; faite: boolean; date: string; note?: string }[];
  produits?: { nom: string; quantite: number; prix: number; total: number }[];
};

const OWNER_COLORS = ["#22D3EE", "#F5A524", "#9B5CFF", "#34D399", "#ff5d7a", "#60a5fa", "#f472b6"];
const eur = (n: number) => (Number(n) || 0).toLocaleString("fr-FR") + " €";
const initials = (nom: string | null) => {
  if (!nom) return "—";
  const w = nom.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : nom.slice(0, 3)).toUpperCase();
};

/** Aide à clôturer — heuristique locale basée sur le nom de l'étape JEUX. */
function closingTip(stageName: string, valeur: number): { titre: string; texte: string } {
  const s = (stageName || "").toLowerCase();
  if (s.includes("stand")) return { titre: "Réactiver le stand by", texte: "Affaire en pause — reprendre contact avec un élément neuf (nouveauté, promo saisonnière) pour débloquer la décision, sinon la sortir du pipe." };
  if (s.includes("bon pour accord")) return { titre: "Sécuriser la signature", texte: `Accord obtenu sur ${eur(valeur)} — envoyer le contrat, verrouiller l'acompte et planifier l'installation avant la prochaine saison forte.` };
  if (s.includes("proforma")) return { titre: "Aider à clôturer", texte: `Proforma de ${eur(valeur)} envoyée — relancer, lever l'objection prix avec le paiement 4× sans frais, viser une installation avant les vacances.` };
  if (s.includes("proposition")) return { titre: "Prochaine action", texte: "Proposition présentée — enchaîner vite sur la proforma chiffrée pendant que l'intérêt est chaud, avec un pack évolutif." };
  if (s.includes("discussion")) return { titre: "Prochaine action", texte: "En discussion — qualifier le besoin et caler une démo. Angle recommandé : montée en gamme si le lieu est déjà équipé." };
  if (s.includes("contact")) return { titre: "Prochaine action", texte: "Contact établi — qualifier le potentiel (parc, budget) et proposer un créneau cette semaine." };
  return { titre: "Prochaine action", texte: "Affaire récente — envoyer l'accroche personnalisée et qualifier le potentiel." };
}

export default function CockpitProspection() {
  const { isAdmin, isDirection, isChefVentes, isCommercial, canAccessProspection, isLoading } = useAuth();
  const allowed = isAdmin || isDirection || isChefVentes || isCommercial || canAccessProspection;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ListResp | null>(null);
  const [owner, setOwner] = useState<string>("all");
  const [pipelineId, setPipelineId] = useState<string>("");

  const [openDeal, setOpenDeal] = useState<Deal | null>(null);
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const body: any = {};
      if (owner !== "all") body.owner = owner;
      if (pipelineId) body.pipeline_id = pipelineId;
      const { data: res, error } = await supabase.functions.invoke("pipedrive-deals", { body });
      if (error) throw error;
      setData(res as ListResp);
    } catch (e: any) {
      setData({ ok: false, error: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); /* eslint-disable-next-line */ }, [owner, pipelineId, allowed]);

  // couleur par commercial (index dans la liste), sinon violet.
  const ownerColor = useMemo(() => {
    const m = new Map<number, string>();
    (data?.commerciaux ?? []).forEach((c, i) => m.set(c.id, OWNER_COLORS[i % OWNER_COLORS.length]));
    return (id: number | null) => (id != null && m.get(id)) || "hsl(var(--primary))";
  }, [data]);

  const openDealDetail = async (d: Deal) => {
    setOpenDeal(d); setDetail(null); setDetailLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("pipedrive-deals", { body: { deal_id: d.id } });
      if (error) throw error;
      setDetail(res as DetailResp);
    } catch (e: any) {
      setDetail({ ok: false, error: e?.message || String(e) });
    } finally {
      setDetailLoading(false);
    }
  };

  if (isLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!allowed) return <Navigate to="/" replace />;

  const stages = data?.stages ?? [];
  const deals = data?.deals ?? [];
  const dealsByStage = (sid: number) => deals.filter((d) => d.etape_id === sid);

  return (
    <div className="min-h-screen bg-background">
      <DetailPageHeader
        className="md:hidden"
        backTo="/"
        backLabel="Retour au hub"
        title="Cockpit Prospection"
        actions={<div className="flex items-center gap-1"><MobileNav /><UserMenu /></div>}
      />
      <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6">
        {/* En-tête + menus déroulants */}
        <header className="flex flex-wrap items-center gap-3">
          <div className="hidden md:flex items-center gap-3 mr-auto">
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-2"><Target className="h-5 w-5 text-primary" /></div>
            <div>
              <h1 className="font-display text-2xl font-bold">Cockpit Prospection</h1>
              <p className="text-sm text-muted-foreground">Pipe en direct de Pipedrive.</p>
            </div>
          </div>

          {/* Menu commercial — management uniquement */}
          {data?.isManagement && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Commercial</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}
                className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
                <option value="all">Tous les commerciaux</option>
                <option value="me">Le mien</option>
                {(data?.commerciaux ?? []).map((c) => <option key={c.id} value={String(c.id)}>{c.nom}</option>)}
              </select>
            </label>
          )}

          {/* Menu pipeline */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pipeline</span>
            <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}
              className="rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
              {!pipelineId && <option value="">{data?.pipeline?.nom ?? "JEUX"}</option>}
              {(data?.pipelines ?? []).map((pl) => <option key={pl.id} value={String(pl.id)}>{pl.nom}</option>)}
            </select>
          </label>

          <button onClick={load} className="mt-auto rounded-lg border border-border bg-card/60 p-2 text-muted-foreground hover:text-foreground hover:border-primary/50" title="Rafraîchir">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </header>

        {/* Bandeau récap */}
        {data?.ok && (
          <div className="text-sm text-muted-foreground">
            Pipeline <b className="text-foreground">{data.pipeline?.nom}</b> ·{" "}
            <b className="text-foreground">{data.total ?? 0}</b> affaires ouvertes · valeur{" "}
            <b className="text-foreground tabular-nums">{eur(data.valeur_totale ?? 0)}</b>
            {data.ownerForced && <span className="ml-2 text-xs">· ton pipe uniquement</span>}
          </div>
        )}

        {/* États */}
        {loading && <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement du pipe…</div>}
        {!loading && data && !data.ok && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground/90">
            Impossible de charger le pipe : {data.error}
          </div>
        )}
        {!loading && data?.ok && data.note && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground/90">{data.note}</div>
        )}

        {/* Pipe en colonnes par étape */}
        {!loading && data?.ok && stages.length > 0 && (
          <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(170px, 1fr))` }}>
            {stages.map((st) => {
              const list = dealsByStage(st.id);
              const sum = list.reduce((s, d) => s + d.valeur, 0);
              return (
                <div key={st.id} className="rounded-xl border border-border bg-card/40 p-2.5 min-w-[170px]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">{st.nom}</span>
                    <span className="font-display text-xs">{list.length}</span>
                  </div>
                  {list.length > 0 && <div className="mb-2 text-[10px] text-muted-foreground tabular-nums">{eur(sum)}</div>}
                  <div className="space-y-2">
                    {list.map((d) => (
                      <button key={d.id} onClick={() => openDealDetail(d)}
                        className="w-full rounded-lg border border-border bg-card/60 p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
                        style={{ borderLeftWidth: 3, borderLeftColor: ownerColor(d.owner_id) }}>
                        <div className="text-[12.5px] font-medium leading-snug">{d.titre}</div>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-background" style={{ background: ownerColor(d.owner_id) }} title={d.owner_nom ?? ""}>{initials(d.owner_nom)}</span>
                          <span className="font-display text-[12px] tabular-nums">{eur(d.valeur)}</span>
                        </div>
                        {d.activites_a_faire > 0 && (
                          <div className="mt-1 text-[10px] text-amber-500">{d.activites_a_faire} action{d.activites_a_faire > 1 ? "s" : ""} à faire</div>
                        )}
                      </button>
                    ))}
                    {list.length === 0 && <div className="py-3 text-center text-[11px] text-muted-foreground/60">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          1re brique du cockpit : le pipe JEUX en direct de Pipedrive. Les autres zones (carte à tags propriétaire,
          widgets globaux, distribution, news) arrivent ensuite.
        </p>
      </div>

      {/* Panneau détail de l'affaire */}
      <Sheet open={!!openDeal} onOpenChange={(o) => { if (!o) { setOpenDeal(null); setDetail(null); } }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {openDeal && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-background" style={{ background: ownerColor(openDeal.owner_id) }}>{initials(openDeal.owner_nom)}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Affaire Pipedrive · {openDeal.owner_nom ?? "—"}</span>
                </div>
                <h2 className="mt-2 font-display text-xl font-bold leading-tight">{openDeal.titre}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-display text-base text-foreground tabular-nums">{eur(openDeal.valeur)}</span>
                  <span>Étape : <b className="text-foreground">{stages.find((s) => s.id === openDeal.etape_id)?.nom ?? "—"}</b></span>
                </div>
                {(openDeal.organisation || openDeal.personne) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {openDeal.organisation && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {openDeal.organisation}</span>}
                    {openDeal.personne && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {openDeal.personne}</span>}
                  </div>
                )}
              </div>

              {/* barre d'étapes */}
              <div className="flex gap-1">
                {stages.map((s) => (
                  <div key={s.id} className="h-1.5 flex-1 rounded" style={{ background: s.ordre < (stages.find((x) => x.id === openDeal.etape_id)?.ordre ?? -1) ? "hsl(var(--primary))" : s.id === openDeal.etape_id ? "hsl(var(--primary))" : "hsl(var(--muted))" }} />
                ))}
              </div>

              {detailLoading && <div className="flex h-24 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…</div>}
              {detail && !detail.ok && <div className="text-sm text-destructive">{detail.error}</div>}

              {detail?.ok && (
                <>
                  {/* Échanges */}
                  <div>
                    <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Résumé des échanges</div>
                    {(detail.activites ?? []).length === 0 && <div className="text-xs text-muted-foreground">Aucune activité enregistrée sur cette affaire.</div>}
                    <div className="space-y-2">
                      {(detail.activites ?? []).map((a, i) => (
                        <div key={i} className="flex gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5">
                          <span className="mt-0.5 text-sm">{a.faite ? "✅" : "🕒"}</span>
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-medium">{a.sujet || a.type}</div>
                            {a.note && <div className="text-[11.5px] text-muted-foreground line-clamp-2" dangerouslySetInnerHTML={{ __html: a.note }} />}
                            <div className="text-[10.5px] text-muted-foreground/70">{a.date ? String(a.date).slice(0, 10) : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Contenu proforma */}
                  <div>
                    <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Contenu de la proforma</div>
                    {(detail.produits ?? []).length === 0 ? (
                      <div className="text-xs text-muted-foreground">Aucun produit rattaché à l'affaire.</div>
                    ) : (
                      <div className="rounded-lg border border-border overflow-hidden">
                        {(detail.produits ?? []).map((pr, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-[12.5px] last:border-0">
                            <span>{pr.nom} {pr.quantite > 1 && <span className="text-muted-foreground">× {pr.quantite}</span>}</span>
                            <span className="tabular-nums text-muted-foreground">{eur(pr.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Aide à clôturer */}
              {(() => {
                const stName = stages.find((s) => s.id === openDeal.etape_id)?.nom ?? "";
                const tip = closingTip(stName, openDeal.valeur);
                return (
                  <div className="rounded-xl border border-secondary/40 bg-secondary/5 p-3.5">
                    <div className="mb-1.5 flex items-center gap-2 font-display text-[12.5px] text-secondary"><Sparkles className="h-4 w-4" /> {tip.titre}</div>
                    <p className="text-[12.5px] leading-relaxed">{tip.texte}</p>
                  </div>
                );
              })()}

              <a href={`https://${(import.meta as any).env?.VITE_PIPEDRIVE_DOMAIN ?? "avranches.pipedrive.com"}/deal/${openDeal.id}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                Ouvrir dans Pipedrive <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

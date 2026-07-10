import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, X, ChevronLeft, ChevronRight, Phone, Mail, Globe, MapPin } from "lucide-react";

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
  selected_modules: string[] | null;
  selected_products: { name: string; qty: number; unit_price: number }[] | null;
  pricing: { lines?: { label: string; qty: number; amount: number }[]; total_ht?: number; monthly?: number } | null;
  context: { contexte?: string; objectif?: string; enjeux?: string; lecture?: string } | null;
  solution: { selection?: string; deploiement?: string; suivi?: string } | null;
  scope: { fourniture?: string; livraison?: string; formation?: string; garantie?: string } | null;
};

const CREAM = "#F6F1E7";
const DARK = "#1a1a1a";
const PURPLE = "#7c3aed";
const LIME = "#C7F73E";

function fmtEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);
}

function Page({ children, index, total }: { children: React.ReactNode; index: number; total: number }) {
  return (
    <section
      className="relative flex w-full flex-shrink-0 snap-center items-center justify-center"
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

export function DossierPreview({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [modules, setModules] = useState<BrandModule[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: p } = await (supabase as any)
        .from("projects")
        .select(
          "id, client_name, brand_id, offer, selected_modules, selected_products, pricing, context, solution, scope",
        )
        .eq("id", projectId)
        .maybeSingle();
      const proj = p as Project | null;
      setProject(proj);
      if (proj?.brand_id) {
        const { data: b } = await (supabase as any)
          .from("brands")
          .select("id, name, contact")
          .eq("id", proj.brand_id)
          .maybeSingle();
        setBrand(b as Brand | null);
      }
      const ids = Array.isArray(proj?.selected_modules) ? (proj!.selected_modules as string[]) : [];
      if (ids.length > 0) {
        const { data: m } = await (supabase as any)
          .from("brand_modules")
          .select("id, image_url, title")
          .in("id", ids);
        const map = new Map<string, BrandModule>(((m as BrandModule[]) ?? []).map((x) => [x.id, x]));
        setModules(ids.map((id) => map.get(id)).filter(Boolean) as BrandModule[]);
      } else {
        setModules([]);
      }
      setLoading(false);
    })();
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(c + 1, totalPages - 1));
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(c - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules.length]);

  const slidePages = modules.filter((m) => !!m.image_url);
  const customPages = 6;
  const totalPages = slidePages.length + customPages;

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, i));
    setCurrent(clamped);
    const el = document.getElementById(`dossier-page-${clamped}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
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

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-white/10 bg-black/60 px-4 text-white backdrop-blur">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-display font-semibold">Aperçu du dossier</span>
          {brand && <span className="text-white/60">— {brand.name}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => goTo(current - 1)} disabled={current === 0} className="text-white hover:bg-white/10">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[70px] text-center text-xs tabular-nums text-white/80">
            {current + 1} / {totalPages || 1}
          </span>
          <Button variant="ghost" size="sm" onClick={() => goTo(current + 1)} disabled={current >= totalPages - 1} className="text-white hover:bg-white/10">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:bg-white/10">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading || !project ? (
        <div className="flex flex-1 items-center justify-center text-white">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Chargement…
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto snap-y snap-mandatory">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-6">
            {/* PARTIE A — slides images */}
            {slidePages.map((m, i) => (
              <div id={`dossier-page-${i}`} key={m.id} className="w-full overflow-hidden rounded-lg shadow-2xl">
                <section className="relative w-full snap-center" style={{ aspectRatio: "16 / 9" }}>
                  <img src={m.image_url!} alt={m.title ?? `Slide ${i + 1}`} className="h-full w-full object-cover" />
                </section>
              </div>
            ))}

            {/* PARTIE B — pages reconstruites */}
            {(() => {
              const offset = slidePages.length;
              return (
                <>
                  {/* 1. Contexte & besoin */}
                  <div id={`dossier-page-${offset + 0}`} className="w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={offset + 1} total={totalPages}>
                      <PageFrame eyebrow="Contexte & besoin" title={`Le besoin de ${clientName}`}>
                        <div className="grid h-full grid-cols-2 grid-rows-2 gap-5">
                          {[
                            { label: "Le contexte", value: context.contexte },
                            { label: "L'objectif", value: context.objectif },
                            { label: "Les enjeux", value: context.enjeux },
                            { label: "Notre lecture", value: context.lecture },
                          ].map((c) => (
                            <div key={c.label} className="flex flex-col rounded-xl border p-5" style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.55)" }}>
                              <div className="mb-2 flex items-center gap-2">
                                <span className="inline-block h-2 w-8 rounded-full" style={{ background: LIME }} />
                                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: PURPLE }}>
                                  {c.label}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: DARK }}>
                                {c.value || "—"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </PageFrame>
                    </Page>
                  </div>

                  {/* 2. Solution proposée */}
                  <div id={`dossier-page-${offset + 1}`} className="w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={offset + 2} total={totalPages}>
                      <PageFrame eyebrow="Notre approche" title="Solution proposée">
                        <div className="grid h-full grid-cols-3 gap-5">
                          {[
                            { n: "01", label: "Sélection", value: solution.selection },
                            { n: "02", label: "Déploiement", value: solution.deploiement },
                            { n: "03", label: "Suivi", value: solution.suivi },
                          ].map((s) => (
                            <div key={s.n} className="flex flex-col rounded-xl p-6" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.08)" }}>
                              <div className="mb-3 font-display text-5xl font-bold" style={{ color: PURPLE }}>{s.n}</div>
                              <div className="mb-2 h-1 w-10 rounded-full" style={{ background: LIME }} />
                              <div className="mb-3 text-lg font-bold" style={{ color: DARK }}>{s.label}</div>
                              <p className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: DARK, opacity: 0.85 }}>
                                {s.value || "—"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </PageFrame>
                    </Page>
                  </div>

                  {/* 3. Sélection produits */}
                  <div id={`dossier-page-${offset + 2}`} className="w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={offset + 3} total={totalPages}>
                      <PageFrame eyebrow="Équipements" title="Sélection produits">
                        <div className="h-full overflow-auto rounded-xl border" style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.55)" }}>
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr style={{ background: PURPLE, color: "white" }}>
                                <th className="px-4 py-3">Produit</th>
                                <th className="px-4 py-3 text-center">Quantité</th>
                                <th className="px-4 py-3 text-right">PU {isRecurring ? "/ mois" : ""}</th>
                                <th className="px-4 py-3 text-right">Sous-total {isRecurring ? "/ mois" : ""}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {products.length === 0 ? (
                                <tr><td colSpan={4} className="px-4 py-6 text-center opacity-60">Aucun produit sélectionné</td></tr>
                              ) : products.map((p, i) => (
                                <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                  <td className="px-4 py-3 font-medium">{p.name}</td>
                                  <td className="px-4 py-3 text-center">{p.qty}</td>
                                  <td className="px-4 py-3 text-right tabular-nums">{fmtEUR(p.unit_price)}</td>
                                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtEUR(p.qty * p.unit_price)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </PageFrame>
                    </Page>
                  </div>

                  {/* 4. Périmètre & livrables */}
                  <div id={`dossier-page-${offset + 3}`} className="w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={offset + 4} total={totalPages}>
                      <PageFrame eyebrow="Notre engagement" title="Périmètre & livrables">
                        <div className="grid h-full grid-cols-2 grid-rows-2 gap-5">
                          {[
                            { label: "Fourniture", value: scope.fourniture },
                            { label: "Livraison", value: scope.livraison },
                            { label: "Formation", value: scope.formation },
                            { label: "Garantie", value: scope.garantie },
                          ].map((s) => (
                            <div key={s.label} className="flex items-start gap-4 rounded-xl p-5" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.08)" }}>
                              <div className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: LIME, color: DARK }}>
                                ✓
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-bold uppercase tracking-widest" style={{ color: PURPLE }}>{s.label}</div>
                                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{s.value || "—"}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </PageFrame>
                    </Page>
                  </div>

                  {/* 5. Tarifs & budget */}
                  <div id={`dossier-page-${offset + 4}`} className="w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={offset + 5} total={totalPages}>
                      <PageFrame eyebrow="Investissement" title="Tarifs & budget">
                        <div className="flex h-full flex-col gap-4">
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
                                {(pricing.lines ?? []).length === 0 ? (
                                  <tr><td colSpan={3} className="px-4 py-6 text-center opacity-60">Aucune ligne tarifaire</td></tr>
                                ) : (pricing.lines ?? []).map((l, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                                    <td className="px-4 py-3">{l.label}</td>
                                    <td className="px-4 py-3 text-center">{l.qty}</td>
                                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtEUR(l.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-end gap-8 rounded-xl px-6 py-4" style={{ background: DARK, color: "white" }}>
                            <div className="text-right">
                              <div className="text-xs uppercase tracking-widest opacity-70">Total HT</div>
                              <div className="font-display text-3xl font-bold" style={{ color: LIME }}>{fmtEUR(pricing.total_ht ?? 0)}</div>
                            </div>
                            {isRecurring && (
                              <div className="text-right">
                                <div className="text-xs uppercase tracking-widest opacity-70">Mensualité</div>
                                <div className="font-display text-3xl font-bold" style={{ color: LIME }}>{fmtEUR(pricing.monthly ?? 0)} <span className="text-base opacity-70">/ mois</span></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </PageFrame>
                    </Page>
                  </div>

                  {/* 6. Passons à l'action */}
                  <div id={`dossier-page-${offset + 5}`} className="w-full overflow-hidden rounded-lg shadow-2xl">
                    <Page index={offset + 6} total={totalPages}>
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
                    </Page>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

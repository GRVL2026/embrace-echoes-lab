import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Newspaper, ArrowUpRight, Send, Check } from "lucide-react";

// Zone News du cockpit prospection.
//  - Management (Tristan / direction) : les actualités récentes de la Gazette, avec un
//    bouton « distribuer à X » par commercial (RPC assigner_signal).
//  - Commercial : uniquement les news qui LUI ont été distribuées (RLS gazette_lecture_assignee).
// Chaque titre ouvre l'article. Le montant/brief n'existe pas ici : rien d'inventé.

type Signal = {
  id: string; titre: string; source: string | null; commune: string | null;
  region: string | null; publie_le: string | null; statut: string;
  url: string | null; url_google: string | null; urgence: string | null;
  assigne_a: string | null;
};
type Commercial = { id: string; full_name: string | null };

function urgDot(u: string | null) {
  return u === "haute" ? "bg-destructive" : u === "moyenne" ? "bg-amber-500" : "bg-muted-foreground/40";
}
function titrePropre(t: string, source: string | null): string {
  let v = t.replace(/\s*[-–—]\s*[^-–—]{2,28}$/, "").trim();
  if (source) v = v.replace(new RegExp(`\\s*[-–—]\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim();
  return v || t;
}

export function CockpitNews() {
  const { isAdmin, isDirection, isChefVentes } = useAuth();
  const isMgmt = isAdmin || isDirection || isChefVentes;
  const [assigned, setAssigned] = useState<Record<string, string>>({});

  const { data: news } = useQuery({
    queryKey: ["cockpit-news", isMgmt],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Signal[]> => {
      const cols = "id, titre, source, commune, region, publie_le, statut, url, url_google, urgence, assigne_a";
      const base = supabase.from("gazette_signaux" as any).select(cols);
      const q = isMgmt
        ? base.neq("statut", "ignore").order("publie_le", { ascending: false }).order("created_at", { ascending: false }).limit(8)
        : base.not("assigne_a", "is", null).order("assigne_le", { ascending: false }).limit(20);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Signal[];
    },
  });

  const { data: coms } = useQuery({
    queryKey: ["cockpit-news-coms"],
    enabled: isMgmt,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Commercial[]> => {
      const { data, error } = await supabase.from("profiles" as any).select("id, full_name").eq("recoit_des_leads", true);
      if (error) throw error;
      return (data ?? []) as unknown as Commercial[];
    },
  });

  const distribute = async (sigId: string, com: Commercial) => {
    const { error } = await (supabase as any).rpc("assigner_signal", { _signal_id: sigId, _commercial: com.id });
    if (error) { toast.error("Distribution impossible : " + error.message); return; }
    setAssigned((a) => ({ ...a, [sigId]: (com.full_name || "commercial").split(" ")[0] }));
    toast.success("News distribuée à " + (com.full_name || "—"));
  };

  const list = news ?? [];

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Newspaper className="h-4 w-4 text-primary" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{isMgmt ? "News du secteur · Gazette" : "News reçues"}</span>
      </div>
      {list.length === 0 && (
        <div className="text-xs text-muted-foreground">{isMgmt ? "Aucune actualité récente." : "Aucune news distribuée pour l'instant."}</div>
      )}
      <div className="space-y-2.5">
        {list.map((s) => {
          const href = s.url_google || s.url || undefined;
          const done = assigned[s.id] || (s.assigne_a ? "un commercial" : null);
          return (
            <div key={s.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${urgDot(s.urgence)}`} />
                <div className="min-w-0 flex-1">
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium leading-snug hover:text-primary hover:underline">
                    {titrePropre(s.titre, s.source)}
                    {href && <ArrowUpRight className="ml-1 inline h-3 w-3 opacity-60" />}
                  </a>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {[s.source, s.commune, s.publie_le ? String(s.publie_le).slice(0, 10) : null].filter(Boolean).join(" · ")}
                  </div>
                  {isMgmt && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-secondary"><Check className="h-3 w-3" /> distribué{assigned[s.id] ? ` à ${assigned[s.id]}` : ""}</span>
                      ) : (
                        <>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Distribuer :</span>
                          {(coms ?? []).map((c) => (
                            <button key={c.id} onClick={() => distribute(s.id, c)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-primary hover:text-primary">
                              <Send className="h-3 w-3" />{(c.full_name || "—").split(" ")[0]}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

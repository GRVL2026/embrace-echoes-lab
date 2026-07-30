import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ClientActionsDialog } from "@/components/reactivation/ClientActionsDialog";
import { companyStatusPopupHtml } from "@/components/reactivation/CompanyStatusBadge";
import { Loader2, MapPin, ArrowLeft, Search, Sparkles, X, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

type ClientPt = {
  code_client: string;
  nom: string | null;
  ville: string | null;
  lat: number;
  lng: number;
  ca_12m: number;
  ca_total: number;
  derniere_commande: string | null;
  categorie: "actif" | "dormant" | "inactif";
  etat_administratif?: string | null;
  procedure_collective?: boolean | null;
};
type ProspectPt = {
  id: string;
  nom: string | null;
  ville: string | null;
  lat: number;
  lng: number;
  statut: string | null;
  segment: string | null;
};

type Layer = "actif" | "dormant" | "inactif" | "prospects";

const COLORS: Record<Layer, string> = {
  actif: "#3b82f6",
  dormant: "#f59e0b",
  inactif: "#94a3b8",
  prospects: "#10b981",
};
const LABELS: Record<Layer, string> = {
  actif: "Clients actifs",
  dormant: "Clients dormants",
  inactif: "Clients inactifs",
  prospects: "Prospects",
};

function fmtEUR(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M€`;
  if (n >= 1_000) return `${Math.round(n / 1000)} k€`;
  return `${Math.round(n)} €`;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function makeDivIcon(color: string, size: number, highlight = false): L.DivIcon {
  const s = Math.max(8, Math.min(28, size));
  const ring = highlight
    ? "0 0 0 3px #ADFF00, 0 0 12px rgba(173,255,0,0.7)"
    : "0 0 0 2px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.35)";
  return L.divIcon({
    className: "carte-marker",
    html: `<span style="display:block;width:${s}px;height:${s}px;border-radius:9999px;background:${color};box-shadow:${ring};"></span>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
}

type CopilotPoint = { code_client: string | null; nom: string; ville: string; lat: number; lng: number };

type CopilotResult = {
  interpretation: string;
  count: number;          // lignes renvoyées (plafonnées à 500)
  total: number | null;   // vrai total (COUNT(*) sans plafond)
  truncated: boolean;
  geoCount: number;       // lignes réellement géolocalisées
  ca_total: number;
  codes: Set<string>;
  points: CopilotPoint[];
};

function pickCoord(row: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = row?.[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default function Carte() {
  const { isAdmin, isDirection, canReactivation } = useAuth();
  const authorized = isAdmin || isDirection;
  const [reaCode, setReaCode] = useState<string | null>(null);
  const [reaTab, setReaTab] = useState<"action" | "statut">("action");
  const search = new URLSearchParams(useLocation().search);
  const vue = search.get("vue"); // "prospection" | null

  const [layers, setLayers] = useState<Record<Layer, boolean>>(() => ({
    actif: true,
    dormant: true,
    inactif: false,
    prospects: vue === "prospection",
  }));

  useEffect(() => {
    if (vue === "prospection") {
      setLayers((s) => ({ ...s, prospects: true }));
    }
  }, [vue]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["map-points"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_map_points" as any);
      if (error) throw error;
      const d = data as any;
      return {
        clients: (d?.clients ?? []) as ClientPt[],
        prospects: (d?.prospects ?? []) as ProspectPt[],
      };
    },
    enabled: authorized,
    staleTime: 5 * 60 * 1000,
  });

  const counts = useMemo(() => {
    const clients = data?.clients ?? [];
    return {
      actif: clients.filter((c) => c.categorie === "actif").length,
      dormant: clients.filter((c) => c.categorie === "dormant").length,
      inactif: clients.filter((c) => c.categorie === "inactif").length,
      prospects: data?.prospects.length ?? 0,
    };
  }, [data]);

  // --- Recherche & Copilot ---
  const [query, setQuery] = useState("");
  const [copilotSheet, setCopilotSheet] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [copilotResult, setCopilotResult] = useState<CopilotResult | null>(null);

  const suggestions = useMemo(() => {
    if (!data || query.trim().length < 2) return [];
    const q = normalize(query.trim());
    return data.clients
      .filter((c) => c.nom && normalize(c.nom).includes(q))
      .slice(0, 8);
  }, [data, query]);

  // --- Leaflet init ---
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<any>(null);
  const markerByCodeRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { preferCanvas: true }).setView([46.6, 2.5], 6);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // @ts-ignore
    clusterRef.current = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55 });
    map.addLayer(clusterRef.current);

    // Popup delegated click → open reactivation dialog
    map.on("popupopen", async (e: any) => {
      const el: HTMLElement = e.popup.getElement();
      if (!el) return;
      el.querySelectorAll<HTMLButtonElement>("button[data-rea-action]").forEach((btn) => {
        btn.onclick = () => {
          const code = btn.getAttribute("data-code") || "";
          const action = btn.getAttribute("data-rea-action") as "action" | "statut";
          if (!code) return;
          setReaCode(code);
          setReaTab(action);
        };
      });
      // Lazy load statut + last action
      const slot = el.querySelector<HTMLElement>(".rea-slot");
      const code = slot?.getAttribute("data-code");
      if (slot && code) {
        try {
          const { data } = await (supabase as any).rpc("get_client_reactivation", {
            _code: code,
          });
          const d = data as any;
          if (!d) { slot.textContent = ""; return; }
          const parts: string[] = [];
          if (d.statut_relance) {
            const labels: Record<string, string> = {
              a_contacter: "À contacter", contacte: "Contacté", relance: "Relance",
              reactive: "Réactivé", sans_suite: "Sans suite",
            };
            parts.push(`Statut : <b>${labels[d.statut_relance] || d.statut_relance}</b>`);
          }
          const last = d.actions?.[0];
          if (last) {
            const dt = new Date(last.date).toLocaleDateString("fr-FR");
            parts.push(`Dernière action : <b>${last.type}</b> — ${dt}${last.auteur ? ` (${last.auteur})` : ""}`);
          }
          slot.innerHTML = parts.length
            ? parts.map((p) => `<div>${p}</div>`).join("")
            : `<em>Aucune action encore.</em>`;
          // Hydrate contact block (phone/email)
          const contactEl = el.querySelector<HTMLElement>(`.rea-contact[data-code="${code}"]`);
          if (contactEl) {
            const tel = (d.telephone || "").toString();
            const telHref = tel.replace(/[^\d+]/g, "");
            const email = d.email || "";
            const telHtml = telHref
              ? `<a href="tel:${telHref}" style="color:#9B5CFF;text-decoration:none;font-weight:500">📞 ${tel}</a>`
              : `<span style="color:#94a3b8;font-style:italic">📞 Téléphone non renseigné</span>`;
            const mailHtml = email
              ? `<a href="mailto:${email}" style="color:#9B5CFF;text-decoration:none;font-weight:500;word-break:break-all">✉ ${email}</a>`
              : `<span style="color:#94a3b8;font-style:italic">✉ Email non renseigné</span>`;
            contactEl.innerHTML = `<div>${telHtml}</div><div style="margin-top:2px">${mailHtml}</div>`;
          }
        } catch {
          slot.textContent = "";
        }
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Redraw markers ---
  useEffect(() => {
    if (!mapRef.current || !clusterRef.current || !data) return;
    const cluster = clusterRef.current;
    cluster.clearLayers();
    markerByCodeRef.current.clear();

    const filterCodes = copilotResult?.codes ?? null;
    const maxCa = Math.max(1, ...data.clients.map((c) => c.ca_12m || 0));

    if (layers.actif || layers.dormant || layers.inactif) {
      for (const c of data.clients) {
        if (!layers[c.categorie]) continue;
        if (filterCodes && !filterCodes.has(c.code_client)) continue;
        const color = COLORS[c.categorie];
        const size = c.categorie === "actif" ? 8 + Math.round(20 * Math.sqrt((c.ca_12m || 0) / maxCa)) : 10;
        const m = L.marker([c.lat, c.lng], { icon: makeDivIcon(color, size, !!filterCodes) });
        const statusHtml = companyStatusPopupHtml({
          etat_administratif: c.etat_administratif,
          procedure_collective: c.procedure_collective,
        });
        m.bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:240px" data-client-code="${escapeHtml(c.code_client)}">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(c.nom || "—")}</div>
            <div style="color:#64748b;font-size:12px">${escapeHtml(c.ville || "")}</div>
            ${statusHtml ? `<div style="margin-top:6px">${statusHtml}</div>` : ""}
            <div class="rea-contact" data-code="${escapeHtml(c.code_client)}" style="margin-top:6px;font-size:12px;color:#64748b">📞 <em>chargement…</em></div>
            <div style="margin-top:6px;font-size:12px">CA 12 mois : <b>${fmtEUR(c.ca_12m || 0)}</b></div>
            <div style="font-size:12px">CA total : <b>${fmtEUR(c.ca_total || 0)}</b></div>
            <div style="font-size:12px;color:#475569">Dernière commande : <b>${c.derniere_commande ? fmtMonth(c.derniere_commande) : "aucune commande enregistrée"}</b></div>
            <div style="font-size:11px;color:${color};margin-top:4px;text-transform:uppercase">${c.categorie}</div>
            <div class="rea-slot" data-code="${escapeHtml(c.code_client)}" style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">Chargement…</div>
            ${canReactivation ? `<div style="display:flex;gap:6px;margin-top:6px"><button data-rea-action="action" data-code="${escapeHtml(c.code_client)}" style="flex:1;padding:5px 8px;background:#9B5CFF;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500">+ Action</button><button data-rea-action="statut" data-code="${escapeHtml(c.code_client)}" style="flex:1;padding:5px 8px;background:#334155;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500">Statut</button></div>` : ""}
          </div>`
        );
        cluster.addLayer(m);
        markerByCodeRef.current.set(c.code_client, m);
      }
    }

    if (layers.prospects && !filterCodes) {
      for (const p of data.prospects) {
        const m = L.marker([p.lat, p.lng], { icon: makeDivIcon(COLORS.prospects, 12) });
        m.bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:180px">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.nom || "—")}</div>
            <div style="color:#64748b;font-size:12px">${escapeHtml(p.ville || "")}</div>
            <div style="margin-top:6px;font-size:12px">Statut : <b>${escapeHtml(p.statut || "—")}</b></div>
            <div style="font-size:12px">Segment : ${escapeHtml(p.segment || "—")}</div>
          </div>`
        );
        cluster.addLayer(m);
      }
    }

    // Auto-fit when copilot result active
    if (filterCodes && filterCodes.size > 0 && mapRef.current) {
      const pts: L.LatLngExpression[] = [];
      for (const c of data.clients) {
        if (filterCodes.has(c.code_client)) pts.push([c.lat, c.lng]);
      }
      if (pts.length > 0) {
        mapRef.current.fitBounds(L.latLngBounds(pts as any), { padding: [40, 40], maxZoom: 11 });
      }
    }
  }, [data, layers, copilotResult]);

  const zoomToClient = (c: ClientPt) => {
    setSuggestOpen(false);
    setQuery(c.nom || "");
    if (!mapRef.current) return;
    mapRef.current.setView([c.lat, c.lng], 13);
    const m = markerByCodeRef.current.get(c.code_client);
    if (m) setTimeout(() => m.openPopup(), 200);
  };

  const askingRef = useRef(false);

  const askCopilot = async (override?: string) => {
    const q = (override ?? query).trim();
    if (!q || askingRef.current) return;
    askingRef.current = true;
    setSuggestOpen(false);
    setAsking(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("carte-copilot", {
        body: { question: q },
      });
      let human: string | null = null;
      let debug: string | null = null;
      if (error) {
        try {
          const resp: Response | undefined = (error as any)?.context?.response ?? (error as any)?.context;
          if (resp && typeof (resp as Response).text === "function") {
            const txt = await (resp as Response).clone().text();
            const j = JSON.parse(txt);
            human = j?.message || j?.error || null;
            debug = j?.debug || null;
          }
        } catch {
          /* ignore */
        }
        throw Object.assign(
          new Error(human || "Le copilote est momentanément indisponible. Réessaie."),
          { debug },
        );
      }
      if ((res as any)?.error) {
        throw Object.assign(new Error((res as any).message || (res as any).error), {
          debug: (res as any).debug,
        });
      }
      const rows: any[] = (res as any).rows ?? [];
      const codes = new Set<string>(rows.map((r) => String(r.code_client)).filter(Boolean));
      const hasPeriode = rows.some((r) => r.ca_periode != null);
      const ca_total = rows.reduce(
        (s, r) => s + (Number(hasPeriode ? r.ca_periode : r.ca_total) || 0),
        0,
      );
      setCopilotResult({
        interpretation: String((res as any).interpretation || q),
        count: codes.size,
        ca_total,
        codes,
      });
      if (codes.size === 0) {
        toast({
          title: "Aucun résultat",
          description: "Aucun client ne correspond à cette recherche",
        });
      }
    } catch (e: any) {
      const dbg = authorized && e?.debug ? String(e.debug) : "";
      toast({
        title: "Copilote",
        description: (
          <span className="block max-w-full">
            <span className="block break-words">{e?.message || "Erreur inattendue"}</span>
            {dbg && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs opacity-70">Détail technique</summary>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-tight opacity-80">
                  {dbg}
                </pre>
              </details>
            )}
          </span>
        ) as any,
        variant: "destructive",
        action: (
          <ToastAction altText="Réessayer" onClick={() => askCopilot(q)}>
            Réessayer
          </ToastAction>
        ),
      });

    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  };


  const resetCopilot = () => {
    setCopilotResult(null);
    setQuery("");
    if (mapRef.current) mapRef.current.setView([46.6, 2.5], 6);
  };

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Accès réservé à l'administration et à la direction.
      </div>
    );
  }

  const backHref = vue === "prospection" ? "/prospection" : "/clients";
  const backLabel = vue === "prospection" ? "Prospection" : "Clients";

  const copilotBar = (
    <>
        <div className="flex gap-2 items-start max-w-3xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSuggestOpen(true); }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (suggestions.length === 1) zoomToClient(suggestions[0]);
                  else askCopilot();
                }
                if (e.key === "Escape") setSuggestOpen(false);
              }}
              placeholder="Rechercher un client ou poser une question…"
              className="pl-9 pr-9"
              disabled={asking}
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setSuggestOpen(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Effacer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {suggestOpen && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-md border bg-popover shadow-lg overflow-hidden">
                {suggestions.map((c) => (
                  <button
                    key={c.code_client}
                    onMouseDown={(e) => { e.preventDefault(); zoomToClient(c); }}
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{c.nom}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.ville || "—"} · {fmtEUR(c.ca_12m || 0)} 12m
                      </div>
                    </div>
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{ background: COLORS[c.categorie] }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button onClick={() => askCopilot()} disabled={asking || !query.trim()} className="shrink-0">
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">{asking ? "Recherche…" : "Demander"}</span>
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground text-center mt-1 max-w-3xl mx-auto">
          Ex : « clients de Bretagne à plus de 50 k€ sur 2026 », « dormants &gt; 100 k€ en PACA », « top 10 Normandie »
        </div>
    </>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2 bg-background sticky top-0">
        <div className="flex items-center gap-3">
          <Link to={backHref} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>
          <div className="h-4 w-px bg-border/60" />
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">Carte du parc</h1>
          </div>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </header>


      {/* Copilote — une seule entrée : barre inline (desktop) OU bouton flottant (mobile) */}
      {(isAdmin || isDirection) && (
        <>
          <div className="copilot-inline-bar hidden md:block relative z-[1100] border-b border-border/60 bg-background px-3 py-2">
            {copilotBar}
          </div>

          <Button
            type="button"
            onClick={() => setCopilotSheet(true)}
            className="copilot-fab copilot-fab-page md:hidden fixed right-4 z-[1200] h-12 w-12 rounded-full p-0 shadow-lg"
            style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))", right: "calc(1rem + env(safe-area-inset-right, 0px))" }}
            aria-label="Ouvrir le copilote carte"
          >
            <Sparkles className="h-5 w-5" />
          </Button>

          <Sheet open={copilotSheet} onOpenChange={setCopilotSheet}>
            <SheetContent side="bottom" className="h-[90vh] flex flex-col p-0 gap-0">
              <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
                <SheetTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" /> Copilote carte
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                {copilotBar}
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

      <div className="relative flex-1 isolate">
        <div ref={mapEl} className="absolute inset-0 z-0" style={{ isolation: "isolate" }} />

        {/* Résultat copilote */}
        {copilotResult && (
          <Card className="absolute top-3 left-3 right-3 sm:right-auto z-[30] p-3 sm:max-w-sm max-h-[70vh] overflow-y-auto overscroll-contain shadow-lg border-primary/40">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Question interprétée</div>
                <div className="text-sm font-medium mb-2">{copilotResult.interpretation}</div>
                <div className="flex gap-4 text-sm">
                  <div>
                    <div className="text-[11px] text-muted-foreground">Clients</div>
                    <div className="font-semibold tabular-nums">{copilotResult.count}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">CA cumulé</div>
                    <div className="font-semibold tabular-nums">{fmtEUR(copilotResult.ca_total)}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resetCopilot}
                  className="mt-2 h-7 text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Réinitialiser
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Filtres */}
        <Card className="absolute top-3 right-3 z-[20] p-3 min-w-[200px] shadow-lg">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Couches</div>
          <div className="space-y-1.5">
            {(Object.keys(LABELS) as Layer[]).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={layers[k]}
                  onCheckedChange={(v) => setLayers((s) => ({ ...s, [k]: !!v }))}
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: COLORS[k] }}
                />
                <span className="flex-1">{LABELS[k]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {counts[k].toLocaleString("fr-FR")}
                </span>
              </label>
            ))}
          </div>
        </Card>

        {error && (
          <div className="absolute bottom-3 left-3 z-[20] rounded bg-destructive/10 text-destructive text-xs px-3 py-2">
            Erreur : {String((error as Error).message)}
          </div>
        )}
      </div>

      <ClientActionsDialog
        code={reaCode}
        open={!!reaCode}
        onOpenChange={(v) => !v && setReaCode(null)}
        initialTab={reaTab}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

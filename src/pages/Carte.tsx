import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ClientActionsDialog } from "@/components/reactivation/ClientActionsDialog";
import { companyStatusPopupHtml } from "@/components/reactivation/CompanyStatusBadge";
import { Loader2, MapPin, ArrowLeft, Search, Sparkles, X, RotateCcw, HelpCircle, Check, Gamepad2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ParcArcadeBloc } from "@/components/ParcArcadeBloc";
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

// Deux univers distincts sur la carte : les clients (par ancienneté de commande) et les
// prospects (par secteur d'activité). Les mélanger dans une seule liste de couches
// empêchait de travailler un secteur de prospection sans afficher tout le portefeuille.
type ClientLayer = "actif" | "dormant" | "inactif";
type ProspectSeg = "camping" | "loisirs" | "chr" | "retail" | "autre";

const CLIENT_LAYERS: ClientLayer[] = ["actif", "dormant", "inactif"];
const PROSPECT_SEGMENTS: ProspectSeg[] = ["camping", "loisirs", "chr", "retail", "autre"];

const COLORS_CLIENT: Record<ClientLayer, string> = {
  actif: "#3b82f6",
  dormant: "#f59e0b",
  inactif: "#94a3b8",
};
const COLORS_PROSPECT: Record<ProspectSeg, string> = {
  camping: "#10b981",
  loisirs: "#a855f7",
  chr: "#f43f5e",
  retail: "#0ea5e9",
  autre: "#64748b",
};
const LABELS_CLIENT: Record<ClientLayer, string> = {
  actif: "Actifs",
  dormant: "Dormants",
  inactif: "Inactifs",
};
const LABELS_PROSPECT: Record<ProspectSeg, string> = {
  camping: "Camping",
  loisirs: "Loisirs",
  chr: "CHR",
  retail: "Retail",
  autre: "Autres",
};

// Tout segment inconnu ou absent retombe sur « autre » : un prospect ne doit jamais
// disparaître de la carte à cause d'un libellé inattendu.
function segProspect(s: string | null | undefined): ProspectSeg {
  const v = (s ?? "").toLowerCase().trim();
  return (PROSPECT_SEGMENTS as string[]).includes(v) ? (v as ProspectSeg) : "autre";
}

// Les lieux de l'annuaire arcade dont le rapprochement n'a pas pu être tranché
// automatiquement. Ils forment une TROISIÈME couche, distincte des clients et des
// prospects : ce ne sont encore ni l'un ni l'autre, et les fondre dans l'une des deux
// reviendrait à décider à la place de l'utilisateur.
type SalleDoute = {
  id: string; nom: string | null; ville: string | null; code_postal: string | null;
  departement: string | null; region: string | null; type_lieu: string | null;
  lat: number; lng: number; fiche_url: string;
  candidat_type: string | null; candidat_id: string | null;
  candidat_nom: string | null; candidat_motif: string | null;
};

const COULEUR_DOUTE = "#eab308";

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
  geoCount: number;       // lignes réellement géolocalisées (coordonnées valides)
  invalidCount: number;   // lignes avec coordonnées aberrantes / nulles
  ca_total: number;
  codes: Set<string>;
  points: CopilotPoint[];
};

// Plages de coordonnées plausibles. France métropolitaine d'abord, Europe en repli.
const FRANCE_BOX = { latMin: 41, latMax: 52, lngMin: -6, lngMax: 10 };
const EUROPE_BOX = { latMin: 34, latMax: 72, lngMin: -25, lngMax: 45 };

function inBox(lat: number, lng: number, b: typeof FRANCE_BOX) {
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

/** Coordonnée exploitable : non nulle, pas 0,0, et dans l'Europe élargie. */
function isSaneCoord(lat: number | null, lng: number | null): lat is number {
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return inBox(lat, lng, EUROPE_BOX);
}

function pickCoord(row: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = row?.[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type PopupClient = {
  code_client: string;
  nom: string | null;
  ville: string | null;
  ca_12m?: number | null;
  ca_total?: number | null;
  derniere_commande?: string | null;
  categorie?: "actif" | "dormant" | "inactif" | null;
  etat_administratif?: string | null;
  procedure_collective?: boolean | null;
};

/** Gabarit unique du popup client (utilisé par la couche clients ET la branche de secours). */
function popupClientHtml(p: PopupClient, canReactivation: boolean): string {
  const code = escapeHtml(p.code_client);
  const nom = p.nom || "—";
  const color = p.categorie ? COLORS_CLIENT[p.categorie as ClientLayer] : "#64748b";
  const statusHtml = companyStatusPopupHtml({
    etat_administratif: p.etat_administratif,
    procedure_collective: p.procedure_collective,
  });
  return `<div style="font-family:system-ui,sans-serif;min-width:240px" data-client-code="${code}">
    <div style="font-weight:600;margin-bottom:4px">${escapeHtml(nom)}</div>
    <div style="color:#64748b;font-size:12px">${escapeHtml(p.ville || "")}</div>
    ${statusHtml ? `<div style="margin-top:6px">${statusHtml}</div>` : ""}
    <div class="rea-contact" data-code="${code}" style="margin-top:6px;font-size:12px;color:#64748b">📞 <em>chargement…</em></div>
    ${p.ca_12m != null ? `<div style="margin-top:6px;font-size:12px">CA 12 mois : <b>${fmtEUR(p.ca_12m || 0)}</b></div>` : ""}
    ${p.ca_total != null ? `<div style="font-size:12px">CA total : <b>${fmtEUR(p.ca_total || 0)}</b></div>` : ""}
    ${p.derniere_commande !== undefined ? `<div style="font-size:12px;color:#475569">Dernière commande : <b>${p.derniere_commande ? fmtMonth(p.derniere_commande) : "aucune commande enregistrée"}</b></div>` : ""}
    ${p.categorie ? `<div style="font-size:11px;color:${color};margin-top:4px;text-transform:uppercase">${p.categorie}</div>` : ""}
    <div class="rea-slot" data-code="${code}" style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">Chargement…</div>
    ${canReactivation ? `<div style="display:flex;gap:6px;margin-top:6px"><button data-rea-action="action" data-code="${code}" style="flex:1;padding:5px 8px;background:#9B5CFF;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500">+ Action</button><button data-rea-action="statut" data-code="${code}" style="flex:1;padding:5px 8px;background:#334155;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500">Statut</button></div>` : ""}
    <button data-fiche-client="${escapeHtml(p.nom || "")}" style="margin-top:6px;width:100%;padding:5px 8px;background:transparent;color:#9B5CFF;border:1px solid #9B5CFF;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500">Ouvrir la fiche client →</button>
  </div>`;
}

/** Gabarit du popup prospect (contact hydraté à l'ouverture). */
function popupProspectHtml(p: { id: string; nom: string | null; ville: string | null; statut: string | null; segment: string | null }): string {
  const id = escapeHtml(p.id);
  return `<div style="font-family:system-ui,sans-serif;min-width:220px">
    <div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.nom || "—")}</div>
    <div style="color:#64748b;font-size:12px">${escapeHtml(p.ville || "")}</div>
    <div style="margin-top:6px;font-size:12px">Statut : <b>${escapeHtml(p.statut || "—")}</b></div>
    <div style="font-size:12px">Segment : ${escapeHtml(p.segment || "—")}</div>
    <div class="prospect-slot" data-id="${id}" style="margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">Chargement…</div>
    <button data-fiche-prospect="${id}" style="margin-top:6px;width:100%;padding:5px 8px;background:transparent;color:#9B5CFF;border:1px solid #9B5CFF;border-radius:4px;font-size:11px;cursor:pointer;font-weight:500">Ouvrir dans Prospection →</button>
  </div>`;
}



export default function Carte() {
  const { isAdmin, isDirection, canReactivation } = useAuth();
  const authorized = isAdmin || isDirection;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const queryClient = useQueryClient();
  const [reaCode, setReaCode] = useState<string | null>(null);
  const [reaTab, setReaTab] = useState<"action" | "statut">("action");
  const search = new URLSearchParams(useLocation().search);
  const vue = search.get("vue"); // "prospection" | null

  const [clientLayers, setClientLayers] = useState<Record<ClientLayer, boolean>>({
    actif: true,
    dormant: true,
    inactif: false,
  });
  const tousSegments = (on: boolean): Record<ProspectSeg, boolean> =>
    Object.fromEntries(PROSPECT_SEGMENTS.map((s) => [s, on])) as Record<ProspectSeg, boolean>;
  const [voirDoutes, setVoirDoutes] = useState(true);
  const [arbitrage, setArbitrage] = useState<SalleDoute | null>(null);
  const [segmentChoisi, setSegmentChoisi] = useState<string>("");
  const [enCoursArbitrage, setEnCoursArbitrage] = useState(false);
  const [prospectLayers, setProspectLayers] = useState<Record<ProspectSeg, boolean>>(() =>
    tousSegments(vue === "prospection"),
  );

  useEffect(() => {
    if (vue === "prospection") setProspectLayers(tousSegments(true));
  }, [vue]);

  // Les lieux à arbitrer, et les segments RÉELLEMENT présents en base : proposer une
  // liste figée aurait fini par diverger des données le jour où un segment est ajouté.
  const { data: doutes, refetch: rechargerDoutes } = useQuery({
    queryKey: ["arcade-a-confirmer"],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arcade_salles" as any)
        .select("id, nom, ville, code_postal, departement, region, type_lieu, lat, lng, fiche_url, candidat_type, candidat_id, candidat_nom, candidat_motif")
        .eq("rapprochement", "a_confirmer").eq("ferme", false)
        .not("lat", "is", null).limit(400);
      if (error) throw error;
      return (data ?? []) as unknown as SalleDoute[];
    },
  });

  const { data: segmentsEnBase } = useQuery({
    queryKey: ["segments-prospects"],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("prospects").select("segment").limit(10000);
      if (error) throw error;
      const vus = new Set<string>();
      for (const r of data ?? []) if ((r as any).segment) vus.add(String((r as any).segment));
      return [...vus].sort();
    },
  });

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
    const prospects = data?.prospects ?? [];
    const parSegment = Object.fromEntries(
      PROSPECT_SEGMENTS.map((s) => [s, prospects.filter((p) => segProspect(p.segment) === s).length]),
    ) as Record<ProspectSeg, number>;
    return {
      actif: clients.filter((c) => c.categorie === "actif").length,
      dormant: clients.filter((c) => c.categorie === "dormant").length,
      inactif: clients.filter((c) => c.categorie === "inactif").length,
      prospects: prospects.length,
      parSegment,
    };
  }, [data]);

  // --- Recherche & Copilot ---
  const [query, setQuery] = useState("");
  const [copilotSheet, setCopilotSheet] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [copilotResult, setCopilotResult] = useState<CopilotResult | null>(null);

  // Les suggestions cherchent dans les clients ET les prospects. Ne proposer que les
  // clients était trompeur : la base compte 8 700 prospects contre 3 000 clients, et
  // taper « speedpark » ne renvoyait qu'une holding à Dijon alors que dix-sept
  // établissements du même réseau sont recensés.
  //
  // La comparaison ignore accents, casse ET espaces : « speed park », « speedpark » et
  // « Speed-Park » désignent le même endroit, et personne ne connaît l'orthographe
  // exacte d'une enseigne au moment de la chercher.
  const suggestions = useMemo(() => {
    if (!data || query.trim().length < 2) return [];
    const q = normalize(query.trim()).replace(/[^a-z0-9]/g, "");
    if (q.length < 2) return [];
    const cle = (v: string | null | undefined) => normalize(v ?? "").replace(/[^a-z0-9]/g, "");
    const desClients = data.clients
      .filter((c) => c.nom && cle(c.nom).includes(q))
      .map((c) => ({ genre: "client" as const, item: c }));
    const desProspects = (data.prospects ?? [])
      .filter((p: any) => p.nom && cle(p.nom).includes(q))
      .map((p: any) => ({ genre: "prospect" as const, item: p }));
    return [...desClients, ...desProspects].slice(0, 10);
  }, [data, query]);

  // --- Leaflet init ---
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<any>(null);
  const markerByCodeRef = useRef<Map<string, L.Marker>>(new Map());
  // Empêche une boucle de rechargement de get_map_points (une seule tentative par résultat).
  const refetchedRef = useRef(false);
  useEffect(() => {
    refetchedRef.current = false;
  }, [copilotResult]);

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
      // Lien « Ouvrir la fiche client » → routeur (pas de rechargement complet).
      el.querySelectorAll<HTMLButtonElement>("button[data-fiche-client]").forEach((btn) => {
        btn.onclick = () => {
          const nom = btn.getAttribute("data-fiche-client") || "";
          if (!nom) return;
          navigateRef.current(`/admin/gaia/client/${encodeURIComponent(nom)}`);
        };
      });
      el.querySelectorAll<HTMLButtonElement>("button[data-fiche-prospect]").forEach((btn) => {
        btn.onclick = () => {
          const id = btn.getAttribute("data-fiche-prospect") || "";
          if (!id) return;
          navigateRef.current(`/prospection?prospect=${encodeURIComponent(id)}`);
        };
      });
      // Hydratation contact prospect (tel / email / accroche)
      const pSlot = el.querySelector<HTMLElement>(".prospect-slot");
      const pId = pSlot?.getAttribute("data-id");
      if (pSlot && pId) {
        try {
          const { data: pr } = await supabase
            .from("prospects")
            .select("telephone, email, accroche_defaut")
            .eq("id", pId)
            .maybeSingle();
          const tel = String((pr as any)?.telephone || "");
          const telHref = tel.replace(/[^\d+]/g, "");
          const email = String((pr as any)?.email || "");
          const accroche = String((pr as any)?.accroche_defaut || "");
          const rows: string[] = [];
          rows.push(
            telHref
              ? `<div><a href="tel:${encodeURIComponent(telHref)}" style="color:#9B5CFF;text-decoration:none;font-weight:500">📞 ${escapeHtml(tel)}</a></div>`
              : `<div style="color:#94a3b8;font-style:italic">📞 Téléphone non renseigné</div>`,
          );
          rows.push(
            email
              ? `<div style="margin-top:2px"><a href="mailto:${escapeHtml(encodeURIComponent(email))}" style="color:#9B5CFF;text-decoration:none;font-weight:500;word-break:break-all">✉ ${escapeHtml(email)}</a></div>`
              : `<div style="margin-top:2px;color:#94a3b8;font-style:italic">✉ Email non renseigné</div>`,
          );
          if (accroche) {
            rows.push(
              `<div style="margin-top:6px;font-size:11px;color:#475569;font-style:italic">« ${escapeHtml(accroche.slice(0, 220))}${accroche.length > 220 ? "…" : ""} »</div>`,
            );
          }
          pSlot.innerHTML = rows.join("");
        } catch {
          pSlot.textContent = "";
        }
      }
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
            parts.push(`Statut : <b>${escapeHtml(labels[d.statut_relance] || String(d.statut_relance))}</b>`);
          }
          const last = d.actions?.[0];
          if (last) {
            const dt = new Date(last.date).toLocaleDateString("fr-FR");
            const auteur = last.auteur ? ` (${escapeHtml(String(last.auteur))})` : "";
            parts.push(`Dernière action : <b>${escapeHtml(String(last.type ?? ""))}</b> — ${escapeHtml(dt)}${auteur}`);
          }
          slot.innerHTML = parts.length
            ? parts.map((p) => `<div>${p}</div>`).join("")
            : `<em>Aucune action encore.</em>`;
          // Hydrate contact block (phone/email)
          const contactEl = el.querySelector<HTMLElement>(`.rea-contact[data-code="${code}"]`);
          if (contactEl) {
            const tel = (d.telephone || "").toString();
            const telHref = tel.replace(/[^\d+]/g, "");
            const email = String(d.email || "");
            const telHtml = telHref
              ? `<a href="tel:${encodeURIComponent(telHref)}" style="color:#9B5CFF;text-decoration:none;font-weight:500">📞 ${escapeHtml(tel)}</a>`
              : `<span style="color:#94a3b8;font-style:italic">📞 Téléphone non renseigné</span>`;
            const mailHtml = email
              ? `<a href="mailto:${escapeHtml(encodeURIComponent(email))}" style="color:#9B5CFF;text-decoration:none;font-weight:500;word-break:break-all">✉ ${escapeHtml(email)}</a>`
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

    // Quand un résultat copilote est actif, on ignore les cases à cocher :
    // les points demandés doivent toujours être visibles.
    if (filterCodes || clientLayers.actif || clientLayers.dormant || clientLayers.inactif) {
      for (const c of data.clients) {
        if (!filterCodes && !clientLayers[c.categorie as ClientLayer]) continue;
        if (filterCodes && !filterCodes.has(String(c.code_client ?? "").trim())) continue;
        const color = COLORS_CLIENT[c.categorie as ClientLayer];
        const size = c.categorie === "actif" ? 8 + Math.round(20 * Math.sqrt((c.ca_12m || 0) / maxCa)) : 10;
        const m = L.marker([c.lat, c.lng], { icon: makeDivIcon(color, size, !!filterCodes) });
        m.bindPopup(popupClientHtml(c, canReactivation));
        cluster.addLayer(m);
        markerByCodeRef.current.set(String(c.code_client ?? "").trim(), m);
      }
    }

    if (!filterCodes) {
      for (const p of data.prospects) {
        const seg = segProspect(p.segment);
        if (!prospectLayers[seg]) continue;
        const m = L.marker([p.lat, p.lng], { icon: makeDivIcon(COLORS_PROSPECT[seg], 12) });
        m.bindPopup(popupProspectHtml(p));
        cluster.addLayer(m);
      }
    }

    // Les lieux à arbitrer, en jaune et légèrement plus gros : ils demandent une
    // action, là où clients et prospects ne demandent qu'à être consultés.
    if (!filterCodes && voirDoutes) {
      for (const d of doutes ?? []) {
        const m = L.marker([d.lat, d.lng], { icon: makeDivIcon(COULEUR_DOUTE, 15) });
        // Un panneau React plutôt qu'une bulle Leaflet : l'arbitrage demande une liste
        // déroulante et deux boutons, que du HTML injecté ne sait pas porter.
        m.on("click", () => { setArbitrage(d); setSegmentChoisi(""); });
        cluster.addLayer(m);
      }
    }

    // Points renvoyés par le copilote absents du jeu de données de la carte
    // (prospects, clients géocodés après le chargement de get_map_points…).
    const extraPts: [number, number][] = [];
    let missingClient = false;
    if (copilotResult) {
      for (const p of copilotResult.points) {
        const key = p.code_client ? p.code_client : null;
        if (key && markerByCodeRef.current.has(key)) continue;
        if (key) missingClient = true;
        const isClient = !!key;
        const m = L.marker([p.lat, p.lng], {
          icon: makeDivIcon(isClient ? COLORS_CLIENT.inactif : COLORS_PROSPECT.camping, 12, true),
        });
        m.bindPopup(
          isClient
            ? popupClientHtml(
                { code_client: key as string, nom: p.nom, ville: p.ville },
                canReactivation,
              )
            : `<div style="font-family:system-ui,sans-serif;min-width:180px">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.nom || "—")}</div>
            <div style="color:#64748b;font-size:12px">${escapeHtml(p.ville || "")}</div>
          </div>`,
        );
        cluster.addLayer(m);
        extraPts.push([p.lat, p.lng]);
      }
    }

    // Un client absent de get_map_points = jeu de données périmé (géocodage récent).
    // On recharge une seule fois, puis on redessine avec la vraie catégorie.
    if (missingClient && !refetchedRef.current) {
      refetchedRef.current = true;
      queryClient.invalidateQueries({ queryKey: ["map-points"] });
    }


    // Auto-fit sur les résultats du copilote, quel que soit leur nombre.
    // Les coordonnées aberrantes (hors Europe, 0,0, nulles) sont ignorées.
    if (filterCodes && mapRef.current) {
      const pts: [number, number][] = [...(extraPts as [number, number][])];
      for (const c of data.clients) {
        if (!filterCodes.has(String(c.code_client ?? "").trim())) continue;
        if (!isSaneCoord(c.lat, c.lng)) continue;
        pts.push([c.lat, c.lng]);
      }
      // Si l'essentiel des points est en France métropolitaine, on cadre dessus
      // pour éviter qu'un point lointain (DOM, Maghreb…) n'élargisse tout.
      const inFrance = pts.filter(([la, ln]) => inBox(la, ln, FRANCE_BOX));
      const fitPts = inFrance.length >= Math.max(1, Math.ceil(pts.length * 0.8)) ? inFrance : pts;
      if (fitPts.length > 0) {
        mapRef.current.fitBounds(L.latLngBounds(fitPts as any), {
          padding: [60, 60],
          maxZoom: 12,
          animate: true,
        });
      }
    }

  }, [data, clientLayers, prospectLayers, copilotResult, doutes, voirDoutes]);

  /** Trancher un rapprochement douteux. Deux issues seulement, et toutes deux sont des
   *  décisions : c'est le même établissement, ou c'en est un autre qu'il faut qualifier.
   *  L'horodatage de l'arbitrage protège la décision — le rapprochement automatique
   *  saute désormais les salles tranchées, sinon le doute reviendrait à chaque passage. */
  async function arbitrer(salle: SalleDoute, issue: "confirmer" | "separer") {
    setEnCoursArbitrage(true);
    try {
      if (issue === "confirmer") {
        const maj: Record<string, unknown> = {
          rapprochement: salle.candidat_type === "client" ? "client" : "prospect",
          arbitre_le: new Date().toISOString(),
          candidat_type: null, candidat_id: null, candidat_nom: null, candidat_motif: null,
        };
        if (salle.candidat_type === "client") maj.code_client = salle.candidat_id;
        else maj.prospect_id = salle.candidat_id;
        const { error } = await supabase.from("arcade_salles" as any).update(maj).eq("id", salle.id);
        if (error) throw error;
        toast({ title: "Rapprochement confirmé", description: salle.candidat_nom ?? "" });
      } else {
        const { data: cree, error } = await supabase.from("prospects").insert({
          entreprise: salle.nom, ville: salle.ville, code_postal: salle.code_postal,
          lat: salle.lat, lng: salle.lng, segment: segmentChoisi, tag: salle.type_lieu,
          source: "annuaire-arcade", sources: ["annuaire-arcade"], statut: "nouveau",
          signal: "Déjà équipé — issu de l'annuaire arcade, qualifié à la main",
          notes: salle.fiche_url,
        } as any).select("id").single();
        if (error) throw error;
        const { error: e2 } = await supabase.from("arcade_salles" as any).update({
          prospect_id: (cree as any).id, rapprochement: "prospect",
          arbitre_le: new Date().toISOString(),
          candidat_type: null, candidat_id: null, candidat_nom: null, candidat_motif: null,
        }).eq("id", salle.id);
        if (e2) throw e2;
        toast({ title: "Prospect créé", description: `${salle.nom} · ${segmentChoisi}` });
      }
      setArbitrage(null);
      rechargerDoutes();
      queryClient.invalidateQueries({ queryKey: ["map-points"] });
    } catch (e) {
      toast({ title: "Arbitrage impossible", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnCoursArbitrage(false);
    }
  }

  /** Centrer sur un point sans code client — un prospect n'en a pas. */
  const zoomToPoint = (lat: number, lng: number, nom?: string | null) => {
    setSuggestOpen(false);
    if (nom) setQuery(nom);
    mapRef.current?.setView([lat, lng], 15, { animate: true });
  };

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
      const codes = new Set<string>(
        rows.map((r) => String(r.code_client ?? "").trim()).filter(Boolean),
      );
      const points: CopilotPoint[] = [];
      let invalidCount = 0;
      for (const r of rows) {
        const lat = pickCoord(r, ["lat", "latitude"]);
        const lng = pickCoord(r, ["lng", "lon", "long", "longitude"]);
        if (!isSaneCoord(lat, lng)) {
          if (lat !== null || lng !== null) invalidCount++;
          continue;
        }
        points.push({
          code_client: r.code_client ? String(r.code_client).trim() : null,
          nom: String(r.nom ?? r.name ?? r.entreprise ?? "—"),
          ville: String(r.ville ?? ""),
          lat,
          lng: lng as number,
        });
      }
      const hasPeriode = rows.some((r) => r.ca_periode != null);
      const ca_total = rows.reduce(
        (s, r) => s + (Number(hasPeriode ? r.ca_periode : r.ca_total) || 0),
        0,
      );
      const totalRaw = (res as any).total;
      const total = Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : null;
      setCopilotResult({
        interpretation: String((res as any).interpretation || q),
        count: rows.length,
        total,
        truncated: Boolean((res as any).truncated) || rows.length >= 500,
        geoCount: points.length,
        invalidCount,
        ca_total,
        codes,
        points,
      });

      if (rows.length === 0) {
        toast({
          title: "Aucun résultat",
          description: "Aucun client ne correspond à cette recherche",
        });
      } else if (points.length === 0) {
        toast({
          title: "Aucun point à afficher",
          description: `${rows.length} résultat(s), mais aucune coordonnée géographique exploitable (clients non géocodés).`,
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
                  if (suggestions.length === 1) {
                    const s = suggestions[0];
                    if (s.genre === "client") zoomToClient(s.item as ClientPt);
                    else zoomToPoint((s.item as any).lat, (s.item as any).lng, (s.item as any).nom);
                  }
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
                {suggestions.map((s, i) => (
                  <button
                    key={s.genre === "client" ? (s.item as ClientPt).code_client : `p-${i}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (s.genre === "client") zoomToClient(s.item as ClientPt);
                      else zoomToPoint((s.item as any).lat, (s.item as any).lng, (s.item as any).nom);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{(s.item as any).nom}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(s.item as any).ville || "—"}
                        {s.genre === "client"
                          ? ` · ${fmtEUR((s.item as ClientPt).ca_12m || 0)} 12m`
                          : ` · prospect${(s.item as any).segment ? ` ${(s.item as any).segment}` : ""}`}
                      </div>
                    </div>
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0"
                      style={{
                        background: s.genre === "client"
                          ? COLORS_CLIENT[(s.item as ClientPt).categorie as ClientLayer]
                          : COLORS_PROSPECT[segProspect((s.item as any).segment)],
                      }}
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
                    <div className="text-[11px] text-muted-foreground">Résultats</div>
                    <div className="font-semibold tabular-nums">
                      {(copilotResult.total ?? copilotResult.count).toLocaleString("fr-FR")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">CA cumulé</div>
                    <div className="font-semibold tabular-nums">{fmtEUR(copilotResult.ca_total)}</div>
                  </div>
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {copilotResult.total != null && copilotResult.total > copilotResult.count
                    ? `${copilotResult.total.toLocaleString("fr-FR")} au total (${copilotResult.count.toLocaleString("fr-FR")} affichés sur la carte)`
                    : `${copilotResult.count.toLocaleString("fr-FR")} résultat${copilotResult.count > 1 ? "s" : ""}, dont ${copilotResult.geoCount.toLocaleString("fr-FR")} géolocalisé${copilotResult.geoCount > 1 ? "s" : ""}`}
                  {copilotResult.total != null &&
                    copilotResult.total > copilotResult.count &&
                    copilotResult.geoCount < copilotResult.count &&
                    ` — ${copilotResult.geoCount.toLocaleString("fr-FR")} géolocalisés`}
                </div>
                {copilotResult.invalidCount > 0 && (
                  <div className="mt-1 text-[11px] text-amber-500">
                    ⚠ {copilotResult.invalidCount.toLocaleString("fr-FR")} client
                    {copilotResult.invalidCount > 1 ? "s" : ""} pas encore géolocalisé
                    {copilotResult.invalidCount > 1 ? "s" : ""} (géocodage en cours)
                  </div>
                )}

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
          {/* Deux blocs : le portefeuille d'un côté, la prospection de l'autre. */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Clients
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {(counts.actif + counts.dormant + counts.inactif).toLocaleString("fr-FR")}
            </span>
          </div>
          <div className="space-y-1.5">
            {CLIENT_LAYERS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={clientLayers[k]}
                  onCheckedChange={(v) => setClientLayers((s) => ({ ...s, [k]: !!v }))}
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: COLORS_CLIENT[k] }}
                />
                <span className="flex-1">{LABELS_CLIENT[k]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {counts[k].toLocaleString("fr-FR")}
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Prospects
            </span>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() =>
                setProspectLayers((s) =>
                  tousSegments(!PROSPECT_SEGMENTS.every((k) => s[k])),
                )
              }
            >
              {PROSPECT_SEGMENTS.every((k) => prospectLayers[k]) ? "Aucun" : "Tous"}
            </button>
          </div>
          <div className="space-y-1.5">
            {PROSPECT_SEGMENTS.filter((k) => counts.parSegment[k] > 0).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={prospectLayers[k]}
                  onCheckedChange={(v) => setProspectLayers((s) => ({ ...s, [k]: !!v }))}
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: COLORS_PROSPECT[k] }}
                />
                <span className="flex-1">{LABELS_PROSPECT[k]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {counts.parSegment[k].toLocaleString("fr-FR")}
                </span>
              </label>
            ))}
          </div>

          {(doutes ?? []).length > 0 && (
            <>
              <div className="my-2 border-t border-border/60" />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={voirDoutes} onCheckedChange={(v) => setVoirDoutes(!!v)} />
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COULEUR_DOUTE }} />
                <span className="flex-1">À confirmer</span>
                <span className="text-xs text-muted-foreground tabular-nums">{(doutes ?? []).length}</span>
              </label>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                Lieux de l'annuaire arcade qu'un rapprochement automatique n'a pas su trancher.
              </p>
            </>
          )}
        </Card>

        {/* Arbitrage : confirmer le rapprochement proposé, ou qualifier le lieu comme
            un prospect à part entière. Les deux issues sont des décisions, pas des
            abandons — « aucun » n'existe pas ici. */}
        <Sheet open={!!arbitrage} onOpenChange={(o) => { if (!o) setArbitrage(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto"
            style={{ paddingTop: "calc(1.5rem + var(--safe-top))" }}>
            {arbitrage && (
              <>
                <SheetHeader className="text-left">
                  <SheetTitle className="text-base flex items-start gap-2">
                    <HelpCircle className="h-4 w-4 mt-1 flex-shrink-0" style={{ color: COULEUR_DOUTE }} />
                    <span>{arbitrage.nom ?? "Lieu sans nom"}</span>
                  </SheetTitle>
                  <p className="text-xs text-muted-foreground">
                    {[arbitrage.ville, arbitrage.departement, arbitrage.region].filter(Boolean).join(" · ")}
                    {arbitrage.type_lieu ? ` · ${arbitrage.type_lieu}` : ""}
                  </p>
                </SheetHeader>

                <div className="mt-4 space-y-4 pb-8">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Rapprochement proposé</p>
                    <p className="mt-1 text-sm font-semibold">{arbitrage.candidat_nom ?? "—"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {arbitrage.candidat_type === "client" ? "client Cegid" : "prospect existant"}
                      </Badge>
                      {arbitrage.candidat_motif && (
                        <span className="text-[11px] text-muted-foreground">{arbitrage.candidat_motif}</span>
                      )}
                    </div>
                    <Button className="mt-2 w-full gap-2" disabled={enCoursArbitrage}
                      onClick={() => arbitrer(arbitrage, "confirmer")}>
                      <Check className="h-4 w-4" />C'est le même établissement
                    </Button>
                  </div>

                  <ParcArcadeBloc salleId={arbitrage.id} />

                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Sinon, c'est un lieu distinct : qualifie-le et il devient un prospect.
                    </p>
                    <Select value={segmentChoisi} onValueChange={setSegmentChoisi}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Choisir un secteur…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(segmentsEnBase ?? []).map((sg) => (
                          <SelectItem key={sg} value={sg} className="capitalize">{sg}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" className="w-full gap-2"
                      disabled={!segmentChoisi || enCoursArbitrage}
                      onClick={() => arbitrer(arbitrage, "separer")}>
                      <Gamepad2 className="h-4 w-4" />Créer un prospect distinct
                    </Button>
                  </div>

                  <Button variant="ghost" asChild className="w-full gap-2 text-muted-foreground">
                    <a href={arbitrage.fiche_url} target="_blank" rel="noreferrer">
                      Voir la fiche de l'annuaire
                    </a>
                  </Button>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>

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

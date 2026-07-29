import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, MapPin, ArrowLeft } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
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

function makeDivIcon(color: string, size: number): L.DivIcon {
  const s = Math.max(8, Math.min(28, size));
  return L.divIcon({
    className: "carte-marker",
    html: `<span style="display:block;width:${s}px;height:${s}px;border-radius:9999px;background:${color};box-shadow:0 0 0 2px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.35);"></span>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
}

export default function Carte() {
  const { isAdmin, isDirection } = useAuth();
  const authorized = isAdmin || isDirection;
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

  // --- Leaflet init ---
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<any>(null);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { preferCanvas: true }).setView([46.6, 2.5], 6);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // @ts-ignore
    clusterRef.current = (L as any).markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55 });
    map.addLayer(clusterRef.current);
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // --- Redraw markers on data/layer change ---
  useEffect(() => {
    if (!mapRef.current || !clusterRef.current || !data) return;
    const cluster = clusterRef.current;
    cluster.clearLayers();

    const maxCa = Math.max(1, ...data.clients.map((c) => c.ca_12m || 0));

    if (layers.actif || layers.dormant || layers.inactif) {
      for (const c of data.clients) {
        if (!layers[c.categorie]) continue;
        const color = COLORS[c.categorie];
        const size = c.categorie === "actif" ? 8 + Math.round(20 * Math.sqrt((c.ca_12m || 0) / maxCa)) : 10;
        const m = L.marker([c.lat, c.lng], { icon: makeDivIcon(color, size) });
        m.bindPopup(
          `<div style="font-family:system-ui,sans-serif;min-width:180px">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(c.nom || "—")}</div>
            <div style="color:#64748b;font-size:12px">${escapeHtml(c.ville || "")}</div>
            <div style="margin-top:6px;font-size:12px">CA 12 mois : <b>${fmtEUR(c.ca_12m || 0)}</b></div>
            <div style="font-size:11px;color:${color};margin-top:2px;text-transform:uppercase">${c.categorie}</div>
          </div>`
        );
        cluster.addLayer(m);
      }
    }

    if (layers.prospects) {
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
  }, [data, layers]);

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Accès réservé à l'administration et à la direction.
      </div>
    );
  }

  const backHref = vue === "prospection" ? "/prospection" : "/clients";
  const backLabel = vue === "prospection" ? "Prospection" : "Clients";

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 bg-background">
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
      </div>

      <div className="relative flex-1">
        <div ref={mapEl} className="absolute inset-0" />

        {/* Filtres */}
        <Card className="absolute top-3 right-3 z-[400] p-3 min-w-[200px] shadow-lg">
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
          <div className="absolute bottom-3 left-3 z-[400] rounded bg-destructive/10 text-destructive text-xs px-3 py-2">
            Erreur : {String((error as Error).message)}
          </div>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

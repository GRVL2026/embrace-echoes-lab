import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Loader2, Phone, Mail, MapPin, Gamepad2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BriefFiche } from "@/components/BriefFiche";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

// La carte du commercial.
//
// La carte de direction (src/pages/Carte.tsx) est un outil d'arbitrage : elle croise
// clients, CA, doublons et copilote, et n'est ouverte qu'à la direction. Un commercial n'a
// besoin que d'une chose : voir SES leads sur une carte pour organiser sa tournée, avec le
// parc installé autour pour repérer un lieu à démarcher pendant qu'il est sur place. On ne
// retrofit donc pas la page de direction — on donne au commercial une carte propre, sans
// le bruit qui ne le concerne pas et sans la moindre donnée client.
//
// Le cloisonnement n'est pas fait ici mais dans la base : la RLS restreint déjà la lecture
// des prospects au propriétaire connecté. Cette page lit la table directement — elle ne
// reçoit que les fiches du commercial, jamais celles des autres. Le parc installé (annuaire
// arcade, cabines) est en lecture libre pour l'équipe : c'est du marché, pas du client.

type Lead = {
  id: string; entreprise: string | null; ville: string | null;
  lat: number; lng: number; statut: string | null; segment: string | null;
  telephone: string | null; email: string | null;
};
type ParcPoint = { nom: string | null; ville: string | null; lat: number; lng: number; type: "salle" | "cabine" };

const COULEUR_SEG: Record<string, string> = {
  camping: "#22c55e", loisirs: "#8b5cf6", chr: "#f59e0b", fec: "#06b6d4",
  retail: "#ec4899", agence: "#e879f9", autre: "#64748b",
};
const couleurSeg = (s: string | null) => COULEUR_SEG[s ?? "autre"] ?? COULEUR_SEG.autre;

/** Même style de pastille que la carte de direction, pour ne pas dépayser. Le halo vert
 *  ne sert qu'à la fiche sélectionnée. */
function pastille(color: string, size: number, actif = false): L.DivIcon {
  const s = Math.max(8, Math.min(26, size));
  const ring = actif
    ? "0 0 0 3px #ADFF00, 0 0 12px rgba(173,255,0,0.7)"
    : "0 0 0 2px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.35)";
  return L.divIcon({
    className: "macarte-marker",
    html: `<span style="display:block;width:${s}px;height:${s}px;border-radius:9999px;background:${color};box-shadow:${ring};"></span>`,
    iconSize: [s, s], iconAnchor: [s / 2, s / 2],
  });
}

export default function MaCarte() {
  const { canAccessProspection, isLoading } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [parc, setParc] = useState<ParcPoint[]>([]);
  const [chargement, setChargement] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [voirParc, setVoirParc] = useState(true);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const leadLayer = useRef<L.LayerGroup | null>(null);
  const parcCluster = useRef<any>(null);

  // ── Chargement ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      const [{ data: l }, { data: s }, { data: c }] = await Promise.all([
        // RLS : ne renvoie que les prospects du commercial connecté (proprietaire = lui).
        (supabase as any).from("prospects")
          .select("id, entreprise, ville, lat, lng, statut, segment, telephone, email")
          .eq("etat", "actif").not("lat", "is", null).not("lng", "is", null),
        (supabase as any).from("arcade_salles")
          .select("nom, ville, lat, lng").eq("ferme", false)
          .not("lat", "is", null).not("lng", "is", null),
        (supabase as any).from("cabines_photo")
          .select("nom, ville, lat, lng").eq("pays", "FR")
          .not("lat", "is", null).not("lng", "is", null),
      ]);
      if (annule) return;
      setLeads((l as Lead[]) ?? []);
      const salles: ParcPoint[] = ((s as any[]) ?? []).map((x) => ({ ...x, type: "salle" }));
      const cabines: ParcPoint[] = ((c as any[]) ?? []).map((x) => ({ ...x, type: "cabine" }));
      setParc([...salles, ...cabines]);
      setChargement(false);
    })();
    return () => { annule = true; };
  }, []);

  // ── Carte, initialisée une seule fois ──────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { preferCanvas: true }).setView([46.6, 2.5], 6);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    leadLayer.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Parc installé : en grappes, en fond, discret ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (parcCluster.current) { map.removeLayer(parcCluster.current); parcCluster.current = null; }
    if (!voirParc || parc.length === 0) return;
    const cluster = (L as any).markerClusterGroup({
      chunkedLoading: true, maxClusterRadius: 45, showCoverageOnHover: false,
    });
    for (const p of parc) {
      const couleur = p.type === "cabine" ? "#94a3b8" : "#cbd5e1";
      const m = L.marker([p.lat, p.lng], { icon: pastille(couleur, 9), opacity: 0.9 });
      m.bindTooltip(`${p.nom ?? "?"}${p.ville ? " · " + p.ville : ""}${p.type === "cabine" ? " · cabine photo" : ""}`,
        { direction: "top" });
      cluster.addLayer(m);
    }
    map.addLayer(cluster);
    parcCluster.current = cluster;
  }, [parc, voirParc]);

  // ── Mes leads : par-dessus, en couleur, cliquables ─────────────────────────
  useEffect(() => {
    const map = mapRef.current, layer = leadLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const p of leads) {
      const m = L.marker([p.lat, p.lng], { icon: pastille(couleurSeg(p.segment), 14) });
      m.bindTooltip(`${p.entreprise ?? "?"}${p.ville ? " · " + p.ville : ""}`, { direction: "top" });
      m.on("click", () => setSelected(p));
      layer.addLayer(m);
    }
    // Cadrer sur les leads s'il y en a, une seule fois par jeu de données.
    if (leads.length > 0) {
      const b = L.latLngBounds(leads.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(b, { padding: [50, 50], maxZoom: 12 });
    }
  }, [leads]);

  const parReglages = useMemo(() => {
    const parSeg: Record<string, number> = {};
    for (const p of leads) parSeg[p.segment ?? "autre"] = (parSeg[p.segment ?? "autre"] ?? 0) + 1;
    return parSeg;
  }, [leads]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (!canAccessProspection) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="sticky top-0 z-[1100] flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
      >
        <Link to="/prospection" aria-label="Retour à la prospection"
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-base font-semibold sm:text-lg">Ma carte</h1>
          <p className="truncate text-xs text-muted-foreground">
            {chargement ? "Chargement…" : `${leads.length} lead${leads.length > 1 ? "s" : ""} · parc installé autour`}
          </p>
        </div>
        <Button
          size="sm" variant={voirParc ? "default" : "outline"} className="gap-1.5"
          onClick={() => setVoirParc((v) => !v)}
          title="Afficher ou masquer les salles d'arcade et cabines photo autour"
        >
          <Gamepad2 className="h-4 w-4" />
          <span className="hidden sm:inline">Parc installé</span>
        </Button>
      </header>

      <div className="relative flex-1">
        <div ref={mapEl} className="absolute inset-0" style={{ background: "#eef2f6" }} />

        {/* Aucun lead : la carte reste utile (le parc s'affiche), mais on le dit. */}
        {!chargement && leads.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-[1000] flex justify-center px-4">
            <div className="pointer-events-auto max-w-sm rounded-lg border border-border bg-background/95 p-3 text-center text-sm shadow-lg backdrop-blur">
              <MapPin className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />
              Aucun lead ne t'est encore attribué. Ils apparaîtront ici dès que la
              distribution t'en confie. En attendant, le parc installé te montre le marché.
            </div>
          </div>
        )}

        {/* Légende compacte : à quoi correspondent les couleurs des leads. */}
        {leads.length > 0 && (
          <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-border bg-background/90 p-2.5 text-[11px] shadow-lg backdrop-blur">
            {Object.entries(parReglages).sort((a, b) => b[1] - a[1]).map(([seg, n]) => (
              <div key={seg} className="flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: couleurSeg(seg) }} />
                <span className="capitalize text-muted-foreground">{seg}</span>
                <span className="ml-auto font-semibold tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fiche du lead cliqué : ses coordonnées + le brief à générer en un clic. */}
      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent side="right" className="z-[1300] w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-base">{selected.entreprise ?? "Lead"}</SheetTitle>
              </SheetHeader>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {selected.ville && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{selected.ville}</span>}
                  {selected.segment && <Badge variant="outline" className="capitalize">{selected.segment}</Badge>}
                  {selected.statut && <Badge variant="secondary">{selected.statut}</Badge>}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selected.telephone && (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a href={`tel:${selected.telephone}`}><Phone className="h-4 w-4" />{selected.telephone}</a>
                    </Button>
                  )}
                  {selected.email && (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a href={`mailto:${selected.email}`}><Mail className="h-4 w-4" />Écrire</a>
                    </Button>
                  )}
                </div>
                {!selected.telephone && !selected.email && (
                  <p className="text-xs text-muted-foreground">Pas encore de coordonnée sur cette fiche.</p>
                )}

                {/* Le brief : ce qui fait gagner du temps avant de décrocher. */}
                <div className="border-t border-border pt-3">
                  <BriefFiche prospectId={selected.id} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

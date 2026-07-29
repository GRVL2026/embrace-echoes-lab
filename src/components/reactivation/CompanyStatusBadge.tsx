import { CheckCircle2, AlertTriangle, Archive } from "lucide-react";

export type CompanyStatusProps = {
  etat_administratif?: string | null;
  procedure_collective?: boolean | null;
  archive?: boolean | null;
  compact?: boolean;
};

/**
 * Retourne un état canonique : archive | cessee | procedure | active | inconnu
 * "Cessée" prime sur "procédure" (INSEE fait foi).
 */
export function resolveCompanyStatus(p: CompanyStatusProps) {
  if (p.archive) return "archive" as const;
  const etat = (p.etat_administratif || "").trim().toLowerCase();
  const cessee = etat === "c" || etat.startsWith("cess") || etat.startsWith("ferm");
  if (cessee) return "cessee" as const;
  if (p.procedure_collective) return "procedure" as const;
  const actif = etat === "a" || etat.startsWith("actif");
  if (actif) return "active" as const;
  return "inconnu" as const;
}

export function CompanyStatusBadge(p: CompanyStatusProps) {
  const s = resolveCompanyStatus(p);
  if (s === "inconnu") return null;
  const map = {
    archive: {
      cls: "bg-slate-500/15 text-slate-400 border-slate-500/30",
      icon: Archive,
      label: "Compte archivé",
    },
    cessee: {
      cls: "bg-rose-500/15 text-rose-500 border-rose-500/30",
      icon: AlertTriangle,
      label: "Société cessée",
    },
    procedure: {
      cls: "bg-amber-500/15 text-amber-500 border-amber-500/30",
      icon: AlertTriangle,
      label: "Procédure collective",
    },
    active: {
      cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
      icon: CheckCircle2,
      label: "Société active",
    },
  }[s];
  const Icon = map.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${map.cls}`}
    >
      <Icon className="h-3 w-3" />
      {!p.compact && map.label}
    </span>
  );
}

/** Version HTML pour les popups Leaflet (pas de React). */
export function companyStatusPopupHtml(p: CompanyStatusProps): string {
  const s = resolveCompanyStatus(p);
  if (s === "inconnu") return "";
  const styles: Record<string, string> = {
    archive: "background:#64748b22;color:#94a3b8;border:1px solid #64748b55",
    cessee: "background:#f43f5e22;color:#f43f5e;border:1px solid #f43f5e55",
    procedure: "background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b55",
    active: "background:#10b98122;color:#10b981;border:1px solid #10b98155",
  };
  const labels: Record<string, string> = {
    archive: "🗄 Compte archivé",
    cessee: "⚠ Société cessée",
    procedure: "⚠ Procédure collective",
    active: "✅ Société active",
  };
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:500;${styles[s]}">${labels[s]}</span>`;
}

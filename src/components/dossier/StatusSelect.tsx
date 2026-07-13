import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

export type DossierStatus = "draft" | "sent" | "won" | "lost";

export const STATUS_LABEL: Record<DossierStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  won: "Gagné",
  lost: "Perdu",
};

// Tailwind classes for the status dot
export const STATUS_DOT: Record<DossierStatus, string> = {
  draft: "bg-muted-foreground",
  sent: "bg-blue-500",
  won: "bg-emerald-500",
  lost: "bg-destructive",
};

export const STATUS_BADGE: Record<DossierStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  sent: "bg-blue-500/15 text-blue-400 border-blue-500/40",
  won: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  lost: "bg-destructive/15 text-destructive border-destructive/40",
};

export function normalizeStatus(s: string | null | undefined): DossierStatus {
  if (s === "sent" || s === "won" || s === "lost") return s;
  return "draft";
}

export function StatusDot({ status, className = "" }: { status: DossierStatus | string | null | undefined; className?: string }) {
  const s = normalizeStatus(status as any);
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]} ${className}`} />;
}

export function StatusBadge({ status }: { status: DossierStatus | string | null | undefined }) {
  const s = normalizeStatus(status as any);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} />
      {STATUS_LABEL[s]}
    </span>
  );
}

/** Updates projects.status in the DB. Returns true on success. */
export async function updateProjectStatus(projectId: string, status: DossierStatus): Promise<boolean> {
  const { error } = await (supabase as any)
    .from("projects")
    .update({ status })
    .eq("id", projectId);
  if (error) {
    toast({ title: "Statut non mis à jour", description: error.message, variant: "destructive" });
    return false;
  }
  return true;
}

/** If the project is still in draft, flip it to 'sent'. Returns the effective status. */
export async function markSentIfDraft(
  projectId: string,
  currentStatus: string | null | undefined,
): Promise<DossierStatus> {
  const s = normalizeStatus(currentStatus);
  if (s !== "draft") return s;
  const ok = await updateProjectStatus(projectId, "sent");
  return ok ? "sent" : s;
}

export function StatusSelect({
  value,
  onChange,
  disabled,
  className = "",
  size = "md",
}: {
  value: string | null | undefined;
  onChange: (next: DossierStatus) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const s = normalizeStatus(value);
  const triggerCls =
    size === "sm"
      ? "h-8 min-w-[140px] text-xs"
      : "h-9 min-w-[160px] text-sm";
  return (
    <Select
      value={s}
      disabled={disabled || busy}
      onValueChange={async (v) => {
        setBusy(true);
        try {
          await onChange(v as DossierStatus);
        } finally {
          setBusy(false);
        }
      }}
    >
      <SelectTrigger className={`${triggerCls} ${className}`}>
        <span className="flex items-center gap-2">
          <StatusDot status={s} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATUS_LABEL) as DossierStatus[]).map((k) => (
          <SelectItem key={k} value={k}>
            <span className="flex items-center gap-2">
              <StatusDot status={k} />
              {STATUS_LABEL[k]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

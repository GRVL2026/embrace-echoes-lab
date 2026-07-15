import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Ajoute un paramètre width à une URL d'image Shopify CDN pour
 * bénéficier du redimensionnement à la volée. Gère les URLs qui ont
 * déjà des paramètres (?v=...) en ajoutant proprement & ou ?.
 */
export function shopifyThumb(url: string | null | undefined, width = 480): string | null {
  if (!url) return null;
  if (/[?&]width=\d+/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}width=${width}`;
}

export type StockErpBadge = {
  tone: "ok" | "warning" | "unknown";
  color: string;
  label: string;
  short: string;
};

/**
 * Pastille de stock à partir de stock_erp et cegid_code :
 *   🟢 En stock (N)   si stock_erp > 0
 *   🟠 Sur commande   si stock_erp = 0
 *   ⚪ Stock inconnu  si non lié à l'ERP (cegid_code null)
 */
export function stockErpBadge(
  stockErp: number | null | undefined,
  cegidCode: string | null | undefined,
): StockErpBadge {
  if (!cegidCode || !String(cegidCode).trim()) {
    return { tone: "unknown", color: "bg-muted-foreground/60", label: "Stock inconnu", short: "?" };
  }
  const n = typeof stockErp === "number" ? stockErp : Number(stockErp ?? 0);
  if (Number.isFinite(n) && n > 0) {
    return { tone: "ok", color: "bg-emerald-500", label: `En stock (${n})`, short: String(n) };
  }
  return { tone: "warning", color: "bg-orange-500", label: "Sur commande", short: "•" };
}

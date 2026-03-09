import { toast } from "sonner";
import type { GameEquipment } from "@/types/equipment";
import { DEFAULT_SAFETY_ZONE } from "@/types/equipment";


// Color palette for equipment categories
const CATEGORY_COLORS: Record<string, string> = {
  "arcade": "hsl(263, 85%, 68%)",
  "flipper": "hsl(75, 100%, 45%)",
  "flippers": "hsl(75, 100%, 45%)",
  "billard": "hsl(200, 80%, 50%)",
  "babyfoot": "hsl(30, 90%, 55%)",
  "flechettes": "hsl(0, 70%, 55%)",
  "simulateur": "hsl(180, 70%, 50%)",
  "sport": "hsl(142, 76%, 45%)",
  "tir": "hsl(0, 85%, 55%)",
  "jeux famille": "hsl(280, 70%, 60%)",
  "grues & distributeurs": "hsl(45, 90%, 50%)",
  "réalité virtuelle": "hsl(200, 90%, 55%)",
  "adresse": "hsl(330, 70%, 55%)",
  "jeux de conduite": "hsl(15, 85%, 55%)",
  "default": "hsl(48, 100%, 50%)",
};

function getCategoryColor(category: string): string {
  const key = category.toLowerCase();
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.default;
}

/** Parse dimensions like "L 1030 x P 2500 x H 2640 mm" or "35X22X12" */
function parseDimensions(dimStr: string): { width: number; depth: number; height: number } | null {
  if (!dimStr?.trim()) return null;
  const s = dimStr.trim();

  // Pattern: "L 1030 x P 2500 x H 2640" (mm → cm)
  const lph = s.match(/L\s*[:\s]*(\d+)\s*[x×\s]+P\s*[:\s]*(\d+)\s*[x×\s]+H\s*[:\s]*(\d+)/i);
  if (lph) {
    return { width: parseInt(lph[1], 10) / 10, depth: parseInt(lph[2], 10) / 10, height: parseInt(lph[3], 10) / 10 };
  }

  // Pattern: "NNNxNNNxNNN" (assumed cm)
  const plain = s.match(/(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(\d+)/);
  if (plain) {
    return { width: parseInt(plain[1], 10), depth: parseInt(plain[2], 10), height: parseInt(plain[3], 10) };
  }

  return null;
}

interface ShopifyAdminProduct {
  id: string;
  title: string;
  description: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  price: string;
  currency: string;
  images: string[];
  metafields: Record<string, string>;
}

function shopifyProductToEquipment(product: ShopifyAdminProduct): GameEquipment {
  // Try to find dimensions from metafields (various possible keys)
  let dims: { width: number; depth: number; height: number } | null = null;

  // Search all metafields for dimension data
  for (const [key, value] of Object.entries(product.metafields)) {
    if (key.toLowerCase().includes("dimension") || key.toLowerCase().includes("size") || key.toLowerCase().includes("taille")) {
      dims = parseDimensions(value);
      if (dims) break;
    }
  }

  // Fallback: try to extract from description HTML
  if (!dims && product.description) {
    // Strip HTML tags for parsing
    const textDesc = product.description.replace(/<[^>]*>/g, " ");
    dims = parseDimensions(textDesc);
  }

  const price = parseFloat(product.price);
  const category = product.productType || "autre";

  // Extract specs from metafields
  const findMeta = (keyword: string) => {
    for (const [key, value] of Object.entries(product.metafields)) {
      if (key.toLowerCase().includes(keyword)) return value;
    }
    return undefined;
  };

  return {
    id: product.handle,
    name: product.title,
    category,
    width: dims?.width || 100,
    depth: dims?.depth || 100,
    height: dims?.height || 200,
    safetyZone: DEFAULT_SAFETY_ZONE,
    color: getCategoryColor(category),
    description: product.description || undefined,
    vendor: product.vendor || undefined,
    price: price > 0 ? price : undefined,
    images: product.images.length > 0 ? product.images : undefined,
    tags: product.tags.length > 0 ? product.tags : undefined,
    warranty: findMeta("warranty") || findMeta("garantie"),
    specs: {
      power: findMeta("power") || findMeta("puissance"),
      screen: findMeta("screen") || findMeta("ecran") || findMeta("écran"),
      capacity: findMeta("capacity") || findMeta("capacit") || findMeta("joueur"),
      tickets: (() => {
        const v = findMeta("ticket");
        if (!v) return undefined;
        return v.toLowerCase() === "oui" ? true : v.toLowerCase() === "non" ? false : undefined;
      })(),
    },
  };
}

/**
 * Fetch all products from Shopify via Admin API edge function.
 * Returns GameEquipment[] ready for the catalog.
 */
export async function fetchShopifyCatalog(searchQuery?: string): Promise<GameEquipment[]> {
  const params = new URLSearchParams();
  if (searchQuery?.trim()) params.set("query", searchQuery.trim());

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/shopify-catalog${params.toString() ? `?${params}` : ""}`;
  
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Erreur ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(result.error);
  }

  const products: ShopifyAdminProduct[] = result.products || [];
  return products.map(shopifyProductToEquipment);
}

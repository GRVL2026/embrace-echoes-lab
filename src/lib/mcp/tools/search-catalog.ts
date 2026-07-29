import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "search_catalog",
  title: "Rechercher dans le catalogue produits",
  description:
    "Recherche des produits actifs dans le catalogue Arcade OS par nom ou catégorie (bornes d'arcade, flippers, etc.).",
  inputSchema: {
    query: z.string().trim().min(1).describe("Terme de recherche (nom ou catégorie du produit)."),
    limit: z.number().int().min(1).max(50).optional().describe("Nombre max de résultats (défaut 15)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Non authentifié." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("catalog_products")
      .select("id, name, category, price, description")
      .eq("active", true)
      .or(`name.ilike.%${query}%,category.ilike.%${query}%`)
      .limit(limit ?? 15);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { products: data ?? [] },
    };
  },
});

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
  name: "list_dossiers",
  title: "Lister les dossiers commerciaux",
  description:
    "Liste les dossiers commerciaux visibles par l'utilisateur connecté (Arcade OS). Renvoie id, titre, client, statut et date de mise à jour.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Nombre max de dossiers (défaut 20)."),
    statut: z.string().optional().describe("Filtre optionnel par statut exact."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, statut }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Non authentifié." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("dossiers")
      .select("id, titre, client_nom, statut, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);
    if (statut) q = q.eq("statut", statut);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { dossiers: data ?? [] },
    };
  },
});

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
  name: "list_prospects",
  title: "Lister les prospects",
  description:
    "Liste les prospects visibles par l'utilisateur (module Prospection). Filtre optionnel par statut ou segment.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Nombre max (défaut 25)."),
    statut: z.string().optional().describe("Statut kanban (ex: 'nouveau', 'contacte', 'chaud')."),
    segment: z.string().optional().describe("Segment: 'loisirs', 'chr', 'retail'..."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, statut, segment }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Non authentifié." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("prospects")
      .select(
        "id, entreprise, contact_nom, segment, statut, ville:adresse, lgm_status, pret_a_envoyer, updated_at:created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (statut) q = q.eq("statut", statut);
    if (segment) q = q.eq("segment", segment);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { prospects: data ?? [] },
    };
  },
});

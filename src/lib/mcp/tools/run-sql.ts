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
  name: "run_sql",
  title: "Exécuter une requête SQL (lecture seule)",
  description:
    "Exécute une requête SQL en lecture seule (SELECT / WITH) sur la base Arcade OS. Passe par la fonction gaia_query : les mots-clés d'écriture (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, GRANT, TRUNCATE) sont refusés, timeout 8s, résultat tronqué à 500 lignes. Lecture exécutée sous le rôle technique copilot_readonly (périmètre restreint aux tables et vues qui lui sont explicitement accordées). Réservé aux profils admin et direction.",
  inputSchema: {
    sql: z
      .string()
      .min(1)
      .describe("Requête SQL commençant par SELECT ou WITH. Utilise LIMIT et agrège quand possible."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ sql }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Non authentifié." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const [{ data: adminOk }, { data: dirOk }] = await Promise.all([
      supabase.rpc("is_admin"),
      supabase.rpc("is_direction"),
    ]);
    if (adminOk !== true && dirOk !== true) {
      return {
        content: [{ type: "text", text: "Réservé aux profils admin et direction." }],
        isError: true,
      };
    }
    const { data, error } = await supabase.rpc("gaia_query", { sql_query: sql });
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    // gaia_query renvoie soit un tableau JSON, soit { error } ou { rows, truncated }
    if (data && typeof data === "object" && !Array.isArray(data) && "error" in (data as any)) {
      return {
        content: [{ type: "text", text: String((data as any).error) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { result: data },
    };
  },
});

import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listDossiersTool from "./tools/list-dossiers";
import searchCatalogTool from "./tools/search-catalog";
import listProspectsTool from "./tools/list-prospects";

// The OAuth issuer MUST be the direct Supabase host, built from the project ref
// (Vite inlines VITE_SUPABASE_PROJECT_ID at build time, so this stays import-safe).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "arcade-os-mcp",
  title: "Arcade OS",
  version: "0.1.0",
  instructions:
    "Outils Arcade OS (Avranches Automatic) : lister les dossiers commerciaux, chercher dans le catalogue produits, lister les prospects. Chaque appel s'exécute au nom de l'utilisateur connecté (RLS Supabase).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listDossiersTool, searchCatalogTool, listProspectsTool],
});

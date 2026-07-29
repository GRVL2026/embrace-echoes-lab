import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mcpPlugin(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      filename: "sw.js",
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Précache uniquement le manifest et les icônes — aucune coquille d'app ni JS/CSS.
        // Les navigations et assets applicatifs passent directement par le réseau.
        globPatterns: ["manifest.webmanifest", "*.png", "*.ico", "*.svg"],
        globIgnores: ["**/node_modules/**"],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        importScripts: ["/push-sw.js"],
        runtimeCaching: [],
      },
    }),

  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

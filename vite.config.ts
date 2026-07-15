import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

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
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/d\//, /\/functions\/v1\//, /\/rest\/v1\//, /\/auth\/v1\//, /\/realtime\/v1\//, /\/storage\/v1\//],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        importScripts: ["/push-sw.js"],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              !url.pathname.startsWith("/functions/") &&
              !url.pathname.startsWith("/rest/") &&
              !url.pathname.startsWith("/auth/") &&
              !url.pathname.startsWith("/storage/") &&
              !url.pathname.startsWith("/realtime/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "html-nav",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: ({ request, sameOrigin, url }) =>
              sameOrigin &&
              ["style", "script", "worker", "font", "image"].includes(request.destination) &&
              !url.pathname.startsWith("/functions/") &&
              !url.pathname.startsWith("/rest/") &&
              !url.pathname.startsWith("/auth/") &&
              !url.pathname.startsWith("/storage/") &&
              !url.pathname.startsWith("/realtime/"),
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),

  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

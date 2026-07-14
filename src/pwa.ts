// Guarded PWA registration — never registers in dev, preview or iframe.
import { registerSW } from "virtual:pwa-register";

const SW_URL = "/sw.js";

function isPreviewHost(host: string): boolean {
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

async function unregisterMatching() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          return url.endsWith(SW_URL);
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* ignore */
  }
}

export function setupPWA() {
  if (typeof window === "undefined") return;

  const inIframe = window.self !== window.top;
  const host = window.location.hostname;
  const swOff = new URLSearchParams(window.location.search).get("sw") === "off";

  if (!import.meta.env.PROD || inIframe || isPreviewHost(host) || swOff) {
    void unregisterMatching();
    return;
  }

  registerSW({ immediate: true });
}

// Helper partagé pour l'auto-invocation d'edge functions en tranches.
//
// Historique : les schedulers pg_cron déclenchent une fonction via net.http_post.
// Quand cette fonction se rappelle elle-même via un `fetch(...)` fire-and-forget
// avant de retourner la réponse, l'Edge Runtime peut couper la promesse
// détachée dès que la réponse du parent est envoyée : la chaîne s'arrête.
//
// La solution est d'enregistrer la promesse via `EdgeRuntime.waitUntil` afin
// que le runtime la garde vivante après le return.
//
// Ce helper est utilisé aussi bien par la synchro Cegid nocturne
// (`cegid-sync`) que par la veille marché (`veille-marche`) pour garantir
// que la chaîne d'appels ne diverge pas.

export function scheduleSelfInvoke(
  functionName: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    console.error(`[selfInvoke] SUPABASE_URL manquant, ${functionName} non relancé.`);
    return Promise.resolve();
  }
  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  const controller = new AbortController();
  // Le fetch doit avoir un timeout d'initiation raisonnable (le temps de
  // l'envoi, PAS de la réponse complète — 202 est renvoyé quasi immédiatement
  // par la cible qui elle-même waitUntil).
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  const promise: Promise<void> = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (r) => {
      let text = "";
      try { text = await r.text(); } catch { /* ignore */ }
      console.log(
        `[selfInvoke] ${functionName} → HTTP ${r.status} ${text.slice(0, 160)}`,
      );
    })
    .catch((e: any) => {
      const msg = e?.name === "AbortError" ? "abort" : (e?.message ?? String(e));
      console.error(`[selfInvoke] ${functionName} erreur: ${msg}`);
    })
    .finally(() => clearTimeout(timeoutId));

  try {
    // @ts-ignore EdgeRuntime est fourni par l'Edge Runtime Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(promise);
    }
  } catch {
    /* environnements sans EdgeRuntime (tests) : on laisse la promesse tourner */
  }

  return promise;
}

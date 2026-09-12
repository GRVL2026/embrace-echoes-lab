// Arcade Planner — passe photoréaliste d'une vue de salle (composite -> Krea nano-banana-pro).
//
// Le navigateur construit le COMPOSITE (salle en perspective + sprites des machines à l'échelle)
// et l'envoie ici en base64. Cette edge ne fait que la passe IA : upload chez Krea, génération,
// puis stockage du rendu dans le bucket planner-media (service_role) et renvoi de l'URL publique.
// La clé Krea ne quitte jamais le serveur. Pattern identique à Arcade Studio (api.krea.ai).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireRole } from "../_shared/require-role.ts";

const KREA_BASE = "https://api.krea.ai";
const MODELE = "image/google/nano-banana-pro";
const KEY = Deno.env.get("KREA_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Prompt validé le 11/09 (passation §3) — deux blocs : ce qui est interdit, puis autorisé.
const PROMPT = `This image is a 3D layout mockup of an arcade game room. Turn it into a photorealistic architectural interior photograph.

ABSOLUTE RULE — DO NOT MODIFY THE ARCADE MACHINES. Keep every machine exactly as it is: same models, same positions, same sizes, same proportions, same orientation, same cabinet artwork, same colors, same screen content, same count. Do not add, remove, move, resize, rotate or redesign any machine. Do not alter any logo, sticker or graphic printed on the cabinets. You may only sharpen and relight their surfaces so they look like real photographed machines.

ONLY transform the empty room around them: raw exposed concrete walls, smooth polished concrete floor, 3.5 m ceiling, industrial black-painted ceiling structure with suspended linear light fixtures. Add realistic lighting: soft ambient light plus the colored glow the machines cast onto the floor and nearby walls, subtle reflections of the neon cabinets on the polished floor, realistic soft contact shadows under each machine, gentle vignetting and natural photographic grain. Shot on a 24 mm lens at f/4, professional interior photography, crisp and high detail, photorealistic.`;

const j = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** base64 (avec ou sans préfixe data:) -> octets. */
function b64ToBytes(s: string): Uint8Array {
  const raw = s.includes(",") ? s.slice(s.indexOf(",") + 1) : s;
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Cherche une URL d'image dans une réponse Krea de forme variable. */
function trouverUrl(o: any): string | null {
  if (!o) return null;
  if (typeof o === "string" && /^https?:\/\//.test(o)) return o;
  const cands = [o.image_url, o.url, o.output, o.result, o.images, o.output_url,
    o?.data?.image_url, o?.data?.url, o?.output?.[0], o?.images?.[0], o?.result?.[0]];
  for (const c of cands) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return c;
    if (Array.isArray(c) && typeof c[0] === "string" && /^https?:\/\//.test(c[0])) return c[0];
    if (c && typeof c === "object") {
      const u = c.url ?? c.image_url;
      if (typeof u === "string" && /^https?:\/\//.test(u)) return u;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireRole(req, ["admin", "direction", "chef_ventes", "commercial", "prospection"]);
  if (!gate.ok) return gate.response;
  if (!KEY) return j({ ok: false, error: "Secret KREA_API_KEY manquant côté Supabase." });

  const kh = { Authorization: `Bearer ${KEY}` };
  try {
    const body = await req.json().catch(() => ({}));
    const image_base64 = body?.image_base64 as string | undefined;
    const projectId = (body?.project_id as string | undefined) ?? "plan";
    if (!image_base64) return j({ ok: false, error: "image_base64 (le composite) est requis." });

    // 1) URL de dépôt présignée + dépôt du composite (multipart).
    const up = await fetch(`${KREA_BASE}/get_upload_url`, {
      method: "POST", headers: { ...kh, "Content-Type": "application/json" }, body: "{}",
    });
    const upTxt = await up.text();
    if (!up.ok) return j({ ok: false, error: `Krea get_upload_url ${up.status}`, detail: upTxt.slice(0, 300) });
    const upData = JSON.parse(upTxt || "{}");
    const uploadUrl = upData.upload_url ?? upData.url ?? upData?.data?.upload_url;
    if (!uploadUrl) return j({ ok: false, error: "Krea n'a pas renvoyé d'URL de dépôt.", detail: upTxt.slice(0, 300) });

    const form = new FormData();
    form.append("file", new Blob([b64ToBytes(image_base64)], { type: "image/png" }), "composite.png");
    const dep = await fetch(uploadUrl, { method: "POST", body: form });
    const depTxt = await dep.text();
    if (!dep.ok) return j({ ok: false, error: `Krea dépôt image ${dep.status}`, detail: depTxt.slice(0, 300) });
    const depData = JSON.parse(depTxt || "{}");
    const sourceUrl = depData.url ?? depData.file_url ?? depData?.data?.url ?? trouverUrl(depData);
    if (!sourceUrl) return j({ ok: false, error: "Krea n'a pas renvoyé l'URL du fichier déposé.", detail: depTxt.slice(0, 300) });

    // 2) Soumission de la génération (asynchrone).
    const gen = await fetch(`${KREA_BASE}/generate/${MODELE}`, {
      method: "POST", headers: { ...kh, "Content-Type": "application/json" },
      body: JSON.stringify({ image_urls: [sourceUrl], prompt: PROMPT, aspect_ratio: "16:9", resolution: "2K" }),
    });
    const genTxt = await gen.text();
    if (!gen.ok) return j({ ok: false, error: `Krea generate ${gen.status}`, detail: genTxt.slice(0, 300) });
    const genData = JSON.parse(genTxt || "{}");
    const jobId = genData.job_id ?? genData.id;
    if (!jobId) return j({ ok: false, error: "Krea n'a pas renvoyé de job_id.", detail: genTxt.slice(0, 300) });

    // 3) Polling (~3 s, max ~40 essais = 2 min ; nano-banana-pro ~30-45 s).
    let resultUrl: string | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await fetch(`${KREA_BASE}/jobs/${jobId}`, { headers: kh });
      const stTxt = await st.text();
      if (!st.ok) continue;
      const stData = JSON.parse(stTxt || "{}");
      const status = String(stData.status ?? stData.state ?? "").toLowerCase();
      if (status.includes("fail") || status.includes("error")) {
        return j({ ok: false, error: "Krea : génération échouée.", detail: stTxt.slice(0, 300) });
      }
      const u = trouverUrl(stData);
      if (u && (status.includes("complet") || status.includes("succ") || status.includes("done") || status.includes("finish") || !status)) {
        resultUrl = u; break;
      }
    }
    if (!resultUrl) return j({ ok: false, error: "Krea : délai dépassé, la vue n'était pas prête." });

    // 4) Téléchargement du rendu + stockage dans le bucket (service_role).
    const img = await fetch(resultUrl);
    const bytes = new Uint8Array(await img.arrayBuffer());
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const path = `vues/${projectId}-${crypto.randomUUID()}.png`;
    const { error: upErr } = await admin.storage.from("planner-media").upload(path, bytes, {
      contentType: "image/png", upsert: true,
    });
    if (upErr) return j({ ok: false, error: "Stockage de la vue échoué : " + upErr.message, source: resultUrl });
    const { data: pub } = admin.storage.from("planner-media").getPublicUrl(path);

    return j({ ok: true, url: pub.publicUrl, source: resultUrl });
  } catch (e: any) {
    return j({ ok: false, error: e?.message || String(e) });
  }
});

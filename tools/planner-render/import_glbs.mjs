#!/usr/bin/env node
// Importe des GLB reconstruits dans Arcade OS : upload dans le bucket "models-3d" + rattache
// à la fiche produit (catalog_products.model3d, par NOM). À lancer UNE fois, en local.
// Sans dépendance : Node 18+ suffit (fetch intégré). Pas besoin de npm install.
//
//   export SUPABASE_URL="https://yhfghipueqfkgysaulvl.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="..."   # Supabase → Project Settings → API → service_role (secret)
//   node tools/planner-render/import_glbs.mjs
//
// Lit glbs_a_importer.json : [{ "name": "<nom exact catalogue>", "file": "<chemin local .glb>", "rotation": 0 }]

import { readFileSync } from "node:fs";

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("❌ Définis d'abord SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (voir en-tête du script).");
  process.exit(1);
}
if (typeof fetch !== "function") {
  console.error("❌ Node trop ancien : il faut Node 18 ou plus (commande `node -v`).");
  process.exit(1);
}

const BUCKET = "models-3d";
const items = JSON.parse(readFileSync(new URL("./glbs_a_importer.json", import.meta.url)));
const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let ok = 0, fail = 0;
for (const it of items) {
  try {
    const bytes = readFileSync(it.file);
    const path = `reconstruits/${slug(it.name)}.glb`;

    // 1) Upload du fichier dans le bucket (service_role, upsert).
    const up = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "model/gltf-binary", "x-upsert": "true" },
      body: bytes,
    });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 150)}`);
    const publicUrl = `${BASE}/storage/v1/object/public/${BUCKET}/${path}`;

    // 2) Rattachement à la fiche (par nom).
    const patch = await fetch(`${BASE}/rest/v1/catalog_products?name=eq.${encodeURIComponent(it.name)}`, {
      method: "PATCH",
      headers: {
        apikey: KEY, Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify({ model3d: publicUrl, model3d_rotation: it.rotation ?? 0 }),
    });
    if (!patch.ok) throw new Error(`update ${patch.status} ${(await patch.text()).slice(0, 150)}`);
    const rows = await patch.json();
    console.log(`✅ ${it.name} → ${publicUrl}  (${rows.length} fiche(s) mise(s) à jour${rows.length === 0 ? " ⚠️ nom introuvable" : ""})`);
    ok++;
  } catch (e) {
    console.error(`❌ ${it.name} : ${e.message || e}`);
    fail++;
  }
}
console.log(`\nTerminé — ${ok} importé(s), ${fail} échec(s).`);

#!/usr/bin/env node
// Importe des GLB reconstruits dans Arcade OS : upload dans le bucket "models-3d" + rattache
// à la fiche produit (catalog_products.model3d, par NOM). À lancer UNE fois, en local, avec la
// clé service-role (elle reste sur ta machine, jamais dans le code).
//
//   export SUPABASE_URL="https://yhfghipueqfkgysaulvl.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="..."   # Supabase → Project Settings → API → service_role (secret)
//   node tools/planner-render/import_glbs.mjs
//
// Lit glbs_a_importer.json : [{ "name": "<nom exact catalogue>", "file": "<chemin local .glb>", "rotation": 0 }]

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("❌ Définis d'abord SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (voir en-tête du script).");
  process.exit(1);
}

const BUCKET = "models-3d";
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const items = JSON.parse(readFileSync(new URL("./glbs_a_importer.json", import.meta.url)));

const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let ok = 0, fail = 0;
for (const it of items) {
  try {
    const bytes = readFileSync(it.file);
    const path = `reconstruits/${slug(it.name)}.glb`;
    const up = await sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: "model/gltf-binary", upsert: true,
    });
    if (up.error) throw up.error;
    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const upd = await sb.from("catalog_products")
      .update({ model3d: publicUrl, model3d_rotation: it.rotation ?? 0 })
      .eq("name", it.name).select("id");
    if (upd.error) throw upd.error;
    const n = upd.data?.length ?? 0;
    console.log(`✅ ${it.name} → ${publicUrl}  (${n} fiche(s) mise(s) à jour${n === 0 ? " ⚠️ nom introuvable" : ""})`);
    ok++;
  } catch (e) {
    console.error(`❌ ${it.name} : ${e.message || e}`);
    fail++;
  }
}
console.log(`\nTerminé — ${ok} importé(s), ${fail} échec(s).`);

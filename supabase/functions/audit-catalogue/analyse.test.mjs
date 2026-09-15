// Test du parseur de cotes et du détecteur d'incohérences entre variantes.
//
//   node analyse.test.mjs
//
// Node 24 exécute le TypeScript directement, aucune dépendance à installer. Les cas ne sont
// pas inventés : ce sont les écritures réellement relevées sur les 350 produits actifs du
// catalogue Shopify, plus les cotes réelles des variantes DX/STD. Toute nouvelle écriture
// rencontrée en production doit être ajoutée ici AVANT d'être corrigée dans le parseur.
import { analyser, incoherencesVariantes } from "./analyse.ts";

let ko = 0, n = 0;
const chk = (label, got, want) => {
  n++;
  const ok = got === want;
  if (!ok) ko++;
  console.log(`${ok ? "ok  " : "ÉCHEC"} ${label.padEnd(56)} -> ${String(got).padEnd(20)} ${ok ? "" : `attendu ${want}`}`);
};

// ── 1. Les treize écritures réellement relevées sur les 350 produits actifs ───────────────
console.log("\n— notations réelles du catalogue —");
const cas = [
  ["L 705 x P 1450 x H 1980 mm",                            null],              // canonique (tous les flippers)
  [" L 1140 x P 2420 x H 2460 mm",                          null],              // espace initial (Hoopla)
  ["L 1377 x P 2134 x H 2143 mm ",                          null],              // espace final (Halo DX)
  ["L 2520 × P 2490 × H 2750 mm",                           null],              // séparateur × (Bikers Madness DX)
  ["L 405 * P 402 * H 765 mm",                              null],              // séparateur * (Hira 2 Maxi + Pax)
  ["L1190 x P 1930 x H 1910 mm",                            null],              // pas d'espace après L
  ["L 1250 x P1600 x H 2290 mm",                            null],              // pas d'espace après P (Flat Top)
  ["L 2470x P 1700 x H 2650 mm",                            null],              // pas d'espace avant x (Raccoon 4P)
  ["L1040 x P2415 x H3580 mm",                              null],              // aucun espace (Emoji Hoops)
  ["Environ L 784 x P 1302 x H 1010 mm en fonction du modèle", null],           // texte autour (Kiddie Ride)
  ["L 1630 x P 1070 x 670 mm",                    "axe_manquant"],              // H sans libellé (Table Gameland/Magic)
  ["P 1070 x L 2540 x H 2280 mm",              "ordre_inhabituel"],              // P avant L (T-rex Park)
  ["L 2110 x P 1190 x H 800/850 mm",                 "intervalle"],              // intervalle (Billard Winner)
  ["72x26x28",                                              null],              // cm nu, toppers Stern
  ["24X15X15",                                              null],              // cm nu, X majuscule (Spike)
  ["55x29x29.5",                                            null],              // cm nu décimal (Bumper Lights)
  ["32x12x13",                                              null],              // shooter knob : 12 cm est normal
  ["66X10X10",                                              null],              // dust cover : 10 cm est normal
];
for (const [v, want] of cas) chk(JSON.stringify(v).slice(0, 54), analyser(v, true).anomalie, want);

// ── 2. Cote absente : signalée seulement si la fiche technique est commencée ──────────────
console.log("\n— cote absente, selon que la fiche technique existe ou non —");
chk("null + aucune autre spec (ballon de basket)",   analyser(null, false).anomalie, null);
chk("null + d'autres specs_* (Angry Birds)",         analyser(null, true).anomalie,  "manquant");
chk('"" + aucune autre spec',                        analyser("", false).anomalie,   null);
chk('"   " + d\'autres specs_*',                     analyser("   ", true).anomalie, "manquant");

// ── 3. Garde-fous : ce qui doit encore être attrapé ───────────────────────────────────────
console.log("\n— saisies aberrantes —");
chk('"Test de taille"',                  analyser("Test de taille", true).anomalie, "illisible");
chk('"à confirmer"',                     analyser("à confirmer", true).anomalie,    "illisible");
chk('"L 12 x P 1450 x H 1980 mm"',       analyser("L 12 x P 1450 x H 1980 mm", true).anomalie, "hors_plage");
chk('"L 70500 x P 1450 x H 1980 mm"',    analyser("L 70500 x P 1450 x H 1980 mm", true).anomalie, "hors_plage");
chk('"5x3x2" (cm, sous la bande)',       analyser("5x3x2", true).anomalie,          "hors_plage");
chk('"L 1630 x P 1070 mm" (H absent)',   analyser("L 1630 x P 1070 mm", true).anomalie, "axe_manquant");

// ── 4. Valeurs converties ────────────────────────────────────────────────────────────────
console.log("\n— conversion —");
const t = analyser("72x26x28", true);
chk("72x26x28 -> largeur mm",   t.largeur, 720);
chk("72x26x28 -> notation",     t.notation, "cm");
const m = analyser("P 1070 x L 2540 x H 2280 mm", true);
chk("P avant L -> largeur = 2540", m.largeur, 2540);
chk("P avant L -> profondeur = 1070", m.profondeur, 1070);
const i = analyser("L 2110 x P 1190 x H 800/850 mm", true);
chk("intervalle 800/850 -> hauteur = 850", i.hauteur, 850);

// ── 5. Cohérence des variantes, sur les vraies cotes du catalogue ─────────────────────────
console.log("\n— cohérence des variantes (cotes réelles) —");
const flotte = [
  ["Halo Fireteam Raven Dx",   1377, 2134], ["Halo Fireteam Raven Std", 3480, 3020],
  ["Bikers Madness DX",        2520, 2490], ["Bikers Madness SD",       2540, 2390],
  ["Storm Racer Motion DX",    1730, 2100], ["Storm Racer STD",         1050, 1730],
  ["Fast & Furious STD",       1020, 2360], ["Monster Kart DLX",        1473, 3035],
  ["Monster Kart DLX Twin",    2690, 2360], ["StepManiaX DX",           1900, 2400],
  ["StepManiaX",               1780, 2240], ["Emoji Power Puck Single", 2340, 1525],
  ["Emoji Power Puck Multi",   2340, 1525], ["Ultra Moto Vr Single",    1776, 2152],
  ["Flipper Fallout Pro",       705, 1450], ["Flipper Fallout Premium",  705, 1450],
  ["Flipper Fallout LE",        705, 1450], ["Racing Xtreme DX",        2550, 2810],
  ["Speed Rider 3 DX",         1673, 2257], ["Asphalt 9 DX",            1370, 2160],
  ["Godzilla Kaiju Wars DX",   1530, 2720], ["Jurassic Park Dx",        1350, 2030],
  ["Mario Kart 3 GP DX",       1042, 1601], ["Parkour Motor 2 Dx",      2320, 2140],
  ["Skull Of Shadow 3P",       1620, 2060], ["Skull Of Shadow 4P",      2040, 1460],
  ["Raccoon Rampage 4P",       2470, 1700], ["Raccoon Rampage 2P",      1082, 2451],
].map(([titre, largeur, profondeur]) => ({ titre, largeur, profondeur }));

const inc = incoherencesVariantes(flotte);
chk("nombre d'incohérences détectées", inc.length, 1);
chk("laquelle", inc[0]?.titre, "Halo Fireteam Raven Std");
console.log(`     ↳ ${inc[0]?.detail}`);

console.log(`\n${n - ko}/${n} conformes${ko ? ` — ${ko} ÉCHEC(S)` : ""}`);
process.exit(ko ? 1 : 0);

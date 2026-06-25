/**
 * 2D-only PDF dossier generator (no 3D dependency).
 * Built for projects where not all games have 3D models.
 *
 * Sections:
 *   1. Cover page
 *   2. 2D plan — empty (no games)
 *   3. 2D plan — with games (no distances)
 *   4. 2D plan — with games + distances between games
 *   5. 2D plan — PMR circulation path
 *   6. Equipment catalog (with links to avranchesautomatic.com)
 *   7. Budget (optional) + leasing simulation (optional)
 */
import jsPDF from "jspdf";
import type { EditorState, Room } from "@/types/editor";
import type { GameEquipment } from "@/types/equipment";
import { renderPlan2D } from "./plan2DRender";
import logoImg from "@/assets/logo.png";

/** Load the Arcade Planner logo as a data URL (cached). */
let _logoCache: { dataUrl: string; w: number; h: number } | null | undefined;
async function loadLogo(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (_logoCache !== undefined) return _logoCache;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = logoImg;
    });
    if (!loaded) { _logoCache = null; return null; }
    const c = document.createElement("canvas");
    c.width = loaded.naturalWidth; c.height = loaded.naturalHeight;
    c.getContext("2d")!.drawImage(loaded, 0, 0);
    _logoCache = { dataUrl: c.toDataURL("image/png"), w: loaded.naturalWidth, h: loaded.naturalHeight };
    return _logoCache;
  } catch { _logoCache = null; return null; }
}


const PURPLE = [155, 92, 255] as const;
const GREEN = [173, 255, 0] as const;
const DARK = [6, 6, 25] as const;
const DARK_CARD = [14, 14, 40] as const;
const DARK_SURFACE = [20, 20, 52] as const;
const DARK_MUTED = [30, 30, 65] as const;
const WHITE = [245, 245, 255] as const;
const GRAY = [120, 120, 160] as const;
const LIGHT = [190, 190, 220] as const;

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RGB = readonly [number, number, number];
const setC = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const setF = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const setD = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);

const SITE_BASE = "https://www.avranchesautomatic.com/products/";

export type LeasingTerms = {
  enabled: boolean;
  monthly12?: number;
  monthly24?: number;
  monthly36?: number;
};

export type Dossier2DOptions = {
  planEmpty: boolean;        // 2D plan without games
  planWithGames: boolean;    // 2D plan with games (no distances)
  planWithDistances: boolean;// 2D plan with games + distances
  planPMR: boolean;          // 2D plan with PMR circulation
  equipmentList: boolean;    // catalog of selected games with links
  budget: boolean;           // pricing breakdown
  leasing: LeasingTerms;     // leasing monthly fees (filled by user)
};

function computeRoomArea(room: Room): number {
  if (!room.isClosed) return 0;
  let area = 0;
  const pts = room.points;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2 / 10000;
}

function drawDarkPage(doc: jsPDF) {
  setF(doc, DARK);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function drawGradientBar(doc: jsPDF, x: number, y: number, w: number, h: number, from: RGB, to: RGB) {
  const steps = 40;
  const sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    doc.setFillColor(
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    );
    doc.rect(x + i * sw, y, sw + 0.5, h, "F");
  }
}

function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number, border: RGB = PURPLE) {
  setF(doc, DARK_CARD);
  doc.roundedRect(x, y, w, h, 3, 3, "F");
  doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
  setD(doc, border);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 3, 3, "S");
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
}

function sectionTitle(doc: jsPDF, title: string, subtitle: string, y: number): number {
  setF(doc, GREEN);
  doc.circle(MARGIN + 2, y - 1.5, 1.6, "F");
  doc.setFontSize(18);
  setC(doc, WHITE);
  doc.text(title, MARGIN + 8, y);
  drawGradientBar(doc, MARGIN + 8, y + 2, 60, 0.8, PURPLE, GREEN);
  doc.setFontSize(8.5);
  setC(doc, GRAY);
  doc.text(subtitle, MARGIN + 8, y + 7);
  return y + 14;
}

function addFooter(doc: jsPDF, page: number, logo?: { dataUrl: string; w: number; h: number } | null) {
  setF(doc, DARK_CARD);
  doc.rect(0, PAGE_H - 12, PAGE_W, 12, "F");
  drawGradientBar(doc, 0, PAGE_H - 12, PAGE_W, 0.6, PURPLE, GREEN);
  let cursorX = MARGIN;
  if (logo) {
    const lh = 5;
    const lw = lh * (logo.w / logo.h);
    try { doc.addImage(logo.dataUrl, "PNG", cursorX, PAGE_H - 8.5, lw, lh, undefined, "FAST"); } catch {}
    cursorX += lw + 2;
  }
  doc.setFontSize(7);
  setC(doc, WHITE);
  doc.text("Arcade Planner", cursorX, PAGE_H - 5);
  setC(doc, GRAY);
  doc.text("· Avranches Automatic · Dossier 2D", cursorX + doc.getTextWidth("Arcade Planner") + 1, PAGE_H - 5);
  setC(doc, GREEN);
  doc.text(String(page), PAGE_W - MARGIN, PAGE_H - 5, { align: "right" });
}


function fitImage(doc: jsPDF, dataUrl: string, x: number, y: number, maxW: number, maxH: number) {
  // We rendered at 1800x1200 (ratio 1.5)
  const ratio = 1800 / 1200;
  let w = maxW, h = maxW / ratio;
  if (h > maxH) { h = maxH; w = maxH * ratio; }
  const ox = x + (maxW - w) / 2;
  const oy = y + (maxH - h) / 2;
  doc.addImage(dataUrl, "PNG", ox, oy, w, h, undefined, "FAST");
}

function planPage(
  doc: jsPDF,
  pageNum: { n: number },
  state: EditorState,
  title: string,
  subtitle: string,
  opts: { showGames: boolean; showGapMeasurements: boolean; showCirculation: boolean },
  logo?: { dataUrl: string; w: number; h: number } | null,
) {
  doc.addPage();
  drawDarkPage(doc);
  pageNum.n++;
  const y = sectionTitle(doc, title, subtitle, 24);
  const dataUrl = renderPlan2D(
    state.rooms,
    state.doors,
    state.pillars,
    state.placedEquipments,
    state.circulationPath || [],
    {
      width: 1800,
      height: 1200,
      showGames: opts.showGames,
      showGapMeasurements: opts.showGapMeasurements,
      showCirculation: opts.showCirculation,
      showWallDimensions: true,
    },
  );
  const imgH = PAGE_H - y - 22;
  drawCard(doc, MARGIN, y, CONTENT_W, imgH);
  if (dataUrl) {
    fitImage(doc, dataUrl, MARGIN + 3, y + 3, CONTENT_W - 6, imgH - 6);
  }
  addFooter(doc, pageNum.n, logo);
}



const formatEUR = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);

/** Load an image and return its data URL + natural dimensions (for aspect-ratio preservation). */
async function loadImageMeta(src: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    if (!loaded) return null;
    const canvas = document.createElement("canvas");
    canvas.width = loaded.naturalWidth;
    canvas.height = loaded.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(loaded, 0, 0);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      w: loaded.naturalWidth,
      h: loaded.naturalHeight,
    };
  } catch {
    return null;
  }
}


export async function generate2DDossierPDF(
  state: EditorState,
  catalog: GameEquipment[],
  projectName: string,
  options: Dossier2DOptions,
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageNum = { n: 0 };
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const totalArea = state.rooms.reduce((s, r) => s + computeRoomArea(r), 0);
  const totalBudget = state.placedEquipments.reduce((s, eq) => {
    const c = catalog.find((cc) => cc.id === eq.equipmentId);
    return s + (c?.price || 0);
  }, 0);

  const logo = await loadLogo();

  // ─── Cover ─────────────────────────────────────────
  drawDarkPage(doc);
  pageNum.n = 1;
  drawGradientBar(doc, 0, 0, PAGE_W, 3, GREEN, PURPLE);

  // Brand header: logo + "Arcade Planner"
  let brandX = MARGIN;
  if (logo) {
    const lh = 11;
    const lw = lh * (logo.w / logo.h);
    try { doc.addImage(logo.dataUrl, "PNG", brandX, 14, lw, lh, undefined, "FAST"); } catch {}
    brandX += lw + 3;
  }
  setC(doc, WHITE);
  doc.setFontSize(16);
  doc.text("Arcade", brandX, 22);
  const arcadeW = doc.getTextWidth("Arcade");
  setC(doc, PURPLE);
  doc.text(" Planner", brandX + arcadeW, 22);

  setC(doc, GREEN);
  doc.setFontSize(8);
  doc.text("AVRANCHES AUTOMATIC", MARGIN, 34);
  setC(doc, GRAY);
  doc.setFontSize(10);
  doc.text("DOSSIER PROJET — VUE 2D", MARGIN, 42);
  doc.setFontSize(34);
  setC(doc, WHITE);
  const nameLines = doc.splitTextToSize(projectName.toUpperCase(), CONTENT_W);
  doc.text(nameLines, MARGIN, 64);
  const after = 64 + nameLines.length * 13;
  drawGradientBar(doc, MARGIN, after + 2, 80, 2, GREEN, GREEN);


  // Hero plan preview (always with games if any)
  const heroY = after + 14;
  const heroH = 130;
  drawCard(doc, MARGIN, heroY, CONTENT_W, heroH);
  // (no inner white surface — the dark plan blends with the dossier theme)

  const heroUrl = renderPlan2D(state.rooms, state.doors, state.pillars, state.placedEquipments, state.circulationPath || [], {
    width: 1800, height: 1200, showGames: true, showGapMeasurements: false, showCirculation: false, showWallDimensions: false,
  });
  if (heroUrl) fitImage(doc, heroUrl, MARGIN + 3, heroY + 3, CONTENT_W - 6, heroH - 6);

  // Stat band
  const statsY = PAGE_H - 65;
  drawCard(doc, MARGIN, statsY, CONTENT_W, 45);
  const stats = [
    { l: "Salles", v: String(state.rooms.length) },
    { l: "Équipements", v: String(state.placedEquipments.length) },
    { l: "Surface", v: totalArea > 0 ? `${totalArea.toFixed(1)} m²` : "—" },
  ];
  const sw = CONTENT_W / stats.length;
  stats.forEach((s, i) => {
    const sx = MARGIN + i * sw + sw / 2;
    doc.setFontSize(20);
    setC(doc, i === 1 ? GREEN : PURPLE);
    doc.text(s.v, sx, statsY + 18, { align: "center" });
    doc.setFontSize(8);
    setC(doc, GRAY);
    doc.text(s.l, sx, statsY + 28, { align: "center" });
  });
  doc.setFontSize(7);
  setC(doc, [60, 60, 100]);
  doc.text(dateStr, PAGE_W - MARGIN, PAGE_H - 6, { align: "right" });
  addFooter(doc, pageNum.n, logo);

  // ─── Plans 2D ──────────────────────────────────────
  if (options.planEmpty) {
    planPage(doc, pageNum, state, "Plan 2D — Coque", "Espace nu, sans équipements (cotes des murs).", {
      showGames: false, showGapMeasurements: false, showCirculation: false,
    }, logo);
  }
  if (options.planWithGames) {
    planPage(doc, pageNum, state, "Plan 2D — Implantation", "Disposition des jeux dans l'espace.", {
      showGames: true, showGapMeasurements: false, showCirculation: false,
    }, logo);
  }
  if (options.planWithDistances) {
    planPage(doc, pageNum, state, "Plan 2D — Distances", "Espacements entre jeux et obstacles.", {
      showGames: true, showGapMeasurements: true, showCirculation: false,
    }, logo);
  }
  if (options.planPMR) {
    planPage(doc, pageNum, state, "Plan 2D — Cheminement PMR", "Parcours d'accessibilité dans l'espace.", {
      showGames: true, showGapMeasurements: false, showCirculation: true,
    }, logo);
  }


  // ─── Equipment catalog ─────────────────────────────
  if (options.equipmentList) {
    const usedMap = new Map<string, { eq: GameEquipment; count: number }>();
    state.placedEquipments.forEach((pe) => {
      const c = catalog.find((cc) => cc.id === pe.equipmentId);
      if (!c) return;
      const ex = usedMap.get(c.id);
      if (ex) ex.count++;
      else usedMap.set(c.id, { eq: c, count: 1 });
    });
    const items = Array.from(usedMap.values()).sort((a, b) =>
      a.eq.category.localeCompare(b.eq.category) || a.eq.name.localeCompare(b.eq.name)
    );

    // Preload images with their natural dimensions so we can preserve aspect ratio.
    const imageMetas = await Promise.all(
      items.map(({ eq }) => (eq.images && eq.images[0] ? loadImageMeta(eq.images[0]) : Promise.resolve(null))),
    );

    const PER_PAGE = 4;
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    const cardH = 58;
    const gap = 4;
    for (let p = 0; p < pages; p++) {
      doc.addPage();
      drawDarkPage(doc);
      pageNum.n++;

      let y = sectionTitle(
        doc,
        p === 0 ? "Catalogue des jeux sélectionnés" : "Catalogue (suite)",
        `${items.length} référence${items.length > 1 ? "s" : ""} — cliquez pour ouvrir la fiche produit`,
        24,
      );

      for (let i = 0; i < PER_PAGE; i++) {
        const idx = p * PER_PAGE + i;
        if (idx >= items.length) break;
        const { eq, count } = items[idx];
        const meta = imageMetas[idx];
        const cardY = y + i * (cardH + gap);
        drawCard(doc, MARGIN, cardY, CONTENT_W, cardH, PURPLE);

        // Left: image / icon panel
        const imgW = 50;
        const panelX = MARGIN + 3;
        const panelY = cardY + 3;
        const panelW = imgW;
        const panelH = cardH - 6;
        setF(doc, DARK_SURFACE);
        doc.roundedRect(panelX, panelY, panelW, panelH, 2, 2, "F");

        if (meta) {
          // Fit image inside panel preserving aspect ratio.
          const ratio = meta.w / meta.h;
          const maxW = panelW - 2;
          const maxH = panelH - 2;
          let dw = maxW;
          let dh = dw / ratio;
          if (dh > maxH) { dh = maxH; dw = dh * ratio; }
          const dx = panelX + (panelW - dw) / 2;
          const dy = panelY + (panelH - dh) / 2;
          try {
            doc.addImage(meta.dataUrl, "JPEG", dx, dy, dw, dh, undefined, "FAST");
          } catch {
            doc.setFontSize(24);
            setC(doc, PURPLE);
            doc.text(eq.icon || "🎮", panelX + panelW / 2, cardY + cardH / 2 + 4, { align: "center" });
          }
        } else {
          doc.setFontSize(24);
          setC(doc, PURPLE);
          doc.text(eq.icon || "🎮", panelX + panelW / 2, cardY + cardH / 2 + 4, { align: "center" });
        }

        // Right column
        const tx = MARGIN + imgW + 8;
        const tw = CONTENT_W - imgW - 14;
        let ty = cardY + 9;

        // Name
        doc.setFontSize(12);
        setC(doc, WHITE);
        const nameLines = doc.splitTextToSize(eq.name, tw - 30);
        doc.text(nameLines[0], tx, ty);
        ty += 5;

        // Category badge + qty
        setF(doc, DARK_SURFACE);
        const catText = eq.category;
        const catW = doc.getTextWidth(catText) * 0.35 + 5;
        doc.roundedRect(tx, ty - 2.5, catW, 4.5, 1.2, 1.2, "F");
        doc.setFontSize(6.5);
        setC(doc, PURPLE);
        doc.text(catText, tx + 2.5, ty + 0.7);

        // Quantity badge
        setF(doc, GREEN);
        doc.roundedRect(tx + catW + 3, ty - 2.5, 12, 4.5, 1.2, 1.2, "F");
        setC(doc, DARK);
        doc.text(`× ${count}`, tx + catW + 9, ty + 0.7, { align: "center" });
        ty += 7;

        // Dimensions
        doc.setFontSize(7.5);
        setC(doc, GRAY);
        doc.text(
          `Dimensions : ${eq.width} × ${eq.depth} × ${eq.height} cm   ·   Zone sécurité : ${eq.safetyZone} cm`,
          tx, ty,
        );
        ty += 4.5;

        // Description (1 line)
        if (eq.description) {
          const desc = eq.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          const descLines = doc.splitTextToSize(desc, tw);
          setC(doc, LIGHT);
          doc.text(descLines[0] || "", tx, ty);
          ty += 4;
        }

        // Price (right) — only when budget option is enabled
        if (options.budget && eq.price && eq.price > 0) {
          doc.setFontSize(12);
          setC(doc, GREEN);
          doc.text(formatEUR(eq.price), MARGIN + CONTENT_W - 4, cardY + 13, { align: "right" });
          doc.setFontSize(6);
          setC(doc, GRAY);
          doc.text("Prix unitaire HT", MARGIN + CONTENT_W - 4, cardY + 17, { align: "right" });
        }

        // Link to product page (clickable)
        const url = `${SITE_BASE}${encodeURIComponent(eq.id)}`;
        const linkLabel = "› Voir sur avranchesautomatic.com";
        doc.setFontSize(8);
        setC(doc, GREEN);
        const linkY = cardY + cardH - 4;
        doc.textWithLink(linkLabel, tx, linkY, { url });
      }
      addFooter(doc, pageNum.n, logo);
    }
  }




  // ─── Budget + Leasing ──────────────────────────────
  if (options.budget) {
    doc.addPage();
    drawDarkPage(doc);
    pageNum.n++;
    let y = sectionTitle(doc, "Budget & Financement", "Estimation basée sur les prix catalogue HT.", 24);

    // Category breakdown
    const catBudget = new Map<string, { count: number; total: number }>();
    state.placedEquipments.forEach((pe) => {
      const c = catalog.find((cc) => cc.id === pe.equipmentId);
      const k = c?.category || "Autre";
      const ex = catBudget.get(k) || { count: 0, total: 0 };
      ex.count++;
      ex.total += c?.price || 0;
      catBudget.set(k, ex);
    });

    setF(doc, DARK_SURFACE);
    doc.roundedRect(MARGIN, y - 4, CONTENT_W, 8, 2, 2, "F");
    doc.setFontSize(7);
    setC(doc, GREEN);
    doc.text("CATÉGORIE", MARGIN + 4, y);
    doc.text("QTÉ", MARGIN + 100, y);
    doc.text("SOUS-TOTAL HT", MARGIN + 135, y);
    y += 9;

    Array.from(catBudget.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .forEach(([cat, data], i) => {
        if (i % 2 === 0) {
          setF(doc, DARK_CARD);
          doc.roundedRect(MARGIN, y - 4, CONTENT_W, 8, 1, 1, "F");
        }
        doc.setFontSize(9);
        setC(doc, WHITE);
        doc.text(cat, MARGIN + 4, y);
        setC(doc, GRAY);
        doc.text(String(data.count), MARGIN + 100, y);
        if (data.total > 0) { setC(doc, GREEN); doc.text(formatEUR(data.total), MARGIN + 135, y); }
        else { setC(doc, [50, 50, 90]); doc.text("—", MARGIN + 135, y); }
        y += 9;
      });

    // Total card
    y += 6;
    const tH = 50;
    drawCard(doc, MARGIN, y, CONTENT_W, tH, GREEN);
    setF(doc, GREEN);
    doc.rect(MARGIN + 1, y + 1, 2, tH - 2, "F");
    let ty = y + 12;
    doc.setFontSize(10); setC(doc, GRAY); doc.text("TOTAL HT", MARGIN + 12, ty);
    doc.setFontSize(16); setC(doc, PURPLE); doc.text(formatEUR(totalBudget), PAGE_W - MARGIN - 6, ty, { align: "right" });
    ty += 11;
    doc.setFontSize(9); setC(doc, GRAY); doc.text("TVA (20%)", MARGIN + 12, ty);
    setC(doc, LIGHT); doc.text(formatEUR(totalBudget * 0.2), PAGE_W - MARGIN - 6, ty, { align: "right" });
    ty += 13;
    doc.setFontSize(11); setC(doc, WHITE); doc.text("TOTAL TTC", MARGIN + 12, ty);
    doc.setFontSize(20); setC(doc, GREEN); doc.text(formatEUR(totalBudget * 1.2), PAGE_W - MARGIN - 6, ty, { align: "right" });

    y += tH + 8;

    // Leasing block
    if (options.leasing.enabled) {
      const lH = 60;
      drawCard(doc, MARGIN, y, CONTENT_W, lH, PURPLE);
      setF(doc, PURPLE);
      doc.rect(MARGIN + 1, y + 1, 2, lH - 2, "F");

      doc.setFontSize(11);
      setC(doc, PURPLE);
      doc.text("Simulation de leasing", MARGIN + 12, y + 11);
      doc.setFontSize(8);
      setC(doc, GRAY);
      doc.text("Mensualités indicatives — sous réserve d'acceptation par l'organisme financier.", MARGIN + 12, y + 17);

      const cells = [
        { label: "12 MOIS", value: options.leasing.monthly12 },
        { label: "24 MOIS", value: options.leasing.monthly24 },
        { label: "36 MOIS", value: options.leasing.monthly36 },
      ];
      const cellW = (CONTENT_W - 24) / 3;
      cells.forEach((c, i) => {
        const cx = MARGIN + 12 + i * cellW + cellW / 2;
        const cy = y + 26;
        setF(doc, DARK_SURFACE);
        doc.roundedRect(MARGIN + 12 + i * cellW + 4, cy, cellW - 8, 26, 2, 2, "F");
        doc.setFontSize(7);
        setC(doc, GRAY);
        doc.text(c.label, cx, cy + 7, { align: "center" });
        doc.setFontSize(15);
        setC(doc, GREEN);
        doc.text(c.value && c.value > 0 ? `${formatEUR(c.value)}/mois` : "—", cx, cy + 18, { align: "center" });
      });

      y += lH + 6;
    }

    // Disclaimer
    const fY = PAGE_H - 30;
    doc.setFontSize(7);
    setC(doc, [50, 50, 90]);
    doc.text("Document indicatif généré automatiquement. Prix et conditions susceptibles de varier.", MARGIN, fY);
    doc.text(`Généré le ${dateStr}`, MARGIN, fY + 4);
    addFooter(doc, pageNum.n, logo);
  }

  // Save
  const safe = projectName.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, "").replace(/\s+/g, "_");
  doc.save(`Dossier2D_${safe}_${now.toISOString().slice(0, 10)}.pdf`);
}

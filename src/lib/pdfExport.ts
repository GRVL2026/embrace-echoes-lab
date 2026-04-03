/**
 * Premium PDF dossier generator for bank financing.
 * Design inspired by avranchesautomatic.com — dark, bold, fun & tech.
 */
import jsPDF from "jspdf";
import type { EditorState, Room } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { capture3DViews, type CaptureView } from "./render3DCaptures";
import { captureFromLiveCanvas, isCanvasCaptureAvailable } from "./canvasCapture";
import { getCanvas2DSnapshot } from "./canvas2DSnapshot";

// ─── Brand Palette ───────────────────────────────────────────
const PURPLE = [155, 92, 255] as const;     // #9B5CFF
const GREEN = [173, 255, 0] as const;       // #ADFF00
const GOLD = [255, 215, 0] as const;        // #FFD700
const DARK = [6, 6, 25] as const;           // #060619
const DARK_CARD = [14, 14, 40] as const;    // elevated card
const DARK_SURFACE = [20, 20, 52] as const; // surface
const DARK_MUTED = [30, 30, 65] as const;   // table alt
const WHITE = [245, 245, 255] as const;
const GRAY = [120, 120, 160] as const;
const LIGHT = [190, 190, 220] as const;
const CYAN = [0, 200, 255] as const;        // secondary accent

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RGB = readonly [number, number, number];

function setC(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]); }
function setF(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]); }
function setD(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }

// ─── Decorative helpers ──────────────────────────────────────

/** Draw a subtle grid pattern (like the site background) */
function drawGridPattern(doc: jsPDF, y: number, h: number, opacity = 0.025) {
  doc.setGState(new (doc as any).GState({ opacity }));
  setD(doc, PURPLE);
  doc.setLineWidth(0.1);
  const step = 18;
  for (let gx = 0; gx <= PAGE_W; gx += step) {
    doc.line(gx, y, gx, y + h);
  }
  for (let gy = y; gy <= y + h; gy += step) {
    doc.line(0, gy, PAGE_W, gy);
  }
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
}

/** Diagonal decorative lines in a corner */
function drawCornerAccent(doc: jsPDF, x: number, y: number, size: number, flip = false) {
  doc.setGState(new (doc as any).GState({ opacity: 0.15 }));
  setD(doc, GREEN);
  doc.setLineWidth(0.4);
  for (let i = 0; i < 5; i++) {
    const offset = i * (size / 5);
    if (flip) {
      doc.line(x - offset, y, x, y + offset);
    } else {
      doc.line(x + offset, y, x + size, y + offset);
    }
  }
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
}

/** Glowing rounded card background */
function drawCard(doc: jsPDF, x: number, y: number, w: number, h: number, opts?: { glow?: RGB; borderColor?: RGB }) {
  // Card fill
  setF(doc, DARK_CARD);
  doc.roundedRect(x, y, w, h, 4, 4, "F");
  // Border
  const bc = opts?.borderColor || PURPLE;
  doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
  setD(doc, bc);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 4, 4, "S");
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
}

/** Gradient-like bar (simulated with multiple thin rects) */
function drawGradientBar(doc: jsPDF, x: number, y: number, w: number, h: number, from: RGB, to: RGB) {
  const steps = 40;
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect(x + i * stepW, y, stepW + 0.5, h, "F");
  }
}

/** Neon dot accent */
function drawDot(doc: jsPDF, x: number, y: number, r: number, color: RGB, opacity = 0.5) {
  doc.setGState(new (doc as any).GState({ opacity }));
  setF(doc, color);
  doc.circle(x, y, r, "F");
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
}

/** Section title with decorative accent */
function drawSectionTitle(doc: jsPDF, title: string, y: number): number {
  // Green accent dot
  drawDot(doc, MARGIN + 3, y - 1.5, 2, GREEN, 0.6);
  // Title
  doc.setFontSize(18);
  setC(doc, WHITE);
  doc.text(title, MARGIN + 10, y);
  // Underline gradient
  drawGradientBar(doc, MARGIN + 10, y + 2, 60, 1, PURPLE, [PURPLE[0], PURPLE[1], PURPLE[2]]);
  doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
  drawGradientBar(doc, MARGIN + 70, y + 2, 40, 1, PURPLE, DARK);
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
  return y + 12;
}

// ─── Dark page background ────────────────────────────────────
function drawDarkPage(doc: jsPDF) {
  setF(doc, DARK);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function addFooter(doc: jsPDF, page: number, total: number) {
  // Footer bar
  setF(doc, DARK_CARD);
  doc.rect(0, PAGE_H - 16, PAGE_W, 16, "F");
  drawGradientBar(doc, 0, PAGE_H - 16, PAGE_W, 0.8, PURPLE, GREEN);
  
  doc.setFontSize(7);
  setC(doc, GRAY);
  doc.text("Arcade Planner — Dossier de Financement", MARGIN, PAGE_H - 6);
  
  // Page number badge
  setF(doc, DARK_MUTED);
  const badge = `${page}/${total}`;
  const badgeW = 16;
  doc.roundedRect(PAGE_W - MARGIN - badgeW, PAGE_H - 13, badgeW, 8, 2, 2, "F");
  doc.setFontSize(8);
  setC(doc, GREEN);
  doc.text(badge, PAGE_W - MARGIN - badgeW / 2, PAGE_H - 7.5, { align: "center" });
}

// ─── Utils ───────────────────────────────────────────────────
function computeRoomArea(room: Room): number {
  if (!room.isClosed) return 0;
  const pts = room.points;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2 / 10000;
}

function capture2DCanvas(): string | null {
  const snapshot = getCanvas2DSnapshot();
  if (snapshot) return snapshot;
  const canvas = document.querySelector("canvas:not([data-engine])") as HTMLCanvasElement | null;
  if (!canvas) return null;
  try { return canvas.toDataURL("image/png"); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════
export type DossierOptions = {
  cover?: boolean;
  plan2d?: boolean;
  views3d?: boolean;
  equipmentList?: boolean;
  budget?: boolean;
  productSheets?: boolean;
};

export async function generateDossierPDF(
  state: EditorState,
  catalog: GameEquipment[],
  projectName: string,
  options?: DossierOptions
): Promise<void> {
  const opts: Required<DossierOptions> = {
    cover: true, plan2d: true, views3d: true,
    equipmentList: true, budget: true, productSheets: true,
    ...options,
  };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let pageNum = 0;
  let isFirstPage = true;

  const startPage = () => {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;
    pageNum++;
    drawDarkPage(doc);
  };

  const formatEUR = (v: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  const totalArea = state.rooms.reduce((s, r) => s + computeRoomArea(r), 0);
  const budget = state.placedEquipments.reduce((s, eq) => {
    const cat = catalog.find((c) => c.id === eq.equipmentId);
    return s + (cat?.price || 0);
  }, 0);

  // 3D captures (only if needed)
  let views: Record<CaptureView, string> | null = null;
  if (opts.cover || opts.views3d) {
    try {
      if (isCanvasCaptureAvailable()) {
        views = await captureFromLiveCanvas();
      } else {
        views = await capture3DViews(state.rooms, state.doors, state.pillars, state.placedEquipments, state.circulationPath || []);
      }
    } catch (e) { console.warn("3D capture failed:", e); }
  }

  // ═══════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════
  if (opts.cover) {
  startPage();
  drawGridPattern(doc, 0, PAGE_H, 0.04);
  
  // Top gradient bar
  drawGradientBar(doc, 0, 0, PAGE_W, 3, GREEN, PURPLE);
  
  // Corner decorations
  drawCornerAccent(doc, PAGE_W - 50, 8, 40);
  drawCornerAccent(doc, 0, PAGE_H - 50, 40, true);
  
  // Decorative dots
  drawDot(doc, PAGE_W - 25, 20, 3, PURPLE, 0.2);
  drawDot(doc, PAGE_W - 15, 28, 1.5, GREEN, 0.3);
  drawDot(doc, 30, PAGE_H - 40, 2, GREEN, 0.15);

  // Brand label
  doc.setFontSize(9);
  setC(doc, GREEN);
  doc.text("AVRANCHES AUTOMATIC", MARGIN, 22);

  // Tag line
  doc.setFontSize(10);
  setC(doc, GRAY);
  doc.text("DOSSIER DE FINANCEMENT", MARGIN, 32);

  // Project name — big bold
  doc.setFontSize(38);
  setC(doc, WHITE);
  const nameLines = doc.splitTextToSize(projectName.toUpperCase(), CONTENT_W);
  doc.text(nameLines, MARGIN, 54);
  const nameEndY = 54 + nameLines.length * 14;

  // Green accent bar under title
  drawGradientBar(doc, MARGIN, nameEndY + 2, 80, 2.5, GREEN, [GREEN[0], GREEN[1], GREEN[2]]);
  doc.setGState(new (doc as any).GState({ opacity: 0.2 }));
  drawGradientBar(doc, MARGIN + 80, nameEndY + 2, 40, 2.5, GREEN, DARK);
  doc.setGState(new (doc as any).GState({ opacity: 1 }));

  // Hero 3D image in rounded card
  const heroY = nameEndY + 14;
  const heroH = 125;
  if (views?.perspective) {
    drawCard(doc, MARGIN, heroY, CONTENT_W, heroH, { borderColor: PURPLE });
    doc.addImage(views.perspective, "PNG", MARGIN + 1, heroY + 1, CONTENT_W - 2, heroH - 2, undefined, "FAST");
    // Slight overlay for depth
    doc.setGState(new (doc as any).GState({ opacity: 0.15 }));
    setF(doc, DARK);
    doc.roundedRect(MARGIN, heroY, CONTENT_W, heroH, 4, 4, "F");
    doc.setGState(new (doc as any).GState({ opacity: 1 }));
    // Label
    doc.setFontSize(7);
    setC(doc, GRAY);
    doc.text("VUE 3D — PERSPECTIVE", MARGIN + 5, heroY + heroH - 4);
  }

  // Bottom stats panel
  const statsY = PAGE_H - 75;
  drawCard(doc, MARGIN, statsY, CONTENT_W, 52);

  // Stats grid inside card
  const statCols = 3;
  const statW = CONTENT_W / statCols;
  const statsData = [
    { label: "Salles", value: String(state.rooms.length), accent: PURPLE },
    { label: "Équipements", value: String(state.placedEquipments.length), accent: CYAN },
    { label: "Surface", value: totalArea > 0 ? `${totalArea.toFixed(1)} m²` : "N/A", accent: GREEN },
  ];
  statsData.forEach((stat, i) => {
    const sx = MARGIN + i * statW + statW / 2;
    const sy = statsY + 16;
    // Value
    doc.setFontSize(22);
    setC(doc, stat.accent as unknown as RGB);
    doc.text(stat.value, sx, sy, { align: "center" });
    // Label
    doc.setFontSize(8);
    setC(doc, GRAY);
    doc.text(stat.label, sx, sy + 8, { align: "center" });
    // Separator line (except last)
    if (i < statCols - 1) {
      doc.setGState(new (doc as any).GState({ opacity: 0.15 }));
      setD(doc, PURPLE);
      doc.setLineWidth(0.3);
      doc.line(MARGIN + (i + 1) * statW, statsY + 8, MARGIN + (i + 1) * statW, statsY + 44);
      doc.setGState(new (doc as any).GState({ opacity: 1 }));
    }
  });

  // Budget callout
  if (budget > 0) {
    doc.setFontSize(9);
    setC(doc, GRAY);
    doc.text("Budget estimé HT", MARGIN + CONTENT_W / 2, statsY + 38, { align: "center" });
    doc.setFontSize(18);
    setC(doc, GREEN);
    doc.text(formatEUR(budget), MARGIN + CONTENT_W / 2, statsY + 48, { align: "center" });
  }

  // Date at bottom
  doc.setFontSize(7);
  setC(doc, [50, 50, 90]);
  doc.text(dateStr, PAGE_W - MARGIN, PAGE_H - 6, { align: "right" });
  } // end cover

  if (opts.plan2d) {
  startPage();
  drawGridPattern(doc, 0, PAGE_H, 0.03);
  let y2 = drawSectionTitle(doc, "Plan 2D", 28);

  doc.setFontSize(9);
  setC(doc, GRAY);
  doc.text("Vue d'ensemble du plan d'aménagement", MARGIN + 10, y2 - 3);
  y2 += 6;

  const plan2D = capture2DCanvas();
  if (plan2D) {
    const imgH = 165;
    drawCard(doc, MARGIN, y2, CONTENT_W, imgH, { borderColor: PURPLE });
    doc.addImage(plan2D, "PNG", MARGIN + 2, y2 + 2, CONTENT_W - 4, imgH - 4, undefined, "FAST");
  } else {
    drawCard(doc, MARGIN, y2, CONTENT_W, 80);
    doc.setFontSize(11);
    setC(doc, GRAY);
    doc.text("Plan 2D non disponible", PAGE_W / 2, y2 + 40, { align: "center" });
    doc.setFontSize(8);
    doc.text("Activez la vue 2D pour capturer le plan", PAGE_W / 2, y2 + 48, { align: "center" });
  }

  // Legend cards
  const legY = plan2D ? y2 + 174 : y2 + 88;
  const legendItems = [
    { icon: "■", label: "Murs", color: WHITE },
    { icon: "◻", label: "Équipements", color: GREEN },
    { icon: "↺", label: "Portes", color: PURPLE },
    { icon: "▣", label: "Poteaux", color: GOLD },
  ];
  const legW = CONTENT_W / legendItems.length;
  legendItems.forEach((item, i) => {
    const lx = MARGIN + i * legW + legW / 2;
    doc.setFontSize(14);
    setC(doc, item.color as unknown as RGB);
    doc.text(item.icon, lx, legY, { align: "center" });
    doc.setFontSize(7);
    setC(doc, GRAY);
    doc.text(item.label, lx, legY + 5, { align: "center" });
  });

  // Room list
  if (state.rooms.length > 0) {
    let ry = legY + 14;
    doc.setFontSize(10);
    setC(doc, PURPLE);
    doc.text("Salles", MARGIN, ry);
    ry += 7;
    state.rooms.forEach((room) => {
      const area = computeRoomArea(room);
      // Row card
      drawCard(doc, MARGIN, ry - 3.5, CONTENT_W, 8, { borderColor: DARK_MUTED });
      doc.setFontSize(8);
      setC(doc, WHITE);
      doc.text(room.name, MARGIN + 6, ry);
      if (area > 0) {
        setC(doc, GREEN);
        doc.text(`${area.toFixed(1)} m²`, PAGE_W - MARGIN - 6, ry, { align: "right" });
      }
      ry += 10;
    });
  }

  } // end plan2d

  // ═══════════════════════════════════════════════════
  // PAGE 3 — VUES 3D
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawGridPattern(doc, 0, PAGE_H, 0.03);
  let y3 = drawSectionTitle(doc, "Vues 3D", 28);

  doc.setFontSize(9);
  setC(doc, GRAY);
  doc.text("Perspectives et projections du projet", MARGIN + 10, y3 - 3);
  y3 += 4;

  if (views) {
    const cellW = (CONTENT_W - 6) / 2;
    const cellH = 72;
    const gapX = 6;
    const gapY = 14;

    const grid = [
      { key: "top" as const, label: "VUE DE DESSUS", col: 0, row: 0 },
      { key: "front" as const, label: "VUE DE FACE", col: 1, row: 0 },
      { key: "side" as const, label: "VUE DE CÔTÉ", col: 0, row: 1 },
      { key: "perspective" as const, label: "PERSPECTIVE", col: 1, row: 1 },
      { key: "perspectiveOpen" as const, label: "SANS MURS", col: 0, row: 2 },
      { key: "perspectiveCorridor" as const, label: "CIRCULATION", col: 1, row: 2 },
    ];

    grid.forEach(({ key, label, col, row }) => {
      const x = MARGIN + col * (cellW + gapX);
      const y = y3 + row * (cellH + gapY);

      drawCard(doc, x, y, cellW, cellH, { 
        borderColor: key === "perspective" ? GREEN : PURPLE 
      });

      if (views![key]) {
        doc.addImage(views![key], "PNG", x + 1, y + 1, cellW - 2, cellH - 2, undefined, "FAST");
      }

      // Label badge
      const labelW = doc.getTextWidth(label) * 0.35 + 6;
      setF(doc, DARK_CARD);
      doc.setGState(new (doc as any).GState({ opacity: 0.85 }));
      doc.roundedRect(x + cellW / 2 - labelW / 2, y + cellH - 6, labelW, 5, 1.5, 1.5, "F");
      doc.setGState(new (doc as any).GState({ opacity: 1 }));
      doc.setFontSize(6);
      setC(doc, key === "perspective" ? GREEN : LIGHT);
      doc.text(label, x + cellW / 2, y + cellH - 2.5, { align: "center" });
    });
  } else {
    drawCard(doc, MARGIN, y3, CONTENT_W, 80);
    doc.setFontSize(11);
    setC(doc, GRAY);
    doc.text("Vues 3D non disponibles", PAGE_W / 2, y3 + 40, { align: "center" });
  }

  addFooter(doc, 3, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 4 — LISTE DES ÉQUIPEMENTS
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawGridPattern(doc, 0, PAGE_H, 0.02);
  let y4 = drawSectionTitle(doc, "Équipements", 28);

  doc.setFontSize(9);
  setC(doc, GRAY);
  doc.text(`${state.placedEquipments.length} jeux et équipements`, MARGIN + 10, y4 - 3);
  y4 += 6;

  // Build equipment summary
  const eqMap = new Map<string, { name: string; category: string; count: number; w: number; d: number; price: number }>();
  state.placedEquipments.forEach((eq) => {
    const cat = catalog.find((c) => c.id === eq.equipmentId);
    const key = eq.equipmentId || eq.name;
    const existing = eqMap.get(key);
    if (existing) { existing.count++; }
    else {
      eqMap.set(key, {
        name: cat?.name || eq.name,
        category: cat?.category || "—",
        count: 1,
        w: cat?.width || eq.width,
        d: cat?.depth || eq.depth,
        price: cat?.price || 0,
      });
    }
  });
  const eqList = Array.from(eqMap.values()).sort((a, b) => a.category.localeCompare(b.category));

  // Table header
  const cols = [MARGIN + 4, MARGIN + 74, MARGIN + 112, MARGIN + 142, MARGIN + 156];
  setF(doc, DARK_SURFACE);
  doc.roundedRect(MARGIN, y4 - 4, CONTENT_W, 9, 2, 2, "F");
  doc.setFontSize(7);
  setC(doc, GREEN);
  doc.text("NOM", cols[0], y4);
  doc.text("CATÉGORIE", cols[1], y4);
  doc.text("DIMENSIONS", cols[2], y4);
  doc.text("QTÉ", cols[3], y4);
  doc.text("PRIX", cols[4], y4);
  y4 += 10;

  let prevCategory = "";
  eqList.forEach((eq, i) => {
    if (y4 > PAGE_H - 30) return;

    // Category separator
    if (eq.category !== prevCategory) {
      prevCategory = eq.category;
      drawDot(doc, MARGIN + 2, y4 - 1, 1.2, PURPLE, 0.7);
      doc.setFontSize(7);
      setC(doc, PURPLE);
      doc.text(eq.category.toUpperCase(), MARGIN + 6, y4);
      y4 += 7;
    }

    // Row background
    if (i % 2 === 0) {
      setF(doc, DARK_CARD);
      doc.roundedRect(MARGIN, y4 - 3.5, CONTENT_W, 7, 1, 1, "F");
    }

    doc.setFontSize(8);
    setC(doc, WHITE);
    doc.text(eq.name.substring(0, 32), cols[0], y4);
    setC(doc, GRAY);
    doc.text(eq.category.substring(0, 18), cols[1], y4);
    doc.text(`${eq.w}×${eq.d}`, cols[2], y4);
    setC(doc, LIGHT);
    doc.text(String(eq.count), cols[3] + 4, y4, { align: "center" });
    if (eq.price > 0) {
      setC(doc, GREEN);
      doc.text(formatEUR(eq.price), cols[4], y4);
    } else {
      setC(doc, [50, 50, 90]);
      doc.text("—", cols[4], y4);
    }
    y4 += 7.5;
  });

  addFooter(doc, 4, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 5 — BUDGET
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawGridPattern(doc, 0, PAGE_H, 0.02);
  let y5 = drawSectionTitle(doc, "Budget Estimatif", 28);

  doc.setFontSize(9);
  setC(doc, GRAY);
  doc.text("Estimation basée sur les prix catalogue", MARGIN + 10, y5 - 3);
  y5 += 6;

  // Budget by category
  const catBudget = new Map<string, { count: number; total: number }>();
  state.placedEquipments.forEach((eq) => {
    const cat = catalog.find((c) => c.id === eq.equipmentId);
    const category = cat?.category || "Autre";
    const existing = catBudget.get(category) || { count: 0, total: 0 };
    existing.count++;
    existing.total += cat?.price || 0;
    catBudget.set(category, existing);
  });

  // Category table header
  setF(doc, DARK_SURFACE);
  doc.roundedRect(MARGIN, y5 - 4, CONTENT_W, 9, 2, 2, "F");
  doc.setFontSize(7);
  setC(doc, GREEN);
  doc.text("CATÉGORIE", MARGIN + 4, y5);
  doc.text("QUANTITÉ", MARGIN + 90, y5);
  doc.text("SOUS-TOTAL", MARGIN + 135, y5);
  y5 += 11;

  doc.setFontSize(9);
  Array.from(catBudget.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .forEach(([cat, data], i) => {
      if (i % 2 === 0) {
        setF(doc, DARK_CARD);
        doc.roundedRect(MARGIN, y5 - 4, CONTENT_W, 9, 1, 1, "F");
      }
      setC(doc, WHITE);
      doc.text(cat, MARGIN + 4, y5);
      setC(doc, GRAY);
      doc.text(`${data.count} jeu${data.count > 1 ? "x" : ""}`, MARGIN + 90, y5);
      if (data.total > 0) {
        setC(doc, GREEN);
        doc.text(formatEUR(data.total), MARGIN + 135, y5);
      } else {
        setC(doc, [50, 50, 90]);
        doc.text("—", MARGIN + 135, y5);
      }
      y5 += 10;
    });

  // Total card
  y5 += 6;
  drawCard(doc, MARGIN, y5, CONTENT_W, budget > 0 ? 65 : 25, { borderColor: GREEN });

  // Purple accent bar inside
  setF(doc, GREEN);
  doc.rect(MARGIN + 1, y5 + 1, 2, budget > 0 ? 63 : 23, "F");

  if (budget > 0) {
    y5 += 14;
    doc.setFontSize(10);
    setC(doc, GRAY);
    doc.text("TOTAL HT", MARGIN + 12, y5);
    doc.setFontSize(16);
    setC(doc, PURPLE);
    doc.text(formatEUR(budget), PAGE_W - MARGIN - 8, y5, { align: "right" });

    y5 += 16;
    doc.setFontSize(9);
    setC(doc, GRAY);
    doc.text("TVA (20%)", MARGIN + 12, y5);
    setC(doc, LIGHT);
    doc.text(formatEUR(budget * 0.2), PAGE_W - MARGIN - 8, y5, { align: "right" });

    y5 += 18;
    drawGradientBar(doc, MARGIN + 10, y5 - 10, CONTENT_W - 20, 0.5, PURPLE, GREEN);
    doc.setFontSize(12);
    setC(doc, WHITE);
    doc.text("TOTAL TTC", MARGIN + 12, y5);
    doc.setFontSize(22);
    setC(doc, GREEN);
    doc.text(formatEUR(budget * 1.2), PAGE_W - MARGIN - 8, y5, { align: "right" });
  } else {
    y5 += 14;
    doc.setFontSize(11);
    setC(doc, GRAY);
    doc.text("Prix non renseignés", PAGE_W / 2, y5, { align: "center" });
  }

  // Technical summary card
  y5 = budget > 0 ? y5 + 30 : y5 + 20;
  drawCard(doc, MARGIN, y5, CONTENT_W, 50, { borderColor: PURPLE });
  setF(doc, PURPLE);
  doc.rect(MARGIN + 1, y5 + 1, 2, 48, "F");

  doc.setFontSize(10);
  setC(doc, PURPLE);
  doc.text("Informations techniques", MARGIN + 12, y5 + 12);

  const techInfo = [
    `Surface totale : ${totalArea > 0 ? `${totalArea.toFixed(1)} m²` : "N/A"}`,
    `Nombre de salles : ${state.rooms.length}`,
    `Nombre de portes : ${state.doors.length}`,
    `Nombre de poteaux : ${state.pillars.length}`,
    `Équipements placés : ${state.placedEquipments.length}`,
    `Catégories : ${catBudget.size}`,
  ];
  doc.setFontSize(8);
  setC(doc, LIGHT);
  techInfo.forEach((line, i) => {
    doc.text(line, MARGIN + 12 + (i % 2) * 82, y5 + 22 + Math.floor(i / 2) * 8);
  });

  // Disclaimer
  const footY = PAGE_H - 32;
  doc.setFontSize(7);
  setC(doc, [45, 45, 80]);
  doc.text("Ce document est une estimation indicative générée par Arcade Planner.", MARGIN, footY);
  doc.text("Les prix indiqués sont ceux du catalogue et peuvent varier.", MARGIN, footY + 4);
  doc.text(`Généré le ${dateStr}`, MARGIN, footY + 8);

  // ═══════════════════════════════════════════════════
  // ANNEXE — FICHES PRODUITS
  // ═══════════════════════════════════════════════════
  // Build unique product list for placed equipment (only catalog items)
  const productSheets: { eq: GameEquipment; count: number }[] = [];
  const seenIds = new Set<string>();
  state.placedEquipments.forEach((pe) => {
    const cat = catalog.find((c) => c.id === pe.equipmentId);
    if (!cat || seenIds.has(cat.id)) return;
    seenIds.add(cat.id);
    const count = state.placedEquipments.filter((p) => p.equipmentId === cat.id).length;
    productSheets.push({ eq: cat, count });
  });
  productSheets.sort((a, b) => a.eq.category.localeCompare(b.eq.category));

  // 2 product cards per page
  const annexePages = Math.ceil(productSheets.length / 2);
  totalPages = 5 + annexePages;

  // Update footers for pages 1-5
  // (already drawn, can't update — we'll just use correct total going forward)

  for (let ai = 0; ai < annexePages; ai++) {
    doc.addPage();
    drawDarkPage(doc);
    drawGridPattern(doc, 0, PAGE_H, 0.02);

    const pageNum = 6 + ai;
    let ya = drawSectionTitle(doc, ai === 0 ? "Annexe — Fiches Produits" : "Fiches Produits (suite)", 28);

    for (let slot = 0; slot < 2; slot++) {
      const idx = ai * 2 + slot;
      if (idx >= productSheets.length) break;
      const { eq, count } = productSheets[idx];

      const cardH = 110;
      const cardY = ya;

      drawCard(doc, MARGIN, cardY, CONTENT_W, cardH, { borderColor: PURPLE });

      // Product image (left side)
      const imgW = 50;
      const imgX = MARGIN + 4;
      const imgY = cardY + 4;
      const imgH = cardH - 8;

      if (eq.images && eq.images.length > 0) {
        try {
          // Try to load image — we'll draw a placeholder frame regardless
          drawCard(doc, imgX, imgY, imgW, imgH, { borderColor: DARK_MUTED });
          // Attempt to embed first image
          const imgUrl = eq.images[0];
          // We can't reliably fetch external images in browser PDF gen,
          // so we draw a placeholder with the icon
          setF(doc, DARK_SURFACE);
          doc.roundedRect(imgX + 1, imgY + 1, imgW - 2, imgH - 2, 2, 2, "F");
          doc.setFontSize(28);
          setC(doc, PURPLE);
          doc.text(eq.icon || "🎮", imgX + imgW / 2, imgY + imgH / 2 + 4, { align: "center" });
          doc.setFontSize(6);
          setC(doc, GRAY);
          doc.text("Image catalogue", imgX + imgW / 2, imgY + imgH - 4, { align: "center" });
        } catch {
          // fallback
        }
      } else {
        // Icon placeholder
        setF(doc, DARK_SURFACE);
        doc.roundedRect(imgX, imgY, imgW, imgH, 3, 3, "F");
        doc.setFontSize(32);
        setC(doc, PURPLE);
        doc.text(eq.icon || "🎮", imgX + imgW / 2, imgY + imgH / 2 + 5, { align: "center" });
      }

      // Right side — text content
      const textX = imgX + imgW + 8;
      const textW = CONTENT_W - imgW - 16;
      let ty = cardY + 12;

      // Name
      doc.setFontSize(13);
      setC(doc, WHITE);
      const nameLines2 = doc.splitTextToSize(eq.name, textW);
      doc.text(nameLines2.slice(0, 2), textX, ty);
      ty += nameLines2.slice(0, 2).length * 5 + 3;

      // Category & vendor
      doc.setFontSize(8);
      setC(doc, PURPLE);
      doc.text(eq.category.toUpperCase(), textX, ty);
      if (eq.vendor) {
        setC(doc, GRAY);
        doc.text(`• ${eq.vendor}`, textX + doc.getTextWidth(eq.category.toUpperCase()) + 4, ty);
      }
      ty += 7;

      // Dimensions row
      drawGradientBar(doc, textX, ty - 2, textW, 0.3, PURPLE, DARK);
      ty += 4;

      const dimItems = [
        { label: "Largeur", value: `${eq.width} cm` },
        { label: "Profondeur", value: `${eq.depth} cm` },
        { label: "Hauteur", value: `${eq.height} cm` },
        { label: "Zone sécurité", value: `${eq.safetyZone} cm` },
      ];
      const dimColW = textW / dimItems.length;
      dimItems.forEach((dim, di) => {
        const dx = textX + di * dimColW;
        doc.setFontSize(6);
        setC(doc, GRAY);
        doc.text(dim.label, dx, ty);
        doc.setFontSize(9);
        setC(doc, GREEN);
        doc.text(dim.value, dx, ty + 5);
      });
      ty += 13;

      // Specs
      if (eq.specs) {
        const specEntries: [string, string][] = [];
        if (eq.specs.power) specEntries.push(["Puissance", eq.specs.power]);
        if (eq.specs.screen) specEntries.push(["Écran", eq.specs.screen]);
        if (eq.specs.capacity) specEntries.push(["Capacité", eq.specs.capacity]);
        if (eq.specs.tickets !== undefined) specEntries.push(["Tickets", eq.specs.tickets ? "Oui" : "Non"]);

        if (specEntries.length > 0) {
          doc.setFontSize(7);
          setC(doc, CYAN);
          doc.text("SPÉCIFICATIONS", textX, ty);
          ty += 5;

          specEntries.forEach(([label, value]) => {
            doc.setFontSize(7);
            setC(doc, GRAY);
            doc.text(`${label}:`, textX, ty);
            setC(doc, WHITE);
            doc.text(value, textX + 30, ty);
            ty += 5;
          });
          ty += 2;
        }
      }

      // Tags & features row
      const features: string[] = [];
      if (eq.pmrAccessible) features.push("♿ PMR");
      if (eq.centerPlacement) features.push("🏝️ Îlot central");
      if (eq.model3d) features.push("🧊 Modèle 3D");
      if (eq.tags && eq.tags.length > 0) features.push(...eq.tags.slice(0, 3));

      if (features.length > 0 && ty < cardY + cardH - 12) {
        let fx = textX;
        features.forEach((tag) => {
          const tagW = doc.getTextWidth(tag) * 0.35 + 5;
          if (fx + tagW > textX + textW) return;
          setF(doc, DARK_MUTED);
          doc.roundedRect(fx, ty - 2.5, tagW, 5, 1.5, 1.5, "F");
          doc.setFontSize(6);
          setC(doc, LIGHT);
          doc.text(tag, fx + 2.5, ty);
          fx += tagW + 2;
        });
        ty += 8;
      }

      // Price & quantity badge
      const badgeY = cardY + cardH - 14;
      // Quantity
      setF(doc, DARK_SURFACE);
      doc.roundedRect(textX, badgeY, 22, 8, 2, 2, "F");
      doc.setFontSize(7);
      setC(doc, PURPLE);
      doc.text(`×${count}`, textX + 11, badgeY + 5, { align: "center" });

      // Price
      if (eq.price && eq.price > 0) {
        doc.setFontSize(11);
        setC(doc, GREEN);
        doc.text(formatEUR(eq.price), textX + textW, badgeY + 5, { align: "right" });
        doc.setFontSize(6);
        setC(doc, GRAY);
        doc.text("Prix unitaire HT", textX + textW, badgeY + 10, { align: "right" });
      }

      ya = cardY + cardH + 8;
    }

    addFooter(doc, pageNum, totalPages);
  }

  // Re-stamp footers 1–5 with correct total would require re-rendering;
  // instead we already write them. For a cleaner solution we'd buffer pages.

  addFooter(doc, 5, totalPages);

  // Save
  const safeName = projectName.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, "").replace(/\s+/g, "_");
  doc.save(`Dossier_${safeName}_${now.toISOString().slice(0, 10)}.pdf`);
}

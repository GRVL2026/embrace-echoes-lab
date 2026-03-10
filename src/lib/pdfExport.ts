/**
 * Premium PDF dossier generator for bank financing.
 * Full dark mode matching Arcade Planner brand identity.
 */
import jsPDF from "jspdf";
import type { EditorState, Room } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { capture3DViews } from "./render3DCaptures";

// Brand colors — dark arcade theme
const PURPLE = [155, 92, 255] as const;   // #9B5CFF
const GREEN = [173, 255, 0] as const;     // #ADFF00
const GOLD = [255, 215, 0] as const;      // #FFD700
const DARK = [6, 6, 25] as const;         // #060619
const DARK_SURFACE = [16, 16, 45] as const; // elevated surface
const DARK_MUTED = [30, 30, 60] as const;   // table stripes
const WHITE = [240, 240, 250] as const;
const GRAY = [130, 130, 170] as const;     // muted text on dark
const LIGHT = [200, 200, 220] as const;    // secondary text

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RGB = readonly [number, number, number];

function setColor(doc: jsPDF, color: RGB) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function setFill(doc: jsPDF, color: RGB) {
  doc.setFillColor(color[0], color[1], color[2]);
}

/** Dark page background + purple accent header */
function drawDarkPage(doc: jsPDF) {
  setFill(doc, DARK);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function drawHeader(doc: jsPDF, title: string, subtitle: string) {
  // Header bar
  setFill(doc, DARK_SURFACE);
  doc.rect(0, 0, PAGE_W, 38, "F");
  // Purple accent line
  setFill(doc, PURPLE);
  doc.rect(0, 36, PAGE_W, 2, "F");
  // Title
  doc.setFontSize(20);
  setColor(doc, WHITE);
  doc.text(title, MARGIN, 18);
  // Subtitle
  doc.setFontSize(10);
  setColor(doc, GRAY);
  doc.text(subtitle, MARGIN, 28);
}

function addPageNumber(doc: jsPDF, page: number, total: number) {
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.text(`${page} / ${total}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
  setColor(doc, [80, 80, 120]);
  doc.text("Arcade Planner — Dossier de Financement", MARGIN, PAGE_H - 10);
  // Bottom accent line
  setFill(doc, PURPLE);
  doc.rect(0, PAGE_H - 3, PAGE_W, 3, "F");
}

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
  const canvas = document.querySelector("canvas:not([data-engine])") as HTMLCanvasElement | null;
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function generateDossierPDF(
  state: EditorState,
  catalog: GameEquipment[],
  projectName: string
): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const totalPages = 5;

  const formatEUR = (v: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const totalArea = state.rooms.reduce((s, r) => s + computeRoomArea(r), 0);
  const budget = state.placedEquipments.reduce((s, eq) => {
    const cat = catalog.find((c) => c.id === eq.equipmentId);
    return s + (cat?.price || 0);
  }, 0);

  // 3D captures
  let views: ReturnType<typeof capture3DViews> | null = null;
  try {
    views = capture3DViews(state.rooms, state.doors, state.pillars, state.placedEquipments, state.circulationPath || []);
  } catch (e) {
    console.warn("3D capture failed:", e);
  }

  // ═══════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════
  drawDarkPage(doc);

  // Top neon accent
  setFill(doc, PURPLE);
  doc.rect(0, 0, PAGE_W, 4, "F");
  // Thin green line below
  setFill(doc, GREEN);
  doc.rect(0, 4, PAGE_W * 0.4, 1.5, "F");

  // Title block
  doc.setFontSize(12);
  setColor(doc, GRAY);
  doc.text("DOSSIER DE FINANCEMENT", MARGIN, 26);

  doc.setFontSize(34);
  setColor(doc, WHITE);
  doc.text(projectName.toUpperCase(), MARGIN, 46);

  // Green accent under title
  setFill(doc, GREEN);
  doc.rect(MARGIN, 50, 60, 2.5, "F");

  // Hero 3D image
  if (views?.perspective) {
    doc.addImage(views.perspective, "PNG", MARGIN, 62, CONTENT_W, 130, undefined, "FAST");
    // Dark overlay for depth
    setFill(doc, DARK);
    doc.setGState(new (doc as any).GState({ opacity: 0.2 }));
    doc.rect(MARGIN, 62, CONTENT_W, 130, "F");
    doc.setGState(new (doc as any).GState({ opacity: 1 }));
    // Purple border glow
    doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
    doc.setLineWidth(0.8);
    doc.rect(MARGIN, 62, CONTENT_W, 130, "S");
  }

  // Bottom info panel
  const bottomY = 210;
  setFill(doc, DARK_SURFACE);
  doc.rect(0, bottomY, PAGE_W, PAGE_H - bottomY, "F");
  // Purple separator
  setFill(doc, PURPLE);
  doc.rect(0, bottomY, PAGE_W, 1.5, "F");

  doc.setFontSize(13);
  setColor(doc, PURPLE);
  doc.text("Arcade Planner", MARGIN, bottomY + 16);
  doc.setFontSize(10);
  setColor(doc, LIGHT);
  doc.text("Avranches Automatic", MARGIN, bottomY + 24);

  doc.setFontSize(9);
  setColor(doc, GRAY);
  doc.text(`Date : ${dateStr}`, MARGIN, bottomY + 38);
  doc.text(`${state.rooms.length} salle${state.rooms.length > 1 ? "s" : ""}  ·  ${state.placedEquipments.length} équipement${state.placedEquipments.length > 1 ? "s" : ""}`, MARGIN, bottomY + 46);
  if (totalArea > 0) {
    doc.text(`Surface totale : ${totalArea.toFixed(1)} m²`, MARGIN, bottomY + 54);
  }

  if (budget > 0) {
    doc.setFontSize(16);
    setColor(doc, GREEN);
    doc.text(formatEUR(budget), PAGE_W - MARGIN, bottomY + 20, { align: "right" });
    doc.setFontSize(9);
    setColor(doc, GRAY);
    doc.text("Budget estimé HT", PAGE_W - MARGIN, bottomY + 28, { align: "right" });
  }

  doc.setFontSize(7);
  setColor(doc, [60, 60, 100]);
  doc.text("1 / 5", PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });

  // ═══════════════════════════════════════════════════
  // PAGE 2 — PLAN 2D
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawHeader(doc, "Plan 2D", "Vue d'ensemble du plan d'aménagement");

  const plan2D = capture2DCanvas();
  if (plan2D) {
    const imgY = 45;
    const imgH = 175;
    // Dark frame for plan
    setFill(doc, DARK_SURFACE);
    doc.rect(MARGIN - 2, imgY - 2, CONTENT_W + 4, imgH + 4, "F");
    doc.addImage(plan2D, "PNG", MARGIN, imgY, CONTENT_W, imgH, undefined, "FAST");
    doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
    doc.setLineWidth(0.5);
    doc.rect(MARGIN - 2, imgY - 2, CONTENT_W + 4, imgH + 4, "S");
  } else {
    doc.setFontSize(12);
    setColor(doc, GRAY);
    doc.text("(Plan 2D non disponible — activez la vue 2D)", PAGE_W / 2, 130, { align: "center" });
  }

  // Legend
  const legY = 228;
  doc.setFontSize(9);
  setColor(doc, PURPLE);
  doc.text("Légende", MARGIN, legY);
  doc.setFontSize(8);
  setColor(doc, GRAY);
  const legendItems = [
    "■ Murs et cloisons",
    "◻ Équipements et jeux",
    "↺ Portes (arc d'ouverture)",
    "▣ Poteaux / obstacles",
  ];
  legendItems.forEach((item, i) => {
    doc.text(item, MARGIN + (i % 2) * 85, legY + 8 + Math.floor(i / 2) * 6);
  });

  // Room summary
  if (state.rooms.length > 0) {
    let ry = legY + 24;
    doc.setFontSize(9);
    setColor(doc, PURPLE);
    doc.text("Salles", MARGIN, ry);
    ry += 6;
    state.rooms.forEach((room) => {
      const area = computeRoomArea(room);
      doc.setFontSize(8);
      setColor(doc, LIGHT);
      doc.text(`• ${room.name}`, MARGIN + 4, ry);
      if (area > 0) {
        setColor(doc, GREEN);
        doc.text(`${area.toFixed(1)} m²`, MARGIN + 80, ry);
      }
      ry += 5;
    });
  }

  addPageNumber(doc, 2, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 3 — VUES 3D
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawHeader(doc, "Vues 3D", "Perspectives et projections du projet");

  if (views) {
    const grid = [
      { key: "top" as const, label: "Vue de dessus", x: MARGIN, y: 45 },
      { key: "front" as const, label: "Vue de face", x: MARGIN + CONTENT_W / 2 + 3, y: 45 },
      { key: "side" as const, label: "Vue de côté", x: MARGIN, y: 172 },
      { key: "perspective" as const, label: "Perspective", x: MARGIN + CONTENT_W / 2 + 3, y: 172 },
    ];
    const cellW = CONTENT_W / 2 - 3;
    const cellH = 118;

    grid.forEach(({ key, label, x, y }) => {
      // Dark cell background
      setFill(doc, DARK_SURFACE);
      doc.rect(x, y, cellW, cellH, "F");

      if (views![key]) {
        doc.addImage(views![key], "PNG", x, y, cellW, cellH, undefined, "FAST");
      }

      // Purple border
      doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
      doc.setLineWidth(0.4);
      doc.rect(x, y, cellW, cellH, "S");

      // Label
      doc.setFontSize(8);
      setColor(doc, LIGHT);
      doc.text(label, x + cellW / 2, y + cellH + 6, { align: "center" });
    });
  } else {
    doc.setFontSize(12);
    setColor(doc, GRAY);
    doc.text("(Vues 3D non disponibles)", PAGE_W / 2, 130, { align: "center" });
  }

  addPageNumber(doc, 3, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 4 — LISTE DES ÉQUIPEMENTS
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawHeader(doc, "Équipements", `${state.placedEquipments.length} jeux et équipements`);

  // Build equipment summary
  const eqMap = new Map<string, { name: string; category: string; count: number; w: number; d: number; price: number }>();
  state.placedEquipments.forEach((eq) => {
    const cat = catalog.find((c) => c.id === eq.equipmentId);
    const key = eq.equipmentId || eq.name;
    const existing = eqMap.get(key);
    if (existing) {
      existing.count++;
    } else {
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
  let ty = 48;
  const cols = [MARGIN, MARGIN + 70, MARGIN + 110, MARGIN + 140, MARGIN + 158];
  setFill(doc, DARK_MUTED);
  doc.rect(MARGIN, ty - 4, CONTENT_W, 8, "F");
  doc.setFontSize(7);
  setColor(doc, PURPLE);
  doc.text("NOM", cols[0] + 2, ty);
  doc.text("CATÉGORIE", cols[1], ty);
  doc.text("DIMENSIONS", cols[2], ty);
  doc.text("QTÉ", cols[3], ty);
  doc.text("PRIX UNIT.", cols[4], ty);
  ty += 9;

  // Rows
  let prevCategory = "";
  eqList.forEach((eq, i) => {
    if (ty > PAGE_H - 25) return;

    // Category separator
    if (eq.category !== prevCategory) {
      prevCategory = eq.category;
      setFill(doc, PURPLE);
      doc.rect(MARGIN, ty - 3, 1.5, 5, "F");
      doc.setFontSize(7);
      setColor(doc, PURPLE);
      doc.text(eq.category.toUpperCase(), MARGIN + 4, ty);
      ty += 7;
    }

    // Zebra stripe (dark)
    if (i % 2 === 0) {
      setFill(doc, DARK_SURFACE);
      doc.rect(MARGIN, ty - 3.5, CONTENT_W, 6.5, "F");
    }

    doc.setFontSize(8);
    setColor(doc, WHITE);
    doc.text(eq.name.substring(0, 35), cols[0] + 2, ty);
    setColor(doc, GRAY);
    doc.text(eq.category.substring(0, 20), cols[1], ty);
    doc.text(`${eq.w}×${eq.d} cm`, cols[2], ty);
    setColor(doc, LIGHT);
    doc.text(String(eq.count), cols[3] + 5, ty, { align: "center" });
    if (eq.price > 0) {
      setColor(doc, GREEN);
      doc.text(formatEUR(eq.price), cols[4], ty);
    } else {
      setColor(doc, [60, 60, 100]);
      doc.text("—", cols[4], ty);
    }
    ty += 7;
  });

  addPageNumber(doc, 4, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 5 — BUDGET
  // ═══════════════════════════════════════════════════
  doc.addPage();
  drawDarkPage(doc);
  drawHeader(doc, "Budget Estimatif", "Estimation basée sur les prix catalogue");

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

  let by = 52;

  // Table header
  setFill(doc, DARK_MUTED);
  doc.rect(MARGIN, by - 4, CONTENT_W, 8, "F");
  doc.setFontSize(7);
  setColor(doc, PURPLE);
  doc.text("CATÉGORIE", MARGIN + 2, by);
  doc.text("QUANTITÉ", MARGIN + 80, by);
  doc.text("SOUS-TOTAL", MARGIN + 130, by);
  by += 10;

  doc.setFontSize(9);
  Array.from(catBudget.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .forEach(([cat, data], i) => {
      if (i % 2 === 0) {
        setFill(doc, DARK_SURFACE);
        doc.rect(MARGIN, by - 4, CONTENT_W, 9, "F");
      }
      setColor(doc, WHITE);
      doc.text(cat, MARGIN + 2, by);
      setColor(doc, GRAY);
      doc.text(`${data.count} jeu${data.count > 1 ? "x" : ""}`, MARGIN + 80, by);
      if (data.total > 0) {
        setColor(doc, GREEN);
        doc.text(formatEUR(data.total), MARGIN + 130, by);
      } else {
        setColor(doc, [60, 60, 100]);
        doc.text("—", MARGIN + 130, by);
      }
      by += 9;
    });

  // Total separator
  by += 8;
  doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, by, PAGE_W - MARGIN, by);

  by += 10;
  doc.setFontSize(12);
  setColor(doc, LIGHT);
  doc.text("TOTAL HT", MARGIN, by);
  if (budget > 0) {
    doc.setFontSize(16);
    setColor(doc, PURPLE);
    doc.text(formatEUR(budget), PAGE_W - MARGIN, by, { align: "right" });
  } else {
    doc.setFontSize(11);
    setColor(doc, GRAY);
    doc.text("Prix non renseignés", PAGE_W - MARGIN, by, { align: "right" });
  }

  if (budget > 0) {
    by += 14;
    doc.setFontSize(10);
    setColor(doc, GRAY);
    doc.text("TVA (20%)", MARGIN, by);
    setColor(doc, LIGHT);
    doc.text(formatEUR(budget * 0.2), PAGE_W - MARGIN, by, { align: "right" });

    by += 14;
    doc.setFontSize(13);
    setColor(doc, WHITE);
    doc.text("TOTAL TTC", MARGIN, by);
    doc.setFontSize(18);
    setColor(doc, GREEN);
    doc.text(formatEUR(budget * 1.2), PAGE_W - MARGIN, by, { align: "right" });
  }

  // Technical summary box
  by += 30;
  setFill(doc, DARK_SURFACE);
  doc.roundedRect(MARGIN, by, CONTENT_W, 55, 3, 3, "F");
  // Purple left accent
  setFill(doc, PURPLE);
  doc.rect(MARGIN, by, 2, 55, "F");

  doc.setFontSize(10);
  setColor(doc, PURPLE);
  doc.text("Informations techniques", MARGIN + 10, by + 12);

  doc.setFontSize(8);
  setColor(doc, LIGHT);
  const techInfo = [
    `Surface totale : ${totalArea > 0 ? `${totalArea.toFixed(1)} m²` : "N/A"}`,
    `Nombre de salles : ${state.rooms.length}`,
    `Nombre de portes : ${state.doors.length}`,
    `Nombre de poteaux : ${state.pillars.length}`,
    `Équipements placés : ${state.placedEquipments.length}`,
    `Catégories : ${catBudget.size}`,
  ];
  techInfo.forEach((line, i) => {
    doc.text(line, MARGIN + 10 + (i % 2) * 80, by + 24 + Math.floor(i / 2) * 8);
  });

  // Footer
  const footY = PAGE_H - 28;
  doc.setFontSize(7);
  setColor(doc, [60, 60, 100]);
  doc.text("Ce document est une estimation indicative générée par Arcade Planner.", MARGIN, footY);
  doc.text("Les prix indiqués sont ceux du catalogue et peuvent varier.", MARGIN, footY + 5);
  doc.text(`Généré le ${dateStr}`, MARGIN, footY + 10);

  addPageNumber(doc, 5, totalPages);

  // Save
  const safeName = projectName.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, "").replace(/\s+/g, "_");
  doc.save(`Dossier_${safeName}_${now.toISOString().slice(0, 10)}.pdf`);
}

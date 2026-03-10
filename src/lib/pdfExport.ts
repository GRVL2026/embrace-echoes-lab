/**
 * Premium PDF dossier generator for bank financing.
 * Uses jsPDF for document creation and offscreen Three.js for 3D captures.
 */
import jsPDF from "jspdf";
import type { EditorState, Room } from "@/types/editor";
import type { GameEquipment, PlacedEquipment } from "@/types/equipment";
import { capture3DViews } from "./render3DCaptures";

// Brand colors
const PURPLE = [155, 92, 255] as const;   // #9B5CFF
const GREEN = [173, 255, 0] as const;     // #ADFF00
const DARK = [6, 6, 25] as const;         // #060619
const WHITE = [255, 255, 255] as const;
const GRAY = [148, 163, 184] as const;
const LIGHT_GRAY = [226, 232, 240] as const;

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - 2 * MARGIN;

type RGB = readonly [number, number, number];

function setColor(doc: jsPDF, color: RGB) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawGradientHeader(doc: jsPDF, y: number, height: number) {
  // Dark header bar
  doc.setFillColor(DARK[0], DARK[1], DARK[2]);
  doc.rect(0, y, PAGE_W, height, "F");
  // Purple accent line
  doc.setFillColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.rect(0, y + height - 2, PAGE_W, 2, "F");
}

function addPageNumber(doc: jsPDF, page: number, total: number) {
  doc.setFontSize(8);
  setColor(doc, GRAY);
  doc.text(`${page} / ${total}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
  doc.text("Arcade Planner — Dossier de Financement", MARGIN, PAGE_H - 10);
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

/**
 * Capture the 2D canvas as a data URL.
 */
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
  let currentPage = 1;

  const formatEUR = (v: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);

  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ═══════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════
  // Full dark background
  doc.setFillColor(DARK[0], DARK[1], DARK[2]);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // 3D perspective capture as hero
  let views: ReturnType<typeof capture3DViews> | null = null;
  try {
    views = capture3DViews(state.rooms, state.doors, state.pillars, state.placedEquipments);
    if (views.perspective) {
      doc.addImage(views.perspective, "PNG", 20, 55, 170, 140, undefined, "FAST");
      // Subtle overlay gradient effect (semi-transparent boxes)
      doc.setFillColor(DARK[0], DARK[1], DARK[2]);
      doc.setGState(new (doc as any).GState({ opacity: 0.3 }));
      doc.rect(20, 55, 170, 140, "F");
      doc.setGState(new (doc as any).GState({ opacity: 1 }));
    }
  } catch (e) {
    console.warn("3D capture failed:", e);
  }

  // Top accent bar
  doc.setFillColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.rect(0, 0, PAGE_W, 4, "F");

  // Title area
  doc.setFontSize(14);
  setColor(doc, GRAY);
  doc.text("DOSSIER DE FINANCEMENT", MARGIN, 28);

  doc.setFontSize(32);
  setColor(doc, WHITE);
  doc.text(projectName.toUpperCase(), MARGIN, 44);

  // Green accent line under title
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(MARGIN, 48, 60, 2, "F");

  // Bottom info block
  const bottomY = 215;
  doc.setFillColor(20, 20, 40);
  doc.rect(0, bottomY, PAGE_W, PAGE_H - bottomY, "F");

  doc.setFontSize(11);
  setColor(doc, LIGHT_GRAY);
  doc.text("Arcade Planner", MARGIN, bottomY + 15);
  doc.text("Avranches Automatic", MARGIN, bottomY + 23);

  doc.setFontSize(10);
  setColor(doc, GRAY);
  doc.text(`Date : ${dateStr}`, MARGIN, bottomY + 35);
  doc.text(`${state.rooms.length} salle${state.rooms.length > 1 ? "s" : ""}`, MARGIN, bottomY + 43);
  doc.text(`${state.placedEquipments.length} équipement${state.placedEquipments.length > 1 ? "s" : ""}`, MARGIN, bottomY + 51);

  const totalArea = state.rooms.reduce((s, r) => s + computeRoomArea(r), 0);
  if (totalArea > 0) {
    doc.text(`Surface totale : ${totalArea.toFixed(1)} m²`, MARGIN, bottomY + 59);
  }

  const budget = state.placedEquipments.reduce((s, eq) => {
    const cat = catalog.find((c) => c.id === eq.equipmentId);
    return s + (cat?.price || 0);
  }, 0);
  if (budget > 0) {
    doc.setFontSize(14);
    setColor(doc, [GREEN[0], GREEN[1], GREEN[2]]);
    doc.text(`Budget estimé : ${formatEUR(budget)}`, PAGE_W - MARGIN, bottomY + 20, { align: "right" });
  }

  // Page number
  doc.setFontSize(8);
  setColor(doc, GRAY);
  doc.text("1 / 5", PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });

  // ═══════════════════════════════════════════════════
  // PAGE 2 — PLAN 2D
  // ═══════════════════════════════════════════════════
  doc.addPage();
  currentPage = 2;

  drawGradientHeader(doc, 0, 35);
  doc.setFontSize(18);
  setColor(doc, WHITE);
  doc.text("Plan 2D", MARGIN, 23);
  doc.setFontSize(10);
  setColor(doc, LIGHT_GRAY);
  doc.text("Vue d'ensemble du plan d'aménagement", MARGIN, 31);

  const plan2D = capture2DCanvas();
  if (plan2D) {
    const imgY = 42;
    const imgH = 180;
    // White background for the plan
    doc.setFillColor(255, 255, 255);
    doc.rect(MARGIN - 2, imgY - 2, CONTENT_W + 4, imgH + 4, "F");
    doc.addImage(plan2D, "PNG", MARGIN, imgY, CONTENT_W, imgH, undefined, "FAST");
    // Border
    doc.setDrawColor(LIGHT_GRAY[0], LIGHT_GRAY[1], LIGHT_GRAY[2]);
    doc.rect(MARGIN - 2, imgY - 2, CONTENT_W + 4, imgH + 4, "S");
  } else {
    doc.setFontSize(12);
    setColor(doc, GRAY);
    doc.text("(Plan 2D non disponible — activez la vue 2D)", PAGE_W / 2, 130, { align: "center" });
  }

  // Legend
  const legY = 228;
  doc.setFontSize(9);
  setColor(doc, DARK);
  doc.text("Légende :", MARGIN, legY);
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
    setColor(doc, DARK);
    doc.text("Salles :", MARGIN, ry);
    ry += 6;
    state.rooms.forEach((room) => {
      const area = computeRoomArea(room);
      doc.setFontSize(8);
      setColor(doc, GRAY);
      doc.text(`• ${room.name}${area > 0 ? ` — ${area.toFixed(1)} m²` : ""}`, MARGIN + 4, ry);
      ry += 5;
    });
  }

  addPageNumber(doc, currentPage, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 3 — VUES 3D
  // ═══════════════════════════════════════════════════
  doc.addPage();
  currentPage = 3;

  drawGradientHeader(doc, 0, 35);
  doc.setFontSize(18);
  setColor(doc, WHITE);
  doc.text("Vues 3D", MARGIN, 23);
  doc.setFontSize(10);
  setColor(doc, LIGHT_GRAY);
  doc.text("Perspectives et projections du projet", MARGIN, 31);

  if (views) {
    const grid = [
      { key: "top" as const, label: "Vue de dessus", x: MARGIN, y: 42 },
      { key: "front" as const, label: "Vue de face", x: MARGIN + CONTENT_W / 2 + 3, y: 42 },
      { key: "side" as const, label: "Vue de côté", x: MARGIN, y: 170 },
      { key: "perspective" as const, label: "Perspective", x: MARGIN + CONTENT_W / 2 + 3, y: 170 },
    ];
    const cellW = CONTENT_W / 2 - 3;
    const cellH = 120;

    grid.forEach(({ key, label, x, y }) => {
      // Background
      doc.setFillColor(245, 245, 250);
      doc.rect(x, y, cellW, cellH, "F");

      if (views![key]) {
        doc.addImage(views![key], "PNG", x, y, cellW, cellH, undefined, "FAST");
      }

      // Label below
      doc.setFontSize(8);
      setColor(doc, DARK);
      doc.text(label, x + cellW / 2, y + cellH + 5, { align: "center" });

      // Border
      doc.setDrawColor(LIGHT_GRAY[0], LIGHT_GRAY[1], LIGHT_GRAY[2]);
      doc.rect(x, y, cellW, cellH, "S");
    });
  } else {
    doc.setFontSize(12);
    setColor(doc, GRAY);
    doc.text("(Vues 3D non disponibles)", PAGE_W / 2, 130, { align: "center" });
  }

  addPageNumber(doc, currentPage, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 4 — LISTE DES ÉQUIPEMENTS
  // ═══════════════════════════════════════════════════
  doc.addPage();
  currentPage = 4;

  drawGradientHeader(doc, 0, 35);
  doc.setFontSize(18);
  setColor(doc, WHITE);
  doc.text("Équipements", MARGIN, 23);
  doc.setFontSize(10);
  setColor(doc, LIGHT_GRAY);
  doc.text(`${state.placedEquipments.length} jeux et équipements`, MARGIN, 31);

  // Build equipment summary (group by catalog item, count)
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
  let ty = 45;
  const cols = [MARGIN, MARGIN + 70, MARGIN + 110, MARGIN + 140, MARGIN + 160];
  doc.setFillColor(245, 245, 250);
  doc.rect(MARGIN, ty - 4, CONTENT_W, 8, "F");
  doc.setFontSize(7);
  setColor(doc, DARK);
  doc.text("NOM", cols[0], ty);
  doc.text("CATÉGORIE", cols[1], ty);
  doc.text("DIMENSIONS", cols[2], ty);
  doc.text("QTÉ", cols[3], ty);
  doc.text("PRIX UNIT.", cols[4], ty);
  ty += 8;

  // Table rows
  doc.setFontSize(8);
  let prevCategory = "";
  eqList.forEach((eq, i) => {
    if (ty > PAGE_H - 30) return; // overflow protection

    // Category separator
    if (eq.category !== prevCategory) {
      prevCategory = eq.category;
      doc.setFillColor(PURPLE[0], PURPLE[1], PURPLE[2]);
      doc.rect(MARGIN, ty - 3, 1.5, 5, "F");
      doc.setFontSize(7);
      setColor(doc, PURPLE);
      doc.text(eq.category.toUpperCase(), MARGIN + 4, ty);
      ty += 6;
    }

    // Zebra stripe
    if (i % 2 === 0) {
      doc.setFillColor(250, 250, 255);
      doc.rect(MARGIN, ty - 3.5, CONTENT_W, 6, "F");
    }

    setColor(doc, DARK);
    doc.setFontSize(8);
    doc.text(eq.name.substring(0, 35), cols[0], ty);
    setColor(doc, GRAY);
    doc.text(eq.category.substring(0, 20), cols[1], ty);
    doc.text(`${eq.w}×${eq.d} cm`, cols[2], ty);
    doc.text(String(eq.count), cols[3] + 5, ty, { align: "center" });
    if (eq.price > 0) {
      setColor(doc, DARK);
      doc.text(formatEUR(eq.price), cols[4], ty);
    } else {
      setColor(doc, GRAY);
      doc.text("—", cols[4], ty);
    }
    ty += 7;
  });

  addPageNumber(doc, currentPage, totalPages);

  // ═══════════════════════════════════════════════════
  // PAGE 5 — BUDGET
  // ═══════════════════════════════════════════════════
  doc.addPage();
  currentPage = 5;

  drawGradientHeader(doc, 0, 35);
  doc.setFontSize(18);
  setColor(doc, WHITE);
  doc.text("Budget Estimatif", MARGIN, 23);
  doc.setFontSize(10);
  setColor(doc, LIGHT_GRAY);
  doc.text("Estimation basée sur les prix catalogue", MARGIN, 31);

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

  let by = 50;
  const budgetCols = [MARGIN, MARGIN + 80, MARGIN + 120, MARGIN + 150];

  // Header
  doc.setFillColor(245, 245, 250);
  doc.rect(MARGIN, by - 4, CONTENT_W, 8, "F");
  doc.setFontSize(7);
  setColor(doc, DARK);
  doc.text("CATÉGORIE", budgetCols[0], by);
  doc.text("QUANTITÉ", budgetCols[1], by);
  doc.text("SOUS-TOTAL", budgetCols[2], by);
  by += 10;

  doc.setFontSize(9);
  Array.from(catBudget.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .forEach(([cat, data], i) => {
      if (i % 2 === 0) {
        doc.setFillColor(250, 250, 255);
        doc.rect(MARGIN, by - 4, CONTENT_W, 8, "F");
      }
      setColor(doc, DARK);
      doc.text(cat, budgetCols[0], by);
      setColor(doc, GRAY);
      doc.text(`${data.count} jeu${data.count > 1 ? "x" : ""}`, budgetCols[1], by);
      if (data.total > 0) {
        setColor(doc, DARK);
        doc.text(formatEUR(data.total), budgetCols[2], by);
      } else {
        setColor(doc, GRAY);
        doc.text("—", budgetCols[2], by);
      }
      by += 9;
    });

  // Total
  by += 5;
  doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, by - 2, PAGE_W - MARGIN, by - 2);

  doc.setFontSize(12);
  setColor(doc, DARK);
  doc.text("TOTAL HT", MARGIN, by + 5);
  if (budget > 0) {
    doc.setFontSize(14);
    setColor(doc, PURPLE);
    doc.text(formatEUR(budget), PAGE_W - MARGIN, by + 5, { align: "right" });
  } else {
    setColor(doc, GRAY);
    doc.text("Prix non renseignés", PAGE_W - MARGIN, by + 5, { align: "right" });
  }

  // TVA
  if (budget > 0) {
    by += 12;
    doc.setFontSize(10);
    setColor(doc, GRAY);
    doc.text("TVA (20%)", MARGIN, by);
    doc.text(formatEUR(budget * 0.2), PAGE_W - MARGIN, by, { align: "right" });

    by += 10;
    doc.setFontSize(13);
    setColor(doc, DARK);
    doc.text("TOTAL TTC", MARGIN, by);
    setColor(doc, [GREEN[0], GREEN[1], GREEN[2]]);
    doc.setFontSize(16);
    doc.text(formatEUR(budget * 1.2), PAGE_W - MARGIN, by, { align: "right" });
  }

  // Technical summary box
  by += 25;
  doc.setFillColor(245, 245, 250);
  doc.roundedRect(MARGIN, by, CONTENT_W, 50, 3, 3, "F");
  doc.setFontSize(10);
  setColor(doc, DARK);
  doc.text("Informations techniques", MARGIN + 8, by + 10);

  doc.setFontSize(8);
  setColor(doc, GRAY);
  const techInfo = [
    `Surface totale : ${totalArea > 0 ? `${totalArea.toFixed(1)} m²` : "N/A"}`,
    `Nombre de salles : ${state.rooms.length}`,
    `Nombre de portes : ${state.doors.length}`,
    `Nombre de poteaux : ${state.pillars.length}`,
    `Équipements placés : ${state.placedEquipments.length}`,
    `Catégories : ${catBudget.size}`,
  ];
  techInfo.forEach((line, i) => {
    doc.text(line, MARGIN + 8 + (i % 2) * 80, by + 20 + Math.floor(i / 2) * 7);
  });

  // Footer
  by = PAGE_H - 30;
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.text("Ce document est une estimation indicative générée par Arcade Planner.", MARGIN, by);
  doc.text("Les prix indiqués sont ceux du catalogue et peuvent varier.", MARGIN, by + 5);
  doc.text(`Généré le ${dateStr}`, MARGIN, by + 10);

  addPageNumber(doc, currentPage, totalPages);

  // Save
  const safeName = projectName.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, "").replace(/\s+/g, "_");
  doc.save(`Dossier_${safeName}_${now.toISOString().slice(0, 10)}.pdf`);
}

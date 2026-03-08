/**
 * HYPER NOVA - Gare de Cergy-Préfecture
 * Projet d'implantation basé sur le dossier C2A (19/12/2025)
 * Commerce 3.1 - Surface totale: 118.7 m² (110.7 accessible + 8.0 non-accessible)
 * Échelle: 1/50°
 */

import type { Room, Door, Pillar } from "@/types/editor";
import type { PlacedEquipment } from "@/types/equipment";

/** 
 * Main commercial space dimensions from plan:
 * - Overall width: ~1595cm (from left wall to right facade)
 * - Overall depth: ~780cm  
 * - Staff/back area on left: ~150cm deep
 * - Pillar positions from plan annotations
 */

export function createHyperNovaProject(): {
  rooms: Room[];
  doors: Door[];
  pillars: Pillar[];
  equipments: PlacedEquipment[];
} {
  const rooms: Room[] = [];
  const doors: Door[] = [];
  const pillars: Pillar[] = [];
  const equipments: PlacedEquipment[] = [];

  // ========================================
  // ROOM 1: Commerce 3.1 - Main space (123.3m² from plan)
  // Roughly rectangular with alcove for staff area on left
  // From page 4: 9.90m x 7.82m approx for the main rectangle
  // From page 15: 1595cm total width, ~780cm depth
  // ========================================
  const mainRoomId = crypto.randomUUID();
  rooms.push({
    id: mainRoomId,
    name: "Commerce 3.1 - Espace Arcade",
    isClosed: true,
    walls: [],
    points: [
      { x: 0, y: 0 },         // Top-left
      { x: 1595, y: 0 },      // Top-right
      { x: 1595, y: 780 },    // Bottom-right  
      { x: 0, y: 780 },       // Bottom-left
    ],
  });

  // ========================================
  // ROOM 2: Staff area / back of house (WC, vestiaire, caisse)
  // Left side, approximately 150cm x 317cm
  // ========================================
  const staffRoomId = crypto.randomUUID();
  rooms.push({
    id: staffRoomId,
    name: "Zone Personnel",
    isClosed: true,
    walls: [],
    points: [
      { x: -160, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 500 },
      { x: -160, y: 500 },
    ],
  });

  // ========================================
  // ROOM 3: Stockage C3.1 (20.2 m² from plan)
  // Behind main space, accessible via CF door
  // ========================================
  const stockRoomId = crypto.randomUUID();
  rooms.push({
    id: stockRoomId,
    name: "Stockage C3.1",
    isClosed: true,
    walls: [],
    points: [
      { x: 300, y: 780 },
      { x: 942, y: 780 },
      { x: 942, y: 1095 },
      { x: 300, y: 1095 },
    ],
  });

  // ========================================
  // DOORS
  // ========================================

  // Portes automatiques (entrée principale) - right wall (edge 1: top-right to bottom-right)
  doors.push({
    id: crypto.randomUUID(),
    roomId: mainRoomId,
    edgeIndex: 1, // right wall
    positionRatio: 0.85,
    width: 250,
    openDirection: "left",
    openSide: "exterior",
    leafCount: "double",
    isMainDoor: true,
  });

  // Sortie secours - top wall near right
  doors.push({
    id: crypto.randomUUID(),
    roomId: mainRoomId,
    edgeIndex: 0, // top wall
    positionRatio: 0.85,
    width: 140,
    openDirection: "left",
    openSide: "exterior",
    leafCount: "single",
  });

  // Door to staff area
  doors.push({
    id: crypto.randomUUID(),
    roomId: staffRoomId,
    edgeIndex: 1, // right wall (shared with main)
    positionRatio: 0.3,
    width: 80,
    openDirection: "left",
    openSide: "interior",
    leafCount: "single",
  });

  // Door to stockage
  doors.push({
    id: crypto.randomUUID(),
    roomId: stockRoomId,
    edgeIndex: 0, // top wall (shared with main room bottom)
    positionRatio: 0.3,
    width: 90,
    openDirection: "right",
    openSide: "interior",
    leafCount: "single",
  });

  // ========================================
  // PILLARS (Poteaux béton existants)
  // From page 4 & 15: existing concrete pillars
  // ========================================
  
  // Pillar at approximately center-right of space
  pillars.push({
    id: crypto.randomUUID(),
    position: { x: 1100, y: 390 },
    shape: "square",
    width: 40,
    depth: 40,
    height: 320,
    rotation: 0,
  });

  // Second pillar 
  pillars.push({
    id: crypto.randomUUID(),
    position: { x: 800, y: 390 },
    shape: "square",
    width: 40,
    depth: 40,
    height: 320,
    rotation: 0,
  });

  // ========================================
  // EQUIPMENT - From Implantation Plan Page 15
  // All positions in cm, relative to (0,0) top-left of main room
  // ========================================

  let eqId = 0;
  const eq = (
    name: string,
    category: string,
    x: number,
    y: number,
    w: number,
    d: number,
    rotation: number,
    color: string
  ): PlacedEquipment => ({
    id: crypto.randomUUID(),
    equipmentId: `hypernova-${++eqId}`,
    position: { x, y },
    rotation,
    name,
    width: w,
    depth: d,
    safetyZone: 10,
    color,
  });

  const ARCADE_COLOR = "hsl(280, 70%, 50%)";
  const RACING_COLOR = "hsl(200, 70%, 50%)";
  const SPORT_COLOR = "hsl(140, 60%, 40%)";
  const TABLE_COLOR = "hsl(30, 70%, 45%)";
  const CUBE_COLOR = "hsl(340, 65%, 50%)";

  // ---- TOP ROW: CUBES (along top wall) ----
  // 5 CUBES machines, roughly 100x100cm each, along the top wall
  for (let i = 0; i < 5; i++) {
    equipments.push(eq(
      `CUBES ${i + 1}`,
      "arcade",
      200 + i * 120,
      70,
      100, 100,
      0,
      CUBE_COLOR
    ));
  }

  // ---- LEFT SIDE: CUBES additional + access ----
  equipments.push(eq("CUBES 6", "arcade", 1420, 70, 100, 100, 0, CUBE_COLOR));

  // ---- MIDDLE-LEFT ROW: BASKET EMOJI (L104xP241) ----
  equipments.push(eq("BASKET EMOJI 1", "sport", 650, 250, 104, 241, 0, SPORT_COLOR));
  equipments.push(eq("BASKET EMOJI 2", "sport", 770, 250, 104, 241, 0, SPORT_COLOR));
  equipments.push(eq("BASKET EMOJI 3", "sport", 890, 250, 104, 241, 0, SPORT_COLOR));

  // ---- BASKET HOOPS (next to EMOJI) ----
  equipments.push(eq("BASKET HOOPS 1", "sport", 650, 80, 104, 150, 0, SPORT_COLOR));
  equipments.push(eq("BASKET HOOPS 2", "sport", 770, 80, 104, 150, 0, SPORT_COLOR));
  equipments.push(eq("BASKET HOOPS 3", "sport", 890, 80, 104, 150, 0, SPORT_COLOR));

  // ---- RIGHT SIDE: BULLS EYES (L104xP189xH255) ----
  equipments.push(eq("BULLS EYES CRACKSHOT 1", "arcade", 1150, 100, 104, 189, 0, ARCADE_COLOR));
  equipments.push(eq("BULLS EYES CRACKSHOT 2", "arcade", 1270, 100, 104, 189, 0, ARCADE_COLOR));

  // ---- SKULL SHADOWS (L204xP146xH267) ----
  equipments.push(eq("SKULL SHADOWS", "arcade", 1350, 150, 204, 146, 0, ARCADE_COLOR));

  // ---- Ecran 75" (166x93.4) ----
  equipments.push(eq("Écran 75\"", "écran", 1470, 200, 166, 20, 0, "hsl(210, 40%, 55%)"));

  // ---- MIDDLE: TABLE HOCKEY EMOJI PUCK (L234xP152) ----
  equipments.push(eq("TABLE HOCKEY EMOJI PUCK 1", "table", 650, 500, 234, 152, 0, TABLE_COLOR));
  equipments.push(eq("TABLE HOCKEY EMOJI PUCK 2", "table", 1150, 500, 234, 152, 0, TABLE_COLOR));

  // ---- HOCKEY POWER SIMPLE ----
  equipments.push(eq("HOCKEY POWER SIMPLE 1", "table", 950, 500, 120, 94, 0, TABLE_COLOR));
  equipments.push(eq("HOCKEY POWER SIMPLE 2", "table", 1050, 500, 120, 94, 0, TABLE_COLOR));

  // ---- BOTTOM ROW: SUPER BIKE (L105xP238xH244) ----
  equipments.push(eq("SUPER BIKE 1", "racing", 200, 650, 105, 238, 90, RACING_COLOR));
  equipments.push(eq("SUPER BIKE 2", "racing", 330, 650, 105, 238, 90, RACING_COLOR));

  // ---- ASPHALT (L105xP238xH244) ----
  equipments.push(eq("ASPHALT 1", "racing", 460, 650, 105, 238, 90, RACING_COLOR));
  equipments.push(eq("ASPHALT 2", "racing", 590, 650, 105, 238, 90, RACING_COLOR));

  // ---- FLIPPER (L145xP700xH192) — 4 units ----
  // Note: 700cm depth seems wrong from OCR, likely 70cm. Using 70cm.
  equipments.push(eq("FLIPPER 1", "flipper", 720, 680, 70, 145, 0, "hsl(50, 60%, 45%)"));
  equipments.push(eq("FLIPPER 2", "flipper", 810, 680, 70, 145, 0, "hsl(50, 60%, 45%)"));
  equipments.push(eq("FLIPPER 3", "flipper", 900, 680, 70, 145, 0, "hsl(50, 60%, 45%)"));
  equipments.push(eq("FLIPPER 4", "flipper", 990, 680, 70, 145, 0, "hsl(50, 60%, 45%)"));

  // ---- Bornes ----
  equipments.push(eq("Borne 1", "arcade", 1080, 680, 60, 60, 0, ARCADE_COLOR));
  equipments.push(eq("Borne 2", "arcade", 1160, 680, 60, 60, 0, ARCADE_COLOR));

  // ---- BOTTOM-RIGHT: BULLS EYES + CRACKSHOT ----
  equipments.push(eq("BULLS EYES 3", "arcade", 1260, 650, 104, 189, 0, ARCADE_COLOR));
  equipments.push(eq("CRACKSHOT 1", "arcade", 1380, 650, 104, 189, 0, ARCADE_COLOR));

  // ---- Ecran 75" (bottom right) ----
  equipments.push(eq("Écran 75\" (2)", "écran", 1470, 600, 166, 20, 0, "hsl(210, 40%, 55%)"));

  // ---- Podium présentation produits (center) ----
  equipments.push(eq("Podium Présentation", "mobilier", 530, 420, 144, 100, 0, "hsl(30, 50%, 50%)"));

  // ---- Caisse (near staff entry, left side) ----
  equipments.push(eq("Caisse", "mobilier", 150, 420, 120, 80, 0, "hsl(30, 50%, 50%)"));

  return { rooms, doors, pillars, equipments };
}

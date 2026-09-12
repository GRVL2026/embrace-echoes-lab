/**
 * Plans de référence pour le harnais caméra du Planner.
 * Unités : cm (comme l'éditeur 2D). rotation en degrés.
 * `expectAllFramed: false` = le plan est physiquement incadrable en un seul 16:9 :
 * le solveur a le droit de renvoyer une solution `degraded`, mais JAMAIS une caméra
 * hors les murs ni une image vide.
 */

export type FixtureEq = {
  id: string; name: string; x: number; y: number;
  width: number; depth: number; height: number; rotation: number;
};

export type Fixture = {
  key: string;
  label: string;
  /** polygone de la salle en cm, sens horaire, non répété */
  room: { x: number; y: number }[];
  isClosed: boolean;
  equipments: FixtureEq[];
  pillars?: { x: number; y: number; width: number; depth: number; height: number }[];
  expectAllFramed: boolean;
};

const eq = (id: string, name: string, x: number, y: number, w = 90, d = 85, h = 200, rotation = 0): FixtureEq =>
  ({ id, name, x, y, width: w, depth: d, height: h, rotation });

const rect = (w: number, h: number) => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];

export const FIXTURES: Fixture[] = [
  {
    key: "rect-simple",
    label: "Rectangle 8 × 6 m, 3 bornes groupées au centre",
    room: rect(800, 600), isClosed: true,
    equipments: [eq("a", "Borne A", 350, 300), eq("b", "Borne B", 450, 300), eq("c", "Borne C", 400, 400, 120, 90, 180)],
    expectAllFramed: true,
  },
  {
    key: "wall-row-real",
    label: "CAS RÉEL EN ÉCHEC : 10,96 × 8,04 m, 5 bornes le long du mur bas + 1 îlot",
    room: rect(1096, 804), isClosed: true,
    equipments: [
      eq("a", "Borne A", 150, 740),
      eq("b", "Borne B", 300, 740),
      eq("c", "Borne C", 450, 745, 120, 90, 210),
      eq("d", "Borne D", 700, 745, 120, 90, 190),
      eq("e", "Borne E", 900, 740),
      eq("p", "Emoji Power Puck Single", 540, 300, 220, 110, 95, 90),
    ],
    // 7,5 m d'étalement dans une salle de 11 m : incadrable proprement en 50°,
    // le solveur doit élargir le fov et/ou reculer en diagonale.
    expectAllFramed: true,
  },
  {
    key: "leopaul-reel",
    label: "PLAN REEL LEOPAUL : 10,96 x 8,04 m, 5 machines mur bas + palet ilot",
    room: rect(1096, 804), isClosed: true,
    equipments: [
      eq("prize", "Emoji Prize Box", 44, 740, 84, 96.5, 190),
      eq("hoops", "Emoji Hoops", 151, 676, 104, 241.5, 250),
      eq("puck", "Emoji Power Puck Single", 554, 213, 234, 152.5, 90),
      eq("mk1", "Mario Kart 3 GP DX", 646, 714, 104.2, 160.1, 239),
      eq("mk2", "Mario Kart 3 GP DX", 752, 714, 104.2, 160.1, 239),
      eq("apex", "Apex Rebel", 950, 714, 278, 154, 230),
    ],
    expectAllFramed: true,
  },
  {
    key: "island",
    label: "Îlot central : 12 × 12 m, 4 machines au milieu",
    room: rect(1200, 1200), isClosed: true,
    equipments: [
      eq("a", "Îlot 1", 560, 560, 120, 90, 190),
      eq("b", "Îlot 2", 700, 560, 120, 90, 190),
      eq("c", "Îlot 3", 560, 700, 120, 90, 190, 180),
      eq("d", "Îlot 4", 700, 700, 120, 90, 190, 180),
    ],
    expectAllFramed: true,
  },
  {
    key: "single-wall",
    label: "Machine unique plaquée contre le mur droit, salle 5 × 4 m",
    room: rect(500, 400), isClosed: true,
    equipments: [eq("a", "Borne seule", 440, 200, 90, 85, 200, 270)],
    expectAllFramed: true,
  },
  {
    key: "l-room",
    label: "Salle en L (12 × 10 m moins une échancrure 5 × 4 m), machines dans les deux ailes",
    room: [
      { x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 600 },
      { x: 700, y: 600 }, { x: 700, y: 1000 }, { x: 0, y: 1000 },
    ],
    isClosed: true,
    equipments: [
      eq("a", "Aile haute 1", 1000, 200), eq("b", "Aile haute 2", 1100, 400),
      eq("c", "Aile basse 1", 200, 850), eq("d", "Aile basse 2", 400, 850),
    ],
    // deux ailes non mutuellement visibles : un seul cadre ne peut pas tout montrer sans mur au milieu
    expectAllFramed: false,
  },
  {
    key: "corridor",
    label: "Salle très allongée 20 × 3,5 m, 6 bornes alignées",
    room: rect(2000, 350), isClosed: true,
    equipments: [
      eq("a", "B1", 200, 90), eq("b", "B2", 500, 90), eq("c", "B3", 800, 90),
      eq("d", "B4", 1100, 90), eq("e", "B5", 1400, 90), eq("f", "B6", 1700, 90),
    ],
    expectAllFramed: false,
  },
  {
    key: "pillars",
    label: "Salle 10 × 8 m avec 2 poteaux entre la caméra et les machines",
    room: rect(1000, 800), isClosed: true,
    equipments: [eq("a", "Borne A", 300, 650), eq("b", "Borne B", 700, 650)],
    pillars: [
      { x: 400, y: 400, width: 40, depth: 40, height: 280 },
      { x: 600, y: 400, width: 40, depth: 40, height: 280 },
    ],
    expectAllFramed: true,
  },
  {
    key: "empty-room",
    label: "Salle sans machine (le rendu doit rester une salle, pas un aplat)",
    room: rect(900, 700), isClosed: true,
    equipments: [],
    expectAllFramed: true,
  },
  {
    key: "no-room",
    label: "Machines sans polygone de salle (plan corrompu) — aucun NaN toléré",
    room: [], isClosed: false,
    equipments: [eq("a", "Borne A", 200, 200), eq("b", "Borne B", 400, 200)],
    expectAllFramed: false,
  },
];

export function fixtureRooms(f: Fixture) {
  return f.room.length ? [{ id: f.key, name: f.label, points: f.room, walls: [], isClosed: f.isClosed }] : [];
}

export function fixtureEquipments(f: Fixture) {
  return f.equipments.map((e) => ({
    id: e.id, equipmentId: e.id, name: e.name,
    position: { x: e.x, y: e.y }, rotation: e.rotation,
    width: e.width, depth: e.depth, height: e.height,
    safetyZone: 10, color: "#8b5cf6",
  }));
}

export function fixturePillars(f: Fixture) {
  return (f.pillars ?? []).map((p, i) => ({
    id: `p${i}`, position: { x: p.x, y: p.y }, shape: "square" as const,
    width: p.width, depth: p.depth, height: p.height, rotation: 0,
  }));
}

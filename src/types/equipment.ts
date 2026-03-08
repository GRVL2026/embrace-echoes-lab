/** A game/equipment from the catalog */
export type GameEquipment = {
  id: string;
  name: string;
  category: string;
  width: number;   // cm
  depth: number;   // cm
  height: number;  // cm
  safetyZone: number; // cm - clearance around the equipment (default 140)
  color?: string;  // display color (HSL)
  icon?: string;   // optional emoji or icon name
  pmrAccessible?: boolean; // requires extra clearance for PMR
  model3d?: string; // URL to a .glb/.gltf 3D model file
  
  // Shopify extended fields
  description?: string; // HTML description
  vendor?: string; // Brand/manufacturer
  price?: number; // Price in cents or euros
  images?: string[]; // Array of image URLs
  videoUrl?: string; // YouTube embed URL
  tags?: string[]; // Product tags
  warranty?: string; // Warranty info
  stock?: string; // Stock status
  specs?: {
    power?: string; // e.g. "500 W"
    screen?: string; // e.g. "65\" HD"
    capacity?: string; // e.g. "2 joueurs"
    tickets?: boolean; // Has ticket distribution
  };
};

/** An equipment placed on the plan */
export type PlacedEquipment = {
  id: string;
  equipmentId: string; // references GameEquipment.id
  position: { x: number; y: number }; // center position in cm
  rotation: number; // degrees
  name: string;
  width: number;
  depth: number;
  safetyZone: number;
  color: string;
};

/** Sample catalog JSON schema for import */
export type CatalogJSON = {
  catalog: GameEquipment[];
};

// Default safety zone in cm
export const DEFAULT_SAFETY_ZONE = 140;

// PMR extra clearance in cm
export const PMR_CLEARANCE = 150;

// Door exclusion zone depth in cm
export const DOOR_EXCLUSION_DEPTH = 150;

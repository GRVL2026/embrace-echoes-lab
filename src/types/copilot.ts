// ─── Style & Intent ─────────────────────────────────────────

export interface StyleProfile {
  primary: string;
  secondary: string[];
  palette: string[];
  materials: string[];
  lighting: string;
  decor_density: "low" | "medium" | "high";
  target_feel: string[];
  must_have: string[];
  avoid: string[];
}

export interface ParsedPrompt {
  style_profile: StyleProfile;
  source_inputs: {
    text: boolean;
    images: boolean;
    web: boolean;
  };
  image_analysis?: ImageAnalysis;
  web_analysis?: WebAnalysis;
  locked_elements?: LockedElements;
}

export interface ImageAnalysis {
  dominant_palette: string[];
  style_tags: string[];
  material_tags: string[];
  mood: string;
  modernity_score: number; // 0-1
  density_score: number; // 0-1
}

export interface WebAnalysis {
  brand_colors: string[];
  style_tags: string[];
  mood: string;
  source_url: string;
  extracted_images?: string[];
}

export interface LockedElements {
  floor?: boolean;
  walls?: boolean;
  ceiling?: boolean;
  lighting?: boolean;
  equipment?: boolean;
}

// ─── Actions ────────────────────────────────────────────────

export type CopilotActionType =
  | "apply_material"
  | "apply_lighting"
  | "set_wall_color"
  | "set_ceiling"
  | "add_asset"
  | "remove_asset"
  | "set_fog";

export interface CopilotActionBase {
  type: CopilotActionType;
}

export interface ApplyMaterialAction extends CopilotActionBase {
  type: "apply_material";
  target: "floor" | "wall" | "ceiling";
  /** Poly Haven asset ID or internal texture ID */
  material_id: string;
  material_name: string;
  /** Poly Haven texture URLs (diffuse, normal, roughness) */
  urls?: {
    diffuse?: string;
    normal?: string;
    roughness?: string;
  };
  resolution?: "1k" | "2k" | "4k";
}

export interface ApplyLightingAction extends CopilotActionBase {
  type: "apply_lighting";
  preset: "daylight" | "arcade" | "showroom";
}

export interface SetWallColorAction extends CopilotActionBase {
  type: "set_wall_color";
  color: string;
}

export interface SetCeilingAction extends CopilotActionBase {
  type: "set_ceiling";
  ceiling_type: "none" | "tiles" | "beams" | "black" | "technical";
}

export interface SetFogAction extends CopilotActionBase {
  type: "set_fog";
  enabled: boolean;
  color?: string;
  density?: number;
}

export interface AddAssetAction extends CopilotActionBase {
  type: "add_asset";
  asset_id: string;
  asset_name: string;
  glb_url?: string;
  category?: string;
  thumbnail?: string;
  placement_rule?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export interface RemoveAssetAction extends CopilotActionBase {
  type: "remove_asset";
  asset_id: string;
}

export type CopilotAction =
  | ApplyMaterialAction
  | ApplyLightingAction
  | SetWallColorAction
  | SetCeilingAction
  | SetFogAction
  | AddAssetAction
  | RemoveAssetAction;

// ─── Response ───────────────────────────────────────────────

export interface CopilotResponse {
  summary: string;
  style_profile: StyleProfile;
  actions: CopilotAction[];
  alternatives: string[];
  warnings: string[];
  /** Assets that were searched but not found */
  missing_assets?: string[];
  /** Assets substituted with closest match */
  substitutions?: Array<{
    requested: string;
    used: string;
    reason: string;
  }>;
}

// ─── Chat Messages ──────────────────────────────────────────

export interface CopilotMessageContent {
  text?: string;
  images?: string[]; // base64 or URLs
  links?: string[];
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  content: CopilotMessageContent;
  /** Structured response from assistant */
  copilot_response?: CopilotResponse;
  created_at: string;
}

// ─── Session ────────────────────────────────────────────────

export interface PromptSession {
  id: string;
  user_id?: string;
  messages: CopilotMessage[];
  current_style?: StyleProfile;
  locked_elements: LockedElements;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

// ─── Asset Metadata ─────────────────────────────────────────

export interface CopilotAsset {
  id: string;
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  type: "decor" | "furniture" | "lighting" | "wall_decor" | "floor_item" | "ceiling_item" | "prop";
  format: "glb" | "gltf";
  style_tags: string[];
  material_tags: string[];
  color_tags: string[];
  room_tags: string[];
  dimensions: [number, number, number];
  bounding_box: [number, number, number];
  scale_default: [number, number, number];
  rotation_default: [number, number, number];
  file_url: string;
  thumbnail_url?: string;
  preview_url?: string;
  license: string;
  source: string;
  performance_tier: "light" | "medium" | "heavy";
  is_active: boolean;
}

export interface CopilotTexture {
  id: string;
  name: string;
  type: "floor" | "wall" | "ceiling" | "generic";
  source: "polyhaven" | "internal" | "custom";
  polyhaven_id?: string;
  albedo_url?: string;
  normal_url?: string;
  roughness_url?: string;
  metalness_url?: string;
  style_tags: string[];
  color_tags: string[];
  room_usage: string[];
  repeat_scale: number;
  is_active: boolean;
}

// ─── Quick Actions ──────────────────────────────────────────

export interface QuickAction {
  label: string;
  prompt: string;
  icon?: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: "Futuriste", prompt: "Crée une ambiance futuriste avec néons et matériaux high-tech" },
  { label: "Familial", prompt: "Propose une ambiance chaleureuse et familiale, lumineuse et accueillante" },
  { label: "Premium", prompt: "Génère une ambiance premium haut de gamme avec des finitions luxueuses" },
  { label: "Industriel", prompt: "Crée une ambiance industrielle brute avec béton, métal et bois" },
  { label: "Rétro", prompt: "Propose une ambiance rétro arcade années 80-90 avec néons colorés" },
  { label: "Japonais", prompt: "Génère une ambiance japonaise zen moderne avec bois clair et éléments traditionnels" },
  { label: "Spatial", prompt: "Crée une ambiance spatiale immersive avec thème galaxie et étoiles" },
  { label: "Immersif", prompt: "Maximise l'immersion avec éclairage dramatique, fog et décorations enveloppantes" },
];

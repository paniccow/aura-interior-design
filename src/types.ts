// ─── Product Database Types ───
export type FurnitureCategory = "sofa" | "bed" | "table" | "chair" | "stool" | "light" | "rug" | "art" | "accent" | "decor" | "storage";

export type RoomType = "Living Room" | "Dining Room" | "Kitchen" | "Bedroom" | "Office" | "Outdoor" | "Bathroom" | "Great Room";

export type StyleName =
  | "Warm Modern" | "Minimalist" | "Bohemian" | "Scandinavian"
  | "Mid-Century" | "Luxury" | "Coastal" | "Japandi"
  | "Industrial" | "Art Deco" | "Rustic" | "Glam"
  | "Transitional" | "Organic Modern";

export type Shape = "rect" | "round" | "oval" | "L" | "bed";
export type BudgetKey = "all" | "u500" | "u1k" | "1k5k" | "5k10k" | "10k25k" | "25k";
export type WallSide = "top" | "bottom" | "left" | "right";

export interface Product {
  id: number;
  n: string;
  r: string;
  p: number;
  l: string;
  u: string;
  c: FurnitureCategory;
  v: string[];
  rm: string[];
  kaa: number;
  pr: string;
  img: string;
}

// ─── Furniture Dimensions ───
export interface FurnitureDim {
  w: number;
  d: number;
  clearF: number;
  clearS: number;
  label: string;
}

export interface ProductDims extends FurnitureDim {
  shape: Shape;
}

// ─── Style & Room Configuration ───
export interface StylePalette {
  colors: string[];
  materials: string[];
  feel: string;
}

export interface RoomNeed {
  essential: string[];
  recommended: string[];
  layout: string;
  minSqft: number;
  zones: string[];
}

// ─── Image Compression ───
export interface CompressedImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

// ─── Chat ───
export interface ChatMessage {
  role: "bot" | "user";
  text: string;
  recs?: Product[];
}

// ─── Design Engine ───
export interface ScoredProduct extends Product {
  _score: number;
  _dims?: ProductDims;
  _footprint?: number;
}

export interface SpatialInfo {
  usableSqft: number;
  totalFootprint: number;
  fillPct: number;
  roomSqft: number;
}

export interface DesignBoard {
  items: ScoredProduct[];
  palette: StylePalette;
  needs: RoomNeed;
  catCounts: Record<string, number>;
  totalBudget: number;
  spatialInfo: SpatialInfo;
}

export interface MoodBoard extends DesignBoard {
  name: string;
  desc: string;
}

// ─── CAD Layout ───
export interface WindowDef {
  x: number;
  y: number;
  w: number;
  side: WallSide;
}

export interface DoorDef {
  x: number;
  y: number;
  w: number;
  side: WallSide;
  swingDir?: "inward" | "outward";
}

export interface ClearanceZone {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  distFt: number;
}

export interface TrafficPath {
  points: { x: number; y: number }[];
  label: string;
}

export interface DimensionLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

export interface PlacedItem {
  item: Product;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  color: string;
  shape: string;
}

export interface CADLayout {
  placed: PlacedItem[];
  canvasW: number;
  canvasH: number;
  roomW: number;
  roomH: number;
  windows: WindowDef[];
  doors: DoorDef[];
  scale: number;
  clearances: ClearanceZone[];
  trafficPaths: TrafficPath[];
  dimensions: DimensionLine[];
}

// ─── Floor Plan Editor State ───
export interface EditorWall {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  thickness: number;
}

export interface EditorWindow {
  id: string;
  wallId: string;
  position: number;
  width: number;
}

export interface EditorDoor {
  id: string;
  wallId: string;
  position: number;
  width: number;
  swingAngle: number;
  swingDir: "left" | "right";
}

export interface EditorFurniture {
  id: string;
  productId: number;
  x: number; y: number;
  w: number; h: number;
  rotation: number;
  locked: boolean;
  color: string;
  shape: string;
  label: string;
  category: string;
}

export interface RoomVertex {
  x: number;
  y: number;
}

export interface EditorRoom {
  vertices: RoomVertex[];
  wallThickness: number;
}

export interface EditorGuide {
  type: "horizontal" | "vertical";
  position: number;
}

export type EditorTool =
  | "select" | "pan" | "wall" | "door" | "window"
  | "furniture" | "measure" | "eraser";

export interface EditorHistoryEntry {
  furniture: EditorFurniture[];
  room: EditorRoom;
  doors: EditorDoor[];
  windows: EditorWindow[];
  walls: EditorWall[];
}

export interface FloorPlanEditorState {
  room: EditorRoom;
  walls: EditorWall[];
  doors: EditorDoor[];
  windows: EditorWindow[];
  furniture: EditorFurniture[];
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  showDimensions: boolean;
  showClearances: boolean;
  showTrafficFlow: boolean;
  zoom: number;
  panX: number;
  panY: number;
  roomWidthFt: number;
  roomHeightFt: number;
  roomType: string;
  style: string;
}

// ─── Project (localStorage persistence) ───
export interface Project {
  id: number;
  name: string;
  room: string | null;
  vibe: string | null;
  items: [number, number][];
  total: number;
  sqft: string | null;
  roomW: string | null;
  roomL: string | null;
  date: number;
  msgs: ChatMessage[];
  vizUrls: Array<{ url: string | null; label: string; concept?: boolean; mood?: string; colors?: string[]; products?: string[] }>;
  cadAnalysis: string | null;
  roomPhoto: { name: string; data: string; type: string } | null;
  roomPhotoAnalysis: string | null;
  bud: string;
  floorPlanState: string | null;
}

// ─── User / Auth ───
export interface AppUser {
  id: string;
  email: string;
  name: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  viz_count: number;
  viz_month: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Admin Stats ───
export interface AdminStats {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  totalVizCount: number;
  recentUsers: Array<{
    email: string;
    name: string;
    plan: string;
    vizCount: number;
    createdAt: string;
  }>;
  userList: Array<{
    email: string;
    name: string;
    plan: string;
    vizCount: number;
    vizMonth: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

// ─── Featured Product Search ───
export interface FeaturedSearchResult {
  products: Product[];
  total: number;
  retailers: string[];
  query: string;
  page: number;
}

// ─── Category Colors ───
export interface CatColorDef {
  bg: string;
  accent: string;
}

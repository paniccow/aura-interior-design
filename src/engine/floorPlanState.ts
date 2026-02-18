/**
 * Floor Plan Editor State Engine
 * Manages room geometry, furniture operations, collision detection,
 * snapping, undo/redo, and serialization for the interactive editor.
 */

import type {
  CADLayout, Product, PlacedItem,
  EditorWall, EditorWindow, EditorDoor, EditorFurniture,
  RoomVertex, EditorRoom, EditorGuide, EditorHistoryEntry,
  FloorPlanEditorState
} from "../types";
import { getProductDims } from "./designEngine";

// ─── Unique ID generation ───
let _idCounter = 0;
export function uid(prefix = "e"): string {
  return prefix + "_" + Date.now().toString(36) + "_" + (++_idCounter).toString(36);
}

// ─── Category color palette (matches cadLayout.ts) ───
const CAT_COLORS: Record<string, string> = {
  sofa: "#7B6650", bed: "#8B7060", table: "#6B7B5B", chair: "#7B6B58",
  stool: "#8B7B60", light: "#A89040", rug: "#8B7B68", art: "#9B7B6B",
  accent: "#7B7060", decor: "#7B7060", storage: "#6B7060"
};

// ═══════════════════════════════════════════════════════════════
//  ROOM CREATION
// ═══════════════════════════════════════════════════════════════

export function createEmptyRoom(widthFt: number, heightFt: number): EditorRoom {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: widthFt, y: 0 },
      { x: widthFt, y: heightFt },
      { x: 0, y: heightFt },
    ],
    wallThickness: 0.5,
  };
}

export function createLShapedRoom(
  w1: number, h1: number,
  w2: number, h2: number
): EditorRoom {
  // L-shape: main rectangle w1×h1 with a cut-out in top-right
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: w2, y: 0 },
      { x: w2, y: h1 - h2 },
      { x: w1, y: h1 - h2 },
      { x: w1, y: h1 },
      { x: 0, y: h1 },
    ],
    wallThickness: 0.5,
  };
}

// ═══════════════════════════════════════════════════════════════
//  ROOM GEOMETRY OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function getRoomArea(room: EditorRoom): number {
  // Shoelace formula for polygon area
  const v = room.vertices;
  let area = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    area += v[i].x * v[j].y;
    area -= v[j].x * v[i].y;
  }
  return Math.abs(area) / 2;
}

export function getRoomBounds(room: EditorRoom): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of room.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

export function getWallSegments(room: EditorRoom): EditorWall[] {
  const walls: EditorWall[] = [];
  const v = room.vertices;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    walls.push({
      id: "wall_" + i,
      x1: v[i].x, y1: v[i].y,
      x2: v[j].x, y2: v[j].y,
      thickness: room.wallThickness,
    });
  }
  return walls;
}

export function addVertex(room: EditorRoom, afterIndex: number, vertex: RoomVertex): EditorRoom {
  const newVerts = [...room.vertices];
  newVerts.splice(afterIndex + 1, 0, vertex);
  return { ...room, vertices: newVerts };
}

export function moveVertex(room: EditorRoom, index: number, newPos: RoomVertex): EditorRoom {
  const newVerts = [...room.vertices];
  newVerts[index] = newPos;
  return { ...room, vertices: newVerts };
}

export function removeVertex(room: EditorRoom, index: number): EditorRoom {
  if (room.vertices.length <= 3) return room; // minimum triangle
  const newVerts = room.vertices.filter((_, i) => i !== index);
  return { ...room, vertices: newVerts };
}

// ═══════════════════════════════════════════════════════════════
//  POINT-IN-POLYGON
// ═══════════════════════════════════════════════════════════════

export function pointInPolygon(px: number, py: number, vertices: RoomVertex[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function rectInsideRoom(
  cx: number, cy: number, w: number, h: number,
  rotation: number, room: EditorRoom
): boolean {
  // Check all 4 corners of the rotated rect
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = w / 2, hh = h / 2;
  const corners = [
    { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos },
    { x: cx - hw * cos - hh * sin, y: cy - hw * sin + hh * cos },
    { x: cx - hw * cos + hh * sin, y: cy - hw * sin - hh * cos },
    { x: cx + hw * cos + hh * sin, y: cy + hw * sin - hh * cos },
  ];
  return corners.every(c => pointInPolygon(c.x, c.y, room.vertices));
}

// ═══════════════════════════════════════════════════════════════
//  COLLISION DETECTION
// ═══════════════════════════════════════════════════════════════

export function checkCollision(
  furn: EditorFurniture,
  others: EditorFurniture[],
  padding = 0
): boolean {
  // Simple AABB collision (ignoring rotation for performance)
  const ax1 = furn.x - furn.w / 2 - padding;
  const ay1 = furn.y - furn.h / 2 - padding;
  const ax2 = furn.x + furn.w / 2 + padding;
  const ay2 = furn.y + furn.h / 2 + padding;
  for (const o of others) {
    if (o.id === furn.id) continue;
    if (o.category === "rug" || o.category === "light" || o.category === "art") continue;
    const bx1 = o.x - o.w / 2;
    const by1 = o.y - o.h / 2;
    const bx2 = o.x + o.w / 2;
    const by2 = o.y + o.h / 2;
    if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  SNAPPING
// ═══════════════════════════════════════════════════════════════

export function snapToGrid(x: number, y: number, gridSize: number): { x: number; y: number } {
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize,
  };
}

export function getSmartSnaps(
  moving: EditorFurniture,
  others: EditorFurniture[],
  room: EditorRoom,
  threshold = 0.3
): EditorGuide[] {
  const guides: EditorGuide[] = [];
  const mx1 = moving.x - moving.w / 2;
  const mx2 = moving.x + moving.w / 2;
  const my1 = moving.y - moving.h / 2;
  const my2 = moving.y + moving.h / 2;
  const mcx = moving.x;
  const mcy = moving.y;

  for (const o of others) {
    if (o.id === moving.id) continue;
    const ox1 = o.x - o.w / 2;
    const ox2 = o.x + o.w / 2;
    const oy1 = o.y - o.h / 2;
    const oy2 = o.y + o.h / 2;
    const ocx = o.x;
    const ocy = o.y;

    // Horizontal guides (y alignment)
    if (Math.abs(my1 - oy1) < threshold) guides.push({ type: "horizontal", position: oy1 });
    if (Math.abs(my2 - oy2) < threshold) guides.push({ type: "horizontal", position: oy2 });
    if (Math.abs(mcy - ocy) < threshold) guides.push({ type: "horizontal", position: ocy });
    if (Math.abs(my1 - oy2) < threshold) guides.push({ type: "horizontal", position: oy2 });
    if (Math.abs(my2 - oy1) < threshold) guides.push({ type: "horizontal", position: oy1 });

    // Vertical guides (x alignment)
    if (Math.abs(mx1 - ox1) < threshold) guides.push({ type: "vertical", position: ox1 });
    if (Math.abs(mx2 - ox2) < threshold) guides.push({ type: "vertical", position: ox2 });
    if (Math.abs(mcx - ocx) < threshold) guides.push({ type: "vertical", position: ocx });
    if (Math.abs(mx1 - ox2) < threshold) guides.push({ type: "vertical", position: ox2 });
    if (Math.abs(mx2 - ox1) < threshold) guides.push({ type: "vertical", position: ox1 });
  }

  // Room wall guides
  const bounds = getRoomBounds(room);
  if (Math.abs(mx1 - bounds.minX) < threshold) guides.push({ type: "vertical", position: bounds.minX });
  if (Math.abs(mx2 - bounds.maxX) < threshold) guides.push({ type: "vertical", position: bounds.maxX });
  if (Math.abs(my1 - bounds.minY) < threshold) guides.push({ type: "horizontal", position: bounds.minY });
  if (Math.abs(my2 - bounds.maxY) < threshold) guides.push({ type: "horizontal", position: bounds.maxY });

  // Center of room guides
  const rcx = (bounds.minX + bounds.maxX) / 2;
  const rcy = (bounds.minY + bounds.maxY) / 2;
  if (Math.abs(mcx - rcx) < threshold) guides.push({ type: "vertical", position: rcx });
  if (Math.abs(mcy - rcy) < threshold) guides.push({ type: "horizontal", position: rcy });

  // Deduplicate
  const seen = new Set<string>();
  return guides.filter(g => {
    const key = g.type + ":" + g.position.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applySmartSnap(
  x: number, y: number, w: number, h: number,
  others: EditorFurniture[],
  room: EditorRoom,
  threshold = 0.3
): { x: number; y: number; guides: EditorGuide[] } {
  const tempFurn: EditorFurniture = {
    id: "__snap__", productId: 0, x, y, w, h,
    rotation: 0, locked: false, color: "", shape: "", label: "", category: ""
  };
  const guides = getSmartSnaps(tempFurn, others, room, threshold);

  let sx = x, sy = y;
  const x1 = x - w / 2, x2 = x + w / 2;
  const y1 = y - h / 2, y2 = y + h / 2;

  for (const g of guides) {
    if (g.type === "vertical") {
      if (Math.abs(x1 - g.position) < threshold) sx = g.position + w / 2;
      else if (Math.abs(x2 - g.position) < threshold) sx = g.position - w / 2;
      else if (Math.abs(x - g.position) < threshold) sx = g.position;
    } else {
      if (Math.abs(y1 - g.position) < threshold) sy = g.position + h / 2;
      else if (Math.abs(y2 - g.position) < threshold) sy = g.position - h / 2;
      else if (Math.abs(y - g.position) < threshold) sy = g.position;
    }
  }
  return { x: sx, y: sy, guides };
}

// ═══════════════════════════════════════════════════════════════
//  FURNITURE OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function moveFurniture(
  furniture: EditorFurniture[],
  id: string,
  newX: number,
  newY: number
): EditorFurniture[] {
  return furniture.map(f => f.id === id ? { ...f, x: newX, y: newY } : f);
}

export function rotateFurniture(
  furniture: EditorFurniture[],
  id: string,
  angleDeg: number
): EditorFurniture[] {
  return furniture.map(f => f.id === id ? { ...f, rotation: (f.rotation + angleDeg) % 360 } : f);
}

export function resizeFurniture(
  furniture: EditorFurniture[],
  id: string,
  newW: number,
  newH: number
): EditorFurniture[] {
  return furniture.map(f => f.id === id ? { ...f, w: Math.max(0.5, newW), h: Math.max(0.5, newH) } : f);
}

export function deleteFurniture(
  furniture: EditorFurniture[],
  id: string
): EditorFurniture[] {
  return furniture.filter(f => f.id !== id);
}

export function duplicateFurniture(
  furniture: EditorFurniture[],
  id: string
): EditorFurniture[] {
  const orig = furniture.find(f => f.id === id);
  if (!orig) return furniture;
  const dup: EditorFurniture = {
    ...orig,
    id: uid("furn"),
    x: orig.x + 1.5,
    y: orig.y + 1.5,
  };
  return [...furniture, dup];
}

export function toggleLock(
  furniture: EditorFurniture[],
  id: string
): EditorFurniture[] {
  return furniture.map(f => f.id === id ? { ...f, locked: !f.locked } : f);
}

// ═══════════════════════════════════════════════════════════════
//  DOOR & WINDOW OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function addDoorToWall(
  doors: EditorDoor[],
  wallId: string,
  position: number,
  width = 3
): EditorDoor[] {
  return [
    ...doors,
    {
      id: uid("door"),
      wallId,
      position: Math.max(0.1, Math.min(0.9, position)),
      width,
      swingAngle: 90,
      swingDir: "left",
    },
  ];
}

export function addWindowToWall(
  windows: EditorWindow[],
  wallId: string,
  position: number,
  width = 3
): EditorWindow[] {
  return [
    ...windows,
    {
      id: uid("win"),
      wallId,
      position: Math.max(0.1, Math.min(0.9, position)),
      width,
    },
  ];
}

export function removeDoor(doors: EditorDoor[], id: string): EditorDoor[] {
  return doors.filter(d => d.id !== id);
}

export function removeWindow(windows: EditorWindow[], id: string): EditorWindow[] {
  return windows.filter(w => w.id !== id);
}

// ═══════════════════════════════════════════════════════════════
//  UNDO / REDO SNAPSHOTS
// ═══════════════════════════════════════════════════════════════

export function createSnapshot(state: FloorPlanEditorState): EditorHistoryEntry {
  return {
    furniture: JSON.parse(JSON.stringify(state.furniture)),
    room: JSON.parse(JSON.stringify(state.room)),
    doors: JSON.parse(JSON.stringify(state.doors)),
    windows: JSON.parse(JSON.stringify(state.windows)),
    walls: JSON.parse(JSON.stringify(state.walls)),
  };
}

export function restoreSnapshot(
  state: FloorPlanEditorState,
  snapshot: EditorHistoryEntry
): FloorPlanEditorState {
  return {
    ...state,
    furniture: snapshot.furniture,
    room: snapshot.room,
    doors: snapshot.doors,
    windows: snapshot.windows,
    walls: snapshot.walls,
  };
}

// ═══════════════════════════════════════════════════════════════
//  CONVERT CADLayout → EditorState
// ═══════════════════════════════════════════════════════════════

export function createEditorStateFromCAD(
  cadLayout: CADLayout,
  items: Product[],
  roomType: string,
  style: string
): FloorPlanEditorState {
  const { roomW, roomH, placed, windows, doors, scale } = cadLayout;

  // Convert placed items → EditorFurniture (positions in feet)
  const furniture: EditorFurniture[] = placed.map((p, i) => {
    const dims = getProductDims(p.item);
    return {
      id: uid("furn"),
      productId: p.item.id,
      x: (p.x + p.w / 2) / scale,  // convert px center to feet
      y: (p.y + p.h / 2) / scale,
      w: dims.w,
      h: dims.d,
      rotation: p.rotation || 0,
      locked: false,
      color: p.color || CAT_COLORS[p.item.c] || "#6B685B",
      shape: dims.shape || "rect",
      label: dims.label || p.item.c,
      category: p.item.c,
    };
  });

  // Convert windows
  const editorWindows: EditorWindow[] = windows.map((w, i) => ({
    id: uid("win"),
    wallId: w.side === "top" ? "wall_0" : w.side === "right" ? "wall_1" : w.side === "bottom" ? "wall_2" : "wall_3",
    position: w.side === "top" || w.side === "bottom"
      ? (w.x + w.w / 2) / (roomW * scale)
      : (w.y + w.w / 2) / (roomH * scale),
    width: w.w / scale,
  }));

  // Convert doors
  const editorDoors: EditorDoor[] = doors.map((d, i) => ({
    id: uid("door"),
    wallId: d.side === "top" ? "wall_0" : d.side === "right" ? "wall_1" : d.side === "bottom" ? "wall_2" : "wall_3",
    position: d.side === "top" || d.side === "bottom"
      ? (d.x + d.w / 2) / (roomW * scale)
      : (d.y + d.w / 2) / (roomH * scale),
    width: d.w / scale,
    swingAngle: 90,
    swingDir: "left" as const,
  }));

  const room = createEmptyRoom(roomW, roomH);
  const walls = getWallSegments(room);

  return {
    room,
    walls,
    doors: editorDoors,
    windows: editorWindows,
    furniture,
    gridSize: 1,
    snapToGrid: true,
    showGrid: true,
    showDimensions: true,
    showClearances: true,
    showTrafficFlow: true,
    zoom: 1,
    panX: 0,
    panY: 0,
    roomWidthFt: roomW,
    roomHeightFt: roomH,
    roomType,
    style,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SERIALIZATION
// ═══════════════════════════════════════════════════════════════

export function serializeEditorState(state: FloorPlanEditorState): string {
  return JSON.stringify(state);
}

export function deserializeEditorState(json: string): FloorPlanEditorState | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && parsed.room && parsed.furniture) return parsed as FloorPlanEditorState;
    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  DISTANCE / MEASUREMENT HELPERS
// ═══════════════════════════════════════════════════════════════

export function distanceFt(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function formatDist(ft: number): string {
  const rounded = Math.round(ft * 10) / 10;
  if (rounded >= 1) return rounded + "'";
  const inches = Math.round(ft * 12);
  return inches + '"';
}

// Wall segment helper: get point on wall at position t (0-1)
export function wallPointAt(wall: EditorWall, t: number): { x: number; y: number } {
  return {
    x: wall.x1 + (wall.x2 - wall.x1) * t,
    y: wall.y1 + (wall.y2 - wall.y1) * t,
  };
}

export function wallLength(wall: EditorWall): number {
  return distanceFt(wall.x1, wall.y1, wall.x2, wall.y2);
}

export function wallAngle(wall: EditorWall): number {
  return Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1);
}

// Find nearest wall segment to a point
export function nearestWall(
  px: number, py: number, walls: EditorWall[], threshold = 0.5
): { wall: EditorWall; t: number; dist: number } | null {
  let best: { wall: EditorWall; t: number; dist: number } | null = null;
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((px - w.x1) * dx + (py - w.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const closestX = w.x1 + t * dx;
    const closestY = w.y1 + t * dy;
    const d = distanceFt(px, py, closestX, closestY);
    if (d < threshold && (!best || d < best.dist)) {
      best = { wall: w, t, dist: d };
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════
//  CLEARANCE & TRAFFIC COMPUTATION (for overlay)
// ═══════════════════════════════════════════════════════════════

export interface ComputedClearance {
  x: number; y: number; w: number; h: number;
  label: string;
}

export function computeClearances(furniture: EditorFurniture[]): ComputedClearance[] {
  const clearances: ComputedClearance[] = [];
  for (const f of furniture) {
    if (["rug", "art", "light", "decor"].includes(f.category)) continue;
    // Standard clearances: 2.5ft front, 1.5ft sides for large items; 1.5ft/1ft for smaller
    const isLarge = f.category === "sofa" || f.category === "bed";
    const clearF = isLarge ? 2.5 : 1.5;
    const clearS = isLarge ? 1.5 : 1;

    // Front clearance (below item in default orientation)
    clearances.push({
      x: f.x - f.w / 2,
      y: f.y + f.h / 2,
      w: f.w,
      h: clearF,
      label: clearF + "'",
    });

    // Side clearances
    if (f.w > 2) {
      clearances.push({
        x: f.x - f.w / 2 - clearS,
        y: f.y - f.h / 2,
        w: clearS,
        h: f.h,
        label: clearS + "'",
      });
      clearances.push({
        x: f.x + f.w / 2,
        y: f.y - f.h / 2,
        w: clearS,
        h: f.h,
        label: clearS + "'",
      });
    }
  }
  return clearances;
}

export interface ComputedTrafficPath {
  points: { x: number; y: number }[];
  label: string;
}

export function computeTrafficPaths(
  furniture: EditorFurniture[],
  doors: EditorDoor[],
  walls: EditorWall[],
  room: EditorRoom
): ComputedTrafficPath[] {
  const paths: ComputedTrafficPath[] = [];
  const bounds = getRoomBounds(room);
  const roomW = bounds.maxX - bounds.minX;
  const roomH = bounds.maxY - bounds.minY;

  // Find door location
  let doorPt = { x: roomW * 0.7, y: roomH };
  if (doors.length > 0 && walls.length > 0) {
    const d = doors[0];
    const w = walls.find(w => w.id === d.wallId);
    if (w) {
      const pt = wallPointAt(w, d.position);
      doorPt = pt;
    }
  }

  // Main path: door → center → primary anchor
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const primaryPts = [doorPt, center];

  // Find main anchor (sofa or bed or table)
  const anchor = furniture.find(f => f.category === "sofa") ||
    furniture.find(f => f.category === "bed") ||
    furniture.find(f => f.category === "table");
  if (anchor) {
    primaryPts.push({ x: anchor.x, y: anchor.y + anchor.h / 2 + 1.5 });
  }

  if (primaryPts.length >= 2) {
    paths.push({ points: primaryPts, label: "Main Path" });
  }

  // Perimeter walkway
  const offset = 2.5;
  paths.push({
    points: [
      { x: bounds.minX + offset, y: bounds.minY + offset },
      { x: bounds.maxX - offset, y: bounds.minY + offset },
      { x: bounds.maxX - offset, y: bounds.maxY - offset },
      { x: bounds.minX + offset, y: bounds.maxY - offset },
      { x: bounds.minX + offset, y: bounds.minY + offset },
    ],
    label: "2.5' Walkway"
  });

  return paths;
}

// ═══════════════════════════════════════════════════════════════
//  MULTI-SELECT OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function selectAll(furniture: EditorFurniture[]): string[] {
  return furniture.map(f => f.id);
}

export function invertSelection(furniture: EditorFurniture[], selected: string[]): string[] {
  const s = new Set(selected);
  return furniture.filter(f => !s.has(f.id)).map(f => f.id);
}

export function selectByCategory(furniture: EditorFurniture[], category: string): string[] {
  return furniture.filter(f => f.category === category).map(f => f.id);
}

export function selectInRect(
  furniture: EditorFurniture[],
  x1: number, y1: number, x2: number, y2: number
): string[] {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return furniture.filter(f =>
    f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY
  ).map(f => f.id);
}

export function moveMultiple(
  furniture: EditorFurniture[], ids: string[], dx: number, dy: number
): EditorFurniture[] {
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, x: f.x + dx, y: f.y + dy } : f);
}

export function deleteMultiple(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const s = new Set(ids);
  return furniture.filter(f => !s.has(f.id));
}

export function duplicateMultiple(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const s = new Set(ids);
  const originals = furniture.filter(f => s.has(f.id));
  const dupes = originals.map(f => ({ ...f, id: uid("furn"), x: f.x + 1.5, y: f.y + 1.5 }));
  return [...furniture, ...dupes];
}

export function rotateMultiple(
  furniture: EditorFurniture[], ids: string[], angle: number
): EditorFurniture[] {
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, rotation: (f.rotation + angle) % 360 } : f);
}

export function lockMultiple(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, locked: true } : f);
}

export function unlockMultiple(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, locked: false } : f);
}

// ═══════════════════════════════════════════════════════════════
//  ALIGN & DISTRIBUTE
// ═══════════════════════════════════════════════════════════════

function getSelected(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const s = new Set(ids);
  return furniture.filter(f => s.has(f.id));
}

export function alignLeft(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 2) return furniture;
  const minX = Math.min(...sel.map(f => f.x - f.w / 2));
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, x: minX + f.w / 2 } : f);
}

export function alignRight(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 2) return furniture;
  const maxX = Math.max(...sel.map(f => f.x + f.w / 2));
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, x: maxX - f.w / 2 } : f);
}

export function alignTop(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 2) return furniture;
  const minY = Math.min(...sel.map(f => f.y - f.h / 2));
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, y: minY + f.h / 2 } : f);
}

export function alignBottom(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 2) return furniture;
  const maxY = Math.max(...sel.map(f => f.y + f.h / 2));
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, y: maxY - f.h / 2 } : f);
}

export function alignCenterH(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 2) return furniture;
  const avg = sel.reduce((a, f) => a + f.x, 0) / sel.length;
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, x: avg } : f);
}

export function alignCenterV(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 2) return furniture;
  const avg = sel.reduce((a, f) => a + f.y, 0) / sel.length;
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, y: avg } : f);
}

export function distributeHorizontal(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 3) return furniture;
  const sorted = [...sel].sort((a, b) => a.x - b.x);
  const minX = sorted[0].x, maxX = sorted[sorted.length - 1].x;
  const step = (maxX - minX) / (sorted.length - 1);
  const posMap = new Map<string, number>();
  sorted.forEach((f, i) => posMap.set(f.id, minX + i * step));
  return furniture.map(f => posMap.has(f.id) ? { ...f, x: posMap.get(f.id)! } : f);
}

export function distributeVertical(furniture: EditorFurniture[], ids: string[]): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length < 3) return furniture;
  const sorted = [...sel].sort((a, b) => a.y - b.y);
  const minY = sorted[0].y, maxY = sorted[sorted.length - 1].y;
  const step = (maxY - minY) / (sorted.length - 1);
  const posMap = new Map<string, number>();
  sorted.forEach((f, i) => posMap.set(f.id, minY + i * step));
  return furniture.map(f => posMap.has(f.id) ? { ...f, y: posMap.get(f.id)! } : f);
}

// ═══════════════════════════════════════════════════════════════
//  MORE ROOM SHAPES
// ═══════════════════════════════════════════════════════════════

export function createUShapedRoom(w: number, h: number, cutW: number, cutH: number): EditorRoom {
  return {
    vertices: [
      { x: 0, y: 0 }, { x: w, y: 0 },
      { x: w, y: h }, { x: w - cutW, y: h },
      { x: w - cutW, y: h - cutH }, { x: cutW, y: h - cutH },
      { x: cutW, y: h }, { x: 0, y: h },
    ],
    wallThickness: 0.5,
  };
}

export function createTShapedRoom(w: number, h: number, stemW: number, stemH: number): EditorRoom {
  const sx = (w - stemW) / 2;
  return {
    vertices: [
      { x: sx, y: 0 }, { x: sx + stemW, y: 0 },
      { x: sx + stemW, y: stemH }, { x: w, y: stemH },
      { x: w, y: h }, { x: 0, y: h },
      { x: 0, y: stemH }, { x: sx, y: stemH },
    ],
    wallThickness: 0.5,
  };
}

export function createCustomPolygonRoom(vertices: RoomVertex[]): EditorRoom {
  return { vertices: [...vertices], wallThickness: 0.5 };
}

export function offsetPolygon(vertices: RoomVertex[], offset: number): RoomVertex[] {
  const n = vertices.length;
  const result: RoomVertex[] = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    const nx1 = -dy1 / len1, ny1 = dx1 / len1;
    const nx2 = -dy2 / len2, ny2 = dx2 / len2;
    const nx = (nx1 + nx2) / 2, ny = (ny1 + ny2) / 2;
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    result.push({ x: curr.x + (nx / nl) * offset, y: curr.y + (ny / nl) * offset });
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
//  Z-ORDERING
// ═══════════════════════════════════════════════════════════════

export function bringToFront(furniture: EditorFurniture[], id: string): EditorFurniture[] {
  const item = furniture.find(f => f.id === id);
  if (!item) return furniture;
  return [...furniture.filter(f => f.id !== id), item];
}

export function sendToBack(furniture: EditorFurniture[], id: string): EditorFurniture[] {
  const item = furniture.find(f => f.id === id);
  if (!item) return furniture;
  return [item, ...furniture.filter(f => f.id !== id)];
}

export function bringForward(furniture: EditorFurniture[], id: string): EditorFurniture[] {
  const idx = furniture.findIndex(f => f.id === id);
  if (idx < 0 || idx >= furniture.length - 1) return furniture;
  const arr = [...furniture];
  [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
  return arr;
}

export function sendBackward(furniture: EditorFurniture[], id: string): EditorFurniture[] {
  const idx = furniture.findIndex(f => f.id === id);
  if (idx <= 0) return furniture;
  const arr = [...furniture];
  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  return arr;
}

// ═══════════════════════════════════════════════════════════════
//  FURNITURE GROUPING
// ═══════════════════════════════════════════════════════════════

export interface EditorGroup {
  id: string;
  name: string;
  itemIds: string[];
  locked: boolean;
}

export function createGroup(name: string, itemIds: string[]): EditorGroup {
  return { id: uid("grp"), name, itemIds: [...itemIds], locked: false };
}

export function ungroupItems(groups: EditorGroup[], groupId: string): EditorGroup[] {
  return groups.filter(g => g.id !== groupId);
}

export function getGroupForItem(groups: EditorGroup[], itemId: string): EditorGroup | null {
  return groups.find(g => g.itemIds.includes(itemId)) || null;
}

export function moveGroup(
  furniture: EditorFurniture[], group: EditorGroup, dx: number, dy: number
): EditorFurniture[] {
  return moveMultiple(furniture, group.itemIds, dx, dy);
}

export function getGroupBounds(
  furniture: EditorFurniture[], group: EditorGroup
): { minX: number; minY: number; maxX: number; maxY: number } {
  const items = furniture.filter(f => group.itemIds.includes(f.id));
  if (items.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...items.map(f => f.x - f.w / 2)),
    minY: Math.min(...items.map(f => f.y - f.h / 2)),
    maxX: Math.max(...items.map(f => f.x + f.w / 2)),
    maxY: Math.max(...items.map(f => f.y + f.h / 2)),
  };
}

// ═══════════════════════════════════════════════════════════════
//  FLOOR MATERIALS
// ═══════════════════════════════════════════════════════════════

export interface FloorMaterial {
  id: string;
  name: string;
  color: string;
  pattern: "solid" | "wood" | "tile" | "marble" | "carpet" | "concrete";
  scale: number;
}

export const FLOOR_MATERIALS: FloorMaterial[] = [
  { id: "oak_light", name: "Light Oak", color: "#DEC9A0", pattern: "wood", scale: 1 },
  { id: "oak_dark", name: "Dark Oak", color: "#8B6F47", pattern: "wood", scale: 1 },
  { id: "walnut", name: "Walnut", color: "#5C4033", pattern: "wood", scale: 1 },
  { id: "maple", name: "Maple", color: "#D4B896", pattern: "wood", scale: 1 },
  { id: "white_tile", name: "White Tile", color: "#F5F5F0", pattern: "tile", scale: 1 },
  { id: "gray_tile", name: "Gray Tile", color: "#C8C8C0", pattern: "tile", scale: 1 },
  { id: "marble_white", name: "White Marble", color: "#F0EDE8", pattern: "marble", scale: 1 },
  { id: "marble_black", name: "Black Marble", color: "#2A2A28", pattern: "marble", scale: 1 },
  { id: "carpet_beige", name: "Beige Carpet", color: "#D4C8B0", pattern: "carpet", scale: 1 },
  { id: "carpet_gray", name: "Gray Carpet", color: "#A8A8A0", pattern: "carpet", scale: 1 },
  { id: "concrete", name: "Concrete", color: "#B0B0A8", pattern: "concrete", scale: 1 },
  { id: "white", name: "White", color: "#FFFFFF", pattern: "solid", scale: 1 },
];

// ═══════════════════════════════════════════════════════════════
//  ROOM TEMPLATES
// ═══════════════════════════════════════════════════════════════

export interface RoomTemplate {
  id: string;
  name: string;
  category: string;
  vertices: RoomVertex[];
  description: string;
  widthFt: number;
  heightFt: number;
}

export const ROOM_TEMPLATES: RoomTemplate[] = [
  { id: "rect_small", name: "Small Rectangle", category: "Basic", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 12 }, { x: 0, y: 12 }], description: "10×12 compact room", widthFt: 10, heightFt: 12 },
  { id: "rect_medium", name: "Medium Rectangle", category: "Basic", vertices: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 16 }, { x: 0, y: 16 }], description: "14×16 standard room", widthFt: 14, heightFt: 16 },
  { id: "rect_large", name: "Large Rectangle", category: "Basic", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 18 }, { x: 0, y: 18 }], description: "20×18 spacious room", widthFt: 20, heightFt: 18 },
  { id: "square", name: "Square Room", category: "Basic", vertices: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 15 }], description: "15×15 square", widthFt: 15, heightFt: 15 },
  { id: "l_shape", name: "L-Shape", category: "Complex", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 18, y: 8 }, { x: 18, y: 16 }, { x: 0, y: 16 }], description: "L-shaped living area", widthFt: 18, heightFt: 16 },
  { id: "u_shape", name: "U-Shape", category: "Complex", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 16 }, { x: 14, y: 16 }, { x: 14, y: 8 }, { x: 6, y: 8 }, { x: 6, y: 16 }, { x: 0, y: 16 }], description: "U-shaped with inner courtyard", widthFt: 20, heightFt: 16 },
  { id: "studio", name: "Studio Apartment", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 14 }, { x: 0, y: 14 }], description: "25×14 open studio", widthFt: 25, heightFt: 14 },
  { id: "master_bed", name: "Master Bedroom", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 14 }, { x: 0, y: 14 }], description: "16×14 with ensuite space", widthFt: 16, heightFt: 14 },
  { id: "open_kitchen", name: "Open Kitchen", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 12 }, { x: 12, y: 12 }, { x: 12, y: 20 }, { x: 0, y: 20 }], description: "Kitchen with dining extension", widthFt: 18, heightFt: 20 },
  { id: "great_room", name: "Great Room", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 28, y: 0 }, { x: 28, y: 22 }, { x: 0, y: 22 }], description: "28×22 grand space", widthFt: 28, heightFt: 22 },
  { id: "alcove", name: "Room with Alcove", category: "Complex", vertices: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 }, { x: 20, y: 6 }, { x: 20, y: 12 }, { x: 16, y: 12 }, { x: 16, y: 18 }, { x: 0, y: 18 }], description: "16×18 with side alcove", widthFt: 20, heightFt: 18 },
  { id: "bay_window", name: "Bay Window Room", category: "Complex", vertices: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 16, y: 3 }, { x: 16, y: 9 }, { x: 14, y: 12 }, { x: 0, y: 12 }], description: "14×12 with bay bump-out", widthFt: 16, heightFt: 12 },
  { id: "office", name: "Home Office", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }], description: "12×10 workspace", widthFt: 12, heightFt: 10 },
  { id: "dining", name: "Formal Dining", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 12 }, { x: 0, y: 12 }], description: "14×12 dining room", widthFt: 14, heightFt: 12 },
  { id: "nursery", name: "Nursery", category: "Residential", vertices: [{ x: 0, y: 0 }, { x: 11, y: 0 }, { x: 11, y: 10 }, { x: 0, y: 10 }], description: "11×10 baby room", widthFt: 11, heightFt: 10 },
];

export function applyRoomTemplate(
  state: FloorPlanEditorState, templateId: string
): FloorPlanEditorState {
  const tpl = ROOM_TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return state;
  const room: EditorRoom = { vertices: [...tpl.vertices], wallThickness: 0.5 };
  const walls = getWallSegments(room);
  return { ...state, room, walls, roomWidthFt: tpl.widthFt, roomHeightFt: tpl.heightFt };
}

// ═══════════════════════════════════════════════════════════════
//  ADVANCED SNAP
// ═══════════════════════════════════════════════════════════════

export function snapToWall(
  x: number, y: number, room: EditorRoom, threshold: number
): { x: number; y: number; snapped: boolean } {
  const walls = getWallSegments(room);
  const nw = nearestWall(x, y, walls, threshold);
  if (!nw) return { x, y, snapped: false };
  const pt = wallPointAt(nw.wall, nw.t);
  return { x: pt.x, y: pt.y, snapped: true };
}

export function snapToAngle(
  x: number, y: number, origin: { x: number; y: number }, angleIncrement: number
): { x: number; y: number } {
  const dx = x - origin.x, dy = y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (angleIncrement * Math.PI / 180)) * (angleIncrement * Math.PI / 180);
  return { x: origin.x + dist * Math.cos(snapped), y: origin.y + dist * Math.sin(snapped) };
}

export function getDistanceGuides(
  moving: EditorFurniture, others: EditorFurniture[], room: EditorRoom
): EditorGuide[] {
  const guides: EditorGuide[] = [];
  const bounds = getRoomBounds(room);
  const distToLeft = moving.x - moving.w / 2 - bounds.minX;
  const distToRight = bounds.maxX - (moving.x + moving.w / 2);
  const distToTop = moving.y - moving.h / 2 - bounds.minY;
  const distToBottom = bounds.maxY - (moving.y + moving.h / 2);
  // Balanced centering guides
  if (Math.abs(distToLeft - distToRight) < 0.3) {
    guides.push({ type: "vertical", position: (bounds.minX + bounds.maxX) / 2 });
  }
  if (Math.abs(distToTop - distToBottom) < 0.3) {
    guides.push({ type: "horizontal", position: (bounds.minY + bounds.maxY) / 2 });
  }
  return guides;
}

// ═══════════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validatePlacement(
  furniture: EditorFurniture[], room: EditorRoom
): { id: string; issue: string }[] {
  const issues: { id: string; issue: string }[] = [];
  for (const f of furniture) {
    if (!pointInPolygon(f.x, f.y, room.vertices)) {
      issues.push({ id: f.id, issue: "Center outside room" });
    }
    if (!rectInsideRoom(f.x, f.y, f.w, f.h, f.rotation, room)) {
      issues.push({ id: f.id, issue: "Extends beyond walls" });
    }
  }
  return issues;
}

export function getOverlappingPairs(
  furniture: EditorFurniture[]
): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      const a = furniture[i], b = furniture[j];
      if (a.category === "rug" || b.category === "rug") continue;
      if (a.category === "light" || b.category === "light") continue;
      if (a.category === "art" || b.category === "art") continue;
      const ax1 = a.x - a.w / 2, ax2 = a.x + a.w / 2;
      const ay1 = a.y - a.h / 2, ay2 = a.y + a.h / 2;
      const bx1 = b.x - b.w / 2, bx2 = b.x + b.w / 2;
      const by1 = b.y - b.h / 2, by2 = b.y + b.h / 2;
      if (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1) {
        pairs.push([a.id, b.id]);
      }
    }
  }
  return pairs;
}

export function checkMinimumClearance(
  furniture: EditorFurniture[], minClearance: number
): { id: string; adjacentId: string; clearance: number }[] {
  const violations: { id: string; adjacentId: string; clearance: number }[] = [];
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      const a = furniture[i], b = furniture[j];
      if (["rug", "light", "art", "decor"].includes(a.category)) continue;
      if (["rug", "light", "art", "decor"].includes(b.category)) continue;
      const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
      const dy = Math.max(0, Math.abs(a.y - b.y) - (a.h + b.h) / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minClearance && dist > 0) {
        violations.push({ id: a.id, adjacentId: b.id, clearance: dist });
      }
    }
  }
  return violations;
}

// ═══════════════════════════════════════════════════════════════
//  MEASUREMENT HELPERS (expanded)
// ═══════════════════════════════════════════════════════════════

export function getRoomPerimeter(room: EditorRoom): number {
  const v = room.vertices;
  let p = 0;
  for (let i = 0; i < v.length; i++) {
    const j = (i + 1) % v.length;
    p += distanceFt(v[i].x, v[i].y, v[j].x, v[j].y);
  }
  return p;
}

export function getWallLengths(room: EditorRoom): { wallId: string; length: number }[] {
  const v = room.vertices;
  return v.map((_, i) => {
    const j = (i + 1) % v.length;
    return { wallId: "wall_" + i, length: distanceFt(v[i].x, v[i].y, v[j].x, v[j].y) };
  });
}

export function getCornerAngles(room: EditorRoom): number[] {
  const v = room.vertices;
  const n = v.length;
  return v.map((_, i) => {
    const prev = v[(i - 1 + n) % n];
    const curr = v[i];
    const next = v[(i + 1) % n];
    const a1 = Math.atan2(prev.y - curr.y, prev.x - curr.x);
    const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
    let angle = (a2 - a1) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return angle;
  });
}

export function getSelectionBounds(
  furniture: EditorFurniture[], ids: string[]
): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  const sel = getSelected(furniture, ids);
  if (sel.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  const minX = Math.min(...sel.map(f => f.x - f.w / 2));
  const minY = Math.min(...sel.map(f => f.y - f.h / 2));
  const maxX = Math.max(...sel.map(f => f.x + f.w / 2));
  const maxY = Math.max(...sel.map(f => f.y + f.h / 2));
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ═══════════════════════════════════════════════════════════════
//  TRANSFORM HELPERS
// ═══════════════════════════════════════════════════════════════

export function flipHorizontal(
  furniture: EditorFurniture[], ids: string[]
): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length === 0) return furniture;
  const cx = sel.reduce((a, f) => a + f.x, 0) / sel.length;
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, x: 2 * cx - f.x, rotation: (360 - f.rotation) % 360 } : f);
}

export function flipVertical(
  furniture: EditorFurniture[], ids: string[]
): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length === 0) return furniture;
  const cy = sel.reduce((a, f) => a + f.y, 0) / sel.length;
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? { ...f, y: 2 * cy - f.y, rotation: (180 - f.rotation + 360) % 360 } : f);
}

export function scaleFromCenter(
  furniture: EditorFurniture[], ids: string[], factor: number
): EditorFurniture[] {
  const sel = getSelected(furniture, ids);
  if (sel.length === 0) return furniture;
  const cx = sel.reduce((a, f) => a + f.x, 0) / sel.length;
  const cy = sel.reduce((a, f) => a + f.y, 0) / sel.length;
  const s = new Set(ids);
  return furniture.map(f => s.has(f.id) ? {
    ...f,
    x: cx + (f.x - cx) * factor,
    y: cy + (f.y - cy) * factor,
    w: f.w * factor,
    h: f.h * factor,
  } : f);
}

export function resetTransform(furniture: EditorFurniture[], id: string): EditorFurniture[] {
  return furniture.map(f => f.id === id ? { ...f, rotation: 0 } : f);
}

// ═══════════════════════════════════════════════════════════════
//  STATISTICS
// ═══════════════════════════════════════════════════════════════

export function computeStatistics(state: FloorPlanEditorState): {
  itemCount: number;
  categoryBreakdown: Record<string, number>;
  totalFootprint: number;
  roomArea: number;
  coveragePct: number;
  doorCount: number;
  windowCount: number;
  wallCount: number;
  perimeter: number;
} {
  const area = getRoomArea(state.room);
  let footprint = 0;
  const cats: Record<string, number> = {};
  for (const f of state.furniture) {
    if (!["rug", "art", "light"].includes(f.category)) footprint += f.w * f.h;
    cats[f.category] = (cats[f.category] || 0) + 1;
  }
  return {
    itemCount: state.furniture.length,
    categoryBreakdown: cats,
    totalFootprint: footprint,
    roomArea: area,
    coveragePct: area > 0 ? (footprint / area) * 100 : 0,
    doorCount: state.doors.length,
    windowCount: state.windows.length,
    wallCount: state.room.vertices.length,
    perimeter: getRoomPerimeter(state.room),
  };
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT HELPERS
// ═══════════════════════════════════════════════════════════════

export function exportToJSON(state: FloorPlanEditorState): string {
  const stats = computeStatistics(state);
  return JSON.stringify({
    version: "1.0",
    exportDate: new Date().toISOString(),
    room: {
      type: state.roomType,
      style: state.style,
      width: state.roomWidthFt,
      height: state.roomHeightFt,
      area: stats.roomArea,
      perimeter: stats.perimeter,
      vertices: state.room.vertices,
    },
    furniture: state.furniture.map(f => ({
      id: f.id,
      label: f.label,
      category: f.category,
      position: { x: f.x, y: f.y },
      size: { w: f.w, h: f.h },
      rotation: f.rotation,
    })),
    doors: state.doors,
    windows: state.windows,
    statistics: stats,
  }, null, 2);
}

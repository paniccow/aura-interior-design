/**
 * FloorPlanEditor v4 — Professional-grade interactive 2D floor plan editor
 *
 * Features:
 * - Multi-select with rubber-band selection
 * - Furniture library sidebar with drag-to-add
 * - Align & distribute tools
 * - Room templates
 * - Z-ordering (bring to front/send to back)
 * - Floor material picker
 * - Statistics panel
 * - Premium architectural rendering
 * - Zoom-to-cursor, trackpad pan, spatial hash hit-testing
 * - Command-based undo committed on pointerup
 * - Screen-space snap tolerance
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import type {
  CADLayout, Product, FloorPlanEditorState, EditorTool,
  EditorFurniture, EditorGuide, EditorHistoryEntry,
  EditorRoom, EditorDoor, EditorWindow, EditorWall, RoomVertex
} from "../types";
import {
  createEditorStateFromCAD, createEmptyRoom, createLShapedRoom,
  getRoomBounds, getRoomArea, getWallSegments,
  addVertex, moveVertex, removeVertex,
  moveFurniture, rotateFurniture, resizeFurniture, deleteFurniture,
  duplicateFurniture, toggleLock,
  addDoorToWall, addWindowToWall, removeDoor, removeWindow,
  snapToGrid, applySmartSnap,
  checkCollision, pointInPolygon,
  createSnapshot, restoreSnapshot,
  serializeEditorState, deserializeEditorState,
  distanceFt, formatDist, wallPointAt, wallLength, wallAngle, nearestWall,
  computeClearances, computeTrafficPaths,
  uid,
  // v4 new imports
  selectAll, selectInRect, moveMultiple, deleteMultiple, duplicateMultiple,
  rotateMultiple, lockMultiple, unlockMultiple,
  alignLeft, alignRight, alignTop, alignBottom, alignCenterH, alignCenterV,
  distributeHorizontal, distributeVertical,
  bringToFront, sendToBack, bringForward, sendBackward,
  createUShapedRoom, createTShapedRoom,
  ROOM_TEMPLATES, applyRoomTemplate,
  FLOOR_MATERIALS,
  computeStatistics, getSelectionBounds,
  flipHorizontal, flipVertical,
  validatePlacement, getOverlappingPairs,
  getRoomPerimeter, getWallLengths,
  exportToJSON,
} from "../engine/floorPlanState";

// ═════════════════════════════════════════════════════════════
//  PALETTE & CONSTANTS
// ═════════════════════════════════════════════════════════════

const P = {
  accent: "#B5704D", accentHover: "#9B5E3F", accentLight: "#D4A888",
  accentBg: "#FBF3ED", accentBorder: "#E8C8B0",
  text: "#3D3328", textSec: "#6B5E52", textMuted: "#A09486",
  border: "#DDD5CC", borderLight: "#EAE4DD",
  surface: "#FAF8F5", canvasBg: "#F7F4F0",
  grid: "#E8E2DA", gridSub: "#F0ECE6",
  wall: "#5C4D3F", wallInner: "#7A6B5C",
  select: "#B5704D", hover: "#D4A888", snap: "#B5704D",
  traffic: "#D4A070", clear: "#B5704D",
  collision: "rgba(200,60,60,0.25)",
  success: "#4B7B50", successBg: "#EDF5ED",
  warning: "#C08030", warningBg: "#FDF5E8",
  danger: "#C04040", dangerBg: "#FDE8E8",
  white: "#FFFFFF",
  font: "'Inter','Helvetica Neue',-apple-system,sans-serif",
};

const FURN_FILLS: Record<string, { bg: string; stroke: string; text: string }> = {
  sofa:    { bg: "#E8DDD2", stroke: "#A0907E", text: "#6B5E50" },
  bed:     { bg: "#E5DCD5", stroke: "#9B8B7B", text: "#6B5C4E" },
  table:   { bg: "#E0E4D8", stroke: "#8B9B80", text: "#5B6B50" },
  chair:   { bg: "#E2DDD8", stroke: "#9B9088", text: "#6B6058" },
  stool:   { bg: "#E5E0D5", stroke: "#A09580", text: "#6B6050" },
  light:   { bg: "#F5EDD5", stroke: "#C8B878", text: "#8B8040" },
  rug:     { bg: "#E0DDD8", stroke: "#A09890", text: "#6B6460" },
  art:     { bg: "#E8E0D8", stroke: "#A89888", text: "#7B6B60" },
  accent:  { bg: "#E0DED8", stroke: "#989890", text: "#686860" },
  decor:   { bg: "#E0DED8", stroke: "#989890", text: "#686860" },
  storage: { bg: "#DDE0D8", stroke: "#909888", text: "#606860" },
};
const DEFAULT_FILL = { bg: "#E5E0DA", stroke: "#A09888", text: "#6B6058" };

const PX_PER_FT = 40;
const HANDLE_R = 4;
const ROT_GAP = 22;
const SNAP_PX = 8;
const MIN_Z = 0.4;
const MAX_Z = 3;

/** Boolean toggle keys on FloorPlanEditorState that the toolbar can flip. */
type ToggleKey = "showGrid" | "showDimensions" | "showClearances" | "showTrafficFlow";

/** Type-safe accessor for boolean toggle properties on editor state. */
function getToggle(state: FloorPlanEditorState, key: ToggleKey): boolean {
  return state[key];
}

/** Type-safe toggle for boolean properties on editor state. */
function toggleEditorFlag(state: FloorPlanEditorState, key: ToggleKey): FloorPlanEditorState {
  return { ...state, [key]: !state[key] };
}

/** A furniture item in the drag-to-add library sidebar. */
interface LibraryItem {
  label: string;
  category: string;
  w: number;
  h: number;
  shape: string;
}

const LIBRARY_ITEMS: LibraryItem[] = [
  { label: "Sofa", category: "sofa", w: 7, h: 3, shape: "rect" },
  { label: "Loveseat", category: "sofa", w: 5, h: 2.8, shape: "rect" },
  { label: "Sectional", category: "sofa", w: 10, h: 7, shape: "L" },
  { label: "Armchair", category: "chair", w: 2.8, h: 2.8, shape: "rect" },
  { label: "Dining Chair", category: "chair", w: 1.6, h: 1.8, shape: "rect" },
  { label: "King Bed", category: "bed", w: 6.5, h: 7.4, shape: "bed" },
  { label: "Queen Bed", category: "bed", w: 5, h: 7.4, shape: "bed" },
  { label: "Twin Bed", category: "bed", w: 3.25, h: 6.5, shape: "bed" },
  { label: "Coffee Table", category: "table", w: 4, h: 2, shape: "rect" },
  { label: "Dining Table", category: "table", w: 6, h: 3.2, shape: "rect" },
  { label: "Round Dining", category: "table", w: 4, h: 4, shape: "round" },
  { label: "Side Table", category: "table", w: 1.8, h: 1.8, shape: "round" },
  { label: "Desk", category: "table", w: 4.5, h: 2, shape: "rect" },
  { label: "Console", category: "table", w: 4.5, h: 1.2, shape: "rect" },
  { label: "Nightstand", category: "table", w: 1.8, h: 1.5, shape: "rect" },
  { label: "Dresser", category: "table", w: 5, h: 1.5, shape: "rect" },
  { label: "Bookshelf", category: "storage", w: 3, h: 1, shape: "rect" },
  { label: "Cabinet", category: "storage", w: 3, h: 1.5, shape: "rect" },
  { label: "TV Stand", category: "storage", w: 4, h: 1.5, shape: "rect" },
  { label: "Area Rug 8×5", category: "rug", w: 8, h: 5, shape: "rect" },
  { label: "Runner Rug", category: "rug", w: 8, h: 2.5, shape: "rect" },
  { label: "Round Rug", category: "rug", w: 6, h: 6, shape: "round" },
  { label: "Floor Lamp", category: "light", w: 1.2, h: 1.2, shape: "round" },
  { label: "Table Lamp", category: "light", w: 0.8, h: 0.8, shape: "round" },
  { label: "Wall Art", category: "art", w: 3, h: 2, shape: "rect" },
  { label: "Mirror", category: "art", w: 2, h: 3, shape: "rect" },
  { label: "Plant", category: "decor", w: 1.5, h: 1.5, shape: "round" },
  { label: "Ottoman", category: "accent", w: 2, h: 2, shape: "rect" },
  { label: "Bar Stool", category: "stool", w: 1.3, h: 1.3, shape: "round" },
  { label: "Bench", category: "accent", w: 4, h: 1.5, shape: "rect" },
];

interface FloorPlanEditorProps {
  initialLayout: CADLayout | null;
  items: Product[];
  roomType: string;
  style: string;
  roomWidthFt?: number;
  roomHeightFt?: number;
  isFullScreen?: boolean;
  onClose?: () => void;
  onSave?: (state: FloorPlanEditorState) => void;
  savedState?: FloorPlanEditorState | null;
}

const TOOLS: EditorTool[] = ["select", "pan", "door", "window", "measure", "eraser"];
const TI: Record<string, string> = { select: "⊹", pan: "✋", door: "🚪", window: "▢", measure: "📏", eraser: "✕" };
const TL: Record<string, string> = { select: "Select", pan: "Pan", door: "Door", window: "Window", measure: "Measure", eraser: "Erase" };
const TK: Record<string, string> = { select: "V", pan: "H", door: "D", window: "W", measure: "M", eraser: "X" };

// ═════════════════════════════════════════════════════════════
//  SPATIAL HASH — O(1) hit-test lookups
// ═════════════════════════════════════════════════════════════

class SpatialHash {
  private cells = new Map<string, EditorFurniture[]>();
  private cellSz: number;
  constructor(furniture: EditorFurniture[], cellSz = 4) {
    this.cellSz = cellSz;
    for (const f of furniture) {
      const x0 = Math.floor((f.x - f.w / 2) / cellSz);
      const x1 = Math.floor((f.x + f.w / 2) / cellSz);
      const y0 = Math.floor((f.y - f.h / 2) / cellSz);
      const y1 = Math.floor((f.y + f.h / 2) / cellSz);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = gx + "," + gy;
          const arr = this.cells.get(key);
          if (arr) arr.push(f); else this.cells.set(key, [f]);
        }
    }
  }
  query(fx: number, fy: number): EditorFurniture | null {
    const gx = Math.floor(fx / this.cellSz), gy = Math.floor(fy / this.cellSz);
    const cands = this.cells.get(gx + "," + gy);
    if (!cands) return null;
    for (let i = cands.length - 1; i >= 0; i--) {
      const f = cands[i];
      if (fx >= f.x - f.w / 2 && fx <= f.x + f.w / 2 && fy >= f.y - f.h / 2 && fy <= f.y + f.h / 2) return f;
    }
    return null;
  }
  queryRect(x1: number, y1: number, x2: number, y2: number): EditorFurniture[] {
    const found = new Set<string>();
    const results: EditorFurniture[] = [];
    const gx0 = Math.floor(Math.min(x1,x2) / this.cellSz);
    const gx1 = Math.floor(Math.max(x1,x2) / this.cellSz);
    const gy0 = Math.floor(Math.min(y1,y2) / this.cellSz);
    const gy1 = Math.floor(Math.max(y1,y2) / this.cellSz);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gy = gy0; gy <= gy1; gy++) {
        const cands = this.cells.get(gx + "," + gy);
        if (!cands) continue;
        for (const f of cands) {
          if (found.has(f.id)) continue;
          if (f.x >= Math.min(x1,x2) && f.x <= Math.max(x1,x2) && f.y >= Math.min(y1,y2) && f.y <= Math.max(y1,y2)) {
            found.add(f.id); results.push(f);
          }
        }
      }
    return results;
  }
}

// ═════════════════════════════════════════════════════════════
//  COMPONENT
// ═════════════════════════════════════════════════════════════

export default function FloorPlanEditor({
  initialLayout, items, roomType, style: styleName,
  roomWidthFt, roomHeightFt,
  isFullScreen = false, onClose, onSave, savedState,
}: FloorPlanEditorProps) {

  // ─── State ───
  const [es, setEs] = useState<FloorPlanEditorState | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [selId, setSelId] = useState<string | null>(null);
  const [selIds, setSelIds] = useState<string[]>([]); // multi-select
  const [selDW, setSelDW] = useState<{ id: string; type: "door" | "window" } | null>(null);
  const [hovId, setHovId] = useState<string | null>(null);
  const [guides, setGuides] = useState<EditorGuide[]>([]);
  const [hist, setHist] = useState<EditorHistoryEntry[]>([]);
  const [histI, setHistI] = useState(-1);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPosition | null>(null);
  type RoomShapeMode = "rect" | "L" | "U" | "T" | "template";
  const [roomMode, setRoomMode] = useState<RoomShapeMode>("rect");
  const [riW, setRiW] = useState("");
  const [riH, setRiH] = useState("");
  type SidePanel = "props" | "library" | "room" | "stats" | "templates";
  const [sidePanel, setSidePanel] = useState<SidePanel>("props");
  const [libSearch, setLibSearch] = useState("");
  const [libCat, setLibCat] = useState("all");
  const [floorMat, setFloorMat] = useState("white");
  const [showTooltip, setShowTooltip] = useState(() => {
    try { return localStorage.getItem("aura_editor_tooltip") !== "0"; } catch { return true; }
  });
  const [validationIssues, setValidationIssues] = useState<Array<{ id: string; issue: string }>>([]);

  // ─── Interaction refs ───
  /** Whether a single-item drag is active */
  const drag = useRef<boolean>(false);
  /** Offset from cursor to item center when drag started */
  const dragOff = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Cursor position in feet when drag/resize/rotate started */
  const dragSt = useRef<{ x: number; y: number } | null>(null);
  /** Whether pan is active (middle-click or space+drag) */
  const pan = useRef<boolean>(false);
  /** Screen pixel position when pan started */
  const panSt = useRef<{ x: number; y: number } | null>(null);
  /** Which resize handle is active (e.g. "tl", "br", "t", "l") */
  const resz = useRef<string | null>(null);
  /** Whether rotation drag is active */
  const rot = useRef<boolean>(false);
  /** Index of room vertex being dragged */
  const vert = useRef<number | null>(null);
  /** Whether spacebar is held for temporary pan mode */
  const space = useRef<boolean>(false);
  /** Whether current drag has a collision */
  const coll = useRef<boolean>(false);
  /** Measurement tool start point in feet */
  const mStart = useRef<{ x: number; y: number } | null>(null);
  /** Measurement tool end point in feet */
  const mEnd = useRef<{ x: number; y: number } | null>(null);
  /** Whether current interaction has been committed to undo history */
  const committed = useRef<boolean>(true);
  /** Debounce timer for arrow nudge undo history */
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Spatial hash for O(1) furniture hit-testing */
  const spatialRef = useRef<SpatialHash | null>(null);
  /** Rubber-band selection rectangle in feet coordinates */
  const rubberBand = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  /** Whether a multi-item drag is active */
  const multiDrag = useRef<boolean>(false);
  /** Cursor position in feet when multi-drag started */
  const multiDragStart = useRef<{ x: number; y: number } | null>(null);

  // Canvas refs
  /** The canvas element */
  const cvs = useRef<HTMLCanvasElement>(null);
  /** The container div wrapping the canvas */
  const ctr = useRef<HTMLDivElement>(null);
  /** requestAnimationFrame handle for cancellation */
  const raf = useRef<number>(0);
  /** Stale-closure escape hatch — always holds latest editor state */
  const sr = useRef<FloorPlanEditorState | null>(es);

  useEffect(() => { sr.current = es; }, [es]);
  useEffect(() => {
    if (es) spatialRef.current = new SpatialHash(es.furniture);
  }, [es?.furniture]);

  // ─── Init ───
  useEffect(() => {
    if (savedState) {
      setEs(savedState);
      setRiW(savedState.roomWidthFt.toString());
      setRiH(savedState.roomHeightFt.toString());
      return;
    }
    if (initialLayout) {
      const s = createEditorStateFromCAD(initialLayout, items, roomType, styleName);
      setEs(s);
      setRiW(s.roomWidthFt.toString());
      setRiH(s.roomHeightFt.toString());
      setHist([createSnapshot(s)]);
      setHistI(0);
    }
  }, [initialLayout, items, roomType, styleName]); // eslint-disable-line

  // ─── Command undo ───
  const pushHist = useCallback((state: FloorPlanEditorState) => {
    const snap = createSnapshot(state);
    setHistI(prevI => {
      setHist(prev => [...prev.slice(0, prevI + 1), snap].slice(-60));
      return Math.min(prevI + 1, 59);
    });
    committed.current = true;
  }, []);

  const undo = useCallback(() => {
    if (histI <= 0 || !es) return;
    setEs(restoreSnapshot(es, hist[histI - 1]));
    setHistI(histI - 1);
    setSelId(null); setSelIds([]);
  }, [histI, hist, es]);

  const redo = useCallback(() => {
    if (histI >= hist.length - 1 || !es) return;
    setEs(restoreSnapshot(es, hist[histI + 1]));
    setHistI(histI + 1);
    setSelId(null); setSelIds([]);
  }, [histI, hist, es]);

  // ─── Coord helpers ───
  const c2f = useCallback((cx: number, cy: number) => {
    const s = sr.current;
    if (!s) return {x:0,y:0};
    return { x: (cx - s.panX) / (PX_PER_FT * s.zoom), y: (cy - s.panY) / (PX_PER_FT * s.zoom) };
  }, []);

  const snapThr = useCallback((): number => {
    const s = sr.current;
    if (!s) return 0.3;
    // Clamp snap threshold so it's usable at any zoom level (0.15ft–0.5ft)
    return Math.max(0.15, Math.min(0.5, SNAP_PX / (PX_PER_FT * s.zoom)));
  }, []);

  // ─── Hit testing ───
  const hitF = useCallback((fx: number, fy: number): EditorFurniture | null => {
    if (spatialRef.current) return spatialRef.current.query(fx, fy);
    const s = sr.current;
    if (!s) return null;
    for (let i = s.furniture.length - 1; i >= 0; i--) {
      const f = s.furniture[i];
      if (fx >= f.x - f.w/2 && fx <= f.x + f.w/2 && fy >= f.y - f.h/2 && fy <= f.y + f.h/2) return f;
    }
    return null;
  }, []);

  // Hit-test doors and windows by checking proximity to their position on walls
  const hitDW = useCallback((fx: number, fy: number): { id: string; type: "door" | "window" } | null => {
    const s = sr.current;
    if (!s) return null;
    const segs = getWallSegments(s.room);
    const thr = Math.max(0.4, Math.min(1.0, 0.6 / s.zoom)); // hit tolerance in feet
    // Check doors
    for (const d of s.doors) {
      const wall = segs.find(ws => ws.id === d.wallId);
      if (!wall) continue;
      const pt = wallPointAt(wall, d.position);
      const dx = fx - pt.x, dy = fy - pt.y;
      if (Math.sqrt(dx * dx + dy * dy) < thr + d.width / 2) return { id: d.id, type: "door" };
    }
    // Check windows
    for (const w of s.windows) {
      const wall = segs.find(ws => ws.id === w.wallId);
      if (!wall) continue;
      const pt = wallPointAt(wall, w.position);
      const dx = fx - pt.x, dy = fy - pt.y;
      if (Math.sqrt(dx * dx + dy * dy) < thr + w.width / 2) return { id: w.id, type: "window" };
    }
    return null;
  }, []);

  const hitVert = useCallback((fx: number, fy: number): number | null => {
    const s = sr.current;
    if (!s) return null;
    // Clamp hit tolerance to 0.3–0.8 ft so vertices are always clickable
    const t = Math.max(0.3, Math.min(0.8, 0.5 / s.zoom));
    for (let i = 0; i < s.room.vertices.length; i++) {
      const v = s.room.vertices[i];
      if (Math.abs(fx - v.x) < t && Math.abs(fy - v.y) < t) return i;
    }
    return null;
  }, []);

  /** Resize handle identifiers corresponding to corners and edge midpoints. */
  type ResizeHandle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r";

  const hitResize = useCallback((cx: number, cy: number): ResizeHandle | null => {
    const s = sr.current;
    if (!s || !selId) return null;
    const f = s.furniture.find(ff => ff.id === selId);
    if (!f) return null;
    const ft = c2f(cx, cy);
    // Clamp resize handle hit tolerance to 0.2–0.6 ft
    const hs = Math.max(0.2, Math.min(0.6, 8 / (PX_PER_FT * s.zoom)));
    const handles: Record<ResizeHandle, [number, number]> = {
      tl: [f.x - f.w / 2, f.y - f.h / 2],
      tr: [f.x + f.w / 2, f.y - f.h / 2],
      bl: [f.x - f.w / 2, f.y + f.h / 2],
      br: [f.x + f.w / 2, f.y + f.h / 2],
      t: [f.x, f.y - f.h / 2],
      b: [f.x, f.y + f.h / 2],
      l: [f.x - f.w / 2, f.y],
      r: [f.x + f.w / 2, f.y],
    };
    for (const [k, [hx, hy]] of Object.entries(handles) as [ResizeHandle, [number, number]][]) {
      if (Math.abs(ft.x - hx) < hs && Math.abs(ft.y - hy) < hs) return k;
    }
    return null;
  }, [selId, c2f]);

  const hitRot = useCallback((cx: number, cy: number): boolean => {
    const s = sr.current;
    if (!s || !selId) return false;
    const f = s.furniture.find(ff => ff.id === selId);
    if (!f) return false;
    const ft = c2f(cx, cy);
    const rotY = f.y - f.h / 2 - ROT_GAP / (PX_PER_FT * s.zoom);
    // Clamp rotation handle hit tolerance to 0.3–0.6 ft
    const t = Math.max(0.3, Math.min(0.6, 0.4 / Math.sqrt(s.zoom)));
    return Math.abs(ft.x - f.x) < t && Math.abs(ft.y - rotY) < t;
  }, [selId, c2f]);

  // ─── Multi-select helpers ───
  const allSelIds = useMemo(() => {
    const set = new Set(selIds);
    if (selId) set.add(selId);
    return [...set];
  }, [selId, selIds]);

  const hasMultiSel = allSelIds.length > 1;

  // ─── Add from library ───
  const addFromLibrary = useCallback((item: LibraryItem) => {
    if (!es) return;
    const b = getRoomBounds(es.room);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const f: EditorFurniture = {
      id: uid("furn"), productId: 0, x: cx, y: cy,
      w: item.w, h: item.h, rotation: 0, locked: false,
      color: (FURN_FILLS[item.category] || DEFAULT_FILL).bg,
      shape: item.shape, label: item.label, category: item.category,
    };
    const ns = { ...es, furniture: [...es.furniture, f] };
    setEs(ns); pushHist(ns);
    setSelId(f.id); setSelIds([]);
    setSidePanel("props");
  }, [es, pushHist]);

  const fitRoom = useCallback(() => {
    const s = sr.current;
    const c = cvs.current;
    if (!s || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.width / dpr, ch = c.height / dpr;
    const bb = getRoomBounds(s.room);
    const rw = bb.maxX - bb.minX, rh = bb.maxY - bb.minY;
    // Fit room with comfortable padding, clamp to zoom limits
    const fz = Math.max(MIN_Z, Math.min(MAX_Z, Math.min((cw - 160) / (rw * PX_PER_FT), (ch - 160) / (rh * PX_PER_FT))));
    const px = (cw - rw * PX_PER_FT * fz) / 2 - bb.minX * PX_PER_FT * fz;
    const py = (ch - rh * PX_PER_FT * fz) / 2 - bb.minY * PX_PER_FT * fz;
    setEs(prev => prev ? { ...prev, zoom: fz, panX: px, panY: py } : prev);
  }, []);

  // ═════════════════════════════════════════════════════════════
  //  CANVAS RENDERING
  // ═════════════════════════════════════════════════════════════

  const render = useCallback(() => {
    const canvas = cvs.current;
    const state = sr.current;
    if (!canvas || !state) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    const z = state.zoom;
    const zInv = 1 / z; // inverse zoom for screen-space sizing of overlays
    const sc = PX_PER_FT * z;
    const b = getRoomBounds(state.room);
    const rW = b.maxX - b.minX;
    const rH = b.maxY - b.minY;
    const mat = FLOOR_MATERIALS.find(m => m.id === floorMat) || FLOOR_MATERIALS[FLOOR_MATERIALS.length-1];

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = P.canvasBg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(z, z);

    // ─── Grid ───
    if (state.showGrid) {
      const g = PX_PER_FT;
      const sx = Math.floor(b.minX - 2) * g, ex = Math.ceil(b.maxX + 2) * g;
      const sy = Math.floor(b.minY - 2) * g, ey = Math.ceil(b.maxY + 2) * g;
      if (z > 1) {
        ctx.strokeStyle = P.gridSub; ctx.lineWidth = 0.3 * zInv;
        for (let x = sx; x <= ex; x += g / 2) { ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x, ey); ctx.stroke(); }
        for (let y = sy; y <= ey; y += g / 2) { ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(ex, y); ctx.stroke(); }
      }
      ctx.strokeStyle = P.grid; ctx.lineWidth = 0.5 * zInv;
      for (let x = sx; x <= ex; x += g) { ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x, ey); ctx.stroke(); }
      for (let y = sy; y <= ey; y += g) { ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(ex, y); ctx.stroke(); }
    }

    // ─── Room fill with floor material ───
    const vs = state.room.vertices;
    if (vs.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(vs[0].x * PX_PER_FT, vs[0].y * PX_PER_FT);
      for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x * PX_PER_FT, vs[i].y * PX_PER_FT);
      ctx.closePath();
      ctx.fillStyle = mat.color;
      ctx.fill();
      // Floor pattern overlay
      if (mat.pattern === "wood") {
        ctx.save(); ctx.clip();
        ctx.strokeStyle = "#00000008"; ctx.lineWidth = 1;
        const step = PX_PER_FT * 0.5;
        for (let x = b.minX * PX_PER_FT; x < b.maxX * PX_PER_FT; x += step) {
          ctx.beginPath(); ctx.moveTo(x, b.minY * PX_PER_FT); ctx.lineTo(x, b.maxY * PX_PER_FT); ctx.stroke();
        }
        ctx.restore();
      } else if (mat.pattern === "tile") {
        ctx.save(); ctx.clip();
        ctx.strokeStyle = "#00000010"; ctx.lineWidth = 0.5;
        const ts = PX_PER_FT;
        for (let x = b.minX * PX_PER_FT; x < b.maxX * PX_PER_FT; x += ts) {
          ctx.beginPath(); ctx.moveTo(x, b.minY * PX_PER_FT); ctx.lineTo(x, b.maxY * PX_PER_FT); ctx.stroke();
        }
        for (let y = b.minY * PX_PER_FT; y < b.maxY * PX_PER_FT; y += ts) {
          ctx.beginPath(); ctx.moveTo(b.minX * PX_PER_FT, y); ctx.lineTo(b.maxX * PX_PER_FT, y); ctx.stroke();
        }
        ctx.restore();
      }
      // Walls — zoom-compensated so walls look consistent at any zoom
      ctx.beginPath();
      ctx.moveTo(vs[0].x * PX_PER_FT, vs[0].y * PX_PER_FT);
      for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x * PX_PER_FT, vs[i].y * PX_PER_FT);
      ctx.closePath();
      ctx.lineJoin = "miter";
      // Use partially compensated widths: scale a bit with zoom but not 1:1
      const wallOuter = Math.max(4, Math.min(10, 7 * Math.sqrt(zInv)));
      const wallInner = Math.max(0.8, Math.min(2.5, 1.5 * Math.sqrt(zInv)));
      ctx.strokeStyle = P.wall; ctx.lineWidth = wallOuter; ctx.stroke();
      ctx.strokeStyle = P.wallInner; ctx.lineWidth = wallInner; ctx.stroke();
    }

    // ─── Windows ───
    const wSegs = getWallSegments(state.room);
    for (const w of state.windows) {
      const wall = wSegs.find(ws => ws.id === w.wallId);
      if (!wall) continue;
      const pt = wallPointAt(wall, w.position);
      const a = wallAngle(wall);
      const wp = w.width * PX_PER_FT;
      ctx.save();
      ctx.translate(pt.x*PX_PER_FT, pt.y*PX_PER_FT);
      ctx.rotate(a);
      const wLw = Math.max(1, 1.5 * Math.sqrt(zInv));
      const wThick = Math.max(3, 4 * Math.sqrt(zInv));
      ctx.fillStyle = "#C8DEE8"; ctx.strokeStyle = "#6B9AB8"; ctx.lineWidth = wLw;
      ctx.fillRect(-wp/2, -wThick, wp, wThick*2); ctx.strokeRect(-wp/2, -wThick, wp, wThick*2);
      ctx.lineWidth = 0.5 * Math.sqrt(zInv);
      ctx.beginPath(); ctx.moveTo(-wp/6,-wThick+1); ctx.lineTo(-wp/6,wThick-1); ctx.moveTo(wp/6,-wThick+1); ctx.lineTo(wp/6,wThick-1); ctx.stroke();
      ctx.fillStyle = "#6B9AB8"; ctx.font = `600 ${7 * Math.sqrt(zInv)}px ${P.font}`; ctx.textAlign = "center";
      ctx.fillText(`${w.width}'`, 0, -wThick - 5 * Math.sqrt(zInv));
      // Selection highlight
      if (selDW?.id === w.id) {
        ctx.strokeStyle = "#3B82F6"; ctx.lineWidth = Math.max(2, 2.5 * Math.sqrt(zInv));
        ctx.setLineDash([4 * Math.sqrt(zInv), 3 * Math.sqrt(zInv)]);
        ctx.strokeRect(-wp/2 - 4, -wThick - 4, wp + 8, wThick * 2 + 8);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ─── Doors ───
    for (const d of state.doors) {
      const wall = wSegs.find(ws => ws.id === d.wallId);
      if (!wall) continue;
      const pt = wallPointAt(wall, d.position);
      const a = wallAngle(wall);
      const dp = d.width * PX_PER_FT;
      ctx.save();
      ctx.translate(pt.x*PX_PER_FT, pt.y*PX_PER_FT);
      ctx.rotate(a);
      const dLw = Math.max(1, 1.5 * Math.sqrt(zInv));
      const dThick = Math.max(3, 5 * Math.sqrt(zInv));
      ctx.fillStyle = P.canvasBg; ctx.fillRect(-dp/2, -dThick, dp, dThick*2);
      const pw = dp * 0.9;
      ctx.fillStyle = "#E0D5C8"; ctx.strokeStyle = "#A89880"; ctx.lineWidth = dLw;
      ctx.fillRect(-pw/2, -dThick*0.6, pw, dThick*0.6); ctx.strokeRect(-pw/2, -dThick*0.6, pw, dThick*0.6);
      const sr2 = dp * 0.75;
      ctx.strokeStyle = "#A8988088"; ctx.lineWidth = 0.8 * Math.sqrt(zInv); ctx.setLineDash([4*Math.sqrt(zInv),3*Math.sqrt(zInv)]);
      ctx.beginPath();
      if (d.swingDir === "left") ctx.arc(-pw/2, -dThick*0.6, sr2, 0, -Math.PI/2, true);
      else ctx.arc(pw/2, -dThick*0.6, sr2, -Math.PI, -Math.PI/2, false);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#A89880"; ctx.font = `600 ${7 * Math.sqrt(zInv)}px ${P.font}`; ctx.textAlign = "center";
      ctx.fillText(`${d.width}'`, 0, dThick + 7 * Math.sqrt(zInv));
      // Selection highlight
      if (selDW?.id === d.id) {
        ctx.strokeStyle = "#3B82F6"; ctx.lineWidth = Math.max(2, 2.5 * Math.sqrt(zInv));
        ctx.setLineDash([4 * Math.sqrt(zInv), 3 * Math.sqrt(zInv)]);
        ctx.strokeRect(-dp/2 - 4, -dThick - 4, dp + 8, dThick * 2 + 8);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ─── Traffic flow ───
    if (state.showTrafficFlow) {
      const paths = computeTrafficPaths(state.furniture, state.doors, wSegs, state.room);
      for (const path of paths) {
        const pts = path.points;
        if (pts.length < 2) continue;
        ctx.strokeStyle = P.traffic; ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2 * zInv; ctx.setLineDash([8 * zInv, 5 * zInv]); ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(pts[0].x * PX_PER_FT, pts[0].y * PX_PER_FT);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * PX_PER_FT, pts[i].y * PX_PER_FT);
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineCap = "butt";
        if (pts.length >= 2) {
          const last = pts[pts.length - 1], prev = pts[pts.length - 2];
          const aa = Math.atan2(last.y - prev.y, last.x - prev.x);
          const arSz = 6 * zInv;
          ctx.save(); ctx.translate(last.x * PX_PER_FT, last.y * PX_PER_FT); ctx.rotate(aa);
          ctx.fillStyle = P.traffic; ctx.globalAlpha = 0.5;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-arSz, -arSz / 2); ctx.lineTo(-arSz, arSz / 2); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ─── Clearances ───
    if (state.showClearances) {
      const clz = computeClearances(state.furniture);
      for (const c of clz) {
        ctx.fillStyle = P.clear + "08"; ctx.strokeStyle = P.clear + "40";
        ctx.lineWidth = 0.5 * zInv; ctx.setLineDash([4 * zInv, 3 * zInv]);
        ctx.fillRect(c.x * PX_PER_FT, c.y * PX_PER_FT, c.w * PX_PER_FT, c.h * PX_PER_FT);
        ctx.strokeRect(c.x * PX_PER_FT, c.y * PX_PER_FT, c.w * PX_PER_FT, c.h * PX_PER_FT);
        ctx.setLineDash([]);
      }
    }

    // ─── Furniture ───
    const allSel = new Set(allSelIds);
    const hid = hovId;
    for (const f of state.furniture) {
      const fx = f.x * PX_PER_FT, fy = f.y * PX_PER_FT;
      const fw = f.w * PX_PER_FT, fh = f.h * PX_PER_FT;
      const clr = FURN_FILLS[f.category] || DEFAULT_FILL;
      const isSel = allSel.has(f.id);
      const isHov = f.id === hid && !isSel;

      ctx.save();
      ctx.translate(fx, fy);
      if (f.rotation) ctx.rotate(f.rotation * Math.PI / 180);

      if (isSel && coll.current) {
        ctx.fillStyle = P.collision;
        ctx.fillRect(-fw/2-3, -fh/2-3, fw+6, fh+6);
      }
      if (isHov) { ctx.shadowColor = P.hover; ctx.shadowBlur = 10; }
      if (isSel) { ctx.shadowColor = P.select + "40"; ctx.shadowBlur = 8; }

      const cat = f.category;
      const shape = f.shape;
      const isRound = shape === "round";
      const isOval = shape === "oval";
      const isL = shape === "L";
      // Labels are zoom-compensated: scale partially with zoom to stay readable
      const zComp = Math.max(0.7, Math.min(1.5, Math.sqrt(zInv)));
      const lblSz = Math.min(10, Math.max(6, fw / 6)) * zComp;
      const dimSz = Math.min(8, Math.max(5, fw / 8)) * zComp;
      const dimLbl = f.w.toFixed(1) + "' × " + f.h.toFixed(1) + "'";

      // Draw based on category
      if (cat === "rug") {
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2;
        if (isRound) { ctx.beginPath(); ctx.arc(0, 0, fw/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = clr.stroke+"60"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, fw/2-4, 0, Math.PI*2); ctx.stroke();
        } else {
          rrect(ctx, -fw/2, -fh/2, fw, fh, 3); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = clr.stroke+"60"; ctx.lineWidth = 1;
          rrect(ctx, -fw/2+4, -fh/2+4, fw-8, fh-8, 2); ctx.stroke();
          ctx.strokeStyle = clr.stroke+"30"; ctx.lineWidth = 0.5;
          rrect(ctx, -fw*0.35, -fh*0.35, fw*0.7, fh*0.7, 2); ctx.stroke();
        }
        ctx.fillStyle = clr.text; ctx.font = `600 ${lblSz}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Rug", 0, -2);
        ctx.fillStyle = clr.text+"88"; ctx.font = `${dimSz}px ${P.font}`;
        ctx.fillText(dimLbl, 0, lblSz + 2);
      } else if (cat === "bed" || shape === "bed") {
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2;
        rrect(ctx, -fw/2, -fh/2, fw, fh, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = clr.stroke; ctx.globalAlpha = 0.5;
        rrect(ctx, -fw/2, -fh/2, fw, fh*0.06, 3); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke+"50"; ctx.lineWidth = 0.8;
        rrect(ctx, -fw*0.42, -fh*0.38, fw*0.38, fh*0.1, 6); ctx.fill(); ctx.stroke();
        rrect(ctx, fw*0.04, -fh*0.38, fw*0.38, fh*0.1, 6); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = clr.stroke+"30"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-fw*0.44, fh*0.1); ctx.lineTo(fw*0.44, fh*0.1); ctx.stroke();
        ctx.fillStyle = clr.text; ctx.font = `700 ${lblSz}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Bed", 0, -fh*0.08);
        ctx.fillStyle = clr.text+"88"; ctx.font = `${dimSz}px ${P.font}`;
        ctx.fillText(dimLbl, 0, -fh*0.08 + lblSz + 3);
      } else if (cat === "sofa" && isL) {
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-fw/2+4, -fh/2); ctx.lineTo(fw/2, -fh/2);
        ctx.lineTo(fw/2, -fh*0.05); ctx.lineTo(-fw*0.05, -fh*0.05);
        ctx.lineTo(-fw*0.05, fh/2); ctx.lineTo(-fw/2, fh/2);
        ctx.lineTo(-fw/2, -fh/2+4); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = clr.text; ctx.font = `700 ${lblSz}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Sectional", -fw*0.15, fh*0.05);
      } else if (cat === "sofa") {
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2;
        rrect(ctx, -fw/2, -fh/2, fw, fh, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = clr.stroke+"18"; ctx.strokeStyle = clr.stroke+"40"; ctx.lineWidth = 0.8;
        rrect(ctx, -fw/2+3, fh*0.2, fw-6, fh*0.26, 4); ctx.fill(); ctx.stroke();
        const seats = fw > 240 ? 3 : 2;
        const cW = (fw - 12) / seats;
        ctx.fillStyle = clr.stroke+"0C"; ctx.strokeStyle = clr.stroke+"25"; ctx.lineWidth = 0.5;
        for (let i = 0; i < seats; i++) { rrect(ctx, -fw/2+6 + i*cW, -fh*0.42, cW-2, fh*0.58, 4); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = clr.stroke+"20";
        rrect(ctx, -fw/2-2, -fh*0.38, 5, fh*0.76, 3); ctx.fill();
        rrect(ctx, fw/2-3, -fh*0.38, 5, fh*0.76, 3); ctx.fill();
        ctx.fillStyle = clr.text; ctx.font = `700 ${lblSz}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Sofa", 0, -4);
        ctx.fillStyle = clr.text+"88"; ctx.font = `${dimSz}px ${P.font}`;
        ctx.fillText(dimLbl, 0, lblSz);
      } else if (cat === "table") {
        if (isRound || isOval) {
          ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, 0, fw/2, fh/2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2;
          rrect(ctx, -fw/2, -fh/2, fw, fh, 3); ctx.fill(); ctx.stroke();
          ctx.fillStyle = clr.stroke+"40";
          for (const [lx,ly] of [[-fw/2+5,-fh/2+5],[fw/2-5,-fh/2+5],[-fw/2+5,fh/2-5],[fw/2-5,fh/2-5]]) {
            ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI*2); ctx.fill();
          }
        }
        ctx.fillStyle = clr.text; ctx.font = `700 ${lblSz}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Table", 0, -3);
        ctx.fillStyle = clr.text+"88"; ctx.font = `${dimSz}px ${P.font}`;
        ctx.fillText(dimLbl, 0, lblSz);
      } else if (cat === "chair") {
        if (isRound) {
          ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(0, 0, fw/2, fh/2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 1.5;
          rrect(ctx, -fw/2, -fh/2, fw, fh, 4); ctx.fill(); ctx.stroke();
          ctx.fillStyle = clr.stroke+"0C"; ctx.strokeStyle = clr.stroke+"20"; ctx.lineWidth = 0.5;
          rrect(ctx, -fw*0.38, -fh*0.38, fw*0.76, fh*0.52, 3); ctx.fill(); ctx.stroke();
          ctx.fillStyle = clr.stroke+"18";
          rrect(ctx, -fw*0.4, fh*0.18, fw*0.8, fh*0.24, 3); ctx.fill();
        }
        ctx.fillStyle = clr.text; ctx.font = `700 ${Math.min(lblSz,8)}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Chair", 0, 1);
      } else if (cat === "light") {
        const r = Math.min(fw,fh)/2;
        ctx.fillStyle = "#F5E8C808"; ctx.beginPath(); ctx.arc(0, 0, r+5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#E8D88840"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = clr.text; ctx.font = `500 6px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Light", 0, r+10);
      } else if (cat === "art") {
        ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 2.5;
        if (isRound) { ctx.beginPath(); ctx.arc(0, 0, fw/2, 0, Math.PI*2); ctx.fill(); ctx.stroke(); }
        else { rrect(ctx, -fw/2, -fh/2, fw, fh, 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = clr.stroke+"08"; ctx.strokeStyle = clr.stroke+"35"; ctx.lineWidth = 0.5;
          rrect(ctx, -fw/2+4, -fh/2+4, fw-8, fh-8, 1); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = clr.text; ctx.font = `600 ${Math.min(lblSz,8)}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || "Art", 0, 2);
      } else {
        if (isRound) {
          ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, Math.min(fw,fh)/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = clr.bg; ctx.strokeStyle = clr.stroke; ctx.lineWidth = 1.5;
          rrect(ctx, -fw/2, -fh/2, fw, fh, 3); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = clr.text; ctx.font = `600 ${Math.min(7,fw/5)}px ${P.font}`; ctx.textAlign = "center";
        ctx.fillText(f.label || cat, 0, 2);
      }

      if (f.locked) {
        ctx.fillStyle = P.textMuted; ctx.font = `${10 * zComp}px sans-serif`; ctx.textAlign = "center";
        ctx.fillText("\uD83D\uDD12", 0, -fh/2-5*zComp);
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ─── Selection overlay (single) ───
    if (selId && !hasMultiSel) {
      const f = state.furniture.find(ff => ff.id === selId);
      if (f) {
        const sfx = f.x * PX_PER_FT, sfy = f.y * PX_PER_FT, sfw = f.w * PX_PER_FT, sfh = f.h * PX_PER_FT;
        const pad = 3 * zInv; // padding around selection
        const hr = HANDLE_R * zInv; // handle radius
        const dashA = 6 * zInv, dashB = 3 * zInv;
        ctx.save(); ctx.translate(sfx, sfy);
        if (f.rotation) ctx.rotate(f.rotation * Math.PI / 180);
        ctx.strokeStyle = P.select; ctx.lineWidth = 2 * zInv; ctx.setLineDash([dashA, dashB]);
        ctx.strokeRect(-sfw / 2 - pad, -sfh / 2 - pad, sfw + pad * 2, sfh + pad * 2);
        ctx.setLineDash([]);
        const hs: [number, number][] = [
          [-sfw / 2, -sfh / 2], [sfw / 2, -sfh / 2], [-sfw / 2, sfh / 2], [sfw / 2, sfh / 2],
          [0, -sfh / 2], [0, sfh / 2], [-sfw / 2, 0], [sfw / 2, 0],
        ];
        for (const [hx, hy] of hs) {
          ctx.fillStyle = P.white; ctx.strokeStyle = P.select; ctx.lineWidth = 1.5 * zInv;
          ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        const rotGap = ROT_GAP * zInv;
        ctx.strokeStyle = P.select; ctx.lineWidth = 1 * zInv; ctx.setLineDash([dashB, dashB]);
        ctx.beginPath(); ctx.moveTo(0, -sfh / 2 - pad); ctx.lineTo(0, -sfh / 2 - rotGap); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = P.select;
        ctx.beginPath(); ctx.arc(0, -sfh / 2 - rotGap, 5 * zInv, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P.white; ctx.font = `${8 * zInv}px sans-serif`; ctx.textAlign = "center";
        ctx.fillText("\u21BB", 0, -sfh / 2 - rotGap + 3 * zInv);
        ctx.restore();
      }
    }

    // ─── Multi-selection overlay ───
    if (hasMultiSel) {
      for (const sid of allSelIds) {
        const f = state.furniture.find(ff => ff.id === sid);
        if (!f) continue;
        ctx.save(); ctx.translate(f.x * PX_PER_FT, f.y * PX_PER_FT);
        if (f.rotation) ctx.rotate(f.rotation * Math.PI / 180);
        ctx.strokeStyle = P.select; ctx.lineWidth = 1.5 * zInv; ctx.setLineDash([4 * zInv, 3 * zInv]);
        const mp = 2 * zInv;
        ctx.strokeRect(-f.w * PX_PER_FT / 2 - mp, -f.h * PX_PER_FT / 2 - mp, f.w * PX_PER_FT + mp * 2, f.h * PX_PER_FT + mp * 2);
        ctx.setLineDash([]);
        ctx.restore();
      }
      const sb = getSelectionBounds(state.furniture, allSelIds);
      const gp = 4 * zInv;
      ctx.strokeStyle = P.accent + "60"; ctx.lineWidth = 1 * zInv; ctx.setLineDash([8 * zInv, 4 * zInv]);
      ctx.strokeRect(sb.minX * PX_PER_FT - gp, sb.minY * PX_PER_FT - gp, sb.w * PX_PER_FT + gp * 2, sb.h * PX_PER_FT + gp * 2);
      ctx.setLineDash([]);
    }

    // ─── Rubber band selection ───
    const rb = rubberBand.current;
    if (rb) {
      ctx.fillStyle = P.select + "15"; ctx.strokeStyle = P.select + "60"; ctx.lineWidth = 1 * zInv; ctx.setLineDash([4 * zInv, 2 * zInv]);
      const rx = Math.min(rb.x1, rb.x2) * PX_PER_FT, ry = Math.min(rb.y1, rb.y2) * PX_PER_FT;
      const rw2 = Math.abs(rb.x2 - rb.x1) * PX_PER_FT, rh2 = Math.abs(rb.y2 - rb.y1) * PX_PER_FT;
      ctx.fillRect(rx, ry, rw2, rh2); ctx.strokeRect(rx, ry, rw2, rh2);
      ctx.setLineDash([]);
    }

    // ─── Vertex handles ───
    if (isFullScreen && tool === "select") {
      for (let i = 0; i < state.room.vertices.length; i++) {
        const v = state.room.vertices[i];
        ctx.fillStyle = vert.current === i ? P.select : P.white;
        ctx.strokeStyle = P.wall; ctx.lineWidth = 2 * zInv;
        ctx.beginPath(); ctx.arc(v.x * PX_PER_FT, v.y * PX_PER_FT, 6 * zInv, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // ─── Snap guides ───
    if (guides.length > 0) {
      ctx.strokeStyle = P.snap; ctx.lineWidth = 0.8 * zInv; ctx.setLineDash([6 * zInv, 4 * zInv]); ctx.globalAlpha = 0.45;
      for (const g of guides) {
        if (g.type === "vertical") { ctx.beginPath(); ctx.moveTo(g.position * PX_PER_FT, b.minY * PX_PER_FT - 20); ctx.lineTo(g.position * PX_PER_FT, b.maxY * PX_PER_FT + 20); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(b.minX * PX_PER_FT - 20, g.position * PX_PER_FT); ctx.lineTo(b.maxX * PX_PER_FT + 20, g.position * PX_PER_FT); ctx.stroke(); }
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // ─── Dimensions ───
    if (state.showDimensions) {
      const dOff = 18 * zInv; // offset from wall
      const dTick = 4 * zInv; // tick mark half-length
      const dFont = 10 * zInv; // font size
      ctx.strokeStyle = P.wall; ctx.fillStyle = P.wall; ctx.lineWidth = 1 * zInv; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(b.minX * PX_PER_FT, b.minY * PX_PER_FT - dOff); ctx.lineTo(b.maxX * PX_PER_FT, b.minY * PX_PER_FT - dOff); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.minX * PX_PER_FT, b.minY * PX_PER_FT - dOff - dTick); ctx.lineTo(b.minX * PX_PER_FT, b.minY * PX_PER_FT - dOff + dTick); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.maxX * PX_PER_FT, b.minY * PX_PER_FT - dOff - dTick); ctx.lineTo(b.maxX * PX_PER_FT, b.minY * PX_PER_FT - dOff + dTick); ctx.stroke();
      ctx.font = `600 ${dFont}px ${P.font}`; ctx.textAlign = "center";
      ctx.fillText(rW.toFixed(1) + "'", (b.minX + rW / 2) * PX_PER_FT, b.minY * PX_PER_FT - dOff - dTick * 1.5);
      ctx.beginPath(); ctx.moveTo(b.maxX * PX_PER_FT + dOff, b.minY * PX_PER_FT); ctx.lineTo(b.maxX * PX_PER_FT + dOff, b.maxY * PX_PER_FT); ctx.stroke();
      ctx.save(); ctx.translate(b.maxX * PX_PER_FT + dOff + dTick * 2.5, (b.minY + rH / 2) * PX_PER_FT); ctx.rotate(Math.PI / 2);
      ctx.fillText(rH.toFixed(1) + "'", 0, 0); ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ─── Measurement ───
    const ms = mStart.current, me = mEnd.current;
    if (ms && me) {
      ctx.strokeStyle = P.accent; ctx.lineWidth = 2 * zInv; ctx.setLineDash([6 * zInv, 3 * zInv]);
      ctx.beginPath(); ctx.moveTo(ms.x * PX_PER_FT, ms.y * PX_PER_FT); ctx.lineTo(me.x * PX_PER_FT, me.y * PX_PER_FT); ctx.stroke();
      ctx.setLineDash([]);
      const d = distanceFt(ms.x, ms.y, me.x, me.y);
      const mx = (ms.x + me.x) / 2 * PX_PER_FT, my = (ms.y + me.y) / 2 * PX_PER_FT;
      const lbl = formatDist(d);
      const mFont = 10 * zInv;
      ctx.font = `700 ${mFont}px ${P.font}`;
      const tw = ctx.measureText(lbl).width + 14 * zInv;
      const th = 22 * zInv;
      ctx.fillStyle = P.white; ctx.strokeStyle = P.accent; ctx.lineWidth = 1 * zInv;
      rrect(ctx, mx - tw / 2, my - th / 2, tw, th, 5 * zInv); ctx.fill(); ctx.stroke();
      ctx.fillStyle = P.accent; ctx.textAlign = "center";
      ctx.fillText(lbl, mx, my + mFont * 0.35);
    }

    ctx.restore(); ctx.restore();
  }, [selId, selDW, hovId, guides, isFullScreen, tool, allSelIds, hasMultiSel, floorMat]);

  // ─── rAF loop ───
  useEffect(() => {
    const loop = () => { render(); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [render]);

  // ─── Resize canvas + auto-fit ───
  // Resizes the canvas buffer to match the container, then auto-fits the room.
  // We use a small rAF delay after resize to ensure layout has settled.
  const sizeAndFit = useCallback(() => {
    const c = cvs.current, ct = ctr.current;
    if (!c || !ct) return;
    const dpr = window.devicePixelRatio || 1;
    const rc = ct.getBoundingClientRect();
    if (rc.width < 10 || rc.height < 10) return; // container not ready yet
    c.width = rc.width * dpr; c.height = rc.height * dpr;
    c.style.width = rc.width + "px"; c.style.height = rc.height + "px";
    // Auto-fit room into the newly sized canvas
    const s = sr.current;
    if (!s) return;
    const cw = rc.width, ch = rc.height;
    const bb = getRoomBounds(s.room);
    const rw = bb.maxX - bb.minX, rh = bb.maxY - bb.minY;
    if (rw < 0.1 || rh < 0.1) return;
    const mg = isFullScreen ? 100 : 60;
    const fz = Math.max(MIN_Z, Math.min(MAX_Z, Math.min((cw - mg * 2) / (rw * PX_PER_FT), (ch - mg * 2) / (rh * PX_PER_FT))));
    const px = (cw - rw * PX_PER_FT * fz) / 2 - bb.minX * PX_PER_FT * fz;
    const py = (ch - rh * PX_PER_FT * fz) / 2 - bb.minY * PX_PER_FT * fz;
    setEs(prev => prev ? { ...prev, zoom: fz, panX: px, panY: py } : prev);
  }, [isFullScreen]);

  // Run sizeAndFit on mount, on window resize, and when isFullScreen changes
  useEffect(() => {
    // Immediate size
    sizeAndFit();
    // Also after a short delay to catch layout shifts (CSS transitions, etc.)
    const t = setTimeout(sizeAndFit, 50);
    window.addEventListener("resize", sizeAndFit);
    return () => { clearTimeout(t); window.removeEventListener("resize", sizeAndFit); };
  }, [sizeAndFit]);

  // Also re-fit when room dimensions change
  useEffect(() => {
    sizeAndFit();
  }, [es?.roomWidthFt, es?.roomHeightFt]); // eslint-disable-line

  // ═════════════════════════════════════════════════════════════
  //  POINTER HANDLERS
  // ═════════════════════════════════════════════════════════════

  /** Convert a React mouse event to canvas-local pixel coordinates. */
  const getXY = (e: React.MouseEvent): { cx: number; cy: number } => {
    const c = cvs.current;
    if (!c) return { cx: 0, cy: 0 };
    const r = c.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };

  const onDown = useCallback((e: React.MouseEvent) => {
    const s = sr.current;
    if (!s) return;
    const {cx, cy} = getXY(e);
    const ft = c2f(cx, cy);
    setCtxMenu(null);
    committed.current = true;

    if (e.button === 2) {
      e.preventDefault();
      const hit = hitF(ft.x, ft.y);
      if (hit) { setCtxMenu({ x: e.clientX, y: e.clientY, tid: hit.id, ttype: "furniture" }); return; }
      // Check doors/windows for right-click
      const dw = hitDW(ft.x, ft.y);
      if (dw) { setCtxMenu({ x: e.clientX, y: e.clientY, tid: dw.id, ttype: dw.type }); setSelDW(dw); }
      return;
    }
    if (e.button === 1 || space.current || tool === "pan") {
      pan.current = true; panSt.current = {x:cx,y:cy}; return;
    }
    if (tool === "eraser" && isFullScreen) {
      const hit = hitF(ft.x, ft.y);
      if (hit) {
        const nf = deleteFurniture(s.furniture, hit.id);
        const ns = {...s, furniture: nf};
        setEs(ns); pushHist(ns);
        if (selId === hit.id) setSelId(null);
      } else {
        // Eraser also removes doors/windows
        const dw = hitDW(ft.x, ft.y);
        if (dw) {
          const ns = dw.type === "door"
            ? {...s, doors: removeDoor(s.doors, dw.id)}
            : {...s, windows: removeWindow(s.windows, dw.id)};
          setEs(ns); pushHist(ns);
          if (selDW?.id === dw.id) setSelDW(null);
        }
      }
      return;
    }
    if (tool === "measure" && isFullScreen) {
      if (!mStart.current) { mStart.current = ft; mEnd.current = null; }
      else { mEnd.current = ft; mStart.current = null; }
      return;
    }
    if (tool === "door" && isFullScreen) {
      const segs = getWallSegments(s.room);
      const nw = nearestWall(ft.x, ft.y, segs, 1);
      if (nw) { const nd = addDoorToWall(s.doors, nw.wall.id, nw.t); const ns = {...s, doors: nd}; setEs(ns); pushHist(ns); }
      return;
    }
    if (tool === "window" && isFullScreen) {
      const segs = getWallSegments(s.room);
      const nw = nearestWall(ft.x, ft.y, segs, 1);
      if (nw) { const nws = addWindowToWall(s.windows, nw.wall.id, nw.t); const ns = {...s, windows: nws}; setEs(ns); pushHist(ns); }
      return;
    }
    if (tool === "select") {
      if (selId && hitRot(cx, cy)) { rot.current = true; dragSt.current = ft; committed.current = false; return; }
      const rh = hitResize(cx, cy);
      if (rh) { resz.current = rh; dragSt.current = ft; committed.current = false; return; }
      if (isFullScreen) {
        const vi = hitVert(ft.x, ft.y);
        if (vi !== null) { vert.current = vi; dragSt.current = ft; committed.current = false; return; }
      }
      const hit = hitF(ft.x, ft.y);
      if (hit) {
        if (e.shiftKey) {
          // Shift-click: toggle in multi-select
          setSelIds(prev => prev.includes(hit.id) ? prev.filter(id => id !== hit.id) : [...prev, hit.id]);
          if (!selId) setSelId(hit.id);
        } else if (allSelIds.includes(hit.id) && allSelIds.length > 1) {
          // Click on already-selected item in multi-sel: start multi-drag
          multiDrag.current = true;
          multiDragStart.current = ft;
          committed.current = false;
        } else {
          setSelId(hit.id);
          setSelIds([]);
          if (!hit.locked) { drag.current = true; dragOff.current = {x:ft.x-hit.x, y:ft.y-hit.y}; dragSt.current = ft; committed.current = false; }
        }
        setSelDW(null);
        setSidePanel("props");
        return;
      }
      // Check doors/windows before rubber-band
      const dw = hitDW(ft.x, ft.y);
      if (dw) {
        setSelDW(dw); setSelId(null); setSelIds([]);
        return;
      }
      // No hit — start rubber-band selection
      setSelId(null); setSelIds([]); setSelDW(null); setGuides([]);
      rubberBand.current = { x1: ft.x, y1: ft.y, x2: ft.x, y2: ft.y };
    }
  }, [tool, selId, allSelIds, isFullScreen, c2f, hitF, hitDW, hitVert, hitResize, hitRot, pushHist]);

  const onMove = useCallback((e: React.MouseEvent) => {
    const s = sr.current;
    if (!s) return;
    const {cx,cy} = getXY(e);
    const ft = c2f(cx, cy);

    if (pan.current && panSt.current) {
      const dx = cx - panSt.current.x, dy = cy - panSt.current.y;
      setEs(prev => prev ? {...prev, panX:prev.panX+dx, panY:prev.panY+dy} : prev);
      panSt.current = {x:cx,y:cy}; return;
    }
    if (rubberBand.current) {
      rubberBand.current = { ...rubberBand.current, x2: ft.x, y2: ft.y };
      return;
    }
    if (multiDrag.current && multiDragStart.current) {
      const dx = ft.x - multiDragStart.current.x;
      const dy = ft.y - multiDragStart.current.y;
      const nf = moveMultiple(s.furniture, allSelIds, dx, dy);
      setEs(prev => prev ? {...prev, furniture: nf} : prev);
      multiDragStart.current = ft;
      return;
    }
    if (vert.current !== null) {
      let np = {x:ft.x, y:ft.y};
      if (s.snapToGrid) np = snapToGrid(ft.x, ft.y, s.gridSize);
      const nr = moveVertex(s.room, vert.current, np);
      const nw = getWallSegments(nr); const nb = getRoomBounds(nr);
      setEs(prev => prev ? {...prev, room:nr, walls:nw, roomWidthFt:nb.maxX-nb.minX, roomHeightFt:nb.maxY-nb.minY} : prev);
      return;
    }
    if (rot.current && selId) {
      const f = s.furniture.find(ff => ff.id === selId);
      if (f) {
        const angle = Math.atan2(ft.y-f.y, ft.x-f.x)*180/Math.PI + 90;
        const snapped = e.shiftKey ? Math.round(angle/15)*15 : Math.round(angle);
        const nf = s.furniture.map(item => item.id === selId ? {...item, rotation:((snapped%360)+360)%360} : item);
        setEs(prev => prev ? {...prev, furniture:nf} : prev);
      }
      return;
    }
    if (resz.current && selId && dragSt.current) {
      const f = s.furniture.find(ff => ff.id === selId);
      if (f) {
        const r = resz.current;
        const dx = ft.x - dragSt.current.x, dy = ft.y - dragSt.current.y;
        let nw = f.w, nh = f.h, nx = f.x, ny = f.y;
        if (r.includes("r")) {nw=Math.max(0.5,f.w+dx); nx=f.x+dx/2;}
        if (r.includes("l")) {nw=Math.max(0.5,f.w-dx); nx=f.x+dx/2;}
        if (r.includes("b")) {nh=Math.max(0.5,f.h+dy); ny=f.y+dy/2;}
        if (r.includes("t")) {nh=Math.max(0.5,f.h-dy); ny=f.y+dy/2;}
        if (e.shiftKey) { const rat = f.w/f.h; if (r.includes("l")||r.includes("r")) nh=nw/rat; else nw=nh*rat; }
        const nf = s.furniture.map(item => item.id === selId ? {...item,w:nw,h:nh,x:nx,y:ny} : item);
        setEs(prev => prev ? {...prev, furniture:nf} : prev);
        dragSt.current = ft;
      }
      return;
    }
    if (drag.current && selId) {
      const f = s.furniture.find(ff => ff.id === selId);
      if (f && !f.locked) {
        let nx = ft.x - dragOff.current.x, ny = ft.y - dragOff.current.y;
        if (s.snapToGrid) { const sn = snapToGrid(nx, ny, s.gridSize); nx = sn.x; ny = sn.y; }
        const {x:sx,y:sy,guides:ng} = applySmartSnap(nx,ny,f.w,f.h,s.furniture,s.room,snapThr());
        setGuides(ng); nx = sx; ny = sy;
        coll.current = checkCollision({...f,x:nx,y:ny}, s.furniture);
        const nf = moveFurniture(s.furniture, selId, nx, ny);
        setEs(prev => prev ? {...prev, furniture:nf} : prev);
      }
      return;
    }
    if (tool === "measure" && mStart.current) { mEnd.current = ft; return; }
    const hit = hitF(ft.x, ft.y);
    setHovId(hit ? hit.id : null);
  }, [tool, selId, allSelIds, isFullScreen, c2f, hitF, snapThr]);

  const onUp = useCallback(() => {
    if (rubberBand.current && sr.current) {
      const rb = rubberBand.current;
      const found = selectInRect(sr.current.furniture, rb.x1, rb.y1, rb.x2, rb.y2);
      if (found.length > 0) {
        setSelId(found[0]);
        setSelIds(found);
      }
      rubberBand.current = null;
    }
    if (!committed.current && sr.current) { pushHist(sr.current); }
    drag.current = false; resz.current = null; rot.current = false;
    pan.current = false; panSt.current = null; dragSt.current = null;
    vert.current = null; setGuides([]); coll.current = false;
    multiDrag.current = false; multiDragStart.current = null;
    committed.current = true;
  }, [pushHist]);

  // ─── WHEEL — use native non-passive listener so preventDefault works ───
  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      const s = sr.current;
      if (!s) return;
      e.preventDefault(); e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      // Trackpad detection: has horizontal delta, OR pixel-mode small delta without ctrl
      const isTrackpadPan = Math.abs(e.deltaX) > 2 || (e.deltaMode === 0 && !e.ctrlKey && Math.abs(e.deltaY) < 60 && Math.abs(e.deltaY) > 0);
      if (e.ctrlKey) {
        // Pinch-to-zoom on trackpad
        const factor = e.deltaY < 0 ? 1.04 : 0.96;
        const nz = Math.max(MIN_Z, Math.min(MAX_Z, s.zoom * factor));
        const sc2 = nz / s.zoom;
        setEs(prev => prev ? {...prev, zoom:nz, panX:cx-sc2*(cx-prev.panX), panY:cy-sc2*(cy-prev.panY)} : prev);
      } else if (!isTrackpadPan) {
        // Mouse wheel — zoom
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        const nz = Math.max(MIN_Z, Math.min(MAX_Z, s.zoom * factor));
        const sc2 = nz / s.zoom;
        setEs(prev => prev ? {...prev, zoom:nz, panX:cx-sc2*(cx-prev.panX), panY:cy-sc2*(cy-prev.panY)} : prev);
      } else {
        // Trackpad two-finger pan
        setEs(prev => prev ? {...prev, panX:prev.panX - e.deltaX, panY:prev.panY - e.deltaY} : prev);
      }
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  const onCtx = useCallback((e: React.MouseEvent) => { e.preventDefault(); }, []);

  // ═════════════════════════════════════════════════════════════
  //  KEYBOARD — fullscreen only
  // ═════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!isFullScreen) return;
    const down = (e: KeyboardEvent) => {
      const s = sr.current;
      if (!s) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (e.key === " ") { space.current = true; e.preventDefault(); return; }
      if (e.key === "Escape") { setSelId(null); setSelIds([]); setSelDW(null); setGuides([]); mStart.current = null; mEnd.current = null; return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selDW) {
          // Delete selected door or window
          const ns = selDW.type === "door"
            ? {...s, doors: removeDoor(s.doors, selDW.id)}
            : {...s, windows: removeWindow(s.windows, selDW.id)};
          setEs(ns); pushHist(ns); setSelDW(null);
        } else if (allSelIds.length > 1) {
          const nf = deleteMultiple(s.furniture, allSelIds);
          const ns = {...s, furniture: nf}; setEs(ns); pushHist(ns);
          setSelId(null); setSelIds([]);
        } else if (selId) {
          const nf = deleteFurniture(s.furniture, selId);
          const ns = {...s, furniture: nf}; setEs(ns); pushHist(ns); setSelId(null);
        }
        return;
      }
      if (e.key === "r" || e.key === "R") {
        if (allSelIds.length > 1) {
          const nf = rotateMultiple(s.furniture, allSelIds, 90);
          const ns = {...s, furniture: nf}; setEs(ns); pushHist(ns);
        } else if (selId) {
          const nf = rotateFurniture(s.furniture, selId, 90);
          const ns = {...s, furniture: nf}; setEs(ns); pushHist(ns);
        }
        return;
      }
      if ((e.metaKey||e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.metaKey||e.ctrlKey) && e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); return; }
      if ((e.metaKey||e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        if (allSelIds.length > 1) {
          const nf = duplicateMultiple(s.furniture, allSelIds);
          const ns = {...s, furniture: nf}; setEs(ns); pushHist(ns);
        } else if (selId) {
          const nf = duplicateFurniture(s.furniture, selId);
          const ns = {...s, furniture: nf}; setEs(ns); pushHist(ns);
        }
        return;
      }
      if ((e.metaKey||e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        const all = selectAll(s.furniture);
        setSelIds(all);
        if (all.length > 0) setSelId(all[0]);
        return;
      }
      if ((e.metaKey||e.ctrlKey) && e.key === "0") { e.preventDefault(); fitRoom(); return; }
      if (e.key === "g") { setEs(prev => prev ? {...prev, showGrid:!prev.showGrid} : prev); return; }
      if (e.key === "v") { setTool("select"); return; }
      if (e.key === "h") { setTool("pan"); return; }
      if (e.key === "m") { setTool("measure"); return; }
      if (e.key === "x") { setTool("eraser"); return; }
      if (e.key === "=" || e.key === "+") { setEs(prev => prev ? {...prev, zoom:Math.min(MAX_Z, prev.zoom*1.15)} : prev); return; }
      if (e.key === "-") { setEs(prev => prev ? {...prev, zoom:Math.max(MIN_Z, prev.zoom/1.15)} : prev); return; }
      // Arrow key nudge — debounced undo history
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && (selId || allSelIds.length > 0)) {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.5;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        let ns: FloorPlanEditorState | null = null;
        if (allSelIds.length > 1) {
          const nf = moveMultiple(s.furniture, allSelIds, dx, dy);
          ns = {...s, furniture: nf};
        } else if (selId) {
          const f = s.furniture.find(ff => ff.id === selId);
          if (f && !f.locked) {
            const nf = moveFurniture(s.furniture, selId, f.x + dx, f.y + dy);
            ns = {...s, furniture: nf};
          }
        }
        if (ns) {
          setEs(ns);
          // Debounce history: only push after 400ms of no arrow keys
          if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
          const captured = ns;
          nudgeTimer.current = setTimeout(() => { pushHist(captured); nudgeTimer.current = null; }, 400);
        }
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [isFullScreen, selId, selDW, allSelIds, undo, redo, pushHist, fitRoom]);

  // ─── Context menu actions ───
  const cAct: ContextMenuActions = {
    rotate90: () => { if (!es || !ctxMenu) return; const nf = rotateFurniture(es.furniture, ctxMenu.tid, 90); const ns = { ...es, furniture: nf }; setEs(ns); pushHist(ns); setCtxMenu(null); },
    dup: () => { if (!es || !ctxMenu) return; const nf = duplicateFurniture(es.furniture, ctxMenu.tid); const ns = { ...es, furniture: nf }; setEs(ns); pushHist(ns); setCtxMenu(null); },
    lock: () => { if (!es || !ctxMenu) return; const nf = toggleLock(es.furniture, ctxMenu.tid); setEs({ ...es, furniture: nf }); setCtxMenu(null); },
    del: () => {
      if (!es || !ctxMenu) return;
      if (ctxMenu.ttype === "door") {
        const ns = { ...es, doors: removeDoor(es.doors, ctxMenu.tid) };
        setEs(ns); pushHist(ns); setCtxMenu(null); setSelDW(null);
      } else if (ctxMenu.ttype === "window") {
        const ns = { ...es, windows: removeWindow(es.windows, ctxMenu.tid) };
        setEs(ns); pushHist(ns); setCtxMenu(null); setSelDW(null);
      } else {
        const nf = deleteFurniture(es.furniture, ctxMenu.tid);
        const ns = { ...es, furniture: nf }; setEs(ns); pushHist(ns); setCtxMenu(null);
        if (selId === ctxMenu.tid) setSelId(null);
      }
    },
    front: () => { if (!es || !ctxMenu) return; const nf = bringToFront(es.furniture, ctxMenu.tid); setEs({ ...es, furniture: nf }); setCtxMenu(null); },
    back: () => { if (!es || !ctxMenu) return; const nf = sendToBack(es.furniture, ctxMenu.tid); setEs({ ...es, furniture: nf }); setCtxMenu(null); },
  };

  const applyRoom = () => {
    if (!es) return;
    const w = parseFloat(riW), h = parseFloat(riH);
    if (isNaN(w)||isNaN(h)||w<4||h<4) return;
    let nr: EditorRoom;
    if (roomMode === "L") nr = createLShapedRoom(w,h,w*0.6,h*0.6);
    else if (roomMode === "U") nr = createUShapedRoom(w,h,w*0.3,h*0.4);
    else if (roomMode === "T") nr = createTShapedRoom(w,h,w*0.4,h*0.4);
    else nr = createEmptyRoom(w,h);
    const nw = getWallSegments(nr);
    const ns = {...es, room:nr, walls:nw, roomWidthFt:w, roomHeightFt:h};
    setEs(ns); pushHist(ns);
  };

  /** Applies an alignment/distribution function to the current multi-selection. */
  type AlignFn = (furniture: EditorFurniture[], ids: string[]) => EditorFurniture[];
  const doAlign = (fn: AlignFn): void => {
    if (!es || allSelIds.length < 2) return;
    const nf = fn(es.furniture, allSelIds);
    const ns = { ...es, furniture: nf };
    setEs(ns);
    pushHist(ns);
  };

  const doSave = () => { if (es && onSave) onSave(es); };

  const doExport = () => {
    if (!es) return;
    const json = exportToJSON(es);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `floorplan-${es.roomType.replace(/\s/g,"-")}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const doValidate = () => {
    if (!es) return;
    setValidationIssues(validatePlacement(es.furniture, es.room));
  };

  // Filtered library
  const filteredLib = useMemo(() => {
    return LIBRARY_ITEMS.filter(item => {
      if (libCat !== "all" && item.category !== libCat) return false;
      if (libSearch && !item.label.toLowerCase().includes(libSearch.toLowerCase())) return false;
      return true;
    });
  }, [libCat, libSearch]);

  const stats = useMemo(() => es ? computeStatistics(es) : null, [es]);

  // ═════════════════════════════════════════════════════════════
  //  JSX
  // ═════════════════════════════════════════════════════════════

  if (!es) return null;

  const area = getRoomArea(es.room);
  const sf = selId ? es.furniture.find(f => f.id === selId) || null : null;
  const cur = getCur(tool, drag.current, pan.current, resz.current, rot.current, space.current);

  // ─── EMBEDDED VIEW — simplified preview with clear CTA ───
  if (!isFullScreen) return (
    <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden", boxShadow: "0 2px 16px rgba(100,85,70,0.07)" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${P.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: P.surface, flexWrap: "wrap", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: P.accent, fontWeight: 700, margin: 0 }}>Floor Plan Preview</p>
          <p style={{ fontSize: 11, color: P.textMuted, margin: "3px 0 0" }}>{es.roomType} — {es.roomWidthFt.toFixed(0)}{"\u2032"}{"\u00D7"}{es.roomHeightFt.toFixed(0)}{"\u2032"} ({Math.round(area)} sqft) — {es.furniture.length} items</p>
        </div>
        <button onClick={() => { if (onSave) onSave(es); }} style={{ background: P.accent, color: P.white, border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s", boxShadow: "0 2px 8px rgba(181,112,77,0.25)", display: "flex", alignItems: "center", gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.background = P.accentHover; }}
          onMouseLeave={e => { e.currentTarget.style.background = P.accent; }}>
          Open Full Editor {"\u2197"}
        </button>
      </div>
      {/* Canvas — read-only preview (click anywhere also opens editor) */}
      <div ref={ctr} className="aura-fp-preview" style={{ position: "relative", height: 420, cursor: "pointer" }}
        onClick={() => { if (onSave) onSave(es); }}>
        <canvas ref={cvs} style={{ display: "block", width: "100%", height: "100%", touchAction: "none", pointerEvents: "none" }} />
        {/* Overlay hint */}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ background: "rgba(60,50,40,0.7)", color: "#fff", padding: "12px 24px", borderRadius: 12, fontSize: 13, fontWeight: 600, backdropFilter: "blur(4px)", opacity: 0.9, display: "flex", alignItems: "center", gap: 8 }}>
            Click to open full editor — drag furniture, edit room shape, add doors & windows
          </div>
        </div>
      </div>
      {/* Footer */}
      <div style={{ padding: "10px 20px", borderTop: `1px solid ${P.borderLight}`, display: "flex", gap: 16, alignItems: "center", background: "#FAFAF7", fontSize: 10, color: P.textMuted }}>
        <span>{es.furniture.length} items placed</span>
        <span>{es.doors.length} doors</span>
        <span>{es.windows.length} windows</span>
        <span style={{ marginLeft: "auto", color: P.accent, fontWeight: 600 }}>Click to edit {"\u2192"}</span>
      </div>
    </div>
  );

  // ─── FULLSCREEN VIEW ───
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: P.white, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ padding: "8px 20px", borderBottom: `1px solid ${P.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: P.surface, flexShrink: 0 }}>
        <div>
          <p style={{ fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: P.accent, fontWeight: 700, margin: 0 }}>AURA Floor Plan Editor</p>
          <p style={{ fontSize: 11, color: P.textMuted, margin: "2px 0 0" }}>{es.roomType} — {es.roomWidthFt.toFixed(0)}′×{es.roomHeightFt.toFixed(0)}′ ({Math.round(area)} sqft) — {es.style}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={doExport} style={hBtn("#6B7B5B")}>⬇ Export</button>
          <button onClick={doSave} style={hBtn("#4B7B50",true)}>💾 Save</button>
          {onClose && <button onClick={onClose} style={hBtn("#8B7B6B")}>✕ Close</button>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="aura-fp-toolbar" style={{ padding: "6px 16px", borderBottom: `1px solid ${P.borderLight}`, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", background: "#FAFAF7", flexShrink: 0 }}>
        {TOOLS.map(t => (
          <button key={t} onClick={() => setTool(t)} title={`${TL[t]} (${TK[t]})`}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "5px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", minWidth: 48, gap: 1, border: `1px solid ${tool===t?P.accent:P.border}`, background: tool===t?P.accent:P.white, color: tool===t?P.white:P.textSec, transition: "all 0.15s" }}>
            <span style={{ fontSize: 14 }}>{TI[t]}</span>
            <span style={{ fontSize: 9, fontWeight: 600 }}>{TL[t]}</span>
          </button>
        ))}
        <div style={{ width: 1, height: 28, background: P.borderLight, margin: "0 6px" }} />
        <button onClick={undo} disabled={histI<=0} style={sBtn(histI>0)} title="Undo (⌘Z)">↩</button>
        <button onClick={redo} disabled={histI>=hist.length-1} style={sBtn(histI<hist.length-1)} title="Redo (⌘⇧Z)">↪</button>
        <div style={{ width: 1, height: 28, background: P.borderLight, margin: "0 6px" }} />
        {([["showGrid","Grid","G"],["showDimensions","Dims",""],["showClearances","Clear.",""],["showTrafficFlow","Traffic",""]] as [ToggleKey,string,string][]).map(([k,l]) => (
          <button key={k} onClick={() => setEs(prev => prev ? toggleEditorFlag(prev, k) : prev)}
            style={{ ...tBtn, background: getToggle(es, k) ? "#EDE8E0" : P.white, color: getToggle(es, k) ? P.textSec : P.textMuted, borderColor: getToggle(es, k) ? "#D5CFC5" : P.border }}>{l}</button>
        ))}
        <div style={{ width: 1, height: 28, background: P.borderLight, margin: "0 6px" }} />
        {hasMultiSel && (<>
          <span style={{ fontSize: 9, color: P.accent, fontWeight: 700, letterSpacing: ".05em" }}>ALIGN:</span>
          {[{l:"⬅",fn:alignLeft,t:"Left"},{l:"➡",fn:alignRight,t:"Right"},{l:"⬆",fn:alignTop,t:"Top"},{l:"⬇",fn:alignBottom,t:"Bottom"},{l:"⬌",fn:alignCenterH,t:"Center H"},{l:"⬍",fn:alignCenterV,t:"Center V"}].map(a => (
            <button key={a.t} onClick={() => doAlign(a.fn)} style={sBtn(true)} title={`Align ${a.t}`}>{a.l}</button>
          ))}
          <span style={{ fontSize: 9, color: P.accent, fontWeight: 700, letterSpacing: ".05em", marginLeft: 4 }}>DIST:</span>
          <button onClick={() => doAlign(distributeHorizontal)} style={sBtn(true)} title="Distribute H">⬌⬌</button>
          <button onClick={() => doAlign(distributeVertical)} style={sBtn(true)} title="Distribute V">⬍⬍</button>
          <div style={{ width: 1, height: 28, background: P.borderLight, margin: "0 4px" }} />
        </>)}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEs(prev => prev ? {...prev, zoom: Math.max(MIN_Z, prev.zoom/1.15)} : prev)} style={sBtn(true)}>−</button>
        <span style={{ fontSize: 10, color: P.textSec, minWidth: 40, textAlign: "center", fontWeight: 600 }}>{Math.round(es.zoom*100)}%</span>
        <button onClick={() => setEs(prev => prev ? {...prev, zoom: Math.min(MAX_Z, prev.zoom*1.15)} : prev)} style={sBtn(true)}>+</button>
        <button onClick={fitRoom} style={sBtn(true)} title="Fit (⌘0)">⊡</button>
      </div>

      {/* Main area */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Canvas */}
        <div ref={ctr} style={{ flex: 1, position: "relative", cursor: cur }}>
          <canvas ref={cvs} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onContextMenu={onCtx} style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }} />
          {showTooltip && !selId && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(60,50,40,0.88)", color: "#fff", padding: "8px 18px", borderRadius: 10, fontSize: 11, display: "flex", gap: 16, alignItems: "center", whiteSpace: "nowrap" }}>
              <span>🖱 Click to select</span><span>⇧+Click multi-select</span><span>Drag empty area to box-select</span><span>Scroll to zoom</span>
              <button onClick={() => { setShowTooltip(false); try { localStorage.setItem("aura_editor_tooltip", "0"); } catch {} }} style={{ background: "none", border: "none", color: "#fff8", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="aura-fp-sidebar" style={{ width: 260, borderLeft: `1px solid ${P.borderLight}`, background: P.surface, display: "flex", flexDirection: "column", flexShrink: 0, fontSize: 11, color: P.textSec }}>
          {/* Sidebar tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${P.borderLight}`, flexShrink: 0 }}>
            {([["props","Properties"],["library","Library"],["room","Room"],["templates","Templates"],["stats","Stats"]] as [SidePanel, string][]).map(([k,l]) => (
              <button key={k} onClick={() => setSidePanel(k)}
                style={{ flex: 1, padding: "8px 4px", border: "none", borderBottom: `2px solid ${sidePanel===k?P.accent:"transparent"}`, background: sidePanel===k?"#F5F0EB":"transparent", color: sidePanel===k?P.accent:P.textMuted, fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase", letterSpacing: ".05em", transition: "all 0.15s" }}>{l}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {/* Properties panel */}
            {sidePanel === "props" && sf && !hasMultiSel && (<>
              <p style={pH}>Selected Item</p>
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", color: P.text }}>{sf.label}</p>
              <p style={{ fontSize: 10, color: P.textMuted, margin: "0 0 14px" }}>{sf.category} · {sf.shape}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
                <label style={fL}>X (ft)</label><label style={fL}>Y (ft)</label>
                <input type="number" step="0.5" value={sf.x.toFixed(1)} onChange={e => { const v=parseFloat(e.target.value); if(!isNaN(v)){const nf=moveFurniture(es.furniture,sf.id,v,sf.y); setEs(prev => prev?{...prev,furniture:nf}:prev);}}} style={fI} />
                <input type="number" step="0.5" value={sf.y.toFixed(1)} onChange={e => { const v=parseFloat(e.target.value); if(!isNaN(v)){const nf=moveFurniture(es.furniture,sf.id,sf.x,v); setEs(prev => prev?{...prev,furniture:nf}:prev);}}} style={fI} />
                <label style={fL}>W (ft)</label><label style={fL}>D (ft)</label>
                <input type="number" step="0.5" value={sf.w.toFixed(1)} onChange={e => { const v=parseFloat(e.target.value); if(!isNaN(v)&&v>=0.5){const nf=resizeFurniture(es.furniture,sf.id,v,sf.h); setEs(prev => prev?{...prev,furniture:nf}:prev);}}} style={fI} />
                <input type="number" step="0.5" value={sf.h.toFixed(1)} onChange={e => { const v=parseFloat(e.target.value); if(!isNaN(v)&&v>=0.5){const nf=resizeFurniture(es.furniture,sf.id,sf.w,v); setEs(prev => prev?{...prev,furniture:nf}:prev);}}} style={fI} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={fL}>Rotation</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="range" min="0" max="360" step="15" value={sf.rotation} onChange={e => { const nf=es.furniture.map(f => f.id===sf.id?{...f,rotation:parseInt(e.target.value)}:f); setEs(prev => prev?{...prev,furniture:nf}:prev);}} style={{ flex:1, accentColor:P.accent }} />
                  <span style={{ fontSize: 10, minWidth: 32, color: P.textMuted }}>{sf.rotation}°</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => { const nf=rotateFurniture(es.furniture,sf.id,90); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); }} style={pB}>↻ Rotate 90°</button>
                <button onClick={() => { const nf=duplicateFurniture(es.furniture,sf.id); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); }} style={pB}>⊕ Duplicate</button>
                <button onClick={() => { const nf=toggleLock(es.furniture,sf.id); setEs(prev => prev?{...prev,furniture:nf}:prev); }} style={pB}>{sf.locked?"🔓 Unlock":"🔒 Lock"}</button>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => { const nf=bringToFront(es.furniture,sf.id); setEs({...es,furniture:nf}); }} style={{...pB,flex:1}}>↑ Front</button>
                  <button onClick={() => { const nf=sendToBack(es.furniture,sf.id); setEs({...es,furniture:nf}); }} style={{...pB,flex:1}}>↓ Back</button>
                </div>
                <button onClick={() => { const nf=deleteFurniture(es.furniture,sf.id); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); setSelId(null); }} style={{...pB,color:P.danger,borderColor:"#E8A0A0"}}>✕ Delete</button>
              </div>
            </>)}

            {sidePanel === "props" && hasMultiSel && (<>
              <p style={pH}>{allSelIds.length} Items Selected</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button onClick={() => doAlign(alignLeft)} style={pB}>⬅ Align Left</button>
                <button onClick={() => doAlign(alignRight)} style={pB}>➡ Align Right</button>
                <button onClick={() => doAlign(alignTop)} style={pB}>⬆ Align Top</button>
                <button onClick={() => doAlign(alignBottom)} style={pB}>⬇ Align Bottom</button>
                <button onClick={() => doAlign(alignCenterH)} style={pB}>⬌ Center Horizontal</button>
                <button onClick={() => doAlign(alignCenterV)} style={pB}>⬍ Center Vertical</button>
                <div style={{ borderTop: `1px solid ${P.borderLight}`, marginTop: 8, paddingTop: 8 }} />
                <button onClick={() => doAlign(distributeHorizontal)} style={pB}>↔ Distribute Horizontal</button>
                <button onClick={() => doAlign(distributeVertical)} style={pB}>↕ Distribute Vertical</button>
                <div style={{ borderTop: `1px solid ${P.borderLight}`, marginTop: 8, paddingTop: 8 }} />
                <button onClick={() => { const nf=rotateMultiple(es.furniture,allSelIds,90); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); }} style={pB}>↻ Rotate All 90°</button>
                <button onClick={() => { const nf=flipHorizontal(es.furniture,allSelIds); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); }} style={pB}>⇔ Flip Horizontal</button>
                <button onClick={() => { const nf=flipVertical(es.furniture,allSelIds); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); }} style={pB}>⇕ Flip Vertical</button>
                <button onClick={() => { const nf=lockMultiple(es.furniture,allSelIds); setEs({...es,furniture:nf}); }} style={pB}>🔒 Lock All</button>
                <button onClick={() => { const nf=deleteMultiple(es.furniture,allSelIds); const ns={...es,furniture:nf}; setEs(ns); pushHist(ns); setSelId(null); setSelIds([]); }} style={{...pB,color:P.danger,borderColor:"#E8A0A0"}}>✕ Delete All</button>
              </div>
            </>)}

            {sidePanel === "props" && !sf && !hasMultiSel && (<>
              <p style={pH}>Nothing Selected</p>
              <p style={{ fontSize: 11, color: P.textMuted, lineHeight: 1.7 }}>Click an item to select it, or drag an empty area to box-select multiple items.</p>
              <div style={{ borderTop: `1px solid ${P.borderLight}`, marginTop: 14, paddingTop: 14 }}>
                <p style={{...pH,color:P.textMuted}}>Shortcuts</p>
                <div style={{ fontSize: 9, color: P.textMuted, lineHeight: 1.9 }}>
                  {[["V","Select"],["H","Pan"],["M","Measure"],["X","Erase"],["R","Rotate"],["Del","Delete"],["⌘D","Duplicate"],["⌘A","Select All"],["⌘Z","Undo"],["⌘⇧Z","Redo"],["⌘0","Fit"],["Arrows","Nudge"],["⇧+Arrows","Fine nudge"]].map(([k,d]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, color: P.textSec, background: "#EDE8E0", padding: "1px 5px", borderRadius: 3, fontSize: 8 }}>{k}</span><span>{d}</span></div>
                  ))}
                </div>
              </div>
            </>)}

            {/* Library panel */}
            {sidePanel === "library" && (<>
              <p style={pH}>Furniture Library</p>
              <input type="text" placeholder="Search..." value={libSearch} onChange={e => setLibSearch(e.target.value)}
                style={{ ...fI, width: "100%", marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {["all","sofa","bed","table","chair","storage","rug","light","art","accent","decor","stool"].map(c => (
                  <button key={c} onClick={() => setLibCat(c)}
                    style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${libCat===c?P.accent:P.border}`, background: libCat===c?P.accentBg:P.white, color: libCat===c?P.accent:P.textMuted, fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>{c}</button>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {filteredLib.map((item, i) => {
                  const clr = FURN_FILLS[item.category] || DEFAULT_FILL;
                  return (
                    <button key={i} onClick={() => addFromLibrary(item)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${P.border}`, borderRadius: 8, background: P.white, cursor: "pointer", fontFamily: "inherit", transition: "all 0.1s", textAlign: "left" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = P.accent; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = P.border; }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: clr.bg, border: `1px solid ${clr.stroke}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 8, color: clr.text, fontWeight: 700 }}>{item.category.slice(0,2).toUpperCase()}</span>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: P.text }}>{item.label}</p>
                        <p style={{ margin: 0, fontSize: 9, color: P.textMuted }}>{item.w}′×{item.h}′ · {item.category}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>)}

            {/* Room panel */}
            {sidePanel === "room" && (<>
              <p style={pH}>Room Settings</p>
              <div style={{ marginBottom: 12 }}>
                <label style={fL}>Room Shape</label>
                <select value={roomMode} onChange={e => setRoomMode(e.target.value as RoomShapeMode)} style={{...fI,width:"100%"}}>
                  <option value="rect">Rectangle</option><option value="L">L-Shape</option><option value="U">U-Shape</option><option value="T">T-Shape</option>
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                <label style={fL}>Width (ft)</label><label style={fL}>Depth (ft)</label>
                <input type="number" step="0.5" value={riW} onChange={e => setRiW(e.target.value)} style={fI} />
                <input type="number" step="0.5" value={riH} onChange={e => setRiH(e.target.value)} style={fI} />
              </div>
              <button onClick={applyRoom} style={{...pB,width:"100%",marginBottom:16,fontWeight:600,background:P.accentBg,color:P.accent,borderColor:P.accentBorder}}>Apply Room Shape</button>
              <div style={{ borderTop: `1px solid ${P.borderLight}`, paddingTop: 14, marginBottom: 14 }}>
                <p style={{...pH,color:P.textMuted}}>Floor Material</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                  {FLOOR_MATERIALS.map(m => (
                    <button key={m.id} onClick={() => setFloorMat(m.id)} title={m.name}
                      style={{ width: "100%", aspectRatio: "1", borderRadius: 6, border: `2px solid ${floorMat===m.id?P.accent:P.border}`, background: m.color, cursor: "pointer", transition: "all 0.1s" }} />
                  ))}
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${P.borderLight}`, paddingTop: 14, marginBottom: 14 }}>
                <p style={{...pH,color:P.textMuted}}>Snap Settings</p>
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 11, marginBottom: 6 }}>
                  <input type="checkbox" checked={es.snapToGrid} onChange={e => setEs(prev => prev?{...prev,snapToGrid:e.target.checked}:prev)} style={{ accentColor:P.accent }} />Snap to Grid
                </label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <label style={{ fontSize: 10, color: P.textMuted }}>Grid:</label>
                  <select value={es.gridSize} onChange={e => setEs(prev => prev?{...prev,gridSize:parseFloat(e.target.value)}:prev)} style={{...fI,width:64}}><option value={0.5}>6 in</option><option value={1}>1 ft</option><option value={2}>2 ft</option></select>
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${P.borderLight}`, paddingTop: 14 }}>
                <p style={{...pH,color:P.textMuted}}>Validation</p>
                <button onClick={doValidate} style={{...pB,width:"100%",marginBottom:8}}>Check Placement</button>
                {validationIssues.length > 0 && (
                  <div style={{ background: P.warningBg, border: `1px solid ${P.warning}40`, borderRadius: 8, padding: 10 }}>
                    {validationIssues.map((v,i) => (
                      <p key={i} style={{ fontSize: 10, color: P.warning, margin: i>0?"4px 0 0":"0" }}>⚠ {v.issue}</p>
                    ))}
                  </div>
                )}
                {validationIssues.length === 0 && (
                  <p style={{ fontSize: 10, color: P.success }}>✓ All items properly placed</p>
                )}
              </div>
            </>)}

            {/* Templates panel */}
            {sidePanel === "templates" && (<>
              <p style={pH}>Room Templates</p>
              <p style={{ fontSize: 10, color: P.textMuted, marginBottom: 12 }}>Click to apply a room shape template.</p>
              {["Basic","Complex","Residential"].map(cat => (<div key={cat} style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>{cat}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {ROOM_TEMPLATES.filter(t => t.category === cat).map(t => (
                    <button key={t.id} onClick={() => { const ns = applyRoomTemplate(es, t.id); setEs(ns); pushHist(ns); setRiW(ns.roomWidthFt.toString()); setRiH(ns.roomHeightFt.toString()); }}
                      style={{ ...pB, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontWeight: 600, color: P.text }}>{t.name}</span>
                        <span style={{ fontSize: 9, color: P.textMuted, marginLeft: 8 }}>{t.description}</span>
                      </div>
                      <span style={{ fontSize: 9, color: P.accent, fontWeight: 700 }}>{t.widthFt}×{t.heightFt}</span>
                    </button>
                  ))}
                </div>
              </div>))}
            </>)}

            {/* Stats panel */}
            {sidePanel === "stats" && stats && (<>
              <p style={pH}>Room Statistics</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                {[
                  ["Room Area", `${stats.roomArea.toFixed(0)} sqft`],
                  ["Perimeter", `${stats.perimeter.toFixed(0)}'`],
                  ["Items", `${stats.itemCount}`],
                  ["Coverage", `${stats.coveragePct.toFixed(0)}%`],
                  ["Doors", `${stats.doorCount}`],
                  ["Windows", `${stats.windowCount}`],
                ].map(([l,v]) => (
                  <div key={l} style={{ background: P.white, border: `1px solid ${P.borderLight}`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: P.text, margin: 0 }}>{v}</p>
                    <p style={{ fontSize: 9, color: P.textMuted, margin: "2px 0 0", textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</p>
                  </div>
                ))}
              </div>
              <p style={{...pH, color: P.textMuted}}>By Category</p>
              {Object.entries(stats.categoryBreakdown).map(([cat, count]) => (
                <div key={cat} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${P.borderLight}` }}>
                  <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{cat}</span>
                  <span style={{ color: P.accent, fontWeight: 700 }}>{count}</span>
                </div>
              ))}
            </>)}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="aura-fp-statusbar" style={{ padding: "6px 20px", borderTop: `1px solid ${P.borderLight}`, display: "flex", gap: 20, alignItems: "center", background: "#FAFAF7", fontSize: 10, color: P.textMuted, flexShrink: 0 }}>
        <span>{es.roomWidthFt.toFixed(0)}′×{es.roomHeightFt.toFixed(0)}′ ({Math.round(area)} sqft)</span>
        <span>{es.furniture.length} items</span>
        <span>Tool: {TL[tool]}</span>
        {allSelIds.length > 1 && <span style={{ color: P.accent }}>{allSelIds.length} selected</span>}
        <span style={{ marginLeft: "auto" }}>Scroll to zoom · Drag to pan · ⇧+Click multi-select</span>
      </div>
      {ctxMenu && <CMenu m={ctxMenu} a={cAct} es={es} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
//  CONTEXT MENU
// ═════════════════════════════════════════════════════════════

interface ContextMenuPosition {
  x: number;
  y: number;
  tid: string;
  ttype: "furniture" | "door" | "window";
}

interface ContextMenuActions {
  rotate90: () => void;
  dup: () => void;
  lock: () => void;
  del: () => void;
  front: () => void;
  back: () => void;
}

interface CMenuProps {
  m: ContextMenuPosition;
  a: ContextMenuActions;
  es: FloorPlanEditorState;
  onClose: () => void;
}

function CMenu({ m, a, es, onClose }: CMenuProps) {
  const f = es.furniture.find(ff => ff.id === m.tid);
  const lk = f?.locked ?? false;
  const menuRef = useRef<HTMLDivElement>(null);
  interface ContextMenuItem {
    label: string;
    action: () => void;
    isDanger: boolean;
  }

  // Click-outside handler
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Door/window context menu — just delete
  const isDW = m.ttype === "door" || m.ttype === "window";
  const dwLabel = m.ttype === "door" ? "Door" : "Window";

  const items: ContextMenuItem[] = isDW ? [
    { label: "✕ Remove " + dwLabel, action: a.del, isDanger: true },
  ] : [
    { label: "↻ Rotate 90°", action: a.rotate90, isDanger: false },
    { label: "⊕ Duplicate", action: a.dup, isDanger: false },
    { label: lk ? "🔓 Unlock" : "🔒 Lock", action: a.lock, isDanger: false },
    { label: "↑ Bring to Front", action: a.front, isDanger: false },
    { label: "↓ Send to Back", action: a.back, isDanger: false },
    { label: "✕ Delete", action: a.del, isDanger: true },
  ];

  // Viewport boundary clamping
  const menuW = 180, menuH = items.length * 36 + 8;
  const clampedX = Math.min(m.x, window.innerWidth - menuW - 8);
  const clampedY = Math.min(m.y, window.innerHeight - menuH - 8);

  return (
    <div ref={menuRef} style={{ position: "fixed", left: Math.max(4, clampedX), top: Math.max(4, clampedY), background: P.white, borderRadius: 10, boxShadow: "0 4px 24px rgba(80,65,50,0.18)", border: `1px solid ${P.border}`, padding: "4px 0", zIndex: 10001, minWidth: menuW }}>
      {items.map((item, i) => (
        <button key={i} onClick={item.action} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 18px", border: "none", background: "none", fontSize: 12, cursor: "pointer", fontFamily: "inherit", color: item.isDanger ? P.danger : P.textSec, transition: "background 0.1s" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#F2EDE8"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>{item.label}</button>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

type CSSCursorValue = "grab" | "grabbing" | "crosshair" | "nwse-resize" | "nesw-resize" | "ns-resize" | "ew-resize" | "not-allowed" | "default";

function getCur(t: EditorTool, d: boolean, p: boolean, r: string | null, ro: boolean, sp: boolean): CSSCursorValue {
  if (p || sp) return "grab";
  if (d) return "grabbing";
  if (ro) return "crosshair";
  if (r) {
    if (r === "tl" || r === "br") return "nwse-resize";
    if (r === "tr" || r === "bl") return "nesw-resize";
    if (r === "t" || r === "b") return "ns-resize";
    if (r === "l" || r === "r") return "ew-resize";
  }
  if (t === "pan") return "grab";
  if (t === "door" || t === "window" || t === "measure") return "crosshair";
  if (t === "eraser") return "not-allowed";
  return "default";
}

const sBtn = (a:boolean): React.CSSProperties => ({ background:P.white, border:`1px solid ${P.border}`, borderRadius:6, padding:"3px 8px", cursor:a?"pointer":"default", fontSize:13, fontFamily:"inherit", color:a?P.textSec:"#D0C8C0", transition:"all 0.15s", opacity:a?1:0.5 });
const tBtn: React.CSSProperties = { border:`1px solid ${P.border}`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:"inherit", transition:"all 0.15s" };
const hBtn = (c:string,f=false): React.CSSProperties => ({ background:f?c:"transparent", color:f?P.white:c, border:`1px solid ${c}`, borderRadius:8, padding:"7px 16px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s" });
const pH: React.CSSProperties = { fontSize:10, letterSpacing:".1em", textTransform:"uppercase", color:P.accent, fontWeight:700, margin:"0 0 10px" };
const fL: React.CSSProperties = { fontSize:9, color:P.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:".05em" };
const fI: React.CSSProperties = { border:`1px solid ${P.border}`, borderRadius:6, padding:"5px 8px", fontSize:11, fontFamily:"inherit", color:P.textSec, background:P.white, outline:"none" };
const pB: React.CSSProperties = { background:P.white, border:`1px solid ${P.border}`, borderRadius:8, padding:"7px 12px", cursor:"pointer", fontSize:11, fontFamily:"inherit", color:P.textSec, textAlign:"left", transition:"all 0.15s" };

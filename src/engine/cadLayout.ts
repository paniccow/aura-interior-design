import { getProductDims } from "./designEngine";
import type { Product, CADLayout, PlacedItem, WindowDef, DoorDef, RoomType } from "../types";

interface AnchorRect { x: number; y: number; w: number; h: number; cx: number; cy: number; }

/* ─── PRO CAD LAYOUT GENERATOR ─── */
export function generateCADLayout(items: Product[], roomSqft: number, roomType: string, cadAnalysis?: string | null): CADLayout {
  // Room dimensions — use standard aspect ratios by room type
  const aspectRatios = { "Living Room": 1.4, "Bedroom": 1.25, "Dining Room": 1.3, "Kitchen": 1.1, "Office": 1.2, "Great Room": 1.5 };
  const aspect = (aspectRatios as Record<string, number>)[roomType] || 1.3;
  const roomW = Math.sqrt(roomSqft * aspect);
  const roomH = roomSqft / roomW;
  const scale = 60; // px per foot
  const canvasW = Math.round(roomW * scale);
  const canvasH = Math.round(roomH * scale);
  const wallGap = 0.25 * scale; // 3" from wall for flush pieces
  const walkway = 2.5 * scale;  // 2.5ft walkway clearance

  // Parse CAD analysis for windows/doors
  let windows: WindowDef[] = [], doors: DoorDef[] = [];
  if (cadAnalysis) {
    const wMatch = cadAnalysis.match(/(\d+)\s*window/gi);
    const numWindows = wMatch ? parseInt(wMatch[0]) || 2 : 2;
    for (let i = 0; i < numWindows; i++) {
      const wx = (canvasW / (numWindows + 1)) * (i + 1) - 1.5 * scale;
      windows.push({ x: wx, y: 0, w: 3 * scale, side: "top" as const });
    }
    if (/door|entry|entrance/i.test(cadAnalysis)) doors.push({ x: canvasW - 3 * scale, y: canvasH - 3 * scale, w: 3 * scale, side: "right" });
    else doors.push({ x: canvasW * 0.4, y: canvasH, w: 3 * scale, side: "bottom" });
  } else {
    windows.push({ x: canvasW * 0.25, y: 0, w: 4 * scale, side: "top" });
    windows.push({ x: canvasW * 0.6, y: 0, w: 3 * scale, side: "top" });
    doors.push({ x: canvasW - 3 * scale, y: canvasH - 3 * scale, w: 3 * scale, side: "right" });
  }

  // Placement infrastructure
  const placed: PlacedItem[] = [];
  const occupied: { x: number; y: number; w: number; h: number }[] = []; // solid furniture collision boxes
  const catColors: Record<string, string> = { sofa: "#8B6840", bed: "#7B4870", table: "#4B7B50", chair: "#5B4B9B", stool: "#8B6B35", light: "#B8901A", rug: "#3878A0", art: "#985050", accent: "#607060" };

  const collides = (x: number, y: number, w: number, h: number, padding?: number): boolean => {
    const p = padding || 0;
    for (const o of occupied) {
      if (x - p < o.x + o.w && x + w + p > o.x && y - p < o.y + o.h && y + h + p > o.y) return true;
    }
    return false;
  };
  const inBounds = (x: number, y: number, w: number, h: number): boolean => x >= wallGap && y >= wallGap && x + w <= canvasW - wallGap && y + h <= canvasH - wallGap;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

  const placeAt = (item: Product, x: number, y: number, w: number, h: number, rot?: number): void => {
    x = clamp(x, wallGap, canvasW - w - wallGap);
    y = clamp(y, wallGap, canvasH - h - wallGap);
    const dims = getProductDims(item);
    placed.push({ item, x, y, w, h, rotation: rot || 0, color: catColors[item.c] || "#6B685B", shape: dims.shape || "rect" });
    // Rugs, art, and lights don't block other items
    if (!["rug", "art", "light"].includes(item.c)) occupied.push({ x, y, w, h });
  };

  // Fine-grained search: find nearest non-colliding position (1ft grid steps)
  const findNear = (tx: number, ty: number, w: number, h: number, radius?: number, pad?: number): { x: number; y: number } | null => {
    const step = scale * 0.5; // half-foot precision
    const r = Math.min(radius || scale * 5, scale * 10);
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy += step) {
      for (let dx = -r; dx <= r; dx += step) {
        const nx = tx + dx, ny = ty + dy;
        if (!inBounds(nx, ny, w, h)) continue;
        if (!collides(nx, ny, w, h, pad || 0)) {
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
        }
      }
    }
    return best;
  };

  // Sort: rugs → beds → sofas → tables → chairs → stools → accents → lights → art
  const sortOrder: Record<string, number> = { rug: 0, bed: 1, sofa: 2, table: 3, chair: 4, stool: 5, accent: 6, light: 7, art: 8, decor: 9, storage: 5 };
  const sorted = [...items].sort((a, b) => (sortOrder[a.c] ?? 6) - (sortOrder[b.c] ?? 6));

  // Anchor tracking — every subsequent piece positions relative to these
  let sofaRect: AnchorRect | null = null;  // { x, y, w, h, cx, cy }
  let tableRect: AnchorRect | null = null; // { x, y, w, h, cx, cy }
  let bedRect: AnchorRect | null = null;

  // ─── ROOM-TYPE SPECIFIC FOCAL POINTS ───
  // "Focal wall" = top wall (where TV/fireplace/headboard would go)
  // Sofa faces focal wall; table goes between sofa and focal wall
  const isLiving = roomType === "Living Room" || roomType === "Great Room";
  const isDining = roomType === "Dining Room" || roomType === "Kitchen";
  const isBedroom = roomType === "Bedroom";
  const isOffice = roomType === "Office";

  for (const item of sorted) {
    const dims = getProductDims(item);
    let w = dims.w * scale;
    let h = dims.d * scale;
    const cat = item.c;
    const sofaCount = placed.filter(p => p.item.c === "sofa").length;
    const chairCount = placed.filter(p => p.item.c === "chair").length;
    const tableCount = placed.filter(p => p.item.c === "table").length;

    // ═══ RUG: center of the room, under the main seating/dining area ═══
    if (cat === "rug") {
      const cx = canvasW / 2 - w / 2;
      const cy = canvasH * 0.35 - h / 2; // slightly toward focal wall
      placeAt(item, cx, cy, w, h);
      continue;
    }

    // ═══ BED: centered, headboard flush against top (focal) wall ═══
    if (cat === "bed") {
      const bx = (canvasW - w) / 2;
      const by = wallGap; // headboard against top wall
      if (!collides(bx, by, w, h)) {
        placeAt(item, bx, by, w, h);
        bedRect = { x: bx, y: by, w, h, cx: bx + w / 2, cy: by + h / 2 };
      } else {
        const pos = findNear(bx, by, w, h, scale * 4);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); bedRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
      }
      continue;
    }

    // ═══ SOFA: primary faces focal wall from lower third; secondary faces primary ═══
    if (cat === "sofa") {
      if (sofaCount === 0) {
        // Primary sofa: lower third of room, centered, facing top wall (TV/fireplace)
        const sx = (canvasW - w) / 2;
        const sy = canvasH * 0.62 - h / 2; // sit ~60% down the room, facing up
        if (isBedroom && bedRect) {
          // In bedroom, sofa goes at foot of bed
          const footY = bedRect.y + bedRect.h + 2 * scale;
          const footX = bedRect.cx - w / 2;
          const pos = findNear(footX, footY, w, h, scale * 4);
          if (pos) { placeAt(item, pos.x, pos.y, w, h); sofaRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; continue; }
        }
        if (!collides(sx, sy, w, h, scale * 0.3)) {
          placeAt(item, sx, sy, w, h);
          sofaRect = { x: sx, y: sy, w, h, cx: sx + w / 2, cy: sy + h / 2 };
        } else {
          const pos = findNear(sx, sy, w, h, scale * 5, scale * 0.3);
          if (pos) { placeAt(item, pos.x, pos.y, w, h); sofaRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
        }
      } else if (sofaRect) {
        // Secondary sofa: directly across from primary, facing it (conversation layout)
        const sx = sofaRect.cx - w / 2;
        const gap = 5 * scale; // ~5ft conversation distance
        const sy = sofaRect.y - gap - h;
        const pos = findNear(sx, Math.max(wallGap, sy), w, h, scale * 4);
        if (pos) placeAt(item, pos.x, pos.y, w, h);
      }
      continue;
    }

    // ═══ TABLE ═══
    if (cat === "table") {
      if (isDining && tableCount === 0) {
        // Dining table: dead center of room
        const tx = (canvasW - w) / 2;
        const ty = (canvasH - h) / 2;
        if (!collides(tx, ty, w, h, scale * 0.5)) {
          placeAt(item, tx, ty, w, h);
          tableRect = { x: tx, y: ty, w, h, cx: tx + w / 2, cy: ty + h / 2 };
        } else {
          const pos = findNear(tx, ty, w, h, scale * 4, scale * 0.3);
          if (pos) { placeAt(item, pos.x, pos.y, w, h); tableRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
        }
      } else if (sofaRect && tableCount === 0) {
        // Coffee table: 16-18" in front of sofa (between sofa and focal wall)
        const tx = sofaRect.cx - w / 2;
        const ty = sofaRect.y - 1.5 * scale - h; // 1.5ft gap from sofa front
        if (!collides(tx, ty, w, h)) {
          placeAt(item, tx, ty, w, h);
          tableRect = { x: tx, y: ty, w, h, cx: tx + w / 2, cy: ty + h / 2 };
        } else {
          const pos = findNear(tx, ty, w, h, scale * 3);
          if (pos) { placeAt(item, pos.x, pos.y, w, h); tableRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
        }
      } else if (isOffice && tableCount === 0) {
        // Desk: facing a wall, slightly off-center
        const tx = canvasW * 0.3 - w / 2;
        const ty = wallGap + 0.5 * scale; // near top wall
        const pos = findNear(tx, ty, w, h, scale * 3);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); tableRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
      } else {
        // Additional tables: side table near sofa or along wall
        let tx = canvasW * 0.2, ty = canvasH * 0.3;
        if (sofaRect) { tx = sofaRect.x + sofaRect.w + 0.5 * scale; ty = sofaRect.cy - h / 2; }
        const pos = findNear(tx, ty, w, h, scale * 5);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); if (!tableRect) tableRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
      }
      continue;
    }

    // ═══ CHAIR ═══
    if (cat === "chair") {
      if (isDining && tableRect) {
        // Dining chairs: evenly around the table at correct distance
        const tW = tableRect.w, tH = tableRect.h;
        const gap = 0.2 * scale; // tucked close to table edge
        // Positions: top-left, top-right, bottom-left, bottom-right, top-center, bottom-center, left-center, right-center
        const seats = [
          { x: tableRect.x - w - gap, y: tableRect.cy - h / 2 },                   // left
          { x: tableRect.x + tW + gap, y: tableRect.cy - h / 2 },                  // right
          { x: tableRect.cx - w / 2, y: tableRect.y - h - gap },                    // top
          { x: tableRect.cx - w / 2, y: tableRect.y + tH + gap },                   // bottom
          { x: tableRect.x - w - gap, y: tableRect.y + tH * 0.15 - h / 2 },        // left-upper
          { x: tableRect.x + tW + gap, y: tableRect.y + tH * 0.15 - h / 2 },       // right-upper
          { x: tableRect.x - w - gap, y: tableRect.y + tH * 0.85 - h / 2 },        // left-lower
          { x: tableRect.x + tW + gap, y: tableRect.y + tH * 0.85 - h / 2 },       // right-lower
        ];
        const seat = seats[chairCount % seats.length];
        if (seat && inBounds(seat.x, seat.y, w, h) && !collides(seat.x, seat.y, w, h)) {
          placeAt(item, seat.x, seat.y, w, h); continue;
        }
        if (seat) { const pos = findNear(seat.x, seat.y, w, h, scale * 2); if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; } }
      }

      if (sofaRect) {
        // Accent chairs: perpendicular to sofa, forming conversation U-shape
        const positions = [
          // Left of sofa, pulled slightly forward
          { x: sofaRect.x - w - 1.2 * scale, y: sofaRect.cy - h - 0.5 * scale },
          // Right of sofa, pulled slightly forward
          { x: sofaRect.x + sofaRect.w + 1.2 * scale, y: sofaRect.cy - h - 0.5 * scale },
          // Across from sofa (reading chair)
          { x: sofaRect.cx - w / 2 - 3 * scale, y: sofaRect.y - 5 * scale },
          { x: sofaRect.cx - w / 2 + 3 * scale, y: sofaRect.y - 5 * scale },
        ];
        const target = positions[chairCount % positions.length];
        if (target) {
          const pos = findNear(target.x, target.y, w, h, scale * 3);
          if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
        }
      }

      if (isOffice && tableRect) {
        // Office chair behind desk
        const cx = tableRect.cx - w / 2;
        const cy = tableRect.y + tableRect.h + 0.3 * scale;
        const pos = findNear(cx, cy, w, h, scale * 2);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
      }

      if (isBedroom && bedRect) {
        // Bedroom chair: corner reading nook
        const pos = findNear(wallGap + scale, bedRect.y + bedRect.h + 2 * scale, w, h, scale * 4);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
      }
    }

    // ═══ STOOL ═══
    if (cat === "stool") {
      const stoolIdx = placed.filter(p => p.item.c === "stool").length;
      if (isDining && tableRect) {
        // Bar stools along one side of table/island
        const sx = tableRect.x + stoolIdx * (w + 0.4 * scale);
        const sy = tableRect.y - h - 0.2 * scale;
        const pos = findNear(sx, sy, w, h, scale * 2);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
      }
      // Default: along a wall, evenly spaced
      const totalStools = sorted.filter(p => p.c === "stool").length;
      const spacing = Math.min(w + 1 * scale, (canvasW - 4 * scale) / Math.max(totalStools, 1));
      const sx = (canvasW - totalStools * spacing) / 2 + stoolIdx * spacing;
      const pos = findNear(sx, wallGap + scale, w, h, scale * 3);
      if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
    }

    // ═══ ART: on the focal wall (top), spaced evenly above furniture ═══
    if (cat === "art") {
      const artIdx = placed.filter(p => p.item.c === "art").length;
      const totalArt = sorted.filter(p => p.c === "art").length;
      const artSpacing = (canvasW - 2 * scale) / (totalArt + 1);
      const ax = scale + artSpacing * (artIdx + 1) - w / 2;
      placeAt(item, clamp(ax, wallGap, canvasW - w - wallGap), wallGap, w, h);
      continue;
    }

    // ═══ LIGHT ═══
    if (cat === "light") {
      const lightIdx = placed.filter(p => p.item.c === "light").length;
      let lx, ly;
      if (lightIdx === 0 && tableRect) {
        // Pendant/chandelier centered over table
        lx = tableRect.cx - w / 2;
        ly = tableRect.cy - h / 2;
      } else if (lightIdx === 0 && sofaRect) {
        // Floor lamp beside sofa end
        lx = sofaRect.x + sofaRect.w + 0.5 * scale;
        ly = sofaRect.y;
      } else if (lightIdx === 1 && sofaRect) {
        // Second lamp: other end of sofa
        lx = sofaRect.x - w - 0.5 * scale;
        ly = sofaRect.y;
      } else if (isBedroom && bedRect) {
        // Bedside lamp
        lx = lightIdx === 0 ? bedRect.x - w - 0.5 * scale : bedRect.x + bedRect.w + 0.5 * scale;
        ly = bedRect.y + 0.5 * scale;
      } else {
        // Corners
        const corners = [
          { x: wallGap + scale, y: wallGap + scale },
          { x: canvasW - w - wallGap - scale, y: wallGap + scale },
          { x: wallGap + scale, y: canvasH - h - wallGap - scale },
          { x: canvasW - w - wallGap - scale, y: canvasH - h - wallGap - scale },
        ];
        const c = corners[lightIdx % corners.length];
        lx = c.x; ly = c.y;
      }
      placeAt(item, clamp(lx, wallGap, canvasW - w - wallGap), clamp(ly, wallGap, canvasH - h - wallGap), w, h);
      continue;
    }

    // ═══ ACCENT (side tables, mirrors, ottomans, planters) ═══
    if (cat === "accent") {
      const accIdx = placed.filter(p => p.item.c === "accent").length;
      const name = (item.n || "").toLowerCase();
      const isEndTable = /end\s*table|side\s*table|nightstand/i.test(name);
      const isOttoman = /ottoman|pouf|footstool/i.test(name);
      const isMirror = /mirror/i.test(name);

      let ax, ay;
      if (isBedroom && bedRect && isEndTable) {
        // Nightstands flanking bed
        ax = accIdx === 0 ? bedRect.x - w - 0.3 * scale : bedRect.x + bedRect.w + 0.3 * scale;
        ay = bedRect.y + 0.5 * scale;
      } else if (sofaRect && isEndTable) {
        // End tables flanking sofa
        ax = accIdx === 0 ? sofaRect.x - w - 0.3 * scale : sofaRect.x + sofaRect.w + 0.3 * scale;
        ay = sofaRect.cy - h / 2;
      } else if (sofaRect && isOttoman) {
        // Ottoman in front of sofa (between sofa and coffee table)
        ax = sofaRect.cx - w / 2;
        ay = sofaRect.y - 1 * scale - h;
        if (tableRect && Math.abs(ay - tableRect.y) < 2 * scale) ay = tableRect.y + tableRect.h + 0.5 * scale;
      } else if (isMirror) {
        // Mirror on side wall
        ax = wallGap;
        ay = canvasH * 0.3;
      } else if (sofaRect) {
        // Generic accent near sofa
        const sides = [
          { x: sofaRect.x + sofaRect.w + 0.5 * scale, y: sofaRect.cy - h / 2 },
          { x: sofaRect.x - w - 0.5 * scale, y: sofaRect.cy - h / 2 },
          { x: sofaRect.cx - w / 2, y: sofaRect.y + sofaRect.h + 1 * scale },
        ];
        const s = sides[accIdx % sides.length];
        ax = s.x; ay = s.y;
      } else {
        // Along walls
        const wallSpots = [
          { x: wallGap + scale, y: canvasH * 0.4 },
          { x: canvasW - w - wallGap - scale, y: canvasH * 0.4 },
          { x: canvasW * 0.3, y: wallGap + scale },
        ];
        const ws = wallSpots[accIdx % wallSpots.length];
        ax = ws.x; ay = ws.y;
      }
      const pos = findNear(ax, ay, w, h, scale * 4);
      if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
    }

    // ═══ GENERAL FALLBACK: grid scan with 1ft steps ═══
    let didPlace = false;
    const step = scale;
    for (let gy = wallGap + scale; gy < canvasH - h - wallGap && !didPlace; gy += step) {
      for (let gx = wallGap + scale; gx < canvasW - w - wallGap && !didPlace; gx += step) {
        if (!collides(gx, gy, w, h, scale * 0.3)) {
          placeAt(item, gx, gy, w, h);
          didPlace = true;
        }
      }
    }
    if (!didPlace) {
      placeAt(item, wallGap + scale + Math.random() * Math.max(1, canvasW - w - 4 * scale), wallGap + scale + Math.random() * Math.max(1, canvasH - h - 4 * scale), w, h);
    }
  }

  return { placed, canvasW, canvasH, roomW: Math.round(roomW * 10) / 10, roomH: Math.round(roomH * 10) / 10, windows, doors, scale };
}

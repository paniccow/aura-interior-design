import { getProductDims } from "./designEngine";
import type { Product, CADLayout, PlacedItem, WindowDef, DoorDef, ClearanceZone, TrafficPath, DimensionLine } from "../types";

interface AnchorRect { x: number; y: number; w: number; h: number; cx: number; cy: number; }

/* ─── PRO CAD LAYOUT GENERATOR ─── */
export function generateCADLayout(
  items: Product[],
  roomSqft: number,
  roomType: string,
  cadAnalysis?: string | null,
  userRoomW?: number | null,
  userRoomL?: number | null
): CADLayout {
  // Room dimensions — prefer user-input, fall back to aspect ratio calculation
  let roomW: number, roomH: number;
  if (userRoomW && userRoomL && userRoomW > 0 && userRoomL > 0) {
    roomW = userRoomW;
    roomH = userRoomL;
  } else {
    const aspectRatios: Record<string, number> = {
      "Living Room": 1.4, "Bedroom": 1.25, "Dining Room": 1.3,
      "Kitchen": 1.1, "Office": 1.2, "Great Room": 1.5,
      "Outdoor": 1.3, "Bathroom": 1.1
    };
    const aspect = aspectRatios[roomType] || 1.3;
    roomW = Math.sqrt(roomSqft * aspect);
    roomH = roomSqft / roomW;
  }

  const scale = 60; // px per foot
  const canvasW = Math.round(roomW * scale);
  const canvasH = Math.round(roomH * scale);
  const wallGap = 0.25 * scale; // 3" from wall for flush pieces

  // Parse CAD analysis for windows/doors
  let windows: WindowDef[] = [], doors: DoorDef[] = [];
  if (cadAnalysis) {
    const wMatch = cadAnalysis.match(/(\d+)\s*window/gi);
    const numWindows = wMatch ? parseInt(wMatch[0]) || 2 : 2;
    for (let i = 0; i < numWindows; i++) {
      const wx = (canvasW / (numWindows + 1)) * (i + 1) - 1.5 * scale;
      windows.push({ x: wx, y: 0, w: 3 * scale, side: "top" as const });
    }
    if (/door|entry|entrance/i.test(cadAnalysis)) {
      doors.push({ x: canvasW - 3 * scale, y: canvasH - 3 * scale, w: 3 * scale, side: "right", swingDir: "inward" });
    } else {
      doors.push({ x: canvasW * 0.4, y: canvasH, w: 3 * scale, side: "bottom", swingDir: "inward" });
    }
  } else {
    // Default: 2 windows on top wall, 1 door on right wall
    windows.push({ x: canvasW * 0.15, y: 0, w: 4 * scale, side: "top" });
    windows.push({ x: canvasW * 0.6, y: 0, w: 3 * scale, side: "top" });
    doors.push({ x: canvasW - 3 * scale, y: canvasH - 3 * scale, w: 3 * scale, side: "right", swingDir: "inward" });
  }

  // Placement infrastructure
  const placed: PlacedItem[] = [];
  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const catColors: Record<string, string> = {
    sofa: "#8B6840", bed: "#7B4870", table: "#4B7B50", chair: "#5B4B9B",
    stool: "#8B6B35", light: "#B8901A", rug: "#3878A0", art: "#985050",
    accent: "#607060", decor: "#607060", storage: "#5B6B5B"
  };

  const collides = (x: number, y: number, w: number, h: number, padding?: number): boolean => {
    const p = padding || 0;
    for (const o of occupied) {
      if (x - p < o.x + o.w && x + w + p > o.x && y - p < o.y + o.h && y + h + p > o.y) return true;
    }
    return false;
  };
  const inBounds = (x: number, y: number, w: number, h: number): boolean =>
    x >= wallGap && y >= wallGap && x + w <= canvasW - wallGap && y + h <= canvasH - wallGap;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

  const placeAt = (item: Product, x: number, y: number, w: number, h: number, rot?: number): void => {
    x = clamp(x, wallGap, canvasW - w - wallGap);
    y = clamp(y, wallGap, canvasH - h - wallGap);
    const dims = getProductDims(item);
    placed.push({ item, x, y, w, h, rotation: rot || 0, color: catColors[item.c] || "#6B685B", shape: dims.shape || "rect" });
    if (!["rug", "art", "light"].includes(item.c)) occupied.push({ x, y, w, h });
  };

  const findNear = (tx: number, ty: number, w: number, h: number, radius?: number, pad?: number): { x: number; y: number } | null => {
    const step = scale * 0.5;
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

  // Sort: rugs → beds → sofas → tables → chairs → stools → storage → accents → lights → art
  const sortOrder: Record<string, number> = { rug: 0, bed: 1, sofa: 2, table: 3, chair: 4, stool: 5, storage: 5, accent: 6, light: 7, art: 8, decor: 9 };
  const sorted = [...items].sort((a, b) => (sortOrder[a.c] ?? 6) - (sortOrder[b.c] ?? 6));

  // Anchor tracking
  let sofaRect: AnchorRect | null = null;
  let tableRect: AnchorRect | null = null;
  let bedRect: AnchorRect | null = null;

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

    // ═══ RUG ═══
    if (cat === "rug") {
      const cx = canvasW / 2 - w / 2;
      const cy = canvasH * 0.35 - h / 2;
      placeAt(item, cx, cy, w, h);
      continue;
    }

    // ═══ BED ═══
    if (cat === "bed") {
      const bx = (canvasW - w) / 2;
      const by = wallGap;
      if (!collides(bx, by, w, h)) {
        placeAt(item, bx, by, w, h);
        bedRect = { x: bx, y: by, w, h, cx: bx + w / 2, cy: by + h / 2 };
      } else {
        const pos = findNear(bx, by, w, h, scale * 4);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); bedRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
      }
      continue;
    }

    // ═══ SOFA ═══
    if (cat === "sofa") {
      if (sofaCount === 0) {
        const sx = (canvasW - w) / 2;
        const sy = canvasH * 0.62 - h / 2;
        if (isBedroom && bedRect) {
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
        const sx = sofaRect.cx - w / 2;
        const gap = 5 * scale;
        const sy = sofaRect.y - gap - h;
        const pos = findNear(sx, Math.max(wallGap, sy), w, h, scale * 4);
        if (pos) placeAt(item, pos.x, pos.y, w, h);
      }
      continue;
    }

    // ═══ TABLE ═══
    if (cat === "table") {
      if (isDining && tableCount === 0) {
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
        const tx = sofaRect.cx - w / 2;
        const ty = sofaRect.y - 1.5 * scale - h;
        if (!collides(tx, ty, w, h)) {
          placeAt(item, tx, ty, w, h);
          tableRect = { x: tx, y: ty, w, h, cx: tx + w / 2, cy: ty + h / 2 };
        } else {
          const pos = findNear(tx, ty, w, h, scale * 3);
          if (pos) { placeAt(item, pos.x, pos.y, w, h); tableRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
        }
      } else if (isOffice && tableCount === 0) {
        const tx = canvasW * 0.3 - w / 2;
        const ty = wallGap + 0.5 * scale;
        const pos = findNear(tx, ty, w, h, scale * 3);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); tableRect = { x: pos.x, y: pos.y, w, h, cx: pos.x + w / 2, cy: pos.y + h / 2 }; }
      } else {
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
        const tW = tableRect.w, tH = tableRect.h;
        const gap = 0.2 * scale;
        const seats = [
          { x: tableRect.x - w - gap, y: tableRect.cy - h / 2 },
          { x: tableRect.x + tW + gap, y: tableRect.cy - h / 2 },
          { x: tableRect.cx - w / 2, y: tableRect.y - h - gap },
          { x: tableRect.cx - w / 2, y: tableRect.y + tH + gap },
          { x: tableRect.x - w - gap, y: tableRect.y + tH * 0.15 - h / 2 },
          { x: tableRect.x + tW + gap, y: tableRect.y + tH * 0.15 - h / 2 },
          { x: tableRect.x - w - gap, y: tableRect.y + tH * 0.85 - h / 2 },
          { x: tableRect.x + tW + gap, y: tableRect.y + tH * 0.85 - h / 2 },
        ];
        const seat = seats[chairCount % seats.length];
        if (seat && inBounds(seat.x, seat.y, w, h) && !collides(seat.x, seat.y, w, h)) {
          placeAt(item, seat.x, seat.y, w, h); continue;
        }
        if (seat) { const pos = findNear(seat.x, seat.y, w, h, scale * 2); if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; } }
      }

      if (sofaRect) {
        const positions = [
          { x: sofaRect.x - w - 1.2 * scale, y: sofaRect.cy - h - 0.5 * scale },
          { x: sofaRect.x + sofaRect.w + 1.2 * scale, y: sofaRect.cy - h - 0.5 * scale },
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
        const cx = tableRect.cx - w / 2;
        const cy = tableRect.y + tableRect.h + 0.3 * scale;
        const pos = findNear(cx, cy, w, h, scale * 2);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
      }

      if (isBedroom && bedRect) {
        const pos = findNear(wallGap + scale, bedRect.y + bedRect.h + 2 * scale, w, h, scale * 4);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
      }
    }

    // ═══ STOOL ═══
    if (cat === "stool") {
      const stoolIdx = placed.filter(p => p.item.c === "stool").length;
      if (isDining && tableRect) {
        const sx = tableRect.x + stoolIdx * (w + 0.4 * scale);
        const sy = tableRect.y - h - 0.2 * scale;
        const pos = findNear(sx, sy, w, h, scale * 2);
        if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
      }
      const totalStools = sorted.filter(p => p.c === "stool").length;
      const spacing = Math.min(w + 1 * scale, (canvasW - 4 * scale) / Math.max(totalStools, 1));
      const sx = (canvasW - totalStools * spacing) / 2 + stoolIdx * spacing;
      const pos = findNear(sx, wallGap + scale, w, h, scale * 3);
      if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
    }

    // ═══ ART ═══
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
      let lx: number, ly: number;
      if (lightIdx === 0 && tableRect) {
        lx = tableRect.cx - w / 2; ly = tableRect.cy - h / 2;
      } else if (lightIdx === 0 && sofaRect) {
        lx = sofaRect.x + sofaRect.w + 0.5 * scale; ly = sofaRect.y;
      } else if (lightIdx === 1 && sofaRect) {
        lx = sofaRect.x - w - 0.5 * scale; ly = sofaRect.y;
      } else if (isBedroom && bedRect) {
        lx = lightIdx === 0 ? bedRect.x - w - 0.5 * scale : bedRect.x + bedRect.w + 0.5 * scale;
        ly = bedRect.y + 0.5 * scale;
      } else {
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

    // ═══ ACCENT ═══
    if (cat === "accent" || cat === "decor" || cat === "storage") {
      const accIdx = placed.filter(p => ["accent", "decor", "storage"].includes(p.item.c)).length;
      const name = (item.n || "").toLowerCase();
      const isEndTable = /end\s*table|side\s*table|nightstand/i.test(name);
      const isOttoman = /ottoman|pouf|footstool/i.test(name);
      const isMirror = /mirror/i.test(name);

      let ax: number, ay: number;
      if (isBedroom && bedRect && isEndTable) {
        ax = accIdx === 0 ? bedRect.x - w - 0.3 * scale : bedRect.x + bedRect.w + 0.3 * scale;
        ay = bedRect.y + 0.5 * scale;
      } else if (sofaRect && isEndTable) {
        ax = accIdx === 0 ? sofaRect.x - w - 0.3 * scale : sofaRect.x + sofaRect.w + 0.3 * scale;
        ay = sofaRect.cy - h / 2;
      } else if (sofaRect && isOttoman) {
        ax = sofaRect.cx - w / 2;
        ay = sofaRect.y - 1 * scale - h;
        if (tableRect && Math.abs(ay - tableRect.y) < 2 * scale) ay = tableRect.y + tableRect.h + 0.5 * scale;
      } else if (isMirror) {
        ax = wallGap; ay = canvasH * 0.3;
      } else if (sofaRect) {
        const sides = [
          { x: sofaRect.x + sofaRect.w + 0.5 * scale, y: sofaRect.cy - h / 2 },
          { x: sofaRect.x - w - 0.5 * scale, y: sofaRect.cy - h / 2 },
          { x: sofaRect.cx - w / 2, y: sofaRect.y + sofaRect.h + 1 * scale },
        ];
        const s = sides[accIdx % sides.length];
        ax = s.x; ay = s.y;
      } else {
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

    // ═══ GENERAL FALLBACK ═══
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

  // ─── COMPUTE CLEARANCE ZONES ───
  // Show the clearance space in front of and beside each major furniture piece
  const clearances: ClearanceZone[] = [];
  for (const p of placed) {
    if (["rug", "art", "light", "decor"].includes(p.item.c)) continue;
    const dims = getProductDims(p.item);
    const clearF = dims.clearF * scale; // front clearance in px
    const clearS = dims.clearS * scale; // side clearance in px

    if (clearF > 0) {
      // Front clearance (below the item, facing into the room)
      clearances.push({
        x: p.x, y: p.y + p.h,
        w: p.w, h: clearF,
        label: Math.round(dims.clearF * 10) / 10 + "′",
        distFt: dims.clearF
      });
    }
    if (clearS > 0 && p.w > scale * 2) {
      // Side clearances (left and right)
      clearances.push({
        x: p.x - clearS, y: p.y,
        w: clearS, h: p.h,
        label: Math.round(dims.clearS * 10) / 10 + "′",
        distFt: dims.clearS
      });
      clearances.push({
        x: p.x + p.w, y: p.y,
        w: clearS, h: p.h,
        label: Math.round(dims.clearS * 10) / 10 + "′",
        distFt: dims.clearS
      });
    }
  }

  // ─── COMPUTE TRAFFIC FLOW PATHS ───
  // Primary path: door → center of room → main seating area
  // Secondary paths: between key furniture groupings
  const trafficPaths: TrafficPath[] = [];

  // Find door center point
  const mainDoor = doors[0];
  let doorPt = { x: canvasW * 0.7, y: canvasH - scale };
  if (mainDoor) {
    if (mainDoor.side === "right") doorPt = { x: canvasW, y: mainDoor.y + mainDoor.w / 2 };
    else if (mainDoor.side === "bottom") doorPt = { x: mainDoor.x + mainDoor.w / 2, y: canvasH };
    else if (mainDoor.side === "left") doorPt = { x: 0, y: mainDoor.y + mainDoor.w / 2 };
    else doorPt = { x: mainDoor.x + mainDoor.w / 2, y: 0 };
  }

  // Room center
  const roomCenter = { x: canvasW / 2, y: canvasH / 2 };

  // Primary traffic path: Door → Room center → main anchor
  const primaryPoints: { x: number; y: number }[] = [doorPt];

  // Intermediate waypoint (avoid cutting through furniture)
  if (mainDoor && mainDoor.side === "right") {
    primaryPoints.push({ x: canvasW - 2.5 * scale, y: doorPt.y });
    primaryPoints.push({ x: canvasW - 2.5 * scale, y: roomCenter.y });
  } else if (mainDoor && mainDoor.side === "bottom") {
    primaryPoints.push({ x: doorPt.x, y: canvasH - 2.5 * scale });
    primaryPoints.push({ x: roomCenter.x, y: canvasH - 2.5 * scale });
  }
  primaryPoints.push(roomCenter);

  // Extend to main anchor (sofa, bed, or table)
  if (sofaRect) {
    primaryPoints.push({ x: sofaRect.cx, y: sofaRect.y + sofaRect.h + 1.5 * scale });
  } else if (bedRect) {
    primaryPoints.push({ x: bedRect.cx, y: bedRect.y + bedRect.h + 2 * scale });
  } else if (tableRect) {
    primaryPoints.push({ x: tableRect.cx, y: tableRect.y + tableRect.h + 1.5 * scale });
  }

  if (primaryPoints.length >= 3) {
    trafficPaths.push({ points: primaryPoints, label: "Main Path" });
  }

  // Perimeter walkway path (along walls, 2.5ft from walls)
  const walkOffset = 2.5 * scale;
  trafficPaths.push({
    points: [
      { x: walkOffset, y: walkOffset },
      { x: canvasW - walkOffset, y: walkOffset },
      { x: canvasW - walkOffset, y: canvasH - walkOffset },
      { x: walkOffset, y: canvasH - walkOffset },
      { x: walkOffset, y: walkOffset },
    ],
    label: "2.5′ Walkway"
  });

  // ─── COMPUTE DIMENSION LINES ───
  // Key distances between major furniture pieces
  const dimensions: DimensionLine[] = [];

  // Sofa-to-coffee-table distance
  if (sofaRect && tableRect) {
    const gap = sofaRect.y - (tableRect.y + tableRect.h);
    if (gap > 0) {
      dimensions.push({
        x1: sofaRect.cx, y1: tableRect.y + tableRect.h,
        x2: sofaRect.cx, y2: sofaRect.y,
        label: (Math.round(gap / scale * 10) / 10) + "′"
      });
    }
  }

  // Bed-to-wall side clearances
  if (bedRect) {
    // Left side of bed to wall
    if (bedRect.x > wallGap + scale) {
      dimensions.push({
        x1: 0, y1: bedRect.cy,
        x2: bedRect.x, y2: bedRect.cy,
        label: (Math.round(bedRect.x / scale * 10) / 10) + "′"
      });
    }
    // Right side of bed to wall
    const rightGap = canvasW - (bedRect.x + bedRect.w);
    if (rightGap > scale) {
      dimensions.push({
        x1: bedRect.x + bedRect.w, y1: bedRect.cy,
        x2: canvasW, y2: bedRect.cy,
        label: (Math.round(rightGap / scale * 10) / 10) + "′"
      });
    }
  }

  // Sofa-to-wall distance
  if (sofaRect) {
    const bottomGap = canvasH - (sofaRect.y + sofaRect.h);
    if (bottomGap > scale) {
      dimensions.push({
        x1: sofaRect.cx, y1: sofaRect.y + sofaRect.h,
        x2: sofaRect.cx, y2: canvasH,
        label: (Math.round(bottomGap / scale * 10) / 10) + "′"
      });
    }
  }

  // Dining table to nearest wall
  if (tableRect && isDining) {
    // Table to left wall
    dimensions.push({
      x1: 0, y1: tableRect.cy,
      x2: tableRect.x, y2: tableRect.cy,
      label: (Math.round(tableRect.x / scale * 10) / 10) + "′"
    });
    // Table to right wall
    const rightGap = canvasW - (tableRect.x + tableRect.w);
    dimensions.push({
      x1: tableRect.x + tableRect.w, y1: tableRect.cy,
      x2: canvasW, y2: tableRect.cy,
      label: (Math.round(rightGap / scale * 10) / 10) + "′"
    });
  }

  return {
    placed, canvasW, canvasH,
    roomW: Math.round(roomW * 10) / 10,
    roomH: Math.round(roomH * 10) / 10,
    windows, doors, scale,
    clearances, trafficPaths, dimensions
  };
}

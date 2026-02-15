import { DB } from "../data";
import { FURN_DIMS, STYLE_PALETTES, ROOM_NEEDS } from "../constants";
import type { Product, ProductDims, FurnitureCategory, RoomType, StyleName, BudgetKey, DesignBoard, MoodBoard, ScoredProduct, Shape, StylePalette, RoomNeed } from "../types";

/* ─── SMART PER-PRODUCT DIMENSION ESTIMATION ─── */
export function getProductDims(product: Product): ProductDims {
  const name = (product.n || "").toLowerCase();
  const cat = product.c;
  const baseDims = FURN_DIMS[cat as FurnitureCategory] || FURN_DIMS.accent;
  const price = product.p || 0;

  // Try to extract explicit dimensions from product name (e.g. "84\"" or "60 x 36")
  const rectMatch = name.match(/(\d{2,3})\s*(?:"|in|inch)?\s*(?:x|by)\s*(\d{2,3})/);
  if (rectMatch) {
    return { ...baseDims, w: parseFloat(rectMatch[1]) / 12, d: parseFloat(rectMatch[2]) / 12, shape: "rect" };
  }
  const widthMatch = name.match(/(\d{2,3})(?:\.\d+)?\s*(?:"|in|inch)/);
  if (widthMatch) {
    const wFt = parseFloat(widthMatch[1]) / 12;
    return { ...baseDims, w: wFt, d: baseDims.d * (wFt / baseDims.w), shape: "rect" };
  }

  // ─── SOFA / SECTIONAL ───
  if (cat === "sofa") {
    let w = 7, d = 3, label = "Sofa", shape: Shape = "rect";
    if (/sectional/i.test(name)) { w = 10; d = 7; label = "Sectional"; shape = "L"; }
    else if (/modular/i.test(name)) { w = 9; d = 3.5; label = "Modular Sofa"; }
    else if (/loveseat|love\s*seat/i.test(name)) { w = 5; d = 2.8; label = "Loveseat"; }
    else if (/settee/i.test(name)) { w = 4.5; d = 2.5; label = "Settee"; }
    else if (/daybed/i.test(name)) { w = 6.5; d = 3; label = "Daybed"; }
    else if (/chaise/i.test(name)) { w = 5.5; d = 2.5; label = "Chaise"; }
    else if (/sleeper/i.test(name)) { w = 7.5; d = 3.2; label = "Sleeper Sofa"; }
    if (/compact|small|mini|apartment/i.test(name)) { w *= 0.8; d *= 0.85; }
    if (/oversized|grand|xl|large/i.test(name)) { w *= 1.15; d *= 1.1; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── BED ───
  if (cat === "bed" || /\bbed\b/i.test(name)) {
    if (/cal(ifornia)?\s*king/i.test(name)) return { ...baseDims, w: 6, d: 7.4, label: "Cal King Bed", shape: "bed" };
    if (/king/i.test(name)) return { ...baseDims, w: 6.5, d: 7.4, label: "King Bed", shape: "bed" };
    if (/queen/i.test(name)) return { ...baseDims, w: 5, d: 7.4, label: "Queen Bed", shape: "bed" };
    if (/full|double/i.test(name)) return { ...baseDims, w: 4.5, d: 7, label: "Full Bed", shape: "bed" };
    if (/twin xl/i.test(name)) return { ...baseDims, w: 3.25, d: 6.75, label: "Twin XL", shape: "bed" };
    if (/twin/i.test(name)) return { ...baseDims, w: 3.25, d: 6.5, label: "Twin Bed", shape: "bed" };
    if (/daybed/i.test(name)) return { ...baseDims, w: 6.5, d: 3.25, label: "Daybed", shape: "rect" };
    if (/bunk/i.test(name)) return { ...baseDims, w: 3.5, d: 6.5, label: "Bunk Bed", shape: "bed" };
    if (/crib/i.test(name)) return { ...baseDims, w: 2.5, d: 4.5, label: "Crib", shape: "rect" };
    return { ...baseDims, w: 5.5, d: 7.4, label: "Bed", shape: "bed" };
  }

  // ─── TABLE ───
  if (cat === "table") {
    let w = 4.5, d = 2.5, label = "Table", shape: Shape = "rect";
    if (/dining/i.test(name)) {
      if (/round/i.test(name)) { w = 4; d = 4; label = "Round Dining"; shape = "round"; }
      else if (/oval/i.test(name)) { w = 6; d = 3.5; label = "Oval Dining"; shape = "oval"; }
      else if (/extendable|extension|extending/i.test(name)) { w = 7; d = 3.5; label = "Ext. Dining"; }
      else { w = 6; d = 3.2; label = "Dining Table"; }
    } else if (/coffee/i.test(name)) {
      if (/round/i.test(name)) { w = 3; d = 3; label = "Round Coffee"; shape = "round"; }
      else if (/oval/i.test(name)) { w = 4; d = 2; label = "Oval Coffee"; shape = "oval"; }
      else { w = 4; d = 2; label = "Coffee Table"; }
    } else if (/console/i.test(name)) { w = 4.5; d = 1.2; label = "Console"; }
    else if (/nightstand|night\s*stand|bedside/i.test(name)) { w = 1.8; d = 1.5; label = "Nightstand"; }
    else if (/side\s*table|end\s*table|accent\s*table/i.test(name)) { w = 1.8; d = 1.8; label = "Side Table"; shape = /round/i.test(name) ? "round" : "rect"; }
    else if (/desk/i.test(name)) { w = 4.5; d = 2; label = "Desk"; }
    else if (/vanity/i.test(name)) { w = 3.5; d = 1.5; label = "Vanity"; }
    else if (/dresser/i.test(name)) { w = 5; d = 1.5; label = "Dresser"; }
    else if (/bookshelf|bookcase|shelf|shelving/i.test(name)) { w = 3; d = 1; label = "Bookshelf"; }
    else if (/round/i.test(name)) { w = 3.5; d = 3.5; shape = "round"; }
    else if (/oval/i.test(name)) { w = 5; d = 3; shape = "oval"; }
    if (/small|mini|compact|petite/i.test(name)) { w *= 0.8; d *= 0.85; }
    if (/large|grand|oversized/i.test(name)) { w *= 1.2; d *= 1.15; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── CHAIR ───
  if (cat === "chair") {
    let w = 2.2, d = 2.2, label = "Chair", shape: Shape = "rect";
    if (/dining/i.test(name)) { w = 1.6; d = 1.8; label = "Dining Chair"; }
    else if (/accent|arm\s*chair|lounge/i.test(name)) { w = 2.5; d = 2.8; label = "Accent Chair"; }
    else if (/recliner/i.test(name)) { w = 3; d = 3; label = "Recliner"; }
    else if (/rocking|rocker/i.test(name)) { w = 2.2; d = 3; label = "Rocker"; }
    else if (/desk\s*chair|office/i.test(name)) { w = 2; d = 2; label = "Desk Chair"; }
    else if (/swivel/i.test(name)) { w = 2.5; d = 2.5; label = "Swivel Chair"; shape = "round"; }
    else if (/barrel/i.test(name)) { w = 2.5; d = 2.5; label = "Barrel Chair"; shape = "round"; }
    else if (/wingback|wing/i.test(name)) { w = 2.5; d = 2.8; label = "Wingback"; }
    else if (/club/i.test(name)) { w = 2.5; d = 2.8; label = "Club Chair"; }
    else if (/bench/i.test(name)) { w = 4; d = 1.5; label = "Bench"; }
    else if (/ottoman|pouf/i.test(name)) { w = 2; d = 2; label = "Ottoman"; shape = "round"; }
    if (/round|circular/i.test(name) && shape !== "round") { shape = "round"; w = d = Math.max(w, d); }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── STOOL ───
  if (cat === "stool") {
    let w = 1.4, d = 1.4, label = "Stool", shape: Shape = "round";
    if (/counter/i.test(name)) { label = "Counter Stool"; }
    else if (/bar/i.test(name)) { label = "Bar Stool"; }
    else if (/backless/i.test(name)) { w = 1.2; d = 1.2; label = "Backless Stool"; }
    if (/square|rectangular/i.test(name)) { shape = "rect"; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── LIGHT ───
  if (cat === "light") {
    let w = 1.2, d = 1.2, label = "Light", shape: Shape = "round";
    if (/chandelier/i.test(name)) { w = 2.5; d = 2.5; label = "Chandelier"; }
    else if (/pendant/i.test(name)) { w = 1.5; d = 1.5; label = "Pendant"; }
    else if (/floor\s*lamp/i.test(name)) { w = 1.2; d = 1.2; label = "Floor Lamp"; }
    else if (/table\s*lamp/i.test(name)) { w = 1; d = 1; label = "Table Lamp"; }
    else if (/sconce|wall\s*light/i.test(name)) { w = 0.6; d = 0.5; label = "Sconce"; shape = "rect"; }
    else if (/lamp/i.test(name)) { w = 1; d = 1; label = "Lamp"; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── RUG ───
  if (cat === "rug") {
    let w = 8, d = 5, label = "Rug", shape: Shape = "rect";
    // Rug sizes from name
    const rugSize = name.match(/(\d+)\s*(?:'|ft|foot)?\s*(?:x|by)\s*(\d+)/);
    if (rugSize) { w = parseInt(rugSize[1]); d = parseInt(rugSize[2]); }
    else if (/9\s*x\s*12|9x12/i.test(name)) { w = 9; d = 12; }
    else if (/8\s*x\s*10|8x10/i.test(name)) { w = 8; d = 10; }
    else if (/6\s*x\s*9|6x9/i.test(name)) { w = 6; d = 9; }
    else if (/5\s*x\s*7|5x7/i.test(name)) { w = 5; d = 7; }
    else if (/runner/i.test(name)) { w = 2.5; d = 8; label = "Runner"; }
    if (/round|circular/i.test(name)) { shape = "round"; d = w; }
    if (w < d) { const tmp = w; w = d; d = tmp; } // wider than deep
    return { ...baseDims, w, d, label, shape };
  }

  // ─── ART ───
  if (cat === "art") {
    let w = 2.5, d = 0.3, label = "Art", shape: Shape = "rect";
    if (/mirror/i.test(name)) { w = 2.5; d = 0.3; label = "Mirror"; if (/round/i.test(name)) shape = "round"; }
    else if (/large|oversized/i.test(name)) { w = 4; }
    else if (/small|mini/i.test(name)) { w = 1.5; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── ACCENT ───
  if (cat === "accent") {
    let w = 1.8, d = 1.8, label = "Accent", shape: Shape = "rect";
    if (/mirror/i.test(name)) { w = 2.5; d = 0.3; label = "Mirror"; if (/round/i.test(name)) shape = "round"; }
    else if (/planter|pot|vase/i.test(name)) { w = 1; d = 1; label = "Decor"; shape = "round"; }
    else if (/basket|hamper/i.test(name)) { w = 1.5; d = 1.5; label = "Basket"; shape = "round"; }
    else if (/pillow|throw|cushion/i.test(name)) { w = 1.5; d = 1.5; label = "Throw"; }
    else if (/blanket/i.test(name)) { w = 1.5; d = 0.5; label = "Blanket"; }
    else if (/tray/i.test(name)) { w = 1.2; d = 0.8; label = "Tray"; }
    else if (/candl/i.test(name)) { w = 0.5; d = 0.5; label = "Candle"; shape = "round"; }
    else if (/clock/i.test(name)) { w = 1; d = 0.3; label = "Clock"; shape = "round"; }
    else if (/shelf|bookend/i.test(name)) { w = 3; d = 0.8; label = "Shelf"; }
    else if (/cabinet|credenza|sideboard|buffet/i.test(name)) { w = 5; d = 1.5; label = "Credenza"; }
    else if (/ottoman|pouf/i.test(name)) { w = 2; d = 2; label = "Ottoman"; shape = "round"; }
    return { ...baseDims, w, d, label, shape };
  }

  // Fallback
  return { ...baseDims, shape: "rect" as Shape };
}

/* ─── SPATIAL DESIGN ENGINE ─── */
export function buildDesignBoard(roomType: string, style: string, budgetKey: string, sqft: number | null, existingIds: number[], cadData?: string | null): DesignBoard {
  const palette = (STYLE_PALETTES as Record<string, StylePalette>)[style] || STYLE_PALETTES["Warm Modern"];
  const needs = (ROOM_NEEDS as Record<string, RoomNeed>)[roomType] || ROOM_NEEDS["Living Room"];
  const existing = new Set(existingIds || []);
  const roomSqft = sqft || needs.minSqft || 200;

  let minP = 0, maxP = Infinity;
  if (budgetKey === "u500") maxP = 500;
  if (budgetKey === "u1k") maxP = 1000;
  if (budgetKey === "1k5k") { minP = 500; maxP = 5000; }
  if (budgetKey === "5k10k") { minP = 2000; maxP = 10000; }
  if (budgetKey === "10k25k") { minP = 5000; maxP = 25000; }
  if (budgetKey === "25k") minP = 10000;

  // Spatial capacity — how many items the room can actually fit
  const usableSqft = roomSqft * 0.65; // 35% walkways + clearance
  const sizeMult = Math.max(0.6, Math.min(2.5, roomSqft / 250));

  // Score every product
  const scored = DB.map((p) => {
    if (existing.has(p.id)) return null;
    let score = 0;
    if (p.v && p.v.includes(style)) score += 30;
    const pName = (p.n || "").toLowerCase();
    const pDesc = (p.pr || "").toLowerCase();
    palette.colors.forEach((c: string) => { if (pName.includes(c) || pDesc.includes(c)) score += 6; });
    palette.materials.forEach((m: string) => { if (pName.includes(m) || pDesc.includes(m)) score += 8; });
    if (p.rm && p.rm.includes(roomType)) score += 20;
    if (p.p >= minP && p.p <= maxP) score += 15;
    else if (p.p < minP * 0.5 || p.p > maxP * 2) score -= 20;
    else score -= 5;
    if (needs.essential.includes(p.c)) score += 25;
    else if (needs.recommended.includes(p.c)) score += 12;
    if (p.kaa) score += 5;
    score += Math.random() * 4;
    return { ...p, _score: score };
  }).filter((p): p is ScoredProduct => p !== null).sort((a, b) => b._score - a._score);

  // Build spatially-aware board
  const board: ScoredProduct[] = [];
  const usedIds = new Set<number>();
  const catCounts: Record<string, number> = {};
  let totalFootprint = 0;

  const catTargets: Record<string, number> = {};
  for (const cat of needs.essential) catTargets[cat] = Math.max(1, Math.round(2 * sizeMult));
  for (const cat of needs.recommended) {
    if (!catTargets[cat]) catTargets[cat] = Math.max(1, Math.round(1.5 * sizeMult));
  }
  // Dining chairs scale with table
  if (roomType === "Dining Room") catTargets["chair"] = Math.max(4, Math.round(3 * sizeMult));

  const addItem = (p: ScoredProduct) => {
    const dims = getProductDims(p);
    const footprint = dims.w * dims.d + (dims.clearF * dims.w) + (dims.clearS * dims.d);
    // Skip rugs/art/light from footprint calc (they overlap or are wall/ceiling mounted)
    const actualFootprint = ["rug","art","light"].includes(p.c) ? 0 : footprint;
    if (totalFootprint + actualFootprint > usableSqft && board.length >= 6) return false;
    board.push({ ...p, _dims: dims, _footprint: actualFootprint });
    usedIds.add(p.id);
    catCounts[p.c] = (catCounts[p.c] || 0) + 1;
    totalFootprint += actualFootprint;
    return true;
  };

  // Fill essential categories
  for (const cat of needs.essential) {
    const candidates = scored.filter(p => p.c === cat && !usedIds.has(p.id));
    const target = catTargets[cat] || 2;
    for (let i = 0; i < Math.min(candidates.length, target); i++) addItem(candidates[i]);
  }

  // Fill recommended
  for (const cat of needs.recommended) {
    const candidates = scored.filter(p => p.c === cat && !usedIds.has(p.id));
    const target = catTargets[cat] || 1;
    for (let i = 0; i < Math.min(candidates.length, target); i++) addItem(candidates[i]);
  }

  // Fill remaining space
  const remaining = scored.filter(p => !usedIds.has(p.id));
  let idx = 0;
  const maxItems = Math.min(20, Math.round(14 * sizeMult));
  while (board.length < maxItems && idx < remaining.length) {
    addItem(remaining[idx]);
    idx++;
  }

  return {
    items: board, palette, needs, catCounts,
    totalBudget: board.reduce((s, p) => s + p.p, 0),
    spatialInfo: { usableSqft: Math.round(usableSqft), totalFootprint: Math.round(totalFootprint), fillPct: Math.round((totalFootprint / usableSqft) * 100), roomSqft },
  };
}

export function generateMoodBoards(roomType: string, style: string, budgetKey: string, sqft: number | null, cadData?: string | null): MoodBoard[] {
  const board1 = buildDesignBoard(roomType, style, budgetKey, sqft, [], cadData);
  const board2 = buildDesignBoard(roomType, style, budgetKey, sqft, board1.items.map(p => p.id), cadData);
  const board3 = buildDesignBoard(roomType, style, budgetKey, sqft, [...board1.items, ...board2.items].map(p => p.id), cadData);
  return [
    { name: "Curated Collection", desc: "Top-scored products for your space — balanced style, quality, and spatial fit.", ...board1 },
    { name: "Elevated Alternative", desc: "A fresh perspective with different pieces — same vision, new possibilities.", ...board2 },
    { name: "Discovery Board", desc: "Unexpected finds and hidden gems that could transform your space.", ...board3 },
  ];
}

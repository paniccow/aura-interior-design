import { DB } from "../data";
import { FURN_DIMS, STYLE_PALETTES, ROOM_NEEDS, STYLE_COMPAT, COLOR_TEMPS, RETAILER_TIERS, CATEGORY_INVESTMENT, ROOM_CAT_TIERS } from "../constants";
import type { Product, ProductDims, FurnitureCategory, DesignBoard, MoodBoard, ScoredProduct, Shape, StylePalette, RoomNeed } from "../types";

/* ─── SMART PER-PRODUCT DIMENSION ESTIMATION ─── */
export function getProductDims(product: Product): ProductDims {
  const name = (product.n || "").toLowerCase();
  const cat = product.c;
  const baseDims = FURN_DIMS[cat as FurnitureCategory] || FURN_DIMS.accent;

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
    const rugSize = name.match(/(\d+)\s*(?:'|ft|foot)?\s*(?:x|by)\s*(\d+)/);
    if (rugSize) { w = parseInt(rugSize[1]); d = parseInt(rugSize[2]); }
    else if (/9\s*x\s*12|9x12/i.test(name)) { w = 9; d = 12; }
    else if (/8\s*x\s*10|8x10/i.test(name)) { w = 8; d = 10; }
    else if (/6\s*x\s*9|6x9/i.test(name)) { w = 6; d = 9; }
    else if (/5\s*x\s*7|5x7/i.test(name)) { w = 5; d = 7; }
    else if (/runner/i.test(name)) { w = 2.5; d = 8; label = "Runner"; }
    if (/round|circular/i.test(name)) { shape = "round"; d = w; }
    if (w < d) { const tmp = w; w = d; d = tmp; }
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

  return { ...baseDims, shape: "rect" as Shape };
}

/* ─── DESIGN INTELLIGENCE HELPERS ─── */

// Detect color temperature of a product from its name/description
function getProductTemp(p: Product): "warm" | "cool" | "neutral" {
  const text = ((p.n || "") + " " + (p.pr || "")).toLowerCase();
  let warm = 0, cool = 0;
  for (const [color, temp] of Object.entries(COLOR_TEMPS)) {
    if (text.includes(color)) {
      if (temp === "warm") warm++;
      else if (temp === "cool") cool++;
    }
  }
  if (warm > cool) return "warm";
  if (cool > warm) return "cool";
  return "neutral";
}

// Check material family overlap between a product and the palette
function materialMatch(p: Product, palette: StylePalette): number {
  const text = ((p.n || "") + " " + (p.pr || "")).toLowerCase();
  let matches = 0;
  for (const mat of palette.materials) {
    if (text.includes(mat)) matches++;
  }
  return matches;
}

// Check color family overlap
function colorMatch(p: Product, palette: StylePalette): number {
  const text = ((p.n || "") + " " + (p.pr || "")).toLowerCase();
  let matches = 0;
  for (const c of palette.colors) {
    if (text.includes(c)) matches++;
  }
  return matches;
}

// Get retailer tier (1-4, 0 = unknown)
function getRetailerTier(retailer: string): number {
  if (!retailer) return 0;
  // Check exact match first, then partial
  if (RETAILER_TIERS[retailer]) return RETAILER_TIERS[retailer];
  const lower = retailer.toLowerCase();
  for (const [name, tier] of Object.entries(RETAILER_TIERS)) {
    if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) return tier;
  }
  return 2; // Default to mid-tier for unknown
}

/* ─── COHESION-BASED DESIGN ENGINE ─── */
export function buildDesignBoard(roomType: string, style: string, budgetKey: string, sqft: number | null, existingIds: number[], cadData?: string | null): DesignBoard {
  const palette = (STYLE_PALETTES as Record<string, StylePalette>)[style] || STYLE_PALETTES["Warm Modern"];
  const needs = (ROOM_NEEDS as Record<string, RoomNeed>)[roomType] || ROOM_NEEDS["Living Room"];
  const catTiers = (ROOM_CAT_TIERS as Record<string, Record<string, number>>)[roomType] || ROOM_CAT_TIERS["Living Room"];
  const existing = new Set(existingIds || []);
  const roomSqft = sqft || needs.minSqft || 200;

  let minP = 0, maxP = Infinity;
  if (budgetKey === "u500") maxP = 500;
  if (budgetKey === "u1k") maxP = 1000;
  if (budgetKey === "1k5k") { minP = 500; maxP = 5000; }
  if (budgetKey === "5k10k") { minP = 2000; maxP = 10000; }
  if (budgetKey === "10k25k") { minP = 5000; maxP = 25000; }
  if (budgetKey === "25k") minP = 10000;

  // Spatial capacity
  const usableSqft = roomSqft * 0.65;
  const sizeMult = Math.max(0.6, Math.min(2.5, roomSqft / 250));

  // ─── PHASE 1: Score every product with design intelligence ───
  const styleCompat = (STYLE_COMPAT as Record<string, Record<string, number>>)[style] || {};

  const scored = DB.map((p) => {
    if (existing.has(p.id)) return null;
    let score = 0;

    // ── Style coherence (80/20 rule): primary style match is king ──
    if (p.v && p.v.length > 0) {
      // Primary style match = huge bonus
      if (p.v.includes(style)) score += 35;
      // Secondary style compatibility (check if product's OTHER styles are compatible)
      else {
        let bestCompat = 0;
        for (const pStyle of p.v) {
          const compat = styleCompat[pStyle] || 0;
          if (compat > bestCompat) bestCompat = compat;
        }
        // Compatible style gets partial credit (0.0-1.0 → 0-25 points)
        score += Math.round(bestCompat * 25);
        // Clashing styles get penalized
        if (bestCompat < 0.4) score -= 15;
      }
    }

    // ── Color palette harmony ──
    const colors = colorMatch(p, palette);
    score += colors * 8; // Each color match = 8pts (was 6)
    // Bonus for multiple color hits (product is deeply in-palette)
    if (colors >= 2) score += 10;

    // ── Material harmony ──
    const matHits = materialMatch(p, palette);
    score += matHits * 10; // Each material match = 10pts (was 8)
    if (matHits >= 2) score += 8;

    // ── Room type fit ──
    if (p.rm && p.rm.includes(roomType)) score += 22;

    // ── Category tier priority (Tier 1 > Tier 2 > Tier 3) ──
    const tier = catTiers[p.c as string] || 3;
    if (tier === 1) score += 30;
    else if (tier === 2) score += 15;
    else score += 5;

    // ── Budget fit with investment logic ──
    const investLevel = CATEGORY_INVESTMENT[p.c] || "flexible";
    if (p.p >= minP && p.p <= maxP) {
      score += 15;
    } else if (p.p < minP * 0.5 || p.p > maxP * 2) {
      score -= 20;
    } else {
      score -= 5;
    }
    // Investment pieces (sofa, bed) should be higher-quality = reward higher price tier
    if (investLevel === "splurge" && p.p > maxP * 0.5) score += 5;
    // Save pieces (art, accent) should be lower-priced = reward budget picks
    if (investLevel === "save" && p.p < maxP * 0.4) score += 5;

    // ── KAA / designer-approved ──
    if (p.kaa) score += 8;

    // ── Tiny random noise to break ties naturally ──
    score += Math.random() * 2;

    return { ...p, _score: score };
  }).filter((p): p is ScoredProduct => p !== null).sort((a, b) => b._score - a._score);

  // ─── PHASE 2: Build board with COHESION CHECKS ───
  // As we add items, we track the "board palette" and penalize items that don't fit
  const board: ScoredProduct[] = [];
  const usedIds = new Set<number>();
  const catCounts: Record<string, number> = {};
  let totalFootprint = 0;

  // Track board cohesion state
  let boardTemp: "warm" | "cool" | "neutral" = "neutral"; // dominant color temperature
  let warmCount = 0, coolCount = 0;
  const boardRetailerTiers: number[] = [];
  const boardPrices: number[] = [];

  const catTargets: Record<string, number> = {};
  for (const cat of needs.essential) catTargets[cat] = Math.max(1, Math.round(2 * sizeMult));
  for (const cat of needs.recommended) {
    if (!catTargets[cat]) catTargets[cat] = Math.max(1, Math.round(1.5 * sizeMult));
  }
  if (roomType === "Dining Room") catTargets["chair"] = Math.max(4, Math.round(3 * sizeMult));

  // Cohesion-aware add: checks if item fits with what's already on the board
  const addItem = (p: ScoredProduct): boolean => {
    const dims = getProductDims(p);
    const footprint = dims.w * dims.d + (dims.clearF * dims.w) + (dims.clearS * dims.d);
    const actualFootprint = ["rug", "art", "light"].includes(p.c) ? 0 : footprint;
    if (totalFootprint + actualFootprint > usableSqft && board.length >= 6) return false;

    // ── Cohesion gate: check if this item fits the emerging board ──
    if (board.length >= 3) {
      let cohesionPenalty = 0;

      // Color temperature consistency (70%+ should match)
      const pTemp = getProductTemp(p);
      if (pTemp !== "neutral") {
        const tempTarget = warmCount >= coolCount ? "warm" : "cool";
        const total = warmCount + coolCount;
        if (total >= 3 && pTemp !== tempTarget) {
          const consistency = (pTemp === "warm" ? warmCount : coolCount) / total;
          if (consistency < 0.3) cohesionPenalty += 20; // Would make temperature very mixed
        }
      }

      // Price tier consistency — don't pair $20k sofa with $20 accessories in anchors
      if (boardPrices.length >= 2 && !["art", "accent", "decor"].includes(p.c)) {
        const medianPrice = boardPrices.sort((a, b) => a - b)[Math.floor(boardPrices.length / 2)];
        const priceRatio = medianPrice > 0 ? Math.max(p.p / medianPrice, medianPrice / p.p) : 1;
        if (priceRatio > 8) cohesionPenalty += 15; // Wild price mismatch
        else if (priceRatio > 5) cohesionPenalty += 8;
      }

      // Retailer tier gap (don't mix luxury anchor with budget anchor)
      if (!["art", "accent", "decor"].includes(p.c) && boardRetailerTiers.length >= 2) {
        const pTier = getRetailerTier(p.r);
        const avgTier = boardRetailerTiers.reduce((s, t) => s + t, 0) / boardRetailerTiers.length;
        const tierGap = Math.abs(pTier - avgTier);
        if (tierGap > 2) cohesionPenalty += 10;
      }

      // If cohesion penalty is high, skip this item (there are better options)
      if (cohesionPenalty > 15 && board.length < 10) return false;
    }

    // Add to board and update cohesion trackers
    board.push({ ...p, _dims: dims, _footprint: actualFootprint });
    usedIds.add(p.id);
    catCounts[p.c] = (catCounts[p.c] || 0) + 1;
    totalFootprint += actualFootprint;

    // Update cohesion state
    const temp = getProductTemp(p);
    if (temp === "warm") { warmCount++; boardTemp = warmCount >= coolCount ? "warm" : boardTemp; }
    else if (temp === "cool") { coolCount++; boardTemp = coolCount > warmCount ? "cool" : boardTemp; }
    boardRetailerTiers.push(getRetailerTier(p.r));
    if (!["art", "accent", "decor"].includes(p.c)) boardPrices.push(p.p);

    return true;
  };

  // ─── PHASE 3: Fill board in priority order (Tier 1 → 2 → 3 → remaining) ───

  // Step 1: Essential categories (Tier 1) — room is incomplete without these
  for (const cat of needs.essential) {
    const candidates = scored.filter(p => p.c === cat && !usedIds.has(p.id));
    const target = catTargets[cat] || 2;
    let added = 0;
    for (let i = 0; i < candidates.length && added < target; i++) {
      if (addItem(candidates[i])) added++;
    }
  }

  // Step 2: Recommended categories (Tier 2)
  for (const cat of needs.recommended) {
    const candidates = scored.filter(p => p.c === cat && !usedIds.has(p.id));
    const target = catTargets[cat] || 1;
    let added = 0;
    for (let i = 0; i < candidates.length && added < target; i++) {
      if (addItem(candidates[i])) added++;
    }
  }

  // Step 3: Fill remaining space with best-scoring items that pass cohesion
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

  // For board 3, use a compatible secondary style for "Discovery"
  const styleCompat = (STYLE_COMPAT as Record<string, Record<string, number>>)[style] || {};
  const compatStyles = Object.entries(styleCompat)
    .filter(([s, score]) => s !== style && score >= 0.7)
    .sort((a, b) => b[1] - a[1]);
  const discoveryStyle = compatStyles.length > 0 ? compatStyles[0][0] : style;

  const board3Alt = buildDesignBoard(roomType, discoveryStyle, budgetKey, sqft,
    [...board1.items, ...board2.items].map(p => p.id), cadData);
  // Use the better board between same-style board3 and alt-style board3Alt
  const finalBoard3 = board3Alt.items.length >= board3.items.length ? board3Alt : board3;

  return [
    { name: "Curated Collection", desc: "Designer-curated products for your space — cohesive colors, materials, and proportions.", ...board1 },
    { name: "Elevated Alternative", desc: "A fresh perspective with different pieces — same vision, harmonious palette.", ...board2 },
    { name: "Discovery Board", desc: "Unexpected finds blending " + style + " with " + discoveryStyle + " — curated for cohesion.", ...finalBoard3 },
  ];
}

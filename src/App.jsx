import { useState, useRef, useEffect, useCallback } from "react";
import { DB } from "./data.js";

/* AURA v20 — Scroll Landing, Spatial Engine, Pro CAD Layout, 500 Products */

const ROOMS = ["Living Room","Dining Room","Kitchen","Bedroom","Office","Outdoor","Bathroom","Great Room"];
const VIBES = ["Warm Modern","Minimalist","Bohemian","Scandinavian","Mid-Century","Luxury","Coastal","Japandi","Industrial","Art Deco","Rustic","Glam","Transitional","Organic Modern"];
const fmt = (n) => "$" + n.toLocaleString();
const budgets = [["all","All Budgets"],["u500","Under $500"],["u1k","Under $1K"],["1k5k","$1K-$5K"],["5k10k","$5K-$10K"],["10k25k","$10K-$25K"],["25k","$25K+"]];

/* ─── FURNITURE DIMENSIONS (feet) ─── */
const FURN_DIMS = {
  sofa:   { w: 7.5, d: 3.5, clearF: 3, clearS: 0.5, label: "Sofa" },
  table:  { w: 5, d: 3, clearF: 3, clearS: 2, label: "Table" },
  chair:  { w: 2.5, d: 2.5, clearF: 2, clearS: 0.5, label: "Chair" },
  stool:  { w: 1.5, d: 1.5, clearF: 2, clearS: 0.5, label: "Stool" },
  light:  { w: 1.5, d: 1.5, clearF: 0, clearS: 0, label: "Light" },
  rug:    { w: 8, d: 5, clearF: 0, clearS: 0, label: "Rug" },
  art:    { w: 3, d: 0.5, clearF: 0, clearS: 0, label: "Art" },
  accent: { w: 2, d: 2, clearF: 1, clearS: 0.5, label: "Accent" },
};

/* ─── COLOR & MATERIAL PALETTES ─── */
const STYLE_PALETTES = {
  "Warm Modern":    { colors: ["cream","taupe","warm gray","oak","brass","terracotta","ivory","sand"], materials: ["linen","oak","walnut","bouclé","brass","ceramic","wool","cotton"], feel: "Inviting warmth meets clean lines — natural materials, soft textures, and earthy neutrals create spaces that feel both polished and lived-in." },
  "Minimalist":     { colors: ["white","light gray","black","concrete","natural","pale oak"], materials: ["steel","glass","concrete","linen","oak","leather"], feel: "Less is more — every piece is intentional. Clean silhouettes, monochromatic tones, and negative space as a design element." },
  "Bohemian":       { colors: ["amber","rust","sage","terracotta","indigo","mustard","ochre","cream"], materials: ["rattan","jute","woven","macramé","cotton","kilim","wool","leather"], feel: "Collected, layered, and deeply personal — global textiles, handcrafted pieces, and a rich mix of patterns and textures." },
  "Scandinavian":   { colors: ["white","light wood","pale blue","soft gray","natural","birch"], materials: ["birch","pine","wool","cotton","ceramic","sheepskin","linen"], feel: "Light-filled simplicity with organic warmth — pale woods, soft textiles, and functional beauty rooted in Nordic craftsmanship." },
  "Mid-Century":    { colors: ["teak","mustard","olive","burnt orange","walnut","navy","cream"], materials: ["walnut","teak","leather","wool","brass","fiberglass","vinyl"], feel: "Iconic 1950s-60s design — organic curves, tapered legs, statement silhouettes, and a bold yet refined color palette." },
  "Luxury":         { colors: ["gold","marble","charcoal","emerald","navy","champagne","onyx","ivory"], materials: ["marble","velvet","brass","silk","crystal","lacquer","cashmere","leather"], feel: "Unapologetic opulence — rich materials, dramatic proportions, and finishes that command attention in every detail." },
  "Coastal":        { colors: ["white","navy","sea blue","sand","driftwood","coral","seafoam","linen"], materials: ["rattan","linen","whitewashed wood","rope","cotton","seagrass","teak"], feel: "Relaxed elegance inspired by the sea — breezy whites, ocean blues, natural fibers, and sun-bleached textures." },
  "Japandi":        { colors: ["ash","charcoal","sage","off-white","natural wood","stone","moss"], materials: ["ash","oak","ceramic","linen","stone","paper","bamboo","clay"], feel: "The intersection of Japanese minimalism and Scandinavian warmth — wabi-sabi imperfection, natural materials, and serene simplicity." },
  "Industrial":     { colors: ["exposed brick","steel","concrete","black","dark wood","copper","iron"], materials: ["steel","iron","reclaimed wood","leather","concrete","glass","copper","brick"], feel: "Raw urban character — exposed structure, aged metals, reclaimed materials, and a warehouse aesthetic refined for living." },
  "Art Deco":       { colors: ["gold","emerald","black","ivory","navy","ruby","geometric"], materials: ["lacquer","velvet","brass","marble","mirror","glass","chrome","silk"], feel: "1920s glamour reimagined — bold geometric patterns, rich jewel tones, and luxurious finishes that dazzle." },
  "Rustic":         { colors: ["warm brown","stone","forest green","cream","iron","terracotta","honey"], materials: ["reclaimed wood","stone","iron","wool","leather","clay","linen","burlap"], feel: "Honest, grounded beauty — natural imperfections, hand-hewn textures, and materials that tell a story of craft and time." },
  "Glam":           { colors: ["blush","gold","silver","crystal","white","fur","mirrored","champagne"], materials: ["velvet","mirror","crystal","fur","lacquer","silk","metallic","lucite"], feel: "Hollywood regency sparkle — reflective surfaces, plush textures, and a fearlessly glamorous attitude." },
  "Transitional":   { colors: ["greige","navy","cream","soft blue","warm white","taupe","charcoal"], materials: ["linen","wood","wool","leather","brass","cotton","marble","nickel"], feel: "The best of both worlds — classic shapes with modern materials, timeless without being dated, current without being trendy." },
  "Organic Modern": { colors: ["clay","sage","cream","sand","warm white","terracotta","stone","moss"], materials: ["stone","clay","linen","raw wood","ceramic","wool","travertine","hemp"], feel: "Nature as muse — organic shapes, earth-born materials, and a grounded palette that brings the outside in." },
};

/* ─── ROOM TYPE REQUIREMENTS + SPATIAL RULES ─── */
const ROOM_NEEDS = {
  "Living Room":  { essential: ["sofa"], recommended: ["table","chair","rug","light","art","accent"], layout: "Anchor with a sofa facing the focal wall. Coffee table 14-18\" from sofa. Accent chairs flanking at 45°. Rug grounding the conversation zone. Lighting at varying heights.", minSqft: 120, zones: ["conversation","reading nook","entry"] },
  "Dining Room":  { essential: ["table"], recommended: ["chair","light","rug","art","accent"], layout: "Table centered with 36\" clearance on all sides for chair pullback. Chandelier 30-34\" above table. Rug extends 24\" beyond chairs. Buffet against longest wall.", minSqft: 100, zones: ["dining","buffet"] },
  "Kitchen":      { essential: ["stool"], recommended: ["light","table","accent"], layout: "Counter stools spaced 26-28\" center-to-center. Pendant lights 30-36\" above island. Open 48\" walkway between island and cabinetry.", minSqft: 80, zones: ["island seating","prep zone"] },
  "Bedroom":      { essential: ["accent"], recommended: ["light","chair","rug","art","table","accent"], layout: "Bed centered on focal wall. Nightstands flanking with 24\" clearance to walls. Bench at foot with 24\" walkway. Rug extending 18\" on each side. Reading chair in corner.", minSqft: 100, zones: ["sleep","dressing","reading"] },
  "Office":       { essential: ["table","chair"], recommended: ["light","accent","art","rug"], layout: "Desk facing window or perpendicular to natural light. Task chair with 36\" rollback space. Bookshelf on side wall. Art at eye level on focal wall.", minSqft: 80, zones: ["work","storage","meeting"] },
  "Outdoor":      { essential: ["chair"], recommended: ["table","sofa","light","accent"], layout: "Lounge zone with weather-resistant seating. Dining set in covered area. 36\" pathways between zones. Lighting along perimeter.", minSqft: 100, zones: ["lounge","dining","pathway"] },
  "Bathroom":     { essential: ["light"], recommended: ["accent","art"], layout: "Vanity lighting at face height. Stool near tub or vanity. Mirror centered above sink. Art on dry walls only.", minSqft: 40, zones: ["vanity","bath"] },
  "Great Room":   { essential: ["sofa","table"], recommended: ["chair","rug","light","art","accent","stool"], layout: "Define zones with rugs — conversation area anchored by sofa, dining zone behind, reading nook by windows. 48\" walkways between zones. Consistent style across zones.", minSqft: 250, zones: ["conversation","dining","entry","reading"] },
};

/* ─── SPATIAL DESIGN ENGINE ─── */
function buildDesignBoard(roomType, style, budgetKey, sqft, existingIds, cadData) {
  const palette = STYLE_PALETTES[style] || STYLE_PALETTES["Warm Modern"];
  const needs = ROOM_NEEDS[roomType] || ROOM_NEEDS["Living Room"];
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
    palette.colors.forEach(c => { if (pName.includes(c) || pDesc.includes(c)) score += 6; });
    palette.materials.forEach(m => { if (pName.includes(m) || pDesc.includes(m)) score += 8; });
    if (p.rm && p.rm.includes(roomType)) score += 20;
    if (p.p >= minP && p.p <= maxP) score += 15;
    else if (p.p < minP * 0.5 || p.p > maxP * 2) score -= 20;
    else score -= 5;
    if (needs.essential.includes(p.c)) score += 25;
    else if (needs.recommended.includes(p.c)) score += 12;
    if (p.kaa) score += 5;
    score += Math.random() * 4;
    return { ...p, _score: score };
  }).filter(Boolean).sort((a, b) => b._score - a._score);

  // Build spatially-aware board
  const board = [];
  const usedIds = new Set();
  const catCounts = {};
  let totalFootprint = 0;

  const catTargets = {};
  for (const cat of needs.essential) catTargets[cat] = Math.max(1, Math.round(2 * sizeMult));
  for (const cat of needs.recommended) {
    if (!catTargets[cat]) catTargets[cat] = Math.max(1, Math.round(1.5 * sizeMult));
  }
  // Dining chairs scale with table
  if (roomType === "Dining Room") catTargets.chair = Math.max(4, Math.round(3 * sizeMult));

  const addItem = (p) => {
    const dims = FURN_DIMS[p.c] || FURN_DIMS.accent;
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

function generateMoodBoards(roomType, style, budgetKey, sqft, cadData) {
  const board1 = buildDesignBoard(roomType, style, budgetKey, sqft, [], cadData);
  const board2 = buildDesignBoard(roomType, style, budgetKey, sqft, board1.items.map(p => p.id), cadData);
  const board3 = buildDesignBoard(roomType, style, budgetKey, sqft, [...board1.items, ...board2.items].map(p => p.id), cadData);
  return [
    { name: "Curated Collection", desc: "Top-scored products for your space — balanced style, quality, and spatial fit.", ...board1 },
    { name: "Elevated Alternative", desc: "A fresh perspective with different pieces — same vision, new possibilities.", ...board2 },
    { name: "Discovery Board", desc: "Unexpected finds and hidden gems that could transform your space.", ...board3 },
  ];
}

/* ─── PRO CAD LAYOUT GENERATOR ─── */
function generateCADLayout(items, roomSqft, roomType, cadAnalysis) {
  const roomW = Math.sqrt(roomSqft * 1.3);
  const roomH = roomSqft / roomW;
  const scale = 60; // px per foot
  const canvasW = Math.round(roomW * scale);
  const canvasH = Math.round(roomH * scale);

  // Parse CAD analysis for features
  let windows = [], doors = [];
  if (cadAnalysis) {
    const wMatch = cadAnalysis.match(/(\d+)\s*window/gi);
    const numWindows = wMatch ? parseInt(wMatch[0]) || 2 : 2;
    for (let i = 0; i < numWindows; i++) windows.push({ x: (canvasW / (numWindows + 1)) * (i + 1), y: 0, w: 3 * scale, side: "top" });
    if (/door|entry|entrance/i.test(cadAnalysis)) doors.push({ x: canvasW - 2 * scale, y: canvasH - 3 * scale, w: 3 * scale, side: "right" });
    else doors.push({ x: canvasW / 2 - 1.5 * scale, y: canvasH, w: 3 * scale, side: "bottom" });
  } else {
    windows.push({ x: canvasW * 0.3, y: 0, w: 4 * scale, side: "top" });
    doors.push({ x: canvasW - 2 * scale, y: canvasH - 3 * scale, w: 3 * scale, side: "right" });
  }

  // Place items using zone-based positioning
  const placed = [];
  const occupied = [];
  const catColors = { sofa: "#8B7355", table: "#5B6B55", chair: "#6B5B75", stool: "#756B5B", light: "#7B7555", rug: "#556B7B", art: "#7B5568", accent: "#6B685B" };

  const collides = (x, y, w, h) => {
    for (const o of occupied) {
      if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) return true;
    }
    return false;
  };

  const placeAt = (item, x, y, w, h, rotation) => {
    placed.push({ item, x, y, w, h, rotation: rotation || 0, color: catColors[item.c] || "#6B685B" });
    if (!["rug","art","light"].includes(item.c)) occupied.push({ x, y, w, h });
  };

  // Sort items for placement priority — anchor pieces first
  const sortOrder = { rug: 0, sofa: 1, table: 2, chair: 3, stool: 4, accent: 5, light: 6, art: 7 };
  const sortedItems = [...items].sort((a, b) => (sortOrder[a.c] ?? 5) - (sortOrder[b.c] ?? 5));
  const margin = 1.5 * scale;
  const walkway = 3 * scale; // 3ft walkway

  // Track anchor positions for relational placement
  let sofaCenter = null;
  let tableCenter = null;

  for (const item of sortedItems) {
    const dims = FURN_DIMS[item.c] || FURN_DIMS.accent;
    const w = dims.w * scale;
    const h = dims.d * scale;
    const sofaCount = placed.filter(p => p.item.c === "sofa").length;
    const chairCount = placed.filter(p => p.item.c === "chair").length;
    const artCount = placed.filter(p => p.item.c === "art").length;
    const lightCount = placed.filter(p => p.item.c === "light").length;

    if (item.c === "rug") {
      // Rug centered in conversation zone (offset toward sofa if present)
      const rx = (canvasW - w) / 2;
      const ry = sofaCenter ? sofaCenter.y - h - 1 * scale : (canvasH - h) / 2;
      placeAt(item, rx, Math.max(margin, ry), w, h);
      continue;
    }

    if (item.c === "sofa") {
      // First sofa: centered against back wall (bottom). Second: facing the first across the room
      let sx, sy;
      if (sofaCount === 0) {
        sx = (canvasW - w) / 2;
        sy = canvasH - h - margin;
        sofaCenter = { x: sx + w / 2, y: sy + h / 2 };
      } else {
        // Second sofa faces first — place against opposite wall or side
        sx = (canvasW - w) / 2;
        sy = margin + 2 * scale;
      }
      if (!collides(sx, sy, w, h)) { placeAt(item, sx, sy, w, h); if (sofaCount === 0) sofaCenter = { x: sx + w / 2, y: sy + h / 2 }; continue; }
    }

    if (item.c === "table") {
      let tx, ty;
      if (roomType === "Dining Room" || roomType === "Kitchen") {
        // Dining: center with clearance all around
        tx = (canvasW - w) / 2;
        ty = (canvasH - h) / 2;
      } else if (sofaCenter) {
        // Coffee table: 14-18" in front of sofa (toward center)
        tx = sofaCenter.x - w / 2;
        ty = sofaCenter.y - h - 1.3 * scale; // 1.3ft (~16") gap
      } else {
        tx = (canvasW - w) / 2;
        ty = (canvasH - h) / 2;
      }
      tableCenter = { x: tx + w / 2, y: ty + h / 2 };
      if (!collides(tx, ty, w, h)) { placeAt(item, tx, ty, w, h); continue; }
    }

    if (item.c === "chair") {
      let cx, cy, didPlace = false;
      if (roomType === "Dining Room" && tableCenter) {
        // Dining chairs: evenly around the table
        const positions = [
          { x: tableCenter.x - w - 0.5 * scale, y: tableCenter.y - h / 2 },  // left
          { x: tableCenter.x + 0.5 * scale, y: tableCenter.y - h / 2 },      // right
          { x: tableCenter.x - w / 2, y: tableCenter.y - h - 1 * scale },    // top
          { x: tableCenter.x - w / 2, y: tableCenter.y + 1 * scale },        // bottom
          { x: tableCenter.x - w * 2 - 1 * scale, y: tableCenter.y - h / 2 }, // far left
          { x: tableCenter.x + w + 1 * scale, y: tableCenter.y - h / 2 },    // far right
        ];
        const pos = positions[chairCount % positions.length];
        if (pos && !collides(pos.x, pos.y, w, h)) { placeAt(item, pos.x, pos.y, w, h); continue; }
      } else if (sofaCenter) {
        // Accent chairs: flanking at 45° angle from sofa, facing conversation zone
        const offsets = [
          { x: -w - 2 * scale, y: -h * 0.3 },   // left of sofa
          { x: (placed.find(p => p.item.c === "sofa")?.w || 7 * scale) + 2 * scale, y: -h * 0.3 }, // right of sofa
          { x: -w - 2 * scale, y: -h - 3 * scale },  // far left corner
          { x: (placed.find(p => p.item.c === "sofa")?.w || 7 * scale) + 2 * scale, y: -h - 3 * scale },  // far right corner
        ];
        const off = offsets[chairCount % offsets.length];
        cx = sofaCenter.x - (placed.find(p => p.item.c === "sofa")?.w || 7 * scale) / 2 + off.x;
        cy = sofaCenter.y + off.y;
        if (cx > margin && cx + w < canvasW - margin && cy > margin && cy + h < canvasH - margin && !collides(cx, cy, w, h)) {
          placeAt(item, cx, cy, w, h); continue;
        }
      }
    }

    if (item.c === "stool") {
      // Stools: along the top wall (kitchen island area)
      const stoolCount = placed.filter(p => p.item.c === "stool").length;
      const stoolX = margin + stoolCount * (w + 1.5 * scale) + 2 * scale;
      const stoolY = margin + 1 * scale;
      if (stoolX + w < canvasW - margin && !collides(stoolX, stoolY, w, h)) { placeAt(item, stoolX, stoolY, w, h); continue; }
    }

    if (item.c === "art") {
      // Art: along the top wall (focal wall) with even spacing
      const totalArtWidth = (artCount + 1) * (w + 2 * scale);
      const startX = (canvasW - totalArtWidth) / 2;
      const ax = startX + artCount * (w + 2 * scale);
      placeAt(item, Math.max(margin, Math.min(ax, canvasW - w - margin)), margin * 0.3, w, h);
      continue;
    }

    if (item.c === "light") {
      // Lights: distributed based on position — near windows, over table, flanking sofa
      let lx, ly;
      if (lightCount === 0 && tableCenter) {
        // First light: above the table
        lx = tableCenter.x - w / 2;
        ly = tableCenter.y - h - 0.5 * scale;
      } else if (lightCount === 1 && sofaCenter) {
        // Second light: beside the sofa
        lx = sofaCenter.x + (placed.find(p => p.item.c === "sofa")?.w || 7 * scale) / 2 + 1 * scale;
        ly = sofaCenter.y - h / 2;
      } else {
        // Remaining: along walls/corners
        const corners = [
          { x: margin, y: margin },
          { x: canvasW - w - margin, y: margin },
          { x: margin, y: canvasH - h - margin },
          { x: canvasW - w - margin, y: canvasH - h - margin },
        ];
        const c = corners[lightCount % corners.length];
        lx = c.x; ly = c.y;
      }
      placeAt(item, Math.max(0, Math.min(lx, canvasW - w)), Math.max(0, Math.min(ly, canvasH - h)), w, h);
      continue;
    }

    // Accent pieces: side tables, mirrors, ottomans — near walls or beside sofas
    if (item.c === "accent") {
      const accentCount = placed.filter(p => p.item.c === "accent").length;
      let ax, ay;
      if (accentCount === 0 && sofaCenter) {
        // First accent: side table next to sofa
        ax = sofaCenter.x + (placed.find(p => p.item.c === "sofa")?.w || 7 * scale) / 2 + 0.5 * scale;
        ay = sofaCenter.y - h / 2;
      } else if (accentCount === 1 && sofaCenter) {
        // Second: other side of sofa
        ax = sofaCenter.x - (placed.find(p => p.item.c === "sofa")?.w || 7 * scale) / 2 - w - 0.5 * scale;
        ay = sofaCenter.y - h / 2;
      } else {
        // Along walls
        const wallPositions = [
          { x: margin, y: canvasH * 0.4 },
          { x: canvasW - w - margin, y: canvasH * 0.4 },
          { x: canvasW * 0.3, y: margin },
          { x: canvasW * 0.7 - w, y: margin },
        ];
        const wp = wallPositions[accentCount % wallPositions.length];
        ax = wp.x; ay = wp.y;
      }
      if (ax > 0 && ax + w < canvasW && ay > 0 && ay + h < canvasH && !collides(ax, ay, w, h)) {
        placeAt(item, ax, ay, w, h); continue;
      }
    }

    // General fallback — try grid positions with walkway spacing
    let didPlace = false;
    for (let gy = margin; gy < canvasH - h - margin && !didPlace; gy += scale * 2) {
      for (let gx = margin; gx < canvasW - w - margin && !didPlace; gx += scale * 2) {
        if (!collides(gx, gy, w, h)) {
          placeAt(item, gx, gy, w, h);
          didPlace = true;
        }
      }
    }
    if (!didPlace) placeAt(item, margin + Math.random() * (canvasW - w - 2 * margin), margin + Math.random() * (canvasH - h - 2 * margin), w, h);
  }

  return { placed, canvasW, canvasH, roomW: Math.round(roomW * 10) / 10, roomH: Math.round(roomH * 10) / 10, windows, doors, scale };
}

/* ─── COMPONENTS ─── */
const CAT_COLORS = {
  sofa: { bg: "linear-gradient(145deg, #EBE4D8, #DDD4C6)", accent: "#8B7355" },
  table: { bg: "linear-gradient(145deg, #E0E6DD, #CED6CA)", accent: "#5B6B55" },
  chair: { bg: "linear-gradient(145deg, #E4E0E8, #D2CDD8)", accent: "#6B5B75" },
  stool: { bg: "linear-gradient(145deg, #E8E4E0, #D8D2CC)", accent: "#756B5B" },
  light: { bg: "linear-gradient(145deg, #E8E6E0, #D8D4CC)", accent: "#7B7555" },
  rug: { bg: "linear-gradient(145deg, #E0E4E8, #CCD0D8)", accent: "#556B7B" },
  art: { bg: "linear-gradient(145deg, #E8E0E4, #D8CCD0)", accent: "#7B5568" },
  accent: { bg: "linear-gradient(145deg, #E6E4E0, #D4D2CC)", accent: "#6B685B" },
};

function Card({ p, sel, toggle, small }) {
  const colors = CAT_COLORS[p.c] || CAT_COLORS.accent;
  const [imgErr, setImgErr] = useState(false);
  const hasImg = p.img && !imgErr;
  return (
    <div
      style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: sel ? "2px solid #C17550" : "1px solid #EDE8E2", transition: "all .3s", position: "relative", cursor: "pointer" }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
    >
      {toggle && (
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(p.id); }} style={{ position: "absolute", top: 12, right: 12, zIndex: 5, width: 30, height: 30, borderRadius: "50%", border: "none", background: sel ? "#C17550" : "rgba(255,255,255,.92)", color: sel ? "#fff" : "#6B5B4B", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 10px rgba(0,0,0,.12)", fontWeight: 700 }}>
          {sel ? "\u2713" : "+"}
        </button>
      )}
      {p.kaa === 1 && (
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, background: "rgba(255,255,255,.93)", backdropFilter: "blur(8px)", color: "#8B7355", padding: "4px 12px", fontSize: 9, fontWeight: 700, letterSpacing: ".12em", borderRadius: 20 }}>AD / KAA</div>
      )}
      <a href={p.u} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
        <div style={{ width: "100%", height: small ? 150 : 240, position: "relative", overflow: "hidden", background: colors.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {hasImg ? (
            <img src={p.img} alt={p.n} loading="lazy" referrerPolicy="no-referrer" onError={() => setImgErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <>
              <div style={{ fontSize: 10, letterSpacing: ".15em", textTransform: "uppercase", color: colors.accent, fontWeight: 700, marginBottom: 8, opacity: 0.6 }}>{p.c}</div>
              <div style={{ fontFamily: "Georgia,serif", fontSize: small ? 15 : 20, fontWeight: 400, color: colors.accent, textAlign: "center", padding: "0 20px", lineHeight: 1.3 }}>{p.r}</div>
            </>
          )}
        </div>
        <div style={{ padding: small ? "10px 14px" : "18px 20px" }}>
          <h3 style={{ fontFamily: "Georgia,serif", fontSize: small ? 13 : 16, fontWeight: 500, lineHeight: 1.3, margin: 0, marginBottom: 8 }}>{p.n}</h3>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#A89B8B" }}>{p.r}</span>
            <span style={{ fontWeight: 700, fontSize: small ? 14 : 16 }}>{fmt(p.p)}</span>
          </div>
          {!small && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px solid #F5F0EB" }}>
              <span style={{ fontSize: 11, color: "#B8A898" }}>Lead: {p.l}</span>
              <span style={{ fontSize: 11, color: "#C17550", fontWeight: 600 }}>{"Shop \u2192"}</span>
            </div>
          )}
        </div>
      </a>
    </div>
  );
}

function Pill({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "8px 18px", fontSize: 12, fontWeight: active ? 700 : 500, background: active ? "#1A1815" : "#fff", color: active ? "#fff" : "#7A6B5B", border: active ? "none" : "1px solid #E8E0D8", borderRadius: 24, cursor: "pointer", fontFamily: "inherit", transition: "all .2s", whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

/* ─── SCROLL REVEAL HOOK ─── */
function useScrollReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}

function RevealSection({ children, delay, style }) {
  const [ref, vis] = useScrollReveal();
  return (
    <div ref={ref} style={{ ...style, opacity: vis ? 1 : 0, transform: vis ? "translateY(0)" : "translateY(40px)", transition: "opacity .8s ease " + (delay || 0) + "s, transform .8s ease " + (delay || 0) + "s" }}>
      {children}
    </div>
  );
}

/* ─── CAD FLOOR PLAN RENDERER ─── */
function CADFloorPlan({ layout, roomType, style }) {
  if (!layout) return null;
  const { placed, canvasW, canvasH, roomW, roomH, windows, doors, scale } = layout;
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E8E0D8", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "#C17550", fontWeight: 700, margin: 0 }}>Floor Plan Layout</p>
          <p style={{ fontSize: 11, color: "#9B8B7B", margin: "4px 0 0" }}>{roomType} — {roomW}' x {roomH}' ({Math.round(roomW * roomH)} sqft) — {style}</p>
        </div>
        <div style={{ fontSize: 10, color: "#B8A898" }}>1 square = 1 ft</div>
      </div>
      <div style={{ padding: 20, overflowX: "auto" }}>
        <svg width={canvasW + 40} height={canvasH + 40} viewBox={`-20 -20 ${canvasW + 40} ${canvasH + 40}`} style={{ maxWidth: "100%", height: "auto" }}>
          {/* Grid */}
          <defs>
            <pattern id="grid" width={scale} height={scale} patternUnits="userSpaceOnUse">
              <path d={`M ${scale} 0 L 0 0 0 ${scale}`} fill="none" stroke="#F0EBE4" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={canvasW} height={canvasH} fill="url(#grid)" stroke="#D8D0C8" strokeWidth="2" rx="4" />

          {/* Walls */}
          <rect x="0" y="0" width={canvasW} height={canvasH} fill="none" stroke="#8B7355" strokeWidth="3" rx="4" />

          {/* Windows */}
          {windows.map((w, i) => (
            <g key={"w" + i}>
              <rect x={w.x} y={w.side === "top" ? -4 : canvasH - 4} width={w.w} height={8} fill="#B8D8E8" stroke="#7BA8C8" strokeWidth="1" rx="2" />
              <text x={w.x + w.w / 2} y={w.side === "top" ? -10 : canvasH + 16} textAnchor="middle" fontSize="8" fill="#7BA8C8">Window</text>
            </g>
          ))}

          {/* Door */}
          {doors.map((d, i) => (
            <g key={"d" + i}>
              <rect x={d.side === "right" ? canvasW - 4 : d.x} y={d.side === "bottom" ? canvasH - 4 : d.y} width={d.side === "right" ? 8 : d.w} height={d.side === "right" ? d.w : 8} fill="#E8E0D8" stroke="#A89B8B" strokeWidth="1.5" rx="2" />
              <text x={d.side === "right" ? canvasW + 10 : d.x + d.w / 2} y={d.side === "right" ? d.y + d.w / 2 : canvasH + 16} textAnchor={d.side === "right" ? "start" : "middle"} fontSize="8" fill="#A89B8B">Door</text>
            </g>
          ))}

          {/* Furniture */}
          {placed.map((p, i) => (
            <g key={i} transform={`translate(${p.x},${p.y})`}>
              <rect width={p.w} height={p.h} fill={p.color + "20"} stroke={p.color} strokeWidth="1.5" rx="3" strokeDasharray={p.item.c === "rug" ? "4,4" : "none"} />
              <text x={p.w / 2} y={p.h / 2 - 4} textAnchor="middle" fontSize={Math.min(10, p.w / 6)} fill={p.color} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">
                {(FURN_DIMS[p.item.c] || FURN_DIMS.accent).label}
              </text>
              <text x={p.w / 2} y={p.h / 2 + 8} textAnchor="middle" fontSize={Math.min(7, p.w / 8)} fill={p.color + "BB"} fontFamily="Helvetica Neue,sans-serif">
                {(p.item.n || "").length > 20 ? (p.item.n || "").slice(0, 18) + "..." : p.item.n}
              </text>
            </g>
          ))}

          {/* Dimensions */}
          <text x={canvasW / 2} y={canvasH + 20} textAnchor="middle" fontSize="10" fill="#8B7355" fontWeight="600">{roomW}'</text>
          <text x={canvasW + 16} y={canvasH / 2} textAnchor="middle" fontSize="10" fill="#8B7355" fontWeight="600" transform={`rotate(90 ${canvasW + 16} ${canvasH / 2})`}>{roomH}'</text>
        </svg>
      </div>
      {/* Legend */}
      <div style={{ padding: "12px 20px", borderTop: "1px solid #F0EBE4", display: "flex", gap: 16, flexWrap: "wrap" }}>
        {Object.entries(FURN_DIMS).map(([cat, d]) => {
          const count = placed.filter(p => p.item.c === cat).length;
          if (!count) return null;
          return <span key={cat} style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: (CAT_COLORS[cat] || CAT_COLORS.accent).accent + "30", border: "1px solid " + (CAT_COLORS[cat] || CAT_COLORS.accent).accent, display: "inline-block" }} />
            {d.label} ({count})
          </span>;
        })}
      </div>
    </div>
  );
}

/* ─── MAIN APP ─── */
export default function App() {
  const [pg, setPg] = useState("home");
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [msgs, setMsgs] = useState([{ role: "bot", text: "Welcome to AURA! I have **" + DB.length + " products** from luxury brands like McGee & Co, Shoppe Amber, and Lulu & Georgia.\n\n**Tell me about your space** — your room type, style preferences, and what you're looking for. I'll generate personalized mood boards based on our conversation.\n\n**Upload a room photo** above and I'll analyze your existing space to create layouts that actually work.\n\nOr ask me anything about design — I'll explain exactly why each piece works for your space!", recs: [] }]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState(null);
  const [vibe, setVibe] = useState(null);
  const [bud, setBud] = useState("all");
  const [sel, setSel] = useState(new Set());
  const [sc, setSc] = useState(false);
  const [tab, setTab] = useState("studio");
  const [catFilter, setCatFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [authMode, setAuthMode] = useState("signin");
  const [ae, setAe] = useState("");
  const [ap, setAp] = useState("");
  const [an, setAn] = useState("");
  const [aErr, setAErr] = useState("");
  const [aLd, setALd] = useState(false);
  const [vizUrls, setVizUrls] = useState([]);
  const [vizSt, setVizSt] = useState("idle");
  const [vizErr, setVizErr] = useState("");
  const [cadFile, setCadFile] = useState(null);
  const [cadAnalysis, setCadAnalysis] = useState(null);
  const [cadLoading, setCadLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [boards, setBoards] = useState(null);
  const [activeBoard, setActiveBoard] = useState(0);
  const [sqft, setSqft] = useState("");
  const [cadLayout, setCadLayout] = useState(null);
  const [roomPhoto, setRoomPhoto] = useState(null);
  const [roomPhotoAnalysis, setRoomPhotoAnalysis] = useState(null);
  const [roomPhotoLoading, setRoomPhotoLoading] = useState(false);
  const [boardsGenHint, setBoardsGenHint] = useState(null);
  const chatEnd = useRef(null);
  const PAGE_SIZE = 40;

  useEffect(() => {
    const h = () => setSc(window.scrollY > 40);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  useEffect(() => {
    if (chatEnd.current) chatEnd.current.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  // Mood boards are now generated after AI chat prompt — not auto-generated
  // This function is called from the send() function after AI responds
  const triggerMoodBoards = useCallback((promptRoom, promptStyle, promptBudget, promptSqft) => {
    const r = promptRoom || room;
    const s = promptStyle || vibe;
    const b = promptBudget || bud;
    const sq = parseInt(promptSqft || sqft) || null;
    if (r && s) {
      const newBoards = generateMoodBoards(r, s, b, sq, cadAnalysis);
      setBoards(newBoards);
      setActiveBoard(0);
    }
  }, [room, vibe, bud, sqft, cadAnalysis]);

  // Auto-generate CAD layout for Pro users when selection changes
  useEffect(() => {
    if (user?.plan === "pro" && sel.size > 0 && room) {
      const items = DB.filter(p => sel.has(p.id));
      const sq = parseInt(sqft) || (ROOM_NEEDS[room]?.minSqft || 200);
      const layout = generateCADLayout(items, sq, room, cadAnalysis);
      setCadLayout(layout);
    } else {
      setCadLayout(null);
    }
  }, [sel, room, sqft, cadAnalysis, user]);

  const go = (p) => { setPg(p); window.scrollTo(0, 0); };
  const toggle = (id) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selItems = DB.filter((p) => sel.has(p.id));
  const selTotal = selItems.reduce((s, p) => s + p.p, 0);

  const addBoard = (boardIdx) => {
    if (!boards || !boards[boardIdx]) return;
    const newSel = new Set(sel);
    boards[boardIdx].items.forEach(p => newSel.add(p.id));
    setSel(newSel);
  };

  // Analyze uploaded CAD/PDF for room dimensions
  const handleCad = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCadLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setCadFile({ name: file.name, data: ev.target.result, type: file.type });
      try {
        if (window.puter && window.puter.ai && window.puter.ai.chat) {
          const base64 = ev.target.result.split(",")[1];
          const mimeType = file.type || "image/png";
          const analysis = await window.puter.ai.chat([
            { role: "user", content: [
              { type: "image_url", image_url: { url: "data:" + mimeType + ";base64," + base64 } },
              { type: "text", text: "Analyze this floor plan/CAD drawing for interior design. Extract in detail:\n1) Total square footage estimate\n2) Room dimensions (width x length)\n3) Number and location of windows (which walls)\n4) Number and location of doors (which walls)\n5) Built-in features (closets, fireplace, columns, bay windows)\n6) Electrical outlets and switch locations if visible\n7) Plumbing fixtures if visible\n8) Which wall is the focal wall\n9) Natural light direction\n10) Any structural constraints (load-bearing walls, beams)\n\nBe precise with measurements. Use bullet points." },
            ]}
          ], { model: "gpt-4o", max_tokens: 1000 });
          let text = "";
          try {
            if (typeof analysis === "string") text = analysis;
            else if (analysis?.message?.content) text = String(analysis.message.content);
            else if (analysis?.text) text = String(analysis.text);
          } catch { text = ""; }
          if (text && text.length > 10) {
            setCadAnalysis(text);
            const sqftMatch = text.match(/(\d{2,5})\s*(?:sq|square|sf|ft)/i);
            if (sqftMatch) setSqft(sqftMatch[1]);
          }
        }
      } catch (err) {
        console.log("CAD analysis error:", err);
      }
      setCadLoading(false);
    };
    reader.readAsDataURL(file);
  };

  // Handle room photo upload — AI analyzes the actual room
  const handleRoomPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRoomPhotoLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setRoomPhoto({ name: file.name, data: ev.target.result, type: file.type });
      try {
        if (window.puter && window.puter.ai && window.puter.ai.chat) {
          const base64 = ev.target.result.split(",")[1];
          const mimeType = file.type || "image/jpeg";
          const analysis = await window.puter.ai.chat([
            { role: "user", content: [
              { type: "image_url", image_url: { url: "data:" + mimeType + ";base64," + base64 } },
              { type: "text", text: "You are an expert interior designer analyzing a room photo. Provide a DETAILED analysis:\n\n1) Room type (living room, bedroom, etc.)\n2) Approximate dimensions (width x length in feet)\n3) Estimated square footage\n4) Wall colors and finishes\n5) Flooring type and color\n6) Windows: count, size, location (which walls), curtain/blind type\n7) Doors: count, location\n8) Existing furniture: list each piece with approximate size and location\n9) Lighting: natural light direction, existing fixtures\n10) Architectural features: crown molding, fireplace, built-ins, ceiling height\n11) Style assessment: current design style, what works, what could improve\n12) Focal wall identification\n13) Color palette of the existing room\n14) Traffic flow patterns\n15) Areas that feel empty or could benefit from furniture\n\nBe very specific about positions (left wall, far corner, etc.) and measurements. This will be used for AI furniture placement." },
            ]}
          ], { model: "gpt-4o", max_tokens: 1500 });
          let text = "";
          try {
            if (typeof analysis === "string") text = analysis;
            else if (analysis?.message?.content) text = String(analysis.message.content);
            else if (analysis?.text) text = String(analysis.text);
          } catch { text = ""; }
          if (text && text.length > 10) {
            setRoomPhotoAnalysis(text);
            // Extract room type if we can
            const rtMatch = text.match(/room\s*type[:\s]*(living room|bedroom|dining room|kitchen|office|bathroom|great room|outdoor)/i);
            if (rtMatch && !room) setRoom(rtMatch[1].split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "));
            // Extract sqft
            const sqftMatch = text.match(/(\d{2,5})\s*(?:sq|square|sf|ft)/i);
            if (sqftMatch && !sqft) setSqft(sqftMatch[1]);
            // Notify user in chat
            setMsgs((prev) => [...prev, {
              role: "bot",
              text: "**Room Photo Analyzed!** I've studied your room in detail. Here's what I see:\n\n" + text.slice(0, 600) + (text.length > 600 ? "..." : "") + "\n\nI'll use this to create accurate layouts and visualizations. Tell me what you'd like to do with this space, and I'll generate personalized mood boards!",
              recs: []
            }]);
          }
        }
      } catch (err) {
        console.log("Room photo analysis error:", err);
        setMsgs((prev) => [...prev, { role: "bot", text: "I received your room photo but had trouble analyzing it. You can still describe your space and I'll help design it!", recs: [] }]);
      }
      setRoomPhotoLoading(false);
    };
    reader.readAsDataURL(file);
  };

  // Generate room visualizations — AI writes the perfect prompt, Pollinations renders it
  const generateViz = async () => {
    if (selItems.length === 0) return;
    setVizSt("loading");
    setVizUrls([]);
    setVizErr("");
    const items = selItems.slice(0, 12);
    const roomName = room || "living room";
    const styleName = vibe || "modern luxury";
    const palette = STYLE_PALETTES[styleName] || STYLE_PALETTES["Warm Modern"];

    // Step 1: Use GPT-4o to craft the PERFECT condensed prompt (under 450 chars)
    // This ensures every product name is included and the prompt is optimized for FLUX
    const productList = items.map(i => i.n + " (" + i.c + ")").join(", ");
    const cadSnippet = cadAnalysis ? "Room info: " + cadAnalysis.slice(0, 150) : "";
    const photoSnippet = roomPhotoAnalysis ? "Existing room: " + roomPhotoAnalysis.slice(0, 150) : "";

    let aiPrompts = null;
    try {
      if (window.puter && window.puter.ai && window.puter.ai.chat) {
        const resp = await window.puter.ai.chat([
          { role: "system", content: "You generate image prompts for FLUX AI. Output ONLY 3 prompts separated by |||. Each must be under 400 characters. Each must be a photorealistic interior design image prompt." },
          { role: "user", content: "Create 3 prompts for a " + styleName + " " + roomName + (sqft ? " (" + sqft + " sqft)" : "") + " with THESE EXACT products: " + productList + ". Colors: " + palette.colors.slice(0,4).join(", ") + ". Materials: " + palette.materials.slice(0,4).join(", ") + "." + (cadSnippet ? " " + cadSnippet : "") + (photoSnippet ? " " + photoSnippet : "") + "\n\nVariations: 1) bright morning light wide angle 2) warm golden hour intimate detail 3) evening moody accent lighting. Each prompt MUST name the specific furniture pieces. Architectural Digest quality, 8k photorealistic." }
        ], { model: "gpt-4o", max_tokens: 600 });
        let txt = "";
        if (typeof resp === "string") txt = resp;
        else if (resp?.message?.content) txt = String(resp.message.content);
        else if (resp?.text) txt = String(resp.text);
        if (txt && txt.includes("|||")) {
          aiPrompts = txt.split("|||").map(p => p.trim()).filter(p => p.length > 30);
        }
      }
    } catch (e) { console.log("Prompt generation error:", e); }

    // Fallback: craft prompts manually if AI fails
    const shortPieces = items.slice(0, 6).map(i => {
      const words = i.n.split(" ").slice(0, 3).join(" ");
      return words + " " + i.c;
    }).join(", ");
    const colorStr = palette.colors.slice(0, 3).join(", ");
    const fallbackCore = styleName + " " + roomName + " with " + shortPieces + ", " + colorStr + " palette, luxury editorial photo, 8k photorealistic";

    const labels = ["Morning Light", "Golden Hour", "Evening Ambiance"];
    const fallbacks = [
      fallbackCore + ", morning sunlight, wide angle, airy bright",
      fallbackCore + ", golden hour warmth, rich textures, intimate",
      fallbackCore + ", evening mood lighting, dramatic elegant"
    ];

    const prompts = aiPrompts && aiPrompts.length >= 3
      ? aiPrompts.slice(0, 3)
      : fallbacks;

    const results = [];
    const seed = Math.floor(Math.random() * 100000);

    // Generate images sequentially with retry
    for (let vi = 0; vi < prompts.length; vi++) {
      // Ensure prompt fits in URL (max ~1500 encoded chars)
      let p = prompts[vi].slice(0, 600);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const encoded = encodeURIComponent(p);
          const useSeed = seed + vi + attempt * 1000;
          const url = "https://image.pollinations.ai/prompt/" + encoded + "?width=1344&height=768&seed=" + useSeed + "&nologo=true&model=flux&enhance=true";

          const loaded = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(true);
            img.onerror = () => reject(new Error("Load failed"));
            img.src = url;
            setTimeout(() => reject(new Error("Timeout")), 90000);
          });

          if (loaded) {
            results.push({ url, label: labels[vi] || "View " + (vi+1) });
            setVizUrls([...results]);
            break;
          }
        } catch {
          if (attempt === 1) console.log("Viz failed for view", vi);
        }
      }
    }

    if (results.length > 0) {
      setVizUrls(results);
      setVizSt("ok");
    } else {
      setVizErr("Images are taking longer than expected. Please try again.");
      setVizSt("idle");
    }
  };

  const saveProject = () => {
    const pr = { id: Date.now(), name: (room || "My") + " " + (vibe || "Design"), room, vibe, items: Array.from(sel), total: selTotal, date: Date.now(), sqft: sqft || null };
    setProjects((prev) => [pr, ...prev]);
  };
  const delPr = (idx) => setProjects((prev) => prev.filter((_, i) => i !== idx));
  const loadPr = (pr) => { setRoom(pr.room); setVibe(pr.vibe); setSel(new Set(pr.items || [])); if (pr.sqft) setSqft(String(pr.sqft)); go("design"); setTab("studio"); };

  const doAuth = (mode, email, pass, name) => {
    if (mode === "signup") { setUser({ email, name, plan: "free" }); go("home"); return null; }
    setUser({ email, name: email.split("@")[0], plan: "free" }); go("home"); return null;
  };

  /* ─── AI CHAT ─── */
  const send = async () => {
    if (!inp.trim() || busy) return;
    const msg = inp.trim();
    setInp("");
    setBusy(true);
    setMsgs((prev) => [...prev, { role: "user", text: msg, recs: [] }]);

    let recs = [];
    try { recs = localMatch(msg); } catch { recs = DB.slice(0, 12); }
    const topPicks = recs.slice(0, 12);

    let aiWorked = false;
    try {
      if (window.puter && window.puter.ai && window.puter.ai.chat) {
        const m = msg.toLowerCase();
        const scored = DB.map((x) => {
          let s = 0;
          if (room && x.rm && x.rm.includes(room)) s += 3;
          if (vibe && x.v && x.v.includes(vibe)) s += 3;
          const catKws = { sofa:["sofa","couch","sectional"], table:["table","desk","coffee","console","dining"], chair:["chair","seat","lounge","armchair"], stool:["stool","counter","bar"], light:["light","lamp","chandelier","pendant","sconce"], rug:["rug","carpet"], art:["art","painting","print"], accent:["ottoman","bench","mirror","cabinet","bed","dresser","pillow","vase"] };
          Object.entries(catKws).forEach(([cat, kws]) => { kws.forEach((w) => { if (m.includes(w) && x.c === cat) s += 5; }); });
          (x.n || "").toLowerCase().split(" ").forEach((w) => { if (w.length > 3 && m.includes(w)) s += 2; });
          return { ...x, _s: s };
        }).sort((a, b) => b._s - a._s).slice(0, 50);

        const catalogStr = scored.map((x) => "[ID:" + x.id + "] " + x.n + " by " + x.r + " $" + x.p + " (" + x.c + ", " + (FURN_DIMS[x.c]?.w || 2) + "'x" + (FURN_DIMS[x.c]?.d || 2) + "')").join("\n");
        const palette = STYLE_PALETTES[vibe] || {};
        const roomNeeds = ROOM_NEEDS[room] || {};

        const sysPrompt = "You are AURA, an elite AI interior design consultant with deep spatial awareness.\n\nCatalog (" + DB.length + " items, showing relevant):\n" + catalogStr +
          "\n\nContext: Room=" + (room || "any") + ", Style=" + (vibe || "any") + (palette.feel ? " (" + palette.feel.slice(0, 80) + ")" : "") +
          ", Budget=" + (bud === "all" ? "any" : bud) + (sqft ? ", ~" + sqft + " sq ft" : "") +
          (cadAnalysis ? "\nFloor plan analysis: " + cadAnalysis.slice(0, 400) : "") +
          (roomPhotoAnalysis ? "\nRoom photo analysis: " + roomPhotoAnalysis.slice(0, 400) : "") +
          (roomNeeds.layout ? "\nLayout guide: " + roomNeeds.layout : "") +
          "\n\nCRITICAL FORMAT RULES:\n- NEVER use numbered lists (1. 2. 3.). Instead write in flowing paragraphs with product names in **bold**\n- For each product, write a short flowing paragraph explaining WHY it works — materials, color harmony, proportions, spatial fit\n- Reference products as [ID:N] right after the product name. Recommend up to 12 products\n- Write in a warm, conversational editorial tone — like a magazine design column, NOT a bulleted spec sheet\n- Use line breaks between product paragraphs for readability\n- Consider room dimensions — mention if a piece is too large or small\n- Suggest placement naturally: 'place this against the focal wall', 'this would look stunning flanking the sofa'\n- Consider traffic flow — ensure 36\" minimum walkways\n- Color palette: " + (palette.colors || []).join(", ") +
          "\n- Materials: " + (palette.materials || []).join(", ") +
          "\n- Answer design questions with real expertise and spatial reasoning";

        const chatHistory = [{ role: "system", content: sysPrompt }];
        msgs.slice(-6).forEach((mm) => {
          if (mm.role === "user") chatHistory.push({ role: "user", content: mm.text || "" });
          else if (mm.role === "bot" && mm.text) chatHistory.push({ role: "assistant", content: mm.text });
        });
        chatHistory.push({ role: "user", content: msg });

        const response = await window.puter.ai.chat(chatHistory, { model: "gpt-4o", max_tokens: 1500 });

        let text = "";
        try {
          if (typeof response === "string") text = response;
          else if (response?.message?.content) text = String(response.message.content);
          else if (response?.text) text = String(response.text);
        } catch { text = ""; }

        if (text && text.length > 20 && text !== "[object Object]") {
          // Extract product IDs from [ID:N] references
          const ids = []; const rx = /\[ID:(\d+)\]/g; let mt;
          while ((mt = rx.exec(text)) !== null) ids.push(parseInt(mt[1]));
          let apiRecs = ids.map((id) => DB.find((p) => p.id === id)).filter(Boolean);

          // If no [ID:N] refs found, try fuzzy name matching from bold text
          if (apiRecs.length === 0) {
            const boldNames = []; const bx = /\*\*([^*]+)\*\*/g; let bm;
            while ((bm = bx.exec(text)) !== null) boldNames.push(bm[1].toLowerCase().trim());
            const found = new Set();
            for (const bn of boldNames) {
              // Try exact name match first, then partial
              let match = DB.find(p => (p.n || "").toLowerCase() === bn);
              if (!match) match = DB.find(p => (p.n || "").toLowerCase().includes(bn) || bn.includes((p.n || "").toLowerCase()));
              if (!match) {
                // Try matching key words (3+ chars)
                const words = bn.split(/[\s,\-\/]+/).filter(w => w.length > 2);
                if (words.length >= 2) {
                  match = DB.find(p => {
                    const pn = (p.n || "").toLowerCase();
                    return words.filter(w => pn.includes(w)).length >= Math.ceil(words.length * 0.6);
                  });
                }
              }
              if (match && !found.has(match.id)) { apiRecs.push(match); found.add(match.id); }
            }
          }

          const cleanText = text.replace(/\[ID:\d+\]/g, "").trim();
          setMsgs((prev) => [...prev, { role: "bot", text: cleanText, recs: apiRecs.length > 0 ? apiRecs : topPicks }]);
          aiWorked = true;

          // Trigger mood boards based on the conversation context
          // Detect room type and style from user message
          const ml = msg.toLowerCase();
          let detectedRoom = room;
          let detectedStyle = vibe;
          if (!detectedRoom) {
            for (const r of ROOMS) { if (ml.includes(r.toLowerCase())) { detectedRoom = r; setRoom(r); break; } }
          }
          if (!detectedStyle) {
            for (const v of VIBES) { if (ml.includes(v.toLowerCase())) { detectedStyle = v; setVibe(v); break; } }
          }
          // Generate mood boards if we have room + style (from filters or detected from prompt)
          if (detectedRoom && detectedStyle) {
            setTimeout(() => triggerMoodBoards(detectedRoom, detectedStyle, bud, sqft), 300);
            setBoardsGenHint("Mood boards generated based on your conversation");
          } else if (detectedRoom || detectedStyle || apiRecs.length > 4) {
            // If we have partial context or the AI gave many recs, still try to generate boards
            const fallbackRoom = detectedRoom || "Living Room";
            const fallbackStyle = detectedStyle || "Warm Modern";
            setTimeout(() => triggerMoodBoards(fallbackRoom, fallbackStyle, bud, sqft), 300);
            setBoardsGenHint("Mood boards curated from your request" + (!detectedRoom ? " — select a room type for better results" : "") + (!detectedStyle ? " — select a style for better results" : ""));
          }
        }
      }
    } catch (e) { console.log("AI chat error:", e); }

    if (!aiWorked) {
      const palette = STYLE_PALETTES[vibe] || {};
      const reasons = topPicks.slice(0, 8).map((p) => {
        const dims = FURN_DIMS[p.c] || FURN_DIMS.accent;
        const styleMatch = vibe && p.v && p.v.includes(vibe) ? ", perfectly suited to the **" + vibe + "** aesthetic" : "";
        const roomMatch = room && p.rm && p.rm.some(r => r === room) ? " and ideal for your **" + room + "**" : "";
        const spatial = sqft ? " At " + dims.w + "'x" + dims.d + "', it's well-proportioned for your " + sqft + " sqft space." : "";
        const catLabel = { sofa:"luxurious seating piece", chair:"stunning chair", table:"beautiful table", light:"striking light fixture", rug:"gorgeous rug", art:"captivating art piece", stool:"elegant stool", accent:"refined accent piece" }[p.c] || "refined piece";
        return "**" + p.n + "** by " + p.r + " (" + fmt(p.p) + ") — a " + catLabel + styleMatch + roomMatch + "." + spatial;
      }).join("\n\n");
      setMsgs((prev) => [...prev, {
        role: "bot",
        text: (palette.feel ? "_" + palette.feel + "_\n\n" : "") + "Here's what I'd recommend:\n\n" + reasons + "\n\nWould you like me to go deeper on any of these, or explore a different direction?",
        recs: topPicks
      }]);
      // Trigger mood boards from fallback too
      if (room && vibe) {
        setTimeout(() => triggerMoodBoards(room, vibe, bud, sqft), 300);
        setBoardsGenHint("Mood boards generated based on your request");
      }
    }
    setBusy(false);
  };

  const localMatch = (msg) => {
    const m = msg.toLowerCase();
    return DB.map((x) => {
      let s = Math.random() * 1.5;
      const kws = { sofa:["sofa","couch","sectional","seating"], table:["table","desk","coffee","console","dining","side"], chair:["chair","seat","lounge","armchair"], stool:["stool","counter","bar"], light:["light","lamp","chandelier","pendant","sconce"], rug:["rug","carpet"], art:["art","painting","print","wall"], accent:["accent","ottoman","tub","bench","headboard","daybed","cabinet","mirror","bed","dresser","nightstand","credenza"] };
      Object.keys(kws).forEach((cat) => { kws[cat].forEach((w) => { if (m.includes(w) && x.c === cat) s += 7; }); });
      if (room && x.rm && x.rm.some((r) => r === room)) s += 4;
      if (vibe && x.v && x.v.includes(vibe)) s += 5;
      const palette = STYLE_PALETTES[vibe];
      if (palette) {
        const pn = (x.n || "").toLowerCase();
        palette.colors.forEach(c => { if (pn.includes(c)) s += 3; });
        palette.materials.forEach(mat => { if (pn.includes(mat)) s += 4; });
      }
      if (m.includes("kaa") && x.kaa) s += 8;
      (x.n || "").toLowerCase().split(" ").forEach((w) => { if (m.includes(w) && w.length > 3) s += 3; });
      (x.r || "").toLowerCase().split(" ").forEach((w) => { if (m.includes(w) && w.length > 3) s += 4; });
      if (bud === "u500") s += x.p < 500 ? 4 : -2;
      if (bud === "u1k") s += x.p < 1000 ? 3 : -2;
      if (bud === "1k5k") s += (x.p >= 1000 && x.p <= 5000) ? 3 : -1;
      if (bud === "5k10k") s += (x.p > 5000 && x.p <= 10000) ? 3 : -1;
      if (bud === "10k25k") s += (x.p > 10000 && x.p <= 25000) ? 3 : -1;
      if (bud === "25k") s += x.p > 25000 ? 2 : -1;
      return { ...x, _s: s };
    }).sort((a, b) => b._s - a._s).slice(0, 18);
  };

  const filteredDB = DB.filter((p) => {
    const mc = catFilter === "all" || p.c === catFilter || (catFilter === "kaa" && p.kaa);
    const ms = !searchQ || (p.n || "").toLowerCase().includes(searchQ.toLowerCase()) || (p.r || "").toLowerCase().includes(searchQ.toLowerCase());
    return mc && ms;
  });
  const pagedDB = filteredDB.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = pagedDB.length < filteredDB.length;
  const cats = [
    { id: "all", n: "All (" + DB.length + ")" }, { id: "kaa", n: "AD / KAA" },
    { id: "sofa", n: "Sofas" }, { id: "table", n: "Tables" }, { id: "chair", n: "Chairs" },
    { id: "stool", n: "Stools" }, { id: "light", n: "Lighting" }, { id: "rug", n: "Rugs" },
    { id: "art", n: "Art" }, { id: "accent", n: "Accents" }
  ];

  /* ─── AUTH PAGE ─── */
  if (pg === "auth") {
    const submit = async () => { if (!ae || !ap) { setAErr("Fill in all fields"); return; } if (authMode === "signup" && !an) { setAErr("Name required"); return; } setALd(true); setAErr(""); const e = doAuth(authMode, ae, ap, an); if (e) { setAErr(e); setALd(false); } };
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(160deg,#FDFCFA,#F0EBE4)" }}>
        <div style={{ background: "#fff", borderRadius: 20, padding: "48px 40px", maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.06)" }}>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, textAlign: "center", marginBottom: 4 }}>AURA</h1>
          <p style={{ textAlign: "center", fontSize: 14, color: "#9B8B7B", marginBottom: 32 }}>{authMode === "signup" ? "Create account" : "Welcome back"}</p>
          {authMode === "signup" && <input value={an} onChange={(e) => setAn(e.target.value)} placeholder="Your name" style={{ width: "100%", padding: "14px 16px", border: "1px solid #E8E0D8", borderRadius: 12, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 12 }} />}
          <input value={ae} onChange={(e) => setAe(e.target.value)} type="email" placeholder="Email" style={{ width: "100%", padding: "14px 16px", border: "1px solid #E8E0D8", borderRadius: 12, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 12 }} />
          <input value={ap} onChange={(e) => setAp(e.target.value)} type="password" placeholder="Password" onKeyDown={(e) => { if (e.key === "Enter") submit(); }} style={{ width: "100%", padding: "14px 16px", border: "1px solid #E8E0D8", borderRadius: 12, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
          {aErr && <p style={{ color: "#C17550", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{aErr}</p>}
          <button onClick={submit} disabled={aLd} style={{ width: "100%", padding: "14px", background: "#C17550", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: aLd ? 0.5 : 1 }}>{aLd ? "..." : authMode === "signup" ? "Create Account" : "Sign In"}</button>
          <p style={{ textAlign: "center", fontSize: 13, color: "#9B8B7B", marginTop: 20 }}>{authMode === "signup" ? "Have an account? " : "Need one? "}<span onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAErr(""); }} style={{ color: "#C17550", cursor: "pointer", fontWeight: 600 }}>{authMode === "signup" ? "Sign In" : "Sign Up"}</span></p>
          <p style={{ textAlign: "center", marginTop: 16 }}><span onClick={() => go("home")} style={{ fontSize: 12, color: "#B8A898", cursor: "pointer" }}>Back</span></p>
        </div>
      </div>
    );
  }

  /* ─── PRICING PAGE ─── */
  if (pg === "pricing") {
    return (
      <div style={{ minHeight: "100vh", padding: "120px 5% 60px", background: "linear-gradient(160deg,#FDFCFA,#F0EBE4)" }}>
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
          <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 12 }}>Pricing</p>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 42, fontWeight: 400, marginBottom: 48 }}>Design without limits</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "40px 32px", textAlign: "left" }}>
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#A89B8B", marginBottom: 8 }}>Free</p>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 48, fontWeight: 400, marginBottom: 24 }}>$0<span style={{ fontSize: 16, color: "#B8A898" }}>/mo</span></div>
              {["3 mood boards/month", "Core catalog", "AI design chat", "Room visualizations", "1 saved project"].map((f) => <p key={f} style={{ fontSize: 14, color: "#7A6B5B", padding: "10px 0", borderBottom: "1px solid #F5F0EB", margin: 0 }}>&#10003; {f}</p>)}
            </div>
            <div style={{ background: "#fff", borderRadius: 20, padding: "40px 32px", textAlign: "left", border: "2px solid #C17550", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, right: 20, background: "#C17550", color: "#fff", fontSize: 10, fontWeight: 700, padding: "6px 16px", borderRadius: "0 0 12px 12px", letterSpacing: ".1em" }}>POPULAR</div>
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#C17550", marginBottom: 8 }}>Pro</p>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 48, fontWeight: 400, marginBottom: 24 }}>$20<span style={{ fontSize: 16, color: "#B8A898" }}>/mo</span></div>
              {["Unlimited mood boards", "Full " + DB.length + " product catalog", "3 AI Room Visualizations", "CAD/PDF floor plan analysis", "AI-generated furniture layout plans", "Exact placement with dimensions", "Spatial fit verification", "Unlimited projects", "All 14 design styles"].map((f) => <p key={f} style={{ fontSize: 14, color: "#7A6B5B", padding: "10px 0", borderBottom: "1px solid #F5F0EB", margin: 0 }}>&#10003; {f}</p>)}
              <button onClick={() => { setUser({ ...(user || { email: "demo", name: "Demo" }), plan: "pro" }); go("success"); }} style={{ width: "100%", marginTop: 24, padding: "14px", background: "#C17550", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Subscribe - $20/mo</button>
            </div>
          </div>
          <button onClick={() => go("home")} style={{ marginTop: 36, background: "none", border: "1px solid #E8E0D8", borderRadius: 12, padding: "12px 28px", fontSize: 13, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
        </div>
      </div>
    );
  }

  if (pg === "success") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#FDFCFA,#F0EBE4)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#C17550", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 32, color: "#fff" }}>&#10003;</div>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 36, fontWeight: 400, marginBottom: 12 }}>Welcome to Pro</h1>
          <p style={{ color: "#9B8B7B", marginBottom: 32 }}>All features unlocked — including AI floor plan layouts.</p>
          <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", padding: "14px 36px", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start Designing</button>
        </div>
      </div>
    );
  }

  /* ─── ACCOUNT PAGE ─── */
  if (pg === "account") {
    return (
      <div style={{ minHeight: "100vh", padding: "100px 5% 60px", background: "#FDFCFA" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <button onClick={() => go("home")} style={{ background: "none", border: "none", fontSize: 12, color: "#B8A898", cursor: "pointer", marginBottom: 24, fontFamily: "inherit" }}>Back</button>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Hello, {user?.name || "Designer"}</h1>
          <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 8 }}>{user?.email}</p>
          <span style={{ display: "inline-block", background: user?.plan === "pro" ? "#C17550" : "#F0EBE4", color: user?.plan === "pro" ? "#fff" : "#9B8B7B", padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>{user?.plan === "pro" ? "Pro" : "Free"}</span>
          <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400, marginTop: 40, marginBottom: 20, paddingTop: 20, borderTop: "1px solid #F0EBE4" }}>Projects ({projects.length})</h2>
          {projects.length === 0 ? <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center", color: "#B8A898" }}>No projects yet.</div> : projects.map((pr, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 14, border: "1px solid #F0EBE4", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px" }}>
              <div><div style={{ fontFamily: "Georgia,serif", fontSize: 17 }}>{pr.name}</div><div style={{ fontSize: 12, color: "#B8A898", marginTop: 3 }}>{(pr.items || []).length} items - {fmt(pr.total || 0)}{pr.sqft ? " - " + pr.sqft + " sqft" : ""}</div></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => loadPr(pr)} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Open</button>
                <button onClick={() => delPr(i)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "7px 14px", fontSize: 11, color: "#B8A898", cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
            <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>New Project</button>
            <button onClick={() => { setUser(null); setProjects([]); go("home"); }} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 12, padding: "14px 28px", fontSize: 13, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

  const currentPalette = STYLE_PALETTES[vibe];

  /* ─── MAIN LAYOUT ─── */
  return (
    <div style={{ fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", background: "#FDFCFA", minHeight: "100vh", color: "#1A1815" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}} @keyframes drawLine{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}} @keyframes growLine{from{transform:scaleY(0)}to{transform:scaleY(1)}} @keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(193,117,80,.15)}50%{box-shadow:0 0 40px rgba(193,117,80,.35)}} @keyframes slideInLeft{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:translateX(0)}} @keyframes slideInRight{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:translateX(0)}} @keyframes scaleIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}`}</style>

      {/* NAV */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, padding: sc ? "10px 5%" : "16px 5%", display: "flex", alignItems: "center", justifyContent: "space-between", background: sc ? "rgba(253,252,250,.96)" : "transparent", backdropFilter: sc ? "blur(20px)" : "none", transition: "all .3s", borderBottom: sc ? "1px solid #F0EBE4" : "none" }}>
        <div onClick={() => go("home")} style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400, cursor: "pointer" }}>AURA</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {sel.size > 0 && <span style={{ fontSize: 12, color: "#C17550", fontWeight: 600, background: "rgba(193,117,80,.06)", padding: "6px 16px", borderRadius: 20 }}>{sel.size} items - {fmt(selTotal)}</span>}
          <button onClick={() => go("pricing")} style={{ background: "none", border: "none", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Pricing</button>
          {user ? <button onClick={() => go("account")} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 24, padding: "7px 18px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{user.name || "Account"}</button> : <button onClick={() => go("auth")} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 24, padding: "7px 18px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign In</button>}
          <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", borderRadius: 24, padding: "8px 20px", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Design</button>
        </div>
      </nav>

      {/* HOME — SCROLL ANIMATED LANDING */}
      {pg === "home" && (
        <div>
          {/* Hero */}
          <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", padding: "0 6%", maxWidth: 1200, margin: "0 auto", position: "relative" }}>
            <div style={{ animation: "fadeUp .8s ease" }}>
              <p style={{ fontSize: 12, letterSpacing: ".25em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 20 }}>AI-Powered Interior Design Platform</p>
              <h1 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(44px,7vw,84px)", fontWeight: 400, lineHeight: 1.05, marginBottom: 32 }}>Design spaces<br />that feel like you</h1>
              <p style={{ fontSize: 18, color: "#7A6B5B", lineHeight: 1.8, maxWidth: 540, marginBottom: 44 }}>AURA combines {DB.length} luxury products with an AI spatial engine that understands your room dimensions, style preferences, and how every piece should fit and flow together.</p>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", padding: "18px 40px", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start designing</button>
                <button onClick={() => { go("design"); setTab("catalog"); }} style={{ background: "transparent", border: "1px solid #E8E0D8", padding: "18px 40px", borderRadius: 12, fontSize: 15, color: "#7A6B5B", cursor: "pointer", fontFamily: "inherit" }}>Browse {DB.length} products</button>
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", animation: "pulse 2s ease infinite" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#B8A898" strokeWidth="1.5"><path d="M12 5v14m0 0l-6-6m6 6l6-6"/></svg>
            </div>
          </section>

          {/* How It Works — Flowing Timeline */}
          <section style={{ padding: "120px 6% 80px", maxWidth: 1000, margin: "0 auto" }}>
            <RevealSection style={{ textAlign: "center", marginBottom: 80 }}>
              <p style={{ fontSize: 12, letterSpacing: ".25em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 16 }}>The Process</p>
              <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(32px,4vw,52px)", fontWeight: 400, lineHeight: 1.15 }}>From vision to floor plan<br />in minutes</h2>
            </RevealSection>

            {/* Timeline */}
            <div style={{ position: "relative" }}>
              {/* Vertical line */}
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: "linear-gradient(to bottom, #C17550, #E8D0C0, #C17550)", transform: "translateX(-50%)", zIndex: 0 }} />

              {[
                { icon: "\u{1F4D0}", title: "Define Your Space", desc: "Upload a floor plan, enter dimensions, or snap a photo of your room. Our AI identifies windows, doors, focal walls, existing furniture, and maps out traffic flow — building a spatial model of your exact space.", accent: "#C17550" },
                { icon: "\u{1F3A8}", title: "Discover Your Style", desc: "Explore 14 curated design palettes with matched colors and materials. Every one of our 500 products is scored for harmony, material compatibility, and proportional fit to your room.", accent: "#8B7355" },
                { icon: "\u{1F4AC}", title: "Chat & Curate", desc: "Describe your vision in natural language. AURA generates three personalized mood boards from your conversation — each spatially verified so every piece actually fits.", accent: "#5B7B6B" },
                { icon: "\u{2B50}", title: "See It Come to Life", desc: "Get AI-rendered room visualizations showing your exact products in place. Pro users unlock full CAD floor plans with clearances, traffic paths, and dimensional callouts.", accent: "#6B5B8B" },
              ].map((step, i) => (
                <RevealSection key={i} delay={i * 0.2} style={{ position: "relative", display: "flex", alignItems: "flex-start", marginBottom: i < 3 ? 80 : 0, flexDirection: i % 2 === 0 ? "row" : "row-reverse" }}>
                  {/* Content card */}
                  <div style={{ width: "42%", background: "#fff", borderRadius: 24, padding: "36px 32px", border: "1px solid #F0EBE4", boxShadow: "0 8px 40px rgba(0,0,0,.04)", position: "relative", transition: "transform .3s, box-shadow .3s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 16px 60px rgba(0,0,0,.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 8px 40px rgba(0,0,0,.04)"; }}
                  >
                    <h3 style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 500, marginBottom: 14, color: "#1A1815" }}>{step.title}</h3>
                    <p style={{ fontSize: 15, color: "#6B5B4B", lineHeight: 1.8, margin: 0 }}>{step.desc}</p>
                  </div>

                  {/* Center node */}
                  <div style={{ position: "absolute", left: "50%", top: 20, transform: "translateX(-50%)", zIndex: 2 }}>
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fff", border: "3px solid " + step.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 4px 20px " + step.accent + "25", animation: "glowPulse 3s ease infinite " + (i * 0.5) + "s" }}>
                      {step.icon}
                    </div>
                  </div>

                  {/* Spacer for other side */}
                  <div style={{ width: "42%" }} />
                </RevealSection>
              ))}
            </div>
          </section>

          {/* Brands */}
          <section style={{ padding: "80px 6%", background: "#F8F5F0" }}>
            <RevealSection style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
              <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 16 }}>Curated From</p>
              <h2 style={{ fontFamily: "Georgia,serif", fontSize: 36, fontWeight: 400, marginBottom: 40 }}>Premium brands, real products</h2>
              <div style={{ display: "flex", justifyContent: "center", gap: 48, flexWrap: "wrap", marginBottom: 20 }}>
                {["McGee & Co", "Shoppe Amber", "Lulu & Georgia"].map(b => (
                  <span key={b} style={{ fontFamily: "Georgia,serif", fontSize: 22, color: "#8B7355", fontWeight: 400 }}>{b}</span>
                ))}
              </div>
              <p style={{ fontSize: 14, color: "#9B8B7B" }}>{DB.length} products — every item links directly to the exact product page for purchase</p>
            </RevealSection>
          </section>

          {/* Pro Feature: CAD */}
          <section style={{ padding: "100px 6%", maxWidth: 1100, margin: "0 auto" }}>
            <RevealSection>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" }}>
                <div>
                  <span style={{ display: "inline-block", background: "#C17550", color: "#fff", padding: "5px 14px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 20 }}>Pro Feature</span>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: 36, fontWeight: 400, marginBottom: 20 }}>AI floor plan layouts</h2>
                  <p style={{ fontSize: 15, color: "#7A6B5B", lineHeight: 1.8, marginBottom: 20 }}>Upload your CAD drawing, floor plan, or even a photo of your room — AURA's AI analyzes everything and generates a precise furniture layout. Every piece is placed with proper clearances — 36" walkways, 14-18" coffee table distance, and zone-based organization.</p>
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {["Window and door detection", "Traffic flow optimization", "Furniture dimensions and spacing", "Zone-based room organization", "Focal wall identification"].map(f => (
                      <li key={f} style={{ fontSize: 14, color: "#5A5045", padding: "8px 0", paddingLeft: 20, position: "relative" }}><span style={{ position: "absolute", left: 0, color: "#C17550" }}>&#10003;</span>{f}</li>
                    ))}
                  </ul>
                  <button onClick={() => go("pricing")} style={{ marginTop: 20, background: "#C17550", color: "#fff", padding: "14px 32px", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Get Pro</button>
                </div>
                <div style={{ background: "#F8F5F0", borderRadius: 20, padding: 32, border: "1px solid #E8E0D8" }}>
                  {/* Mini CAD preview */}
                  <svg width="100%" viewBox="0 0 400 300" style={{ display: "block" }}>
                    <rect width="400" height="300" fill="#fff" stroke="#D8D0C8" strokeWidth="2" rx="4" />
                    <defs><pattern id="miniGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#F0EBE4" strokeWidth="0.5" /></pattern></defs>
                    <rect width="400" height="300" fill="url(#miniGrid)" />
                    <rect x="120" y="200" width="160" height="60" fill="#8B735520" stroke="#8B7355" strokeWidth="1.5" rx="3" />
                    <text x="200" y="230" textAnchor="middle" fontSize="9" fill="#8B7355" fontWeight="700">Sofa</text>
                    <rect x="160" y="130" width="80" height="50" fill="#5B6B5520" stroke="#5B6B55" strokeWidth="1.5" rx="3" />
                    <text x="200" y="158" textAnchor="middle" fontSize="9" fill="#5B6B55" fontWeight="700">Table</text>
                    <rect x="30" y="140" width="50" height="50" fill="#6B5B7520" stroke="#6B5B75" strokeWidth="1.5" rx="3" />
                    <text x="55" y="168" textAnchor="middle" fontSize="8" fill="#6B5B75" fontWeight="700">Chair</text>
                    <rect x="320" y="140" width="50" height="50" fill="#6B5B7520" stroke="#6B5B75" strokeWidth="1.5" rx="3" />
                    <text x="345" y="168" textAnchor="middle" fontSize="8" fill="#6B5B75" fontWeight="700">Chair</text>
                    <rect x="80" y="80" width="240" height="160" fill="none" stroke="#556B7B" strokeWidth="1" strokeDasharray="4,4" rx="3" />
                    <text x="200" y="250" textAnchor="middle" fontSize="8" fill="#556B7B">Rug</text>
                    <rect x="140" y="-3" width="120" height="6" fill="#B8D8E8" stroke="#7BA8C8" strokeWidth="0.5" rx="2" />
                    <text x="200" y="-8" textAnchor="middle" fontSize="7" fill="#7BA8C8">Window</text>
                  </svg>
                </div>
              </div>
            </RevealSection>
          </section>

          {/* CTA */}
          <section style={{ padding: "80px 6% 100px", textAlign: "center" }}>
            <RevealSection>
              <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(32px,4vw,48px)", fontWeight: 400, marginBottom: 20 }}>Ready to see your space come to life?</h2>
              <p style={{ fontSize: 16, color: "#9B8B7B", marginBottom: 36 }}>No credit card required. Start with 3 free mood boards.</p>
              <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", padding: "18px 48px", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Open Studio</button>
            </RevealSection>
          </section>
        </div>
      )}

      {/* DESIGN */}
      {pg === "design" && (
        <div style={{ paddingTop: 60 }}>
          <div style={{ borderBottom: "1px solid #F0EBE4", background: "#fff" }}>
            <div style={{ display: "flex", padding: "0 5%", overflowX: "auto" }}>
              {[["studio", "Studio"], ["catalog", "Catalog (" + DB.length + ")"], ["projects", "Projects" + (projects.length ? " (" + projects.length + ")" : "")]].map(([id, lb]) => (
                <button key={id} onClick={() => { setTab(id); setPage(0); }} style={{ padding: "16px 22px", fontSize: 13, fontWeight: 600, background: "none", border: "none", borderBottom: tab === id ? "2px solid #C17550" : "2px solid transparent", color: tab === id ? "#1A1815" : "#B8A898", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{lb}</button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
                <button onClick={saveProject} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
              </div>
            </div>
          </div>

          {/* STUDIO TAB */}
          {tab === "studio" && (
            <div>
              {/* Filters */}
              <div style={{ padding: "20px 5% 16px", background: "#fff", borderBottom: "1px solid #F0EBE4" }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600, marginBottom: 8 }}>Room</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{ROOMS.map((rm) => <Pill key={rm} active={room === rm} onClick={() => setRoom(room === rm ? null : rm)}>{rm}</Pill>)}</div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600, marginBottom: 8 }}>Style</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{VIBES.map((v) => <Pill key={v} active={vibe === v} onClick={() => setVibe(vibe === v ? null : v)}>{v}</Pill>)}</div>
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600, marginBottom: 8 }}>Budget</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{budgets.map(([id, lb]) => <Pill key={id} active={bud === id} onClick={() => setBud(id)}>{lb}</Pill>)}</div>
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600, marginBottom: 8 }}>Square Footage</div>
                    <input value={sqft} onChange={(e) => setSqft(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 350" style={{ width: "100%", padding: "8px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600, marginBottom: 8 }}>Floor Plan / CAD</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", background: "#fff", border: "1px dashed #D8D0C8", borderRadius: 12, fontSize: 12, color: "#7A6B5B", cursor: "pointer" }}>
                        <span>{cadLoading ? "Analyzing..." : "\u{1F4D0} Upload Floor Plan"}</span>
                        <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleCad} style={{ display: "none" }} disabled={cadLoading} />
                      </label>
                      {cadFile && <span style={{ fontSize: 12, color: "#C17550", fontWeight: 600 }}>{cadFile.name}</span>}
                      {cadLoading && <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#C17550", borderRadius: "50%", animation: "spin .8s linear infinite" }} />}
                    </div>
                    {cadAnalysis && (
                      <div style={{ marginTop: 10, padding: "14px 18px", background: "#F8F5F0", borderRadius: 12, fontSize: 12, color: "#5A5045", lineHeight: 1.7, whiteSpace: "pre-wrap", border: "1px solid #E8E0D8", maxHeight: 200, overflowY: "auto" }}>
                        <strong style={{ color: "#C17550", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase" }}>Floor Plan Analysis</strong><br/>{cadAnalysis}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600, marginBottom: 8 }}>Room Photo</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", background: "#fff", border: "1px dashed #7BA8C8", borderRadius: 12, fontSize: 12, color: "#5B7B8B", cursor: "pointer" }}>
                        <span>{roomPhotoLoading ? "Analyzing room..." : "\u{1F4F7} Upload Room Photo"}</span>
                        <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleRoomPhoto} style={{ display: "none" }} disabled={roomPhotoLoading} />
                      </label>
                      {roomPhoto && <span style={{ fontSize: 12, color: "#5B7B8B", fontWeight: 600 }}>{roomPhoto.name}</span>}
                      {roomPhotoLoading && <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#5B7B8B", borderRadius: "50%", animation: "spin .8s linear infinite" }} />}
                    </div>
                    {roomPhoto && !roomPhotoLoading && (
                      <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <img src={roomPhoto.data} alt="Your room" style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 8, border: "1px solid #E8E0D8" }} />
                        {roomPhotoAnalysis && (
                          <div style={{ flex: 1, padding: "8px 14px", background: "#EFF5F8", borderRadius: 10, fontSize: 11, color: "#4A6570", lineHeight: 1.6, maxHeight: 120, overflowY: "auto", border: "1px solid #D0E0E8" }}>
                            <strong style={{ color: "#5B7B8B", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>Room Analysis</strong><br/>{roomPhotoAnalysis.slice(0, 300)}{roomPhotoAnalysis.length > 300 ? "..." : ""}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Style Palette */}
              {currentPalette && (
                <div style={{ padding: "16px 5%", background: "#F8F5F0", borderBottom: "1px solid #F0EBE4" }}>
                  <div style={{ maxWidth: 900 }}>
                    <p style={{ fontSize: 13, fontStyle: "italic", color: "#6B5B4B", lineHeight: 1.6, margin: "0 0 10px" }}>{currentPalette.feel}</p>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div>
                        <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600 }}>Colors: </span>
                        <span style={{ fontSize: 12, color: "#7A6B5B" }}>{currentPalette.colors.join(" \u00b7 ")}</span>
                      </div>
                      <div>
                        <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#B8A898", fontWeight: 600 }}>Materials: </span>
                        <span style={{ fontSize: 12, color: "#7A6B5B" }}>{currentPalette.materials.join(" \u00b7 ")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Mood Boards — generated after AI conversation */}
              {!boards && room && vibe && (
                <div style={{ padding: "20px 5%", background: "#F8F5F0", borderBottom: "1px solid #F0EBE4" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <p style={{ fontSize: 13, color: "#7A6B5B", margin: 0 }}>
                      <span style={{ fontWeight: 600 }}>Ready to generate mood boards?</span> Describe your design vision in the AI chat below, and I'll create personalized mood boards based on your needs.
                    </p>
                    <button onClick={() => { triggerMoodBoards(room, vibe, bud, sqft); setBoardsGenHint("Mood boards generated from your selections"); }} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "8px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Generate Now</button>
                  </div>
                </div>
              )}
              {boards && (
                <div style={{ padding: "28px 5%", background: "#fff", borderBottom: "1px solid #F0EBE4" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>Curated Mood Boards</p>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400 }}>{room} — {vibe}{sqft ? " — " + sqft + " sqft" : ""}</h2>
                      {boardsGenHint && <p style={{ fontSize: 11, color: "#B8A898", margin: "4px 0 0", fontStyle: "italic" }}>{boardsGenHint}</p>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {boards.map((b, i) => (
                        <button key={i} onClick={() => setActiveBoard(i)} style={{ padding: "8px 16px", fontSize: 11, fontWeight: activeBoard === i ? 700 : 500, background: activeBoard === i ? "#C17550" : "#fff", color: activeBoard === i ? "#fff" : "#7A6B5B", border: activeBoard === i ? "none" : "1px solid #E8E0D8", borderRadius: 20, cursor: "pointer", fontFamily: "inherit" }}>{b.name}</button>
                      ))}
                    </div>
                  </div>

                  {boards[activeBoard] && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <p style={{ fontSize: 13, color: "#7A6B5B", fontStyle: "italic", margin: 0 }}>{boards[activeBoard].desc}</p>
                          {boards[activeBoard].spatialInfo && (
                            <p style={{ fontSize: 11, color: "#B8A898", margin: "4px 0 0" }}>
                              Space usage: {boards[activeBoard].spatialInfo.fillPct}% of {boards[activeBoard].spatialInfo.usableSqft} usable sqft
                              {boards[activeBoard].spatialInfo.fillPct > 80 ? " — tightly fitted" : boards[activeBoard].spatialInfo.fillPct > 50 ? " — well balanced" : " — spacious layout"}
                            </p>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{boards[activeBoard].items.length} pieces — {fmt(boards[activeBoard].totalBudget)}</span>
                          <button onClick={() => addBoard(activeBoard)} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Add All to Selection</button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
                        {boards[activeBoard].items.map((p) => <Card key={p.id} p={p} sel={sel.has(p.id)} toggle={toggle} small />)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Chat */}
              <div style={{ padding: "28px 5%", background: "#F8F5F0" }}>
                <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 12 }}>AI Designer</p>
                <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 900, boxShadow: "0 2px 16px rgba(0,0,0,.04)" }}>
                  <div style={{ maxHeight: 500, overflowY: "auto", marginBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    {msgs.map((m, i) => (
                      <div key={i}>
                        <div style={{ padding: m.role === "user" ? "12px 18px" : "18px 22px", borderRadius: m.role === "user" ? 14 : 18, fontSize: 14, lineHeight: 1.8, maxWidth: m.role === "user" ? "85%" : "100%", background: m.role === "user" ? "#C17550" : "#F5F0EB", color: m.role === "user" ? "#fff" : "#3A3530", marginLeft: m.role === "user" ? "auto" : 0 }} dangerouslySetInnerHTML={{ __html: (m.text || "")
                          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#8B6040;font-weight:700">$1</strong>')
                          .replace(/_(.*?)_/g, "<em>$1</em>")
                          .replace(/^\d+[\.\)]\s*/gm, "") // strip numbered list prefixes
                          .replace(/^[-•]\s*/gm, "") // strip bullet prefixes
                          .replace(/\n{2,}/g, '</p><p style="margin:12px 0 0">') // double newline = paragraph
                          .replace(/\n/g, "<br/>")
                          .replace(/^/, '<p style="margin:0">')
                          .replace(/$/, "</p>")
                        }} />
                        {m.recs?.length > 0 && (
                          <div style={{ marginTop: 14 }}>
                            <p style={{ fontSize: 11, color: "#B8A898", marginBottom: 10 }}>Tap + to add. Click card to shop the exact product.</p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
                              {m.recs.map((p) => <Card key={p.id} p={p} small sel={sel.has(p.id)} toggle={toggle} />)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {busy && (
                      <div style={{ color: "#B8A898", fontSize: 13, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 16, height: 16, border: "2px solid #E8E0D8", borderTopColor: "#C17550", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
                        Designing your space...
                      </div>
                    )}
                    <div ref={chatEnd} />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input value={inp} onChange={(e) => setInp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={room ? "What do you need for your " + room.toLowerCase() + "?" : "Describe your ideal space..."} style={{ flex: 1, background: "#F8F5F0", border: "1px solid #E8E0D8", borderRadius: 12, padding: "14px 18px", fontFamily: "inherit", fontSize: 14, outline: "none" }} />
                    <button onClick={send} disabled={busy} style={{ background: "#C17550", color: "#fff", border: "none", padding: "14px 24px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.4 : 1, fontFamily: "inherit" }}>Send</button>
                  </div>
                </div>
              </div>

              {/* Selection + CAD Layout + Viz */}
              {sel.size > 0 && (
                <div style={{ padding: "28px 5%", background: "#fff", borderTop: "1px solid #F0EBE4" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>Your Selection</p>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400 }}>{sel.size} items - {fmt(selTotal)}</h2>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button onClick={generateViz} disabled={vizSt === "loading"} style={{ background: "linear-gradient(135deg,#C17550,#D4956E)", color: "#fff", border: "none", borderRadius: 12, padding: "10px 22px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: vizSt === "loading" ? 0.5 : 1 }}>{vizSt === "loading" ? "Generating 3 views..." : "\u2728 Visualize Room with AI"}</button>
                      <button onClick={() => { setSel(new Set()); setVizUrls([]); setVizSt("idle"); setVizErr(""); setCadLayout(null); }} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "8px 18px", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Clear All</button>
                    </div>
                  </div>

                  {/* Pro CAD Layout */}
                  {cadLayout && user?.plan === "pro" && (
                    <div style={{ marginBottom: 24 }}>
                      <CADFloorPlan layout={cadLayout} roomType={room || "Living Room"} style={vibe || "Modern"} />
                      {/* Placement Notes */}
                      <div style={{ marginTop: 12, padding: "14px 18px", background: "#F8F5F0", borderRadius: 12, border: "1px solid #E8E0D8" }}>
                        <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#C17550", fontWeight: 700, marginBottom: 8 }}>Placement Notes</p>
                        <p style={{ fontSize: 12, color: "#5A5045", lineHeight: 1.7, margin: 0 }}>{(ROOM_NEEDS[room] || ROOM_NEEDS["Living Room"]).layout}</p>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
                          <span style={{ fontSize: 11, color: "#7A6B5B" }}>Floor area: {cadLayout.roomW}' x {cadLayout.roomH}'</span>
                          <span style={{ fontSize: 11, color: "#7A6B5B" }}>Furniture footprint: {cadLayout.placed.filter(p => !["rug","art","light"].includes(p.item.c)).length} floor items</span>
                          <span style={{ fontSize: 11, color: "#7A6B5B" }}>Wall items: {cadLayout.placed.filter(p => ["art","light"].includes(p.item.c)).length}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Pro Upsell */}
                  {(!user || user.plan !== "pro") && sel.size >= 3 && (
                    <div style={{ marginBottom: 24, padding: "20px 24px", background: "linear-gradient(135deg, #F8F0E8, #F0E8E0)", borderRadius: 16, border: "1px solid #E8D8C8", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#8B6040", margin: 0 }}>See where every piece goes</p>
                        <p style={{ fontSize: 12, color: "#A08060", margin: "4px 0 0" }}>Pro users get AI-generated floor plans with exact furniture placement, clearances, and traffic flow.</p>
                      </div>
                      <button onClick={() => go("pricing")} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Upgrade to Pro</button>
                    </div>
                  )}

                  {/* Visualizations */}
                  <div style={{ marginBottom: 16, padding: "10px 14px", background: "#F8F5F0", borderRadius: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#7A6B5B" }}>AI visualizations feature your <strong>{selItems.length} selected products</strong> rendered by FLUX{roomPhotoAnalysis ? " — matched to your room" : ""}{cadAnalysis ? " — using your floor plan" : ""}</span>
                  </div>
                  {vizErr && <p style={{ fontSize: 12, color: "#C17550", marginBottom: 16 }}>{vizErr}</p>}
                  {vizSt === "loading" && (
                    <div style={{ marginBottom: 24, borderRadius: 16, border: "1px solid #F0EBE4", padding: 60, textAlign: "center", background: "#F8F5F0" }}>
                      <div style={{ width: 32, height: 32, border: "3px solid #E8E0D8", borderTopColor: "#C17550", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 16px" }} />
                      <p style={{ fontSize: 14, color: "#7A6B5B", margin: 0 }}>AI is crafting your room with {selItems.length} products...</p>
                      <p style={{ fontSize: 11, color: "#B8A898", margin: "6px 0 0" }}>Writing optimized prompts, then rendering in high resolution (30-60 seconds)</p>
                    </div>
                  )}
                  {vizUrls.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: vizUrls.length === 1 ? "1fr" : "repeat(auto-fit,minmax(320px,1fr))", gap: 16, marginBottom: 24 }}>
                      {vizUrls.map((v, i) => (
                        <div key={i} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #F0EBE4" }}>
                          <img src={v.url || v} alt={"Room visualization " + (i + 1)} loading="lazy" style={{ width: "100%", height: "auto", minHeight: 200, objectFit: "cover", display: "block", background: "#F0EBE4" }} />
                          <div style={{ padding: "10px 16px", background: "#fff" }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#C17550", margin: 0 }}>{v.label || ["Morning Light", "Golden Hour", "Evening Ambiance"][i] || "Variation " + (i + 1)}</p>
                            <p style={{ fontSize: 10, color: "#B8A898", margin: 0 }}>{room || "Room"} — {vibe || "Modern"}{roomPhotoAnalysis ? " — based on your room" : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
                    {selItems.map((p) => <Card key={p.id} p={p} sel toggle={toggle} small />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CATALOG TAB */}
          {tab === "catalog" && (
            <div style={{ padding: "28px 5%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 14 }}>
                <div>
                  <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>Full Catalog</p>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400 }}>{filteredDB.length} products</h2>
                </div>
                <input value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setPage(0); }} placeholder="Search products or brands..." style={{ background: "#fff", border: "1px solid #E8E0D8", borderRadius: 12, padding: "12px 18px", fontFamily: "inherit", fontSize: 13, outline: "none", width: 280 }} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
                {cats.map((ct) => <Pill key={ct.id} active={catFilter === ct.id} onClick={() => { setCatFilter(ct.id); setPage(0); }}>{ct.n}</Pill>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 18 }}>
                {pagedDB.map((p) => <Card key={p.id} p={p} sel={sel.has(p.id)} toggle={toggle} />)}
              </div>
              {hasMore && (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <button onClick={() => setPage((p) => p + 1)} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Load more ({filteredDB.length - pagedDB.length} remaining)</button>
                </div>
              )}
            </div>
          )}

          {/* PROJECTS TAB */}
          {tab === "projects" && (
            <div style={{ padding: "28px 5%" }}>
              <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>My Projects</p>
              <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400, marginBottom: 24 }}>Saved ({projects.length})</h2>
              {!user ? (
                <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center" }}>
                  <p style={{ color: "#B8A898", marginBottom: 16 }}>Sign in to save.</p>
                  <button onClick={() => go("auth")} style={{ background: "#C17550", color: "#fff", padding: "14px 28px", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Sign In</button>
                </div>
              ) : projects.length === 0 ? <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center", color: "#B8A898" }}>No projects yet.</div> : projects.map((pr, i) => (
                <div key={i} style={{ background: "#fff", borderRadius: 14, border: "1px solid #F0EBE4", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px" }}>
                  <div><div style={{ fontFamily: "Georgia,serif", fontSize: 17 }}>{pr.name}</div><div style={{ fontSize: 12, color: "#B8A898", marginTop: 3 }}>{(pr.items || []).length} items - {fmt(pr.total || 0)}</div></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => loadPr(pr)} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Load</button>
                    <button onClick={() => delPr(i)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "7px 14px", fontSize: 11, color: "#B8A898", cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FOOTER */}
      <footer style={{ background: "#fff", borderTop: "1px solid #F0EBE4", padding: "28px 5%", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 18 }}>AURA</div>
        <div style={{ display: "flex", gap: 24 }}>
          {[["Design", () => { go("design"); setTab("studio"); }], ["Catalog", () => { go("design"); setTab("catalog"); }], ["Pricing", () => go("pricing")]].map(([l, fn]) => (
            <span key={l} onClick={fn} style={{ fontSize: 12, cursor: "pointer", color: "#B8A898" }}>{l}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}

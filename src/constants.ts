import type { RoomType, StyleName, BudgetKey, FurnitureDim, FurnitureCategory, StylePalette, RoomNeed } from "./types";

export const ROOMS: readonly RoomType[] = ["Living Room","Dining Room","Kitchen","Bedroom","Office","Outdoor","Bathroom","Great Room"];
export const VIBES: readonly StyleName[] = ["Warm Modern","Minimalist","Bohemian","Scandinavian","Mid-Century","Luxury","Coastal","Japandi","Industrial","Art Deco","Rustic","Glam","Transitional","Organic Modern"];
export const fmt = (n: number): string => "$" + n.toLocaleString();
export const budgets: readonly [BudgetKey, string][] = [["all","All Budgets"],["u500","Under $500"],["u1k","Under $1K"],["1k5k","$1K-$5K"],["5k10k","$5K-$10K"],["10k25k","$10K-$25K"],["25k","$25K+"]];


/* ─── FURNITURE DIMENSIONS (feet) ─── */
export const FURN_DIMS: Record<FurnitureCategory, FurnitureDim> = {
  sofa:   { w: 7, d: 3, clearF: 2.5, clearS: 0.5, label: "Sofa" },
  bed:    { w: 5.5, d: 7, clearF: 3, clearS: 1.5, label: "Bed" },
  table:  { w: 4.5, d: 2.5, clearF: 3, clearS: 2, label: "Table" },
  chair:  { w: 2.2, d: 2.2, clearF: 1.5, clearS: 0.5, label: "Chair" },
  stool:  { w: 1.3, d: 1.3, clearF: 1.5, clearS: 0.5, label: "Stool" },
  light:  { w: 1.2, d: 1.2, clearF: 0, clearS: 0, label: "Light" },
  rug:    { w: 8, d: 5, clearF: 0, clearS: 0, label: "Rug" },
  art:    { w: 2.5, d: 0.3, clearF: 0, clearS: 0, label: "Art" },
  accent: { w: 1.8, d: 1.8, clearF: 0.5, clearS: 0.5, label: "Accent" },
  decor: { w: 1, d: 1, clearF: 0.3, clearS: 0.3, label: "Decor" },
  storage: { w: 3, d: 1.5, clearF: 1, clearS: 0.5, label: "Storage" },
};

/* ─── COLOR & MATERIAL PALETTES ─── */
export const STYLE_PALETTES: Record<StyleName, StylePalette> = {
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


/* ─── DESIGN INTELLIGENCE: STYLE COMPATIBILITY MATRIX ─── */
// 0.0 = clash, 0.5 = moderate, 0.8+ = great pair (based on shared silhouettes, materials, era)
export const STYLE_COMPAT: Record<string, Record<string, number>> = {
  "Warm Modern":    { "Warm Modern":1,"Minimalist":.7,"Bohemian":.6,"Scandinavian":.85,"Mid-Century":.8,"Luxury":.5,"Coastal":.6,"Japandi":.8,"Industrial":.4,"Art Deco":.3,"Rustic":.5,"Glam":.4,"Transitional":.9,"Organic Modern":.95 },
  "Minimalist":     { "Warm Modern":.7,"Minimalist":1,"Bohemian":.3,"Scandinavian":.9,"Mid-Century":.75,"Luxury":.5,"Coastal":.5,"Japandi":.95,"Industrial":.7,"Art Deco":.3,"Rustic":.2,"Glam":.3,"Transitional":.7,"Organic Modern":.75 },
  "Bohemian":       { "Warm Modern":.6,"Minimalist":.3,"Bohemian":1,"Scandinavian":.6,"Mid-Century":.75,"Luxury":.3,"Coastal":.65,"Japandi":.4,"Industrial":.5,"Art Deco":.3,"Rustic":.7,"Glam":.3,"Transitional":.5,"Organic Modern":.7 },
  "Scandinavian":   { "Warm Modern":.85,"Minimalist":.9,"Bohemian":.6,"Scandinavian":1,"Mid-Century":.85,"Luxury":.4,"Coastal":.65,"Japandi":.95,"Industrial":.5,"Art Deco":.2,"Rustic":.4,"Glam":.3,"Transitional":.75,"Organic Modern":.85 },
  "Mid-Century":    { "Warm Modern":.8,"Minimalist":.75,"Bohemian":.75,"Scandinavian":.85,"Mid-Century":1,"Luxury":.5,"Coastal":.4,"Japandi":.7,"Industrial":.75,"Art Deco":.55,"Rustic":.4,"Glam":.4,"Transitional":.75,"Organic Modern":.7 },
  "Luxury":         { "Warm Modern":.5,"Minimalist":.5,"Bohemian":.3,"Scandinavian":.4,"Mid-Century":.5,"Luxury":1,"Coastal":.3,"Japandi":.4,"Industrial":.3,"Art Deco":.85,"Rustic":.2,"Glam":.9,"Transitional":.7,"Organic Modern":.4 },
  "Coastal":        { "Warm Modern":.6,"Minimalist":.5,"Bohemian":.65,"Scandinavian":.65,"Mid-Century":.4,"Luxury":.3,"Coastal":1,"Japandi":.5,"Industrial":.3,"Art Deco":.2,"Rustic":.7,"Glam":.25,"Transitional":.65,"Organic Modern":.7 },
  "Japandi":        { "Warm Modern":.8,"Minimalist":.95,"Bohemian":.4,"Scandinavian":.95,"Mid-Century":.7,"Luxury":.4,"Coastal":.5,"Japandi":1,"Industrial":.5,"Art Deco":.2,"Rustic":.4,"Glam":.2,"Transitional":.7,"Organic Modern":.9 },
  "Industrial":     { "Warm Modern":.4,"Minimalist":.7,"Bohemian":.5,"Scandinavian":.5,"Mid-Century":.75,"Luxury":.3,"Coastal":.3,"Japandi":.5,"Industrial":1,"Art Deco":.4,"Rustic":.65,"Glam":.3,"Transitional":.5,"Organic Modern":.4 },
  "Art Deco":       { "Warm Modern":.3,"Minimalist":.3,"Bohemian":.3,"Scandinavian":.2,"Mid-Century":.55,"Luxury":.85,"Coastal":.2,"Japandi":.2,"Industrial":.4,"Art Deco":1,"Rustic":.15,"Glam":.85,"Transitional":.5,"Organic Modern":.25 },
  "Rustic":         { "Warm Modern":.5,"Minimalist":.2,"Bohemian":.7,"Scandinavian":.4,"Mid-Century":.4,"Luxury":.2,"Coastal":.7,"Japandi":.4,"Industrial":.65,"Art Deco":.15,"Rustic":1,"Glam":.15,"Transitional":.5,"Organic Modern":.65 },
  "Glam":           { "Warm Modern":.4,"Minimalist":.3,"Bohemian":.3,"Scandinavian":.3,"Mid-Century":.4,"Luxury":.9,"Coastal":.25,"Japandi":.2,"Industrial":.3,"Art Deco":.85,"Rustic":.15,"Glam":1,"Transitional":.6,"Organic Modern":.25 },
  "Transitional":   { "Warm Modern":.9,"Minimalist":.7,"Bohemian":.5,"Scandinavian":.75,"Mid-Century":.75,"Luxury":.7,"Coastal":.65,"Japandi":.7,"Industrial":.5,"Art Deco":.5,"Rustic":.5,"Glam":.6,"Transitional":1,"Organic Modern":.8 },
  "Organic Modern": { "Warm Modern":.95,"Minimalist":.75,"Bohemian":.7,"Scandinavian":.85,"Mid-Century":.7,"Luxury":.4,"Coastal":.7,"Japandi":.9,"Industrial":.4,"Art Deco":.25,"Rustic":.65,"Glam":.25,"Transitional":.8,"Organic Modern":1 },
};

/* ─── COLOR TEMPERATURE FAMILIES ─── */
export const COLOR_TEMPS: Record<string, "warm"|"cool"|"neutral"> = {
  cream:"warm", taupe:"warm", "warm gray":"warm", oak:"warm", brass:"warm", terracotta:"warm", ivory:"warm", sand:"warm",
  amber:"warm", rust:"warm", mustard:"warm", ochre:"warm", teak:"warm", "burnt orange":"warm", walnut:"warm", gold:"warm",
  champagne:"warm", honey:"warm", "warm brown":"warm", copper:"warm", "warm white":"warm", cherry:"warm", ruby:"warm",
  blush:"warm", coral:"warm", clay:"warm",
  white:"neutral", "light gray":"neutral", gray:"neutral", black:"neutral", concrete:"neutral", natural:"neutral",
  "pale oak":"neutral", greige:"neutral", charcoal:"neutral", stone:"neutral", onyx:"neutral", "off-white":"neutral",
  "exposed brick":"neutral", iron:"neutral", steel:"neutral", "dark wood":"neutral", silver:"neutral", crystal:"neutral",
  mirrored:"neutral", fur:"neutral", geometric:"neutral",
  "pale blue":"cool", "soft blue":"cool", navy:"cool", "sea blue":"cool", seafoam:"cool", emerald:"cool",
  sage:"cool", olive:"cool", indigo:"cool", "forest green":"cool", moss:"cool", ash:"cool", birch:"cool",
  "light wood":"cool", driftwood:"cool", "natural wood":"cool", "soft gray":"cool",
};

/* ─── RETAILER TIER & AESTHETIC CLUSTERS ─── */
export const RETAILER_TIERS: Record<string, number> = {
  "Restoration Hardware":4, "RH":4, "Arhaus":4, "Roche Bobois":4, "B&B Italia":4, "Holly Hunt":4,
  "Design Within Reach":4, "Herman Miller":4, "Knoll":4,
  "Crate & Barrel":3, "Room & Board":3, "Pottery Barn":3, "Serena & Lily":3,
  "West Elm":2, "CB2":2, "Article":2, "Joybird":2, "Castlery":2,
  "Lulu & Georgia":3, "McGee & Co":3, "Shoppe Amber":3,
  "IKEA":1, "Target":1, "Wayfair":1, "Amazon":1, "Online Store":1,
};

/* ─── SPLURGE vs SAVE CATEGORIES ─── */
// Investment: anchor pieces where quality matters most (splurge)
// Flexible: can go either way
// Save: decorative/replaceable items where budget finds work great
export const CATEGORY_INVESTMENT: Record<string, "splurge"|"flexible"|"save"> = {
  sofa:"splurge", bed:"splurge", chair:"flexible", table:"flexible",
  stool:"flexible", light:"flexible", rug:"flexible",
  art:"save", accent:"save", decor:"save", storage:"flexible",
};

/* ─── ROOM CATEGORY TIER PRIORITY ─── */
// Tier 1: Must-have (incomplete without), Tier 2: Important, Tier 3: Polish
export const ROOM_CAT_TIERS: Record<string, Record<string, 1|2|3>> = {
  "Living Room":  { sofa:1, table:1, light:1, chair:2, rug:2, art:3, accent:3 },
  "Dining Room":  { table:1, chair:1, light:1, rug:2, art:3, accent:3, storage:2 },
  "Kitchen":      { stool:1, light:1, table:2, accent:3 },
  "Bedroom":      { bed:1, table:1, light:1, rug:2, chair:2, art:3, accent:3 },
  "Office":       { table:1, chair:1, light:1, storage:2, rug:2, art:3, accent:3 },
  "Outdoor":      { chair:1, table:1, sofa:2, light:2, accent:3 },
  "Bathroom":     { light:1, accent:2, art:3 },
  "Great Room":   { sofa:1, table:1, light:1, chair:2, rug:2, art:3, accent:3, stool:2 },
};

/* ─── ROOM TYPE REQUIREMENTS + SPATIAL RULES ─── */
export const ROOM_NEEDS: Record<RoomType, RoomNeed> = {
  "Living Room":  { essential: ["sofa"], recommended: ["table","chair","rug","light","art","accent"], layout: "Anchor with a sofa facing the focal wall. Coffee table 14-18\" from sofa. Accent chairs flanking at 45°. Rug grounding the conversation zone. Lighting at varying heights.", minSqft: 120, zones: ["conversation","reading nook","entry"] },
  "Dining Room":  { essential: ["table"], recommended: ["chair","light","rug","art","accent"], layout: "Table centered with 36\" clearance on all sides for chair pullback. Chandelier 30-34\" above table. Rug extends 24\" beyond chairs. Buffet against longest wall.", minSqft: 100, zones: ["dining","buffet"] },
  "Kitchen":      { essential: ["stool"], recommended: ["light","table","accent"], layout: "Counter stools spaced 26-28\" center-to-center. Pendant lights 30-36\" above island. Open 48\" walkway between island and cabinetry.", minSqft: 80, zones: ["island seating","prep zone"] },
  "Bedroom":      { essential: ["accent"], recommended: ["light","chair","rug","art","table","accent"], layout: "Bed centered on focal wall. Nightstands flanking with 24\" clearance to walls. Bench at foot with 24\" walkway. Rug extending 18\" on each side. Reading chair in corner.", minSqft: 100, zones: ["sleep","dressing","reading"] },
  "Office":       { essential: ["table","chair"], recommended: ["light","accent","art","rug"], layout: "Desk facing window or perpendicular to natural light. Task chair with 36\" rollback space. Bookshelf on side wall. Art at eye level on focal wall.", minSqft: 80, zones: ["work","storage","meeting"] },
  "Outdoor":      { essential: ["chair"], recommended: ["table","sofa","light","accent"], layout: "Lounge zone with weather-resistant seating. Dining set in covered area. 36\" pathways between zones. Lighting along perimeter.", minSqft: 100, zones: ["lounge","dining","pathway"] },
  "Bathroom":     { essential: ["light"], recommended: ["accent","art"], layout: "Vanity lighting at face height. Stool near tub or vanity. Mirror centered above sink. Art on dry walls only.", minSqft: 40, zones: ["vanity","bath"] },
  "Great Room":   { essential: ["sofa","table"], recommended: ["chair","rug","light","art","accent","stool"], layout: "Define zones with rugs — conversation area anchored by sofa, dining zone behind, reading nook by windows. 48\" walkways between zones. Consistent style across zones.", minSqft: 250, zones: ["conversation","dining","entry","reading"] },
};

export const ROOMS = ["Living Room","Dining Room","Kitchen","Bedroom","Office","Outdoor","Bathroom","Great Room"];
export const VIBES = ["Warm Modern","Minimalist","Bohemian","Scandinavian","Mid-Century","Luxury","Coastal","Japandi","Industrial","Art Deco","Rustic","Glam","Transitional","Organic Modern"];
export const fmt = (n) => "$" + n.toLocaleString();
export const budgets = [["all","All Budgets"],["u500","Under $500"],["u1k","Under $1K"],["1k5k","$1K-$5K"],["5k10k","$5K-$10K"],["10k25k","$10K-$25K"],["25k","$25K+"]];


/* ─── FURNITURE DIMENSIONS (feet) ─── */
export const FURN_DIMS = {
  sofa:   { w: 7, d: 3, clearF: 2.5, clearS: 0.5, label: "Sofa" },
  bed:    { w: 5.5, d: 7, clearF: 3, clearS: 1.5, label: "Bed" },
  table:  { w: 4.5, d: 2.5, clearF: 3, clearS: 2, label: "Table" },
  chair:  { w: 2.2, d: 2.2, clearF: 1.5, clearS: 0.5, label: "Chair" },
  stool:  { w: 1.3, d: 1.3, clearF: 1.5, clearS: 0.5, label: "Stool" },
  light:  { w: 1.2, d: 1.2, clearF: 0, clearS: 0, label: "Light" },
  rug:    { w: 8, d: 5, clearF: 0, clearS: 0, label: "Rug" },
  art:    { w: 2.5, d: 0.3, clearF: 0, clearS: 0, label: "Art" },
  accent: { w: 1.8, d: 1.8, clearF: 0.5, clearS: 0.5, label: "Accent" },
};

/* ─── COLOR & MATERIAL PALETTES ─── */
export const STYLE_PALETTES = {
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
export const ROOM_NEEDS = {
  "Living Room":  { essential: ["sofa"], recommended: ["table","chair","rug","light","art","accent"], layout: "Anchor with a sofa facing the focal wall. Coffee table 14-18\" from sofa. Accent chairs flanking at 45°. Rug grounding the conversation zone. Lighting at varying heights.", minSqft: 120, zones: ["conversation","reading nook","entry"] },
  "Dining Room":  { essential: ["table"], recommended: ["chair","light","rug","art","accent"], layout: "Table centered with 36\" clearance on all sides for chair pullback. Chandelier 30-34\" above table. Rug extends 24\" beyond chairs. Buffet against longest wall.", minSqft: 100, zones: ["dining","buffet"] },
  "Kitchen":      { essential: ["stool"], recommended: ["light","table","accent"], layout: "Counter stools spaced 26-28\" center-to-center. Pendant lights 30-36\" above island. Open 48\" walkway between island and cabinetry.", minSqft: 80, zones: ["island seating","prep zone"] },
  "Bedroom":      { essential: ["accent"], recommended: ["light","chair","rug","art","table","accent"], layout: "Bed centered on focal wall. Nightstands flanking with 24\" clearance to walls. Bench at foot with 24\" walkway. Rug extending 18\" on each side. Reading chair in corner.", minSqft: 100, zones: ["sleep","dressing","reading"] },
  "Office":       { essential: ["table","chair"], recommended: ["light","accent","art","rug"], layout: "Desk facing window or perpendicular to natural light. Task chair with 36\" rollback space. Bookshelf on side wall. Art at eye level on focal wall.", minSqft: 80, zones: ["work","storage","meeting"] },
  "Outdoor":      { essential: ["chair"], recommended: ["table","sofa","light","accent"], layout: "Lounge zone with weather-resistant seating. Dining set in covered area. 36\" pathways between zones. Lighting along perimeter.", minSqft: 100, zones: ["lounge","dining","pathway"] },
  "Bathroom":     { essential: ["light"], recommended: ["accent","art"], layout: "Vanity lighting at face height. Stool near tub or vanity. Mirror centered above sink. Art on dry walls only.", minSqft: 40, zones: ["vanity","bath"] },
  "Great Room":   { essential: ["sofa","table"], recommended: ["chair","rug","light","art","accent","stool"], layout: "Define zones with rugs — conversation area anchored by sofa, dining zone behind, reading nook by windows. 48\" walkways between zones. Consistent style across zones.", minSqft: 250, zones: ["conversation","dining","entry","reading"] },
};

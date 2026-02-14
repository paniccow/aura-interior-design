import { useState, useRef, useEffect, useCallback } from "react";
import { DB } from "./data.js";

/* AURA v27 — Interactive room editor, multi-project, enhanced viz prompts, 1000 products */
/* API key is stored as Vercel env var — NEVER exposed to client */

/* ─── AI ENGINE ─── */
/* /api/ai (OpenRouter proxy) — GPT-4o-mini for chat/vision, Gemini for images */

const AI_API = "/api/ai";

async function aiChat(messages) {
  // Strategy 1: OpenRouter via our secure proxy (GPT-4o-mini — fast, reliable, cheap)
  try {
    const resp = await Promise.race([
      fetch(AI_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", messages })
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000))
    ]);
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.length > 5) { console.log("AI chat: OpenRouter success"); return text; }
    } else {
      const err = await resp.text();
      console.log("AI chat: OpenRouter " + resp.status, err.slice(0, 200));
    }
  } catch (err) { console.log("AI chat: OpenRouter error:", err?.message); }

  return null;
}

/* Vision analysis — OpenRouter primary, Pollinations fallback */
async function analyzeImage(base64Data, mimeType, prompt) {
  const dataUrl = "data:" + mimeType + ";base64," + base64Data;

  // Strategy 1: OpenRouter GPT-4o-mini vision
  try {
    const resp = await Promise.race([
      fetch(AI_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          messages: [{ role: "user", content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: prompt }
          ]}]
        })
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 45000))
    ]);
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.length > 20) { console.log("Vision: OpenRouter success"); return text; }
    }
  } catch (err) { console.log("Vision: OpenRouter error:", err?.message); }

  return null;
}

/* Image generation — OpenRouter via secure proxy. Optional referenceImage (data URL) for room matching. productImageUrls = array of product photo URLs for AI reference. */
async function generateAIImage(prompt, referenceImage, productImageUrls) {
  try {
    const resp = await Promise.race([
      fetch(AI_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "image", prompt, referenceImage: referenceImage || null, productImageUrls: productImageUrls || [] })
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 120000))
    ]);

    if (resp.ok) {
      const data = await resp.json();
      const msg = data?.choices?.[0]?.message;

      // Format 1: images array (Gemini returns: images[{type:"image_url", image_url:{url:"data:..."}}])
      if (msg?.images?.length > 0) {
        const imgData = msg.images[0];
        const src = typeof imgData === "string"
          ? (imgData.startsWith("data:") ? imgData : "data:image/png;base64," + imgData)
          : imgData?.image_url?.url || imgData?.url || imgData?.b64_json;
        if (src) { console.log("Image gen: success (images array)"); return src.startsWith("data:") ? src : "data:image/png;base64," + src; }
      }

      // Format 2: content as array with image blocks
      const content = msg?.content;
      if (Array.isArray(content)) {
        const imgBlock = content.find(b => b.type === "image_url" || b.type === "image");
        if (imgBlock) {
          const imgUrl = imgBlock.image_url?.url || imgBlock.url;
          if (imgUrl) { console.log("Image gen: success (content array)"); return imgUrl; }
        }
      }

      // Format 3: content as data URL string
      if (typeof content === "string" && content.startsWith("data:image")) {
        console.log("Image gen: success (data URL string)");
        return content;
      }

      console.log("Image gen: unexpected response format", JSON.stringify(data).slice(0, 200));
    } else if (resp.status === 402) {
      const errData = await resp.json().catch(() => ({}));
      console.log("Image gen: credits required —", errData.message || "add credits at openrouter.ai");
      // Return special string so generateViz can show the right error
      return "__CREDITS_REQUIRED__";
    } else {
      console.log("Image gen: error " + resp.status);
    }
  } catch (err) { console.log("Image gen: error:", err?.message); }

  return null;
}

const ROOMS = ["Living Room","Dining Room","Kitchen","Bedroom","Office","Outdoor","Bathroom","Great Room"];
const VIBES = ["Warm Modern","Minimalist","Bohemian","Scandinavian","Mid-Century","Luxury","Coastal","Japandi","Industrial","Art Deco","Rustic","Glam","Transitional","Organic Modern"];
const fmt = (n) => "$" + n.toLocaleString();
const budgets = [["all","All Budgets"],["u500","Under $500"],["u1k","Under $1K"],["1k5k","$1K-$5K"],["5k10k","$5K-$10K"],["10k25k","$10K-$25K"],["25k","$25K+"]];

/* ─── FURNITURE DIMENSIONS (feet) ─── */
const FURN_DIMS = {
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

/* ─── SMART PER-PRODUCT DIMENSION ESTIMATION ─── */
function getProductDims(product) {
  const name = (product.n || "").toLowerCase();
  const cat = product.c;
  const baseDims = FURN_DIMS[cat] || FURN_DIMS.accent;
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
    let w = 7, d = 3, label = "Sofa", shape = "rect";
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
    let w = 4.5, d = 2.5, label = "Table", shape = "rect";
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
    let w = 2.2, d = 2.2, label = "Chair", shape = "rect";
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
    let w = 1.4, d = 1.4, label = "Stool", shape = "round";
    if (/counter/i.test(name)) { label = "Counter Stool"; }
    else if (/bar/i.test(name)) { label = "Bar Stool"; }
    else if (/backless/i.test(name)) { w = 1.2; d = 1.2; label = "Backless Stool"; }
    if (/square|rectangular/i.test(name)) { shape = "rect"; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── LIGHT ───
  if (cat === "light") {
    let w = 1.2, d = 1.2, label = "Light", shape = "round";
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
    let w = 8, d = 5, label = "Rug", shape = "rect";
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
    let w = 2.5, d = 0.3, label = "Art", shape = "rect";
    if (/mirror/i.test(name)) { w = 2.5; d = 0.3; label = "Mirror"; if (/round/i.test(name)) shape = "round"; }
    else if (/large|oversized/i.test(name)) { w = 4; }
    else if (/small|mini/i.test(name)) { w = 1.5; }
    return { ...baseDims, w, d, label, shape };
  }

  // ─── ACCENT ───
  if (cat === "accent") {
    let w = 1.8, d = 1.8, label = "Accent", shape = "rect";
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
  return { ...baseDims, shape: "rect" };
}

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
  const margin = 2 * scale; // 2ft margin from walls

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

  // Define zones based on room type for smarter placement
  const needs = ROOM_NEEDS[roomType] || ROOM_NEEDS["Living Room"];
  const zones = {};
  const zoneDefs = {
    "Living Room": {
      conversation: { x: canvasW * 0.15, y: canvasH * 0.35, w: canvasW * 0.7, h: canvasH * 0.55 },
      "reading nook": { x: margin, y: margin, w: canvasW * 0.3, h: canvasH * 0.3 },
      entry: { x: canvasW * 0.6, y: canvasH * 0.8, w: canvasW * 0.35, h: canvasH * 0.18 },
    },
    "Dining Room": {
      dining: { x: canvasW * 0.15, y: canvasH * 0.2, w: canvasW * 0.7, h: canvasH * 0.6 },
      buffet: { x: margin, y: canvasH * 0.1, w: canvasW * 0.2, h: canvasH * 0.4 },
    },
    "Bedroom": {
      sleep: { x: canvasW * 0.2, y: canvasH * 0.5, w: canvasW * 0.6, h: canvasH * 0.4 },
      dressing: { x: canvasW * 0.7, y: margin, w: canvasW * 0.25, h: canvasH * 0.4 },
      reading: { x: margin, y: margin, w: canvasW * 0.25, h: canvasH * 0.35 },
    },
    "Office": {
      work: { x: canvasW * 0.2, y: margin * 2, w: canvasW * 0.6, h: canvasH * 0.4 },
      storage: { x: margin, y: canvasH * 0.5, w: canvasW * 0.25, h: canvasH * 0.4 },
    },
    "Great Room": {
      conversation: { x: canvasW * 0.05, y: canvasH * 0.45, w: canvasW * 0.55, h: canvasH * 0.5 },
      dining: { x: canvasW * 0.55, y: canvasH * 0.15, w: canvasW * 0.4, h: canvasH * 0.45 },
      entry: { x: canvasW * 0.3, y: canvasH * 0.85, w: canvasW * 0.4, h: canvasH * 0.12 },
      reading: { x: margin, y: margin, w: canvasW * 0.3, h: canvasH * 0.35 },
    },
  };
  const activeZones = zoneDefs[roomType] || zoneDefs["Living Room"];

  // Place items using zone-based positioning
  const placed = [];
  const occupied = [];
  const catColors = { sofa: "#8B6840", bed: "#7B4870", table: "#4B7B50", chair: "#5B4B9B", stool: "#8B6B35", light: "#B8901A", rug: "#3878A0", art: "#985050", accent: "#607060" };

  const collides = (x, y, w, h) => {
    for (const o of occupied) {
      if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) return true;
    }
    return false;
  };

  // Clamp coordinates to stay within room bounds
  const clamp = (val, min, max) => Math.max(min, Math.min(val, max));

  const placeAt = (item, x, y, w, h, rotation) => {
    // Ensure within bounds
    x = clamp(x, 2, canvasW - w - 2);
    y = clamp(y, 2, canvasH - h - 2);
    const dims = getProductDims(item);
    placed.push({ item, x, y, w, h, rotation: rotation || 0, color: catColors[item.c] || "#6B685B", shape: dims.shape || "rect" });
    if (!["rug","art","light"].includes(item.c)) occupied.push({ x, y, w, h });
  };

  // Sort items for placement priority — anchor pieces first
  const sortOrder = { rug: 0, bed: 1, sofa: 2, table: 3, chair: 4, stool: 5, accent: 6, light: 7, art: 8 };
  const sortedItems = [...items].sort((a, b) => (sortOrder[a.c] ?? 5) - (sortOrder[b.c] ?? 5));
  const margin2 = 1.5 * scale;

  // Track anchor positions for relational placement
  let sofaCenter = null;
  let tableCenter = null;
  let sofaW = 0;

  // Helper: find best non-colliding position near a target
  const findNear = (targetX, targetY, w, h, radius) => {
    const step = scale * 1.5; // Larger steps to keep search fast
    const r = Math.min(radius || scale * 4, scale * 8); // Cap radius to prevent huge searches
    let bestDist = Infinity, bestPos = null;
    let iterations = 0;
    const maxIter = 400; // Hard cap on iterations
    for (let dy = -r; dy <= r && iterations < maxIter; dy += step) {
      for (let dx = -r; dx <= r && iterations < maxIter; dx += step) {
        iterations++;
        const nx = targetX + dx;
        const ny = targetY + dy;
        if (nx < 2 || ny < 2 || nx + w > canvasW - 2 || ny + h > canvasH - 2) continue;
        if (!collides(nx, ny, w, h)) {
          const dist = dx * dx + dy * dy; // skip sqrt for speed
          if (dist < bestDist) { bestDist = dist; bestPos = { x: nx, y: ny }; }
        }
      }
    }
    return bestPos;
  };

  for (const item of sortedItems) {
    const dims = getProductDims(item);
    const w = dims.w * scale;
    const h = dims.d * scale;
    const sofaCount = placed.filter(p => p.item.c === "sofa").length;
    const chairCount = placed.filter(p => p.item.c === "chair").length;
    const artCount = placed.filter(p => p.item.c === "art").length;
    const lightCount = placed.filter(p => p.item.c === "light").length;

    if (item.c === "rug") {
      // Rug: centered in the main conversation/dining zone
      const zone = activeZones.conversation || activeZones.dining || { x: canvasW * 0.15, y: canvasH * 0.3, w: canvasW * 0.7, h: canvasH * 0.5 };
      const rx = zone.x + (zone.w - w) / 2;
      const ry = zone.y + (zone.h - h) / 2;
      placeAt(item, rx, ry, w, h);
      continue;
    }

    if (item.c === "bed") {
      // Bed: centered against back wall (top), headboard against wall
      const zone = activeZones.sleep || { x: canvasW * 0.2, y: margin, w: canvasW * 0.6, h: canvasH * 0.5 };
      const bx = zone.x + (zone.w - w) / 2;
      const by = margin + 0.5 * scale; // headboard against top wall
      if (!collides(bx, by, w, h)) { placeAt(item, bx, by, w, h); continue; }
      const pos = findNear(bx, by, w, h, scale * 4);
      if (pos) { placeAt(item, pos.x, pos.y, w, h); continue; }
    }

    if (item.c === "sofa") {
      let sx, sy;
      if (sofaCount === 0) {
        // Primary sofa: against back wall (bottom), centered in conversation zone
        const zone = activeZones.conversation || { x: canvasW * 0.15, y: canvasH * 0.4, w: canvasW * 0.7, h: canvasH * 0.5 };
        sx = zone.x + (zone.w - w) / 2;
        sy = zone.y + zone.h - h; // against bottom of zone
        sofaCenter = { x: sx + w / 2, y: sy + h / 2 };
        sofaW = w;
      } else {
        // Second sofa: facing the first across the conversation zone
        const zone = activeZones.conversation || { x: canvasW * 0.15, y: canvasH * 0.4, w: canvasW * 0.7, h: canvasH * 0.5 };
        sx = zone.x + (zone.w - w) / 2;
        sy = zone.y; // against top of zone, facing first sofa
      }
      if (!collides(sx, sy, w, h)) { placeAt(item, sx, sy, w, h); if (sofaCount === 0) { sofaCenter = { x: sx + w / 2, y: sy + h / 2 }; sofaW = w; } continue; }
      // Fallback: try finding nearby
      const pos = findNear(sx, sy, w, h);
      if (pos) { placeAt(item, pos.x, pos.y, w, h); if (sofaCount === 0) { sofaCenter = { x: pos.x + w / 2, y: pos.y + h / 2 }; sofaW = w; } continue; }
    }

    if (item.c === "table") {
      let tx, ty;
      if (roomType === "Dining Room" || roomType === "Kitchen") {
        // Dining: center of dining zone
        const zone = activeZones.dining || { x: canvasW * 0.15, y: canvasH * 0.2, w: canvasW * 0.7, h: canvasH * 0.6 };
        tx = zone.x + (zone.w - w) / 2;
        ty = zone.y + (zone.h - h) / 2;
      } else if (roomType === "Great Room" && placed.filter(p => p.item.c === "table").length > 0) {
        // Second table in Great Room goes to dining zone
        const zone = activeZones.dining || { x: canvasW * 0.55, y: canvasH * 0.15, w: canvasW * 0.4, h: canvasH * 0.45 };
        tx = zone.x + (zone.w - w) / 2;
        ty = zone.y + (zone.h - h) / 2;
      } else if (sofaCenter) {
        // Coffee table: 14-18" in front of sofa (toward room center)
        tx = sofaCenter.x - w / 2;
        ty = sofaCenter.y - (dims.d * scale) / 2 - 1.3 * scale - h; // 1.3ft (~16") gap
      } else {
        tx = (canvasW - w) / 2;
        ty = (canvasH - h) / 2;
      }
      tableCenter = { x: tx + w / 2, y: ty + h / 2 };
      if (!collides(tx, ty, w, h)) { placeAt(item, tx, ty, w, h); continue; }
      const pos = findNear(tx, ty, w, h);
      if (pos) { placeAt(item, pos.x, pos.y, w, h); tableCenter = { x: pos.x + w / 2, y: pos.y + h / 2 }; continue; }
    }

    if (item.c === "chair") {
      if (roomType === "Dining Room" && tableCenter) {
        // Dining chairs: evenly spaced around table with proper clearance
        const tableW = (FURN_DIMS.table.w * scale);
        const tableH = (FURN_DIMS.table.d * scale);
        const gap = 0.3 * scale; // small gap between chair and table edge
        const positions = [
          { x: tableCenter.x - tableW / 2 - w - gap, y: tableCenter.y - h / 2 },          // left 1
          { x: tableCenter.x + tableW / 2 + gap, y: tableCenter.y - h / 2 },               // right 1
          { x: tableCenter.x - w / 2, y: tableCenter.y - tableH / 2 - h - gap },           // top center
          { x: tableCenter.x - w / 2, y: tableCenter.y + tableH / 2 + gap },               // bottom center
          { x: tableCenter.x - tableW / 2 - w - gap, y: tableCenter.y - h / 2 - h - gap }, // left 2
          { x: tableCenter.x + tableW / 2 + gap, y: tableCenter.y - h / 2 - h - gap },     // right 2
          { x: tableCenter.x - w - gap, y: tableCenter.y - tableH / 2 - h - gap },         // top left
          { x: tableCenter.x + gap, y: tableCenter.y + tableH / 2 + gap },                 // bottom right
        ];
        const pos = positions[chairCount % positions.length];
        if (pos && !collides(pos.x, pos.y, w, h)) { placeAt(item, pos.x, pos.y, w, h); continue; }
        // Try finding near the intended position
        if (pos) { const near = findNear(pos.x, pos.y, w, h, scale * 3); if (near) { placeAt(item, near.x, near.y, w, h); continue; } }
      } else if (sofaCenter) {
        // Accent chairs: flanking the sofa at conversational angles
        const offsets = [
          { x: sofaCenter.x - sofaW / 2 - w - 1.5 * scale, y: sofaCenter.y - h * 0.8 },  // left of sofa, angled in
          { x: sofaCenter.x + sofaW / 2 + 1.5 * scale, y: sofaCenter.y - h * 0.8 },       // right of sofa, angled in
          { x: sofaCenter.x - sofaW / 2 - w - 1.5 * scale, y: sofaCenter.y - h * 2.5 },   // far left
          { x: sofaCenter.x + sofaW / 2 + 1.5 * scale, y: sofaCenter.y - h * 2.5 },       // far right
        ];
        const off = offsets[chairCount % offsets.length];
        if (off.x > 2 && off.x + w < canvasW - 2 && off.y > 2 && off.y + h < canvasH - 2 && !collides(off.x, off.y, w, h)) {
          placeAt(item, off.x, off.y, w, h); continue;
        }
        const near = findNear(off.x, off.y, w, h, scale * 4);
        if (near) { placeAt(item, near.x, near.y, w, h); continue; }
      }
    }

    if (item.c === "stool") {
      // Stools: along the top wall (kitchen island area) with even spacing
      const stoolCount = placed.filter(p => p.item.c === "stool").length;
      const totalStools = sortedItems.filter(p => p.c === "stool").length;
      const spacing = Math.min(w + 1.8 * scale, (canvasW - 4 * margin2) / totalStools);
      const startX = (canvasW - totalStools * spacing) / 2;
      const stoolX = startX + stoolCount * spacing;
      const stoolY = margin2 + 0.5 * scale;
      if (stoolX + w < canvasW - margin2 && !collides(stoolX, stoolY, w, h)) { placeAt(item, stoolX, stoolY, w, h); continue; }
    }

    if (item.c === "art") {
      // Art: along the top wall (focal wall) with even spacing
      const totalArtWidth = (artCount + 1) * (w + 2 * scale);
      const startX = (canvasW - totalArtWidth) / 2;
      const ax = startX + artCount * (w + 2 * scale);
      placeAt(item, Math.max(margin2, Math.min(ax, canvasW - w - margin2)), margin2 * 0.3, w, h);
      continue;
    }

    if (item.c === "light") {
      // Lights: distributed based on position — near windows, over table, flanking sofa
      let lx, ly;
      if (lightCount === 0 && tableCenter) {
        // First light: above the table (pendant/chandelier position)
        lx = tableCenter.x - w / 2;
        ly = tableCenter.y - h - 0.5 * scale;
      } else if (lightCount === 1 && sofaCenter) {
        // Second light: beside the sofa (floor lamp)
        lx = sofaCenter.x + (sofaW || 7 * scale) / 2 + 1 * scale;
        ly = sofaCenter.y - h / 2;
      } else {
        // Remaining: along walls/corners (sconces/floor lamps)
        const corners = [
          { x: margin2, y: margin2 },
          { x: canvasW - w - margin2, y: margin2 },
          { x: margin2, y: canvasH - h - margin2 },
          { x: canvasW - w - margin2, y: canvasH - h - margin2 },
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
        ax = sofaCenter.x + (sofaW || 7 * scale) / 2 + 0.5 * scale;
        ay = sofaCenter.y - h / 2;
      } else if (accentCount === 1 && sofaCenter) {
        // Second: other side of sofa
        ax = sofaCenter.x - (sofaW || 7 * scale) / 2 - w - 0.5 * scale;
        ay = sofaCenter.y - h / 2;
      } else {
        // Along walls with proper spacing
        const wallPositions = [
          { x: margin2, y: canvasH * 0.4 },
          { x: canvasW - w - margin2, y: canvasH * 0.4 },
          { x: canvasW * 0.3, y: margin2 },
          { x: canvasW * 0.7 - w, y: margin2 },
        ];
        const wp = wallPositions[accentCount % wallPositions.length];
        ax = wp.x; ay = wp.y;
      }
      if (ax > 0 && ax + w < canvasW && ay > 0 && ay + h < canvasH && !collides(ax, ay, w, h)) {
        placeAt(item, ax, ay, w, h); continue;
      }
      // Fallback: find nearest non-colliding position
      const near = findNear(ax || canvasW / 2, ay || canvasH / 2, w, h, scale * 5);
      if (near) { placeAt(item, near.x, near.y, w, h); continue; }
    }

    // General fallback — place at first available grid position
    let didPlace = false;
    const gridStep = scale * 2;
    for (let gy = margin2; gy < canvasH - h - margin2 && !didPlace; gy += gridStep) {
      for (let gx = margin2; gx < canvasW - w - margin2 && !didPlace; gx += gridStep) {
        if (!collides(gx, gy, w, h)) {
          placeAt(item, gx, gy, w, h);
          didPlace = true;
        }
      }
    }
    if (!didPlace) {
      // Last resort: place with slight random offset (allows overlap)
      placeAt(item, margin2 + Math.random() * Math.max(1, canvasW - w - 2 * margin2), margin2 + Math.random() * Math.max(1, canvasH - h - 2 * margin2), w, h);
    }
  }

  return { placed, canvasW, canvasH, roomW: Math.round(roomW * 10) / 10, roomH: Math.round(roomH * 10) / 10, windows, doors, scale };
}

/* ─── COMPONENTS ─── */
const CAT_COLORS = {
  sofa: { bg: "linear-gradient(145deg, #EBE4D8, #DDD4C6)", accent: "#8B7355" },
  bed: { bg: "linear-gradient(145deg, #E8E0EB, #D8CCD8)", accent: "#7B5575" },
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
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: small ? 24 : 32, marginBottom: 8, opacity: 0.25 }}>{{"sofa":"\uD83D\uDECB","bed":"\uD83D\uDECF","table":"\uD83E\uDE91","chair":"\uD83E\uDE91","stool":"\uD83E\uDE91","light":"\uD83D\uDCA1","rug":"\uD83E\uDDF6","art":"\uD83D\uDDBC","accent":"\u2728"}[p.c] || "\uD83C\uDFE0"}</div>
              <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: colors.accent, fontWeight: 700, opacity: 0.5 }}>{p.c}</div>
              <div style={{ fontFamily: "Georgia,serif", fontSize: small ? 12 : 14, fontWeight: 400, color: colors.accent, marginTop: 4, lineHeight: 1.3 }}>{p.r}</div>
              <div style={{ fontSize: 9, color: "#C17550", marginTop: 6, fontWeight: 600 }}>View on site</div>
            </div>
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
              <span style={{ fontSize: 11, color: "#C17550", fontWeight: 600 }}>{"Shop →"}</span>
            </div>
          )}
        </div>
      </a>
    </div>
  );
}

function AuraLogo({ size = 28 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width={size} height={size} style={{ display: "block" }}>
      <g><g transform="translate(.000001 0)"><g transform="translate(.000001 0)">
        <path d="M60.700623,62.600518Q24.23661,112.680222,182.158369,70.776796l-.948888,75.630578L76.532624,115.797762l85.699083-61.373525-11.386664,97.093311" transform="matrix(-1.55 0 0 1.742281 307.04693-35.087619)" fill="none" stroke="#1A1815" strokeWidth="6"/>
      </g></g></g>
    </svg>
  );
}

function Pill({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "8px 16px", fontSize: 12, fontWeight: active ? 600 : 400, background: active ? "#1A1815" : "#FDFCFA", color: active ? "#fff" : "#7A6B5B", border: active ? "none" : "1px solid #E8E0D8", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", whiteSpace: "nowrap" }}>
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

          {/* Furniture — architectural plan symbols */}
          {placed.map((p, i) => {
            const prodDims = getProductDims(p.item);
            const isRound = prodDims.shape === "round";
            const isOval = prodDims.shape === "oval";
            const isL = prodDims.shape === "L";
            const isBed = prodDims.shape === "bed" || p.item.c === "bed";
            const isRug = p.item.c === "rug";
            const cat = p.item.c;
            const c = p.color;
            const dimLabel = Math.round(prodDims.w * 10) / 10 + "' × " + Math.round(prodDims.d * 10) / 10 + "'";
            const labelFs = Math.min(10, Math.max(6, p.w / 7));
            const nameFs = Math.min(7, Math.max(5, p.w / 9));
            const dimFs = Math.min(6.5, Math.max(4.5, p.w / 10));
            const truncName = (p.item.n || "").length > 18 ? (p.item.n || "").slice(0, 16) + "..." : p.item.n;

            return (
              <g key={i} transform={`translate(${p.x},${p.y})`}>
                {/* ─── RUG ─── */}
                {isRug && <>
                  <rect width={p.w} height={p.h} fill={c + "08"} stroke={c} strokeWidth="1" strokeDasharray="6,3" rx="4" />
                  <rect x={p.w * 0.05} y={p.h * 0.08} width={p.w * 0.9} height={p.h * 0.84} fill="none" stroke={c + "40"} strokeWidth="0.5" strokeDasharray="3,3" rx="2" />
                  <text x={p.w / 2} y={p.h / 2 + 2} textAnchor="middle" fontSize={labelFs} fill={c + "AA"} fontWeight="600" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Rug"}</text>
                  <text x={p.w / 2} y={p.h / 2 + 12} textAnchor="middle" fontSize={dimFs} fill={c + "77"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── BED — headboard + pillows + mattress ─── */}
                {isBed && !isRug && <>
                  {/* Mattress */}
                  <rect width={p.w} height={p.h} fill={c + "15"} stroke={c} strokeWidth="2" rx="4" />
                  {/* Headboard */}
                  <rect x={-2} y={-2} width={p.w + 4} height={p.h * 0.08} fill={c} rx="3" opacity="0.7" />
                  {/* Pillows */}
                  <rect x={p.w * 0.08} y={p.h * 0.1} width={p.w * 0.38} height={p.h * 0.1} fill={c + "30"} stroke={c + "60"} strokeWidth="0.8" rx="4" />
                  <rect x={p.w * 0.54} y={p.h * 0.1} width={p.w * 0.38} height={p.h * 0.1} fill={c + "30"} stroke={c + "60"} strokeWidth="0.8" rx="4" />
                  {/* Blanket fold line */}
                  <line x1={p.w * 0.06} y1={p.h * 0.55} x2={p.w * 0.94} y2={p.h * 0.55} stroke={c + "40"} strokeWidth="0.8" />
                  <text x={p.w / 2} y={p.h * 0.4} textAnchor="middle" fontSize={labelFs} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Bed"}</text>
                  <text x={p.w / 2} y={p.h * 0.4 + 11} textAnchor="middle" fontSize={nameFs} fill={c + "AA"} fontFamily="Helvetica Neue,sans-serif">{truncName}</text>
                  <text x={p.w / 2} y={p.h * 0.4 + 21} textAnchor="middle" fontSize={dimFs} fill={c + "77"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── SOFA — seat cushions + back + arms ─── */}
                {cat === "sofa" && !isRug && !isBed && !isL && <>
                  {/* Main body */}
                  <rect width={p.w} height={p.h} fill={c + "18"} stroke={c} strokeWidth="2" rx="5" />
                  {/* Back cushion */}
                  <rect x={2} y={p.h * 0.7} width={p.w - 4} height={p.h * 0.28} fill={c + "25"} stroke={c + "50"} strokeWidth="0.8" rx="4" />
                  {/* Seat cushions */}
                  {p.w > 200 ? <>
                    <rect x={p.w * 0.06} y={p.h * 0.08} width={p.w * 0.28} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                    <rect x={p.w * 0.36} y={p.h * 0.08} width={p.w * 0.28} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                    <rect x={p.w * 0.66} y={p.h * 0.08} width={p.w * 0.28} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                  </> : <>
                    <rect x={p.w * 0.06} y={p.h * 0.08} width={p.w * 0.42} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                    <rect x={p.w * 0.52} y={p.h * 0.08} width={p.w * 0.42} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                  </>}
                  {/* Arms */}
                  <rect x={-2} y={p.h * 0.1} width={6} height={p.h * 0.8} fill={c + "30"} rx="3" />
                  <rect x={p.w - 4} y={p.h * 0.1} width={6} height={p.h * 0.8} fill={c + "30"} rx="3" />
                  <text x={p.w / 2} y={p.h / 2 - 4} textAnchor="middle" fontSize={labelFs} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Sofa"}</text>
                  <text x={p.w / 2} y={p.h / 2 + 7} textAnchor="middle" fontSize={dimFs} fill={c + "88"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── L-SHAPE SECTIONAL ─── */}
                {cat === "sofa" && isL && <>
                  <path d={`M4,0 L${p.w},0 L${p.w},${p.h * 0.45} L${p.w * 0.45},${p.h * 0.45} L${p.w * 0.45},${p.h} L0,${p.h} L0,4 Q0,0 4,0 Z`} fill={c + "18"} stroke={c} strokeWidth="2" />
                  {/* Back cushion - horizontal */}
                  <rect x={4} y={p.h * 0.72} width={p.w * 0.42} height={p.h * 0.25} fill={c + "20"} stroke={c + "40"} strokeWidth="0.5" rx="3" />
                  {/* Back cushion - vertical */}
                  <rect x={p.w * 0.58} y={4} width={p.w * 0.38} height={p.h * 0.38} fill={c + "20"} stroke={c + "40"} strokeWidth="0.5" rx="3" />
                  <text x={p.w * 0.35} y={p.h * 0.55} textAnchor="middle" fontSize={labelFs} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Sectional"}</text>
                  <text x={p.w * 0.35} y={p.h * 0.55 + 11} textAnchor="middle" fontSize={dimFs} fill={c + "88"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── TABLE — round/oval/rect with legs ─── */}
                {cat === "table" && !isRug && <>
                  {isRound ? <>
                    <ellipse cx={p.w / 2} cy={p.h / 2} rx={p.w / 2} ry={p.h / 2} fill={c + "15"} stroke={c} strokeWidth="2" />
                    <ellipse cx={p.w / 2} cy={p.h / 2} rx={p.w / 2 - 4} ry={p.h / 2 - 4} fill="none" stroke={c + "30"} strokeWidth="0.5" />
                  </> : isOval ? <>
                    <ellipse cx={p.w / 2} cy={p.h / 2} rx={p.w / 2} ry={p.h / 2} fill={c + "15"} stroke={c} strokeWidth="2" />
                  </> : <>
                    <rect width={p.w} height={p.h} fill={c + "15"} stroke={c} strokeWidth="2" rx="3" />
                    {/* Leg indicators */}
                    <circle cx={6} cy={6} r={2.5} fill={c + "40"} />
                    <circle cx={p.w - 6} cy={6} r={2.5} fill={c + "40"} />
                    <circle cx={6} cy={p.h - 6} r={2.5} fill={c + "40"} />
                    <circle cx={p.w - 6} cy={p.h - 6} r={2.5} fill={c + "40"} />
                  </>}
                  <text x={p.w / 2} y={p.h / 2 - 3} textAnchor="middle" fontSize={labelFs} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Table"}</text>
                  <text x={p.w / 2} y={p.h / 2 + 7} textAnchor="middle" fontSize={dimFs} fill={c + "88"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── CHAIR — seat + back ─── */}
                {cat === "chair" && <>
                  {isRound ? <>
                    <ellipse cx={p.w / 2} cy={p.h / 2} rx={p.w / 2} ry={p.h / 2} fill={c + "18"} stroke={c} strokeWidth="1.5" />
                    <ellipse cx={p.w / 2} cy={p.h / 2 - p.h * 0.08} rx={p.w * 0.38} ry={p.h * 0.3} fill={c + "12"} stroke={c + "30"} strokeWidth="0.5" />
                  </> : <>
                    <rect width={p.w} height={p.h} fill={c + "18"} stroke={c} strokeWidth="1.5" rx="4" />
                    {/* Seat pad */}
                    <rect x={p.w * 0.1} y={p.h * 0.1} width={p.w * 0.8} height={p.h * 0.55} fill={c + "12"} stroke={c + "25"} strokeWidth="0.5" rx="3" />
                    {/* Back */}
                    <rect x={p.w * 0.08} y={p.h * 0.68} width={p.w * 0.84} height={p.h * 0.26} fill={c + "22"} stroke={c + "40"} strokeWidth="0.5" rx="3" />
                  </>}
                  <text x={p.w / 2} y={p.h / 2 + 1} textAnchor="middle" fontSize={Math.min(labelFs, 8)} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Chair"}</text>
                </>}

                {/* ─── STOOL — small circle/rect ─── */}
                {cat === "stool" && <>
                  {isRound ? <>
                    <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2} fill={c + "20"} stroke={c} strokeWidth="1.5" />
                    <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2 - 4} fill={c + "10"} stroke={c + "30"} strokeWidth="0.5" />
                  </> : <>
                    <rect width={p.w} height={p.h} fill={c + "20"} stroke={c} strokeWidth="1.5" rx="4" />
                    <rect x={3} y={3} width={p.w - 6} height={p.h - 6} fill={c + "10"} stroke={c + "25"} strokeWidth="0.5" rx="3" />
                  </>}
                  <text x={p.w / 2} y={p.h / 2 + 3} textAnchor="middle" fontSize={Math.min(7, p.w / 5)} fill={c} fontWeight="600" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Stool"}</text>
                </>}

                {/* ─── LIGHT — circle with radial glow ─── */}
                {cat === "light" && <>
                  <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2 + 4} fill="#FFD70008" stroke="none" />
                  <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2} fill="#FFD70015" stroke="#D4A020" strokeWidth="1.5" />
                  <circle cx={p.w / 2} cy={p.h / 2} r={3} fill="#FFD70050" />
                  <text x={p.w / 2} y={p.h / 2 + Math.min(p.w, p.h) / 2 + 10} textAnchor="middle" fontSize={6} fill="#9B8B7B" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Light"}</text>
                </>}

                {/* ─── ART — frame on wall ─── */}
                {cat === "art" && <>
                  {isRound ? <>
                    <circle cx={p.w / 2} cy={p.h / 2 + 4} r={p.w / 2} fill={c + "12"} stroke={c} strokeWidth="1.5" />
                    <circle cx={p.w / 2} cy={p.h / 2 + 4} r={p.w / 2 - 3} fill={c + "08"} stroke={c + "40"} strokeWidth="0.5" />
                  </> : <>
                    <rect y={4} width={p.w} height={p.w * 0.65} fill={c + "12"} stroke={c} strokeWidth="1.5" rx="1" />
                    <rect x={3} y={7} width={p.w - 6} height={p.w * 0.65 - 6} fill={c + "06"} stroke={c + "30"} strokeWidth="0.3" />
                  </>}
                  <text x={p.w / 2} y={p.w * 0.65 + 14} textAnchor="middle" fontSize={5.5} fill={c + "99"} fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Art"}</text>
                </>}

                {/* ─── ACCENT — generic shape ─── */}
                {cat === "accent" && <>
                  {isRound ? <>
                    <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2} fill={c + "18"} stroke={c} strokeWidth="1.5" />
                  </> : <>
                    <rect width={p.w} height={p.h} fill={c + "18"} stroke={c} strokeWidth="1.5" rx="3" />
                  </>}
                  <text x={p.w / 2} y={p.h / 2 + 3} textAnchor="middle" fontSize={Math.min(7, p.w / 5)} fill={c} fontWeight="600" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Accent"}</text>
                </>}
              </g>
            );
          })}

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
  const [user, setUser] = useState(() => {
    try { const u = localStorage.getItem("aura_user"); return u ? JSON.parse(u) : null; } catch { return null; }
  });
  const [projects, setProjects] = useState(() => {
    try { const p = localStorage.getItem("aura_projects"); return p ? JSON.parse(p) : []; } catch { return []; }
  });
  const [msgs, setMsgs] = useState([{ role: "bot", text: "Welcome to AURA! I have **" + DB.length + " products** from premium brands including Restoration Hardware, West Elm, Article, Crate & Barrel, AllModern, Serena & Lily, Rejuvenation, McGee & Co, Shoppe Amber, and more.\n\n**Tell me about your space** — your room type, style preferences, and what you're looking for. I'll generate personalized mood boards based on our conversation.\n\n**Upload a room photo** above and I'll analyze your existing space to create layouts that actually work.\n\nOr ask me anything about design — I'll explain exactly why each piece works for your space!", recs: [] }]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState(() => {
    try { return localStorage.getItem("aura_room") || null; } catch { return null; }
  });
  const [vibe, setVibe] = useState(() => {
    try { return localStorage.getItem("aura_vibe") || null; } catch { return null; }
  });
  const [bud, setBud] = useState("all");
  const [sel, setSel] = useState(() => {
    try {
      const s = localStorage.getItem("aura_sel");
      if (!s) return new Map();
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length > 0 && !Array.isArray(parsed[0])) {
        return new Map(parsed.map(id => [id, 1]));
      }
      return new Map(parsed);
    } catch { return new Map(); }
  });
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
  const [roomW, setRoomW] = useState(""); // room width in feet
  const [roomL, setRoomL] = useState(""); // room length in feet
  const [cadLayout, setCadLayout] = useState(null);
  const [roomPhoto, setRoomPhoto] = useState(null);
  const [roomPhotoAnalysis, setRoomPhotoAnalysis] = useState(null);
  const [roomPhotoLoading, setRoomPhotoLoading] = useState(false);
  const [boardsGenHint, setBoardsGenHint] = useState(null);
  // Multi-project
  const [activeProjectId, setActiveProjectId] = useState(() => {
    try { const a = localStorage.getItem("aura_activeProject"); return a ? JSON.parse(a) : null; } catch { return null; }
  });
  const [editingProjectName, setEditingProjectName] = useState(null);
  const [designStep, _setDesignStep] = useState(0); // 0=setup, 1=chat, 2=review
  const setDesignStep = (step) => { _setDesignStep(step); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const chatEnd = useRef(null);
  const chatBoxRef = useRef(null);
  const vizAreaRef = useRef(null);
  // Homepage AI-generated images
  const [homeHeroImg, setHomeHeroImg] = useState(null);
  const [homeVizImg, setHomeVizImg] = useState(null);
  const homeImgRequested = useRef(false);
  const PAGE_SIZE = 40;

  // Generate AI images for homepage on first load
  useEffect(() => {
    if (pg !== "home" || homeImgRequested.current) return;
    homeImgRequested.current = true;
    // Check sessionStorage cache first
    const cachedHero = sessionStorage.getItem("aura_heroImg");
    const cachedViz = sessionStorage.getItem("aura_vizImg");
    if (cachedHero) { setHomeHeroImg(cachedHero); }
    if (cachedViz) { setHomeVizImg(cachedViz); }
    if (cachedHero && cachedViz) return;
    // Generate hero image
    if (!cachedHero) {
      generateAIImage("A photorealistic wide-angle interior design photograph of a stunning warm modern living room. Natural oak hardwood floors, warm white walls, floor-to-ceiling windows with sheer linen curtains letting in golden afternoon light. A large cream boucle sectional sofa with cognac leather throw pillows, a round walnut coffee table, a woven jute area rug, brass floor lamp, and a large abstract art piece on the wall. Architectural Digest quality, eye-level perspective, no text or watermarks. Ultra high resolution, cinematic lighting, warm tones.")
        .then(url => { if (url && url !== "__CREDITS_REQUIRED__") { setHomeHeroImg(url); try { sessionStorage.setItem("aura_heroImg", url); } catch {} } })
        .catch(() => {});
    }
    // Generate viz image
    if (!cachedViz) {
      generateAIImage("A photorealistic interior design photograph of a beautiful Japandi bedroom. Low platform bed with white linen bedding, light oak nightstands, paper pendant lamp, dried pampas grass in a ceramic vase, soft gray wool throw, minimalist wall art. Warm natural light from a large window, clean lines, organic textures. Architectural Digest quality, wide-angle, eye-level, no text or watermarks.")
        .then(url => { if (url && url !== "__CREDITS_REQUIRED__") { setHomeVizImg(url); try { sessionStorage.setItem("aura_vizImg", url); } catch {} } })
        .catch(() => {});
    }
  }, [pg]);

  // Persist user, projects, and selection to localStorage
  useEffect(() => {
    try { if (user) localStorage.setItem("aura_user", JSON.stringify(user)); else localStorage.removeItem("aura_user"); } catch {}
  }, [user]);
  useEffect(() => {
    try { localStorage.setItem("aura_projects", JSON.stringify(projects)); } catch {}
  }, [projects]);
  useEffect(() => {
    try { localStorage.setItem("aura_sel", JSON.stringify(Array.from(sel.entries()))); } catch {}
  }, [sel]);
  useEffect(() => {
    try { if (room) localStorage.setItem("aura_room", room); else localStorage.removeItem("aura_room"); } catch {}
  }, [room]);
  useEffect(() => {
    try { if (vibe) localStorage.setItem("aura_vibe", vibe); else localStorage.removeItem("aura_vibe"); } catch {}
  }, [vibe]);
  useEffect(() => {
    try { localStorage.setItem("aura_activeProject", JSON.stringify(activeProjectId)); } catch {}
  }, [activeProjectId]);

  // Auto-save active project every 8 seconds when state changes
  useEffect(() => {
    if (!activeProjectId) return;
    const timer = setTimeout(() => {
      setProjects(prev => {
        const existing = prev.find(p => p.id === activeProjectId);
        if (!existing) return prev;
        return prev.map(p => p.id === activeProjectId ? { ...snapshotProject(activeProjectId), name: p.name } : p);
      });
    }, 8000);
    return () => clearTimeout(timer);
  }, [sel, room, vibe, sqft, msgs, vizUrls, activeProjectId]);

  useEffect(() => {
    const h = () => setSc(window.scrollY > 40);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  useEffect(() => {
    if (chatBoxRef.current) {
      const el = chatBoxRef.current;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
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
      try {
        const items = DB.filter(p => sel.has(p.id));
        const expandedItems = items.flatMap(p => Array.from({ length: sel.get(p.id) || 1 }, (_, i) => ({ ...p, _qtyIdx: i })));
        const sq = parseInt(sqft) || (ROOM_NEEDS[room]?.minSqft || 200);
        const layout = generateCADLayout(expandedItems, sq, room, cadAnalysis);
        setCadLayout(layout);
      } catch (err) {
        console.error("CAD layout error:", err);
        setCadLayout(null);
      }
    } else {
      setCadLayout(null);
    }
  }, [sel, room, sqft, cadAnalysis, user]);

  const go = (p) => { setPg(p); window.scrollTo(0, 0); };
  const toggle = (id) => setSel((prev) => { const n = new Map(prev); n.has(id) ? n.delete(id) : n.set(id, 1); return n; });
  const setQty = (id, qty) => setSel((prev) => { const n = new Map(prev); if (qty <= 0) n.delete(id); else n.set(id, qty); return n; });
  const selItems = DB.filter((p) => sel.has(p.id));
  const selTotal = selItems.reduce((s, p) => s + p.p * (sel.get(p.id) || 1), 0);
  const selCount = Array.from(sel.values()).reduce((s, q) => s + q, 0);

  const addBoard = (boardIdx) => {
    if (!boards || !boards[boardIdx]) return;
    const newSel = new Map(sel);
    boards[boardIdx].items.forEach(p => { if (!newSel.has(p.id)) newSel.set(p.id, 1); });
    setSel(newSel);
  };

  // Analyze uploaded CAD/PDF for room dimensions (uses free Pollinations AI)
  const handleCad = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCadLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setCadFile({ name: file.name, data: ev.target.result, type: file.type });
      try {
        const base64 = ev.target.result.split(",")[1];
        const mimeType = file.type || "image/png";
        const text = await analyzeImage(base64, mimeType, "Analyze this floor plan/CAD drawing for interior design. Extract:\n1) Total square footage estimate\n2) Room dimensions (width x length)\n3) Number and location of windows\n4) Number and location of doors\n5) Built-in features\n6) Which wall is the focal wall\n7) Natural light direction\n8) Any structural constraints\n\nBe precise with measurements. Use bullet points.");
        if (text && text.length > 10) {
          setCadAnalysis(text);
          const sqftMatch = text.match(/(\d{2,5})\s*(?:sq|square|sf|ft)/i);
          if (sqftMatch) setSqft(sqftMatch[1]);
        }
      } catch (err) {
        console.log("CAD analysis error:", err);
      }
      setCadLoading(false);
    };
    reader.readAsDataURL(file);
  };

  // Handle room photo upload — AI analyzes the actual room (free Pollinations AI)
  const handleRoomPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRoomPhotoLoading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setRoomPhoto({ name: file.name, data: ev.target.result, type: file.type });
      try {
        const base64 = ev.target.result.split(",")[1];
        const mimeType = file.type || "image/jpeg";
        const text = await analyzeImage(base64, mimeType, "You are an expert interior designer analyzing a room photo. Provide a DETAILED analysis:\n\n1) Room type (living room, bedroom, etc.)\n2) Approximate dimensions (width x length in feet)\n3) Estimated square footage\n4) Wall colors and finishes\n5) Flooring type and color\n6) Windows: count, size, location\n7) Existing furniture: list each piece with location\n8) Lighting: natural light direction, existing fixtures\n9) Architectural features: crown molding, fireplace, built-ins, ceiling height\n10) Style assessment: current design style\n11) Focal wall identification\n12) Areas that feel empty or could benefit from furniture\n\nBe specific about positions and measurements.");
        if (text && text.length > 10) {
          setRoomPhotoAnalysis(text);
          const rtMatch = text.match(/room\s*type[:\s]*(living room|bedroom|dining room|kitchen|office|bathroom|great room|outdoor)/i);
          if (rtMatch && !room) setRoom(rtMatch[1].split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "));
          const sqftMatch = text.match(/(\d{2,5})\s*(?:sq|square|sf|ft)/i);
          if (sqftMatch && !sqft) setSqft(sqftMatch[1]);
          setMsgs((prev) => [...prev, {
            role: "bot",
            text: "**Room Photo Analyzed!** Here's what I see:\n\n" + text.slice(0, 600) + (text.length > 600 ? "..." : "") + "\n\nI'll use this for layouts and visualizations. Tell me what you'd like to do with this space!",
            recs: []
          }]);
        } else {
          // Vision not available — still save photo and give helpful response
          setMsgs((prev) => [...prev, { role: "bot", text: "**Room photo saved!** I can see you've uploaded a photo of your space. While AI image analysis is temporarily processing, go ahead and describe your room — tell me the room type, approximate size, and what style you're going for. I'll use your photo along with your description to create the perfect design!", recs: [] }]);
        }
      } catch (err) {
        console.log("Room photo analysis error:", err);
        setMsgs((prev) => [...prev, { role: "bot", text: "**Room photo saved!** Describe your space and I'll help design it using your photo as reference.", recs: [] }]);
      }
      setRoomPhotoLoading(false);
    };
    reader.readAsDataURL(file);
  };

  // Generate single room visualization — OpenRouter, concept card fallback
  const generateViz = async () => {
    if (selItems.length === 0) return;
    try {
      setVizSt("loading");
      setVizUrls([]);
      setVizErr("");
      setTimeout(() => { if (vizAreaRef.current) vizAreaRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, 100);

      const items = selItems;
      const roomName = room || "living room";
      const styleName = vibe || "modern luxury";
      const palette = STYLE_PALETTES[styleName] || STYLE_PALETTES["Warm Modern"];
      const roomSqft = sqft || (ROOM_NEEDS[room] || ROOM_NEEDS["Living Room"]).minSqft || 200;
      const roomWidth = roomW || (roomSqft ? String(Math.round(Math.sqrt(parseFloat(roomSqft) * 1.3))) : "");
      const roomLength = roomL || (roomSqft ? String(Math.round(parseFloat(roomSqft) / Math.sqrt(parseFloat(roomSqft) * 1.3))) : "");

      // ─── STEP 1: AI VISION ANALYSIS OF PRODUCT IMAGES ───
      // Use GPT-4o-mini to look at each product's actual photo and describe shape, color, material
      console.log("Viz Step 1: Analyzing " + items.slice(0, 8).length + " product images with AI vision...");
      const productImageUrls = items.slice(0, 8).map(item => item.img).filter(Boolean);

      let aiProductDescriptions = null;
      try {
        // Build vision message with all product images
        const visionContent = [];
        items.slice(0, 8).forEach((item, idx) => {
          if (item.img) {
            visionContent.push({ type: "image_url", image_url: { url: item.img } });
          }
          visionContent.push({ type: "text", text: "Product " + (idx + 1) + ": \"" + (item.n || "") + "\" by " + (item.r || "") + " (category: " + item.c + ", price: $" + item.p + ")" });
        });
        visionContent.push({ type: "text", text: "\nFor EACH product above, describe in this EXACT format (one per line):\nPRODUCT [number]: shape=[exact shape like round/oval/rectangular/L-shaped/curved], color=[exact colors you see], material=[exact materials], height=[estimated inches], width=[estimated inches], depth=[estimated inches], style=[2-3 word style description]\n\nBe extremely specific about shape — is a table ROUND or RECTANGULAR? Is a sofa STRAIGHT or L-SHAPED? What is the EXACT color — not just 'brown' but 'warm walnut brown' or 'light cream white'. What material — 'nubby boucle fabric' or 'smooth leather' or 'natural oak wood'." });

        const visionResp = await Promise.race([
          fetch(AI_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "chat",
              messages: [{ role: "user", content: visionContent }]
            })
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("vision timeout")), 20000))
        ]);
        if (visionResp.ok) {
          const visionData = await visionResp.json();
          const visionText = visionData?.choices?.[0]?.message?.content;
          if (visionText && visionText.length > 20) {
            aiProductDescriptions = visionText;
            console.log("Viz Step 1: AI vision analysis complete:\n" + visionText.slice(0, 500));
          }
        }
      } catch (err) { console.log("Viz Step 1: AI vision failed (using fallback):", err?.message); }

      // ─── STEP 2: BUILD PRODUCT SPECIFICATIONS ───
      // If AI vision worked, use its descriptions; otherwise fall back to keyword extraction
      const dims_cache = items.slice(0, 8).map(i => getProductDims(i));

      let productSpecs;
      if (aiProductDescriptions) {
        // Parse AI vision output and merge with known data
        productSpecs = items.slice(0, 8).map((item, idx) => {
          const dims = dims_cache[idx];
          const widthIn = Math.round(dims.w * 12);
          const depthIn = Math.round(dims.d * 12);
          // Try to find the AI's description for this product
          const regex = new RegExp("PRODUCT\\s*" + (idx + 1) + "\\s*:(.+)", "i");
          const match = aiProductDescriptions.match(regex);
          const aiDesc = match ? match[1].trim() : "";

          const qty = sel.get(item.id) || 1;
          let spec = (idx + 1) + ". " + (item.n || "Unknown") + " (by " + (item.r || "Unknown") + ")" + (qty > 1 ? " x" + qty : "");
          if (aiDesc) {
            spec += "\n   AI Analysis: " + aiDesc;
          }
          spec += "\n   Estimated footprint: " + widthIn + '"W x ' + depthIn + '"D (' + Math.round(dims.w * 10) / 10 + "ft x " + Math.round(dims.d * 10) / 10 + "ft)";
          spec += "\n   Category: " + item.c;
          if (qty > 1) spec += "\n   Quantity: " + qty + " (place " + qty + " of these in the room)";
          return spec;
        }).join("\n\n");
      } else {
        // Fallback: keyword extraction from product names
        const COLOR_WORDS = ["white","cream","ivory","beige","tan","sand","camel","cognac","brown","walnut","oak","teak","mahogany","espresso","charcoal","gray","grey","slate","black","navy","blue","green","sage","olive","emerald","teal","blush","pink","coral","rust","terracotta","gold","brass","bronze","silver","chrome","copper","natural","amber","honey","wheat","linen","oatmeal","mushroom","taupe","dune","alabaster","stone","cement","marble","onyx","haze","driftwood"];
        const MAT_WORDS = ["leather","velvet","boucle","bouclé","linen","cotton","wool","silk","jute","rattan","wicker","cane","marble","travertine","granite","concrete","wood","oak","walnut","teak","metal","iron","steel","brass","bronze","glass","ceramic","fabric","upholstered","performance","slipcovered","woven"];
        const extractKw = (text, words) => words.filter(w => (text || "").toLowerCase().includes(w.toLowerCase()));

        productSpecs = items.slice(0, 8).map((item, idx) => {
          const dims = dims_cache[idx];
          const fullText = (item.n || "") + " " + (item.pr || "");
          const colors = extractKw(fullText, COLOR_WORDS);
          const mats = extractKw(fullText, MAT_WORDS);
          const name = (item.n || "").toLowerCase();
          let shape = item.c;
          if (name.includes("round") || name.includes("circular")) shape = "round " + item.c;
          else if (name.includes("oval")) shape = "oval " + item.c;
          else if (name.includes("l-shaped") || name.includes("l shaped") || name.includes("sectional")) shape = "L-shaped " + item.c;
          else if (name.includes("u-shaped") || name.includes("u shaped")) shape = "U-shaped " + item.c;

          const qty = sel.get(item.id) || 1;
          let spec = (idx + 1) + ". " + (item.n || "Unknown") + " (by " + (item.r || "Unknown") + ")" + (qty > 1 ? " x" + qty : "");
          spec += "\n   Shape: " + shape;
          spec += "\n   Size: " + Math.round(dims.w * 12) + '"W x ' + Math.round(dims.d * 12) + '"D';
          if (colors.length > 0) spec += "\n   Color: " + colors.slice(0, 3).join(", ");
          if (mats.length > 0) spec += "\n   Material: " + mats.slice(0, 2).join(", ");
          if (qty > 1) spec += "\n   Quantity: " + qty + " (place " + qty + " of these in the room)";
          return spec;
        }).join("\n\n");
      }

      const colorStr = palette.colors.slice(0, 5).join(", ");
      const matStr = palette.materials.slice(0, 4).join(", ");
      const roomNeeds = ROOM_NEEDS[room] || ROOM_NEEDS["Living Room"];

      // Build room dimensions string
      let dimsStr = "";
      if (roomWidth && roomLength) {
        dimsStr = "\nROOM DIMENSIONS: " + roomWidth + " feet wide × " + roomLength + " feet long (" + roomSqft + " sq ft). Use these exact proportions for the room shape and scale all furniture placement accordingly.";
      } else if (roomSqft) {
        dimsStr = "\nROOM SIZE: approximately " + roomSqft + " square feet.";
      }

      // Build room context from uploaded photo analysis
      let roomContext = "";
      if (roomPhotoAnalysis) {
        const wallMatch = roomPhotoAnalysis.match(/wall[s]?\s*(?:color|paint|colour)?[:\s]*([^.\n,]{3,40})/i);
        const floorMatch = roomPhotoAnalysis.match(/floor(?:ing)?[:\s]*([^.\n,]{3,40})/i);
        const windowMatch = roomPhotoAnalysis.match(/(\d+)\s*window/i);
        const ceilingMatch = roomPhotoAnalysis.match(/ceiling[:\s]*([^.\n,]{3,30})/i);
        const archMatch = roomPhotoAnalysis.match(/(?:fireplace|built-in|crown molding|beam|arch|bay window)[^.\n]{0,30}/i);
        const doorMatch = roomPhotoAnalysis.match(/(\d+)\s*door/i);
        const parts = [];
        if (wallMatch) parts.push("walls: " + wallMatch[1].trim());
        if (floorMatch) parts.push("flooring: " + floorMatch[1].trim());
        if (windowMatch) parts.push(windowMatch[0]);
        if (doorMatch) parts.push(doorMatch[0]);
        if (ceilingMatch) parts.push("ceiling: " + ceilingMatch[1].trim());
        if (archMatch) parts.push(archMatch[0].trim());
        if (parts.length > 0) {
          roomContext = "\n\nROOM PHOTO REFERENCE — YOU MUST MATCH THIS ROOM EXACTLY: " + parts.join(", ") + ". Keep the EXACT same walls, floor, windows, doors, ceiling, and architectural features visible in the reference photo. Place furniture INTO this room, do NOT redesign the room itself.";
        } else {
          roomContext = "\n\nROOM PHOTO REFERENCE — MATCH THIS ROOM: " + roomPhotoAnalysis.slice(0, 400) + ". The reference photo shows the actual room. Keep all walls, floor, windows, and architecture EXACTLY as shown. Only add the listed furniture.";
        }
      }

      // Build CAD/floor plan context
      let cadContext = "";
      if (cadAnalysis) {
        cadContext = "\n\nFLOOR PLAN / CAD ANALYSIS — USE THIS LAYOUT: " + cadAnalysis.slice(0, 500) + "\nPlace furniture according to this floor plan. Respect wall positions, door locations (keep clearance), window placements (don't block), and any built-in features. The floor plan defines WHERE items go in the room.";
      }

      // ─── STEP 3: EXTRACT USER CONTEXT FROM CHAT ───
      // Pull relevant info the user shared in the AI chat (doors, windows, preferences, etc.)
      const userMessages = msgs.filter(m => m.role === "user").map(m => m.text).join(" ");
      let userContext = "";
      if (userMessages.length > 10) {
        // Extract spatial/preference details the user mentioned
        const contextParts = [];
        if (/door/i.test(userMessages)) contextParts.push("has door(s)");
        if (/window/i.test(userMessages)) contextParts.push("has windows");
        if (/fireplace/i.test(userMessages)) contextParts.push("has a fireplace");
        if (/stairs|staircase/i.test(userMessages)) contextParts.push("near stairs");
        if (/open.*(?:plan|concept|floor)/i.test(userMessages)) contextParts.push("open floor plan");
        if (/small|compact|tiny/i.test(userMessages)) contextParts.push("compact space");
        if (/large|spacious|big/i.test(userMessages)) contextParts.push("spacious room");
        if (/dark|moody/i.test(userMessages)) contextParts.push("moody/dark atmosphere");
        if (/bright|airy|light/i.test(userMessages)) contextParts.push("bright and airy feel");
        if (/cozy|warm/i.test(userMessages)) contextParts.push("cozy warm feel");
        // Include a summary of what the user said (truncated)
        const lastUserMsg = msgs.filter(m => m.role === "user").slice(-2).map(m => m.text).join(". ");
        if (lastUserMsg.length > 5) {
          userContext = "\n\nUSER'S DESIGN NOTES: " + (contextParts.length > 0 ? contextParts.join(", ") + ". " : "") + "User said: \"" + lastUserMsg.slice(0, 300) + "\"";
        }
      }

      // ─── STEP 4: BUILD IMAGE GENERATION PROMPT ───
      const numItems = items.slice(0, 8).length;
      const hasRoomRef = !!(roomPhoto?.data);
      const hasCad = !!cadAnalysis;

      const prompt = "Generate a photorealistic interior design photograph of a " + styleName + " " + roomName + "." +
        dimsStr +
        // Reference image instructions
        (hasRoomRef ? "\n\nIMPORTANT — A reference photo of the ACTUAL room is provided. You MUST keep the room's architecture EXACTLY as shown: same walls, floor, windows, doors, ceiling height, and layout. Do NOT change the room structure. Your only job is to place the listed furniture INTO this existing room." : "") +
        // CAD/floor plan instructions
        cadContext +
        // Room photo features
        roomContext +
        // User chat context
        userContext +
        "\n\nFURNITURE TO PLACE IN THIS ROOM (render ONLY these " + numItems + " pieces, NOTHING else):\n\n" + productSpecs +
        "\n\nRULES:" +
        "\n- Show EXACTLY " + numItems + " piece" + (numItems > 1 ? "s" : "") + " of furniture. Do NOT add any extra furniture, accessories, throw pillows, vases, plants, books, or decor items that are not in the list above." +
        (numItems === 1 ? " This is a SINGLE product visualization — just this ONE item in an otherwise empty " + roomName.toLowerCase() + ". Do not add anything else." : "") +
        "\n- MATCH each product's exact shape, color, material, and proportions as described above" + (aiProductDescriptions ? " (the AI Analysis lines are the most accurate descriptions — follow them closely)" : "") + "." +
        "\n- If a product is described as ROUND, it must be circular. If OVAL, show an oval. If L-SHAPED, show an L-shape. Shape accuracy is critical." +
        "\n- Each product's width and depth dimensions are provided — make sure proportions between items are realistic." +
        (roomWidth && roomLength ? "\n- The room is " + roomWidth + "ft × " + roomLength + "ft. Scale furniture placement to fit these real dimensions — a 7ft sofa should take up about " + Math.round(7 / parseFloat(roomWidth) * 100) + "% of the room width." : "") +
        (hasRoomRef ? "\n- PRESERVE the reference room photo exactly. Same paint colors, same flooring, same windows, same lighting. Only ADD the listed furniture." : "") +
        (hasCad ? "\n- Follow the floor plan for furniture placement positions. Place items where the CAD layout indicates, respecting door clearances and window sightlines." : "") +
        "\n- Room style: " + styleName + ". Wall/accent colors: " + colorStr + ". Floor materials: " + matStr + "." +
        "\n- Layout: " + roomNeeds.layout +
        "\n- Output a high-resolution, wide-angle interior architecture photograph at landscape orientation, eye-level, natural daylight, Architectural Digest quality." +
        "\n- NO text, labels, watermarks, or annotations.";

      // If user uploaded a room photo, pass it as reference so AI places furniture IN that room
      const refImg = roomPhoto?.data || null;
      console.log("Viz Step 4: generating image with " + numItems + " products, " + productImageUrls.length + " reference images" + (refImg ? ", room photo" : "") + (hasCad ? ", CAD layout" : "") + (roomWidth ? ", " + roomWidth + "x" + roomLength + "ft" : "") + (aiProductDescriptions ? ", AI-analyzed" : ", keyword-fallback"));
      const imgUrl = await generateAIImage(prompt, refImg, productImageUrls);

      if (imgUrl === "__CREDITS_REQUIRED__") {
        setVizErr("Image generation needs purchased credits on your OpenRouter account. Visit openrouter.ai/settings/credits to add funds.");
        setVizSt("idle");
      } else if (imgUrl) {
        setVizUrls([{ url: imgUrl, label: "AI Visualization" }]);
        setVizSt("ok");
        console.log("Viz: SUCCESS");
      } else {
        // Fallback concept card
        setVizErr("AI image generation is temporarily unavailable. Showing design concept instead.");
        setVizUrls([{
          url: null, label: "Design Concept", concept: true,
          mood: "natural daylight with warm tones",
          colors: palette.colors.slice(0, 3),
          products: items.slice(0, 4).map(p => p.n)
        }]);
        setVizSt("ok");
      }
    } catch (err) {
      console.error("Visualization error:", err);
      setVizErr("Something went wrong generating the image. Please try again.");
      setVizSt("idle");
    }
  };

  const welcomeMsg = { role: "bot", text: "Welcome to AURA! I have **" + DB.length + " products** from premium brands including Restoration Hardware, West Elm, Article, Crate & Barrel, AllModern, Serena & Lily, Rejuvenation, McGee & Co, Shoppe Amber, and more.\n\n**Tell me about your space** — what room, your style, what you need, where the doors and windows are, any existing furniture to work around. **The more detail you give, the better your visualizations will be!**\n\n**Upload a room photo** above and I'll analyze your space to create layouts that work with your actual walls, windows, and flooring.\n\nI'll use everything you tell me when generating your room visualization — so be specific about colors, materials, and the vibe you want!", recs: [] };

  // Snapshot current design state into a project object
  const snapshotProject = (existingId) => ({
    id: existingId || Date.now(),
    name: (room || "My") + " " + (vibe || "Design"),
    room, vibe,
    items: Array.from(sel.entries()),
    total: selTotal,
    sqft: sqft || null,
    roomW: roomW || null,
    roomL: roomL || null,
    date: Date.now(),
    msgs: msgs.length > 1 ? msgs : [],
    vizUrls: vizUrls || [],
    cadAnalysis: cadAnalysis || null,
    roomPhoto: roomPhoto || null,
    roomPhotoAnalysis: roomPhotoAnalysis || null,
    bud: bud || "all",
  });

  const saveProject = () => {
    if (activeProjectId) {
      // Update existing project
      setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...snapshotProject(activeProjectId), name: p.name } : p));
    } else {
      // Create new project
      const pr = snapshotProject();
      setProjects(prev => [pr, ...prev]);
      setActiveProjectId(pr.id);
    }
  };

  const delPr = (id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
  };

  const loadPr = (pr) => {
    // Auto-save current project before switching
    if (activeProjectId && sel.size > 0) {
      setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...snapshotProject(activeProjectId), name: p.name } : p));
    }
    // Load all state from project
    setRoom(pr.room); setVibe(pr.vibe); setSel(new Map((pr.items || []).map(x => Array.isArray(x) ? x : [x, 1])));
    if (pr.sqft) setSqft(String(pr.sqft)); else setSqft("");
    if (pr.roomW) setRoomW(String(pr.roomW)); else setRoomW("");
    if (pr.roomL) setRoomL(String(pr.roomL)); else setRoomL("");
    if (pr.msgs && pr.msgs.length > 0) setMsgs(pr.msgs); else setMsgs([welcomeMsg]);
    if (pr.vizUrls) setVizUrls(pr.vizUrls); else setVizUrls([]);
    if (pr.cadAnalysis) setCadAnalysis(pr.cadAnalysis); else setCadAnalysis(null);
    if (pr.roomPhoto) setRoomPhoto(pr.roomPhoto); else setRoomPhoto(null);
    if (pr.roomPhotoAnalysis) setRoomPhotoAnalysis(pr.roomPhotoAnalysis); else setRoomPhotoAnalysis(null);
    if (pr.bud) setBud(pr.bud); else setBud("all");
    setActiveProjectId(pr.id);
    go("design"); setTab("studio");
  };

  const newProject = () => {
    // Auto-save current project before creating new
    if (activeProjectId && sel.size > 0) {
      setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...snapshotProject(activeProjectId), name: p.name } : p));
    }
    // Reset all design state
    setRoom(null); setVibe(null); setSel(new Map()); setSqft(""); setRoomW(""); setRoomL(""); setBud("all");
    setMsgs([welcomeMsg]); setVizUrls([]); setVizSt("idle"); setVizErr("");
    setCadLayout(null); setCadFile(null); setCadAnalysis(null);
    setRoomPhoto(null); setRoomPhotoAnalysis(null);
    setBoards(null); setActiveBoard(0); setBoardsGenHint(null);
    setActiveProjectId(null);
    go("design"); setTab("studio");
  };

  const renameProject = (id, newName) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
    setEditingProjectName(null);
  };

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

      const catalogStr = scored.slice(0, 25).map((x) => "[ID:" + x.id + "] " + x.n + " by " + x.r + " $" + x.p + " (" + x.c + ")").join("\n");
      const palette = STYLE_PALETTES[vibe] || {};
      const roomNeeds = ROOM_NEEDS[room] || {};

      // Build furniture dimension reference for AI
      const furnDimStr = Object.entries(FURN_DIMS).map(([k, v]) => k + ": " + v.w + "ft W x " + v.d + "ft D").join(", ");

      const sysPrompt = "You are AURA, an elite AI interior design consultant.\n\nCatalog (showing relevant):\n" + catalogStr +
        "\n\nContext: Room=" + (room || "any") + ", Style=" + (vibe || "any") +
        ", Budget=" + (bud === "all" ? "any" : bud) + (sqft ? ", ~" + sqft + " sq ft" : "") +
        "\n\nFURNITURE DIMENSIONS: " + furnDimStr +
        "\n\nSPATIAL RULES: BEFORE recommending any furniture, verify it physically fits the room. A " + (sqft || "200") + " sqft room is roughly " + Math.round(Math.sqrt((parseInt(sqft) || 200) * 1.3)) + "ft x " + Math.round((parseInt(sqft) || 200) / Math.sqrt((parseInt(sqft) || 200) * 1.3)) + "ft. " +
        "A 7.5ft sofa needs 3ft clearance in front + walking space. Do NOT recommend oversized furniture for small rooms. " +
        "If the user's room is under 150 sqft, prefer compact/small-scale pieces. Mention dimensions when suggesting placement." +
        (cadAnalysis ? "\nFloor plan analysis: " + cadAnalysis.slice(0, 300) : "") +
        (roomPhotoAnalysis ? "\nRoom photo analysis: " + roomPhotoAnalysis.slice(0, 300) : "") +
        (roomNeeds.layout ? "\nLayout guidelines: " + roomNeeds.layout : "") +
        "\n\nRULES: Write flowing paragraphs, NOT numbered lists. Bold product names with **name**. Reference as [ID:N]. Recommend up to 12 products. Warm editorial tone. Suggest specific placement with dimensions. Colors: " + (palette.colors || []).slice(0, 4).join(", ") +
        ". Materials: " + (palette.materials || []).slice(0, 3).join(", ") +
        ". ALWAYS mention how each large piece fits the room dimensions.";

      const chatHistory = [{ role: "system", content: sysPrompt }];
      msgs.slice(-4).forEach((mm) => {
        if (mm.role === "user") chatHistory.push({ role: "user", content: mm.text || "" });
        else if (mm.role === "bot" && mm.text) chatHistory.push({ role: "assistant", content: (mm.text || "").slice(0, 300) });
      });
      chatHistory.push({ role: "user", content: msg });

      // Use OpenRouter (GPT-4o-mini) via secure proxy, Pollinations as fallback
      const text = await aiChat(chatHistory);

      if (text && text.length > 20 && text !== "[object Object]") {
        const ids = []; const rx = /\[ID:(\d+)\]/g; let mt;
        while ((mt = rx.exec(text)) !== null) ids.push(parseInt(mt[1]));
        let apiRecs = ids.map((id) => DB.find((p) => p.id === id)).filter(Boolean);

        if (apiRecs.length === 0) {
          const boldNames = []; const bx = /\*\*([^*]+)\*\*/g; let bm;
          while ((bm = bx.exec(text)) !== null) boldNames.push(bm[1].toLowerCase().trim());
          const found = new Set();
          for (const bn of boldNames) {
            let match = DB.find(p => (p.n || "").toLowerCase() === bn);
            if (!match) match = DB.find(p => (p.n || "").toLowerCase().includes(bn) || bn.includes((p.n || "").toLowerCase()));
            if (!match) {
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

        const ml = msg.toLowerCase();
        let detectedRoom = room;
        let detectedStyle = vibe;
        if (!detectedRoom) {
          for (const r of ROOMS) { if (ml.includes(r.toLowerCase())) { detectedRoom = r; setRoom(r); break; } }
        }
        if (!detectedStyle) {
          for (const v of VIBES) { if (ml.includes(v.toLowerCase())) { detectedStyle = v; setVibe(v); break; } }
        }
        if (detectedRoom && detectedStyle) {
          setTimeout(() => triggerMoodBoards(detectedRoom, detectedStyle, bud, sqft), 300);
          setBoardsGenHint("Mood boards generated based on your conversation");
        } else if (detectedRoom || detectedStyle || apiRecs.length > 4) {
          const fallbackRoom = detectedRoom || "Living Room";
          const fallbackStyle = detectedStyle || "Warm Modern";
          setTimeout(() => triggerMoodBoards(fallbackRoom, fallbackStyle, bud, sqft), 300);
          setBoardsGenHint("Mood boards curated from your request" + (!detectedRoom ? " — select a room type for better results" : "") + (!detectedStyle ? " — select a style for better results" : ""));
        }
      }
    } catch (e) { console.log("AI chat error:", e); }

    if (!aiWorked) {
      const palette = STYLE_PALETTES[vibe] || {};
      const reasons = topPicks.slice(0, 8).map((p) => {
        const dims = getProductDims(p);
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}><AuraLogo size={32} /><h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, margin: 0 }}>AURA</h1></div>
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
          <div className="aura-pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "40px 32px", textAlign: "left" }}>
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#A89B8B", marginBottom: 8 }}>Free</p>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 48, fontWeight: 400, marginBottom: 24 }}>$0<span style={{ fontSize: 16, color: "#B8A898" }}>/mo</span></div>
              {["3 mood boards/month", "Core catalog", "AI design chat", "Room visualizations", "1 saved project"].map((f) => <p key={f} style={{ fontSize: 14, color: "#7A6B5B", padding: "10px 0", borderBottom: "1px solid #F5F0EB", margin: 0 }}>&#10003; {f}</p>)}
            </div>
            <div style={{ background: "#fff", borderRadius: 20, padding: "40px 32px", textAlign: "left", border: "2px solid #C17550", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, right: 20, background: "#C17550", color: "#fff", fontSize: 10, fontWeight: 700, padding: "6px 16px", borderRadius: "0 0 12px 12px", letterSpacing: ".1em" }}>POPULAR</div>
              <p style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: "#C17550", marginBottom: 8 }}>Pro</p>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 48, fontWeight: 400, marginBottom: 24 }}>$20<span style={{ fontSize: 16, color: "#B8A898" }}>/mo</span></div>
              {["Unlimited mood boards", "Full " + DB.length + " product catalog", "3 AI Room Visualizations", "CAD/PDF floor plan analysis", "AI-powered furniture layout plans", "Exact placement with dimensions", "Spatial fit verification", "Unlimited projects", "All 14 design styles"].map((f) => <p key={f} style={{ fontSize: 14, color: "#7A6B5B", padding: "10px 0", borderBottom: "1px solid #F5F0EB", margin: 0 }}>&#10003; {f}</p>)}
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
          {projects.length === 0 ? <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center", color: "#B8A898" }}>No projects yet. Start designing!</div> : projects.map((pr) => (
            <div key={pr.id} style={{ background: "#fff", borderRadius: 14, border: activeProjectId === pr.id ? "2px solid #C17550" : "1px solid #F0EBE4", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px" }}>
              <div>
                <div style={{ fontFamily: "Georgia,serif", fontSize: 17 }}>{pr.name} {activeProjectId === pr.id ? <span style={{ fontSize: 10, background: "#C17550", color: "#fff", padding: "2px 8px", borderRadius: 8, verticalAlign: "middle", marginLeft: 8 }}>Active</span> : null}</div>
                <div style={{ fontSize: 12, color: "#B8A898", marginTop: 3 }}>{(pr.items || []).length} items - {fmt(pr.total || 0)}{pr.sqft ? " - " + pr.sqft + " sqft" : ""}{pr.room ? " - " + pr.room : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => loadPr(pr)} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{activeProjectId === pr.id ? "Open" : "Load"}</button>
                <button onClick={() => delPr(pr.id)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "7px 14px", fontSize: 11, color: "#B8A898", cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
            <button onClick={newProject} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>New Project</button>
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
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes drawLine{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
        @keyframes growLine{from{transform:scaleY(0)}to{transform:scaleY(1)}}
        @keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(193,117,80,.15)}50%{box-shadow:0 0 40px rgba(193,117,80,.35)}}
        @keyframes slideInLeft{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:translateX(0)}}
        @keyframes slideInRight{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:translateX(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        *{-webkit-tap-highlight-color:transparent}
        input,button,select,textarea{font-size:16px!important}
        @media(max-width:768px){
          .aura-timeline-left,.aura-timeline-right{flex:none!important;width:100%!important;padding:0 8px!important;justify-content:center!important}
          .aura-timeline-left>div,.aura-timeline-right>div{max-width:100%!important}
          .aura-timeline-line{display:none!important}
          .aura-grid-2col{grid-template-columns:1fr!important;gap:24px!important}
          .aura-pricing-grid{grid-template-columns:1fr!important}
          .aura-nav-links{gap:4px!important}
          .aura-nav-links>button,.aura-nav-links>span{font-size:10px!important;padding:5px 8px!important}
          .aura-filter-wrap{flex-direction:column!important}
          .aura-hero h1{font-size:36px!important}
          .aura-hero p{font-size:15px!important}
          .aura-studio-filters{padding:16px 4%!important}
          .aura-card-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))!important;gap:10px!important}
          .aura-chat-box{padding:16px!important}
          .aura-chat-input{flex-direction:column!important}
          .aura-chat-input input{width:100%!important}
          .aura-chat-input button{width:100%!important}
          .aura-viz-grid{grid-template-columns:1fr!important}
          .aura-mood-tabs{flex-wrap:wrap!important}
          .aura-upload-row{flex-direction:column!important;gap:12px!important}
          .aura-sel-header{flex-direction:column!important;align-items:flex-start!important;gap:12px!important}
          .aura-sel-actions{width:100%!important}
          .aura-sel-actions button{flex:1!important}
        }
      `}</style>

      {/* NAV */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, padding: sc ? "10px 5%" : "16px 5%", display: "flex", alignItems: "center", justifyContent: "space-between", background: sc ? "rgba(253,252,250,.96)" : "transparent", backdropFilter: sc ? "blur(20px)" : "none", transition: "all .3s", borderBottom: sc ? "1px solid #F0EBE4" : "none" }}>
        <div onClick={() => go("home")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><AuraLogo size={30} /><span style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400 }}>AURA</span></div>
        <div className="aura-nav-links" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {sel.size > 0 && <span style={{ fontSize: 11, color: "#C17550", fontWeight: 600, background: "rgba(193,117,80,.06)", padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>{selCount} items - {fmt(selTotal)}</span>}
          <button onClick={() => go("pricing")} style={{ background: "none", border: "none", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Pricing</button>
          {user ? <button onClick={() => go("account")} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 24, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{user.name || "Account"}</button> : <button onClick={() => go("auth")} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 24, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Sign In</button>}
          <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", borderRadius: 24, padding: "8px 16px", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Design</button>
        </div>
      </nav>

      {/* HOME — SCROLL ANIMATED LANDING */}
      {pg === "home" && (() => {
        const previewProducts = DB.filter(p => p.img && p.img.includes("shopify")).filter((_, i) => i % 47 === 0).slice(0, 8);
        return (
        <div>
          {/* Hero — elegant centered layout with AI-generated room background */}
          <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6%", position: "relative", overflow: "hidden" }}>
            {/* AI-generated background image */}
            {homeHeroImg ? (
              <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${homeHeroImg})`, backgroundSize: "cover", backgroundPosition: "center", filter: "brightness(0.55) saturate(0.9)", transition: "opacity 1s ease", zIndex: 0 }} />
            ) : (
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, #E8E0D8 25%, #D4C8B8 50%, #E8E0D8 75%)", backgroundSize: "400% 100%", animation: "shimmer 2s ease infinite", zIndex: 0 }} />
            )}
            {/* Gradient overlay for text readability */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(26,24,21,0.3) 0%, rgba(26,24,21,0.15) 40%, rgba(26,24,21,0.4) 100%)", zIndex: 1 }} />
            <div style={{ maxWidth: 800, textAlign: "center", animation: "fadeUp .8s ease", position: "relative", zIndex: 2 }}>
              <p style={{ fontSize: 12, letterSpacing: ".3em", textTransform: "uppercase", color: "#F0D8C4", fontWeight: 600, marginBottom: 28 }}>AI-Powered Interior Design</p>
              <h1 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(40px,6vw,72px)", fontWeight: 400, lineHeight: 1.05, marginBottom: 28, color: "#FFFFFF" }}>Design spaces<br />that feel like you</h1>
              <p style={{ fontSize: 18, color: "rgba(255,255,255,.85)", lineHeight: 1.8, maxWidth: 560, margin: "0 auto 16px" }}>{DB.length} designer-curated products paired with AI that understands your room, style, and how every piece fits together.</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,.6)", lineHeight: 1.6, maxWidth: 480, margin: "0 auto 40px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><span style={{ color: "#F0C4A0", fontSize: 8 }}>{"●"}</span>Every product hand-selected by professional designers</p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#C17550", color: "#fff", padding: "18px 44px", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start designing</button>
                <button onClick={() => { go("design"); setTab("catalog"); }} style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.3)", padding: "18px 44px", borderRadius: 12, fontSize: 15, color: "#fff", cursor: "pointer", fontFamily: "inherit", backdropFilter: "blur(8px)" }}>Browse catalog</button>
              </div>
            </div>
            <div style={{ position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)", animation: "pulse 2s ease infinite", zIndex: 2 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="1.5"><path d="M12 5v14m0 0l-6-6m6 6l6-6"/></svg>
            </div>
          </section>

          {/* Feature 1: Define Your Space — with room setup mockup */}
          <section style={{ padding: "120px 6%", maxWidth: 1200, margin: "0 auto" }}>
            <RevealSection>
              <div className="aura-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
                <div>
                  <span style={{ display: "inline-block", background: "#C1755015", color: "#C17550", padding: "6px 16px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 20 }}>Step 1</span>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(28px,3.5vw,42px)", fontWeight: 400, marginBottom: 18, lineHeight: 1.15 }}>Define your space</h2>
                  <p style={{ fontSize: 16, color: "#7A6B5B", lineHeight: 1.8, marginBottom: 24 }}>Upload a floor plan, enter dimensions, or snap a photo. AI maps out your windows, doors, and traffic flow automatically.</p>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    {[["Room dimensions", "Enter width, length, and square footage"], ["Photo upload", "Snap a photo and AI analyzes your room"], ["CAD support", "Upload floor plans for precision layouts"]].map(([t, d]) => (
                      <div key={t} style={{ flex: "1 1 140px" }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1815", marginBottom: 4 }}>{t}</p>
                        <p style={{ fontSize: 12, color: "#9B8B7B", lineHeight: 1.5, margin: 0 }}>{d}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Mockup: Room setup UI */}
                <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.06)", overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F56" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FFBD2E" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27C93F" }} />
                    <span style={{ marginLeft: 12, fontSize: 11, color: "#B8A898" }}>AURA Studio</span>
                  </div>
                  <div style={{ padding: 28 }}>
                    <p style={{ fontSize: 10, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 700, marginBottom: 16 }}>Room Setup</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                      {["Living Room", "Bedroom", "Dining Room"].map(r => (
                        <div key={r} style={{ padding: "14px 10px", borderRadius: 10, border: r === "Living Room" ? "2px solid #C17550" : "1px solid #E8E0D8", textAlign: "center", fontSize: 12, fontWeight: r === "Living Room" ? 700 : 400, color: r === "Living Room" ? "#C17550" : "#7A6B5B", background: r === "Living Room" ? "#C1755008" : "#fff" }}>{r}</div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                      <div style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #E8E0D8" }}>
                        <span style={{ fontSize: 10, color: "#B8A898" }}>Width</span>
                        <p style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 0", color: "#1A1815" }}>18 ft</p>
                      </div>
                      <div style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #E8E0D8" }}>
                        <span style={{ fontSize: 10, color: "#B8A898" }}>Length</span>
                        <p style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 0", color: "#1A1815" }}>22 ft</p>
                      </div>
                    </div>
                    <div style={{ padding: "20px 16px", borderRadius: 12, border: "2px dashed #D8D0C8", textAlign: "center", color: "#B8A898" }}>
                      <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}>{"📷"}</div>
                      <p style={{ fontSize: 12, margin: 0 }}>Upload a room photo or floor plan</p>
                    </div>
                  </div>
                </div>
              </div>
            </RevealSection>
          </section>

          {/* Feature 2: Discover Your Style — with style palette mockup */}
          <section style={{ padding: "100px 6%", background: "#F8F5F0" }}>
            <RevealSection>
              <div className="aura-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
                {/* Mockup: Style palette selector */}
                <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.06)", overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F56" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FFBD2E" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27C93F" }} />
                    <span style={{ marginLeft: 12, fontSize: 11, color: "#B8A898" }}>Style Selection</span>
                  </div>
                  <div style={{ padding: 24 }}>
                    <p style={{ fontSize: 10, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 700, marginBottom: 16 }}>Choose Your Aesthetic</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {[
                        { name: "Warm Modern", colors: ["#D4B896", "#8B6040", "#E8DDD0", "#5A4535", "#C4A882"] },
                        { name: "California Cool", colors: ["#C8B8A0", "#7A8B6B", "#E0D4C0", "#4A6B5B", "#D8C8B0"] },
                        { name: "Japandi", colors: ["#D4CEC4", "#6B6560", "#E8E4DC", "#2A2825", "#B8B0A4"] },
                        { name: "Scandinavian", colors: ["#E8E4E0", "#A09890", "#F5F0EB", "#5A5550", "#D4CEC4"] },
                      ].map(s => (
                        <div key={s.name} style={{ padding: "14px", borderRadius: 12, border: s.name === "Warm Modern" ? "2px solid #C17550" : "1px solid #E8E0D8", cursor: "pointer", background: s.name === "Warm Modern" ? "#C1755006" : "#fff" }}>
                          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                            {s.colors.map((c, ci) => <div key={ci} style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: "1px solid rgba(0,0,0,.06)" }} />)}
                          </div>
                          <p style={{ fontSize: 12, fontWeight: s.name === "Warm Modern" ? 700 : 500, color: "#1A1815", margin: 0 }}>{s.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <span style={{ display: "inline-block", background: "#8B735515", color: "#8B7355", padding: "6px 16px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 20 }}>Step 2</span>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(28px,3.5vw,42px)", fontWeight: 400, marginBottom: 18, lineHeight: 1.15 }}>Discover your style</h2>
                  <p style={{ fontSize: 16, color: "#7A6B5B", lineHeight: 1.8, marginBottom: 20 }}>Explore 14 curated palettes with matched colors and materials. Every product is scored for harmony and fit to your room.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["Warm Modern", "California Cool", "Japandi", "Scandinavian", "Bohemian", "Transitional", "Art Deco", "+7 more"].map(s => (
                      <span key={s} style={{ fontSize: 11, padding: "6px 14px", borderRadius: 20, background: "#fff", border: "1px solid #E8E0D8", color: "#7A6B5B" }}>{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            </RevealSection>
          </section>

          {/* Feature 3: AI Chat & Mood Boards — with chat + product card mockup */}
          <section style={{ padding: "100px 6%", maxWidth: 1200, margin: "0 auto" }}>
            <RevealSection>
              <div className="aura-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
                <div>
                  <span style={{ display: "inline-block", background: "#5B7B6B15", color: "#5B7B6B", padding: "6px 16px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 20 }}>Step 3</span>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(28px,3.5vw,42px)", fontWeight: 400, marginBottom: 18, lineHeight: 1.15 }}>Chat with your AI designer</h2>
                  <p style={{ fontSize: 16, color: "#7A6B5B", lineHeight: 1.8, marginBottom: 20 }}>Describe your vision in plain language. AURA generates mood boards, recommends matching products, and verifies everything fits your space.</p>
                  <p style={{ fontSize: 14, color: "#9B8B7B", fontStyle: "italic", lineHeight: 1.6 }}>{"\"I want a warm, inviting living room with a large sofa, a round coffee table, and ambient lighting — earthy tones, nothing too modern.\""}</p>
                </div>
                {/* Mockup: Chat interface with product cards */}
                <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.06)", overflow: "hidden" }}>
                  <div style={{ padding: "12px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#5B8B6B" }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815" }}>AI Designer</span>
                    <span style={{ fontSize: 10, color: "#B8A898", marginLeft: "auto" }}>Online</span>
                  </div>
                  <div style={{ padding: "16px 20px", maxHeight: 380, display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* User message */}
                    <div style={{ padding: "10px 14px", borderRadius: "14px 14px 4px 14px", background: "#1A1815", color: "#fff", fontSize: 13, lineHeight: 1.5, maxWidth: "80%", marginLeft: "auto" }}>I need a warm living room with earthy tones and a large sectional</div>
                    {/* AI response */}
                    <div style={{ padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "#F8F5F0", fontSize: 13, lineHeight: 1.6, color: "#3A3530" }}>
                      <span style={{ color: "#8B6040", fontWeight: 700 }}>Great choice!</span> Here are pieces that pair beautifully for a warm, grounded living room. The Dana Sectional anchors the space with its relaxed silhouette.
                    </div>
                    {/* Product recommendations */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                      {previewProducts.slice(0, 2).map(p => (
                        <div key={p.id} style={{ borderRadius: 12, border: "1px solid #EDE8E2", overflow: "hidden", background: "#fff" }}>
                          <div style={{ height: 90, overflow: "hidden" }}>
                            <img src={p.img} alt={p.n} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          </div>
                          <div style={{ padding: "8px 10px" }}>
                            <p style={{ fontSize: 11, fontWeight: 500, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</p>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                              <span style={{ fontSize: 10, color: "#A89B8B" }}>{p.r}</span>
                              <span style={{ fontSize: 11, fontWeight: 700 }}>{fmt(p.p)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Chat input mockup */}
                    <div style={{ display: "flex", gap: 0, border: "1.5px solid #D8D0C8", borderRadius: 10, overflow: "hidden", marginTop: 4 }}>
                      <div style={{ flex: 1, padding: "10px 14px", fontSize: 12, color: "#B8A898" }}>Ask AI: What do you need for your living room?</div>
                      <div style={{ background: "#1A1815", color: "#fff", padding: "10px 16px", fontSize: 12, fontWeight: 600 }}>Send</div>
                    </div>
                  </div>
                </div>
              </div>
            </RevealSection>
          </section>

          {/* Feature 4: Catalog — with product grid mockup */}
          <section style={{ padding: "100px 6%", background: "#F8F5F0" }}>
            <RevealSection>
              <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 48 }}>
                <span style={{ display: "inline-block", background: "#8B735515", color: "#8B7355", padding: "6px 16px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 20 }}>Curated Catalog</span>
                <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(28px,3.5vw,42px)", fontWeight: 400, marginBottom: 14, lineHeight: 1.15 }}>{DB.length} products, hand-picked by designers</h2>
                <p style={{ fontSize: 16, color: "#7A6B5B", lineHeight: 1.7, maxWidth: 600, margin: "0 auto" }}>Every item links directly to the product page for purchase. From sofas to sconces, each piece is sourced from premium brands for quality and lasting style.</p>
              </div>
              {/* Product grid preview using real images */}
              <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
                  {previewProducts.slice(0, 8).map(p => (
                    <div key={p.id} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #EDE8E2", transition: "transform .3s, box-shadow .3s" }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 12px 40px rgba(0,0,0,.08)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
                    >
                      <div style={{ height: 180, overflow: "hidden" }}>
                        <img src={p.img} alt={p.n} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      </div>
                      <div style={{ padding: "14px 16px" }}>
                        <p style={{ fontFamily: "Georgia,serif", fontSize: 14, fontWeight: 500, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                          <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#A89B8B" }}>{p.r}</span>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{fmt(p.p)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: "center", marginTop: 32 }}>
                  <button onClick={() => { go("design"); setTab("catalog"); }} style={{ background: "#1A1815", color: "#fff", padding: "16px 40px", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Browse full catalog {"→"}</button>
                </div>
              </div>
            </RevealSection>
          </section>

          {/* Feature 5: AI Visualization */}
          <section style={{ padding: "100px 6%", maxWidth: 1200, margin: "0 auto" }}>
            <RevealSection>
              <div style={{ textAlign: "center", marginBottom: 48 }}>
                <span style={{ display: "inline-block", background: "#6B5B8B15", color: "#6B5B8B", padding: "6px 16px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 20 }}>Step 4</span>
                <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(28px,3.5vw,42px)", fontWeight: 400, marginBottom: 14, lineHeight: 1.15 }}>See it come to life</h2>
                <p style={{ fontSize: 16, color: "#7A6B5B", lineHeight: 1.7, maxWidth: 600, margin: "0 auto" }}>Photorealistic AI visualizations with your exact products in context, plus precise CAD floor plans with real dimensions.</p>
              </div>
              <div className="aura-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
                {/* Visualization Example */}
                <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.06)", overflow: "hidden" }}>
                  <div style={{ padding: "12px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#1A1815" }}>AI Room Visualization</span>
                    <span style={{ fontSize: 10, color: "#5B8B6B", fontWeight: 600 }}>Generated</span>
                  </div>
                  {/* AI-generated room visualization */}
                  <div style={{ position: "relative", minHeight: 280 }}>
                    {homeVizImg ? (
                      <img src={homeVizImg} alt="AI-generated room visualization" style={{ width: "100%", display: "block", objectFit: "cover", minHeight: 280, maxHeight: 380, transition: "opacity .6s ease" }} />
                    ) : (
                      <div style={{ width: "100%", height: 320, background: "linear-gradient(135deg, #E8E0D8 25%, #D4C8B8 50%, #E8E0D8 75%)", backgroundSize: "400% 100%", animation: "shimmer 2s ease infinite", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 13, color: "#9B8B7B", fontWeight: 500 }}>Generating preview...</span>
                      </div>
                    )}
                    <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {["Warm Modern", "Living Room", "18' x 22'"].map(t => (
                        <span key={t} style={{ fontSize: 10, background: "rgba(255,255,255,.85)", backdropFilter: "blur(8px)", padding: "4px 10px", borderRadius: 8, color: "#5A5045", fontWeight: 600 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: "14px 20px", borderTop: "1px solid #F0EBE4" }}>
                    <p style={{ fontSize: 12, color: "#7A6B5B", margin: 0, lineHeight: 1.5 }}>AI renders your products in a photorealistic room scene based on your dimensions and style.</p>
                  </div>
                </div>
                {/* CAD Floor Plan */}
                <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.06)", overflow: "hidden" }}>
                  <div style={{ padding: "12px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#1A1815" }}>CAD Floor Plan</span>
                    <span style={{ fontSize: 10, background: "#C17550", color: "#fff", padding: "3px 10px", borderRadius: 10, fontWeight: 700, letterSpacing: ".08em" }}>PRO</span>
                  </div>
                  <div style={{ padding: 16 }}>
                    <svg width="100%" viewBox="0 0 400 300" style={{ display: "block" }}>
                      <rect width="400" height="300" fill="#FDFCFA" />
                      <defs><pattern id="miniGrid2" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#F0EBE4" strokeWidth="0.5" /></pattern></defs>
                      <rect width="400" height="300" fill="url(#miniGrid2)" />
                      {/* Room walls - thick architectural lines */}
                      <rect x="20" y="20" width="360" height="260" fill="none" stroke="#1A1815" strokeWidth="3" />
                      {/* Inner wall line */}
                      <rect x="24" y="24" width="352" height="252" fill="none" stroke="#1A1815" strokeWidth="1" />
                      {/* Window with glass */}
                      <rect x="130" y="17" width="140" height="10" fill="#D4E8F0" stroke="#7BA8C8" strokeWidth="1.5" rx="1" />
                      <text x="200" y="12" textAnchor="middle" fontSize="7" fill="#7BA8C8" fontWeight="600">Window 10{"'"}</text>
                      {/* Door with swing arc */}
                      <rect x="17" y="200" width="10" height="50" fill="#E8E0D8" stroke="#8B7355" strokeWidth="1.5" rx="1" />
                      <path d="M 27 200 Q 60 200 60 233" fill="none" stroke="#8B7355" strokeWidth="0.8" strokeDasharray="3,2" />
                      <text x="50" y="195" fontSize="6" fill="#8B7355">Door 3{"'"}</text>
                      {/* Rug — dashed outline */}
                      <rect x="70" y="105" width="250" height="155" fill="#C1755008" stroke="#C17550" strokeWidth="1" strokeDasharray="6,4" rx="3" />
                      <text x="82" y="252" fontSize="6" fill="#C17550">Rug 8{"'"} × 10{"'"}</text>
                      {/* Sofa — with arm details */}
                      <rect x="100" y="210" width="190" height="55" fill="#D4B89625" stroke="#8B7355" strokeWidth="2" rx="4" />
                      <rect x="100" y="210" width="10" height="55" fill="#8B735515" stroke="#8B7355" strokeWidth="1" rx="2" />
                      <rect x="280" y="210" width="10" height="55" fill="#8B735515" stroke="#8B7355" strokeWidth="1" rx="2" />
                      <line x1="160" y1="215" x2="160" y2="260" stroke="#8B7355" strokeWidth="0.3" />
                      <line x1="230" y1="215" x2="230" y2="260" stroke="#8B7355" strokeWidth="0.3" />
                      <text x="195" y="238" textAnchor="middle" fontSize="9" fill="#8B7355" fontWeight="700">Sofa</text>
                      <text x="195" y="250" textAnchor="middle" fontSize="7" fill="#8B735599">7.5{"'"} × 3{"'"}</text>
                      {/* Coffee table — round with detail */}
                      <ellipse cx="195" cy="160" rx="42" ry="26" fill="#5B6B5518" stroke="#5B6B55" strokeWidth="2" />
                      <ellipse cx="195" cy="160" rx="36" ry="22" fill="none" stroke="#5B6B5540" strokeWidth="0.5" />
                      <text x="195" y="158" textAnchor="middle" fontSize="8" fill="#5B6B55" fontWeight="700">Coffee Table</text>
                      <text x="195" y="169" textAnchor="middle" fontSize="6" fill="#5B6B5599">3.5{"'"} × 2.5{"'"}</text>
                      {/* Chairs — with proper shapes */}
                      <rect x="48" y="130" width="38" height="42" fill="#6B5B7518" stroke="#6B5B75" strokeWidth="1.5" rx="4" />
                      <rect x="52" y="128" width="30" height="8" fill="#6B5B7520" stroke="#6B5B75" strokeWidth="0.8" rx="3" />
                      <text x="67" y="155" textAnchor="middle" fontSize="7" fill="#6B5B75" fontWeight="700">Chair</text>
                      <text x="67" y="164" textAnchor="middle" fontSize="5.5" fill="#6B5B7599">2.5{"'"}</text>
                      <rect x="300" y="130" width="38" height="42" fill="#6B5B7518" stroke="#6B5B75" strokeWidth="1.5" rx="4" />
                      <rect x="304" y="128" width="30" height="8" fill="#6B5B7520" stroke="#6B5B75" strokeWidth="0.8" rx="3" />
                      <text x="319" y="155" textAnchor="middle" fontSize="7" fill="#6B5B75" fontWeight="700">Chair</text>
                      <text x="319" y="164" textAnchor="middle" fontSize="5.5" fill="#6B5B7599">2.5{"'"}</text>
                      {/* Side tables */}
                      <rect x="58" y="220" width="28" height="24" fill="#8B735518" stroke="#8B7355" strokeWidth="1" rx="2" />
                      <text x="72" y="236" textAnchor="middle" fontSize="5.5" fill="#8B7355">Side</text>
                      <rect x="303" y="220" width="28" height="24" fill="#8B735518" stroke="#8B7355" strokeWidth="1" rx="2" />
                      <text x="317" y="236" textAnchor="middle" fontSize="5.5" fill="#8B7355">Side</text>
                      {/* Pendant light */}
                      <circle cx="195" cy="80" r="12" fill="#FFD70020" stroke="#D4A020" strokeWidth="1.5" />
                      <circle cx="195" cy="80" r="4" fill="#FFD70040" />
                      <text x="195" y="65" textAnchor="middle" fontSize="7" fill="#9B8B7B">Pendant</text>
                      {/* Floor lamp */}
                      <circle cx="350" cy="230" r="7" fill="#FFD70015" stroke="#D4A020" strokeWidth="1" />
                      <text x="350" y="246" textAnchor="middle" fontSize="5.5" fill="#9B8B7B">Lamp</text>
                      {/* Clearance annotation */}
                      <line x1="195" y1="186" x2="195" y2="210" stroke="#5B8B6B" strokeWidth="1" />
                      <line x1="189" y1="186" x2="201" y2="186" stroke="#5B8B6B" strokeWidth="0.8" />
                      <line x1="189" y1="210" x2="201" y2="210" stroke="#5B8B6B" strokeWidth="0.8" />
                      <text x="205" y="201" fontSize="6.5" fill="#5B8B6B" fontWeight="600">16{"\""}{"✓"}</text>
                      {/* Room dimensions */}
                      <line x1="25" y1="288" x2="375" y2="288" stroke="#B8A898" strokeWidth="0.5" />
                      <polygon points="25,288 30,286 30,290" fill="#B8A898" />
                      <polygon points="375,288 370,286 370,290" fill="#B8A898" />
                      <text x="200" y="297" textAnchor="middle" fontSize="8" fill="#B8A898" fontWeight="600">18{"'"}</text>
                      <line x1="388" y1="25" x2="388" y2="275" stroke="#B8A898" strokeWidth="0.5" />
                      <polygon points="388,25 386,30 390,30" fill="#B8A898" />
                      <polygon points="388,275 386,270 390,270" fill="#B8A898" />
                      <text x="396" y="150" textAnchor="middle" fontSize="8" fill="#B8A898" fontWeight="600" transform="rotate(90,396,150)">22{"'"}</text>
                    </svg>
                  </div>
                  <div style={{ padding: "14px 20px", borderTop: "1px solid #F0EBE4" }}>
                    <p style={{ fontSize: 12, color: "#7A6B5B", margin: 0, lineHeight: 1.5 }}>Precise floor plans with real dimensions, furniture clearances, window/door placement, and traffic flow paths.</p>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "center", marginTop: 36 }}>
                <ul style={{ listStyle: "none", padding: 0, display: "inline-flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
                  {["AI room visualizations", "CAD floor plans", "Clearance optimization", "Window & door detection"].map(f => (
                    <li key={f} style={{ fontSize: 13, color: "#5A5045", display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "#C17550", fontWeight: 700 }}>{"✓"}</span>{f}</li>
                  ))}
                </ul>
                <div style={{ marginTop: 20 }}>
                  <button onClick={() => go("pricing")} style={{ background: "#C17550", color: "#fff", padding: "14px 32px", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Get Pro</button>
                </div>
              </div>
            </RevealSection>
          </section>

          {/* Brands */}
          <section style={{ padding: "80px 6%", background: "#F8F5F0" }}>
            <RevealSection style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
              <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 16 }}>Curated From</p>
              <h2 style={{ fontFamily: "Georgia,serif", fontSize: 36, fontWeight: 400, marginBottom: 40 }}>Premium brands, real products</h2>
              <div style={{ display: "flex", justifyContent: "center", gap: 48, flexWrap: "wrap", marginBottom: 20 }}>
                {["Lulu & Georgia", "McGee & Co", "Shoppe Amber Interiors", "West Elm"].map(b => (
                  <span key={b} style={{ fontFamily: "Georgia,serif", fontSize: 18, color: "#8B7355", fontWeight: 400 }}>{b}</span>
                ))}
              </div>
              <p style={{ fontSize: 14, color: "#9B8B7B" }}>{DB.length} products — every item links directly to the exact product page for purchase</p>
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
        );
      })()}

      {/* DESIGN */}
      {pg === "design" && (
        <div style={{ paddingTop: 60 }}>
          <div style={{ borderBottom: "1px solid #F0EBE4", background: "#fff" }}>
            <div style={{ display: "flex", padding: "0 5%", overflowX: "auto" }}>
              {[["studio", "Studio"], ["catalog", "Catalog (" + DB.length + ")"], ["projects", "Projects" + (projects.length ? " (" + projects.length + ")" : "")]].map(([id, lb]) => (
                <button key={id} onClick={() => { setTab(id); setPage(0); }} style={{ padding: "16px 22px", fontSize: 12, fontWeight: tab === id ? 700 : 500, background: "none", border: "none", borderBottom: tab === id ? "2px solid #1A1815" : "2px solid transparent", color: tab === id ? "#1A1815" : "#B8A898", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", letterSpacing: ".02em", transition: "all .15s" }}>{lb}</button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
                {activeProjectId && <span style={{ fontSize: 10, color: "#B8A898", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(projects.find(p => p.id === activeProjectId) || {}).name || "Project"}</span>}
                <button onClick={saveProject} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{activeProjectId ? "Save" : "Save as Project"}</button>
                <button onClick={newProject} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "8px 14px", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>+ New</button>
              </div>
            </div>
          </div>

          {/* STUDIO TAB */}
          {tab === "studio" && (
            <div>
              {/* ─── Step Navigation Bar ─── */}
              <div style={{ padding: "0 5%", background: "linear-gradient(180deg, #FDFCFA, #F8F5F0)", borderBottom: "1px solid #EDE8E0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 0, maxWidth: 600, margin: "0 auto", padding: "20px 0 18px" }}>
                  {[
                    { label: "Set Up", sub: "Room & Style", icon: "1", done: !!(room && vibe) },
                    { label: "Design", sub: "AI + Products", icon: "2", done: sel.size > 0 },
                    { label: "Visualize", sub: "See Your Room", icon: "3", done: vizUrls.length > 0 },
                  ].map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "none" }}>
                      <button onClick={() => setDesignStep(i)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontFamily: "inherit" }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: designStep === i ? "#1A1815" : s.done ? "#5B8B6B" : "#E8E0D8", color: designStep === i || s.done ? "#fff" : "#9B8B7B", transition: "all .3s", boxShadow: designStep === i ? "0 2px 8px rgba(26,24,21,.2)" : "none" }}>
                          {s.done && designStep !== i ? "\u2713" : s.icon}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: designStep === i ? 700 : 500, color: designStep === i ? "#1A1815" : "#9B8B7B", transition: "all .2s", lineHeight: 1.2 }}>{s.label}</div>
                          <div style={{ fontSize: 10, color: designStep === i ? "#9B8B7B" : "#C8BEB4", lineHeight: 1.2, marginTop: 1 }}>{s.sub}</div>
                        </div>
                      </button>
                      {i < 2 && <div style={{ flex: 1, height: 1, background: s.done ? "linear-gradient(90deg, #5B8B6B60, #5B8B6B20)" : "#E8E0D8", margin: "0 16px", borderRadius: 1 }} />}
                    </div>
                  ))}
                </div>
              </div>

              {/* ═══════ STEP 0: SET UP YOUR SPACE ═══════ */}
              {designStep === 0 && (
                <div style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 5% 48px" }}>
                  <div style={{ marginBottom: 32 }}>
                    <h2 style={{ fontFamily: "Georgia,serif", fontSize: 32, fontWeight: 400, marginBottom: 6, color: "#1A1815", letterSpacing: "-0.02em" }}>Set up your space</h2>
                    <p style={{ fontSize: 14, color: "#9B8B7B", lineHeight: 1.5, margin: 0 }}>Tell us about the room you're designing</p>
                  </div>

                  {/* Room Type + Style — side by side on desktop */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                    <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 14 }}>Room</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {ROOMS.map((rm) => (
                          <button key={rm} onClick={() => setRoom(room === rm ? null : rm)} style={{ padding: "10px 16px", borderRadius: 8, border: room === rm ? "1.5px solid #1A1815" : "1px solid #E8E0D8", background: room === rm ? "#1A1815" : "#FDFCFA", fontSize: 12, fontWeight: room === rm ? 600 : 400, color: room === rm ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>{rm}</button>
                        ))}
                      </div>
                    </div>
                    <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 14 }}>Style</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {VIBES.map((v) => (
                          <button key={v} onClick={() => setVibe(vibe === v ? null : v)} style={{ padding: "10px 14px", borderRadius: 8, border: vibe === v ? "1.5px solid #1A1815" : "1px solid #E8E0D8", background: vibe === v ? "#1A1815" : "#FDFCFA", fontSize: 12, fontWeight: vibe === v ? 600 : 400, color: vibe === v ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>{v}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Palette preview */}
                  {currentPalette && (
                    <div style={{ marginBottom: 20, padding: "16px 20px", background: "#fff", borderRadius: 14, border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <p style={{ fontSize: 13, fontStyle: "italic", color: "#5A5045", lineHeight: 1.5, margin: 0 }}>{currentPalette.feel}</p>
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#7A6B5B" }}>
                          <div><span style={{ fontWeight: 700, color: "#1A1815", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>Colors</span><br/>{currentPalette.colors.join(" · ")}</div>
                          <div><span style={{ fontWeight: 700, color: "#1A1815", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>Materials</span><br/>{currentPalette.materials.join(" · ")}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Budget + Dimensions — compact row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 20 }}>
                    <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 14 }}>Budget</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{budgets.map(([id, lb]) => <Pill key={id} active={bud === id} onClick={() => setBud(id)}>{lb}</Pill>)}</div>
                    </div>
                    <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 14 }}>Dimensions</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <input value={roomW} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setRoomW(v); if (v && roomL) setSqft(String(Math.round(parseFloat(v) * parseFloat(roomL)))); }} placeholder="W (ft)" style={{ flex: 1, padding: "9px 10px", border: "1px solid #E8E0D8", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", minWidth: 0, background: "#FDFCFA" }} />
                        <span style={{ color: "#C8BEB4", fontSize: 12 }}>{"×"}</span>
                        <input value={roomL} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setRoomL(v); if (roomW && v) setSqft(String(Math.round(parseFloat(roomW) * parseFloat(v)))); }} placeholder="L (ft)" style={{ flex: 1, padding: "9px 10px", border: "1px solid #E8E0D8", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", minWidth: 0, background: "#FDFCFA" }} />
                      </div>
                      <input value={sqft} onChange={(e) => setSqft(e.target.value.replace(/\D/g, ""))} placeholder="or total sqft" style={{ width: "100%", padding: "9px 10px", border: "1px solid #E8E0D8", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#FDFCFA" }} />
                      {sqft && <div style={{ marginTop: 6, fontSize: 11, color: "#8A7B6B" }}>{roomW && roomL ? roomW + "' × " + roomL + "' = " + sqft + " sqft" : sqft + " sqft"}</div>}
                    </div>
                  </div>

                  {/* Uploads — clean drag area style */}
                  <div className="aura-upload-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
                    <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 4 }}>Floor Plan / CAD</div>
                      <div style={{ fontSize: 11, color: "#9B8B7B", marginBottom: 12, lineHeight: 1.4 }}>For precise furniture placement</div>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "20px", background: "#FDFCFA", border: "1.5px dashed #D8D0C8", borderRadius: 10, fontSize: 12, color: "#7A6B5B", cursor: "pointer", transition: "all .15s" }}>
                        <span style={{ fontSize: 18, opacity: 0.5 }}>{"\uD83D\uDCC0"}</span>
                        <span style={{ fontWeight: 500 }}>{cadLoading ? "Analyzing..." : "Upload floor plan"}</span>
                        <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleCad} style={{ display: "none" }} disabled={cadLoading} />
                      </label>
                      {cadFile && <div style={{ fontSize: 11, color: "#5B8B6B", fontWeight: 600, marginTop: 8 }}>{cadFile.name}</div>}
                      {cadLoading && <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", display: "inline-block", marginTop: 8 }} />}
                      {cadAnalysis && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: "#F8F5F0", borderRadius: 8, fontSize: 11, color: "#5A5045", lineHeight: 1.5, maxHeight: 80, overflowY: "auto" }}>
                          {cadAnalysis.slice(0, 150)}{cadAnalysis.length > 150 ? "..." : ""}
                        </div>
                      )}
                    </div>
                    <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
                      <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 4 }}>Room Photo</div>
                      <div style={{ fontSize: 11, color: "#9B8B7B", marginBottom: 12, lineHeight: 1.4 }}>AI designs within your actual room</div>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "20px", background: "#FDFCFA", border: "1.5px dashed #D8D0C8", borderRadius: 10, fontSize: 12, color: "#7A6B5B", cursor: "pointer", transition: "all .15s" }}>
                        <span style={{ fontSize: 18, opacity: 0.5 }}>{"\uD83D\uDCF7"}</span>
                        <span style={{ fontWeight: 500 }}>{roomPhotoLoading ? "Analyzing..." : "Upload photo"}</span>
                        <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleRoomPhoto} style={{ display: "none" }} disabled={roomPhotoLoading} />
                      </label>
                      {roomPhoto && <div style={{ fontSize: 11, color: "#5B8B6B", fontWeight: 600, marginTop: 8 }}>{roomPhoto.name}</div>}
                      {roomPhotoLoading && <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", display: "inline-block", marginTop: 8 }} />}
                      {roomPhoto && !roomPhotoLoading && (
                        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <img src={roomPhoto.data} alt="Your room" style={{ width: 56, height: 42, objectFit: "cover", borderRadius: 6, border: "1px solid #E8E0D8" }} />
                          {roomPhotoAnalysis && <div style={{ flex: 1, fontSize: 10, color: "#7A6B5B", lineHeight: 1.4, maxHeight: 50, overflowY: "auto" }}>{roomPhotoAnalysis.slice(0, 120)}...</div>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Continue button — full width, prominent */}
                  <button onClick={() => setDesignStep(1)} disabled={!room || !vibe} style={{ width: "100%", background: room && vibe ? "#1A1815" : "#E8E0D8", color: room && vibe ? "#fff" : "#B8A898", padding: "18px 48px", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: room && vibe ? "pointer" : "default", fontFamily: "inherit", transition: "all .2s", letterSpacing: ".02em" }}>
                    {room && vibe ? "Continue to Design →" : "Select a room and style to continue"}
                  </button>
                </div>
              )}

              {/* ═══════ STEP 1: DESIGN WITH AI ═══════ */}
              {designStep === 1 && (
                <div>
                  {/* Compact summary bar */}
                  <div style={{ padding: "10px 5%", background: "#fff", borderBottom: "1px solid #EDE8E0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{room || "Room"}</span>
                      <span style={{ fontSize: 12, color: "#9B8B7B", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{vibe || "Style"}</span>
                      {sqft && <span style={{ fontSize: 11, color: "#9B8B7B" }}>{sqft} sqft</span>}
                      {roomPhoto && <span style={{ fontSize: 10, color: "#5B8B6B", background: "#EDF5EE", padding: "3px 8px", borderRadius: 4 }}>Photo uploaded</span>}
                      {sel.size > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1815", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{selCount} items · {fmt(selTotal)}</span>}
                    </div>
                    <button onClick={() => setDesignStep(0)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Edit</button>
                  </div>

                  {/* Mood Boards */}
                  {!boards && room && vibe && (
                    <div style={{ padding: "14px 5%", background: "#FDFCFA", borderBottom: "1px solid #EDE8E0" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                        <p style={{ fontSize: 13, color: "#7A6B5B", margin: 0 }}>Get AI-curated product collections for your space</p>
                        <button onClick={() => { triggerMoodBoards(room, vibe, bud, sqft); setBoardsGenHint("Mood boards generated from your selections"); }} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Generate Mood Boards</button>
                      </div>
                    </div>
                  )}
                  {boards && (
                    <div style={{ padding: "20px 5% 16px", background: "#FDFCFA", borderBottom: "1px solid #EDE8E0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                        <div>
                          <p style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, margin: "0 0 2px" }}>Mood Boards</p>
                          {boardsGenHint && <p style={{ fontSize: 11, color: "#B8A898", margin: 0 }}>{boardsGenHint}</p>}
                        </div>
                        <div className="aura-mood-tabs" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {boards.map((b, i) => (
                            <button key={i} onClick={() => setActiveBoard(i)} style={{ padding: "6px 14px", fontSize: 11, fontWeight: activeBoard === i ? 600 : 400, background: activeBoard === i ? "#1A1815" : "transparent", color: activeBoard === i ? "#fff" : "#7A6B5B", border: activeBoard === i ? "none" : "1px solid #E8E0D8", borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>{b.name}</button>
                          ))}
                        </div>
                      </div>
                      {boards[activeBoard] && (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                            <p style={{ fontSize: 12, color: "#7A6B5B", fontStyle: "italic", margin: 0 }}>{boards[activeBoard].desc}</p>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815" }}>{boards[activeBoard].items.length} pieces · {fmt(boards[activeBoard].totalBudget)}</span>
                              <button onClick={() => addBoard(activeBoard)} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Add All</button>
                            </div>
                          </div>
                          <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
                            {boards[activeBoard].items.map((p) => <Card key={p.id} p={p} sel={sel.has(p.id)} toggle={toggle} small />)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Chat — cleaner, more professional */}
                  <div style={{ padding: "20px 5%", background: "#F5F2ED" }}>
                    <div className="aura-chat-box" style={{ background: "#fff", borderRadius: 14, padding: 0, maxWidth: 900, boxShadow: "0 1px 4px rgba(0,0,0,.04)", border: "1px solid #EDE8E0", overflow: "hidden" }}>
                      <div style={{ padding: "14px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#5B8B6B" }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815", letterSpacing: ".04em" }}>AI Designer</span>
                        </div>
                        <span style={{ fontSize: 10, color: "#B8A898" }}>Ask about products, colors, layouts</span>
                      </div>
                      <div ref={chatBoxRef} style={{ maxHeight: 400, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10, WebkitOverflowScrolling: "touch" }}>
                        {msgs.map((m, i) => (
                          <div key={i}>
                            <div style={{ padding: m.role === "user" ? "10px 14px" : "12px 16px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", fontSize: 14, lineHeight: 1.65, maxWidth: m.role === "user" ? "80%" : "100%", background: m.role === "user" ? "#1A1815" : "#F8F5F0", color: m.role === "user" ? "#fff" : "#3A3530", marginLeft: m.role === "user" ? "auto" : 0, wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: (m.text || "")
                              .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#8B6040;font-weight:700">$1</strong>')
                              .replace(/_(.*?)_/g, "<em>$1</em>")
                              .replace(/^\d+[\.\)]\s*/gm, "")
                              .replace(/^[-•]\s*/gm, "")
                              .replace(/\n{2,}/g, '</p><p style="margin:10px 0 0">')
                              .replace(/\n/g, "<br/>")
                              .replace(/^/, '<p style="margin:0">')
                              .replace(/$/, "</p>")
                            }} />
                            {m.recs?.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                                <p style={{ fontSize: 10, color: "#B8A898", marginBottom: 6 }}>Tap + to add to your selection</p>
                                <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }}>
                                  {m.recs.map((p) => <Card key={p.id} p={p} small sel={sel.has(p.id)} toggle={toggle} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {busy && (
                          <div style={{ color: "#9B8B7B", fontSize: 13, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
                            Designing your space...
                          </div>
                        )}
                        <div ref={chatEnd} />
                      </div>
                      <div className="aura-chat-input" style={{ padding: "14px 16px", borderTop: "1px solid #F0EBE4", background: "#FDFCFA" }}>
                        <div style={{ display: "flex", gap: 0, border: "1.5px solid #D8D0C8", borderRadius: 12, background: "#fff", overflow: "hidden", transition: "border-color .15s" }}>
                          <input value={inp} onChange={(e) => setInp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={room ? "Ask AI: What do you need for your " + room.toLowerCase() + "?" : "Ask AI: Describe your ideal space..."} style={{ flex: 1, background: "transparent", border: "none", padding: "14px 18px", fontFamily: "inherit", fontSize: 15, outline: "none", color: "#1A1815" }} />
                          <button onClick={send} disabled={busy} style={{ background: "#1A1815", color: "#fff", border: "none", padding: "10px 20px", margin: 5, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.3 : 1, fontFamily: "inherit", whiteSpace: "nowrap" }}>Send</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Continue to Visualize — sticky bottom bar */}
                  {sel.size > 0 && (
                    <div style={{ padding: "14px 5%", background: "#fff", borderTop: "1px solid #EDE8E0", position: "sticky", bottom: 0, zIndex: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 900, margin: "0 auto" }}>
                        <span style={{ fontSize: 13, color: "#5A5045" }}><strong>{selCount}</strong> items · <strong>{fmt(selTotal)}</strong></span>
                        <button onClick={() => setDesignStep(2)} style={{ background: "#1A1815", color: "#fff", padding: "12px 28px", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Review & Visualize →</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══════ STEP 2: REVIEW & VISUALIZE ═══════ */}
              {designStep === 2 && (
                <div>
                  {/* Back bar */}
                  <div style={{ padding: "10px 5%", background: "#fff", borderBottom: "1px solid #EDE8E0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{room || "Room"}</span>
                      <span style={{ fontSize: 12, color: "#9B8B7B", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{vibe || "Style"}</span>
                      {sqft && <span style={{ fontSize: 11, color: "#9B8B7B" }}>{sqft} sqft</span>}
                    </div>
                    <button onClick={() => setDesignStep(1)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>{"←"} Design</button>
                  </div>

              {/* Selection + CAD Layout + Viz */}
              {sel.size > 0 ? (
                <div style={{ padding: "28px 5%", background: "#FDFCFA" }}>
                  <div className="aura-sel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <p style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 4 }}>Your Selection</p>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400, letterSpacing: "-0.02em" }}>{selCount} items · {fmt(selTotal)}</h2>
                    </div>
                    <div className="aura-sel-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button onClick={generateViz} disabled={vizSt === "loading"} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: vizSt === "loading" ? 0.5 : 1, transition: "opacity .2s" }}>{vizSt === "loading" ? "Generating..." : "Visualize Room →"}</button>
                      <button onClick={() => { setSel(new Map()); setVizUrls([]); setVizSt("idle"); setVizErr(""); setCadLayout(null); setDesignStep(1); }} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 8, padding: "8px 16px", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Clear</button>
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

                  {/* Viz info */}
                  {vizErr && <p style={{ fontSize: 12, color: "#C17550", marginBottom: 16, background: "#FFF8F0", padding: "12px 16px", borderRadius: 10, border: "1px solid #F0D8C0" }}>{vizErr}</p>}
                  <div ref={vizAreaRef}>
                  {vizSt === "loading" && (
                    <div style={{ marginBottom: 24, borderRadius: 14, border: "1px solid #EDE8E0", padding: "48px 32px", textAlign: "center", background: "#fff" }}>
                      <div style={{ width: 36, height: 36, border: "2.5px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 16px" }} />
                      <p style={{ fontSize: 15, color: "#1A1815", margin: 0, fontWeight: 500 }}>Generating visualization</p>
                      <p style={{ fontSize: 13, color: "#9B8B7B", margin: "6px 0 0" }}>{selItems.length} products · {roomPhotoAnalysis ? "Matching your room photo" : "Creating scene"}</p>
                      <p style={{ fontSize: 11, color: "#C8BEB4", margin: "4px 0 0" }}>This may take up to a minute</p>
                    </div>
                  )}
                  </div>
                  {vizUrls.length > 0 && (
                    <div className="aura-viz-grid" style={{ display: "grid", gridTemplateColumns: vizUrls.length === 1 ? "1fr" : "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 24 }}>
                      {vizUrls.map((v, i) => (
                        <div key={i} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #F0EBE4" }}>
                          {v.concept ? (
                            /* Beautiful concept card fallback when AI images aren't available */
                            <div style={{ width: "100%", minHeight: 220, background: `linear-gradient(135deg, ${["#E8DDD0","#D4CFC8","#E0D8CC"][i]}, ${["#D8C8B8","#C8C0B4","#C8BFB0"][i]})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", position: "relative" }}>
                              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.06, background: `repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(0,0,0,.1) 35px, rgba(0,0,0,.1) 36px)` }} />
                              <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>{["\u2600\uFE0F","\uD83C\uDF05","\uD83C\uDF19"][i]}</div>
                              <div style={{ fontFamily: "Georgia,serif", fontSize: 18, color: "#6B5B4B", textAlign: "center", marginBottom: 8, fontStyle: "italic" }}>{v.label}</div>
                              <div style={{ fontSize: 11, color: "#8B7B6B", textAlign: "center", lineHeight: 1.5, maxWidth: 240 }}>
                                {(v.products || []).slice(0, 3).join(" \u00B7 ")}
                              </div>
                              <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                                {(v.colors || []).map((c, ci) => <span key={ci} style={{ fontSize: 9, background: "rgba(255,255,255,.6)", padding: "3px 10px", borderRadius: 12, color: "#7A6B5B" }}>{c}</span>)}
                              </div>
                              <div style={{ marginTop: 16, fontSize: 10, color: "#A09080", letterSpacing: ".1em", textTransform: "uppercase" }}>Design Concept</div>
                            </div>
                          ) : (
                            <img src={v.url || v} alt={"Room visualization " + (i + 1)} loading="lazy" style={{ width: "100%", height: "auto", minHeight: 200, objectFit: "cover", display: "block", background: "#F0EBE4" }} />
                          )}
                          <div style={{ padding: "10px 16px", background: "#fff" }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#C17550", margin: 0 }}>{v.label || ["Morning Light", "Golden Hour", "Evening Ambiance"][i] || "Variation " + (i + 1)}</p>
                            <p style={{ fontSize: 10, color: "#B8A898", margin: 0 }}>{room || "Room"} — {vibe || "Modern"}{roomPhotoAnalysis ? " — based on your room" : ""}{v.concept ? " — concept preview" : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14 }}>
                    {selItems.map((p) => (
                      <div key={p.id}>
                        <Card p={p} sel toggle={toggle} small />
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "6px 0" }}>
                          <button onClick={() => setQty(p.id, (sel.get(p.id) || 1) - 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid #E8E0D8", background: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", color: "#5A5045" }}>-</button>
                          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 20, textAlign: "center" }}>{sel.get(p.id) || 1}</span>
                          <button onClick={() => setQty(p.id, (sel.get(p.id) || 1) + 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid #E8E0D8", background: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", color: "#5A5045" }}>+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: "80px 5%", textAlign: "center", background: "#FDFCFA" }}>
                  <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#F5F0EB", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24, opacity: 0.4 }}>{"\uD83D\uDED2"}</div>
                  <h3 style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 400, color: "#1A1815", marginBottom: 8, letterSpacing: "-0.01em" }}>No items selected</h3>
                  <p style={{ fontSize: 14, color: "#9B8B7B", maxWidth: 360, margin: "0 auto 28px", lineHeight: 1.5 }}>Use the AI chat or mood boards to add products to your design.</p>
                  <button onClick={() => setDesignStep(1)} style={{ background: "#1A1815", color: "#fff", padding: "14px 28px", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{"←"} Back to Design</button>
                </div>
              )}
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
              <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>My Projects</p>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400 }}>Saved ({projects.length})</h2>
                </div>
                <button onClick={newProject} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ New Project</button>
              </div>
              {!user ? (
                <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center" }}>
                  <p style={{ color: "#B8A898", marginBottom: 16 }}>Sign in to save and manage projects.</p>
                  <button onClick={() => go("auth")} style={{ background: "#C17550", color: "#fff", padding: "14px 28px", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Sign In</button>
                </div>
              ) : projects.length === 0 ? (
                <div style={{ background: "#fff", borderRadius: 16, padding: 48, textAlign: "center" }}>
                  <p style={{ color: "#B8A898", marginBottom: 16 }}>No projects yet. Start designing and save your work!</p>
                  <button onClick={newProject} style={{ background: "#C17550", color: "#fff", padding: "14px 28px", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Start a New Project</button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
                  {projects.map((pr) => (
                    <div key={pr.id} style={{ background: "#fff", borderRadius: 16, border: activeProjectId === pr.id ? "2px solid #C17550" : "1px solid #F0EBE4", overflow: "hidden", transition: "border .2s, box-shadow .2s", boxShadow: activeProjectId === pr.id ? "0 4px 20px rgba(193,117,80,.12)" : "none" }}>
                      <div style={{ padding: "20px 22px 16px" }}>
                        {editingProjectName === pr.id ? (
                          <input autoFocus defaultValue={pr.name} onBlur={(e) => renameProject(pr.id, e.target.value || pr.name)} onKeyDown={(e) => { if (e.key === "Enter") renameProject(pr.id, e.target.value || pr.name); if (e.key === "Escape") setEditingProjectName(null); }} style={{ fontFamily: "Georgia,serif", fontSize: 17, border: "1px solid #C17550", borderRadius: 8, padding: "4px 10px", width: "100%", outline: "none", boxSizing: "border-box" }} />
                        ) : (
                          <div onClick={() => setEditingProjectName(pr.id)} style={{ fontFamily: "Georgia,serif", fontSize: 17, cursor: "text" }} title="Click to rename">{pr.name}</div>
                        )}
                        <div style={{ fontSize: 12, color: "#B8A898", marginTop: 6 }}>
                          {pr.room || "No room"} {pr.vibe ? "• " + pr.vibe : ""} {pr.sqft ? "• " + pr.sqft + " sqft" : ""}
                        </div>
                        <div style={{ fontSize: 12, color: "#9B8B7B", marginTop: 4 }}>
                          {(pr.items || []).length} items — {fmt(pr.total || 0)}
                        </div>
                        {activeProjectId === pr.id && <span style={{ display: "inline-block", background: "#C17550", color: "#fff", fontSize: 9, fontWeight: 700, padding: "3px 10px", borderRadius: 12, marginTop: 8, letterSpacing: ".08em", textTransform: "uppercase" }}>Active</span>}
                      </div>
                      <div style={{ borderTop: "1px solid #F0EBE4", padding: "12px 22px", display: "flex", gap: 8 }}>
                        <button onClick={() => loadPr(pr)} style={{ flex: 1, background: activeProjectId === pr.id ? "#F8F5F0" : "#C17550", color: activeProjectId === pr.id ? "#C17550" : "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{activeProjectId === pr.id ? "Already Open" : "Open"}</button>
                        <button onClick={() => delPr(pr.id)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "7px 14px", fontSize: 11, color: "#B8A898", cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* FOOTER */}
      <footer style={{ background: "#fff", borderTop: "1px solid #F0EBE4", padding: "28px 5%", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><AuraLogo size={22} /><span style={{ fontFamily: "Georgia,serif", fontSize: 18 }}>AURA</span></div>
        <div style={{ display: "flex", gap: 24 }}>
          {[["Design", () => { go("design"); setTab("studio"); }], ["Catalog", () => { go("design"); setTab("catalog"); }], ["Pricing", () => go("pricing")]].map(([l, fn]) => (
            <span key={l} onClick={fn} style={{ fontSize: 12, cursor: "pointer", color: "#B8A898" }}>{l}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}

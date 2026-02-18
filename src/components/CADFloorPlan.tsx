import React from "react";
import { FURN_DIMS } from "../constants";
import { getProductDims } from "../engine/designEngine";
import { CAT_COLORS } from "./Card";
import type { CADLayout, FurnitureCategory } from "../types";

interface CADFloorPlanProps { layout: CADLayout | null; roomType: string; style: string; }

export default function CADFloorPlan({ layout, roomType, style }: CADFloorPlanProps) {
  if (!layout) return null;
  const { placed, canvasW, canvasH, roomW, roomH, windows, doors, scale, clearances, trafficPaths, dimensions } = layout;
  const margin = 40; // extra space around the room for annotations
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E8E0D8", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "#C17550", fontWeight: 700, margin: 0 }}>Precision Floor Plan</p>
          <p style={{ fontSize: 11, color: "#9B8B7B", margin: "4px 0 0" }}>{roomType} — {roomW}′ × {roomH}′ ({Math.round(roomW * roomH)} sqft) — {style}</p>
        </div>
        <div style={{ fontSize: 10, color: "#B8A898", display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 12, height: 3, background: "#E8A87C", borderRadius: 2, display: "inline-block" }} />Traffic
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 10, height: 10, background: "#C1755015", border: "1px dashed #C17550", borderRadius: 1, display: "inline-block" }} />Clearance
          </span>
          <span>1 sq = 1 ft</span>
        </div>
      </div>
      <div style={{ padding: 20, overflowX: "auto" }}>
        <svg width={canvasW + margin * 2} height={canvasH + margin * 2} viewBox={`${-margin} ${-margin} ${canvasW + margin * 2} ${canvasH + margin * 2}`} style={{ maxWidth: "100%", height: "auto" }}>
          {/* Grid */}
          <defs>
            <pattern id="grid" width={scale} height={scale} patternUnits="userSpaceOnUse">
              <path d={`M ${scale} 0 L 0 0 0 ${scale}`} fill="none" stroke="#F0EBE4" strokeWidth="0.5" />
            </pattern>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#C17550" opacity="0.5" />
            </marker>
            <marker id="dimArrow" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
              <polygon points="0 0, 5 2, 0 4" fill="#8B7355" opacity="0.7" />
            </marker>
            <marker id="dimArrowR" markerWidth="5" markerHeight="4" refX="1" refY="2" orient="auto">
              <polygon points="5 0, 0 2, 5 4" fill="#8B7355" opacity="0.7" />
            </marker>
          </defs>
          <rect width={canvasW} height={canvasH} fill="url(#grid)" stroke="#D8D0C8" strokeWidth="2" rx="4" />

          {/* Walls — thick architectural style */}
          <rect x="-3" y="-3" width={canvasW + 6} height={canvasH + 6} fill="none" stroke="#6B5A48" strokeWidth="6" rx="4" />
          {/* Inner wall line (double-wall effect) */}
          <rect x="0" y="0" width={canvasW} height={canvasH} fill="none" stroke="#8B7355" strokeWidth="1.5" rx="4" />

          {/* ─── TRAFFIC FLOW PATHS ─── */}
          {trafficPaths && trafficPaths.map((path, i) => {
            if (path.label === "2.5′ Walkway") {
              // Perimeter walkway — dashed rectangle
              return (
                <g key={"tp" + i}>
                  <polyline
                    points={path.points.map(p => `${p.x},${p.y}`).join(" ")}
                    fill="none" stroke="#E8A87C" strokeWidth="1" strokeDasharray="8,6" opacity="0.35"
                  />
                  <text x={path.points[0].x + 4} y={path.points[0].y - 4} fontSize="7" fill="#E8A87C" opacity="0.6">2.5′ walkway</text>
                </g>
              );
            }
            // Main traffic path — curved smooth line with arrow
            const pts = path.points;
            if (pts.length < 2) return null;
            let d = `M ${pts[0].x} ${pts[0].y}`;
            for (let j = 1; j < pts.length; j++) {
              if (j < pts.length - 1) {
                // Smooth curve through intermediate points
                const cx = (pts[j].x + pts[j + 1].x) / 2;
                const cy = (pts[j].y + pts[j + 1].y) / 2;
                d += ` Q ${pts[j].x} ${pts[j].y} ${cx} ${cy}`;
              } else {
                d += ` L ${pts[j].x} ${pts[j].y}`;
              }
            }
            return (
              <g key={"tp" + i}>
                {/* Glow effect */}
                <path d={d} fill="none" stroke="#E8A87C" strokeWidth="10" opacity="0.08" strokeLinecap="round" />
                {/* Main path */}
                <path d={d} fill="none" stroke="#E8A87C" strokeWidth="2.5" opacity="0.4" strokeLinecap="round" strokeDasharray="12,6" markerEnd="url(#arrowhead)" />
                <text x={pts[Math.floor(pts.length / 2)].x + 8} y={pts[Math.floor(pts.length / 2)].y - 6} fontSize="7" fill="#C17550" opacity="0.6" fontWeight="600">{path.label}</text>
              </g>
            );
          })}

          {/* ─── CLEARANCE ZONES ─── */}
          {clearances && clearances.map((cz, i) => (
            <g key={"cz" + i}>
              <rect x={cz.x} y={cz.y} width={cz.w} height={cz.h} fill="#C1755008" stroke="#C17550" strokeWidth="0.5" strokeDasharray="4,3" rx="2" />
              {cz.w > 30 && cz.h > 15 && (
                <text
                  x={cz.x + cz.w / 2} y={cz.y + cz.h / 2 + 3}
                  textAnchor="middle" fontSize="6.5" fill="#C17550" opacity="0.6"
                >{cz.label}</text>
              )}
            </g>
          ))}

          {/* ─── WINDOWS — with glass panes ─── */}
          {windows.map((w, i) => {
            const wY = w.side === "top" ? -3 : canvasH - 5;
            const dimFt = Math.round(w.w / scale * 10) / 10;
            return (
              <g key={"w" + i}>
                {/* Window frame */}
                <rect x={w.x} y={wY} width={w.w} height={8} fill="#D4EBF5" stroke="#7BA8C8" strokeWidth="1.5" rx="1" />
                {/* Glass pane dividers */}
                <line x1={w.x + w.w / 3} y1={wY + 1} x2={w.x + w.w / 3} y2={wY + 7} stroke="#7BA8C8" strokeWidth="0.5" />
                <line x1={w.x + w.w * 2 / 3} y1={wY + 1} x2={w.x + w.w * 2 / 3} y2={wY + 7} stroke="#7BA8C8" strokeWidth="0.5" />
                {/* Dimension label */}
                <text x={w.x + w.w / 2} y={w.side === "top" ? -10 : canvasH + 18} textAnchor="middle" fontSize="8" fill="#7BA8C8" fontWeight="600">
                  Window ({dimFt}′)
                </text>
              </g>
            );
          })}

          {/* ─── DOORS — with swing arc ─── */}
          {doors.map((d, i) => {
            const doorWidthFt = Math.round(d.w / scale * 10) / 10;
            if (d.side === "right") {
              // Door on right wall with inward swing arc
              const doorY = d.y;
              const doorH = d.w;
              return (
                <g key={"d" + i}>
                  {/* Door opening (gap in wall) */}
                  <rect x={canvasW - 3} y={doorY} width={6} height={doorH} fill="#FDFCFA" stroke="none" />
                  {/* Door panel */}
                  <rect x={canvasW - 4} y={doorY} width={4} height={doorH} fill="#E8DDD0" stroke="#A89B8B" strokeWidth="1.5" rx="1" />
                  {/* Swing arc (90° quarter-circle inward) */}
                  <path
                    d={`M ${canvasW - 4} ${doorY} A ${doorH} ${doorH} 0 0 0 ${canvasW - 4 - doorH} ${doorY + doorH}`}
                    fill="none" stroke="#A89B8B" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.5"
                  />
                  {/* Swing direction line */}
                  <line x1={canvasW - 4} y1={doorY} x2={canvasW - 4 - doorH * 0.7} y2={doorY + doorH * 0.7} stroke="#A89B8B" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                  {/* Label */}
                  <text x={canvasW + 12} y={doorY + doorH / 2 + 3} fontSize="8" fill="#A89B8B" fontWeight="600">Door ({doorWidthFt}′)</text>
                </g>
              );
            } else {
              // Door on bottom wall
              const doorX = d.x;
              return (
                <g key={"d" + i}>
                  {/* Door opening */}
                  <rect x={doorX} y={canvasH - 3} width={d.w} height={6} fill="#FDFCFA" stroke="none" />
                  {/* Door panel */}
                  <rect x={doorX} y={canvasH - 4} width={d.w} height={4} fill="#E8DDD0" stroke="#A89B8B" strokeWidth="1.5" rx="1" />
                  {/* Swing arc */}
                  <path
                    d={`M ${doorX + d.w} ${canvasH - 4} A ${d.w} ${d.w} 0 0 0 ${doorX} ${canvasH - 4 - d.w}`}
                    fill="none" stroke="#A89B8B" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.5"
                  />
                  <line x1={doorX + d.w} y1={canvasH - 4} x2={doorX + d.w * 0.3} y2={canvasH - 4 - d.w * 0.7} stroke="#A89B8B" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
                  <text x={doorX + d.w / 2} y={canvasH + 18} textAnchor="middle" fontSize="8" fill="#A89B8B" fontWeight="600">Door ({doorWidthFt}′)</text>
                </g>
              );
            }
          })}

          {/* ─── FURNITURE — architectural plan symbols ─── */}
          {placed.map((p, i) => {
            const prodDims = getProductDims(p.item);
            const isRound = prodDims.shape === "round";
            const isOval = prodDims.shape === "oval";
            const isL = prodDims.shape === "L";
            const isBed = prodDims.shape === "bed" || p.item.c === "bed";
            const isRug = p.item.c === "rug";
            const cat = p.item.c;
            const c = p.color;
            const dimLabel = Math.round(prodDims.w * 10) / 10 + "′ × " + Math.round(prodDims.d * 10) / 10 + "′";
            const labelFs = Math.min(10, Math.max(6, p.w / 7));
            const nameFs = Math.min(7, Math.max(5, p.w / 9));
            const dimFs = Math.min(6.5, Math.max(4.5, p.w / 10));
            const truncName = (p.item.n || "").length > 18 ? (p.item.n || "").slice(0, 16) + "…" : p.item.n;

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
                  <rect width={p.w} height={p.h} fill={c + "15"} stroke={c} strokeWidth="2" rx="4" />
                  <rect x={-2} y={-2} width={p.w + 4} height={p.h * 0.08} fill={c} rx="3" opacity="0.7" />
                  <rect x={p.w * 0.08} y={p.h * 0.1} width={p.w * 0.38} height={p.h * 0.1} fill={c + "30"} stroke={c + "60"} strokeWidth="0.8" rx="4" />
                  <rect x={p.w * 0.54} y={p.h * 0.1} width={p.w * 0.38} height={p.h * 0.1} fill={c + "30"} stroke={c + "60"} strokeWidth="0.8" rx="4" />
                  <line x1={p.w * 0.06} y1={p.h * 0.55} x2={p.w * 0.94} y2={p.h * 0.55} stroke={c + "40"} strokeWidth="0.8" />
                  <text x={p.w / 2} y={p.h * 0.4} textAnchor="middle" fontSize={labelFs} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Bed"}</text>
                  <text x={p.w / 2} y={p.h * 0.4 + 11} textAnchor="middle" fontSize={nameFs} fill={c + "AA"} fontFamily="Helvetica Neue,sans-serif">{truncName}</text>
                  <text x={p.w / 2} y={p.h * 0.4 + 21} textAnchor="middle" fontSize={dimFs} fill={c + "77"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── SOFA — seat cushions + back + arms ─── */}
                {cat === "sofa" && !isRug && !isBed && !isL && <>
                  <rect width={p.w} height={p.h} fill={c + "18"} stroke={c} strokeWidth="2" rx="5" />
                  <rect x={2} y={p.h * 0.7} width={p.w - 4} height={p.h * 0.28} fill={c + "25"} stroke={c + "50"} strokeWidth="0.8" rx="4" />
                  {p.w > 200 ? <>
                    <rect x={p.w * 0.06} y={p.h * 0.08} width={p.w * 0.28} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                    <rect x={p.w * 0.36} y={p.h * 0.08} width={p.w * 0.28} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                    <rect x={p.w * 0.66} y={p.h * 0.08} width={p.w * 0.28} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                  </> : <>
                    <rect x={p.w * 0.06} y={p.h * 0.08} width={p.w * 0.42} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                    <rect x={p.w * 0.52} y={p.h * 0.08} width={p.w * 0.42} height={p.h * 0.58} fill={c + "12"} stroke={c + "35"} strokeWidth="0.5" rx="4" />
                  </>}
                  <rect x={-2} y={p.h * 0.1} width={6} height={p.h * 0.8} fill={c + "30"} rx="3" />
                  <rect x={p.w - 4} y={p.h * 0.1} width={6} height={p.h * 0.8} fill={c + "30"} rx="3" />
                  <text x={p.w / 2} y={p.h / 2 - 4} textAnchor="middle" fontSize={labelFs} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Sofa"}</text>
                  <text x={p.w / 2} y={p.h / 2 + 7} textAnchor="middle" fontSize={dimFs} fill={c + "88"} fontFamily="Helvetica Neue,sans-serif">{dimLabel}</text>
                </>}

                {/* ─── L-SHAPE SECTIONAL ─── */}
                {cat === "sofa" && isL && <>
                  <path d={`M4,0 L${p.w},0 L${p.w},${p.h * 0.45} L${p.w * 0.45},${p.h * 0.45} L${p.w * 0.45},${p.h} L0,${p.h} L0,4 Q0,0 4,0 Z`} fill={c + "18"} stroke={c} strokeWidth="2" />
                  <rect x={4} y={p.h * 0.72} width={p.w * 0.42} height={p.h * 0.25} fill={c + "20"} stroke={c + "40"} strokeWidth="0.5" rx="3" />
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
                    <rect x={p.w * 0.1} y={p.h * 0.1} width={p.w * 0.8} height={p.h * 0.55} fill={c + "12"} stroke={c + "25"} strokeWidth="0.5" rx="3" />
                    <rect x={p.w * 0.08} y={p.h * 0.68} width={p.w * 0.84} height={p.h * 0.26} fill={c + "22"} stroke={c + "40"} strokeWidth="0.5" rx="3" />
                  </>}
                  <text x={p.w / 2} y={p.h / 2 + 1} textAnchor="middle" fontSize={Math.min(labelFs, 8)} fill={c} fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Chair"}</text>
                </>}

                {/* ─── STOOL ─── */}
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

                {/* ─── LIGHT ─── */}
                {cat === "light" && <>
                  <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2 + 4} fill="#FFD70008" stroke="none" />
                  <circle cx={p.w / 2} cy={p.h / 2} r={Math.min(p.w, p.h) / 2} fill="#FFD70015" stroke="#D4A020" strokeWidth="1.5" />
                  <circle cx={p.w / 2} cy={p.h / 2} r={3} fill="#FFD70050" />
                  <text x={p.w / 2} y={p.h / 2 + Math.min(p.w, p.h) / 2 + 10} textAnchor="middle" fontSize={6} fill="#9B8B7B" fontFamily="Helvetica Neue,sans-serif">{prodDims.label || "Light"}</text>
                </>}

                {/* ─── ART ─── */}
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

                {/* ─── ACCENT / STORAGE ─── */}
                {(cat === "accent" || cat === "decor" || cat === "storage") && <>
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

          {/* ─── DIMENSION LINES ─── */}
          {dimensions && dimensions.map((dim, i) => {
            const isVertical = Math.abs(dim.x1 - dim.x2) < 2;
            const mx = (dim.x1 + dim.x2) / 2;
            const my = (dim.y1 + dim.y2) / 2;
            return (
              <g key={"dim" + i}>
                <line x1={dim.x1} y1={dim.y1} x2={dim.x2} y2={dim.y2} stroke="#8B7355" strokeWidth="0.8" opacity="0.5" markerEnd="url(#dimArrow)" markerStart="url(#dimArrowR)" />
                {/* Tick marks at ends */}
                {isVertical ? <>
                  <line x1={dim.x1 - 4} y1={dim.y1} x2={dim.x1 + 4} y2={dim.y1} stroke="#8B7355" strokeWidth="0.8" opacity="0.5" />
                  <line x1={dim.x2 - 4} y1={dim.y2} x2={dim.x2 + 4} y2={dim.y2} stroke="#8B7355" strokeWidth="0.8" opacity="0.5" />
                </> : <>
                  <line x1={dim.x1} y1={dim.y1 - 4} x2={dim.x1} y2={dim.y1 + 4} stroke="#8B7355" strokeWidth="0.8" opacity="0.5" />
                  <line x1={dim.x2} y1={dim.y2 - 4} x2={dim.x2} y2={dim.y2 + 4} stroke="#8B7355" strokeWidth="0.8" opacity="0.5" />
                </>}
                {/* Label with background */}
                <rect x={mx - 12} y={my - 6} width={24} height={12} fill="#FDFCFA" stroke="none" rx="2" opacity="0.85" />
                <text x={mx} y={my + 3} textAnchor="middle" fontSize="7.5" fill="#8B7355" fontWeight="600" fontFamily="Helvetica Neue,sans-serif">{dim.label}</text>
              </g>
            );
          })}

          {/* ─── ROOM DIMENSIONS (perimeter) ─── */}
          {/* Top dimension */}
          <line x1={0} y1={-18} x2={canvasW} y2={-18} stroke="#6B5A48" strokeWidth="1" opacity="0.6" markerEnd="url(#dimArrow)" markerStart="url(#dimArrowR)" />
          <line x1={0} y1={-22} x2={0} y2={-14} stroke="#6B5A48" strokeWidth="1" opacity="0.6" />
          <line x1={canvasW} y1={-22} x2={canvasW} y2={-14} stroke="#6B5A48" strokeWidth="1" opacity="0.6" />
          <rect x={canvasW / 2 - 18} y={-26} width={36} height={14} fill="#FDFCFA" rx="3" />
          <text x={canvasW / 2} y={-16} textAnchor="middle" fontSize="10" fill="#6B5A48" fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{roomW}′</text>

          {/* Right dimension */}
          <line x1={canvasW + 18} y1={0} x2={canvasW + 18} y2={canvasH} stroke="#6B5A48" strokeWidth="1" opacity="0.6" markerEnd="url(#dimArrow)" markerStart="url(#dimArrowR)" />
          <line x1={canvasW + 14} y1={0} x2={canvasW + 22} y2={0} stroke="#6B5A48" strokeWidth="1" opacity="0.6" />
          <line x1={canvasW + 14} y1={canvasH} x2={canvasW + 22} y2={canvasH} stroke="#6B5A48" strokeWidth="1" opacity="0.6" />
          <g transform={`translate(${canvasW + 26}, ${canvasH / 2}) rotate(90)`}>
            <rect x={-18} y={-12} width={36} height={14} fill="#FDFCFA" rx="3" />
            <text x={0} y={-2} textAnchor="middle" fontSize="10" fill="#6B5A48" fontWeight="700" fontFamily="Helvetica Neue,sans-serif">{roomH}′</text>
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div style={{ padding: "12px 20px", borderTop: "1px solid #F0EBE4", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        {Object.entries(FURN_DIMS).map(([cat, d]) => {
          const count = placed.filter(p => p.item.c === cat).length;
          if (!count) return null;
          return <span key={cat} style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: ((CAT_COLORS as Record<string, { bg: string; accent: string }>)[cat] || CAT_COLORS.accent).accent + "30", border: "1px solid " + ((CAT_COLORS as Record<string, { bg: string; accent: string }>)[cat] || CAT_COLORS.accent).accent, display: "inline-block" }} />
            {d.label} ({count})
          </span>;
        })}
        <span style={{ fontSize: 10, color: "#9B8B7B", marginLeft: "auto" }}>
          {placed.length} items · {Math.round(roomW * roomH)} sqft
        </span>
      </div>
    </div>
  );
}

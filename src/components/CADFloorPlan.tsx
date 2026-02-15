import React from "react";
import { FURN_DIMS } from "../constants";
import { getProductDims } from "../engine/designEngine";
import { CAT_COLORS } from "./Card";
import type { CADLayout, FurnitureCategory } from "../types";

interface CADFloorPlanProps { layout: CADLayout | null; roomType: string; style: string; }

export default function CADFloorPlan({ layout, roomType, style }: CADFloorPlanProps) {
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
            const dimLabel = Math.round(prodDims.w * 10) / 10 + "' \u00d7 " + Math.round(prodDims.d * 10) / 10 + "'";
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
            <span style={{ width: 10, height: 10, borderRadius: 2, background: ((CAT_COLORS as Record<string, { bg: string; accent: string }>)[cat] || CAT_COLORS.accent).accent + "30", border: "1px solid " + ((CAT_COLORS as Record<string, { bg: string; accent: string }>)[cat] || CAT_COLORS.accent).accent, display: "inline-block" }} />
            {d.label} ({count})
          </span>;
        })}
      </div>
    </div>
  );
}

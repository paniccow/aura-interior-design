import { useState } from "react";
import { fmt } from "../constants";
import type { Product, CatColorDef, FurnitureCategory } from "../types";

export const CAT_COLORS: Record<FurnitureCategory, CatColorDef> = {
  sofa: { bg: "linear-gradient(145deg, #EBE4D8, #DDD4C6)", accent: "#8B7355" },
  bed: { bg: "linear-gradient(145deg, #E8E0EB, #D8CCD8)", accent: "#7B5575" },
  table: { bg: "linear-gradient(145deg, #E0E6DD, #CED6CA)", accent: "#5B6B55" },
  chair: { bg: "linear-gradient(145deg, #E4E0E8, #D2CDD8)", accent: "#6B5B75" },
  stool: { bg: "linear-gradient(145deg, #E8E4E0, #D8D2CC)", accent: "#756B5B" },
  light: { bg: "linear-gradient(145deg, #E8E6E0, #D8D4CC)", accent: "#7B7555" },
  rug: { bg: "linear-gradient(145deg, #E0E4E8, #CCD0D8)", accent: "#556B7B" },
  art: { bg: "linear-gradient(145deg, #E8E0E4, #D8CCD0)", accent: "#7B5568" },
  accent: { bg: "linear-gradient(145deg, #E6E4E0, #D4D2CC)", accent: "#6B685B" },
  decor: { bg: "linear-gradient(145deg, #E6E4E0, #D4D2CC)", accent: "#6B685B" },
  storage: { bg: "linear-gradient(145deg, #E4E0E8, #D2CDD8)", accent: "#6B5B75" },
};

interface CardProps { p: Product; sel: boolean; toggle?: (id: number) => void; small?: boolean; }

export default function Card({ p, sel, toggle, small }: CardProps) {
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
              <div style={{ fontSize: small ? 24 : 32, marginBottom: 8, opacity: 0.25 }}>{({"sofa":"\uD83D\uDECB","bed":"\uD83D\uDECF","table":"\uD83E\uDE91","chair":"\uD83E\uDE91","stool":"\uD83E\uDE91","light":"\uD83D\uDCA1","rug":"\uD83E\uDDF6","art":"\uD83D\uDDBC","accent":"\u2728","decor":"\u2728","storage":"\uD83D\uDCE6"} as Record<string, string>)[p.c] || "\uD83C\uDFE0"}</div>
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
              <span style={{ fontSize: 11, color: "#C17550", fontWeight: 600 }}>{"Shop \u2192"}</span>
            </div>
          )}
        </div>
      </a>
    </div>
  );
}

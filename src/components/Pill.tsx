import type React from "react";

interface PillProps { active: boolean; children: React.ReactNode; onClick: () => void; }

export default function Pill({ active, children, onClick }: PillProps) {
  return (
    <button onClick={onClick} style={{ padding: "8px 16px", fontSize: 12, fontWeight: active ? 600 : 400, background: active ? "#1A1815" : "#FDFCFA", color: active ? "#fff" : "#7A6B5B", border: active ? "none" : "1px solid #E8E0D8", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

import AuraLogo from "./AuraLogo";

interface FooterProps {
  go: (page: string) => void;
  setTab: (tab: string) => void;
  adminAuthed?: boolean;
}

export default function Footer({ go, setTab, adminAuthed }: FooterProps) {
  return (
    <footer style={{ background: "#fff", borderTop: "1px solid #F0EBE4", padding: "28px 5%", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><AuraLogo size={22} /><span style={{ fontFamily: "Georgia,serif", fontSize: 18 }}>AURA</span></div>
      <div style={{ display: "flex", gap: 24 }}>
        {([["Design", () => { go("design"); setTab("studio"); }], ["Featured Catalog", () => { go("design"); setTab("catalog"); }], ["Pricing", () => go("pricing")]] as [string, () => void][]).map(([l, fn]) => (
          <span key={l} onClick={fn} style={{ fontSize: 12, cursor: "pointer", color: "#B8A898" }}>{l}</span>
        ))}
        {adminAuthed && <span onClick={() => go("admin")} style={{ fontSize: 12, cursor: "pointer", color: "#B8A898" }}>Admin</span>}
      </div>
    </footer>
  );
}

import AuraLogo from "./AuraLogo";

interface HeaderProps {
  pg: string;
  sc: boolean;
  sel: Set<number>;
  selCount: number;
  selTotal: number;
  user: { name?: string } | null;
  go: (page: string) => void;
  setTab: (tab: string) => void;
  fmt: (n: number) => string;
  adminAuthed?: boolean;
}

export default function Header({ pg, sc, sel, selCount, selTotal, user, go, setTab, fmt }: HeaderProps) {
  const onHero = pg === "home" && !sc;
  const logoColor = onHero ? "#fff" : "#1A1815";
  const textColor = onHero ? "rgba(255,255,255,.92)" : "#7A6B5B";
  const ctaBg = onHero ? "rgba(255,255,255,.18)" : "#1A1815";
  const ctaBorder = onHero ? "1px solid rgba(255,255,255,.35)" : "none";

  return (
    <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, padding: sc ? "10px 5%" : "16px 5%", display: "flex", alignItems: "center", justifyContent: "space-between", background: sc ? "rgba(255,255,255,.82)" : "transparent", backdropFilter: sc ? "saturate(180%) blur(20px)" : "none", WebkitBackdropFilter: sc ? "saturate(180%) blur(20px)" : "none", transition: "all .35s ease", borderBottom: sc ? "1px solid rgba(0,0,0,.06)" : "none" }}>
      <div onClick={() => go("home")} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <AuraLogo size={26} color={logoColor} />
        <span className="aura-nav-wordmark" style={{ fontFamily: "Georgia,'Times New Roman',serif", fontSize: 22, fontWeight: 400, letterSpacing: "0.18em", color: logoColor, transition: "color .35s ease", lineHeight: 1, textTransform: "uppercase" }}>Aura</span>
      </div>
      <div className="aura-nav-links" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {sel.size > 0 && <span className="aura-nav-cart" style={{ fontSize: 11, color: textColor, fontWeight: 600, background: onHero ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.04)", padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>{selCount} items · {fmt(selTotal)}</span>}
        <button className="aura-nav-pricing" onClick={() => go("pricing")} style={{ background: "none", border: "none", fontSize: 13, color: textColor, cursor: "pointer", fontFamily: "inherit", fontWeight: 400, transition: "color .35s ease", padding: "6px 12px", whiteSpace: "nowrap" }}>Pricing</button>
        {user ? <button onClick={() => go("account")} style={{ background: "none", border: "none", fontSize: 13, color: textColor, cursor: "pointer", fontFamily: "inherit", fontWeight: 400, transition: "color .35s ease", padding: "6px 10px", whiteSpace: "nowrap" }}>{user.name || "Account"}</button> : <button onClick={() => go("auth")} style={{ background: "none", border: "none", fontSize: 13, color: textColor, cursor: "pointer", fontFamily: "inherit", fontWeight: 400, transition: "color .35s ease", padding: "6px 10px", whiteSpace: "nowrap" }}>Sign In</button>}
        <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: ctaBg, color: "#fff", borderRadius: 980, padding: "9px 18px", border: ctaBorder, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all .35s ease", backdropFilter: onHero ? "blur(8px)" : "none", WebkitBackdropFilter: onHero ? "blur(8px)" : "none", whiteSpace: "nowrap" }} onMouseEnter={e => { e.currentTarget.style.opacity = "0.82"; }} onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>Get Started</button>
      </div>
    </nav>
  );
}

import React from "react";

interface PricingSectionProps {
  billingCycle: "monthly" | "yearly";
  setBillingCycle: (cycle: "monthly" | "yearly") => void;
  userPlan: string;
  user: { name?: string; email?: string } | null;
  onCheckout: () => void;
  onGetStarted: () => void;
  trackEvent?: (event: string, meta?: Record<string, string | number>) => void;
  compact?: boolean;
}

export default function PricingSection({ billingCycle, setBillingCycle, userPlan, user, onCheckout, onGetStarted, compact }: PricingSectionProps) {
  const proFeatures = [
    "Unlimited mood boards",
    "100,000+ real products",
    "Unlimited AI visualizations",
    "CAD floor plan analysis",
    "AI furniture layout plans",
    "Exact placement + dimensions",
    "Unlimited projects",
    "All 14 design styles",
    "200+ retailers",
  ];

  const freeFeatures = [
    "3 mood boards",
    "100,000+ real products",
    "2 AI visualizations / month",
    "Basic style matching",
    "1 project",
    "Community support",
  ];

  return (
    <div>
      {/* Billing toggle */}
      <div style={{ textAlign: "center", marginBottom: compact ? 32 : 48 }}>
        <div style={{ display: "inline-flex", background: "#F5F0EB", borderRadius: 980, padding: 3 }}>
          <button onClick={() => setBillingCycle("monthly")} style={{ padding: "10px 24px", borderRadius: 980, border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", background: billingCycle === "monthly" ? "#fff" : "transparent", color: billingCycle === "monthly" ? "#1A1815" : "#9B8B7B", boxShadow: billingCycle === "monthly" ? "0 1px 4px rgba(0,0,0,.1)" : "none", transition: "all .2s" }}>Monthly</button>
          <button onClick={() => setBillingCycle("yearly")} style={{ padding: "10px 24px", borderRadius: 980, border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", background: billingCycle === "yearly" ? "#fff" : "transparent", color: billingCycle === "yearly" ? "#1A1815" : "#9B8B7B", boxShadow: billingCycle === "yearly" ? "0 1px 4px rgba(0,0,0,.1)" : "none", transition: "all .2s", display: "flex", alignItems: "center", gap: 8 }}>Yearly {billingCycle === "yearly" && <span style={{ fontSize: 11, color: "#fff", fontWeight: 600, background: "#C17550", padding: "3px 10px", borderRadius: 980 }}>Save 50%</span>}</button>
        </div>
      </div>

      {/* Cards grid */}
      <div className="aura-pricing-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 780, margin: "0 auto" }}>
        {/* Free card */}
        <div style={{ background: "#FDFCFA", borderRadius: 24, padding: "40px 32px", textAlign: "left", border: "1px solid #E8E0D8", display: "flex", flexDirection: "column" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#9B8B7B", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Free</p>
          <div style={{ fontSize: 56, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.03em", color: "#1A1815" }}>$0<span style={{ fontSize: 17, color: "#9B8B7B", fontWeight: 500 }}>/mo</span></div>
          <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 28 }}>Get started for free.</p>
          <div style={{ flex: 1 }}>
            {freeFeatures.map((f) => <p key={f} style={{ fontSize: 14, color: "#5A5045", padding: "10px 0", borderBottom: "1px solid #F0EBE4", margin: 0, fontWeight: 400 }}>&#10003;&ensp;{f}</p>)}
          </div>
          <button onClick={onGetStarted} style={{ width: "100%", marginTop: 28, padding: "14px", background: "#F8F5F0", color: "#1A1815", border: "1px solid #E8E0D8", borderRadius: 980, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s" }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>Get Started Free</button>
        </div>

        {/* Pro card */}
        <div style={{ background: "#1A1815", borderRadius: 24, padding: "40px 32px", textAlign: "left", position: "relative", display: "flex", flexDirection: "column" }}>
          {billingCycle === "yearly" && <div style={{ position: "absolute", top: 16, right: 16, background: "#C17550", color: "#fff", fontSize: 11, fontWeight: 600, padding: "5px 14px", borderRadius: 980 }}>Best value</div>}
          <p style={{ fontSize: 13, fontWeight: 600, color: "#9B8B7B", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pro</p>
          <div style={{ fontSize: 56, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.03em", color: "#fff" }}>{billingCycle === "yearly" ? "$10" : "$20"}<span style={{ fontSize: 17, color: "#9B8B7B", fontWeight: 500 }}>/mo</span></div>
          {billingCycle === "yearly" ? <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 28 }}>$120/year <span style={{ textDecoration: "line-through" }}>$240</span></p> : <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 28 }}>Billed monthly.</p>}
          <div style={{ flex: 1 }}>
            {proFeatures.map((f) => <p key={f} style={{ fontSize: 14, color: "#F5F0EB", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.1)", margin: 0, fontWeight: 400 }}>&#10003;&ensp;{f}</p>)}
          </div>
          <button onClick={onCheckout} style={{ width: "100%", marginTop: 28, padding: "14px", background: "#fff", color: "#1A1815", border: "none", borderRadius: 980, fontSize: 15, fontWeight: 500, cursor: userPlan === "pro" ? "default" : "pointer", fontFamily: "inherit", transition: "opacity .2s", opacity: userPlan === "pro" ? 0.5 : 1 }} onMouseEnter={e => { if (userPlan !== "pro") e.currentTarget.style.opacity = "0.85"; }} onMouseLeave={e => { if (userPlan !== "pro") e.currentTarget.style.opacity = "1"; }}>{userPlan === "pro" ? "Current Plan" : user ? (billingCycle === "yearly" ? "Subscribe - $120/yr" : "Subscribe - $20/mo") : "Sign up to subscribe"}</button>
        </div>
      </div>
    </div>
  );
}

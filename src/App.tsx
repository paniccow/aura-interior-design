import React, { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { DB } from "./data";
import { supabase } from "./supabaseClient";

/* ─── Extracted modules ─── */
import { compressImage } from "./utils/compress";
import { sanitizeHtml, formatChatMessage } from "./utils/sanitize";
import { getAuthToken, authHeaders } from "./utils/auth";
import { AI_API, aiChat, analyzeImage, generateAIImage, searchFeaturedProducts } from "./api";
import { ROOMS, VIBES, fmt, budgets, FURN_DIMS, STYLE_PALETTES, ROOM_NEEDS, STYLE_COMPAT, COLOR_TEMPS, RETAILER_TIERS, CATEGORY_INVESTMENT, ROOM_CAT_TIERS } from "./constants";
import { getProductDims, buildDesignBoard, generateMoodBoards } from "./engine/designEngine";
import { generateCADLayout } from "./engine/cadLayout";
import Card, { CAT_COLORS } from "./components/Card";
import AuraLogo from "./components/AuraLogo";
import Pill from "./components/Pill";
import RevealSection, { useScrollReveal } from "./components/RevealSection";
import FloorPlanEditor from "./components/FloorPlanEditor";
import Header from "./components/Header";
import Footer from "./components/Footer";
import PricingSection from "./components/PricingSection";
import { serializeEditorState, deserializeEditorState } from "./engine/floorPlanState";
import posthog, { posthogEnabled } from "./posthog";
import type { Product, ChatMessage, MoodBoard, CADLayout as CADLayoutType, Project, AppUser, UserProfile, AdminStats, StylePalette, RoomNeed, BudgetKey, FurnitureCategory, FloorPlanEditorState } from "./types";

/* ─── Local Types ─── */
interface CadFileState {
  name: string;
  data: string;
  type: string;
}

interface RoomPhotoState {
  name: string;
  data: string;
  type: string;
}

interface VizUrl {
  url: string | null;
  label: string;
  concept?: boolean;
  mood?: string;
  colors?: string[];
  products?: string[];
}

/** Deduplicate products by ID — keeps first occurrence */
const dedupRecsById = (arr: Product[]): Product[] => {
  const seen = new Set<number>();
  return arr.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
};

/* ─── ANALYTICS TRACKER ─── */
interface AnalyticsEvent {
  event: string;
  page?: string;
  ts: number;
  sessionId: string;
  meta?: Record<string, string | number>;
}

const SESSION_ID = (() => {
  let sid = sessionStorage.getItem("aura_sid");
  if (!sid) { sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem("aura_sid", sid); }
  return sid;
})();

function trackEvent(event: string, meta?: Record<string, string | number>) {
  try {
    const entry: AnalyticsEvent = { event, ts: Date.now(), sessionId: SESSION_ID, meta };
    // Store in localStorage (persists across sessions for admin dashboard)
    const KEY = "aura_analytics";
    const raw = localStorage.getItem(KEY);
    const events: AnalyticsEvent[] = raw ? JSON.parse(raw) : [];
    events.push(entry);
    // Keep last 2000 events to prevent bloat
    if (events.length > 2000) events.splice(0, events.length - 2000);
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch (_e) { /* storage full or disabled */ }
  // Forward to Google Analytics 4
  try {
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };
    if (w.gtag) w.gtag("event", event, { ...meta, session_id: SESSION_ID });
  } catch (_e) { /* GA not loaded */ }
  // Forward to PostHog
  try {
    if (posthogEnabled) posthog.capture(event, { ...meta, session_id: SESSION_ID });
  } catch (_e) { /* PostHog not loaded */ }
}

function getAnalyticsSummary(): { total: number; byEvent: Record<string, number>; last7Days: Record<string, number>; uniqueSessions: number; buyPageVisits: number; checkoutClicks: number; recentEvents: AnalyticsEvent[] } {
  try {
    const raw = localStorage.getItem("aura_analytics");
    const events: AnalyticsEvent[] = raw ? JSON.parse(raw) : [];
    const byEvent: Record<string, number> = {};
    const last7Days: Record<string, number> = {};
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const sessions = new Set<string>();
    let buyPageVisits = 0;
    let checkoutClicks = 0;
    for (const e of events) {
      byEvent[e.event] = (byEvent[e.event] || 0) + 1;
      sessions.add(e.sessionId);
      if (e.ts > sevenDaysAgo) last7Days[e.event] = (last7Days[e.event] || 0) + 1;
      if (e.event === "page_view" && e.meta?.page === "purchase") buyPageVisits++;
      if (e.event === "checkout_click") checkoutClicks++;
    }
    return { total: events.length, byEvent, last7Days, uniqueSessions: sessions.size, buyPageVisits, checkoutClicks, recentEvents: events.slice(-20).reverse() };
  } catch (_e) { return { total: 0, byEvent: {}, last7Days: {}, uniqueSessions: 0, buyPageVisits: 0, checkoutClicks: 0, recentEvents: [] }; }
}

/* ─── Before/After Slider (defined outside App to avoid hook violations) ─── */
interface SliderProps { before: string; after: string; label?: string; afterLabel?: string; }
const BeforeAfterSlider: React.FC<SliderProps> = ({ before, after, label, afterLabel }) => {
  const [sliderPos, setSliderPos] = React.useState(50);
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const updatePos = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  };
  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => updatePos(e.clientX);
    const onTouchMove = (e: TouchEvent) => { if (e.touches[0]) updatePos(e.touches[0].clientX); };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onTouchMove); window.removeEventListener("touchend", onUp); };
  }, [dragging]);
  return (
    <div>
      {label && <p style={{ textAlign: "center", fontSize: 14, fontWeight: 600, color: "#1A1815", marginBottom: 12 }}>{label}</p>}
      <div ref={containerRef} style={{ position: "relative", width: "100%", aspectRatio: "16/10", borderRadius: 16, overflow: "hidden", cursor: "ew-resize", userSelect: "none", boxShadow: "0 12px 40px rgba(0,0,0,.1)" }}
        onMouseDown={() => setDragging(true)}
        onTouchStart={() => setDragging(true)}>
        <img src={before} alt="Before" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <img src={after} alt="After" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${sliderPos}%`, width: 3, background: "#fff", transform: "translateX(-50%)", zIndex: 2, boxShadow: "0 0 8px rgba(0,0,0,.3)" }} />
        <div style={{ position: "absolute", top: "50%", left: `${sliderPos}%`, transform: "translate(-50%,-50%)", width: 40, height: 40, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3, animation: dragging ? "none" : "sliderPulse 1.5s ease 1s 1 both" }}>
          <span style={{ fontSize: 14, color: "#1A1815", fontWeight: 600, letterSpacing: 2 }}>{"<>"}</span>
        </div>
        <span style={{ position: "absolute", top: 12, left: 12, fontSize: 10, fontWeight: 700, background: "rgba(0,0,0,.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", color: "#fff", padding: "5px 12px", borderRadius: 980, letterSpacing: ".08em", textTransform: "uppercase", zIndex: 4 }}>Before</span>
        <span style={{ position: "absolute", top: 12, right: 12, fontSize: 10, fontWeight: 700, background: "rgba(255,255,255,.9)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", color: "#1A1815", padding: "5px 12px", borderRadius: 980, letterSpacing: ".08em", textTransform: "uppercase", zIndex: 4 }}>{afterLabel || "After"}</span>
      </div>
    </div>
  );
};

/* ─── MAIN APP ─── */
export default function App() {
  const [pg, setPg] = useState<string>("home");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null); // Supabase profile: { plan, stripe_customer_id, viz_count, viz_month, ... }
  const [authLoading, setAuthLoading] = useState<boolean>(true); // true until Supabase session check completes
  const [confirmationPending, setConfirmationPending] = useState<boolean>(false);
  const [resetEmailSent, setResetEmailSent] = useState<boolean>(false);
  const [heroRoomIdx, setHeroRoomIdx] = useState<number>(0);
  const [faqOpen, setFaqOpen] = useState<number>(0);
  // Homepage interactive demo state
  const [demoSpace, setDemoSpace] = useState<"interiors"|"exteriors"|"gardens">("interiors");
  const [demoRoom, setDemoRoom] = useState<string>("Living Room");
  const [demoStyle, setDemoStyle] = useState<string>("Warm Modern");
  // AI Studio Tools state (lifted to App level to avoid hook violations)
  const [aiToolMode, setAiToolMode] = useState<"none"|"transfer"|"color"|"texture">("none");
  const [aiInspFile, setAiInspFile] = useState<{data:string;type:string}|null>(null);
  const [aiInspLoading, setAiInspLoading] = useState(false);
  const [aiSelectedColor, setAiSelectedColor] = useState<string|null>(null);
  const [aiMatCategory, setAiMatCategory] = useState<"floor"|"wall">("floor");
  const [aiSelectedFloorMat, setAiSelectedFloorMat] = useState<string|null>(null);
  const [aiSelectedWallMat, setAiSelectedWallMat] = useState<string|null>(null);
  const [showSignupPopup, setShowSignupPopup] = useState<boolean>(false);
  const [popupDismissed, setPopupDismissed] = useState<boolean>(false);
  const [adminAuthed, setAdminAuthed] = useState<boolean>(false);
  const [adminPassInput, setAdminPassInput] = useState<string>("");
  const [adminPassErr, setAdminPassErr] = useState<string>("");
  const [grantEmail, setGrantEmail] = useState<string>("");
  const [grantStatus, setGrantStatus] = useState<string>(""); // "success", "error", or ""
  const [grantMsg, setGrantMsg] = useState<string>("");
  // Admin password is entered by user and sent to the server-side API for validation
  // The server checks it against the ADMIN_PASSWORD environment variable
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null); // { totalUsers, proUsers, totalViz, recentUsers }
  const [projects, setProjects] = useState<Project[]>(() => {
    try { const p = localStorage.getItem("aura_projects"); return p ? JSON.parse(p) : []; } catch (_e) { return []; }
  });
  const [msgs, setMsgs] = useState<ChatMessage[]>([{ role: "bot", text: "Welcome to AURA! I have **" + DB.length + " products** from premium brands including Restoration Hardware, West Elm, Article, Crate & Barrel, AllModern, Serena & Lily, Rejuvenation, McGee & Co, Shoppe Amber, and more.\n\n**Tell me about your space** — your room type, style preferences, and what you're looking for. I'll generate personalized mood boards based on our conversation.\n\n**Upload a room photo** above and I'll analyze your existing space to create layouts that actually work.\n\nOr ask me anything about design — I'll explain exactly why each piece works for your space!", recs: [] }]);
  const [inp, setInp] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [searchProgress, setSearchProgress] = useState<{ stage: string; count: number; step: number; steps: string[] } | null>(null);
  const [room, setRoom] = useState<string | null>(() => {
    try { return sessionStorage.getItem("aura_room") || null; } catch (_e) { return null; }
  });
  const [vibe, setVibe] = useState<string | null>(() => {
    try { return sessionStorage.getItem("aura_vibe") || null; } catch (_e) { return null; }
  });
  const [bud, setBud] = useState<string>("all");
  const [sel, setSel] = useState<Map<number, number>>(() => {
    try {
      const s = sessionStorage.getItem("aura_sel");
      if (!s) return new Map();
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length > 0 && !Array.isArray(parsed[0])) {
        return new Map(parsed.map((id: number) => [id, 1] as [number, number]));
      }
      return new Map(parsed);
    } catch (_e) { return new Map(); }
  });
  const [sc, setSc] = useState<boolean>(false);
  const [tab, setTab] = useState<string>("studio");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [searchQ, setSearchQ] = useState<string>("");
  const [authMode, setAuthMode] = useState<string>("signin");
  const [ae, setAe] = useState<string>("");
  const [ap, setAp] = useState<string>("");
  const [ap2, setAp2] = useState<string>("");
  const [an, setAn] = useState<string>("");
  const [aErr, setAErr] = useState<string>("");
  const [aLd, setALd] = useState<boolean>(false);
  const [vizUrls, setVizUrls] = useState<VizUrl[]>([]);
  const [vizSt, setVizSt] = useState<string>("idle");
  const [vizErr, setVizErr] = useState<string>("");
  // Viz tracking now comes from Supabase profile (server-side truth)
  const [cadFile, setCadFile] = useState<CadFileState | null>(null);
  const [cadAnalysis, setCadAnalysis] = useState<string | null>(null);
  const [cadLoading, setCadLoading] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [boards, setBoards] = useState<MoodBoard[] | null>(null);
  const [activeBoard, setActiveBoard] = useState<number>(0);
  const [sqft, setSqft] = useState<string>("");
  const [roomW, setRoomW] = useState<string>(""); // room width in feet
  const [roomL, setRoomL] = useState<string>(""); // room length in feet
  const [cadLayout, setCadLayout] = useState<CADLayoutType | null>(null);
  const [roomPhoto, setRoomPhoto] = useState<RoomPhotoState | null>(null);
  const [roomPhotoAnalysis, setRoomPhotoAnalysis] = useState<string | null>(null);
  const [roomPhotoLoading, setRoomPhotoLoading] = useState<boolean>(false);
  const [boardsGenHint, setBoardsGenHint] = useState<string | null>(null);
  // Multi-project
  const [activeProjectId, setActiveProjectId] = useState<number | null>(() => {
    try { const a = sessionStorage.getItem("aura_activeProject"); return a ? JSON.parse(a) : null; } catch (_e) { return null; }
  });
  const [editingProjectName, setEditingProjectName] = useState<number | null>(null);
  // Featured catalog (external products from RapidAPI)
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [featuredQuery, setFeaturedQuery] = useState<string>("");
  const [featuredCat, setFeaturedCat] = useState<string>("all");
  const [featuredLoading, setFeaturedLoading] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [featuredTotal, setFeaturedTotal] = useState<number>(0);
  const [featuredPage, setFeaturedPage] = useState<number>(1);
  const [featuredRetailers, setFeaturedRetailers] = useState<string[]>([]);
  const [featuredCache, setFeaturedCache] = useState<Map<number, Product>>(new Map());
  const [floorPlanState, setFloorPlanState] = useState<FloorPlanEditorState | null>(null);
  const [editorFullScreen, setEditorFullScreen] = useState(false);
  const [onboardStep, setOnboardStep] = useState<number>(0); // 0=welcome, 1=pick room, 2=pick style

  const [designStep, _setDesignStep] = useState<number>(0); // 0=setup, 1=chat, 2=review
  const setDesignStep = (step: number) => { _setDesignStep(step); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [setupSubStep, setSetupSubStep] = useState<number>(0); // 0=room, 1=style, 2=budget, 3=dimensions+uploads
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const vizAreaRef = useRef<HTMLDivElement>(null);
  // Homepage static images
  const homeHeroImg = "/hero-room.jpg";
  const homeVizImg = "/viz-room.jpg";
  const PAGE_SIZE = 40;

  // Persist projects, selection, and preferences to localStorage
  useEffect(() => {
    try { localStorage.setItem("aura_projects", JSON.stringify(projects)); } catch (_e) {}
  }, [projects]);
  // Hero room cycling
  const heroRooms = ["your living room.", "your bedroom.", "your kitchen.", "your office."];
  useEffect(() => {
    const t = setInterval(() => setHeroRoomIdx(i => (i + 1) % heroRooms.length), 3000);
    return () => clearInterval(t);
  }, []);
  // Scroll-triggered signup popup (Cal AI style) — only for non-logged-in users on homepage
  useEffect(() => {
    if (user || pg !== "home" || popupDismissed) return;
    const alreadyShown = sessionStorage.getItem("aura_popup_shown");
    if (alreadyShown) return;
    const onScroll = () => {
      if (window.scrollY > 100) { setShowSignupPopup(true); sessionStorage.setItem("aura_popup_shown", "1"); window.removeEventListener("scroll", onScroll); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [user, pg, popupDismissed]);
  useEffect(() => {
    try { sessionStorage.setItem("aura_sel", JSON.stringify(Array.from(sel.entries()))); } catch (_e) {}
  }, [sel]);
  useEffect(() => {
    try { if (room) sessionStorage.setItem("aura_room", room); else sessionStorage.removeItem("aura_room"); } catch (_e) {}
  }, [room]);
  useEffect(() => {
    try { if (vibe) sessionStorage.setItem("aura_vibe", vibe); else sessionStorage.removeItem("aura_vibe"); } catch (_e) {}
  }, [vibe]);
  useEffect(() => {
    try { sessionStorage.setItem("aura_activeProject", JSON.stringify(activeProjectId)); } catch (_e) {}
  }, [activeProjectId]);

  // ─── SUPABASE AUTH ───
  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (data && !error) {
        setProfile(data);
        // Check if new user for onboarding
        const onboarded = localStorage.getItem("aura_onboarded");
        if (!onboarded && data.created_at) {
          const createdAt = new Date(data.created_at).getTime();
          if (Date.now() - createdAt < 60000) {
            setShowOnboarding(true);
          }
        }
      } else if (error) {
        console.warn("Profile fetch failed:", error.message);
        // Profile may not exist yet (new signup before DB trigger fires) — retry after short delay
        if (error.code === "PGRST116") {
          // "no rows returned" — profile doesn't exist yet, retry once
          setTimeout(async () => {
            const { data: retryData, error: retryError } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", userId)
              .single();
            if (retryData && !retryError) {
              setProfile(retryData);
              const onboarded = localStorage.getItem("aura_onboarded");
              if (!onboarded && retryData.created_at) {
                const createdAt = new Date(retryData.created_at).getTime();
                if (Date.now() - createdAt < 60000) {
                  setShowOnboarding(true);
                }
              }
            }
            else console.warn("Profile retry failed:", retryError?.message);
          }, 2000);
        }
      }
    } catch (err) {
      console.error("Profile fetch error:", err);
    }
  };

  // Supabase auth state listener — handles session restore, login, logout, email confirm, password reset
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || "",
          name: session.user.user_metadata?.name || (session.user.email || "").split("@")[0]
        });
        fetchProfile(session.user.id);
      }
      setAuthLoading(false);
    }).catch((err) => {
      console.error("Session restore failed:", err);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          const userName = session.user.user_metadata?.name || (session.user.email || "").split("@")[0];
          setUser({
            id: session.user.id,
            email: session.user.email || "",
            name: userName
          });
          fetchProfile(session.user.id);
          setConfirmationPending(false);
          // Identify user in PostHog
          if (posthogEnabled) posthog.identify(session.user.id, { email: session.user.email, name: userName });
        } else if (event === "SIGNED_OUT") {
          setUser(null);
          setProfile(null);
        } else if (event === "PASSWORD_RECOVERY") {
          setPg("reset-password");
        } else if (event === "TOKEN_REFRESHED" && session?.user) {
          // Session was auto-refreshed — update user in case metadata changed
          setUser({
            id: session.user.id,
            email: session.user.email || "",
            name: session.user.user_metadata?.name || (session.user.email || "").split("@")[0]
          });
        }
        setAuthLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ─── WARMUP + ANALYTICS: pre-warm serverless functions, track visit ───
  useEffect(() => {
    fetch("/api/products", { method: "OPTIONS" }).catch(() => {});
    fetch("/api/ai", { method: "OPTIONS" }).catch(() => {});
    trackEvent("site_visit", { referrer: document.referrer || "direct", page: "home" });
  }, []);

  // Handle Stripe checkout redirect (?checkout=success or ?checkout=cancel)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutResult = params.get("checkout");
    if (checkoutResult === "success") {
      setPg("success");
      if (user?.id) {
        setTimeout(() => fetchProfile(user.id), 2000);
        setTimeout(() => fetchProfile(user.id), 5000);
      }
      window.history.replaceState({}, "", window.location.pathname);
    } else if (checkoutResult === "cancel") {
      setPg("pricing");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [user]);

  // Plan and viz limits from Supabase profile (server-side source of truth)
  const userPlan = profile?.plan || "free";
  const currentMonth = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
  const vizCount = (profile?.viz_month === currentMonth) ? (profile?.viz_count || 0) : 0;
  const vizLimit = userPlan === "pro" ? 100 : 1;
  const vizRemaining = Math.max(0, vizLimit - vizCount);

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
  }, [msgs, busy, searchProgress]);

  // Mood boards are now generated after AI chat prompt — not auto-generated
  // This function is called from the send() function after AI responds
  const triggerMoodBoards = useCallback((promptRoom?: string | null, promptStyle?: string | null, promptBudget?: string | null, promptSqft?: string | null) => {
    const r = promptRoom || room;
    const s = promptStyle || vibe;
    const b = promptBudget || bud;
    const sq = parseInt(promptSqft || sqft) || null;
    if (r && s) {
      const newBoards = generateMoodBoards(r, s, b, sq, cadAnalysis, roomPhotoAnalysis);
      setBoards(newBoards);
      setActiveBoard(0);
    }
  }, [room, vibe, bud, sqft, cadAnalysis, roomPhotoAnalysis]);

  // Auto-generate CAD layout for Pro users when selection changes
  // Uses allProducts (DB + featuredCache) so API products with negative IDs are included
  useEffect(() => {
    if (userPlan === "pro" && sel.size > 0 && room) {
      try {
        const allProds = [...DB, ...Array.from(featuredCache.values())];
        const items = allProds.filter(p => sel.has(p.id));
        const expandedItems = items.flatMap(p => Array.from({ length: sel.get(p.id) || 1 }, (_, i) => ({ ...p, _qtyIdx: i })));
        const sq = parseInt(sqft) || ((ROOM_NEEDS as Record<string, RoomNeed>)[room]?.minSqft || 200);
        const userW = parseFloat(roomW as string) || null;
        const userL = parseFloat(roomL as string) || null;
        const layout = generateCADLayout(expandedItems, sq, room, cadAnalysis, userW, userL);
        setCadLayout(layout);
      } catch (err) {
        console.error("CAD layout error:", err);
        setCadLayout(null);
      }
    } else {
      setCadLayout(null);
    }
  }, [sel, room, sqft, cadAnalysis, user, roomW, roomL]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (p: string) => { setPg(p); window.scrollTo(0, 0); trackEvent("page_view", { page: p }); };
  const toggle = (id: number) => { setSel((prev) => { const n = new Map(prev); if (n.has(id)) { n.delete(id); } else { n.set(id, 1); trackEvent("product_add", { productId: id }); } return n; }); };
  const setQty = (id: number, qty: number) => setSel((prev) => { const n = new Map(prev); if (qty <= 0) n.delete(id); else n.set(id, qty); return n; });
  // selItems/selTotal/selCount are computed below (after featuredCache), combining DB + featured products

  const addBoard = (boardIdx: number) => {
    if (!boards || !boards[boardIdx]) return;
    const newSel = new Map(sel);
    boards[boardIdx].items.forEach(p => { if (!newSel.has(p.id)) newSel.set(p.id, 1); });
    setSel(newSel);
  };

  // Analyze uploaded CAD/PDF for room dimensions — compress then send to AI
  const handleCad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCadLoading(true);
    try {
      // Compress image to stay under Vercel body limit
      const { dataUrl, base64, mimeType } = await compressImage(file, 1200, 0.75);
      console.log("CAD compressed: " + Math.round(base64.length / 1024) + "KB (original: " + Math.round(file.size / 1024) + "KB)");
      setCadFile({ name: file.name, data: dataUrl, type: mimeType });
      try {
        const text = await analyzeImage(base64, mimeType, "Analyze this floor plan/CAD drawing for interior design. Extract:\n1) Total square footage estimate\n2) Room dimensions (width x length)\n3) Number and location of windows\n4) Number and location of doors\n5) Built-in features\n6) Which wall is the focal wall\n7) Natural light direction\n8) Any structural constraints\n\nBe precise with measurements. Use bullet points.");
        if (text && text.length > 10) {
          setCadAnalysis(text);
          // Extract width × length first
          const dimsMatch = text.match(/(\d{1,3})\s*(?:feet|ft|')?\s*(?:wide|w)?\s*(?:by|x|×)\s*(\d{1,3})\s*(?:feet|ft|')?\s*(?:long|l)?/i);
          if (dimsMatch) {
            const w = dimsMatch[1];
            const l = dimsMatch[2];
            if (!roomW) setRoomW(w);
            if (!roomL) setRoomL(l);
            if (!sqft) setSqft(String(Math.round(parseFloat(w) * parseFloat(l))));
          }
          // Fallback: sqft only
          if (!sqft && !dimsMatch) {
            const sqftMatch = text.match(/(\d{2,5})\s*(?:sq(?:uare)?\s*(?:feet|ft)|sf)/i);
            if (sqftMatch) setSqft(sqftMatch[1]);
          }
        }
      } catch (err) {
        console.log("CAD analysis error:", err);
      }
    } catch (err) {
      console.log("CAD compression error:", err);
      // Fallback: read without compression
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        setCadFile({ name: file.name, data: ev.target!.result as string, type: file.type });
      };
      reader.readAsDataURL(file);
    }
    setCadLoading(false);
  };

  // Handle room photo upload — compress then AI analyzes the actual room
  const handleRoomPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRoomPhotoLoading(true);
    try {
      // Compress image to stay under Vercel body limit (~4.5MB)
      const { dataUrl, base64, mimeType } = await compressImage(file, 1200, 0.7);
      console.log("Room photo compressed: " + Math.round(base64.length / 1024) + "KB (original: " + Math.round(file.size / 1024) + "KB)");
      setRoomPhoto({ name: file.name, data: dataUrl, type: mimeType });
      try {
        const text = await analyzeImage(base64, mimeType, "You are an expert interior designer analyzing a room photo. Provide a DETAILED analysis:\n\n1) Room type (living room, bedroom, etc.)\n2) Approximate dimensions (width x length in feet)\n3) Estimated square footage\n4) Wall colors and finishes\n5) Flooring type and color\n6) Windows: count, size, location\n7) Existing furniture: list each piece with location\n8) Lighting: natural light direction, existing fixtures\n9) Architectural features: crown molding, fireplace, built-ins, ceiling height\n10) Style assessment: current design style\n11) Focal wall identification\n12) Areas that feel empty or could benefit from furniture\n\nBe specific about positions and measurements.");
        if (text && text.length > 10) {
          setRoomPhotoAnalysis(text);
          const rtMatch = text.match(/room\s*type[:\s]*(living room|bedroom|dining room|kitchen|office|bathroom|great room|outdoor)/i);
          if (rtMatch && !room) setRoom(rtMatch[1].split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" "));
          // Extract width × length (e.g. "15 feet wide by 20 feet long" or "15 x 20" or "15ft x 20ft")
          const dimsMatch = text.match(/(\d{1,3})\s*(?:feet|ft|')?\s*(?:wide|w)?\s*(?:by|x|×)\s*(\d{1,3})\s*(?:feet|ft|')?\s*(?:long|l)?/i);
          if (dimsMatch && !roomW && !roomL) {
            const w = dimsMatch[1];
            const l = dimsMatch[2];
            setRoomW(w);
            setRoomL(l);
            if (!sqft) setSqft(String(Math.round(parseFloat(w) * parseFloat(l))));
          }
          // Fallback: extract sqft directly (only match "square feet" / "sq ft" patterns, not just "ft")
          if (!sqft && !dimsMatch) {
            const sqftMatch = text.match(/(\d{2,5})\s*(?:sq(?:uare)?\s*(?:feet|ft)|sf)/i);
            if (sqftMatch) setSqft(sqftMatch[1]);
          }
          setMsgs((prev) => [...prev, {
            role: "bot",
            text: "**Room Photo Analyzed!** Here's what I see:\n\n" + text + "\n\nI'll use this for layouts and visualizations. Tell me what you'd like to do with this space!",
            recs: []
          }]);
        } else {
          setMsgs((prev) => [...prev, { role: "bot", text: "**Room photo saved!** I can see you've uploaded a photo of your space. While AI image analysis is temporarily processing, go ahead and describe your room — tell me the room type, approximate size, and what style you're going for. I'll use your photo along with your description to create the perfect design!", recs: [] }]);
        }
      } catch (err) {
        console.log("Room photo analysis error:", err);
        setMsgs((prev) => [...prev, { role: "bot", text: "**Room photo saved!** Describe your space and I'll help design it using your photo as reference.", recs: [] }]);
      }
    } catch (err) {
      console.log("Room photo compression error:", err);
      // Fallback: try reading the file without compression
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        setRoomPhoto({ name: file.name, data: ev.target!.result as string, type: file.type });
        setMsgs((prev) => [...prev, { role: "bot", text: "**Room photo saved!** The image is large so analysis may be limited. Describe your room and I'll use the photo for visualization.", recs: [] }]);
      };
      reader.readAsDataURL(file);
    }
    setRoomPhotoLoading(false);
  };

  // Generate single room visualization — OpenRouter, concept card fallback
  const generateViz = async () => {
    if (selItems.length === 0) return;
    // Check viz limit (client-side pre-check — server enforces too)
    if (!user) {
      setVizErr("sign_up_prompt");
      return;
    }
    if (vizRemaining <= 0) {
      setVizErr(userPlan === "pro"
        ? "You've reached the visualization limit for this billing period. Your access resets next month."
        : "Sign up for Pro to unlock AI visualizations, CAD floor plans, and more!");
      return;
    }
    try {
      setVizSt("loading");
      setVizUrls([]);
      setVizErr("");
      // No auto-scroll — user stays where they are

      const items = selItems;
      const roomName = room || "living room";
      const styleName = vibe || "modern luxury";
      const palette = (STYLE_PALETTES as Record<string, StylePalette>)[styleName] || STYLE_PALETTES["Warm Modern"];
      const roomSqft: string | number = sqft || ((ROOM_NEEDS as Record<string, RoomNeed>)[room as string] || ROOM_NEEDS["Living Room"]).minSqft || 200;
      const roomWidth = roomW || (roomSqft ? String(Math.round(Math.sqrt(parseFloat(String(roomSqft)) * 1.3))) : "");
      const roomLength = roomL || (roomSqft ? String(Math.round(parseFloat(String(roomSqft)) / Math.sqrt(parseFloat(String(roomSqft)) * 1.3))) : "");

      // ─── STEP 1: AI VISION ANALYSIS OF PRODUCT IMAGES ───
      // GPT-4o-mini looks at each product photo and writes a detailed visual description
      // This is critical because Gemini image gen may not load the product URLs itself
      console.log("Viz Step 1: Analyzing " + items.slice(0, 17).length + " product images with AI vision...");
      const productImageUrls = items.slice(0, 17).map(item => item.img).filter(Boolean);

      let aiProductDescriptions = null;
      try {
        const visionContent = [];
        items.slice(0, 17).forEach((item, idx) => {
          if (item.img) {
            visionContent.push({ type: "image_url", image_url: { url: item.img, detail: "high" } });
          }
          visionContent.push({ type: "text", text: "Product " + (idx + 1) + ": \"" + (item.n || "") + "\" (" + item.c + ")" });
        });
        visionContent.push({ type: "text", text: "An AI image generator CANNOT see these photos. Your text is its ONLY reference. COLOR ACCURACY IS CRITICAL.\n\nFURNITURE — one line each:\nPRODUCT [n]: shape=[rect/round/oval/L-shaped/curved], color=[EXACT shade e.g. 'warm sand beige' not just 'beige'], material=[e.g. cream boucle], legs=[style+color], details=[<8 words]\n\nRUGS — one line each, be VERY specific about pattern:\nPRODUCT [n]: shape=[rect/round/runner], colors=[background color FIRST then accent colors e.g. 'cream background, rust+sage accents'], pattern=[name AND visual description e.g. 'geometric: repeating diamond lattice with thin angular lines' or 'solid: uniform cream with subtle texture' or 'moroccan: ogee trellis lattice' or 'floral: scattered flower motifs with curving stems'], texture=[flatweave/shag/tufted/woven/jute/etc]" });

        const vizHeaders = await authHeaders();
        const visionResp = await Promise.race([
          fetch(AI_API, {
            method: "POST",
            headers: vizHeaders,
            body: JSON.stringify({
              action: "chat",
              messages: [{ role: "user", content: visionContent }],
              max_tokens: 3000
            })
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("vision timeout")), 60000))
        ]);
        if (visionResp.ok) {
          const visionData = await visionResp.json();
          const visionText = visionData?.choices?.[0]?.message?.content;
          if (visionText && visionText.length > 20) {
            aiProductDescriptions = visionText;
            console.log("Viz Step 1: AI vision analysis complete:\n" + visionText.slice(0, 800));
          }
        }
      } catch (err) { console.log("Viz Step 1: AI vision failed (using fallback):", (err as Error)?.message); }

      // ─── STEP 2: BUILD PRODUCT SPECIFICATIONS ───
      // If AI vision worked, use its descriptions; otherwise fall back to keyword extraction
      const dims_cache = items.slice(0, 17).map(i => getProductDims(i));

      // Build product list — name, shape, size, color, material from AI vision + name keywords
      const COLOR_WORDS = ["white","cream","ivory","beige","tan","sand","camel","cognac","brown","walnut","oak","teak","mahogany","espresso","charcoal","gray","grey","slate","black","navy","blue","green","sage","olive","emerald","teal","blush","pink","coral","rust","terracotta","gold","brass","bronze","silver","chrome","copper","natural","amber","honey","wheat","linen","oatmeal","mushroom","taupe","dune","alabaster","stone","cement","marble","onyx","haze","driftwood"];
      const MAT_WORDS = ["leather","velvet","boucle","bouclé","linen","cotton","wool","silk","jute","rattan","wicker","cane","marble","travertine","granite","concrete","wood","oak","walnut","teak","metal","iron","steel","brass","bronze","glass","ceramic","fabric","upholstered","performance","slipcovered","woven"];
      const extractKw = (text: string, words: string[]) => words.filter((w: string) => (text || "").toLowerCase().includes(w.toLowerCase()));

      // Detect set/piece count from product name (e.g. "3-piece sofa set", "set of 2 chairs")
      const detectSetCount = (name: string): number => {
        const n = name.toLowerCase();
        // "3-piece", "3 piece", "3pc"
        const pieceMatch = n.match(/(\d+)\s*-?\s*(?:piece|pc|pcs)/);
        if (pieceMatch) return parseInt(pieceMatch[1], 10);
        // "set of 3", "set of two"
        const setOfMatch = n.match(/set\s+of\s+(\d+|two|three|four|five|six)/i);
        if (setOfMatch) {
          const numWords: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
          const v = setOfMatch[1].toLowerCase();
          return numWords[v] || parseInt(v, 10) || 1;
        }
        // "pair" = 2
        if (/\bpair\b/.test(n)) return 2;
        return 1;
      };

      const productSpecs = items.slice(0, 17).map((item, idx) => {
        const dims = dims_cache[idx];
        const userQty = sel.get(item.id) || 1;
        const setCount = detectSetCount(item.n || "");
        const qty = Math.max(userQty, setCount); // use whichever is larger
        const name = (item.n || "").toLowerCase();
        const fullText = (item.n || "") + " " + (item.pr || "");

        // AI vision description — structured key=value format
        let aiDesc = "";
        if (aiProductDescriptions) {
          const regex = new RegExp("PRODUCT\\s*" + (idx + 1) + "\\s*:\\s*(.+)", "i");
          const match = aiProductDescriptions.match(regex);
          aiDesc = match ? match[1].trim() : "";
        }

        // Fallback: extract from product name
        if (!aiDesc) {
          const colors = extractKw(fullText, COLOR_WORDS);
          const mats = extractKw(fullText, MAT_WORDS);

          if (item.c === "rug") {
            // Rug-specific fallback — short, dense format matching vision prompt
            const RUG_PATTERNS = ["geometric","abstract","floral","medallion","moroccan","striped","trellis","distressed","solid","textured","herringbone","chevron","diamond","plaid","damask","ikat","kilim","oriental","lattice","tribal","botanical","paisley"];
            const RUG_TEXTURES = ["flatweave","hand-knotted","shag","tufted","looped","woven","jute","hand-loomed","handwoven","braided","sisal","hemp","low-pile","high-pile"];
            const patterns = extractKw(fullText, RUG_PATTERNS);
            const textures = extractKw(fullText, RUG_TEXTURES);
            let shape = "rectangular";
            if (name.includes("round") || name.includes("circular")) shape = "round";
            else if (name.includes("runner")) shape = "runner";
            const PATTERN_SHORT: Record<string, string> = {
              geometric: "repeating angular diamonds/triangles in structured grid",
              abstract: "irregular organic brushstrokes scattered randomly",
              floral: "flowers+stems in decorative arrangement",
              medallion: "large ornate central medallion with border",
              moroccan: "ogee trellis lattice with curved diamonds",
              striped: "parallel stripes alternating colors",
              trellis: "interlocking lattice grid of diamond shapes",
              distressed: "faded vintage pattern with worn areas",
              solid: "uniform single color, subtle texture",
              textured: "single color with dimensional ribbing/loops",
              herringbone: "zigzag V-shaped weave pattern",
              chevron: "bold V-shaped zigzag stripes",
              diamond: "repeating diamond/rhombus grid",
              plaid: "intersecting horizontal+vertical stripes",
              damask: "ornate symmetrical tone-on-tone medallions",
              ikat: "blurred-edge geometric with fuzzy transitions",
              kilim: "bold flat-woven geometric tribal shapes",
              oriental: "intricate symmetrical floral+geometric with border",
              lattice: "intersecting lines forming open framework",
              tribal: "bold primitive geometric symbols, earthy",
              botanical: "naturalistic leaves+branches, organic",
              paisley: "teardrop curved motifs, ornamental"
            };
            aiDesc = "shape=" + shape;
            if (colors.length > 0) aiDesc += ", colors=" + colors[0] + " background" + (colors.length > 1 ? " + " + colors.slice(1, 4).join("+") + " accents" : "");
            if (patterns.length > 0) {
              aiDesc += ", pattern=" + patterns[0] + ": " + (PATTERN_SHORT[patterns[0]] || patterns[0]);
            } else {
              aiDesc += ", pattern=solid: uniform color with subtle texture";
            }
            if (textures.length > 0) aiDesc += ", texture=" + textures[0];
            else if (mats.length > 0) aiDesc += ", texture=" + mats[0];
          } else {
            // Standard furniture fallback
            let shape = item.c;
            if (name.includes("round") || name.includes("circular")) shape = "round " + item.c;
            else if (name.includes("oval")) shape = "oval " + item.c;
            else if (name.includes("sectional") || name.includes("l-shaped")) shape = "L-shaped " + item.c;
            aiDesc = "shape=" + shape;
            if (colors.length > 0) aiDesc += ", color=" + colors.slice(0, 3).join("/");
            if (mats.length > 0) aiDesc += ", material=" + mats.slice(0, 2).join("/");
          }
        }

        // Rugs use feet (e.g. 8'×10'), furniture uses inches (e.g. 84"W × 36"D)
        const dimStr = item.c === "rug"
          ? Math.round(dims.w) + "'" + " × " + Math.round(dims.d) + "'"
          : Math.round(dims.w * 12) + '"W × ' + Math.round(dims.d * 12) + '"D';
        let spec = (idx + 1) + ". " + (item.n || "Unknown") + " (" + dimStr + "): " + aiDesc;
        if (qty > 1) spec += " — QUANTITY " + qty + ": render exactly " + qty + " of this item";
        return spec;
      }).join("\n");

      const colorStr = palette.colors.slice(0, 5).join(", ");
      const matStr = palette.materials.slice(0, 4).join(", ");
      const roomNeeds = (ROOM_NEEDS as Record<string, RoomNeed>)[room as string] || ROOM_NEEDS["Living Room"];

      // ─── STEP 4: BUILD IMAGE GENERATION PROMPT ───
      const numItems = items.slice(0, 17).length;
      const hasRoomRef = !!(roomPhoto?.data);
      const hasCadImg = !!(cadFile?.data);

      // Build the prompt — room context first, then furniture list
      let prompt = "";

      // Room context
      if (hasRoomRef) {
        prompt += "IMPORTANT: The FIRST image provided is a photo of the user's ACTUAL room. You MUST use this room as the setting — keep the exact same walls, flooring, windows, ceiling, lighting, and architectural details. Place the listed furniture items INTO this real room. Do NOT generate a different room — edit/composite the furniture into the provided room photo.";
        // Include the full room analysis so AI knows what it's looking at
        if (roomPhotoAnalysis) {
          prompt += "\nRoom analysis: " + roomPhotoAnalysis.slice(0, 500);
        }
        prompt += "\nStyle direction: " + styleName + ". " + colorStr + " palette.";
      } else {
        prompt += "Photorealistic interior photo of a " + styleName + " " + roomName + ". " + colorStr + " palette. " + matStr + " materials.";
      }

      // Dimensions
      if (roomWidth && roomLength) {
        prompt += " Room: " + roomWidth + "×" + roomLength + "ft (" + roomSqft + " sqft).";
      } else if (roomSqft) {
        prompt += " ~" + roomSqft + " sqft.";
      }

      // CAD context
      if (hasCadImg) prompt += " Use the provided floor plan for placement.";
      if (cadAnalysis) prompt += "\nFloor plan notes: " + cadAnalysis.slice(0, 250);

      // Count total pieces including quantities/sets
      const totalPieces = items.slice(0, 17).reduce((sum, item) => {
        const uq = sel.get(item.id) || 1;
        const sc = detectSetCount(item.n || "");
        return sum + Math.max(uq, sc);
      }, 0);

      // Furniture list — numbered, one per line
      prompt += "\n\nFurniture — " + totalPieces + " total pieces (" + numItems + " line items, some have quantity > 1):\n" + productSpecs;

      // Rules — strict and explicit about ONLY rendering selected products
      prompt += "\n\nCRITICAL RULES:";
      prompt += "\n- Render EXACTLY " + totalPieces + " total furniture pieces. Items marked 'QUANTITY N' MUST appear exactly N times (e.g. QUANTITY 3 = show 3 separate pieces of that item). Count carefully.";
      prompt += "\n- DO NOT add ANY furniture, decor, plants, vases, pillows, books, candles, or accessories that are not in the list above. The room should contain ONLY the listed items plus architectural elements (walls, floor, windows, ceiling).";
      prompt += "\n- Match each item's EXACT color shade, shape, material, arm/leg style as described above. The product reference photos (provided as images) show EXACTLY what each item looks like — replicate their appearance as faithfully as possible. These are real products the user is purchasing.";

      // Rug accuracy — short, dense
      const hasRug = items.slice(0, 17).some(i => i.c === "rug");
      if (hasRug) {
        prompt += "\n- RUGS: Match the rug product photo EXACTLY — same pattern type, same colors, same density. The first color listed is the BACKGROUND color, accent colors appear IN the pattern on top. Do NOT swap them. Rug must be large enough to anchor the seating (8'×10'+).";
      }

      prompt += "\n- " + roomNeeds.layout;
      prompt += "\nHigh resolution, eye-level, natural daylight, wide-angle, sharp detail, 4K quality, Architectural Digest editorial photography. No text or labels.";

      // Pass room photo and CAD as reference images so AI edits the actual room
      const refImg = roomPhoto?.data || null;
      const cadImg = cadFile?.data || null;
      console.log("Viz Step 4: generating image with " + numItems + " products, " + productImageUrls.length + " reference images" + (refImg ? ", room photo" : "") + (cadImg ? ", CAD image" : "") + (roomWidth ? ", " + roomWidth + "x" + roomLength + "ft" : "") + (aiProductDescriptions ? ", AI-analyzed" : ", keyword-fallback"));
      const imgUrl = await generateAIImage(prompt, refImg, productImageUrls, cadImg);

      if (imgUrl === "__CREDITS_REQUIRED__") {
        setVizErr("Image generation needs purchased credits on your OpenRouter account. Visit openrouter.ai/settings/credits to add funds.");
        setVizSt("idle");
      } else if (imgUrl) {
        setVizUrls([{ url: imgUrl, label: "AI Visualization" }]);
        setVizSt("ok");
        // Refresh profile to get updated viz count from server
        if (user?.id) fetchProfile(user.id);
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

  const welcomeMsg: ChatMessage = { role: "bot", text: "Welcome to AURA! I have **" + DB.length + " products** from premium brands including Restoration Hardware, West Elm, Article, Crate & Barrel, AllModern, Serena & Lily, Rejuvenation, McGee & Co, Shoppe Amber, and more.\n\n**Tell me about your space** — what room, your style, what you need, where the doors and windows are, any existing furniture to work around. **The more detail you give, the better your visualizations will be!**\n\n**Upload a room photo** above and I'll analyze your space to create layouts that work with your actual walls, windows, and flooring.\n\nI'll use everything you tell me when generating your room visualization — so be specific about colors, materials, and the vibe you want!", recs: [] };

  // Snapshot current design state into a project object
  const snapshotProject = (existingId?: number | null): Project => ({
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
    floorPlanState: floorPlanState ? serializeEditorState(floorPlanState) : null,
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

  const delPr = (id: number) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectId === id) setActiveProjectId(null);
  };

  const loadPr = (pr: Project) => {
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
    if (pr.floorPlanState) setFloorPlanState(deserializeEditorState(pr.floorPlanState)); else setFloorPlanState(null);
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
    setFloorPlanState(null); setEditorFullScreen(false);
    setActiveProjectId(null);
    go("design"); setTab("studio");
  };

  const renameProject = (id: number, newName: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
    setEditingProjectName(null);
  };

  const doAuth = async (mode: string, email?: string | null, pass?: string | null, name?: string | null): Promise<string | null> => {
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email!,
        password: pass!,
        options: {
          data: { name },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) return error.message;
      trackEvent("signup", { method: "email" });
      // If email confirmation is required, session is null until confirmed
      if (data.user && !data.session) {
        setConfirmationPending(true);
        go("confirm");
        return null;
      }
      // If email confirmation is disabled (dev), user is signed in immediately
      return null;
    }

    if (mode === "signin") {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email!, password: pass! });
      if (error) {
        if (error.message.includes("Email not confirmed")) {
          return "Please confirm your email before signing in. Check your inbox.";
        }
        return error.message;
      }
      go("home");
      return null;
    }

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email!, {
        redirectTo: window.location.origin
      });
      if (error) return error.message;
      setResetEmailSent(true);
      return null;
    }

    if (mode === "reset") {
      const { error } = await supabase.auth.updateUser({ password: pass! });
      if (error) return error.message;
      go("home");
      return null;
    }

    return "Unknown mode";
  };

  /* ─── AI CHAT ─── */
  const send = async () => {
    if (!inp.trim() || busy) return;
    const msg = inp.trim();
    setInp("");
    setBusy(true);
    // Build context-aware loading steps that sell the value of the service
    const styleLabel = vibe || "your style";
    const roomLabel = room ? room.toLowerCase() : "your space";
    const budgetLabel = bud === "u500" ? "under $500" : bud === "u1k" ? "under $1K" : bud === "1k5k" ? "$1K–$5K" : bud === "5k10k" ? "$5K–$10K" : bud === "10k25k" ? "$10K–$25K" : bud === "25k" ? "$25K+" : "";
    const loadingSteps = [
      "Scanning 100,000+ products across 200+ retailers",
      "Filtering for " + styleLabel + " pieces" + (room ? " suited for " + roomLabel : ""),
      budgetLabel ? "Matching " + budgetLabel + " price range across tiers" : "Comparing prices across retailer tiers",
      "Scoring color palette & material harmony",
      "Evaluating spatial fit" + (sqft ? " for " + sqft + " sqft" : "") + (roomW ? " (" + roomW + "' × " + roomL + "')" : ""),
      "Running design cohesion analysis",
      "Curating your personalized selection",
      "Preparing designer recommendations"
    ];
    setSearchProgress({ stage: loadingSteps[0], count: DB.length, step: 0, steps: loadingSteps });
    setMsgs((prev) => [...prev, { role: "user", text: msg, recs: [] }]);
    trackEvent("ai_chat", { msgLength: msg.length, room: (room || "none") as string, style: (vibe || "none") as string });

    // Animated countdown for step 0, then progressive steps with checkmarks
    let currentLoadingStep = 0;
    const countdownInterval = setInterval(() => {
      setSearchProgress(prev => {
        if (!prev) return prev;
        if (prev.step === 0) {
          // Countdown phase
          const next = Math.max(0, prev.count - Math.floor(Math.random() * 4000 + 1500));
          if (next <= 0) {
            currentLoadingStep = 1;
            return { stage: loadingSteps[1], count: 0, step: 1, steps: loadingSteps };
          }
          return { ...prev, count: next };
        }
        return prev;
      });
    }, 400);

    // Search RapidAPI for real products — awaited so the AI can design with them
    let apiProducts: Product[] = [];
    try {
      const ml = msg.toLowerCase().replace(/[^a-z0-9\s&]/g, "");
      const furnitureKws = ["sofa","couch","table","chair","desk","lamp","rug","bed","stool","light","art","shelf","cabinet","mirror","ottoman","bench","dresser","nightstand","chandelier","pendant","sconce","sectional","bookcase","sideboard","credenza","headboard","daybed","armchair","recliner","outdoor","patio","furniture","decor","pillow","throw","blanket","vase","planter","bookshelf","wardrobe","mattress"];
      const designKws = ["modern","contemporary","rustic","bohemian","minimalist","scandinavian","industrial","coastal","farmhouse","luxury","elegant","mid-century","japandi","traditional","vintage","retro","wood","leather","velvet","marble","brass","gold","white","black","gray","beige","blue","green","natural"];
      const retailerNames = ["walmart","ikea","target","amazon","wayfair","west elm","cb2","pottery barn","crate & barrel","crate and barrel","restoration hardware","article","joybird","castlery","arhaus","world market","pier 1","overstock","ashley","rooms to go","ethan allen","z gallerie","anthropologie","urban outfitters","h&m home","zara home","serena & lily","mcgee & co","lulu & georgia","room & board","design within reach"];
      const msgWords = ml.split(/\s+/).filter(w => w.length > 2);
      const matchedFurn = msgWords.filter(w => furnitureKws.some(fk => w.includes(fk) || fk.includes(w)));
      const matchedDesign = msgWords.filter(w => designKws.some(dk => w === dk));
      // Detect retailer mentions in message
      const matchedRetailer = retailerNames.find(r => ml.includes(r)) || "";
      const styleTerm = vibe ? (vibe as string).toLowerCase() : "";
      const roomTerm = room ? (room as string).toLowerCase().replace("room", "").trim() : "";
      let searchQuery = "";
      if (matchedRetailer) {
        // Retailer-specific search: prioritize the retailer name + any furniture keywords
        const furnPart = matchedFurn.length > 0 ? " " + matchedFurn.join(" ") : " furniture";
        searchQuery = matchedRetailer + furnPart;
      } else if (matchedFurn.length > 0) {
        searchQuery = (styleTerm ? styleTerm + " " : "") + matchedFurn.join(" ");
      } else if (matchedDesign.length > 0) {
        searchQuery = matchedDesign.slice(0, 3).join(" ") + " furniture";
      } else if (styleTerm || roomTerm) {
        searchQuery = (styleTerm ? styleTerm + " " : "") + (roomTerm ? roomTerm + " " : "") + "furniture decor";
      } else {
        const meaningful = msgWords.filter(w => !["the","and","for","can","you","help","find","want","need","some","please","show","get","look","any","with","that","this","what","how","about"].includes(w));
        searchQuery = meaningful.length > 0 ? meaningful.slice(0, 3).join(" ") + " furniture" : "home furniture decor";
      }
      if (searchQuery.trim()) {
        console.log("[AURA] API search query:", searchQuery.trim());
        const result = await searchFeaturedProducts(searchQuery.trim(), 1);
        apiProducts = result.products;
        console.log("[AURA] API returned:", apiProducts.length, "products");
        // Retry with same query first (handles cold-start / transient failures)
        if (apiProducts.length === 0) {
          console.log("[AURA] API empty — retrying same query...");
          await new Promise(r => setTimeout(r, 2000));
          const retry1 = await searchFeaturedProducts(searchQuery.trim(), 1);
          apiProducts = retry1.products;
          console.log("[AURA] API retry #1 returned:", apiProducts.length, "products");
        }
        // If still empty, retry with broader fallback query
        if (apiProducts.length === 0) {
          const fallbackQuery = (vibe ? vibe.toLowerCase() + " " : "") + (room ? room.toLowerCase() + " " : "") + "furniture";
          console.log("[AURA] API empty — retrying with broader query:", fallbackQuery);
          await new Promise(r => setTimeout(r, 2000));
          const retry2 = await searchFeaturedProducts(fallbackQuery, 1);
          apiProducts = retry2.products;
          console.log("[AURA] API retry #2 returned:", apiProducts.length, "products");
        }
        if (apiProducts.length > 0) {
          setFeaturedCache(prev => {
            const next = new Map(prev);
            for (const p of apiProducts) next.set(p.id, p);
            return next;
          });
        }
      }
    } catch (e) { console.log("[AURA] API search failed:", (e as Error)?.message || e); }

    // Progressive steps with checkmarks — advance one step every 3.5s
    const aiStageInterval = setInterval(() => {
      currentLoadingStep = Math.min(currentLoadingStep + 1, loadingSteps.length - 1);
      setSearchProgress({ stage: loadingSteps[currentLoadingStep], count: 0, step: currentLoadingStep, steps: loadingSteps });
    }, 3500);

    try {
    // Combine curated DB + fresh API products + previously cached API products
    const cachedApiProducts = Array.from(featuredCache.values());
    const combinedDB = [...DB, ...apiProducts, ...cachedApiProducts];
    const seen = new Set<number>();
    const seenUrls = new Set<string>();
    const uniqueDB = combinedDB.filter(p => {
      if (seen.has(p.id)) return false;
      // Also deduplicate by URL to prevent same product with different IDs
      if (p.u && seenUrls.has(p.u)) return false;
      seen.add(p.id);
      if (p.u) seenUrls.add(p.u);
      return true;
    });
    console.log("[AURA] Product pool:", uniqueDB.length, "total |", uniqueDB.filter(p => p.id < 0).length, "API");

    let recs = [];
    try { recs = localMatch(msg); } catch (_e) { recs = DB.slice(0, 12); }
    const topPicks = recs.slice(0, 12);

    let aiWorked = false;
    try {
      const m = msg.toLowerCase();
      const vibeCompat = vibe ? ((STYLE_COMPAT as Record<string, Record<string, number>>)[vibe as string] || {}) : {};
      const vibePalette = vibe ? ((STYLE_PALETTES as Record<string, StylePalette>)[vibe as string]) : null;

      // Extract room colors from photo analysis for product matching
      const roomColors: string[] = [];
      if (roomPhotoAnalysis) {
        const rpa = roomPhotoAnalysis.toLowerCase();
        // Common interior colors to look for in the analysis text
        const allColors = ["white","cream","beige","ivory","gray","grey","charcoal","black","navy","blue","green","sage","olive","teal","brown","tan","taupe","walnut","oak","pine","mahogany","cherry","espresso","gold","brass","copper","bronze","silver","chrome","nickel","red","burgundy","coral","pink","blush","orange","terracotta","rust","yellow","mustard","sand","natural","warm","cool","light","dark","wood","stone","marble","concrete","brick"];
        for (const c of allColors) {
          if (rpa.includes(c)) roomColors.push(c);
        }
      }

      // ── DESIGN-ENGINE-LEVEL SCORER ──
      // Ports the full scoring intelligence from designEngine.ts into the chat flow.
      // Uses: style coherence, color palette, material harmony, color temperature,
      // budget fit, retailer tier, category investment, room category tiers,
      // room photo colors, KAA bonus — same factors the design board uses.

      // Budget boundaries (same logic as designEngine)
      let minP = 0, maxP = Infinity;
      if (bud === "u500") maxP = 500;
      if (bud === "u1k") maxP = 1000;
      if (bud === "1k5k") { minP = 500; maxP = 5000; }
      if (bud === "5k10k") { minP = 2000; maxP = 10000; }
      if (bud === "10k25k") { minP = 5000; maxP = 25000; }
      if (bud === "25k") minP = 10000;

      // Room category tier priorities
      const catTiers = (ROOM_CAT_TIERS as Record<string, Record<string, number>>)[room || "Living Room"] || ROOM_CAT_TIERS["Living Room"];

      // Helper: detect color temperature from product text
      const getProductTemp = (text: string): "warm" | "cool" | "neutral" => {
        let warm = 0, cool = 0;
        for (const [color, temp] of Object.entries(COLOR_TEMPS)) {
          if (text.includes(color)) { if (temp === "warm") warm++; else if (temp === "cool") cool++; }
        }
        return warm > cool ? "warm" : cool > warm ? "cool" : "neutral";
      };

      // Helper: get retailer tier (1=budget, 2=mid, 3=premium, 4=luxury)
      const getRetailerTier = (retailer: string): number => {
        if (!retailer) return 2;
        if (RETAILER_TIERS[retailer]) return RETAILER_TIERS[retailer];
        const lower = retailer.toLowerCase();
        for (const [name, tier] of Object.entries(RETAILER_TIERS)) {
          if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) return tier;
        }
        return 2;
      };

      // Helper: word-boundary check for keyword matching (fixes "table" matching "comfortable")
      const wordMatch = (text: string, word: string): boolean => {
        const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\b");
        return re.test(text);
      };

      // Determine room's dominant color temperature from photo analysis
      let roomTemp: "warm" | "cool" | "neutral" = "neutral";
      if (roomColors.length >= 2) {
        let rw = 0, rc = 0;
        for (const c of roomColors) { const ct = COLOR_TEMPS[c]; if (ct === "warm") rw++; else if (ct === "cool") rc++; }
        roomTemp = rw > rc ? "warm" : rc > rw ? "cool" : "neutral";
      }

      const scored = uniqueDB.map((x) => {
        let s = 0;
        const isApiProduct = x.id < 0;
        const txt = ((x.n || "") + " " + (x.pr || "") + " " + (x.r || "")).toLowerCase();

        // ── 1. STYLE COHERENCE (80/20 rule) — max ~35 pts ──
        if (vibe && x.v && x.v.length > 0) {
          if (x.v.includes(vibe)) s += 35;
          else {
            let best = 0;
            for (const st of x.v) { best = Math.max(best, vibeCompat[st] || 0); }
            s += Math.round(best * 25);
            if (best < 0.4) s -= 15; // Clashing style penalty
          }
        } else if (vibe && isApiProduct) {
          // API products lack v[] — infer style fit from name/description text
          // Check if product text matches the style's palette materials/colors/feel keywords
          const styleKws: Record<string, string[]> = {
            "Warm Modern": ["modern","clean","warm","oak","walnut","linen","bouclé","neutral"],
            "Minimalist": ["minimal","simple","clean","sleek","modern","white","steel","glass"],
            "Bohemian": ["bohemian","boho","rattan","woven","jute","macramé","eclectic","colorful"],
            "Scandinavian": ["scandinavian","nordic","birch","pine","simple","light","natural","white"],
            "Mid-Century": ["mid-century","midcentury","retro","vintage","teak","walnut","tapered","atomic"],
            "Luxury": ["luxury","elegant","marble","velvet","gold","crystal","silk","premium"],
            "Coastal": ["coastal","beach","nautical","navy","whitewashed","rattan","rope","driftwood"],
            "Japandi": ["japandi","zen","minimal","ash","ceramic","natural","simple","wabi"],
            "Industrial": ["industrial","metal","steel","iron","reclaimed","pipe","rustic","urban"],
            "Art Deco": ["art deco","deco","geometric","gold","lacquer","velvet","glamorous"],
            "Rustic": ["rustic","farmhouse","reclaimed","wood","barn","distressed","natural","country"],
            "Glam": ["glam","glamorous","velvet","mirror","crystal","gold","silver","fur","tufted"],
            "Transitional": ["transitional","classic","timeless","traditional","neutral","elegant"],
            "Organic Modern": ["organic","natural","stone","clay","linen","earthy","raw","handmade"],
          };
          const kws = styleKws[vibe] || [];
          let styleHits = 0;
          for (const kw of kws) { if (txt.includes(kw)) styleHits++; }
          if (styleHits >= 3) s += 28; // Strong style match from text
          else if (styleHits >= 2) s += 18;
          else if (styleHits >= 1) s += 8;
        }

        // ── 2. COLOR PALETTE HARMONY — max ~18 pts ──
        if (vibePalette) {
          let colorHits = 0;
          for (const c of vibePalette.colors) { if (txt.includes(c)) colorHits++; }
          s += colorHits * 8;
          if (colorHits >= 2) s += 10; // Deeply in-palette bonus
        }

        // ── 3. MATERIAL FAMILY HARMONY — max ~28 pts ──
        if (vibePalette) {
          let matHits = 0;
          for (const mat of vibePalette.materials) { if (txt.includes(mat)) matHits++; }
          s += matHits * 10;
          if (matHits >= 2) s += 8; // Multiple material families bonus
        }

        // ── 4. ROOM TYPE FIT — +22 pts ──
        if (room && x.rm && x.rm.includes(room)) s += 22;
        else if (room && isApiProduct) {
          // API products have rm:[] — infer room fit from product name
          const roomInference: Record<string, string[]> = {
            "Living Room": ["sofa","couch","coffee table","side table","floor lamp","area rug","throw pillow","accent chair"],
            "Bedroom": ["bed","nightstand","dresser","headboard","mattress","bedding","duvet","pillow sham"],
            "Dining Room": ["dining","buffet","sideboard","hutch","centerpiece","wine rack"],
            "Kitchen": ["bar stool","counter stool","kitchen","island"],
            "Office": ["desk","office chair","bookshelf","filing","task lamp","monitor"],
            "Outdoor": ["patio","outdoor","garden","adirondack","fire pit","umbrella"],
            "Bathroom": ["bath","vanity","towel","shower","mirror"],
            "Great Room": ["sofa","sectional","console","entertainment","media"],
          };
          const roomKws = roomInference[room] || [];
          for (const kw of roomKws) { if (txt.includes(kw)) { s += 18; break; } }
        }

        // ── 5. CATEGORY TIER PRIORITY (Tier 1 > 2 > 3) — max 30 pts ──
        const tier = catTiers[x.c as string] || 3;
        if (tier === 1) s += 30;
        else if (tier === 2) s += 15;
        else s += 5;

        // ── 6. BUDGET FIT with investment logic — max +15, min -20 ──
        if (bud !== "all" && maxP < Infinity) {
          const investLevel = CATEGORY_INVESTMENT[x.c] || "flexible";
          if (x.p >= minP && x.p <= maxP) {
            s += 15;
          } else if (x.p < minP * 0.5 || x.p > maxP * 2) {
            s -= 20; // Way out of budget
          } else {
            s -= 5;
          }
          // Investment pieces should be higher-quality
          if (investLevel === "splurge" && x.p > maxP * 0.5) s += 5;
          // Save pieces should be budget-friendly
          if (investLevel === "save" && x.p < maxP * 0.4) s += 5;
        }

        // ── 7. COLOR TEMPERATURE CONSISTENCY — max +6, min -3 ──
        if (roomTemp !== "neutral") {
          const pTemp = getProductTemp(txt);
          if (pTemp !== "neutral") {
            if (pTemp === roomTemp) s += 6;
            else s -= 3;
          }
        } else if (vibePalette) {
          // No room photo — use style palette's temperature
          const paletteTemp = getProductTemp(vibePalette.colors.join(" "));
          const pTemp = getProductTemp(txt);
          if (paletteTemp !== "neutral" && pTemp !== "neutral") {
            if (pTemp === paletteTemp) s += 6;
            else s -= 3;
          }
        }

        // ── 8. ROOM PHOTO COLOR HARMONY — max ~23 pts ──
        if (roomColors.length > 0) {
          let hits = 0;
          for (const rc of roomColors) { if (txt.includes(rc)) hits++; }
          s += hits * 5;
          if (hits >= 2) s += 8; // Deeply coordinated with room
        }

        // ── 9. KAA / DESIGNER-APPROVED — +8 pts ──
        if (x.kaa) s += 8;

        // ── 10. CATEGORY KEYWORD MATCH from user message (word-boundary) ──
        const catKws: Record<string, string[]> = {
          sofa: ["sofa","couch","sectional","loveseat"],
          table: ["table","desk","coffee table","console","dining table","nightstand"],
          chair: ["chair","seat","lounge","armchair","recliner"],
          bed: ["bed","headboard","mattress"],
          stool: ["stool","counter stool","bar stool"],
          light: ["lamp","chandelier","pendant","sconce","light fixture"],
          rug: ["rug","carpet","runner"],
          art: ["art","painting","print","canvas","poster"],
          accent: ["ottoman","bench","mirror","cabinet","dresser","pillow","vase","throw"],
          storage: ["shelf","bookcase","cabinet","sideboard","credenza","dresser"],
        };
        Object.entries(catKws).forEach(([cat, kws]) => {
          kws.forEach((w) => { if (wordMatch(m, w) && x.c === cat) s += 6; });
        });

        // ── 11. PRODUCT NAME WORD MATCH (word-boundary) ──
        (x.n || "").toLowerCase().split(/\s+/).forEach((w) => {
          if (w.length > 3 && wordMatch(m, w)) s += 2;
        });

        // ── 12. RETAILER TIER HARMONY (prefer consistent tier range) ──
        // Slight preference for mid-to-premium retailers with established furniture lines
        const rTier = getRetailerTier(x.r);
        if (rTier >= 2 && rTier <= 3) s += 3; // Mid-premium sweet spot

        // ── 13. API PRODUCT BOOST — real-time, purchasable items from major retailers ──
        // Strong boost ensures API products are well-represented in recommendations.
        // API products miss KAA (+8), room fit from rm[] (+22), style from v[] (+35) = ~65 pts gap.
        // +60 closes that gap so API products compete strongly even on generic asks.
        if (isApiProduct) s += 60;

        // ── Tiny random noise to break ties naturally ──
        s += Math.random() * 2;

        return { ...x, _s: s };
      }).sort((a, b) => b._s - a._s);

      // ── BUILD CATALOG WITH GUARANTEED CATEGORY COVERAGE ──
      // A living room MUST have sofas, tables, chairs, rugs, lighting, art in the catalog
      // so the AI can recommend a complete room, not just 15 of one category.
      const roomType = room || "Living Room";
      const roomNeeds = (ROOM_NEEDS as Record<string, RoomNeed>)[roomType] || {};
      const essentialCats = (roomNeeds as RoomNeed).essential || ["sofa"];
      const recommendedCats = (roomNeeds as RoomNeed).recommended || ["table","chair","rug","light","art","accent"];
      const allNeededCats = [...new Set([...essentialCats, ...recommendedCats])];

      // Step 1: Pick best 3-4 products per needed category — purely by score
      // No forced DB/API split: scoring already accounts for style, color, material,
      // budget, room fit, and retailer tier. The best products win regardless of source.
      const catalogPicks: (typeof scored[0])[] = [];
      const pickedIds = new Set<number>();
      for (const cat of allNeededCats) {
        const catItems = scored.filter(x => x.c === cat && !pickedIds.has(x.id));
        // Take top 3 by score (DB and API compete equally)
        const topForCat = catItems.slice(0, 3);
        for (const p of topForCat) {
          catalogPicks.push(p);
          pickedIds.add(p.id);
        }
      }
      // Step 2: Fill remaining slots with highest-scored products not yet picked
      const remaining = scored.filter(x => !pickedIds.has(x.id));
      for (const p of remaining) {
        if (catalogPicks.length >= 25) break;
        catalogPicks.push(p);
        pickedIds.add(p.id);
      }

      const apiInCatalog = catalogPicks.filter(x => x.id < 0).length;
      console.log("[AURA] Catalog built:", catalogPicks.length, "total,", apiInCatalog, "API products");

      // Rich catalog entries: include colors, materials, style for each product
      // so the AI can make informed design decisions about cohesion and fit
      const catalogStr = catalogPicks.slice(0, 25).map((x) => {
        const src = x.id < 0 ? " [LIVE]" : "";
        const styles = (x.v && x.v.length > 0) ? " | Styles: " + x.v.join(", ") : "";
        // Extract visible colors & materials from product name/description for AI context
        const ptxt = ((x.n || "") + " " + (x.pr || "")).toLowerCase();
        const pColors: string[] = [];
        const pMats: string[] = [];
        if (vibePalette) {
          for (const c of vibePalette.colors) { if (ptxt.includes(c)) pColors.push(c); }
          for (const mt of vibePalette.materials) { if (ptxt.includes(mt)) pMats.push(mt); }
        }
        // Also check common universal colors/materials not in the current palette
        const universalColors = ["white","black","gray","grey","cream","beige","ivory","brown","tan","navy","blue","green","red","gold","silver","natural","walnut","oak","teak","mahogany","espresso"];
        const universalMats = ["wood","metal","steel","glass","leather","velvet","linen","cotton","marble","ceramic","rattan","fabric","iron","brass","chrome","stone"];
        for (const c of universalColors) { if (ptxt.includes(c) && !pColors.includes(c)) pColors.push(c); }
        for (const mt of universalMats) { if (ptxt.includes(mt) && !pMats.includes(mt)) pMats.push(mt); }
        const colorStr = pColors.length > 0 ? " | Colors: " + pColors.slice(0, 4).join(", ") : "";
        const matStr = pMats.length > 0 ? " | Materials: " + pMats.slice(0, 3).join(", ") : "";
        const desc = x.pr ? " | " + (x.pr.length > 60 ? x.pr.slice(0, 60) + "…" : x.pr) : "";
        return "[ID:" + x.id + "] " + x.n + " — " + x.r + ", $" + x.p + " (" + x.c + ")" + src + styles + colorStr + matStr + desc;
      }).join("\n");
      const palette = (STYLE_PALETTES as Record<string, StylePalette>)[vibe as string] || {};

      // Build furniture dimension reference for AI
      const furnDimStr = Object.entries(FURN_DIMS).map(([k, v]) => k + ": " + v.w + "ft W x " + v.d + "ft D").join(", ");

      // Build selected products context so AI knows what's already chosen
      const selProductStr = selItems.length > 0
        ? "\n\nALREADY SELECTED BY USER (" + selItems.length + " items):\n" + selItems.map(p => "- " + p.n + " (" + p.c + ") by " + p.r + " — $" + p.p).join("\n")
        : "";

      // Detect if user is asking for a specific item/retailer vs designing a full room
      const specificItemKws = ["sofa","couch","table","chair","desk","lamp","rug","bed","stool","light","chandelier","pendant","mirror","ottoman","bench","dresser","nightstand","bookshelf","cabinet","art","shelf"];
      const retailerKws = ["walmart","ikea","target","amazon","wayfair","west elm","cb2","pottery barn","crate","restoration hardware","article","joybird","castlery","arhaus"];
      const isSpecificRequest = specificItemKws.some(kw => m.includes(kw)) || retailerKws.some(kw => m.includes(kw));
      const isFullRoomRequest = !isSpecificRequest || /design|furnish|complete|full|entire|whole|help me|set up|start/i.test(msg);

      // Build room essentials checklist for AI
      const essentialStr = essentialCats.join(", ");
      const recommendedStr = recommendedCats.join(", ");
      const apiCount = catalogPicks.filter(x => x.id < 0).length;

      // Room-specific essentials descriptions for the AI
      const roomChecklists: Record<string, string> = {
        "Living Room": "sofa (THE anchor piece), coffee table, area rug (8x10 or larger), floor/table lamp + overhead light, accent chair(s), throw pillows, wall art or mirror, side table",
        "Bedroom": "bed frame + headboard, 2 nightstands (flanking bed), table lamps (one per nightstand), area rug (under bed extending 2ft on sides), dresser or chest, accent chair or bench at foot, wall art above bed, throw blanket + pillows",
        "Dining Room": "dining table (sized for 4-8), dining chairs (matching set of 4-6), chandelier or pendant light over table, area rug (extends 2ft beyond chairs), sideboard or buffet, wall art or mirror, table centerpiece",
        "Kitchen": "counter/bar stools (2-4), pendant lights over island (2-3), small accent items",
        "Office": "desk, task/office chair, desk lamp + overhead light, bookshelf or storage, area rug, wall art, desk accessories",
        "Outdoor": "lounge chairs or sofa, side table, dining set, string lights or lanterns, outdoor rug, planters",
        "Bathroom": "vanity light fixture, mirror, accent stool or shelf, wall art (moisture-safe), decorative accessories",
        "Great Room": "sofa + loveseat or sectional, coffee table + side tables, area rug (defining conversation zone), floor lamp + table lamps, dining table + chairs, accent chairs, wall art, decorative accents"
      };
      const checklist = roomChecklists[room as string] || roomChecklists["Living Room"];

      const sysPrompt = "You are AURA, an elite AI interior design consultant with access to over 100,000 products from hundreds of top retailers. You curate like a professional designer — every recommendation must feel COHESIVE, like a thoughtfully assembled collection, not random picks.\n\nCatalog (most relevant from 100k+ products — items marked [LIVE] are real-time results from top retailers):\n" + catalogStr +
        (apiCount > 0 ? "\n\n[LIVE] items are real-time results from top retailers — include them when they genuinely fit the design. Prioritize COHESION over source. Only pick [LIVE] products that harmonize with the room's style, color palette, and material family." : "") +
        "\n\nContext: Room=" + (room || "any") + ", Style=" + (vibe || "any") +
        ", Budget=" + (bud === "all" ? "any" : bud) + (sqft ? ", ~" + sqft + " sq ft" : "") +
        (roomW && roomL ? ", Dimensions=" + roomW + "ft x " + roomL + "ft" : "") +
        selProductStr +
        (isFullRoomRequest ?
          "\n\nROOM COMPLETENESS (CRITICAL — you are designing a COMPLETE room):" +
          "\nA " + (room || "living room") + " needs ALL of these: " + checklist + "." +
          "\nEssential categories (MUST have at least 1 each): " + essentialStr +
          "\nRecommended (should include): " + recommendedStr +
          "\nYou MUST recommend at least ONE product from EACH essential category — a room without a sofa, without a rug, without lighting is INCOMPLETE." +
          "\nRecommend 6-8 DIFFERENT products total. Quality over quantity — each piece must EARN its place. NEVER 2+ of the same category unless it's chairs for a dining table." +
          "\nIMPORTANT: Pick products APPROPRIATE for the room type. Nightstands belong in BEDROOMS, not living rooms. Coffee tables and side tables go in living rooms. Dining tables go in dining rooms. READ the product name carefully." +
          "\nThink like a designer assembling a curated collection: every piece should share a visual thread — a common color tone, material family, or design language."
        :
          "\n\nSPECIFIC REQUEST: The user is asking about a specific type of item or retailer." +
          "\nRecommend ALL matching products from the catalog above. Show EVERY option that fits their request." +
          "\nCRITICAL: ONLY recommend products that are in the catalog above with [ID:N]. Do NOT invent or describe products that aren't listed." +
          "\nFor each product, explain WHY it works — color, material, scale, and how it complements their room and style." +
          "\nIf few matching products are in the catalog, be honest about how many options are available rather than padding with non-existent items."
        ) +
        "\n\nDESIGN PRINCIPLES:" +
        "\n1. COLOR COHESION (60-30-10): 60% dominant, 30% secondary, 10% accent. Palette colors: " + (palette.colors || []).join(", ") +
        (roomColors.length > 0 ? ". ROOM'S EXISTING COLORS: " + roomColors.join(", ") + " — complement these" : "") +
        "\n2. MATERIAL HARMONY: 2-3 material families. Palette materials: " + (palette.materials || []).join(", ") +
        "\n3. STYLE COHERENCE: 80% primary style, 20% compatible accent." +
        "\n4. PRICE TIERS: Splurge on anchor pieces (sofa, bed, dining table). Save on accessories." +
        "\n5. SPATIAL FIT: " + furnDimStr + ". Room ~" + (sqft || "200") + " sqft. Fill ~60%, leave 40% for walkways." +
        (cadAnalysis ? "\nFloor plan: " + cadAnalysis.slice(0, 500) : "") +
        (roomPhotoAnalysis ? "\nROOM PHOTO: " + roomPhotoAnalysis : "") +
        ((roomNeeds as RoomNeed).layout ? "\nLayout: " + (roomNeeds as RoomNeed).layout : "") +
        "\n\nRULES: Write flowing paragraphs, NOT numbered lists. Bold product names with **name**. Reference EVERY product as [ID:N]. Warm editorial tone." +
        "\nCRITICAL: ONLY recommend products from the catalog above. Every product you mention MUST have an [ID:N] reference. NEVER describe or recommend products that aren't in the catalog — the user can only add items you reference by ID." +
        "\nCOHESION IS EVERYTHING: Before finalizing your picks, verify they work as a SET — shared color temperature (all warm or all cool), 2-3 material families max, consistent design era. If a piece doesn't harmonize with the others, SWAP it for one that does. Explain the visual thread tying pieces together." +
        "\nVARY your recommendations — never the same products twice.";

      const chatHistory = [{ role: "system", content: sysPrompt }];
      // Include full conversation history (last 12 messages) so AI remembers the room, preferences, and prior recommendations
      msgs.slice(-12).forEach((mm) => {
        if (mm.role === "user") chatHistory.push({ role: "user", content: mm.text || "" });
        else if (mm.role === "bot" && mm.text) chatHistory.push({ role: "assistant", content: (mm.text || "").slice(0, 800) });
      });
      chatHistory.push({ role: "user", content: msg });

      // Use OpenRouter (GPT-4o-mini) via secure proxy, Pollinations as fallback
      const text = await aiChat(chatHistory);

      if (text && text.length > 20 && text !== "[object Object]") {
        // Step 1: Extract all referenced product IDs (supports negative IDs for API products)
        const ids: number[] = []; const rx = /\[ID:(-?\d+)\]/g; let mt;
        while ((mt = rx.exec(text)) !== null) ids.push(parseInt(mt[1]));
        const apiIds = ids.filter(id => id < 0);
        const dbIds = ids.filter(id => id >= 0);
        console.log("[AURA] AI referenced IDs — DB:", dbIds.length, "API:", apiIds.length, "(IDs:", apiIds.join(","), ")");
        // Deduplicate IDs first — AI may reference same product multiple times
        const uniqueIds = [...new Set(ids)];
        let aiRecs = uniqueIds.map((id) => uniqueDB.find((p) => p.id === id)).filter((x): x is Product => Boolean(x));
        console.log("[AURA] Resolved from IDs:", aiRecs.length, "products");

        // Step 2: ALSO try bold name matching (always, not just when IDs fail)
        // The AI often mentions products by name without [ID:N]
        const boldNames: string[] = []; const bx = /\*\*([^*]+)\*\*/g; let bm;
        while ((bm = bx.exec(text)) !== null) boldNames.push(bm[1].toLowerCase().trim());
        const foundIds = new Set(aiRecs.map(p => p.id));
        for (const bn of boldNames) {
          if (foundIds.size >= 8) break;
          let match = uniqueDB.find(p => !foundIds.has(p.id) && (p.n || "").toLowerCase() === bn);
          if (!match) match = uniqueDB.find(p => !foundIds.has(p.id) && ((p.n || "").toLowerCase().includes(bn) || bn.includes((p.n || "").toLowerCase())));
          if (!match) {
            const words = bn.split(/[\s,\-\/]+/).filter(w => w.length > 2);
            if (words.length >= 2) {
              match = uniqueDB.find(p => {
                if (foundIds.has(p.id)) return false;
                const pn = (p.n || "").toLowerCase();
                return words.filter(w => pn.includes(w)).length >= Math.ceil(words.length * 0.6);
              });
            }
          }
          if (match) { aiRecs.push(match); foundIds.add(match.id); }
        }

        // No forced injection — scoring + AI decide which products earn their place
        const apiInRecs = aiRecs.filter(p => p.id < 0).length;
        console.log("[AURA] Final recs:", aiRecs.length, "total |", apiInRecs, "API |", aiRecs.filter(p => p.id >= 0).length, "curated");

        // Cache ALL API products from recs + catalog so they persist for selection/purchase list
        const apiToCache = [...aiRecs, ...catalogPicks].filter(p => p.id < 0);
        if (apiToCache.length > 0) {
          setFeaturedCache(prev => {
            const next = new Map(prev);
            for (const p of apiToCache) { if (!next.has(p.id)) next.set(p.id, p); }
            return next;
          });
        }

        const cleanText = text.replace(/\[ID:-?\d+\]/g, "").trim();
        setMsgs((prev) => [...prev, { role: "bot", text: cleanText, recs: dedupRecsById(aiRecs.length > 0 ? aiRecs : topPicks) }]);
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
        } else if (detectedRoom || detectedStyle || aiRecs.length > 4) {
          const fallbackRoom = detectedRoom || "Living Room";
          const fallbackStyle = detectedStyle || "Warm Modern";
          setTimeout(() => triggerMoodBoards(fallbackRoom, fallbackStyle, bud, sqft), 300);
          setBoardsGenHint("Mood boards curated from your request" + (!detectedRoom ? " — select a room type for better results" : "") + (!detectedStyle ? " — select a style for better results" : ""));
        }
      }
    } catch (e) { console.log("AI chat error:", e); }

    if (!aiWorked) {
      // Mix API products into fallback recs
      const fallbackRecs = [...topPicks.slice(0, 6)];
      const fallbackIds = new Set(fallbackRecs.map(p => p.id));
      const apiForFallback = [...apiProducts, ...cachedApiProducts].filter(p => !fallbackIds.has(p.id)).slice(0, 3);
      for (const ap of apiForFallback) { fallbackRecs.push(ap); fallbackIds.add(ap.id); }
      console.log("[AURA] Fallback recs:", fallbackRecs.length, "total |", fallbackRecs.filter(p => p.id < 0).length, "API");

      const palette = (STYLE_PALETTES as Record<string, StylePalette>)[vibe as string] || {};
      const reasons = fallbackRecs.slice(0, 8).map((p) => {
        const dims = getProductDims(p);
        const styleMatch = vibe && p.v && p.v.includes(vibe) ? ", perfectly suited to the **" + vibe + "** aesthetic" : "";
        const roomMatch = room && p.rm && p.rm.some(r => r === room) ? " and ideal for your **" + room + "**" : "";
        const spatial = sqft ? " At " + dims.w + "'x" + dims.d + "', it's well-proportioned for your " + sqft + " sqft space." : "";
        const catLabel = ({ sofa:"luxurious seating piece", chair:"stunning chair", table:"beautiful table", light:"striking light fixture", rug:"gorgeous rug", art:"captivating art piece", stool:"elegant stool", accent:"refined accent piece", bed:"luxurious bed" } as Record<string, string>)[p.c] || "refined piece";
        return "**" + p.n + "** by " + p.r + " (" + fmt(p.p) + ") — a " + catLabel + styleMatch + roomMatch + "." + spatial;
      }).join("\n\n");
      setMsgs((prev) => [...prev, {
        role: "bot",
        text: (palette.feel ? "_" + palette.feel + "_\n\n" : "") + "Here's what I'd recommend:\n\n" + reasons + "\n\nWould you like me to go deeper on any of these, or explore a different direction?",
        recs: dedupRecsById(fallbackRecs)
      }]);
      // Trigger mood boards from fallback too
      if (room && vibe) {
        setTimeout(() => triggerMoodBoards(room, vibe, bud, sqft), 300);
        setBoardsGenHint("Mood boards generated based on your request");
      }
    }
    } finally {
      clearInterval(countdownInterval);
      clearInterval(aiStageInterval);
      setSearchProgress(null);
      setBusy(false);
    }
  };

  const localMatch = (msg: string): Product[] => {
    const m = msg.toLowerCase();
    const pool = [...DB, ...Array.from(featuredCache.values())];
    const seenIds = new Set<number>();
    const uniquePool = pool.filter(p => { if (seenIds.has(p.id)) return false; seenIds.add(p.id); return true; });
    return uniquePool.map((x) => {
      let s = Math.random() * 1.5;
      const kws: Record<string, string[]> = { sofa:["sofa","couch","sectional","seating"], table:["table","desk","coffee","console","dining","side"], chair:["chair","seat","lounge","armchair"], stool:["stool","counter","bar"], light:["light","lamp","chandelier","pendant","sconce"], rug:["rug","carpet"], art:["art","painting","print","wall"], accent:["accent","ottoman","tub","bench","headboard","daybed","cabinet","mirror","bed","dresser","nightstand","credenza"] };
      Object.keys(kws).forEach((cat) => { kws[cat].forEach((w: string) => { if (m.includes(w) && x.c === cat) s += 7; }); });
      if (room && x.rm && x.rm.some((r) => r === room)) s += 4;
      if (vibe && x.v && x.v.includes(vibe)) s += 5;
      const palette = (STYLE_PALETTES as Record<string, StylePalette>)[vibe as string];
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

  // ─── Featured catalog search ───
  const featuredCats = [
    { id: "all", n: "All Furniture" }, { id: "sofa", n: "Sofas" }, { id: "table", n: "Tables" },
    { id: "chair", n: "Chairs" }, { id: "bed", n: "Beds" }, { id: "light", n: "Lighting" },
    { id: "rug", n: "Rugs" }, { id: "storage", n: "Storage" }, { id: "outdoor", n: "Outdoor" },
    { id: "stool", n: "Stools" }, { id: "art", n: "Art" }, { id: "accent", n: "Decor" }
  ];

  const doFeaturedSearch = useCallback(async (query?: string, cat?: string, pg?: number) => {
    const q = query ?? featuredQuery;
    const c = cat ?? featuredCat;
    const p = pg ?? 1;
    setFeaturedLoading(true);
    try {
      const result = await searchFeaturedProducts(q || "", p, c !== "all" ? c : undefined);
      if (p === 1) {
        setFeaturedProducts(result.products);
      } else {
        setFeaturedProducts(prev => [...prev, ...result.products]);
      }
      setFeaturedTotal(result.total);
      setFeaturedRetailers(prev => {
        const combined = new Set([...prev, ...result.retailers]);
        return Array.from(combined);
      });
      setFeaturedPage(p);
      // Cache featured products for selection persistence
      setFeaturedCache(prev => {
        const next = new Map(prev);
        for (const prod of result.products) next.set(prod.id, prod);
        return next;
      });
    } catch (_e) {
      console.log("Featured search failed");
    }
    setFeaturedLoading(false);
  }, [featuredQuery, featuredCat]);

  // Auto-fetch featured products when Featured tab is opened (or on first load)
  useEffect(() => {
    if (tab === "featured" && featuredProducts.length === 0 && !featuredLoading) {
      doFeaturedSearch("", "all", 1);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combined selected items: DB products + featured products (including chat-cached API products)
  const allProducts = [...DB, ...Array.from(featuredCache.values())];
  const selItems = allProducts.filter((p) => sel.has(p.id));
  const selTotal = selItems.reduce((s, p) => s + p.p * (sel.get(p.id) || 1), 0);
  // Use resolved items count (not raw sel.size which may include stale/unresolvable IDs)
  const selCount = selItems.reduce((s, p) => s + (sel.get(p.id) || 1), 0);

  // Prune stale selection IDs that can't resolve to any known product
  useEffect(() => {
    const knownIds = new Set(allProducts.map(p => p.id));
    const staleIds = Array.from(sel.keys()).filter(id => !knownIds.has(id));
    if (staleIds.length > 0) {
      console.log("[AURA] Pruning", staleIds.length, "stale selection IDs");
      setSel(prev => {
        const next = new Map(prev);
        for (const id of staleIds) next.delete(id);
        return next;
      });
    }
  }, [featuredCache.size]); // Re-check when cache updates // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── ADMIN ANALYTICS PAGE ─── */
  if (pg === "admin") {
    // ─── Admin Password Gate ───
    if (!adminAuthed) {
      return (
        <div style={{ fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", background: "#FDFCFA", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ maxWidth: 400, width: "100%", padding: "48px 32px", background: "#fff", borderRadius: 20, border: "1px solid #EDE8E2", textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
            <div style={{ marginBottom: 24 }}><AuraLogo size={36} /></div>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400, margin: "0 0 6px" }}>Admin Access</h2>
            <p style={{ fontSize: 13, color: "#9B8B7B", margin: "0 0 28px" }}>Enter the admin password to continue</p>
            <form onSubmit={async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); try { const resp = await fetch("/api/admin-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminPass: adminPassInput }) }); if (resp.ok) { setAdminAuthed(true); setAdminPassErr(""); const d = await resp.json(); if (!d.error) setAdminStats(d); } else { setAdminPassErr("Incorrect password"); } } catch { setAdminPassErr("Network error"); } }}>
              <input type="password" placeholder="Admin password" value={adminPassInput} onChange={e => { setAdminPassInput(e.target.value); setAdminPassErr(""); }}
                style={{ width: "100%", padding: "14px 16px", border: "1px solid " + (adminPassErr ? "#D45B5B" : "#E8E0D8"), borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 12 }} />
              {adminPassErr && <p style={{ fontSize: 12, color: "#D45B5B", margin: "0 0 12px" }}>{adminPassErr}</p>}
              <button type="submit" style={{ width: "100%", padding: "14px 0", background: "#1A1815", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Unlock Admin</button>
            </form>
            <button onClick={() => go("home")} style={{ marginTop: 16, background: "none", border: "none", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>← Back to site</button>
          </div>
        </div>
      );
    }

    // Fetch user/usage stats from Supabase on first load
    if (!adminStats) {
      fetch("/api/admin-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPass: adminPassInput })
      }).then(r => r.json()).then(d => { if (!d.error) setAdminStats(d); }).catch(() => {});
    }

    // Compute all analytics from DB and localStorage
    const catCounts: Record<string, number> = {};
    const retailerCounts: Record<string, number> = {};
    const retailerRevenue: Record<string, number> = {};
    const styleCounts: Record<string, number> = {};
    const roomCounts: Record<string, number> = {};
    const priceRanges: Record<string, number> = { "Under $100": 0, "$100-$500": 0, "$500-$1K": 0, "$1K-$5K": 0, "$5K-$10K": 0, "$10K-$25K": 0, "$25K+": 0 };
    const leadTimes: Record<string, number> = {};
    let totalValue = 0;
    let minPrice = Infinity;
    let maxPrice = 0;
    let kaaCount = 0;
    let hasImageCount = 0;
    let brokenImgCount = 0;

    DB.forEach(p => {
      // Category
      catCounts[p.c] = (catCounts[p.c] || 0) + 1;
      // Retailer
      retailerCounts[p.r] = (retailerCounts[p.r] || 0) + 1;
      retailerRevenue[p.r] = (retailerRevenue[p.r] || 0) + p.p;
      // Style vibes
      (p.v || []).forEach(v => { styleCounts[v] = (styleCounts[v] || 0) + 1; });
      // Room compatibility
      (p.rm || []).forEach(r => { roomCounts[r] = (roomCounts[r] || 0) + 1; });
      // Price ranges
      if (p.p < 100) priceRanges["Under $100"]++;
      else if (p.p < 500) priceRanges["$100-$500"]++;
      else if (p.p < 1000) priceRanges["$500-$1K"]++;
      else if (p.p < 5000) priceRanges["$1K-$5K"]++;
      else if (p.p < 10000) priceRanges["$5K-$10K"]++;
      else if (p.p < 25000) priceRanges["$10K-$25K"]++;
      else priceRanges["$25K+"]++;
      // Lead times
      leadTimes[p.l] = (leadTimes[p.l] || 0) + 1;
      // Stats
      totalValue += p.p;
      if (p.p < minPrice) minPrice = p.p;
      if (p.p > maxPrice) maxPrice = p.p;
      if (p.kaa) kaaCount++;
      if (p.img) hasImageCount++;
    });

    const avgPrice = Math.round(totalValue / DB.length);
    const medianPrice = [...DB].sort((a, b) => a.p - b.p)[Math.floor(DB.length / 2)].p;
    const sortedRetailers = Object.entries(retailerCounts).sort((a, b) => b[1] - a[1]);
    const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    const sortedStyles = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]);
    const sortedRooms = Object.entries(roomCounts).sort((a, b) => b[1] - a[1]);
    const sortedLeadTimes = Object.entries(leadTimes).sort((a, b) => b[1] - a[1]);

    // User activity stats from localStorage
    const savedProjects = projects.length;
    const currentSelCount = sel.size;
    const currentSelTotal = selTotal;
    const currentSelQtyCount = selCount;

    // Session analytics
    const sessionVibes = vibe || "None selected";
    const sessionRoom = room || "None selected";

    const statCard = (label: string, value: string | number, sub?: string, color?: string) => (
      <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E2", flex: "1 1 200px", minWidth: 180 }}>
        <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", margin: "0 0 8px", fontWeight: 600 }}>{label}</p>
        <p style={{ fontSize: 28, fontWeight: 700, color: color || "#1A1815", margin: "0 0 4px", fontFamily: "Georgia,serif" }}>{value}</p>
        {sub && <p style={{ fontSize: 12, color: "#B8A898", margin: 0 }}>{sub}</p>}
      </div>
    );

    const barChart = (data: [string, number][], maxVal: number, color?: string) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.map(([label, count]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#5A5045", width: 140, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            <div style={{ flex: 1, background: "#F5F0EB", borderRadius: 6, height: 24, overflow: "hidden", position: "relative" }}>
              <div style={{ width: Math.max(2, (count / maxVal) * 100) + "%", height: "100%", background: color || "#C17550", borderRadius: 6, transition: "width .8s ease" }} />
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 600, color: count / maxVal > 0.5 ? "#fff" : "#5A5045" }}>{count}</span>
            </div>
          </div>
        ))}
      </div>
    );

    return (
      <div style={{ minHeight: "100vh", background: "#F8F5F0", paddingTop: 60 }}>
        {/* Admin Nav */}
        <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, padding: "12px 5%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(253,252,250,.96)", backdropFilter: "blur(20px)", borderBottom: "1px solid #F0EBE4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div onClick={() => go("home")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><AuraLogo size={26} /><span style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 400 }}>AURA</span></div>
            <span style={{ fontSize: 10, background: "#1A1815", color: "#fff", padding: "3px 10px", borderRadius: 8, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>Admin</span>
          </div>
          <button onClick={() => go("home")} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "7px 16px", fontSize: 12, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back to Site</button>
        </nav>

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 5% 60px" }}>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 32, fontWeight: 400, marginBottom: 6, color: "#1A1815" }}>Analytics Dashboard</h1>
          <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 32 }}>Catalog stats, user activity, and product breakdowns</p>

          {/* ─── Grant Pro Panel ─── */}
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #EDE8E2", padding: "24px 28px", marginBottom: 32 }}>
            <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, margin: "0 0 4px" }}>Grant Pro Access</h3>
            <p style={{ fontSize: 12, color: "#9B8B7B", margin: "0 0 16px" }}>Enter a user's email to upgrade them to Pro</p>
            <form onSubmit={async (e: React.FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              if (!grantEmail.trim()) return;
              setGrantStatus(""); setGrantMsg("");
              try {
                const token = await getAuthToken();
                const resp = await fetch("/api/grant-pro", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
                  body: JSON.stringify({ email: grantEmail.trim(), adminPass: adminPassInput })
                });
                const data = await resp.json();
                if (resp.ok) { setGrantStatus("success"); setGrantMsg(data.message || "User upgraded to Pro!"); setGrantEmail(""); }
                else { setGrantStatus("error"); setGrantMsg(data.error || "Failed to grant Pro"); }
              } catch (err) { setGrantStatus("error"); setGrantMsg("Network error: " + (err as Error).message); }
            }} style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <input type="email" placeholder="user@example.com" value={grantEmail} onChange={e => { setGrantEmail(e.target.value); setGrantStatus(""); }}
                  style={{ width: "100%", padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
              </div>
              <button type="submit" style={{ padding: "12px 24px", background: "#5B8B6B", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Grant Pro</button>
            </form>
            {grantStatus === "success" && <p style={{ fontSize: 13, color: "#5B8B6B", margin: "12px 0 0", fontWeight: 500 }}>✓ {grantMsg}</p>}
            {grantStatus === "error" && <p style={{ fontSize: 13, color: "#D45B5B", margin: "12px 0 0" }}>✗ {grantMsg}</p>}
          </div>

          {/* User & Usage Stats (from Supabase) */}
          {adminStats && (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
                {statCard("Registered Users", adminStats.totalUsers, adminStats.proUsers + " Pro · " + adminStats.freeUsers + " Free", "#8B7355")}
                {statCard("Pro Subscribers", adminStats.proUsers, adminStats.totalUsers > 0 ? Math.round(adminStats.proUsers / adminStats.totalUsers * 100) + "% conversion" : "—", "#5B8B6B")}
                {statCard("Total Visualizations", adminStats.totalVizCount, "Across all users", "#C17550")}
              </div>
              {adminStats.userList && adminStats.userList.length > 0 && (
                <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #EDE8E2", overflow: "hidden", marginBottom: 32 }}>
                  <div style={{ padding: "18px 24px", borderBottom: "1px solid #F0EBE4" }}>
                    <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, margin: 0 }}>All Users</h3>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#FAFAF8", borderBottom: "1px solid #F0EBE4" }}>
                          {["Email", "Name", "Plan", "Viz Used", "Viz Month", "Signed Up"].map(h => (
                            <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#9B8B7B", letterSpacing: ".06em", textTransform: "uppercase", fontSize: 10 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {adminStats.userList.map((u, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #F5F2ED" }}>
                            <td style={{ padding: "10px 16px", color: "#1A1815", fontWeight: 500 }}>{u.email}</td>
                            <td style={{ padding: "10px 16px", color: "#5A5045" }}>{u.name || "—"}</td>
                            <td style={{ padding: "10px 16px" }}>
                              <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: u.plan === "pro" ? "#5B8B6B18" : "#E8E0D8", color: u.plan === "pro" ? "#5B8B6B" : "#9B8B7B", textTransform: "uppercase", letterSpacing: ".08em" }}>{u.plan}</span>
                            </td>
                            <td style={{ padding: "10px 16px", color: "#5A5045", fontWeight: 600 }}>{u.vizCount}</td>
                            <td style={{ padding: "10px 16px", color: "#9B8B7B" }}>{u.vizMonth || "—"}</td>
                            <td style={{ padding: "10px 16px", color: "#9B8B7B" }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── CONVERSION ANALYTICS ─── */}
          {(() => {
            const a = getAnalyticsSummary();
            return (
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #EDE8E2", overflow: "hidden", marginBottom: 32 }}>
                <div style={{ padding: "18px 24px", borderBottom: "1px solid #F0EBE4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, margin: 0 }}>Conversion Analytics</h3>
                  <span style={{ fontSize: 10, color: "#9B8B7B" }}>{a.total} events · {a.uniqueSessions} sessions</span>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: 20 }}>
                  {statCard("Buy Page Views", a.buyPageVisits, "Users who saw purchase list", "#C17550")}
                  {statCard("Buy Clicks", a.byEvent["buy_click"] || 0, "Clicked Buy → on a product", "#5B8B6B")}
                  {statCard("Checkout Clicks", a.checkoutClicks, "Clicked Subscribe", "#8B7355")}
                  {statCard("Sign Ups", a.byEvent["signup"] || 0, "New accounts created", "#8B7355")}
                  {statCard("AI Chats", a.byEvent["ai_chat"] || 0, "Messages sent to AI", "#7A6B5B")}
                  {statCard("Products Added", a.byEvent["product_add"] || 0, "Items added to selection", "#9B5B5B")}
                  {statCard("CTA Clicks", a.byEvent["cta_click"] || 0, "Start Designing clicks", "#6B8B5B")}
                </div>
                {a.last7Days && Object.keys(a.last7Days).length > 0 && (
                  <div style={{ padding: "0 20px 16px" }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: "#9B8B7B", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em" }}>Last 7 Days</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {Object.entries(a.last7Days).map(([ev, ct]) => (
                        <span key={ev} style={{ fontSize: 11, background: "#F5F2ED", padding: "4px 12px", borderRadius: 12, color: "#5A5045" }}>{ev}: <b>{ct}</b></span>
                      ))}
                    </div>
                  </div>
                )}
                {a.recentEvents.length > 0 && (
                  <div style={{ padding: "0 20px 20px" }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: "#9B8B7B", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em" }}>Recent Events</p>
                    <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 11, lineHeight: 1.6 }}>
                      {a.recentEvents.map((ev, i) => (
                        <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #F8F6F2", color: "#7A6B5B" }}>
                          <span style={{ fontWeight: 600, color: "#1A1815" }}>{ev.event}</span>
                          <span style={{ marginLeft: 8, color: "#B8A898" }}>{new Date(ev.ts).toLocaleString()}</span>
                          {ev.meta && <span style={{ marginLeft: 8, color: "#9B8B7B" }}>{Object.entries(ev.meta).map(([k, v]) => `${k}=${v}`).join(", ")}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* KPI Row */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
            {statCard("Total Products", "100,000+", "In catalog", "#C17550")}
            {statCard("Total Catalog Value", fmt(totalValue), DB.length + " products combined")}
            {statCard("Average Price", fmt(avgPrice), "Median: " + fmt(medianPrice))}
            {statCard("Price Range", fmt(minPrice) + " - " + fmt(maxPrice), "Min to max")}
            {statCard("Retailers", sortedRetailers.length, "Unique brands")}
          </div>

          {/* Second KPI Row */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 40 }}>
            {statCard("AD / KAA Items", kaaCount, Math.round(kaaCount / DB.length * 100) + "% of catalog", "#8B7355")}
            {statCard("With Images", hasImageCount, Math.round(hasImageCount / DB.length * 100) + "% coverage")}
            {statCard("Design Styles", Object.keys(styleCounts).length, "Curated palettes", "#5B8B6B")}
            {statCard("Room Types", Object.keys(roomCounts).length, "Supported rooms")}
            {statCard("Saved Projects", savedProjects, currentSelCount + " products selected")}
          </div>

          {/* Charts Grid */}
          <div className="aura-admin-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
            {/* Products by Category */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Products by Category</h3>
              {barChart(sortedCats, sortedCats[0]?.[1] || 1, "#C17550")}
            </div>

            {/* Products by Retailer */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Products by Retailer</h3>
              {barChart(sortedRetailers, sortedRetailers[0]?.[1] || 1, "#8B7355")}
            </div>

            {/* Products by Style */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Products by Style</h3>
              {barChart(sortedStyles, sortedStyles[0]?.[1] || 1, "#5B8B6B")}
            </div>

            {/* Products by Room */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Products by Room Compatibility</h3>
              {barChart(sortedRooms, sortedRooms[0]?.[1] || 1, "#6B5B8B")}
            </div>

            {/* Price Distribution */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Price Distribution</h3>
              {barChart(Object.entries(priceRanges).filter(([, c]) => c > 0), Math.max(...Object.values(priceRanges)), "#C17550")}
            </div>

            {/* Lead Times */}
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Lead Times</h3>
              {barChart(sortedLeadTimes, sortedLeadTimes[0]?.[1] || 1, "#8B6B55")}
            </div>
          </div>

          {/* Retailer Revenue Table */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2", marginBottom: 32 }}>
            <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Retailer Breakdown</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #EDE8E2" }}>
                    <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Retailer</th>
                    <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Products</th>
                    <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>% of Catalog</th>
                    <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Total Value</th>
                    <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Avg Price</th>
                    <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Min</th>
                    <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRetailers.map(([retailer, count], i) => {
                    const retailerProducts = DB.filter(p => p.r === retailer);
                    const rAvg = Math.round(retailerRevenue[retailer] / count);
                    const rMin = Math.min(...retailerProducts.map(p => p.p));
                    const rMax = Math.max(...retailerProducts.map(p => p.p));
                    return (
                      <tr key={retailer} style={{ borderBottom: "1px solid #F5F0EB", background: i % 2 === 0 ? "#FDFCFA" : "#fff" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1A1815" }}>{retailer}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#5A5045" }}>{count}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#9B8B7B" }}>{Math.round(count / DB.length * 100)}%</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, color: "#C17550" }}>{fmt(retailerRevenue[retailer])}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#5A5045" }}>{fmt(rAvg)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#9B8B7B" }}>{fmt(rMin)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right", color: "#9B8B7B" }}>{fmt(rMax)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Current Session + User Stats */}
          <div className="aura-admin-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Current Session</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  ["Current User", user ? (user.name + " (" + user.email + ")") : "Not signed in"],
                  ["Plan", userPlan === "pro" ? "Pro" : "Free"],
                  ["Selected Room", sessionRoom],
                  ["Selected Style", sessionVibes],
                  ["Budget Filter", budgets.find(b => b[0] === bud)?.[1] || bud],
                  ["Products Selected", currentSelCount + " unique, " + currentSelQtyCount + " total qty"],
                  ["Selection Value", fmt(currentSelTotal)],
                  ["Active Project", activeProjectId ? (projects.find(p => p.id === activeProjectId)?.name || activeProjectId) : "None"],
                  ["Room Dimensions", (roomW && roomL) ? roomW + "' x " + roomL + "'" : "Not set"],
                  ["Square Footage", sqft || "Not set"],
                  ["Room Photo", roomPhoto ? "Uploaded" : "None"],
                  ["CAD File", cadFile ? cadFile.name : "None"],
                  ["Visualizations", vizUrls.length + " generated"],
                  ["Viz Usage (month)", vizCount + "/" + vizLimit + " (" + vizRemaining + " remaining)"],
                  ["Chat Messages", msgs.length],
                  ["Mood Boards", boards ? boards.length + " generated" : "None"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F5F0EB" }}>
                    <span style={{ fontSize: 13, color: "#9B8B7B" }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1815", textAlign: "right", maxWidth: "60%" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2" }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Saved Projects</h3>
              {projects.length === 0 ? (
                <p style={{ fontSize: 13, color: "#B8A898", textAlign: "center", padding: 32 }}>No saved projects yet</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {projects.map(pr => (
                    <div key={pr.id} style={{ padding: "14px 18px", borderRadius: 12, border: activeProjectId === pr.id ? "2px solid #C17550" : "1px solid #EDE8E2", background: activeProjectId === pr.id ? "#C1755008" : "#FDFCFA" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#1A1815" }}>{pr.name}</span>
                        {activeProjectId === pr.id && <span style={{ fontSize: 9, background: "#C17550", color: "#fff", padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>ACTIVE</span>}
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#9B8B7B" }}>
                        <span>{(pr.items || []).length} items</span>
                        <span>{fmt(pr.total || 0)}</span>
                        {pr.room && <span>{pr.room}</span>}
                        {pr.sqft && <span>{pr.sqft} sqft</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top Priced Products */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2", marginBottom: 32 }}>
            <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Top 15 Most Expensive Products</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #EDE8E2" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>#</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Product</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Retailer</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Category</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {[...DB].sort((a, b) => b.p - a.p).slice(0, 15).map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid #F5F0EB", background: i % 2 === 0 ? "#FDFCFA" : "#fff" }}>
                      <td style={{ padding: "10px 12px", color: "#B8A898" }}>{i + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1A1815", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</td>
                      <td style={{ padding: "10px 12px", color: "#7A6B5B" }}>{p.r}</td>
                      <td style={{ padding: "10px 12px" }}><span style={{ fontSize: 10, background: "#F5F0EB", padding: "3px 10px", borderRadius: 8, textTransform: "uppercase", fontWeight: 600, color: "#8B7355", letterSpacing: ".05em" }}>{p.c}</span></td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#C17550" }}>{fmt(p.p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Currently Selected Products */}
          {sel.size > 0 && (
            <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2", marginBottom: 32 }}>
              <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Currently Selected Products ({selCount} items)</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #EDE8E2" }}>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Product</th>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Retailer</th>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Category</th>
                      <th style={{ textAlign: "center", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Qty</th>
                      <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Unit Price</th>
                      <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700 }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selItems.map((p, i) => {
                      const qty = sel.get(p.id) || 1;
                      return (
                        <tr key={p.id} style={{ borderBottom: "1px solid #F5F0EB", background: i % 2 === 0 ? "#FDFCFA" : "#fff" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1A1815" }}>{p.n}</td>
                          <td style={{ padding: "10px 12px", color: "#7A6B5B" }}>{p.r}</td>
                          <td style={{ padding: "10px 12px" }}><span style={{ fontSize: 10, background: "#F5F0EB", padding: "3px 10px", borderRadius: 8, textTransform: "uppercase", fontWeight: 600, color: "#8B7355" }}>{p.c}</span></td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600 }}>{qty}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#5A5045" }}>{fmt(p.p)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#C17550" }}>{fmt(p.p * qty)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "2px solid #EDE8E2", background: "#F8F5F0" }}>
                      <td colSpan={3} style={{ padding: "12px 12px", fontWeight: 700, color: "#1A1815" }}>Total</td>
                      <td style={{ padding: "12px 12px", textAlign: "center", fontWeight: 700 }}>{selCount}</td>
                      <td style={{ padding: "12px 12px" }} />
                      <td style={{ padding: "12px 12px", textAlign: "right", fontWeight: 700, color: "#C17550", fontSize: 15 }}>{fmt(selTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Category × Style Matrix */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: "1px solid #EDE8E2", marginBottom: 32 }}>
            <h3 style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 400, marginBottom: 20, color: "#1A1815" }}>Category × Style Coverage</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#9B8B7B", fontWeight: 700, position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>Category</th>
                    {VIBES.map(v => <th key={v} style={{ padding: "8px 6px", textAlign: "center", fontSize: 9, color: "#9B8B7B", fontWeight: 600, writingMode: "vertical-rl", transform: "rotate(180deg)", height: 90 }}>{v}</th>)}
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#9B8B7B", fontWeight: 700 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCats.map(([cat]) => {
                    const catProducts = DB.filter(p => p.c === cat);
                    return (
                      <tr key={cat} style={{ borderBottom: "1px solid #F5F0EB" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 600, color: "#1A1815", textTransform: "capitalize", position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>{cat}</td>
                        {VIBES.map(v => {
                          const ct = catProducts.filter(p => (p.v || []).includes(v)).length;
                          return <td key={v} style={{ padding: "6px", textAlign: "center" }}>
                            {ct > 0 ? <span style={{ display: "inline-block", minWidth: 24, padding: "2px 6px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: ct > 20 ? "#C1755030" : ct > 10 ? "#C1755018" : "#F5F0EB", color: ct > 20 ? "#8B4520" : ct > 10 ? "#C17550" : "#9B8B7B" }}>{ct}</span> : <span style={{ color: "#E8E0D8" }}>-</span>}
                          </td>;
                        })}
                        <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: "#C17550" }}>{catProducts.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ textAlign: "center", fontSize: 12, color: "#B8A898", marginTop: 40 }}>AURA Admin Dashboard — Data computed from catalog of {DB.length} products</p>
        </div>
      </div>
    );
  }

  /* ─── AUTH LOADING ─── */
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 32, height: 32, border: "2.5px solid #E8E0D8", borderTopColor: "#C17550", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
      </div>
    );
  }

  /* ─── EMAIL CONFIRMATION PAGE ─── */
  /* ─── ONBOARDING (new users) — multi-step flow into room creation ─── */
  if (showOnboarding && user) {
    const finishOnboarding = () => {
      localStorage.setItem("aura_onboarded", "true");
      setShowOnboarding(false);
      setOnboardStep(0);
      trackEvent("onboarding_complete", { room: room || "none", vibe: vibe || "none" });
      setTab("studio");
      setDesignStep(0);
      // Skip to budget step if room+vibe selected, otherwise start from beginning
      if (room && vibe) setSetupSubStep(2);
      else if (room) setSetupSubStep(1);
      else setSetupSubStep(0);
      go("home");
    };
    const skipOnboarding = () => {
      localStorage.setItem("aura_onboarded", "true");
      setShowOnboarding(false);
      setOnboardStep(0);
      trackEvent("onboarding_skip", {});
      go("home");
    };
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(160deg,#FDFCFA,#F0EBE4)" }}>
        <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}><AuraLogo size={36} /><h1 style={{ fontFamily: "Georgia,serif", fontSize: 32, fontWeight: 400, margin: 0 }}>AURA</h1></div>
          {/* Progress dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "16px 0 28px" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: i === onboardStep ? 24 : 8, height: 8, borderRadius: 4, background: i <= onboardStep ? "#C17550" : "#E8E0D8", transition: "all .3s" }} />
            ))}
          </div>

          {/* Step 0: Welcome */}
          {onboardStep === 0 && (<>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, marginBottom: 8, color: "#3A2E28" }}>Welcome, {user.name}!</h2>
            <p style={{ fontSize: 15, color: "#9B8B7B", marginBottom: 32, lineHeight: 1.6 }}>Let's design your perfect space. We'll help you pick a room, choose a style, and connect you with our AI designer in under a minute.</p>
            <button onClick={() => { setOnboardStep(1); trackEvent("onboarding_start", {}); }} style={{ width: "100%", background: "#1A1815", color: "#fff", padding: "16px 24px", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}>Let's get started</button>
            <button onClick={skipOnboarding} style={{ background: "none", border: "none", fontSize: 13, color: "#B8A898", cursor: "pointer", fontFamily: "inherit", padding: 8 }}>Skip for now</button>
          </>)}

          {/* Step 1: Pick a room */}
          {onboardStep === 1 && (<>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400, marginBottom: 8, color: "#3A2E28" }}>What room are you designing?</h2>
            <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 24 }}>Pick the space you want to transform.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, textAlign: "left", marginBottom: 24 }}>
              {ROOMS.map((rm) => (
                <button key={rm} onClick={() => setRoom(rm)} style={{ padding: "18px 16px", borderRadius: 12, border: room === rm ? "2px solid #1A1815" : "1px solid #E8E0D8", background: room === rm ? "#1A1815" : "#fff", fontSize: 14, fontWeight: room === rm ? 600 : 400, color: room === rm ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>{rm}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setOnboardStep(0)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 20px", fontSize: 14, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
              <button onClick={() => { setOnboardStep(2); trackEvent("onboarding_room", { room: room || "none" }); }} disabled={!room} style={{ flex: 1, background: room ? "#1A1815" : "#E8E0D8", color: room ? "#fff" : "#B8A898", padding: "14px 24px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: room ? "pointer" : "default", fontFamily: "inherit", transition: "all .2s" }}>
                {room ? "Next — pick your style" : "Select a room to continue"}
              </button>
            </div>
          </>)}

          {/* Step 2: Pick a style */}
          {onboardStep === 2 && (<>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400, marginBottom: 8, color: "#3A2E28" }}>What's your style?</h2>
            <p style={{ fontSize: 14, color: "#9B8B7B", marginBottom: 24 }}>This guides your AI designer's recommendations.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "left", marginBottom: 24 }}>
              {VIBES.map((v) => (
                <button key={v} onClick={() => setVibe(v)} style={{ padding: "14px 14px", borderRadius: 12, border: vibe === v ? "2px solid #1A1815" : "1px solid #E8E0D8", background: vibe === v ? "#1A1815" : "#fff", fontSize: 13, fontWeight: vibe === v ? 600 : 400, color: vibe === v ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>{v}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setOnboardStep(1)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 20px", fontSize: 14, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
              <button onClick={finishOnboarding} disabled={!vibe} style={{ flex: 1, background: vibe ? "#C17550" : "#E8E0D8", color: vibe ? "#fff" : "#B8A898", padding: "14px 24px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: vibe ? "pointer" : "default", fontFamily: "inherit", transition: "all .2s" }}>
                {vibe ? "Start designing →" : "Select a style to continue"}
              </button>
            </div>
          </>)}

          <p style={{ fontSize: 12, color: "#B8A898", lineHeight: 1.6, marginTop: 24 }}>Your data stays private. We never share your designs or personal information.</p>
        </div>
      </div>
    );
  }

  if (pg === "confirm") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(160deg,#FDFCFA,#F0EBE4)" }}>
        <div style={{ background: "#fff", borderRadius: 20, padding: "48px 40px", maxWidth: 400, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.06)" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#C1755015", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>&#9993;</div>
          <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400, marginBottom: 12 }}>Check your email</h2>
          <p style={{ fontSize: 14, color: "#9B8B7B", lineHeight: 1.6, marginBottom: 24 }}>We sent a confirmation link to your email address. Click the link to activate your AURA account.</p>
          <p style={{ fontSize: 12, color: "#B8A898" }}>Didn't receive it? Check your spam folder or <span onClick={() => { go("auth"); setAuthMode("signup"); }} style={{ color: "#C17550", cursor: "pointer" }}>try again</span>.</p>
          <p style={{ textAlign: "center", marginTop: 20 }}><span onClick={() => { go("auth"); setAuthMode("signin"); }} style={{ fontSize: 13, color: "#C17550", cursor: "pointer", fontWeight: 600 }}>Already confirmed? Sign In</span></p>
        </div>
      </div>
    );
  }

  /* ─── PASSWORD RESET PAGE ─── */
  if (pg === "reset-password") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(160deg,#FDFCFA,#F0EBE4)" }}>
        <div style={{ background: "#fff", borderRadius: 20, padding: "48px 40px", maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}><AuraLogo size={32} /><h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, margin: 0 }}>AURA</h1></div>
          <p style={{ textAlign: "center", fontSize: 14, color: "#9B8B7B", marginBottom: 32 }}>Set your new password</p>
          <input value={ap} onChange={(e) => setAp(e.target.value)} type="password" placeholder="New password (8+ characters)" onKeyDown={async (e) => { if (e.key === "Enter") { if (!ap || ap.length < 8) { setAErr("Password must be at least 8 characters"); return; } setALd(true); setAErr(""); try { const err = await doAuth("reset", null, ap); if (err) setAErr(err); } catch (_e) { setAErr("Something went wrong."); } setALd(false); }}} style={{ width: "100%", padding: "14px 16px", border: "1px solid #E8E0D8", borderRadius: 12, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
          {aErr && <p style={{ color: "#C17550", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{aErr}</p>}
          <button onClick={async () => { if (!ap || ap.length < 8) { setAErr("Password must be at least 8 characters"); return; } setALd(true); setAErr(""); try { const err = await doAuth("reset", null, ap); if (err) setAErr(err); } catch (_e) { setAErr("Something went wrong."); } setALd(false); }} disabled={aLd} style={{ width: "100%", padding: "14px", background: "#C17550", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: aLd ? 0.5 : 1 }}>{aLd ? "..." : "Update Password"}</button>
        </div>
      </div>
    );
  }

  /* ─── AUTH PAGE ─── */
  if (pg === "auth") {
    const submit = async () => {
      if (authMode === "forgot") {
        if (!ae) { setAErr("Enter your email"); return; }
        setALd(true); setAErr("");
        try {
          const e = await doAuth("forgot", ae);
          if (e) setAErr(e);
        } catch (_e) { setAErr("Something went wrong. Please try again."); }
        setALd(false);
        return;
      }
      if (!ae || !ap) { setAErr("Fill in all fields"); return; }
      if (authMode === "signup" && !an) { setAErr("Name required"); return; }
      if (authMode === "signup" && ap.length < 8) { setAErr("Password must be at least 8 characters"); return; }
      if (authMode === "signup" && ap !== ap2) { setAErr("Passwords do not match"); return; }
      setALd(true); setAErr("");
      try {
        const e = await doAuth(authMode, ae, ap, an);
        if (e) setAErr(e);
      } catch (_e) { setAErr("Something went wrong. Please try again."); }
      setALd(false);
    };
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#fff" }}>
        <div style={{ maxWidth: 380, width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}><AuraLogo size={28} /><span style={{ fontSize: 21, fontWeight: 600 }}>AURA</span></div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.02em" }}>{authMode === "signup" ? "Create your account" : authMode === "forgot" ? "Reset password" : "Welcome back"}</h1>
            <p style={{ fontSize: 15, color: "#7A6B5B", margin: 0 }}>{authMode === "signup" ? "Start designing in minutes." : authMode === "forgot" ? "We'll send you a link." : "Sign in to continue."}</p>
          </div>
          {authMode !== "forgot" && (<>
            <button onClick={() => { supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } }); }} style={{ width: "100%", padding: "14px", background: "#fff", color: "#1A1815", border: "1px solid #E8E0D8", borderRadius: 12, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "background .2s", boxSizing: "border-box" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#F5F0EB")} onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0" }}>
              <div style={{ flex: 1, height: 1, background: "#E8E0D8" }} />
              <span style={{ fontSize: 13, color: "#9B8B7B", flexShrink: 0 }}>or continue with email</span>
              <div style={{ flex: 1, height: 1, background: "#E8E0D8" }} />
            </div>
          </>)}
          {authMode === "signup" && <><label style={{ fontSize: 13, fontWeight: 600, color: "#1A1815", display: "block", marginBottom: 6 }}>Full Name</label><input value={an} onChange={(e) => setAn(e.target.value)} placeholder="John Doe" style={{ width: "100%", padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 16, transition: "border-color .2s" }} onFocus={e => e.currentTarget.style.borderColor = "#C17550"} onBlur={e => e.currentTarget.style.borderColor = "#E8E0D8"} /></>}
          <label style={{ fontSize: 13, fontWeight: 600, color: "#1A1815", display: "block", marginBottom: 6 }}>Email</label>
          <input value={ae} onChange={(e) => setAe(e.target.value)} type="email" placeholder="you@example.com" style={{ width: "100%", padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 16, transition: "border-color .2s" }} onFocus={e => e.currentTarget.style.borderColor = "#C17550"} onBlur={e => e.currentTarget.style.borderColor = "#E8E0D8"} />
          {authMode !== "forgot" && <><label style={{ fontSize: 13, fontWeight: 600, color: "#1A1815", display: "block", marginBottom: 6 }}>Password</label><input value={ap} onChange={(e) => setAp(e.target.value)} type="password" placeholder="" onKeyDown={(e) => { if (e.key === "Enter" && authMode !== "signup") submit(); }} style={{ width: "100%", padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 16, transition: "border-color .2s" }} onFocus={e => e.currentTarget.style.borderColor = "#C17550"} onBlur={e => e.currentTarget.style.borderColor = "#E8E0D8"} /></>}
          {authMode === "signup" && <><label style={{ fontSize: 13, fontWeight: 600, color: "#1A1815", display: "block", marginBottom: 6 }}>Confirm Password</label><input value={ap2} onChange={(e) => setAp2(e.target.value)} type="password" placeholder="" onKeyDown={(e) => { if (e.key === "Enter") submit(); }} style={{ width: "100%", padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 20, transition: "border-color .2s" }} onFocus={e => e.currentTarget.style.borderColor = "#C17550"} onBlur={e => e.currentTarget.style.borderColor = "#E8E0D8"} /></>}
          {aErr && <p style={{ color: "#D45B5B", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{aErr}</p>}
          {resetEmailSent && authMode === "forgot" && <p style={{ color: "#5B8B6B", fontSize: 13, textAlign: "center", marginBottom: 12 }}>Reset link sent! Check your email.</p>}
          <button onClick={submit} disabled={aLd} style={{ width: "100%", padding: "14px", background: "#1A1815", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", opacity: aLd ? 0.5 : 1, transition: "opacity .2s" }} onMouseEnter={e => { if (!aLd) e.currentTarget.style.opacity = "0.85"; }} onMouseLeave={e => { if (!aLd) e.currentTarget.style.opacity = "1"; }}>{aLd ? "..." : authMode === "signup" ? "Create Account" : authMode === "forgot" ? "Send Reset Link" : "Sign In"}</button>
          {authMode === "signup" && <p style={{ textAlign: "center", fontSize: 12, color: "#9B8B7B", marginTop: 16, lineHeight: 1.5 }}>By creating an account, you agree to our <span style={{ color: "#C17550", cursor: "pointer" }}>Terms of Service</span> and <span style={{ color: "#C17550", cursor: "pointer" }}>Privacy Policy</span>.</p>}
          {authMode === "signin" && <p style={{ textAlign: "center", fontSize: 13, color: "#9B8B7B", marginTop: 16 }}><span onClick={() => { setAuthMode("forgot"); setAErr(""); setAp2(""); setResetEmailSent(false); }} style={{ cursor: "pointer", color: "#C17550" }}>Forgot password?</span></p>}
          <p style={{ textAlign: "center", fontSize: 14, color: "#7A6B5B", marginTop: 24 }}>{authMode === "signup" ? "Already have an account? " : authMode === "forgot" ? "Remember it? " : "Don't have an account? "}<span onClick={() => { setAuthMode(authMode === "signup" ? "signin" : authMode === "forgot" ? "signin" : "signup"); setAErr(""); setAp2(""); setResetEmailSent(false); }} style={{ color: "#C17550", cursor: "pointer", fontWeight: 500 }}>{authMode === "signup" ? "Sign In" : authMode === "forgot" ? "Sign In" : "Sign Up"}</span></p>
        </div>
      </div>
    );
  }

  /* ─── PRICING PAGE ─── */
  const handleCheckout = async () => {
    trackEvent("checkout_click", { plan: "pro", billing: billingCycle, loggedIn: user ? "yes" : "no" });
    if (!user) { go("auth"); return; }
    if (userPlan === "pro") return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { go("auth"); return; }
      const resp = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
        body: JSON.stringify({ plan: billingCycle })
      });
      const result = await resp.json();
      if (result.url) window.location.href = result.url;
      else setAErr(result.error || "Failed to start checkout");
    } catch (err) { console.error("Checkout error:", err); }
  };

  if (pg === "pricing") {
    return (
      <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif", background: "#fff", minHeight: "100vh", color: "#1A1815" }}>
        <style>{`
          @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
          .aura-pricing-grid{grid-template-columns:1fr 1fr}
          @media(max-width:768px){
            .aura-pricing-grid{grid-template-columns:1fr!important}
            .aura-pricing-h{font-size:32px!important}
            .aura-nav-pricing{display:none!important}
            .aura-nav-wordmark{font-size:18px!important;letter-spacing:.1em!important}
            .aura-nav-links>button,.aura-nav-links>span{font-size:10px!important;padding:4px 8px!important}
            .aura-nav-cart{display:none!important}
            nav{padding:8px 4%!important}
          }
        `}</style>
        <Header pg={pg} sc={sc} sel={sel} selCount={selCount} selTotal={selTotal} user={user} go={go} setTab={setTab} fmt={fmt} adminAuthed={adminAuthed} />
        <div style={{ padding: "120px 5% 60px" }}>
          <div style={{ textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
            <h1 className="aura-pricing-h" style={{ fontSize: 48, fontWeight: 700, marginBottom: 12, letterSpacing: "-0.025em" }}>Simple pricing. Powerful tools.</h1>
            <p style={{ fontSize: 19, color: "#7A6B5B", marginBottom: 32, fontWeight: 400 }}>AI-powered interior design. Start free, upgrade when you're ready.</p>
            <PricingSection
              billingCycle={billingCycle}
              setBillingCycle={setBillingCycle}
              userPlan={userPlan}
              user={user}
              onCheckout={handleCheckout}
              onGetStarted={() => { go("design"); setTab("studio"); }}
              trackEvent={trackEvent}
            />
          </div>
        </div>
        <Footer go={go} setTab={setTab} adminAuthed={adminAuthed} />
      </div>
    );
  }

  if (pg === "success") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#1A1815", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 28, color: "#fff" }}>&#10003;</div>
          <h1 style={{ fontSize: 40, fontWeight: 700, marginBottom: 12, letterSpacing: "-0.025em" }}>Welcome to Pro.</h1>
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
          <span style={{ display: "inline-block", background: userPlan === "pro" ? "#C17550" : "#F0EBE4", color: userPlan === "pro" ? "#fff" : "#9B8B7B", padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>{userPlan === "pro" ? "Pro" : "Free"}</span>
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
          {/* Subscription Section */}
          <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400, marginTop: 40, marginBottom: 20, paddingTop: 20, borderTop: "1px solid #F0EBE4" }}>Subscription</h2>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", border: "1px solid #F0EBE4", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 16, fontWeight: 600, color: "#1A1815" }}>{userPlan === "pro" ? "Pro Plan" : "Free Plan"}</p>
                <p style={{ fontSize: 13, color: "#9B8B7B", marginTop: 4 }}>{userPlan === "pro" ? (profile?.billing_cycle === "yearly" ? "$120/year ($10/mo)" : "$20/month") : "$0/month"}</p>
                {userPlan === "pro" && profile?.plan_expires_at && <p style={{ fontSize: 12, color: "#9B8B7B", marginTop: 4 }}>Renews {new Date(profile.plan_expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>}
              </div>
              <span style={{ background: userPlan === "pro" ? "#C17550" : "#F0EBE4", color: userPlan === "pro" ? "#fff" : "#9B8B7B", padding: "5px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>{userPlan === "pro" ? "Active" : "Free"}</span>
            </div>
            <p style={{ fontSize: 13, color: "#7A6B5B" }}>{userPlan === "pro" ? "Visualizations: " + vizCount + " used this month · Unlimited access" : "Visualizations: " + vizCount + "/" + vizLimit + " used this month · " + vizRemaining + " remaining"}</p>
            <div style={{ marginTop: 16 }}>
              {userPlan === "pro" ? (
                <button onClick={async () => {
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    const resp = await fetch("/api/create-portal", {
                      method: "POST",
                      headers: { "Authorization": "Bearer " + session.access_token }
                    });
                    const result = await resp.json();
                    if (result.url) window.location.href = result.url;
                  } catch (err) { console.error("Portal error:", err); }
                }} style={{ background: "none", border: "1px solid #C17550", color: "#C17550", borderRadius: 12, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Manage Subscription</button>
              ) : (
                <button onClick={() => go("pricing")} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Upgrade to Pro</button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
            <button onClick={newProject} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>New Project</button>
            <button onClick={async () => { try { await supabase.auth.signOut(); } catch (err) { console.error("Sign out error:", err); } setUser(null); setProfile(null); setProjects([]); go("home"); }} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 12, padding: "14px 28px", fontSize: 13, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

  const currentPalette = (STYLE_PALETTES as Record<string, StylePalette>)[vibe as string];

  /* ─── MAIN LAYOUT ─── */
  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif", background: "#fff", minHeight: "100vh", color: "#1A1815" }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes fadeInText{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes drawLine{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
        @keyframes growLine{from{transform:scaleY(0)}to{transform:scaleY(1)}}
        @keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(193,117,80,.15)}50%{box-shadow:0 0 40px rgba(193,117,80,.35)}}
        @keyframes slideInLeft{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:translateX(0)}}
        @keyframes slideInRight{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:translateX(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes bentoScrollLeft{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes bentoScrollRight{0%{transform:translateX(-50%)}100%{transform:translateX(0)}}
        @keyframes sliderPulse{0%{transform:translate(-50%,-50%) scale(1)}30%{transform:translate(-50%,-50%) scale(1.18)}60%{transform:translate(-50%,-50%) scale(0.9)}100%{transform:translate(-50%,-50%) scale(1)}}
        @keyframes tickerScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        @keyframes float3d1{0%{transform:translateY(0px) rotateY(0deg) rotateX(5deg)}50%{transform:translateY(-20px) rotateY(8deg) rotateX(-3deg)}100%{transform:translateY(0px) rotateY(0deg) rotateX(5deg)}}
        @keyframes float3d2{0%{transform:translateY(-10px) rotateY(-5deg) rotateX(0deg)}50%{transform:translateY(15px) rotateY(5deg) rotateX(6deg)}100%{transform:translateY(-10px) rotateY(-5deg) rotateX(0deg)}}
        @keyframes float3d3{0%{transform:translateY(5px) rotateY(3deg) rotateX(-4deg)}50%{transform:translateY(-18px) rotateY(-6deg) rotateX(4deg)}100%{transform:translateY(5px) rotateY(3deg) rotateX(-4deg)}}
        @keyframes float3d4{0%{transform:translateY(-15px) rotateY(-8deg) rotateX(3deg)}50%{transform:translateY(10px) rotateY(4deg) rotateX(-5deg)}100%{transform:translateY(-15px) rotateY(-8deg) rotateX(3deg)}}
        @keyframes floatShadow{0%,100%{opacity:.15;transform:scale(1)}50%{opacity:.08;transform:scale(.85)}}
        .aura-float-product{position:absolute;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);background:#fff;perspective:800px;transform-style:preserve-3d;pointer-events:none;z-index:2;opacity:0;animation-fill-mode:forwards}
        .aura-float-product img{width:100%;height:100%;object-fit:cover;display:block}
        .aura-float-enter{animation:floatEnter .8s ease forwards}
        @keyframes floatEnter{from{opacity:0;transform:scale(.6) translateY(40px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @media(max-width:768px){.aura-float-product{display:none!important}}
        .aura-ticker-track{animation:tickerScroll 30s linear infinite;will-change:transform}
        .aura-ticker-track:hover{animation-play-state:paused}
        .aura-bento-scroll-left{animation:bentoScrollLeft 40s linear infinite;will-change:transform;backface-visibility:hidden}
        .aura-bento-scroll-right{animation:bentoScrollRight 40s linear infinite;will-change:transform;backface-visibility:hidden}
        .aura-bento-scroll-left,.aura-bento-scroll-right{pointer-events:none}
        *{-webkit-tap-highlight-color:transparent}
        input,button,select,textarea{font-size:16px!important}
        /* ─── TABLET: 768px–1024px ─── */
        @media(max-width:1024px){
          .aura-hero{padding-top:90px!important}
          .aura-grid-2col{gap:24px!important}
          .aura-brands-grid{grid-template-columns:repeat(2,1fr)!important}
          .aura-setup-grid{grid-template-columns:1fr!important}
          .aura-budget-dims{grid-template-columns:1fr!important}
          .aura-upload-row{grid-template-columns:1fr!important}
          .aura-nav-links>button,.aura-nav-links>span{font-size:11px!important;padding:6px 10px!important}
          .aura-catalog-header{flex-direction:column!important;align-items:flex-start!important}
          .aura-catalog-search{width:100%!important}
          .aura-ext-search{flex-direction:column!important}
          .aura-ext-search input{width:100%!important}
          .aura-step-nav .aura-step-label{display:none!important}
          .aura-fp-sidebar{width:200px!important}
          .aura-fp-toolbar{overflow-x:auto!important;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch}
          .aura-fp-preview{height:320px!important}
        }
        /* ─── MOBILE: ≤768px ─── */
        @media(max-width:768px){
          .aura-timeline-left,.aura-timeline-right{flex:none!important;width:100%!important;padding:0 8px!important;justify-content:center!important}
          .aura-timeline-left>div,.aura-timeline-right>div{max-width:100%!important}
          .aura-timeline-line{display:none!important}
          .aura-grid-2col{grid-template-columns:1fr!important;gap:16px!important}
          .aura-grid-2col.aura-grid-reverse{display:flex!important;flex-direction:column-reverse!important;gap:16px!important}
          .aura-pricing-grid{grid-template-columns:1fr!important}
          .aura-nav-links{gap:4px!important;flex-wrap:nowrap!important}
          .aura-nav-links>button,.aura-nav-links>span{font-size:10px!important;padding:4px 8px!important}
          .aura-nav-cart{display:none!important}
          nav{padding:8px 4%!important}
          .aura-filter-wrap{flex-direction:column!important}
          .aura-hero{padding-top:64px!important;min-height:auto!important;padding-bottom:24px!important}
          .aura-hero .aura-grid-2col{padding:0 5%!important}
          .aura-hero h1{font-size:28px!important;line-height:1.12!important;margin-bottom:12px!important}
          .aura-hero p{font-size:13px!important;margin-bottom:18px!important}
          .aura-hero-sub{font-size:9px!important;margin-bottom:8px!important}
          .aura-hero-btns{flex-direction:row!important;gap:8px!important}
          .aura-hero-btns button{padding:12px 20px!important;font-size:13px!important;flex:1!important}
          .aura-home-section{padding-top:48px!important;padding-bottom:48px!important;min-height:auto!important}
          .aura-home-section h2{font-size:28px!important}
          .aura-studio-filters{padding:16px 4%!important}
          .aura-card-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))!important;gap:8px!important}
          .aura-chat-box{padding:0!important}
          .aura-chat-input{flex-direction:column!important}
          .aura-chat-input input{width:100%!important}
          .aura-chat-input button{width:100%!important}
          .aura-viz-grid{grid-template-columns:1fr!important}
          .aura-mood-tabs{flex-wrap:wrap!important}
          .aura-upload-row{grid-template-columns:1fr!important;gap:12px!important}
          .aura-sel-header{flex-direction:column!important;align-items:flex-start!important;gap:12px!important}
          .aura-sel-actions{width:100%!important}
          .aura-sel-actions button{flex:1!important}
          .aura-purchase-row{grid-template-columns:36px 1fr 70px 60px!important}
          .aura-purchase-header{display:none!important}
          .aura-purchase-footer{grid-template-columns:36px 1fr 70px 60px!important}
          .aura-purchase-retailer,.aura-purchase-unit,.aura-purchase-qty{display:none!important}
          .aura-admin-grid{grid-template-columns:1fr!important}
          .aura-setup-grid{grid-template-columns:1fr!important}
          .aura-budget-dims{grid-template-columns:1fr!important}
          .aura-brands-grid{grid-template-columns:repeat(2,1fr)!important;gap:10px!important}
          .aura-catalog-header{flex-direction:column!important;align-items:flex-start!important}
          .aura-catalog-search{width:100%!important}
          .aura-ext-search{flex-direction:column!important}
          .aura-ext-search input{width:100%!important}
          .aura-ext-search button{width:100%!important}
          .aura-style-grid{grid-template-columns:1fr 1fr!important}
          .aura-section-pad{padding-left:4%!important;padding-right:4%!important}
          .aura-section-gap60{gap:24px!important}
          .aura-step-nav{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
          .aura-step-nav .aura-step-label{display:none!important}
          .aura-step-connector{min-width:12px!important;margin:0 6px!important}
          .aura-design-tabs{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
          .aura-design-tabs button{white-space:nowrap!important;flex-shrink:0!important}
          .aura-project-actions{display:none!important}
          .aura-chat-msgs{max-height:50vh!important}
          .aura-pricing-h{font-size:32px!important}
          .aura-fp-sidebar{display:none!important}
          .aura-fp-toolbar{overflow-x:auto!important;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch;padding:6px 8px!important}
          .aura-fp-preview{height:260px!important}
          .aura-fp-statusbar{display:none!important}
          .aura-brands-section{background:#F5F0EB!important}
          .aura-cta-section{background:#1A1815!important}
          /* Nav — hide pricing link to prevent crowding; shrink wordmark */
          .aura-nav-pricing{display:none!important}
          .aura-nav-wordmark{font-size:18px!important;letter-spacing:.1em!important}
          /* Hero — safe-area bottom padding for iPhone notch */
          .aura-hero-bottom{padding-bottom:max(52px,calc(36px + env(safe-area-inset-bottom)))!important;padding-left:5%!important;padding-right:5%!important}
          /* Hero buttons — full width stack on small screens */
          .aura-hero-btns{flex-direction:column!important;align-items:stretch!important;gap:10px!important;max-width:280px;margin:0 auto}
          .aura-hero-btns button{text-align:center!important;padding:14px 20px!important;font-size:14px!important}
          /* Wizard substep labels */
          .aura-substep-label{font-size:10px!important;max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          /* Sticky bars — safe area on iPhone */
          .aura-review-bar{padding:12px 4% max(12px,calc(10px + env(safe-area-inset-bottom))) 4%!important}
          /* Viz banner — less padding */
          .aura-viz-banner{padding:18px 16px!important;gap:12px!important;flex-direction:column!important;align-items:stretch!important}
          .aura-viz-banner h2{font-size:18px!important}
          .aura-viz-btns{justify-content:stretch!important}
          .aura-viz-btns button{flex:1!important;text-align:center!important}
          /* Chat input — safe area */
          .aura-chat-input{padding-bottom:max(14px,calc(10px + env(safe-area-inset-bottom)))!important}
          /* Purchase table — horizontal scroll */
          .aura-purchase-table{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
          /* Final CTA buttons */
          .aura-final-cta-btns{flex-direction:column!important;align-items:stretch!important}
          .aura-final-cta-btns button{text-align:center!important}
          .aura-usecase-grid{grid-template-columns:1fr!important}
          .aura-howit-grid{grid-template-columns:1fr!important}
          .aura-demo-form{grid-template-columns:1fr!important}
          .aura-slider-grid{grid-template-columns:1fr!important;gap:32px!important}
          .aura-why-grid{grid-template-columns:1fr!important}
          .aura-compare-table{font-size:12px!important}
          .aura-compare-table th,.aura-compare-table td{padding:10px 8px!important}
          .aura-testimonials-grid{grid-template-columns:1fr!important}
          /* Home sections horizontal padding */
          .aura-home-section{padding-left:5%!important;padding-right:5%!important}
          /* Setup wizard container */
          .aura-setup-container{padding-left:5%!important;padding-right:5%!important}
        }
        @media(max-width:400px){
          .aura-substep-label{display:none!important}
          .aura-nav-wordmark{font-size:16px!important}
        }
      `}</style>

      {/* NAV */}
      <Header pg={pg} sc={sc} sel={sel} selCount={selCount} selTotal={selTotal} user={user} go={go} setTab={setTab} fmt={fmt} adminAuthed={adminAuthed} />

      {/* HOME — SCROLL ANIMATED LANDING */}
      {pg === "home" && (() => {
        const previewProducts = DB.filter(p => p.img && p.img.includes("shopify")).filter((_, i) => i % 47 === 0).slice(0, 8);
        return (
        <div>
          {/* Hero — Tesla-style full-screen immersive */}
          <section className="aura-hero" style={{ height: "100vh", minHeight: 600, position: "relative", overflow: "hidden" }}>
            {/* Full-screen background image */}
            <img src={homeHeroImg} alt="Modern living room interior design" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%" }} />
            {/* Gradient overlay — subtle dark at top for nav, strong at bottom for text */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,.55) 0%, rgba(0,0,0,.15) 35%, rgba(0,0,0,.10) 55%, rgba(0,0,0,.82) 100%)" }} />
            {/* Text positioned at bottom like Tesla */}
            <div className="aura-hero-bottom" style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", padding: "0 6% 64px", animation: "fadeUp .8s ease" }}>
              <p style={{ fontSize: "clamp(10px,1.2vw,13px)", letterSpacing: ".2em", textTransform: "uppercase", color: "rgba(255,255,255,.78)", marginBottom: 10, fontWeight: 500 }}>AI Interior Design · No experience required</p>
              <h1 style={{ fontSize: "clamp(36px,6vw,72px)", fontWeight: 700, lineHeight: 1.05, marginBottom: 12, letterSpacing: "-0.025em", color: "#fff" }}>Design <span key={heroRoomIdx} style={{ display: "inline-block", animation: "fadeInText .5s ease" }}>{heroRooms[heroRoomIdx]}</span></h1>
              <p style={{ fontSize: "clamp(14px,1.5vw,18px)", color: "rgba(255,255,255,.88)", lineHeight: 1.5, maxWidth: 480, margin: "0 auto 28px", fontWeight: 400 }}>Describe your space. Get curated furniture picks and a photorealistic visualization in minutes.</p>
              <div className="aura-hero-btns" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={() => { go("design"); setTab("studio"); trackEvent("cta_click", { button: "hero_start_designing" }); }} style={{ background: "rgba(255,255,255,.95)", color: "#1A1815", padding: "15px 40px", border: "none", borderRadius: 4, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "background .2s", letterSpacing: ".02em", textTransform: "uppercase" }} onMouseEnter={e => e.currentTarget.style.background = "#fff"} onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,.95)"}>Start Designing</button>
                <button onClick={() => go("pricing")} style={{ background: "rgba(255,255,255,.12)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", color: "#fff", padding: "15px 36px", border: "1px solid rgba(255,255,255,.3)", borderRadius: 4, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "background .2s", letterSpacing: ".02em", textTransform: "uppercase" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.22)"} onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,.12)"}>See Pricing</button>
              </div>
            </div>
          </section>

          {/* ─── Retailer Trust Ticker ─── */}
          <section style={{ padding: "20px 0", background: "#fff", borderBottom: "1px solid #F0EBE4", overflow: "hidden" }}>
            <div style={{ overflow: "hidden", maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)" }}>
              <div className="aura-ticker-track" style={{ display: "flex", gap: 48, alignItems: "center", width: "max-content", whiteSpace: "nowrap" }}>
                {[...["Lulu & Georgia", "McGee & Co", "West Elm", "Crate & Barrel", "Article", "Restoration Hardware", "Serena & Lily", "AllModern", "Rejuvenation", "Shoppe Amber Interiors"], ...["Lulu & Georgia", "McGee & Co", "West Elm", "Crate & Barrel", "Article", "Restoration Hardware", "Serena & Lily", "AllModern", "Rejuvenation", "Shoppe Amber Interiors"]].map((name, i) => (
                  <span key={i} style={{ fontSize: 14, fontWeight: 600, color: "#b0b0b0", letterSpacing: ".04em", flexShrink: 0 }}>{name}</span>
                ))}
              </div>
            </div>
          </section>

          {/* ─── How It Works — 3 Steps ─── */}
          <section className="aura-home-section" style={{ padding: "64px 6%", background: "#fff", borderTop: "1px solid #E8E0D8" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div className="aura-howit-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
                {[
                  { num: "01", title: "Describe your space", desc: "Pick a room type, choose your style, enter dimensions. Upload a photo if you have one." },
                  { num: "02", title: "AI curates your design", desc: "Our AI searches 100,000+ real products and builds mood boards that match your style and budget." },
                  { num: "03", title: "Visualize & shop", desc: "See a photorealistic render of your room with the products you picked. Buy everything with one click." },
                ].map((step, i) => (
                  <div key={step.num} style={{ padding: "32px 36px", borderLeft: i > 0 ? "1px solid #E8E0D8" : "none", position: "relative" }}>
                    <div style={{ fontSize: 64, fontWeight: 800, color: "#F0EBE4", letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 16 }}>{step.num}</div>
                    <h3 style={{ fontSize: 22, fontWeight: 700, color: "#1A1815", marginBottom: 10, letterSpacing: "-0.01em" }}>{step.title}</h3>
                    <p style={{ fontSize: 15, color: "#7A6B5B", lineHeight: 1.7 }}>{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Section 2: Define Your Room — text left, product UI demo right */}
          <section className="aura-home-section" style={{ padding: "120px 6%", background: "#F8F5F0" }}>
            <div>
              <div className="aura-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
                <div>
                  <p style={{ fontSize: 13, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", marginBottom: 12, fontWeight: 600 }}>Step 1</p>
                  <h2 style={{ fontSize: "clamp(32px,4vw,52px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: 20 }}>Tell us about<br />your room.</h2>
                  <p style={{ fontSize: 18, color: "#5A5045", lineHeight: 1.6, marginBottom: 32 }}>Select your room type, enter the dimensions, and optionally upload a photo. Our AI uses this to understand your space and recommend furniture that actually fits.</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {[["8 room types", "Living room, bedroom, dining, kitchen, office, and more"], ["Custom dimensions", "Enter exact width and length for precise furniture sizing"], ["Photo upload", "Upload your actual room photo for AI-powered analysis"]].map(([title, desc]) => (
                      <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1A1815", marginTop: 8, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 15, fontWeight: 600, color: "#1A1815", margin: "0 0 2px" }}>{title}</p>
                          <p style={{ fontSize: 14, color: "#9B8B7B", margin: 0, lineHeight: 1.4 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Live product UI mockup */}
                <div style={{ background: "#FDFCFA", borderRadius: 24, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.08)", overflow: "hidden" }}>
                  <div style={{ padding: "16px 24px", borderBottom: "1px solid #E8E0D8", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F57" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FEBC2E" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28C840" }} />
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "#9B8B7B", fontWeight: 500 }}>AURA Studio</span>
                  </div>
                  <div style={{ padding: 28 }}>
                    <p style={{ fontSize: 11, letterSpacing: ".15em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700, marginBottom: 20 }}>What room are you designing?</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
                      {["Living Room", "Bedroom", "Dining Room", "Office"].map((r, i) => (
                        <div key={r} style={{ padding: "16px 14px", borderRadius: 12, border: i === 0 ? "2px solid #1A1815" : "1px solid #E8E0D8", background: i === 0 ? "#1A1815" : "#fff", color: i === 0 ? "#fff" : "#1A1815", fontSize: 14, fontWeight: i === 0 ? 600 : 400, textAlign: "center" }}>{r}</div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                      <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #E8E0D8", background: "#fff" }}>
                        <span style={{ fontSize: 11, color: "#9B8B7B", fontWeight: 500 }}>Width</span>
                        <p style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0", color: "#1A1815" }}>18 ft</p>
                      </div>
                      <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #E8E0D8", background: "#fff" }}>
                        <span style={{ fontSize: 11, color: "#9B8B7B", fontWeight: 500 }}>Length</span>
                        <p style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0", color: "#1A1815" }}>22 ft</p>
                      </div>
                    </div>
                    <div style={{ padding: "20px 16px", borderRadius: 14, border: "2px dashed #E8E0D8", textAlign: "center", background: "#fff" }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ margin: "0 auto 8px", display: "block", opacity: 0.3 }}><path d="M12 16V8M12 8l-3 3M12 8l3 3M3 16v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke="#1A1815" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <p style={{ fontSize: 13, color: "#9B8B7B", margin: 0 }}>Upload a room photo</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Style — text right, palette UI demo left */}
          <section className="aura-home-section" style={{ padding: "120px 6%", background: "#fff" }}>
            <div>
              <div className="aura-grid-2col aura-grid-reverse" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
                {/* Style selector UI mockup */}
                <div style={{ background: "#fff", borderRadius: 24, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.08)", overflow: "hidden" }}>
                  <div style={{ padding: "16px 24px", borderBottom: "1px solid #E8E0D8", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F57" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FEBC2E" }} />
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28C840" }} />
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "#9B8B7B", fontWeight: 500 }}>Style Selection</span>
                  </div>
                  <div style={{ padding: 28 }}>
                    <p style={{ fontSize: 11, letterSpacing: ".15em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 700, marginBottom: 20 }}>What's your style?</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {[
                        { name: "Warm Modern", colors: ["#D4B896", "#8B6040", "#E8DDD0", "#5A4535", "#C4A882"], feel: "Earthy, inviting, textured" },
                        { name: "Japandi", colors: ["#D4CEC4", "#6B6560", "#E8E4DC", "#2A2825", "#B8B0A4"], feel: "Minimal, natural, balanced" },
                        { name: "Scandinavian", colors: ["#E8E4E0", "#A09890", "#F5F0EB", "#5A5550", "#D4CEC4"], feel: "Light, airy, functional" },
                        { name: "Mid-Century", colors: ["#C8702A", "#2B5B4E", "#E8D4B4", "#3A3A3A", "#D4956A"], feel: "Retro, organic, bold" },
                      ].map((s, i) => (
                        <div key={s.name} style={{ padding: 16, borderRadius: 14, border: i === 0 ? "2px solid #1A1815" : "1px solid #E8E0D8", background: i === 0 ? "#FDFCFA" : "#fff", cursor: "pointer" }}>
                          <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                            {s.colors.map((c, ci) => <div key={ci} style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: "1px solid rgba(0,0,0,.06)" }} />)}
                          </div>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#1A1815", margin: "0 0 2px" }}>{s.name}</p>
                          <p style={{ fontSize: 11, color: "#9B8B7B", margin: 0 }}>{s.feel}</p>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, padding: "14px 18px", background: "#F8F5F0", borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1A1815", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1815", margin: 0 }}>Warm Modern selected</p>
                        <p style={{ fontSize: 11, color: "#9B8B7B", margin: 0 }}>Products will be scored for style harmony</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: 13, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", marginBottom: 12, fontWeight: 600 }}>Step 2</p>
                  <h2 style={{ fontSize: "clamp(32px,4vw,52px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: 20 }}>Pick a style.<br />We match the rest.</h2>
                  <p style={{ fontSize: 18, color: "#5A5045", lineHeight: 1.6, marginBottom: 32 }}>Choose from 14 curated design palettes — from Warm Modern to Japandi to Art Deco. Our AI scores every product for style harmony, so everything in your room looks like it belongs together.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["Warm Modern", "Japandi", "Scandinavian", "Bohemian", "Art Deco", "Coastal", "Mid-Century", "+7 more"].map(s => (
                      <span key={s} style={{ fontSize: 13, padding: "8px 16px", borderRadius: 980, background: "#fff", color: "#1A1815", fontWeight: 500, border: "1px solid #E8E0D8" }}>{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: AI Chat — text left, chat UI demo right */}
          <section className="aura-home-section" style={{ padding: "120px 6%", background: "#F8F5F0" }}>
            <div>
              <div className="aura-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
                <div>
                  <p style={{ fontSize: 13, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", marginBottom: 12, fontWeight: 600 }}>Step 3</p>
                  <h2 style={{ fontSize: "clamp(32px,4vw,52px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: 20 }}>Just describe<br />what you want.</h2>
                  <p style={{ fontSize: 18, color: "#5A5045", lineHeight: 1.6, marginBottom: 32 }}>Chat with your AI interior designer in plain English. Describe a vibe, ask for suggestions, or let it build a complete mood board. It searches {DB.length}+ real products and finds pieces that work together.</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {[["AI mood boards", "Auto-generated collections of matching furniture"], ["Real product links", "Every recommendation links to the actual product page"], ["Smart scoring", "Each item is rated for style, size, and budget fit"]].map(([title, desc]) => (
                      <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1A1815", marginTop: 8, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 15, fontWeight: 600, color: "#1A1815", margin: "0 0 2px" }}>{title}</p>
                          <p style={{ fontSize: 14, color: "#9B8B7B", margin: 0, lineHeight: 1.4 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Chat UI mockup */}
                <div style={{ background: "#FDFCFA", borderRadius: 24, border: "1px solid #E8E0D8", boxShadow: "0 20px 60px rgba(0,0,0,.08)", overflow: "hidden" }}>
                  <div style={{ padding: "14px 24px", borderBottom: "1px solid #E8E0D8", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#5B8B6B" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1815" }}>AI Designer</span>
                    <span style={{ fontSize: 11, color: "#9B8B7B", marginLeft: "auto" }}>Online</span>
                  </div>
                  <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ padding: "12px 16px", borderRadius: "18px 18px 4px 18px", background: "#1A1815", color: "#fff", fontSize: 14, lineHeight: 1.5, maxWidth: "80%", marginLeft: "auto" }}>I need a warm living room with earthy tones and a large sectional</div>
                    <div style={{ padding: "14px 18px", borderRadius: "18px 18px 18px 4px", background: "#fff", fontSize: 14, lineHeight: 1.6, color: "#1A1815", border: "1px solid #E8E0D8" }}>
                      <span style={{ fontWeight: 700 }}>Great choice!</span> I found 23 pieces that match your Warm Modern style. Here are my top picks — the Haven Sectional anchors the room beautifully.
                    </div>
                    {/* Product cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                      {previewProducts.slice(0, 2).map(p => (
                        <div key={p.id} style={{ borderRadius: 14, border: "1px solid #E8E0D8", overflow: "hidden", background: "#fff" }}>
                          <div style={{ height: 100, overflow: "hidden" }}>
                            <img src={p.img} alt={p.n} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          </div>
                          <div style={{ padding: "10px 12px" }}>
                            <p style={{ fontSize: 12, fontWeight: 600, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</p>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                              <span style={{ fontSize: 11, color: "#9B8B7B" }}>{p.r}</span>
                              <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt(p.p)}</span>
                            </div>
                            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                              <div style={{ height: 4, flex: 1, borderRadius: 2, background: "#E8E0D8" }}><div style={{ height: "100%", width: "92%", borderRadius: 2, background: "#5B8B6B" }} /></div>
                              <span style={{ fontSize: 10, color: "#5B8B6B", fontWeight: 700 }}>92%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", border: "1px solid #E8E0D8", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
                      <div style={{ flex: 1, padding: "12px 16px", fontSize: 13, color: "#9B8B7B" }}>Tell me what you're looking for...</div>
                      <div style={{ background: "#1A1815", color: "#fff", padding: "12px 20px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center" }}>Send</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 5: Product Catalog — scrolling marquee */}
          <section className="aura-home-section" style={{ padding: "64px 0", background: "#fff", overflow: "hidden" }}>
            <div>
              <div style={{ textAlign: "center", padding: "0 6%", marginBottom: 32, maxWidth: 800, margin: "0 auto 32px" }}>
                <h2 style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", marginBottom: 10 }}>{DB.length}+ products. All real. All shoppable.</h2>
                <p style={{ fontSize: 16, color: "#5A5045", lineHeight: 1.5 }}>Hand-picked from Lulu & Georgia, McGee & Co, West Elm, and more.</p>
              </div>
              {(() => {
                const bentoProducts = DB.filter(p => p.img && p.img.includes("shopify")).filter((_, i) => i % 23 === 0).slice(0, 16);
                const row1 = bentoProducts.slice(0, 8);
                const row2 = bentoProducts.slice(8, 16);
                const MarqueeCard = ({ p }: { p: typeof DB[0] }) => (
                  <div style={{ flex: "0 0 auto", width: 160, background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,.05)" }}>
                    <div style={{ height: 120, overflow: "hidden" }}>
                      <img src={p.img} alt={p.n} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <p style={{ fontSize: 12, fontWeight: 600, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1A1815" }}>{p.n}</p>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#9B8B7B" }}>{p.r}</span>
                        <span style={{ fontWeight: 700, fontSize: 12, color: "#1A1815" }}>{fmt(p.p)}</span>
                      </div>
                    </div>
                  </div>
                );
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ overflow: "hidden", width: "100%", maskImage: "linear-gradient(90deg, transparent, black 5%, black 95%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 5%, black 95%, transparent)" }}>
                      <div className="aura-bento-scroll-left" style={{ display: "flex", gap: 12, width: "max-content" }}>
                        {[...row1, ...row1].map((p, i) => <MarqueeCard key={`r1-${i}`} p={p} />)}
                      </div>
                    </div>
                    <div style={{ overflow: "hidden", width: "100%", maskImage: "linear-gradient(90deg, transparent, black 5%, black 95%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 5%, black 95%, transparent)" }}>
                      <div className="aura-bento-scroll-right" style={{ display: "flex", gap: 12, width: "max-content" }}>
                        {[...row2, ...row2].map((p, i) => <MarqueeCard key={`r2-${i}`} p={p} />)}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div style={{ textAlign: "center", marginTop: 28, padding: "0 6%" }}>
                <button onClick={() => { go("design"); setTab("catalog"); }} style={{ background: "#1A1815", color: "#fff", padding: "14px 32px", border: "none", borderRadius: 980, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s" }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>Browse full catalog</button>
              </div>
            </div>
          </section>

          {/* Section 6: Visualization — text right, large viz image left */}
          <section className="aura-home-section" style={{ padding: "120px 6%", background: "#F8F5F0" }}>
            <div>
              <div className="aura-grid-2col aura-grid-reverse" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 80, alignItems: "center", maxWidth: 1200, margin: "0 auto" }}>
                {/* Large visualization image */}
                <div style={{ borderRadius: 24, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.1)", position: "relative" }}>
                  <img src={homeVizImg} alt="AI room visualization" style={{ width: "100%", display: "block" }} />
                  <div style={{ position: "absolute", top: 16, left: 16, display: "flex", gap: 6 }}>
                    <span style={{ fontSize: 11, background: "rgba(0,0,0,.6)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", padding: "6px 14px", borderRadius: 980, color: "#fff", fontWeight: 600 }}>AI Generated</span>
                  </div>
                  <div style={{ position: "absolute", bottom: 16, left: 16, right: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["Warm Modern", "Living Room", "18' x 22'"].map(t => (
                      <span key={t} style={{ fontSize: 11, background: "rgba(255,255,255,.9)", backdropFilter: "blur(8px)", padding: "6px 14px", borderRadius: 980, color: "#1A1815", fontWeight: 600 }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: 13, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", marginBottom: 12, fontWeight: 600 }}>Step 4</p>
                  <h2 style={{ fontSize: "clamp(32px,4vw,52px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: 20 }}>See it before<br />you buy it.</h2>
                  <p style={{ fontSize: 18, color: "#5A5045", lineHeight: 1.6, marginBottom: 32 }}>AI renders a photorealistic visualization of your room with the exact products you selected. See how everything looks together before you spend a dollar.</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
                    {[["AI room renders", "Photorealistic scenes with your chosen furniture"], ["CAD floor plans", "Precise layouts with dimensions and clearance zones"], ["Traffic flow analysis", "Ensures walkways are clear and furniture is accessible"]].map(([title, desc]) => (
                      <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1A1815", marginTop: 8, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 15, fontWeight: 600, color: "#1A1815", margin: "0 0 2px" }}>{title}</p>
                          <p style={{ fontSize: 14, color: "#9B8B7B", margin: 0, lineHeight: 1.4 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#1A1815", color: "#fff", padding: "14px 32px", border: "none", borderRadius: 980, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s" }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>Try it now</button>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Use Case Tabs: Interiors / Exteriors / Gardens ─── */}
          <section className="aura-home-section" style={{ padding: "100px 6%", background: "#fff" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 56 }}>
                <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 600, marginBottom: 10 }}>What can you design?</p>
                <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }}>Every space. Inside and out.</h2>
              </div>
              <div className="aura-usecase-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
                {[
                  { iconPath: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6", title: "Interiors", desc: "AI-personalized furniture picks, mood boards, and photorealistic renders for every room in your home.", rooms: ["Living Room", "Bedroom", "Kitchen", "Dining Room", "Office", "Bathroom"] },
                  { iconPath: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", title: "Exteriors", desc: "Transform your home's entrance and outdoor living areas with curated outdoor furniture and lighting.", rooms: ["Front Yard", "Backyard", "Balcony", "Entryway"] },
                  { iconPath: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z", title: "Gardens", desc: "Design lush, intentional outdoor spaces — from Japanese zen gardens to modern rooftop retreats.", rooms: ["English Garden", "Zen Garden", "Herb Garden", "Rooftop"] },
                ].map(card => (
                  <div key={card.title} style={{ background: "#F8F5F0", borderRadius: 20, padding: "36px 28px", transition: "transform .2s, box-shadow .2s", cursor: "default" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 16px 48px rgba(0,0,0,.1)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 16 }}><path d={card.iconPath} stroke="#1A1815" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <h3 style={{ fontSize: 22, fontWeight: 700, color: "#1A1815", marginBottom: 10, letterSpacing: "-0.01em" }}>{card.title}</h3>
                    <p style={{ fontSize: 15, color: "#5A5045", lineHeight: 1.6, marginBottom: 20 }}>{card.desc}</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {card.rooms.map(r => (
                        <span key={r} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 980, background: "#fff", color: "#1A1815", fontWeight: 500, border: "1px solid #E8E0D8" }}>{r}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "center", marginTop: 40 }}>
                <button onClick={() => { go("design"); setTab("studio"); trackEvent("cta_click", { button: "usecase_start" }); }} style={{ background: "#1A1815", color: "#fff", padding: "14px 36px", border: "none", borderRadius: 980, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s" }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>Start designing any space →</button>
              </div>
            </div>
          </section>

          {/* ─── Before/After Sliders — 3 budget tiers ─── */}
          <section className="aura-home-section" style={{ padding: "100px 6%", background: "#F8F5F0" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 48 }}>
                <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 600, marginBottom: 10 }}>The transformation</p>
                <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }}>Same room. Three budgets.</h2>
                <p style={{ fontSize: 16, color: "#5A5045", marginTop: 10, lineHeight: 1.5 }}>Drag to compare — see how AI redesigns the same space at every price point.</p>
              </div>
              <div className="aura-slider-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
                <BeforeAfterSlider
                  before="/images/sliders/before-room.jpg"
                  after="/images/sliders/after-budget.jpg"
                  label="Budget-Friendly"
                  afterLabel="Under $2k"
                />
                <BeforeAfterSlider
                  before="/images/sliders/before-room.jpg"
                  after="/images/sliders/after-midrange.jpg"
                  label="Mid-Range"
                  afterLabel="$2k - $8k"
                />
                <BeforeAfterSlider
                  before="/images/sliders/before-room.jpg"
                  after="/images/sliders/after-luxury.jpg"
                  label="Luxury"
                  afterLabel="$8k+"
                />
              </div>
            </div>
          </section>


          {/* ─── Interactive Demo ─── */}
          <section id="demo" className="aura-home-section" style={{ padding: "100px 6%", background: "#fff" }}>
            <div style={{ maxWidth: 800, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 48 }}>
                <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 600, marginBottom: 10 }}>Try it now</p>
                <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }}>Start redesigning your space</h2>
                <p style={{ fontSize: 16, color: "#5A5045", marginTop: 10, lineHeight: 1.5 }}>Choose your space type, pick a room and style, then let AI do the rest.</p>
              </div>

              {/* Space Type Tabs */}
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 36 }}>
                {(["interiors", "exteriors", "gardens"] as const).map(sp => (
                  <button key={sp} onClick={() => { setDemoSpace(sp); setDemoRoom(sp === "interiors" ? "Living Room" : sp === "exteriors" ? "Front Yard" : "Backyard"); setDemoStyle(sp === "gardens" ? "Modern" : "Warm Modern"); }}
                    style={{ padding: "10px 28px", borderRadius: 980, border: demoSpace === sp ? "2px solid #1A1815" : "1px solid #E8E0D8", background: demoSpace === sp ? "#1A1815" : "#fff", color: demoSpace === sp ? "#fff" : "#5A5045", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textTransform: "capitalize" }}>{sp}</button>
                ))}
              </div>

              <div style={{ background: "#F8F5F0", borderRadius: 20, padding: "36px 32px" }}>
                {/* Row 1: Room Type + Design Style */}
                <div className="aura-demo-form" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1A1815", marginBottom: 8 }}>
                      {demoSpace === "interiors" ? "Room Type" : demoSpace === "exteriors" ? "Area" : "Garden Type"}
                    </label>
                    <select value={demoRoom} onChange={e => setDemoRoom(e.target.value)}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E8E0D8", fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1A1815", cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2386868b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}>
                      {demoSpace === "interiors" && ["Living Room", "Bedroom", "Kitchen", "Dining Room", "Bathroom", "Office", "Great Room"].map(r => <option key={r} value={r}>{r}</option>)}
                      {demoSpace === "exteriors" && ["Front Yard", "Backyard", "Balcony", "Entryway", "Patio / Deck"].map(r => <option key={r} value={r}>{r}</option>)}
                      {demoSpace === "gardens" && ["Backyard", "Courtyard", "Rooftop", "English Garden", "Zen Garden", "Herb Garden"].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1A1815", marginBottom: 8 }}>Design Style</label>
                    <select value={demoStyle} onChange={e => setDemoStyle(e.target.value)}
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E8E0D8", fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1A1815", cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2386868b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}>
                      {VIBES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>

                {/* Generate Button */}
                <button onClick={() => { setRoom(demoRoom); setVibe(demoStyle); go("design"); setTab("studio"); trackEvent("cta_click", { button: "demo_generate" }); }}
                  style={{ width: "100%", padding: "16px", background: "#1A1815", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s", letterSpacing: ".01em" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                  Generate Your Design
                </button>
                <p style={{ textAlign: "center", fontSize: 13, color: "#9B8B7B", marginTop: 12 }}>No credit card required to get started.</p>
              </div>
            </div>
          </section>

          {/* ─── Comparison Table ─── */}
          <section className="aura-home-section" style={{ padding: "100px 6%", background: "#F8F5F0" }}>
            <div style={{ maxWidth: 1000, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 48 }}>
                <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 600, marginBottom: 10 }}>The comparison</p>
                <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }}>AURA vs. Everybody else</h2>
              </div>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table className="aura-compare-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontFamily: "inherit", minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "16px 14px", textAlign: "left", fontSize: 13, fontWeight: 600, color: "#9B8B7B", borderBottom: "1px solid #E8E0D8", background: "#fff" }}>Features</th>
                      <th style={{ padding: "16px 14px", textAlign: "center", fontSize: 14, fontWeight: 700, color: "#fff", background: "#1A1815", borderRadius: "12px 12px 0 0", minWidth: 80 }}>AURA</th>
                      {["HomeDesigns.AI", "Havenly", "Modsy", "RoomGPT", "Pinterest"].map(c => (
                        <th key={c} style={{ padding: "16px 14px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#9B8B7B", borderBottom: "1px solid #E8E0D8", background: "#fff", minWidth: 80 }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["AI room visualization", true, true, false, false, true, false],
                      ["Real shoppable products", true, false, true, true, false, false],
                      ["CAD floor plans & layouts", true, false, false, false, false, false],
                      ["AI mood boards", true, false, true, true, false, false],
                      ["Traffic flow analysis", true, false, false, false, false, false],
                      ["Clearance zone detection", true, false, false, false, false, false],
                      ["Free to start", true, false, false, false, true, true],
                      ["No designer wait time", true, true, false, false, true, true],
                      ["Upload real room photos", true, true, false, false, true, false],
                      ["Interiors + exteriors + gardens", true, true, false, false, false, false],
                    ] as [string, boolean, boolean, boolean, boolean, boolean, boolean][]).map(([feature, aura, hd, havenly, modsy, roomgpt, pinterest], i) => (
                      <tr key={feature}>
                        <td style={{ padding: "13px 14px", fontSize: 13, color: "#3A3530", borderBottom: "1px solid #F0EBE4", background: i % 2 === 0 ? "#FDFCFA" : "#fff", fontWeight: 500 }}>{feature}</td>
                        <td style={{ padding: "13px 14px", textAlign: "center", fontSize: 16, fontWeight: 600, color: "#fff", background: i % 2 === 0 ? "#252525" : "#1A1815", borderBottom: "1px solid rgba(255,255,255,.08)" }}>{aura ? "\u2713" : "\u2715"}</td>
                        {[hd, havenly, modsy, roomgpt, pinterest].map((val, ci) => (
                          <td key={ci} style={{ padding: "13px 14px", textAlign: "center", fontSize: 15, color: val ? "#5B8B6B" : "#C9B8A8", borderBottom: "1px solid #F0EBE4", background: i % 2 === 0 ? "#FDFCFA" : "#fff", fontWeight: val ? 600 : 400 }}>
                            {val ? "\u2713" : "\u2715"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Section 7: Pricing — reusable component */}
          <section className="aura-home-section" style={{ padding: "100px 6%", background: "#fff" }}>
            <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
              <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", marginBottom: 12 }}>Simple pricing. Powerful tools.</h2>
              <p style={{ fontSize: 17, color: "#5A5045", lineHeight: 1.5, maxWidth: 520, margin: "0 auto 40px" }}>AI-powered interior design with 100,000+ real products, photorealistic renders, and CAD floor plans.</p>
              <PricingSection
                billingCycle={billingCycle}
                setBillingCycle={setBillingCycle}
                userPlan={userPlan}
                user={user}
                onCheckout={handleCheckout}
                onGetStarted={() => { go("design"); setTab("studio"); }}
                trackEvent={trackEvent}
                compact
              />
            </div>
          </section>


          {/* ─── Why AURA ─── */}
          <section className="aura-home-section" style={{ padding: "100px 6%", background: "#1A1815" }}>
            <div style={{ maxWidth: 1100, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 56 }}>
                <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#fff" }}>Why choose AURA?</h2>
              </div>
              <div className="aura-why-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
                {[
                  { icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", title: "Budget Friendly", desc: "Pro is just $20/mo — a fraction of hiring a designer." },
                  { icon: "M13 10V3L4 14h7v7l9-11h-7z", title: "Ultra-Fast", desc: "Get AI-generated designs, mood boards, and renders in under 2 minutes." },
                  { icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z", title: "Professional Quality", desc: "Photorealistic renders and CAD floor plans trusted by interior designers." },
                  { icon: "M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", title: "Zero Learning Curve", desc: "Just describe what you want in plain English. No design skills required." },
                ].map(card => (
                  <div key={card.title} style={{ padding: "28px 24px", borderRadius: 18, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 16 }}><path d={card.icon} stroke="#C17550" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{card.title}</h3>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,.55)", lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ─── FAQ ─── */}
          <section className="aura-home-section" style={{ padding: "100px 6%", background: "#fff" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 48 }}>
                <p style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", color: "#9B8B7B", fontWeight: 600, marginBottom: 10 }}>FAQ</p>
                <h2 style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }}>Common questions</h2>
              </div>
              {[
                ["How does AURA work?", "Tell AURA your room type, design style, and dimensions. Our AI searches " + DB.length + "+ real products from premium brands, generates mood boards, and creates photorealistic renders of your room — all in under 2 minutes."],
                ["Do I need design experience?", "Not at all. AURA is built for everyone — from first-time homeowners to professional designers. Just describe what you want in plain English and our AI handles the rest."],
                ["Are the products real?", "Yes! Every product in AURA is a real, shoppable item from brands like Lulu & Georgia, McGee & Co, West Elm, Crate & Barrel, Article, and more. Click any product to buy it directly from the retailer."],
                ["What's included?", "AURA Pro ($20/mo) includes AI mood boards, style matching, 100,000+ real shoppable products, photorealistic room visualization, CAD floor plans, clearance analysis, and unlimited projects."],
                ["How accurate are the visualizations?", "Our AI generates photorealistic renders using the exact products you selected. It considers your room dimensions, style palette, and furniture placement to create an accurate preview of how your room will look."],
                ["Can I upload my own room photo?", "Yes! Upload a photo of your actual room and our AI will analyze it, then place your selected furniture into the real space for an accurate visualization."],
                ["Does it work on mobile?", "AURA works on any device — desktop, tablet, or phone. The interface is fully responsive and optimized for touch."],
                ["How do I cancel my subscription?", "You can cancel anytime from your account settings. No commitments, no cancellation fees. Your access continues through the end of your billing period."],
              ].map(([q, a], i) => (
                <div key={q} style={{ borderBottom: "1px solid #E8E0D8" }}>
                  <button onClick={() => setFaqOpen(faqOpen === i ? -1 : i)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1815", flex: 1, paddingRight: 16 }}>{q}</span>
                    <span style={{ fontSize: 22, color: "#9B8B7B", fontWeight: 300, flexShrink: 0, transform: faqOpen === i ? "rotate(45deg)" : "none", transition: "transform .2s" }}>+</span>
                  </button>
                  {faqOpen === i && (
                    <div style={{ paddingBottom: 20 }}>
                      <p style={{ fontSize: 15, color: "#5A5045", lineHeight: 1.7, margin: 0 }}>{a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Final CTA */}
          <section className="aura-cta-section" style={{ padding: "100px 6%", textAlign: "center", background: "#F8F5F0" }}>
            <div>
              <p style={{ fontSize: 13, color: "#9B8B7B", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 24, fontWeight: 500 }}>Products from Lulu & Georgia, McGee & Co, West Elm, and more</p>
              <h2 style={{ fontSize: "clamp(32px,4.5vw,52px)", fontWeight: 700, marginBottom: 16, letterSpacing: "-0.025em", lineHeight: 1.08, color: "#1A1815" }}>Your dream room<br />is one click away.</h2>
              <p style={{ fontSize: 17, color: "#9B8B7B", marginBottom: 36, lineHeight: 1.5 }}>Join thousands of homeowners designing smarter with AI.</p>
              <div className="aura-final-cta-btns" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", maxWidth: 400, margin: "0 auto" }}>
                <button onClick={() => { go("design"); setTab("studio"); }} style={{ background: "#1A1815", color: "#fff", padding: "16px 40px", border: "none", borderRadius: 980, fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s", flex: "1 1 auto" }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>Start designing now</button>
                <button onClick={() => go("pricing")} style={{ background: "#F8F5F0", border: "none", padding: "16px 32px", borderRadius: 980, fontSize: 16, color: "#1A1815", cursor: "pointer", fontFamily: "inherit", fontWeight: 500, flex: "1 1 auto" }}>See pricing</button>
              </div>
            </div>
          </section>
        </div>
        );
      })()}

      {/* DESIGN */}
      {pg === "design" && (
        <div style={{ paddingTop: 60 }}>
          {/* Paywall gate — only pro users see the studio */}
          {userPlan !== "pro" && !user ? (
            <div style={{ padding: "120px 6%", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ margin: "0 auto 24px", display: "block" }}><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="#9B8B7B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: "#1A1815", marginBottom: 12, letterSpacing: "-0.02em" }}>Sign in to access the Studio</h2>
              <p style={{ fontSize: 16, color: "#5A5045", lineHeight: 1.6, marginBottom: 32 }}>Create an account or sign in to start designing your space with AI-powered tools.</p>
              <button onClick={() => go("login")} style={{ background: "#1A1815", color: "#fff", padding: "14px 40px", border: "none", borderRadius: 980, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Sign In</button>
              <button onClick={() => go("pricing")} style={{ background: "none", color: "#5A5045", padding: "14px 24px", border: "none", fontSize: 14, cursor: "pointer", fontFamily: "inherit", marginLeft: 8 }}>View Pricing</button>
            </div>
          ) : userPlan !== "pro" ? (
            <div style={{ padding: "120px 6%", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ margin: "0 auto 24px", display: "block" }}><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" stroke="#9B8B7B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: "#1A1815", marginBottom: 12, letterSpacing: "-0.02em" }}>Upgrade to Pro to access the Studio</h2>
              <p style={{ fontSize: 16, color: "#5A5045", lineHeight: 1.6, marginBottom: 32 }}>The AI Design Studio with room visualization, mood boards, and shoppable products is available on the Pro plan.</p>
              <button onClick={() => go("pricing")} style={{ background: "#1A1815", color: "#fff", padding: "14px 40px", border: "none", borderRadius: 980, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Upgrade to Pro — $20/mo</button>
              <button onClick={() => go("home")} style={{ background: "none", color: "#5A5045", padding: "14px 24px", border: "none", fontSize: 14, cursor: "pointer", fontFamily: "inherit", marginLeft: 8 }}>Back to Home</button>
            </div>
          ) : (
          <>
          <div style={{ borderBottom: "1px solid #F0EBE4", background: "#fff" }}>
            <div className="aura-design-tabs" style={{ display: "flex", padding: "0 5%", overflowX: "auto" }}>
              {[["studio", "Studio"], ["catalog", "Featured Catalog"], ["projects", "Projects" + (projects.length ? " (" + projects.length + ")" : "")]].map(([id, lb]) => (
                <button key={id} onClick={() => { setTab(id); setPage(0); }} style={{ padding: "16px 22px", fontSize: 12, fontWeight: tab === id ? 700 : 500, background: "none", border: "none", borderBottom: tab === id ? "2px solid #1A1815" : "2px solid transparent", color: tab === id ? "#1A1815" : "#B8A898", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", letterSpacing: ".02em", transition: "all .15s" }}>{lb}</button>
              ))}
              <div className="aura-project-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
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
                <div className="aura-step-nav" style={{ display: "flex", alignItems: "center", maxWidth: 640, margin: "0 auto", padding: "20px 0 18px" }}>
                  {[
                    { label: "Set Up", sub: "Room & Style", icon: "1", done: !!(room && vibe) },
                    { label: "Design", sub: "AI + Products", icon: "2", done: sel.size > 0 },
                    { label: "Visualize", sub: "See Your Room", icon: "3", done: vizUrls.length > 0 },
                    { label: "Purchase", sub: "Buy Items", icon: "4", done: false },
                  ].map((s, i, arr) => (
                    <React.Fragment key={i}>
                      <button onClick={() => setDesignStep(i)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontFamily: "inherit", flexShrink: 0 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: designStep === i ? "#1A1815" : s.done ? "#5B8B6B" : "#E8E0D8", color: designStep === i || s.done ? "#fff" : "#9B8B7B", transition: "all .3s", boxShadow: designStep === i ? "0 2px 8px rgba(26,24,21,.2)" : "none" }}>
                          {s.done && designStep !== i ? "\u2713" : s.icon}
                        </div>
                        <div className="aura-step-label">
                          <div style={{ fontSize: 13, fontWeight: designStep === i ? 700 : 500, color: designStep === i ? "#1A1815" : "#9B8B7B", transition: "all .2s", lineHeight: 1.2 }}>{s.label}</div>
                          <div style={{ fontSize: 10, color: designStep === i ? "#9B8B7B" : "#C8BEB4", lineHeight: 1.2, marginTop: 1 }}>{s.sub}</div>
                        </div>
                      </button>
                      {i < arr.length - 1 && <div className="aura-step-connector" style={{ flex: 1, height: 1, background: s.done ? "linear-gradient(90deg, #5B8B6B60, #5B8B6B20)" : "#E8E0D8", margin: "0 16px", minWidth: 24, borderRadius: 1 }} />}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* ═══════ STEP 0: SET UP YOUR SPACE — STEP-BY-STEP WIZARD ═══════ */}
              {designStep === 0 && (
                <div className="aura-setup-container" style={{ maxWidth: 640, margin: "0 auto", padding: "36px 5% 48px" }}>
                  {/* Progress indicator */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 32 }}>
                    {["Room", "Style", "Budget", "Details"].map((label, i) => (
                      <React.Fragment key={label}>
                        <button onClick={() => { if (i <= setupSubStep) setSetupSubStep(i); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: i <= setupSubStep ? "pointer" : "default", padding: 0, fontFamily: "inherit" }}>
                          <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: setupSubStep === i ? "#1A1815" : i < setupSubStep ? "#5B8B6B" : "#E8E0D8", color: setupSubStep === i || i < setupSubStep ? "#fff" : "#9B8B7B", transition: "all .3s" }}>
                            {i < setupSubStep ? "\u2713" : i + 1}
                          </div>
                          <span className="aura-substep-label" style={{ fontSize: 12, fontWeight: setupSubStep === i ? 700 : 400, color: setupSubStep === i ? "#1A1815" : "#9B8B7B", transition: "all .2s" }}>{label}</span>
                        </button>
                        {i < 3 && <div style={{ flex: 1, height: 1, background: i < setupSubStep ? "#5B8B6B40" : "#E8E0D8", minWidth: 16, borderRadius: 1 }} />}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Sub-step 0: Room Type */}
                  {setupSubStep === 0 && (
                    <div>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, marginBottom: 8, color: "#1A1815" }}>What room are you designing?</h2>
                      <p style={{ fontSize: 14, color: "#9B8B7B", lineHeight: 1.5, marginBottom: 28 }}>Choose the room type so we can tailor recommendations.</p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {ROOMS.map((rm) => (
                          <button key={rm} onClick={() => setRoom(rm)} style={{ padding: "18px 16px", borderRadius: 12, border: room === rm ? "2px solid #1A1815" : "1px solid #E8E0D8", background: room === rm ? "#1A1815" : "#fff", fontSize: 14, fontWeight: room === rm ? 600 : 400, color: room === rm ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textAlign: "left" }}>{rm}</button>
                        ))}
                      </div>
                      <div style={{ marginTop: 24 }}>
                        <button onClick={() => setSetupSubStep(1)} disabled={!room} style={{ width: "100%", background: room ? "#1A1815" : "#E8E0D8", color: room ? "#fff" : "#B8A898", padding: "16px 24px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: room ? "pointer" : "default", fontFamily: "inherit", transition: "all .2s" }}>
                          {room ? "Next →" : "Select a room to continue"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Sub-step 1: Style */}
                  {setupSubStep === 1 && (
                    <div>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, marginBottom: 8, color: "#1A1815" }}>What's your style?</h2>
                      <p style={{ fontSize: 14, color: "#9B8B7B", lineHeight: 1.5, marginBottom: 28 }}>Pick the aesthetic that speaks to you. This guides your AI designer.</p>
                      <div className="aura-style-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {VIBES.map((v) => (
                          <button key={v} onClick={() => setVibe(v)} style={{ padding: "16px 16px", borderRadius: 12, border: vibe === v ? "2px solid #1A1815" : "1px solid #E8E0D8", background: vibe === v ? "#1A1815" : "#fff", fontSize: 14, fontWeight: vibe === v ? 600 : 400, color: vibe === v ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textAlign: "left" }}>{v}</button>
                        ))}
                      </div>
                      {currentPalette && (
                        <div style={{ marginTop: 16, padding: "14px 18px", background: "#fff", borderRadius: 12, border: "1px solid #EDE8E0" }}>
                          <p style={{ fontSize: 13, fontStyle: "italic", color: "#5A5045", lineHeight: 1.5, margin: "0 0 8px" }}>{currentPalette.feel}</p>
                          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#7A6B5B", flexWrap: "wrap" }}>
                            <div><span style={{ fontWeight: 700, color: "#1A1815", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>Colors</span><br/>{currentPalette.colors.join(" · ")}</div>
                            <div><span style={{ fontWeight: 700, color: "#1A1815", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>Materials</span><br/>{currentPalette.materials.join(" · ")}</div>
                          </div>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                        <button onClick={() => setSetupSubStep(0)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 20px", fontSize: 14, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
                        <button onClick={() => setSetupSubStep(2)} disabled={!vibe} style={{ flex: 1, background: vibe ? "#1A1815" : "#E8E0D8", color: vibe ? "#fff" : "#B8A898", padding: "14px 24px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: vibe ? "pointer" : "default", fontFamily: "inherit", transition: "all .2s" }}>
                          {vibe ? "Next →" : "Select a style to continue"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Sub-step 2: Budget */}
                  {setupSubStep === 2 && (
                    <div>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, marginBottom: 8, color: "#1A1815" }}>What's your budget?</h2>
                      <p style={{ fontSize: 14, color: "#9B8B7B", lineHeight: 1.5, marginBottom: 28 }}>We'll find pieces that match your price range.</p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                        {budgets.map(([id, lb]) => (
                          <button key={id} onClick={() => setBud(id)} style={{ padding: "18px 20px", borderRadius: 12, border: bud === id ? "2px solid #1A1815" : "1px solid #E8E0D8", background: bud === id ? "#1A1815" : "#fff", fontSize: 15, fontWeight: bud === id ? 600 : 400, color: bud === id ? "#fff" : "#5A5045", cursor: "pointer", fontFamily: "inherit", transition: "all .15s", textAlign: "left" }}>{lb}</button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                        <button onClick={() => setSetupSubStep(1)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 20px", fontSize: 14, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
                        <button onClick={() => setSetupSubStep(3)} style={{ flex: 1, background: "#1A1815", color: "#fff", padding: "14px 24px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                          Next {"→"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Sub-step 3: Dimensions + Uploads (optional details) */}
                  {setupSubStep === 3 && (
                    <div>
                      <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 400, marginBottom: 8, color: "#1A1815" }}>Room details <span style={{ fontSize: 14, color: "#B8A898", fontWeight: 400 }}>(optional)</span></h2>
                      <p style={{ fontSize: 14, color: "#9B8B7B", lineHeight: 1.5, marginBottom: 28 }}>Add dimensions or photos for better results. You can skip this and add later.</p>

                      {/* Summary of selections */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                        {room && <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815", background: "#F5F0EB", padding: "6px 14px", borderRadius: 8 }}>{room}</span>}
                        {vibe && <span style={{ fontSize: 12, color: "#5A5045", background: "#F5F0EB", padding: "6px 14px", borderRadius: 8 }}>{vibe}</span>}
                        {bud && <span style={{ fontSize: 12, color: "#5A5045", background: "#F5F0EB", padding: "6px 14px", borderRadius: 8 }}>{budgets.find(b => b[0] === bud)?.[1]}</span>}
                      </div>

                      {/* Dimensions */}
                      <div style={{ background: "#fff", borderRadius: 14, padding: "22px 24px", border: "1px solid #EDE8E0", marginBottom: 16 }}>
                        <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 14 }}>Dimensions</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                          <input value={roomW} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setRoomW(v); if (v && roomL) setSqft(String(Math.round(parseFloat(v) * parseFloat(roomL)))); }} placeholder="Width (ft)" style={{ flex: 1, padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", minWidth: 0, background: "#FDFCFA" }} />
                          <span style={{ color: "#C8BEB4", fontSize: 14 }}>{"×"}</span>
                          <input value={roomL} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setRoomL(v); if (roomW && v) setSqft(String(Math.round(parseFloat(roomW) * parseFloat(v)))); }} placeholder="Length (ft)" style={{ flex: 1, padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", minWidth: 0, background: "#FDFCFA" }} />
                        </div>
                        <input value={sqft} onChange={(e) => setSqft(e.target.value.replace(/\D/g, ""))} placeholder="or total sqft" style={{ width: "100%", padding: "12px 14px", border: "1px solid #E8E0D8", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#FDFCFA" }} />
                        {sqft && <div style={{ marginTop: 6, fontSize: 12, color: "#8A7B6B" }}>{roomW && roomL ? roomW + "' × " + roomL + "' = " + sqft + " sqft" : sqft + " sqft"}</div>}
                      </div>

                      {/* Uploads */}
                      <div className="aura-upload-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
                        <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #EDE8E0" }}>
                          <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 4 }}>Floor Plan / CAD</div>
                          <div style={{ fontSize: 11, color: "#9B8B7B", marginBottom: 10, lineHeight: 1.4 }}>For precise placement</div>
                          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px", background: "#FDFCFA", border: "1.5px dashed #D8D0C8", borderRadius: 10, fontSize: 12, color: "#7A6B5B", cursor: "pointer" }}>
                            <span style={{ fontSize: 18, opacity: 0.5 }}>{"\uD83D\uDCC0"}</span>
                            <span style={{ fontWeight: 500 }}>{cadLoading ? "Analyzing..." : "Upload"}</span>
                            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleCad} style={{ display: "none" }} disabled={cadLoading} />
                          </label>
                          {cadFile && <div style={{ fontSize: 11, color: "#5B8B6B", fontWeight: 600, marginTop: 6 }}>{cadFile.name}</div>}
                          {cadLoading && <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", display: "inline-block", marginTop: 6 }} />}
                          {cadAnalysis && <div style={{ marginTop: 8, padding: "8px 10px", background: "#F8F5F0", borderRadius: 8, fontSize: 10, color: "#5A5045", lineHeight: 1.4, maxHeight: 60, overflowY: "auto" }}>{cadAnalysis.slice(0, 120)}{cadAnalysis.length > 120 ? "..." : ""}</div>}
                        </div>
                        <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #EDE8E0" }}>
                          <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "#1A1815", fontWeight: 700, marginBottom: 4 }}>Room Photo</div>
                          <div style={{ fontSize: 11, color: "#9B8B7B", marginBottom: 10, lineHeight: 1.4 }}>AI designs in your room</div>
                          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px", background: "#FDFCFA", border: "1.5px dashed #D8D0C8", borderRadius: 10, fontSize: 12, color: "#7A6B5B", cursor: "pointer" }}>
                            <span style={{ fontSize: 18, opacity: 0.5 }}>{"\uD83D\uDCF7"}</span>
                            <span style={{ fontWeight: 500 }}>{roomPhotoLoading ? "Analyzing..." : "Upload"}</span>
                            <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleRoomPhoto} style={{ display: "none" }} disabled={roomPhotoLoading} />
                          </label>
                          {roomPhoto && <div style={{ fontSize: 11, color: "#5B8B6B", fontWeight: 600, marginTop: 6 }}>{roomPhoto.name}</div>}
                          {roomPhotoLoading && <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", display: "inline-block", marginTop: 6 }} />}
                          {roomPhoto && !roomPhotoLoading && (
                            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <img src={roomPhoto.data} alt="Your room" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid #E8E0D8" }} />
                              {roomPhotoAnalysis && <div style={{ flex: 1, fontSize: 10, color: "#7A6B5B", lineHeight: 1.3, maxHeight: 40, overflowY: "auto" }}>{roomPhotoAnalysis.slice(0, 100)}...</div>}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Navigation */}
                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setSetupSubStep(2)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 24px", fontSize: 14, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Back</button>
                        <button onClick={() => setDesignStep(1)} style={{ flex: 1, background: "#1A1815", color: "#fff", padding: "14px 24px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .2s" }}>
                          Continue to Design {"→"}
                        </button>
                      </div>
                      <button onClick={() => setDesignStep(1)} style={{ width: "100%", marginTop: 10, background: "none", border: "none", padding: "10px", fontSize: 13, color: "#B8A898", cursor: "pointer", fontFamily: "inherit" }}>Skip details, start designing</button>
                    </div>
                  )}
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
                    <button onClick={() => { setDesignStep(0); setSetupSubStep(3); }} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>Edit</button>
                  </div>

                  {/* AI Chat — above mood boards */}
                  <div style={{ padding: "20px 5%", background: "#F5F2ED" }}>
                    <div className="aura-chat-box" style={{ background: "#fff", borderRadius: 14, padding: 0, maxWidth: 900, boxShadow: "0 1px 4px rgba(0,0,0,.04)", border: "1px solid #EDE8E0", overflow: "hidden" }}>
                      <div style={{ padding: "14px 20px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#5B8B6B" }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815", letterSpacing: ".04em" }}>AI Designer</span>
                        </div>
                        <span style={{ fontSize: 10, color: "#B8A898" }}>Ask about products, colors, layouts</span>
                      </div>
                      <div ref={chatBoxRef} className="aura-chat-msgs" style={{ maxHeight: 400, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10, WebkitOverflowScrolling: "touch" }}>
                        {msgs.map((m, i) => (
                          <div key={i}>
                            <div style={{ padding: m.role === "user" ? "10px 14px" : "12px 16px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", fontSize: 14, lineHeight: 1.65, maxWidth: m.role === "user" ? "80%" : "100%", background: m.role === "user" ? "#1A1815" : "#F8F5F0", color: m.role === "user" ? "#fff" : "#3A3530", marginLeft: m.role === "user" ? "auto" : 0, wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: formatChatMessage(m.text) }} />
                            {(m.recs?.length ?? 0) > 0 && (
                              <div style={{ marginTop: 10 }}>
                                <p style={{ fontSize: 10, color: "#B8A898", marginBottom: 6 }}>Tap + to add to your selection</p>
                                <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }}>
                                  {m.recs!.map((p) => <Card key={p.id} p={p} small sel={sel.has(p.id)} toggle={toggle} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {busy && searchProgress && (
                          <div style={{ color: "#1A1815", fontSize: 13, padding: "16px 18px", background: "#F8F5F0", borderRadius: 14, margin: "4px 0", border: "1px solid #EDE8E0" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #1A1815, #3A3530)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <div style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
                              </div>
                              <div>
                                <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1815", margin: 0 }}>AI Designer working</p>
                                <p style={{ fontSize: 10, color: "#B8A898", margin: "1px 0 0" }}>Typically 20–40 seconds</p>
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {searchProgress.steps.map((s, i) => {
                                const isCurrent = i === searchProgress.step;
                                const isDone = i < searchProgress.step;
                                const isFuture = i > searchProgress.step;
                                // During countdown (step 0), show count in first step
                                const label = i === 0 && searchProgress.count > 0
                                  ? s.replace(/[\d,]+/, searchProgress.count.toLocaleString())
                                  : s;
                                return (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", opacity: isFuture ? 0.3 : 1, transition: "opacity .4s" }}>
                                    {isDone ? (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M5 13l4 4L19 7" stroke="#5B8B6B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    ) : isCurrent ? (
                                      <div style={{ width: 14, height: 14, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", flexShrink: 0 }} />
                                    ) : (
                                      <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid #E0D8D0", flexShrink: 0 }} />
                                    )}
                                    <span style={{ fontSize: 12, color: isDone ? "#5B8B6B" : isCurrent ? "#1A1815" : "#C8BEB4", fontWeight: isCurrent ? 600 : 400, transition: "color .3s" }}>{label}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: "#E8E0D8", overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: 2, background: searchProgress.step === 0 ? "#1A1815" : "linear-gradient(90deg, #5B8B6B, #7BA98B)", transition: "width .5s ease", width: searchProgress.step === 0 ? Math.min(12, Math.max(2, (1 - searchProgress.count / DB.length) * 12)) + "%" : Math.min(100, ((searchProgress.step + 1) / searchProgress.steps.length) * 100) + "%" }} />
                            </div>
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

                  {/* Mood Boards — below chat */}
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

                  {/* Continue to Visualize — sticky bottom bar */}
                  {sel.size > 0 && (
                    <div className="aura-review-bar" style={{ padding: "14px 5%", background: "#fff", borderTop: "1px solid #EDE8E0", position: "sticky", bottom: 0, zIndex: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, maxWidth: 900, margin: "0 auto" }}>
                        <span style={{ fontSize: 13, color: "#5A5045", whiteSpace: "nowrap" }}><strong>{selCount}</strong> items · <strong>{fmt(selTotal)}</strong></span>
                        <button onClick={() => setDesignStep(2)} style={{ background: "#1A1815", color: "#fff", padding: "13px 28px", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flex: "0 0 auto" }}>Review & Visualize →</button>
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
                  {/* Prominent Visualize banner */}
                  <div className="aura-viz-banner" style={{ background: "linear-gradient(135deg, #1A1815, #2A2520)", borderRadius: 16, padding: "24px 28px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div>
                      <h2 className="aura-viz-banner-h2" style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 400, color: "#fff", marginBottom: 4 }}>{selCount} items · {fmt(selTotal)}</h2>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", margin: 0 }}>Ready to see your room come to life?</p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                      <div className="aura-viz-btns" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        {vizRemaining > 0 ? (
                          <button onClick={generateViz} disabled={vizSt === "loading"} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "14px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: vizSt === "loading" ? 0.6 : 1, transition: "all .2s", boxShadow: "0 4px 16px rgba(193,117,80,.35)", letterSpacing: ".02em", whiteSpace: "nowrap" }}>{vizSt === "loading" ? "Generating..." : "✦ Visualize Room"}</button>
                        ) : (
                          <button onClick={() => go("pricing")} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "14px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 16px rgba(193,117,80,.35)", letterSpacing: ".02em", whiteSpace: "nowrap" }}>{userPlan === "pro" ? "Limit Reached" : "Upgrade to Pro"}</button>
                        )}
                        <button onClick={() => { setSel(new Map()); setVizUrls([]); setVizSt("idle"); setVizErr(""); setCadLayout(null); setDesignStep(1); }} style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, padding: "10px 16px", fontSize: 12, color: "rgba(255,255,255,.7)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Clear all</button>
                      </div>
                      <span style={{ fontSize: 11, color: vizRemaining <= 3 ? "#F0A080" : "rgba(255,255,255,.4)", alignSelf: "flex-end" }}>{vizCount}/{vizLimit} used · {vizRemaining} remaining</span>
                    </div>
                  </div>

                  {/* Viz images — ABOVE floor plan */}
                  {vizErr && vizErr === "sign_up_prompt" ? (
                    <div style={{ marginBottom: 20, borderRadius: 16, border: "1px solid #E8E0D8", padding: "32px 28px", background: "linear-gradient(135deg, #FDFCFA, #F8F5F0)", textAlign: "center" }}>
                      <h3 style={{ fontSize: 20, fontWeight: 700, color: "#1A1815", margin: "0 0 8px" }}>You're almost there!</h3>
                      <p style={{ fontSize: 14, color: "#7A6B5B", margin: "0 0 20px", lineHeight: 1.5 }}>Create an account to visualize your room. It takes 10 seconds — your selections are saved.</p>
                      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                        <button onClick={() => { setVizErr(""); go("auth"); }} style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 10, padding: "14px 32px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Create account</button>
                        <button onClick={() => { setVizErr(""); go("auth"); }} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 24px", fontSize: 14, color: "#7A6B5B", cursor: "pointer", fontFamily: "inherit" }}>Sign in</button>
                      </div>
                    </div>
                  ) : vizErr ? (
                    <div style={{ fontSize: 12, color: "#C17550", marginBottom: 16, background: "#FFF8F0", padding: "14px 18px", borderRadius: 10, border: "1px solid #F0D8C0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <span>{vizErr}</span>
                      {vizRemaining <= 0 && userPlan !== "pro" && <button onClick={() => go("pricing")} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Upgrade to Pro</button>}
                    </div>
                  ) : null}
                  <div ref={vizAreaRef}>
                  {vizSt === "loading" && (() => {
                    const VizProgress = () => {
                      const [step, setStep] = React.useState(0);
                      const steps = [
                        "Analyzing " + selItems.length + " selected products...",
                        "Building room layout (" + (roomW || "18") + "' x " + (roomL || "22") + "')...",
                        roomPhotoAnalysis ? "Matching your room photo..." : "Applying " + (vibe || "modern") + " style palette...",
                        "Rendering photorealistic scene...",
                        "Adding lighting and finishing touches..."
                      ];
                      React.useEffect(() => {
                        const t = setInterval(() => setStep(s => s < steps.length - 1 ? s + 1 : s), 8000);
                        return () => clearInterval(t);
                      }, []);
                      return (
                        <div style={{ marginBottom: 24, borderRadius: 16, border: "1px solid #EDE8E0", padding: "40px 32px", background: "#fff" }}>
                          <div style={{ maxWidth: 320, margin: "0 auto" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                              <div style={{ width: 32, height: 32, border: "2.5px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", flexShrink: 0 }} />
                              <div>
                                <p style={{ fontSize: 15, color: "#1A1815", margin: 0, fontWeight: 600 }}>Generating visualization</p>
                                <p style={{ fontSize: 12, color: "#9B8B7B", margin: "2px 0 0" }}>{selItems.length} products · {vibe || "Modern"} style</p>
                                <p style={{ fontSize: 10, color: "#B8A898", margin: "2px 0 0" }}>This can take up to a minute</p>
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {steps.map((s, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, opacity: i <= step ? 1 : 0.3, transition: "opacity .5s" }}>
                                  {i < step ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#5B8B6B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  ) : i === step ? (
                                    <div style={{ width: 16, height: 16, border: "2px solid #E8E0D8", borderTopColor: "#1A1815", borderRadius: "50%", animation: "spin .8s linear infinite", flexShrink: 0 }} />
                                  ) : (
                                    <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid #E8E0D8", flexShrink: 0 }} />
                                  )}
                                  <span style={{ fontSize: 13, color: i < step ? "#5B8B6B" : i === step ? "#1A1815" : "#C8BEB4", fontWeight: i === step ? 600 : 400 }}>{s}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    };
                    return <VizProgress />;
                  })()}
                  </div>
                  {vizUrls.length > 0 && (<>
                    <div className="aura-viz-grid" style={{ display: "grid", gridTemplateColumns: vizUrls.length === 1 ? "1fr" : "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 24 }}>
                      {vizUrls.map((v, i) => (
                        <div key={i} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #F0EBE4" }}>
                          {v.concept ? (
                            <div style={{ width: "100%", minHeight: 220, background: `linear-gradient(135deg, ${["#E8DDD0","#D4CFC8","#E0D8CC"][i]}, ${["#D8C8B8","#C8C0B4","#C8BFB0"][i]})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", position: "relative" }}>
                              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.06, background: `repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(0,0,0,.1) 35px, rgba(0,0,0,.1) 36px)` }} />
                              <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>{["\u2600\uFE0F","\uD83C\uDF05","\uD83C\uDF19"][i]}</div>
                              <div style={{ fontFamily: "Georgia,serif", fontSize: 18, color: "#6B5B4B", textAlign: "center", marginBottom: 8, fontStyle: "italic" }}>{v.label}</div>
                              <div style={{ fontSize: 11, color: "#8B7B6B", textAlign: "center", lineHeight: 1.5, maxWidth: 240 }}>{(v.products || []).slice(0, 3).join(" \u00B7 ")}</div>
                              <div style={{ marginTop: 12, display: "flex", gap: 6 }}>{(v.colors || []).map((c, ci) => <span key={ci} style={{ fontSize: 9, background: "rgba(255,255,255,.6)", padding: "3px 10px", borderRadius: 12, color: "#7A6B5B" }}>{c}</span>)}</div>
                              <div style={{ marginTop: 16, fontSize: 10, color: "#A09080", letterSpacing: ".1em", textTransform: "uppercase" }}>Design Concept</div>
                            </div>
                          ) : (
                            <img src={v.url || ""} alt={"Room visualization " + (i + 1)} loading="lazy" style={{ width: "100%", height: "auto", minHeight: 200, objectFit: "cover", display: "block", background: "#F0EBE4" }} />
                          )}
                          <div style={{ padding: "10px 16px", background: "#fff" }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#C17550", margin: 0 }}>{v.label || ["Morning Light", "Golden Hour", "Evening Ambiance"][i] || "Variation " + (i + 1)}</p>
                            <p style={{ fontSize: 10, color: "#B8A898", margin: 0 }}>{room || "Room"} — {vibe || "Modern"}{roomPhotoAnalysis ? " — based on your room" : ""}{v.concept ? " — concept preview" : ""}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 10, color: "#B8A898", margin: "4px 0 0", textAlign: "center", fontStyle: "italic", lineHeight: 1.4 }}>AI-generated visualization — colors, patterns, and item placement may not be 100% accurate. Refer to individual product images for exact appearance.</p>
                  </>)}

                  {/* Pro Interactive Floor Plan Editor — below viz */}
                  {cadLayout && userPlan === "pro" && (
                    <div style={{ marginBottom: 24 }}>
                      <FloorPlanEditor
                        initialLayout={cadLayout}
                        items={selItems}
                        roomType={room || "Living Room"}
                        style={vibe || "Modern"}
                        roomWidthFt={roomW ? parseFloat(roomW) : undefined}
                        roomHeightFt={roomL ? parseFloat(roomL) : undefined}
                        isFullScreen={false}
                        onSave={(state) => { setFloorPlanState(state); setEditorFullScreen(true); }}
                        savedState={floorPlanState}
                      />
                      <div style={{ marginTop: 12, padding: "14px 18px", background: "#F8F5F0", borderRadius: 12, border: "1px solid #E8E0D8" }}>
                        <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#C17550", fontWeight: 700, marginBottom: 8 }}>Placement Notes</p>
                        <p style={{ fontSize: 12, color: "#5A5045", lineHeight: 1.7, margin: 0 }}>{((ROOM_NEEDS as Record<string, RoomNeed>)[room as string] || ROOM_NEEDS["Living Room"]).layout}</p>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
                          <span style={{ fontSize: 11, color: "#7A6B5B" }}>Floor area: {cadLayout.roomW}' x {cadLayout.roomH}'</span>
                          <span style={{ fontSize: 11, color: "#7A6B5B" }}>Furniture footprint: {cadLayout.placed.filter(p => !["rug","art","light"].includes(p.item.c)).length} floor items</span>
                          <span style={{ fontSize: 11, color: "#7A6B5B" }}>Wall items: {cadLayout.placed.filter(p => ["art","light"].includes(p.item.c)).length}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Pro Upsell — only for non-Pro users */}
                  {userPlan !== "pro" && sel.size >= 3 && (
                    <div style={{ marginBottom: 24, padding: "20px 24px", background: "linear-gradient(135deg, #F8F0E8, #F0E8E0)", borderRadius: 16, border: "1px solid #E8D8C8", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#8B6040", margin: 0 }}>See where every piece goes</p>
                        <p style={{ fontSize: 12, color: "#A08060", margin: "4px 0 0" }}>Pro users get AI-generated floor plans with exact furniture placement, clearances, and traffic flow.</p>
                      </div>
                      <button onClick={() => go("pricing")} style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Upgrade to Pro</button>
                    </div>
                  )}

                  {/* Selected items grid */}
                  <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10, marginBottom: 24 }}>
                    {selItems.map((p) => (
                      <Card key={p.id} p={p} sel toggle={toggle} small />
                    ))}
                  </div>

                  {/* Continue to Purchase */}
                  <div style={{ textAlign: "center", padding: "8px 0 12px" }}>
                    <button onClick={() => setDesignStep(3)} style={{ background: "#1A1815", color: "#fff", padding: "14px 36px", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Continue to Purchase →</button>
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

              {/* ═══════ STEP 3: PURCHASE ═══════ */}
              {designStep === 3 && (
                <div>
                  {/* Back bar */}
                  <div style={{ padding: "10px 5%", background: "#fff", borderBottom: "1px solid #EDE8E0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1815", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{room || "Room"}</span>
                      <span style={{ fontSize: 12, color: "#9B8B7B", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{vibe || "Style"}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1815", background: "#F5F0EB", padding: "4px 12px", borderRadius: 6 }}>{selCount} items</span>
                    </div>
                    <button onClick={() => setDesignStep(2)} style={{ background: "none", border: "1px solid #E8E0D8", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#9B8B7B", cursor: "pointer", fontFamily: "inherit" }}>{"←"} Visualize</button>
                  </div>

                  {sel.size > 0 ? (
                  <div style={{ padding: "28px 5%", background: "#FDFCFA" }}>
                    {/* Purchase List */}
                    <div className="aura-purchase-table" style={{ background: "#fff", borderRadius: 16, border: "1px solid #E8E0D8", overflow: "hidden" }}>
                      <div style={{ padding: "20px 24px", borderBottom: "1px solid #F0EBE4", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                        <div>
                          <h2 style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 400, color: "#1A1815", margin: 0 }}>Purchase List</h2>
                          <p style={{ fontSize: 12, color: "#9B8B7B", margin: "4px 0 0" }}>{selCount} items from {[...new Set(selItems.map(p => p.r))].length} retailers · Click "Buy" to open each product page</p>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <p style={{ fontSize: 24, fontWeight: 700, color: "#1A1815", margin: 0, fontFamily: "Georgia,serif" }}>{fmt(selTotal)}</p>
                          <p style={{ fontSize: 11, color: "#9B8B7B", margin: 0 }}>estimated total</p>
                        </div>
                      </div>
                      {/* Table header */}
                      <div className="aura-purchase-header" style={{ display: "grid", gridTemplateColumns: "52px 1fr 100px 100px 80px 80px 72px", gap: 8, padding: "10px 20px", borderBottom: "1px solid #F0EBE4", background: "#FAFAF8" }}>
                        {["", "Product", "Retailer", "Qty", "Price", "Total", ""].map((h, i) => (
                          <span key={i} style={{ fontSize: 10, fontWeight: 600, color: "#9B8B7B", letterSpacing: ".08em", textTransform: "uppercase" }}>{h}</span>
                        ))}
                      </div>
                      {/* Product rows */}
                      {selItems.map((p, idx) => {
                        const qty = sel.get(p.id) || 1;
                        const lineTotal = p.p * qty;
                        return (
                          <div key={p.id} className="aura-purchase-row" style={{ display: "grid", gridTemplateColumns: "52px 1fr 100px 100px 80px 80px 72px", gap: 8, padding: "12px 20px", borderBottom: idx < selItems.length - 1 ? "1px solid #F5F2ED" : "none", alignItems: "center", transition: "background .15s" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#FAFAF8"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            {/* Thumbnail */}
                            <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", border: "1px solid #EDE8E2" }}>
                              <img src={p.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} referrerPolicy="no-referrer" loading="lazy" />
                            </div>
                            {/* Name + category */}
                            <div style={{ padding: "0 10px", overflow: "hidden" }}>
                              <p style={{ fontSize: 13, fontWeight: 500, color: "#1A1815", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</p>
                              <p style={{ fontSize: 10, color: "#B8A898", margin: 0, textTransform: "capitalize" }}>{p.c}</p>
                            </div>
                            {/* Retailer */}
                            <span className="aura-purchase-retailer" style={{ fontSize: 11, color: "#7A6B5B" }}>{p.r}</span>
                            {/* Quantity — clean inline stepper */}
                            <div className="aura-purchase-qty" style={{ display: "inline-flex", alignItems: "center", border: "1px solid #E8E0D8", borderRadius: 6, overflow: "hidden", height: 26, width: "fit-content" }}>
                              <button onClick={() => setQty(p.id, qty - 1)} style={{ width: 26, height: 26, border: "none", borderRight: "1px solid #E8E0D8", background: "#FAFAF8", fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "#5A5045", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>−</button>
                              <span style={{ width: 24, textAlign: "center", fontSize: 12, fontWeight: 600, color: "#1A1815" }}>{qty}</span>
                              <button onClick={() => setQty(p.id, qty + 1)} style={{ width: 26, height: 26, border: "none", borderLeft: "1px solid #E8E0D8", background: "#FAFAF8", fontSize: 13, cursor: "pointer", fontFamily: "inherit", color: "#5A5045", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>+</button>
                            </div>
                            {/* Unit price */}
                            <span className="aura-purchase-unit" style={{ fontSize: 12, color: "#7A6B5B" }}>{fmt(p.p)}</span>
                            {/* Line total */}
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1815" }}>{fmt(lineTotal)}</span>
                            {/* Buy button */}
                            <a href={p.u} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("buy_click", { product: p.n, retailer: p.r, price: p.p })} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#C17550", color: "#fff", fontSize: 11, fontWeight: 600, padding: "6px 14px", borderRadius: 6, textDecoration: "none", whiteSpace: "nowrap" }}>Buy →</a>
                          </div>
                        );
                      })}
                      {/* Total footer */}
                      <div className="aura-purchase-footer" style={{ display: "grid", gridTemplateColumns: "52px 1fr 100px 100px 80px 80px 72px", gap: 8, padding: "16px 20px", borderTop: "2px solid #E8E0D8", background: "#FAFAF8" }}>
                        <span />
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1815", padding: "0 10px" }}>Total ({selCount} items)</span>
                        <span className="aura-purchase-retailer" style={{ fontSize: 11, color: "#9B8B7B" }}>{[...new Set(selItems.map(p => p.r))].length} retailers</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#5A5045" }}>{selItems.reduce((s, p) => s + (sel.get(p.id) || 1), 0)}</span>
                        <span className="aura-purchase-unit" />
                        <span style={{ fontSize: 16, fontWeight: 700, color: "#1A1815", fontFamily: "Georgia,serif" }}>{fmt(selTotal)}</span>
                        <span />
                      </div>
                    </div>
                  </div>
                  ) : (
                    <div style={{ padding: "80px 5%", textAlign: "center" }}>
                      <p style={{ fontSize: 14, color: "#9B8B7B" }}>No items selected yet.</p>
                      <button onClick={() => setDesignStep(1)} style={{ background: "#1A1815", color: "#fff", padding: "14px 28px", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 16 }}>{"←"} Back to Design</button>
                    </div>
                  )}
                </div>
              )}

          </div>
          )}

          {/* FEATURED CATALOG TAB */}
          {tab === "catalog" && (
            <div style={{ padding: "28px 5%" }}>
              <div className="aura-catalog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 14 }}>
                <div>
                  <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>Featured Catalog</p>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400 }}>{filteredDB.length} products</h2>
                  <p style={{ fontSize: 13, color: "#9B8B7B", marginTop: 6, lineHeight: 1.5 }}>Out of 100,000+ products available, here are some of our featured picks — hand-selected by designers for quality and style.</p>
                </div>
                <input className="aura-catalog-search" value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setPage(0); }} placeholder="Search products or brands..." style={{ background: "#fff", border: "1px solid #E8E0D8", borderRadius: 12, padding: "12px 18px", fontFamily: "inherit", fontSize: 13, outline: "none", width: 280, maxWidth: "100%", boxSizing: "border-box" }} />
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

          {/* CATALOG TAB (External Products) */}
          {tab === "featured" && (
            <div style={{ padding: "28px 5%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 14 }}>
                <div>
                  <p style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#C17550", fontWeight: 600, marginBottom: 6 }}>Catalog</p>
                  <h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 400 }}>
                    {featuredLoading && featuredProducts.length === 0 ? "Searching..." : "100,000+ products from top brands"}
                  </h2>
                </div>
                <form className="aura-ext-search" onSubmit={(e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); doFeaturedSearch(featuredQuery, featuredCat, 1); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={featuredQuery} onChange={(e) => setFeaturedQuery(e.target.value)} placeholder="Search furniture from all retailers..." style={{ background: "#fff", border: "1px solid #E8E0D8", borderRadius: 12, padding: "12px 18px", fontFamily: "inherit", fontSize: 13, outline: "none", width: 260, maxWidth: "100%", boxSizing: "border-box", flex: "1 1 200px" }} />
                  <button type="submit" style={{ background: "#C17550", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Search</button>
                </form>
              </div>
              {/* Category pills */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                {featuredCats.map((ct) => <Pill key={ct.id} active={featuredCat === ct.id} onClick={() => { setFeaturedCat(ct.id); doFeaturedSearch(featuredQuery, ct.id, 1); }}>{ct.n}</Pill>)}
              </div>
              {/* Retailer badges */}
              {featuredRetailers.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#B8A898", fontWeight: 500 }}>From:</span>
                  {featuredRetailers.slice(0, 12).map((r) => (
                    <span key={r} style={{ fontSize: 10, background: "#F8F5F0", color: "#7A6B5B", padding: "4px 10px", borderRadius: 20, fontWeight: 500, border: "1px solid #EDE8E2" }}>{r}</span>
                  ))}
                  {featuredRetailers.length > 12 && <span style={{ fontSize: 10, color: "#B8A898" }}>+{featuredRetailers.length - 12} more</span>}
                </div>
              )}
              {/* Loading state */}
              {featuredLoading && featuredProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: "80px 0" }}>
                  <div style={{ width: 32, height: 32, border: "3px solid #E8E0D8", borderTopColor: "#C17550", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                  <p style={{ color: "#9B8B7B", fontSize: 14 }}>Searching thousands of products across hundreds of brands...</p>
                </div>
              )}
              {/* Product grid */}
              {featuredProducts.length > 0 && (
                <div className="aura-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14 }}>
                  {featuredProducts.map((p) => <Card key={p.id} p={p} sel={sel.has(p.id)} toggle={toggle} />)}
                </div>
              )}
              {/* No results */}
              {!featuredLoading && featuredProducts.length === 0 && featuredQuery && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                  <p style={{ fontSize: 14, color: "#9B8B7B" }}>No products found for "{featuredQuery}". Try a different search.</p>
                </div>
              )}
              {/* Load more */}
              {featuredProducts.length > 0 && featuredProducts.length < featuredTotal && (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <button
                    onClick={() => doFeaturedSearch(featuredQuery, featuredCat, featuredPage + 1)}
                    disabled={featuredLoading}
                    style={{ background: "#1A1815", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 13, fontWeight: 600, cursor: featuredLoading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: featuredLoading ? 0.6 : 1 }}
                  >
                    {featuredLoading ? "Loading..." : "Load more products"}
                  </button>
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
                          <input autoFocus defaultValue={pr.name} onBlur={(e) => renameProject(pr.id, e.currentTarget.value || pr.name)} onKeyDown={(e) => { if (e.key === "Enter") renameProject(pr.id, e.currentTarget.value || pr.name); if (e.key === "Escape") setEditingProjectName(null); }} style={{ fontFamily: "Georgia,serif", fontSize: 17, border: "1px solid #C17550", borderRadius: 8, padding: "4px 10px", width: "100%", outline: "none", boxSizing: "border-box" }} />
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
          </>
          )}
        </div>
      )}

      {/* FULLSCREEN FLOOR PLAN EDITOR — component manages its own fixed positioning */}
      {editorFullScreen && cadLayout && (
        <FloorPlanEditor
          initialLayout={cadLayout}
          items={selItems}
          roomType={room || "Living Room"}
          style={vibe || "Modern"}
          roomWidthFt={roomW ? parseFloat(roomW) : undefined}
          roomHeightFt={roomL ? parseFloat(roomL) : undefined}
          isFullScreen={true}
          onClose={() => setEditorFullScreen(false)}
          onSave={(state) => { setFloorPlanState(state); }}
          savedState={floorPlanState}
        />
      )}

      {/* SIGNUP POPUP (Cal AI style) */}
      {showSignupPopup && !user && pg === "home" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", animation: "fadeUp .3s ease" }} onClick={() => { setShowSignupPopup(false); setPopupDismissed(true); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: "40px 36px", maxWidth: 420, width: "90%", textAlign: "center", position: "relative", boxShadow: "0 24px 80px rgba(0,0,0,.25)" }}>
            <button onClick={() => { setShowSignupPopup(false); setPopupDismissed(true); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9B8B7B", fontFamily: "inherit", lineHeight: 1 }}>&times;</button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 20 }}><AuraLogo size={28} /><span style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 400 }}>AURA</span></div>
            <h3 style={{ fontSize: 24, fontWeight: 700, color: "#1A1815", marginBottom: 8, letterSpacing: "-0.02em" }}>Design your dream room</h3>
            <p style={{ fontSize: 14, color: "#7A6B5B", marginBottom: 24, lineHeight: 1.5 }}>Get AI-curated furniture picks, photorealistic visualizations, and shoppable mood boards — from 100,000+ products.</p>
            <button onClick={() => { setShowSignupPopup(false); setPopupDismissed(true); go("auth"); }} style={{ width: "100%", padding: "15px", background: "#1A1815", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "opacity .2s" }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>Sign Up</button>
            <p style={{ fontSize: 11, color: "#B8A898", marginTop: 16 }}>100,000+ products · 200+ retailers</p>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <Footer go={go} setTab={setTab} adminAuthed={adminAuthed} />
    </div>
  );
}

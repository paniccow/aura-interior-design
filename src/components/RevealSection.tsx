import { useRef, useState, useEffect } from "react";
import type React from "react";

export function useScrollReveal(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
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

interface RevealSectionProps { children: React.ReactNode; delay?: number; style?: React.CSSProperties; }

export default function RevealSection({ children, delay, style }: RevealSectionProps) {
  const [ref, vis] = useScrollReveal();
  return (
    <div ref={ref} style={{ ...style, opacity: vis ? 1 : 0, transform: vis ? "translateY(0)" : "translateY(40px)", transition: "opacity .8s ease " + (delay || 0) + "s, transform .8s ease " + (delay || 0) + "s" }}>
      {children}
    </div>
  );
}

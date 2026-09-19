// Reveal.tsx — scroll-triggered entrance. IntersectionObserver adds .is-in
// once; content is never hidden from assistive tech (opacity-only reveal,
// and reduced-motion CSS forces the end state).
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}

export default function Reveal({ children, delay = 0, className = "", as = "div" }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as "div";
  const style = { "--reveal-delay": `${delay}ms` } as CSSProperties;
  return (
    <Tag ref={ref} className={`tl-reveal ${className}`} style={style}>
      {children}
    </Tag>
  );
}

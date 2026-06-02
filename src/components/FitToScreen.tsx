'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Scales its child UP to fill the available area (so games use the whole screen,
// especially in fullscreen) without ever shrinking below natural size. Pure
// visual transform — layout/clicks are unaffected; text softens slightly when
// enlarged past native size (a per-game reflow gives crispness where it matters).
export default function FitToScreen({
  children,
  maxScale = 1.85,
  minScale = 1,
  heightCss = 'calc(100dvh - 7rem)',
}: {
  children: ReactNode;
  maxScale?: number;
  minScale?: number;
  heightCss?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current, inner = innerRef.current;
    if (!outer || !inner) return;
    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // offsetWidth/Height are the UNSCALED layout size (transforms don't
        // affect them), so this never feeds back on itself.
        const cw = inner.offsetWidth, ch = inner.offsetHeight;
        const aw = outer.clientWidth, ah = outer.clientHeight;
        if (!cw || !ch || !aw || !ah) return;
        const s = Math.max(minScale, Math.min(maxScale, Math.min(aw / cw, ah / ch)));
        setScale(prev => (Math.abs(prev - s) > 0.01 ? s : prev));
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      cancelAnimationFrame(raf);
    };
  }, [maxScale, minScale]);

  return (
    <div
      ref={outerRef}
      style={{ width: '100%', height: heightCss, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}
    >
      <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top center', willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}

'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Site-wide game viewport. Treats a game as a fixed-aspect canvas and scales it
// UP or DOWN to fit the available area, preserving aspect and letterboxing the
// spare dimension (so we design ~16:9 and fill whatever the device gives us).
//
// - `designWidth`: the game's logical width. Required for full-width games
//   (whose content would otherwise stretch to fill); omit for games that have
//   their own intrinsic max-width (we measure it).
// - Bounded by [minScale, maxScale] so tiny games don't become billboards and
//   text never shrinks to unreadable; below the floor it scrolls instead.
//
// Pure visual transform — layout and click targets are unaffected. (Crispness:
// scaling up softens text slightly; per-game rem layouts can opt out later.)
export default function GameViewport({
  children,
  designWidth,
  minScale = 0.35,
  maxScale = 2.2,
  heightCss = 'calc(100dvh - 6.5rem)',
}: {
  children: ReactNode;
  designWidth?: number;
  minScale?: number;
  maxScale?: number;
  heightCss?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, w: designWidth ?? 0, h: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current, inner = innerRef.current;
    if (!outer || !inner) return;
    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // offsetWidth/Height are the UNSCALED layout size (transforms don't
        // affect them), so this never feeds back on itself.
        const cw = designWidth ?? inner.offsetWidth;
        const ch = inner.offsetHeight;
        const aw = outer.clientWidth, ah = outer.clientHeight;
        if (!cw || !ch || !aw || !ah) return;
        const s = Math.max(minScale, Math.min(maxScale, Math.min(aw / cw, ah / ch)));
        setBox(prev => (Math.abs(prev.scale - s) > 0.004 || prev.w !== cw || prev.h !== ch ? { scale: s, w: cw, h: ch } : prev));
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(outer);
    ro.observe(inner);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); cancelAnimationFrame(raf); };
  }, [designWidth, minScale, maxScale]);

  return (
    <div
      ref={outerRef}
      style={{ width: '100%', height: heightCss, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {/* Sizer reserves the SCALED footprint so the transformed game centers and
          the scroll area is correct. */}
      <div style={{ width: box.w * box.scale, height: box.h * box.scale, flexShrink: 0 }}>
        <div
          ref={innerRef}
          style={{
            width: designWidth ?? 'max-content',
            transform: `scale(${box.scale})`,
            transformOrigin: 'top left',
            willChange: 'transform',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

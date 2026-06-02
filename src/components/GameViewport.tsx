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
// Pure visual transform — layout and click targets are unaffected.
//
// Crispness: downscaling re-rasterizes sharp, but UPSCALING past native can't
// add detail and softens text — so maxScale defaults to 1 (render at native or
// smaller, letterbox the spare room). Reading the cards/rules matters more than
// filling every pixel. Pure-shape games with no dense text can opt into a higher
// maxScale to fill space (their vectors scale crisply).
export default function GameViewport({
  children,
  designWidth,
  minScale = 0.35,
  maxScale = 1,
  heightCss = 'calc(100dvh - 7.5rem)',
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
        // Leave a little breathing room so the default state never quite fills
        // the area (no rounding-overflow scrollbar / edge clipping).
        const PAD = 14;
        const aw = outer.clientWidth - PAD, ah = outer.clientHeight - PAD;
        if (!cw || !ch || aw <= 0 || ah <= 0) return;
        let s = Math.max(minScale, Math.min(maxScale, Math.min(aw / cw, ah / ch)));
        // Snap near-1 scales to exactly 1 so games that roughly fit natively
        // render crisp (no transform) instead of softly at ~1.04x.
        if (Math.abs(s - 1) < 0.06) s = 1;
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
      // `safe center` keeps it centered when it fits but falls back to the
      // start edge when it overflows (e.g. Recent Actions expanded), so the
      // content is never clipped and stays scroll-reachable.
      style={{ width: '100%', height: heightCss, overflow: 'auto', display: 'flex', alignItems: 'safe center', justifyContent: 'safe center' }}
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
            // NOTE: deliberately no `will-change: transform`. That hint promotes
            // the board to a composited layer that's rasterized once at native
            // size then bitmap-downscaled (blurry at scale < 1). Our transform is
            // static (recomputed only on resize, never animated), so omitting it
            // lets the browser re-rasterize crisply at the effective scale.
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

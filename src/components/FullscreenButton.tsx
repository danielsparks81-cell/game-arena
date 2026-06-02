'use client';

import { useEffect, useState } from 'react';

// Toggle the browser's Fullscreen API for instant max screen space on any
// page / game. (Separate from installing the PWA, which gives a standalone
// window — this works immediately in a normal browser tab.)
export default function FullscreenButton() {
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const onChange = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={fs ? 'Exit full screen' : 'Full screen'}
      aria-label={fs ? 'Exit full screen' : 'Full screen'}
      className="rounded-md border border-neutral-700 px-2 py-1 text-sm text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
    >
      {fs ? '🗗' : '⛶'}
    </button>
  );
}

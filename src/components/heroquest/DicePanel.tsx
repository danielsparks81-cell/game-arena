'use client';

// Dice display panel — shows the last combat roll with animated dice.
// Roll is keyed by `lastRoll` reference so the spin animation runs on each
// new roll.

import { useEffect, useState } from 'react';
import { type DiceRoll, type DieFace } from '@/lib/games/heroquest';
import { CombatDie } from './Art';

export default function DicePanel({ roll }: { roll: DiceRoll | null }) {
  // Animate dice when a new roll arrives: render `null` faces briefly then
  // settle on the actual face. Keying off roll reference forces remount.
  const [showFaces, setShowFaces] = useState(false);
  useEffect(() => {
    if (!roll) return;
    setShowFaces(false);
    const t = setTimeout(() => setShowFaces(true), 350);
    return () => clearTimeout(t);
  }, [roll]);

  if (!roll) {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-neutral-900 px-3 py-2 text-xs text-amber-200/40 text-center">
        No combat yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-900/50 bg-gradient-to-b from-amber-950/40 to-black p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-amber-200/80" style={{ fontFamily: 'serif' }}>
          {roll.rolledBy === 'hero' ? 'Hero attack' : 'Monster attack'}
        </div>
        <div className="flex gap-2 text-[10px] uppercase tracking-wider">
          <span className="text-rose-300">{roll.skulls} hit{roll.skulls !== 1 ? 's' : ''}</span>
          <span className="text-sky-300">{roll.blocks} block{roll.blocks !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {roll.faces.map((f, i) => (
          <DieRoller key={`${roll.faces.length}-${i}`} face={f} show={showFaces} index={i} />
        ))}
      </div>
    </div>
  );
}

function DieRoller({ face, show, index }: { face: DieFace; show: boolean; index: number }) {
  // While "rolling", flicker through random faces for a moment.
  const [flicker, setFlicker] = useState<DieFace | null>('skull');
  useEffect(() => {
    if (show) return;
    const faces: DieFace[] = ['skull', 'skull', 'skull', 'white_shield', 'white_shield', 'black_shield'];
    const interval = setInterval(() => {
      setFlicker(faces[Math.floor(Math.random() * faces.length)]);
    }, 65);
    return () => clearInterval(interval);
  }, [show]);

  return (
    <div
      style={{
        transform: show
          ? 'rotate(0deg) scale(1)'
          : `rotate(${(Math.random() - 0.5) * 60}deg) scale(1.1)`,
        transition: show ? `transform 0.25s ${index * 0.05}s ease-out` : undefined,
      }}
    >
      <CombatDie face={show ? face : flicker} size={48} />
    </div>
  );
}

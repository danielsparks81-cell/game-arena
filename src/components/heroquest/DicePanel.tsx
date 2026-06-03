'use client';

// Dice display panel — shows the most recent roll: movement (3d4 number dice),
// or a combat exchange (the attacker's dice + the defender's dice). Animated.

import { useEffect, useState } from 'react';
import { type DiceRoll, type DieFace } from '@/lib/games/heroquest';
import { CombatDie } from './Art';

export default function DicePanel({
  attack, defense, move,
}: {
  attack: DiceRoll | null;
  defense: DiceRoll | null;
  move: number[] | null;
}) {
  // Movement roll takes priority — it's the most recent thing that happened.
  if (move && move.length > 0) {
    const total = move.reduce((a, b) => a + b, 0);
    return (
      <div className="rounded-lg border border-amber-900/50 bg-gradient-to-b from-amber-950/40 to-black p-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-amber-200/80" style={{ fontFamily: 'serif' }}>Movement</div>
          <div className="text-[10px] uppercase tracking-wider text-amber-200/90">{total} squares</div>
        </div>
        <div className="flex items-center justify-center gap-2">
          {move.map((n, i) => <NumberDie key={i} n={n} />)}
        </div>
      </div>
    );
  }

  if (!attack) {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-neutral-900 px-3 py-2 text-xs text-amber-200/40 text-center">
        Roll movement or attack to see the dice here.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-900/50 bg-gradient-to-b from-amber-950/40 to-black p-2">
      <CombatRow label={attack.rolledBy === 'hero' ? 'Hero attack' : 'Monster attack'} roll={attack} metric="skulls" />
      {defense && (
        <CombatRow label={defense.rolledBy === 'hero' ? 'Hero defend' : 'Monster defend'} roll={defense} metric="blocks" />
      )}
    </div>
  );
}

function CombatRow({ label, roll, metric }: { label: string; roll: DiceRoll; metric: 'skulls' | 'blocks' }) {
  // Re-run the spin whenever this roll changes.
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(false);
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, [roll]);
  const count = metric === 'skulls' ? roll.skulls : roll.blocks;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-amber-200/80" style={{ fontFamily: 'serif' }}>{label}</div>
        <div className="text-[10px] uppercase tracking-wider">
          {metric === 'skulls'
            ? <span className="text-rose-300">{count} hit{count !== 1 ? 's' : ''}</span>
            : <span className="text-sky-300">{count} block{count !== 1 ? 's' : ''}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {roll.faces.map((f, i) => <DieRoller key={`${roll.faces.length}-${i}`} face={f} show={show} index={i} />)}
      </div>
    </div>
  );
}

/** A movement (d4) die — a plain numbered face. */
function NumberDie({ n }: { n: number }) {
  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-md border-2 border-amber-700/70 bg-gradient-to-br from-amber-900/40 to-black text-lg font-bold text-amber-100"
      style={{ fontFamily: 'Georgia, serif' }}
    >
      {n}
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
      <CombatDie face={show ? face : flicker} size={40} />
    </div>
  );
}

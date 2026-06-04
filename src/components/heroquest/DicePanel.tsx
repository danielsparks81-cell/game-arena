'use client';

// Dice display panel — shows the most recent roll: movement (3d4 number dice),
// or a combat exchange (the attacker's dice + the defender's dice). Animated.

import { useEffect, useRef, useState } from 'react';
import { type DiceRoll, type DieFace } from '@/lib/games/heroquest';
import { CombatDie } from './Art';

const FACE_POOL: DieFace[] = ['skull', 'skull', 'skull', 'white_shield', 'white_shield', 'black_shield'];

/** Big roll animation that pops up over the board whenever new dice are rolled
 *  (movement, attack, defense, spell) and then slides down toward the dice
 *  panel. Detects a new roll by a signature of the roll values. Render this
 *  INSIDE a `relative` container over the board. */
export function DiceRollOverlay({ attack, defense, move }: {
  attack: DiceRoll | null;
  defense: DiceRoll | null;
  move: number[] | null;
}) {
  // Derive stable PRIMITIVES for the effect deps. Using the roll objects/arrays
  // directly would re-run the effect on every state poll (they're new refs each
  // render), whose cleanup would cancel the timeouts mid-animation and leave it
  // stuck. A string signature + boolean only change when the roll actually does.
  const hasRoll = (!!move && move.length > 0) || !!attack || !!defense;
  const sig = JSON.stringify([move, attack?.faces ?? null, defense?.faces ?? null]);
  const prev = useRef<string>('');
  const first = useRef(true);
  const [phase, setPhase] = useState<'idle' | 'rolling' | 'settled' | 'leaving'>('idle');

  useEffect(() => {
    // Don't replay an existing roll when the board first mounts (e.g. on reconnect).
    if (first.current) { first.current = false; prev.current = sig; return; }
    if (!hasRoll || sig === prev.current) return;
    prev.current = sig;
    setPhase('rolling');
    const t1 = setTimeout(() => setPhase('settled'), 650);
    const t2 = setTimeout(() => setPhase('leaving'), 1350);
    const t3 = setTimeout(() => setPhase('idle'), 1750);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [sig, hasRoll]);

  if (phase === 'idle') return null;
  const rolling = phase === 'rolling';
  const leaving = phase === 'leaving';
  const showMove = !!move && move.length > 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-black/35 transition-opacity duration-300"
        style={{ opacity: leaving ? 0 : 1 }}
      />
      <div
        className="relative flex flex-col items-center gap-3 transition-all duration-[400ms] ease-in"
        style={{
          transform: leaving ? 'translate(-34%, 70%) scale(0.35)' : 'scale(1)',
          opacity: leaving ? 0 : 1,
        }}
      >
        {showMove ? (
          <>
            <OverlayLabel text={`Movement — ${rolling ? '…' : move!.reduce((a, b) => a + b, 0)} squares`} />
            <div className="flex items-center gap-3">
              {move!.map((n, i) => <OverlayNumberDie key={i} n={n} rolling={rolling} delay={i * 0.06} />)}
            </div>
          </>
        ) : (
          <>
            {attack && (
              <div className="flex flex-col items-center gap-1.5">
                <OverlayLabel text={`${attack.rolledBy === 'hero' ? 'Attack' : 'Monster attack'} — ${rolling ? '…' : `${attack.skulls} hit${attack.skulls !== 1 ? 's' : ''}`}`} />
                <div className="flex items-center gap-2">
                  {attack.faces.map((f, i) => <OverlayCombatDie key={i} face={f} rolling={rolling} delay={i * 0.05} />)}
                </div>
              </div>
            )}
            {defense && (
              <div className="flex flex-col items-center gap-1.5">
                <OverlayLabel text={`${defense.rolledBy === 'hero' ? 'Defend' : 'Monster defend'} — ${rolling ? '…' : `${defense.blocks} block${defense.blocks !== 1 ? 's' : ''}`}`} sub />
                <div className="flex items-center gap-2">
                  {defense.faces.map((f, i) => <OverlayCombatDie key={i} face={f} rolling={rolling} delay={0.15 + i * 0.05} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OverlayLabel({ text, sub }: { text: string; sub?: boolean }) {
  return (
    <div
      className={`rounded-full border px-3 py-0.5 text-xs font-bold uppercase tracking-widest ${sub ? 'border-sky-400/60 bg-sky-950/60 text-sky-200' : 'border-amber-400/60 bg-amber-950/70 text-amber-100'}`}
      style={{ fontFamily: 'Georgia, serif' }}
    >
      {text}
    </div>
  );
}

function OverlayCombatDie({ face, rolling, delay }: { face: DieFace; rolling: boolean; delay: number }) {
  const [flick, setFlick] = useState<DieFace>('skull');
  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFlick(FACE_POOL[Math.floor(Math.random() * 6)]), 70);
    return () => clearInterval(id);
  }, [rolling]);
  return (
    <div
      className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]"
      style={{
        transform: rolling ? `rotate(${(delay * 980) % 50 - 25}deg)` : 'rotate(0deg)',
        transition: rolling ? undefined : `transform 0.35s ${delay}s cubic-bezier(.2,1.5,.4,1)`,
      }}
    >
      <CombatDie face={rolling ? flick : face} size={62} />
    </div>
  );
}

function OverlayNumberDie({ n, rolling, delay }: { n: number; rolling: boolean; delay: number }) {
  const [flick, setFlick] = useState(1);
  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFlick(1 + Math.floor(Math.random() * 4)), 70);
    return () => clearInterval(id);
  }, [rolling]);
  return (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-amber-500 bg-gradient-to-br from-amber-700 to-black text-3xl font-bold text-amber-50 drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]"
      style={{
        fontFamily: 'Georgia, serif',
        transform: rolling ? `rotate(${(delay * 760) % 36 - 18}deg)` : 'rotate(0deg)',
        transition: rolling ? undefined : `transform 0.35s ${delay}s cubic-bezier(.2,1.5,.4,1)`,
      }}
    >
      {rolling ? flick : n}
    </div>
  );
}

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

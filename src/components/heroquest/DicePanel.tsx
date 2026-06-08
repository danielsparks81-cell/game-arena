'use client';

// Dice display panel — shows the most recent roll: movement (3d4 number dice),
// or a combat exchange (the attacker's dice + the defender's dice). Animated.

import { useEffect, useRef, useState } from 'react';
import { type DiceRoll, type DieFace } from '@/lib/games/heroquest';
import { CombatDie } from './Art';

const FACE_POOL: DieFace[] = ['skull', 'skull', 'skull', 'white_shield', 'white_shield', 'black_shield'];

// ============================================================================
// Shared timing constants (ms) — must match calcBoardDelay in HeroQuestBoard
// ============================================================================

const INIT_SPIN  = 450;   // attack dice spin before first one lands
const PER_DIE    = 330;   // gap between each die settling
const ATK_BURST  = 550;   // skull burst shown after all attack dice settle
const DEF_INIT   = 350;   // defense dice spin before first one lands
const POST_DEF   = 300;   // pause after all defense dice settled
const LEAVE_DUR  = 450;   // leaving animation duration

/** Duration the board canvas must keep showing the pre-roll snapshot.
 *  Call with the number of faces in each roll group. */
export function calcBoardDelay(atkDice: number, defDice: number): number {
  const buf = 200;
  if (atkDice > 0 && defDice > 0) {
    return INIT_SPIN + atkDice * PER_DIE + ATK_BURST + DEF_INIT + defDice * PER_DIE + POST_DEF + LEAVE_DUR + buf;
  }
  if (atkDice > 0) {
    return INIT_SPIN + atkDice * PER_DIE + ATK_BURST + LEAVE_DUR + buf;
  }
  if (defDice > 0) {
    return DEF_INIT + defDice * PER_DIE + POST_DEF + LEAVE_DUR + buf;
  }
  return 0;
}

// ============================================================================
// Overlay — pops up over the board, reveals dice one at a time, then flies
// down to the persistent dice panel.
// ============================================================================

type Phase = 'idle' | 'atk' | 'burst' | 'def' | 'leaving';

/** Big roll animation that pops up over the board whenever new dice are rolled
 *  and then slides down toward the dice panel.  Render inside a `relative`
 *  container over the board. */
export function DiceRollOverlay({ attack, defense, move }: {
  attack:  DiceRoll | null;
  defense: DiceRoll | null;
  move:    number[] | null;
}) {
  const hasRoll = (!!move && move.length > 0) || !!attack || !!defense;
  const sig = JSON.stringify([move, attack?.faces ?? null, defense?.faces ?? null]);
  const prev  = useRef<string>('');
  const first = useRef(true);

  const [phase,       setPhase]       = useState<Phase>('idle');
  const [atkRevealed, setAtkRevealed] = useState(0);
  const [defRevealed, setDefRevealed] = useState(0);
  const moverRef = useRef<HTMLDivElement>(null);
  const [flyTo, setFlyTo] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (first.current) { first.current = false; prev.current = sig; return; }
    if (!hasRoll || sig === prev.current) return;
    prev.current = sig;

    const N = attack?.faces.length ?? 0;
    const M = defense?.faces.length ?? 0;
    const showMv  = !!move && move.length > 0;
    const onlyDef = !showMv && !attack && !!defense;
    const twoBeat = !showMv && !!attack && !!defense;

    const flyOut = () => {
      const el = moverRef.current, panel = document.getElementById('hq-dice-panel');
      if (el && panel) {
        const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
        setFlyTo({
          x: (p.left + p.width  / 2) - (r.left + r.width  / 2),
          y: (p.top  + p.height / 2) - (r.top  + r.height / 2),
        });
      }
      setPhase('leaving');
    };

    const ts: ReturnType<typeof setTimeout>[] = [];
    setAtkRevealed(0);
    setDefRevealed(0);

    if (showMv) {
      // Movement: all number dice settle together after initial spin
      setPhase('atk');
      ts.push(setTimeout(() => setAtkRevealed(N), INIT_SPIN));
      ts.push(setTimeout(flyOut, INIT_SPIN + ATK_BURST));
      ts.push(setTimeout(() => setPhase('idle'), INIT_SPIN + ATK_BURST + LEAVE_DUR));

    } else if (onlyDef) {
      // Defense-only (Fire of Wrath / Ball of Flame save roll — no hero attack dice)
      setPhase('def');
      for (let i = 0; i < M; i++) {
        const c = i + 1;
        ts.push(setTimeout(() => setDefRevealed(c), DEF_INIT + i * PER_DIE));
      }
      ts.push(setTimeout(flyOut, DEF_INIT + M * PER_DIE + POST_DEF));
      ts.push(setTimeout(() => setPhase('idle'), DEF_INIT + M * PER_DIE + POST_DEF + LEAVE_DUR));

    } else if (!twoBeat) {
      // Attack only (no defense dice)
      setPhase('atk');
      for (let i = 0; i < N; i++) {
        const c = i + 1;
        ts.push(setTimeout(() => setAtkRevealed(c), INIT_SPIN + i * PER_DIE));
      }
      ts.push(setTimeout(() => setPhase('burst'), INIT_SPIN + N * PER_DIE));
      ts.push(setTimeout(flyOut, INIT_SPIN + N * PER_DIE + ATK_BURST));
      ts.push(setTimeout(() => setPhase('idle'), INIT_SPIN + N * PER_DIE + ATK_BURST + LEAVE_DUR));

    } else {
      // Two-beat: attack dice one-by-one → burst → defense dice one-by-one
      setPhase('atk');
      for (let i = 0; i < N; i++) {
        const c = i + 1;
        ts.push(setTimeout(() => setAtkRevealed(c), INIT_SPIN + i * PER_DIE));
      }
      const burstAt  = INIT_SPIN + N * PER_DIE;
      const defAt    = burstAt + ATK_BURST;
      ts.push(setTimeout(() => setPhase('burst'), burstAt));
      ts.push(setTimeout(() => setPhase('def'),   defAt));
      for (let i = 0; i < M; i++) {
        const c = i + 1;
        ts.push(setTimeout(() => setDefRevealed(c), defAt + DEF_INIT + i * PER_DIE));
      }
      const allDone = defAt + DEF_INIT + M * PER_DIE;
      ts.push(setTimeout(flyOut, allDone + POST_DEF));
      ts.push(setTimeout(() => setPhase('idle'), allDone + POST_DEF + LEAVE_DUR));
    }

    return () => ts.forEach(clearTimeout);
  }, [sig, hasRoll]);

  if (phase === 'idle') return null;

  const leaving   = phase === 'leaving';
  const showMv    = !!move && move.length > 0;
  const atkRolling = phase === 'atk';
  const defRolling = phase === 'def';

  // Attack burst is shown during 'burst', 'def', and 'leaving' phases
  const showBurst = !showMv && !!attack && (phase === 'burst' || phase === 'def' || phase === 'leaving');
  const showDef   = (phase === 'def' || phase === 'leaving') && !!defense;

  // Running skull count: increases as each attack die lands
  const skullsSoFar = attack ? attack.faces.slice(0, atkRevealed).filter(f => f === 'skull').length : 0;
  const atkCountStr =
    phase !== 'atk'
      ? `${attack?.skulls ?? 0} hit${(attack?.skulls ?? 0) !== 1 ? 's' : ''}`
      : atkRevealed === 0
        ? '…'
        : `${skullsSoFar} hit${skullsSoFar !== 1 ? 's' : ''}`;

  // Running block count: increases as each defense die lands
  const blocksSoFar = defense ? defense.faces.slice(0, defRevealed).filter(f => f !== 'skull').length : 0;
  const defCountStr =
    !defRolling
      ? `${defense?.blocks ?? 0} block${(defense?.blocks ?? 0) !== 1 ? 's' : ''}`
      : defRevealed === 0
        ? '…'
        : `${blocksSoFar} block${blocksSoFar !== 1 ? 's' : ''}`;

  const isCrit = !!attack && attack.skulls === attack.faces.length && attack.faces.length > 0 && attack.skulls > 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center overflow-hidden">
      <style>{`
        @keyframes hq-burst-pop {
          0%   { transform: scale(0.2); opacity: 0; }
          60%  { transform: scale(1.18); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes hq-crit-in {
          0%   { transform: translateY(10px) scale(0.8); opacity: 0; }
          100% { transform: translateY(0)    scale(1);   opacity: 1; }
        }
        @keyframes hq-crit-glow {
          0%   { text-shadow: 0 0 8px #f87171, 0 0 20px #f87171; }
          100% { text-shadow: 0 0 18px #fb923c, 0 0 40px #fb923c, 0 0 4px #fff; }
        }
        @keyframes hq-die-land {
          0%   { transform: scale(1.35) rotate(var(--spin)); }
          60%  { transform: scale(0.92) rotate(2deg); }
          100% { transform: scale(1)    rotate(0deg); }
        }
      `}</style>
      <div
        className="absolute inset-0 bg-black/35 transition-opacity duration-300"
        style={{ opacity: leaving ? 0 : 1 }}
      />
      <div
        ref={moverRef}
        className="relative flex flex-col items-center gap-3 transition-all duration-[450ms] ease-in"
        style={{
          transform: leaving ? `translate(${flyTo.x}px,${flyTo.y}px) scale(0.3)` : 'scale(1)',
          opacity: leaving ? 0 : 1,
        }}
      >
        {showMv ? (
          <>
            <OverlayLabel text={`Movement — ${atkRevealed === 0 ? '…' : move!.reduce((a, b) => a + b, 0)} squares`} />
            <div className="flex items-center gap-3">
              {move!.map((n, i) => (
                <OverlayNumberDie key={i} n={n} rolling={i >= atkRevealed} delay={i * 0.06} />
              ))}
            </div>
          </>
        ) : (
          <>
            {attack && (
              <div className="flex flex-col items-center gap-1.5">
                <OverlayLabel
                  text={`${attack.rolledBy === 'hero' ? 'Attack' : 'Zargon attacks'} — ${atkCountStr}`}
                />
                <div className="flex items-center gap-2">
                  {attack.faces.map((f, i) => (
                    <OverlayCombatDie
                      key={i}
                      face={f}
                      rolling={atkRolling && i >= atkRevealed}
                      landing={atkRolling && i === atkRevealed - 1}
                      index={i}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Attack result burst — pops in once the burst phase starts */}
            {showBurst && (
              <div
                className="flex flex-col items-center gap-1"
                style={{ animation: 'hq-burst-pop 0.38s cubic-bezier(.2,1.4,.4,1) both' }}
              >
                <div
                  style={{
                    fontSize: 80,
                    lineHeight: 1,
                    fontFamily: 'Georgia, serif',
                    fontWeight: 900,
                    color: attack!.skulls === 0 ? '#94a3b8' : isCrit ? '#f87171' : '#fbbf24',
                    textShadow: isCrit
                      ? '0 0 18px #f87171, 0 0 40px #f87171'
                      : attack!.skulls > 0
                        ? '0 0 12px #f59e0b, 0 2px 6px rgba(0,0,0,0.8)'
                        : '0 2px 4px rgba(0,0,0,0.6)',
                  }}
                >
                  {attack!.skulls === 0 ? '–' : attack!.skulls}
                  <span style={{ fontSize: 48, marginLeft: 6 }}>
                    {attack!.skulls === 0 ? '🛡️' : '💀'}
                  </span>
                </div>
                {isCrit && (
                  <div
                    style={{
                      fontFamily: 'Georgia, serif',
                      fontWeight: 900,
                      fontSize: 18,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: '#f87171',
                      animation: 'hq-crit-in 0.25s 0.25s ease-out both, hq-crit-glow 0.6s 0.5s ease-in-out infinite alternate',
                    }}
                  >
                    ⚡ Critical Strike!! ⚡
                  </div>
                )}
                {attack!.skulls === 0 && (
                  <div
                    style={{
                      fontFamily: 'Georgia, serif',
                      fontSize: 15,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: '#94a3b8',
                    }}
                  >
                    No hits
                  </div>
                )}
              </div>
            )}

            {/* Defense dice — reveal one at a time (or fire_of_wrath save) */}
            {showDef && defense && (
              <div className="flex flex-col items-center gap-1.5">
                <OverlayLabel
                  text={`${defense.rolledBy === 'hero' ? 'Defend' : 'Monster defend'} — ${defCountStr}`}
                  sub
                />
                <div className="flex items-center gap-2">
                  {defense.faces.map((f, i) => (
                    <OverlayCombatDie
                      key={i}
                      face={f}
                      rolling={defRolling && i >= defRevealed}
                      landing={defRolling && i === defRevealed - 1}
                      index={i}
                    />
                  ))}
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
      className={`rounded-full border px-3 py-0.5 text-xs font-bold uppercase tracking-widest ${
        sub
          ? 'border-sky-400/60 bg-sky-950/60 text-sky-200'
          : 'border-amber-400/60 bg-amber-950/70 text-amber-100'
      }`}
      style={{ fontFamily: 'Georgia, serif' }}
    >
      {text}
    </div>
  );
}

/**
 * A single combat die in the overlay.
 * - `rolling`: still spinning (shows random flickering face)
 * - `landing`: just this moment settled (plays the bounce-in animation)
 * - Otherwise: settled and static.
 */
function OverlayCombatDie({
  face, rolling, landing, index,
}: {
  face: DieFace;
  rolling: boolean;
  landing: boolean;
  index: number;
}) {
  const [flick, setFlick] = useState<DieFace>('skull');
  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFlick(FACE_POOL[Math.floor(Math.random() * 6)]), 70);
    return () => clearInterval(id);
  }, [rolling]);

  // Deterministic tilt while spinning so each die leans a different way
  const spinAngle = `${((index * 137) % 60) - 30}deg`;

  return (
    <div
      className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]"
      style={
        rolling
          ? { transform: `rotate(${spinAngle})` }
          : landing
            ? ({
                '--spin': spinAngle,
                animation: 'hq-die-land 0.32s cubic-bezier(.2,1.4,.4,1) both',
              } as React.CSSProperties)
            : { transform: 'rotate(0deg)', transition: 'transform 0.25s ease-out' }
      }
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

// ============================================================================
// Persistent dice panel — sits below hero panels, shows settled result.
// ============================================================================

export default function DicePanel({
  attack, defense, move,
}: {
  attack:  DiceRoll | null;
  defense: DiceRoll | null;
  move:    number[] | null;
}) {
  const FRAME = 'flex min-h-[8.5rem] flex-col justify-center rounded-lg border border-amber-900/50 bg-gradient-to-b from-amber-950/40 to-black p-2';

  if (move && move.length > 0) {
    const total = move.reduce((a, b) => a + b, 0);
    return (
      <div className={FRAME}>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-amber-200/80" style={{ fontFamily: 'serif' }}>Movement</div>
          <div className="text-[10px] uppercase tracking-wider text-amber-200/90">{total} squares</div>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2">
          {move.map((n, i) => <NumberDie key={i} n={n} />)}
        </div>
      </div>
    );
  }

  if (!attack) {
    return (
      <div className={`${FRAME} items-center text-center text-xs text-amber-200/40`}>
        Roll movement or attack to see the dice here.
      </div>
    );
  }

  return (
    <div className={`${FRAME} gap-2`}>
      <CombatRow
        label={attack.rolledBy === 'hero' ? 'Hero attack' : 'Monster attack'}
        roll={attack}
        metric="skulls"
      />
      {defense && (
        <CombatRow
          label={defense.rolledBy === 'hero' ? 'Hero defend' : 'Monster defend'}
          roll={defense}
          metric="blocks"
        />
      )}
    </div>
  );
}

function CombatRow({ label, roll, metric }: { label: string; roll: DiceRoll; metric: 'skulls' | 'blocks' }) {
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
        {roll.faces.map((f, i) => (
          <DieRoller key={`${roll.faces.length}-${i}`} face={f} show={show} index={i} />
        ))}
      </div>
    </div>
  );
}

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

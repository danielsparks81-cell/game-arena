'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { sounds } from '@/lib/sounds';

type Report = {
  id: number;
  reporter_username: string | null;
  room_id: string | null;
  game_type: string | null;
  description: string;
  url: string | null;
  user_agent: string | null;
  created_at: string;
  read_at: string | null;
};

/**
 * Admin-only inbox. Shows a bug-icon button in the TopBar with an unread-count badge.
 * Subscribes to bug_reports inserts in realtime — pops a toast for each new one and
 * clicking the icon opens a dropdown with recent reports + "mark read" controls.
 * Renders nothing for non-admins.
 */
export default function BugInbox() {
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Report | null>(null);
  const [, startTransition] = useTransition();
  const seenIds = useRef<Set<number>>(new Set());

  // 1) Check whether the signed-in user is an admin. Silently bail if the
  //    `is_admin` column doesn't exist (i.e. migration 006 hasn't been run on
  //    this Supabase project) — without the catch the query throws a 400 on
  //    every page load and noisily logs to the console for every non-admin.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();
        if (error) return; // column or table missing — treat as non-admin
        if (!cancelled && profile && (profile as { is_admin?: boolean }).is_admin) {
          setIsAdmin(true);
        }
      } catch {
        // Network error or schema mismatch — non-admins simply don't get the inbox.
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // 2) Once we know the user is admin, load existing unread reports + subscribe to inserts
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const { data } = await supabase
        .from('bug_reports')
        .select('id, reporter_username, room_id, game_type, description, url, user_agent, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) {
        setReports(data as Report[]);
        (data as Report[]).forEach(r => seenIds.current.add(r.id));
      }
    };
    load();

    const ch = supabase
      .channel('bug-reports')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bug_reports' },
        (payload) => {
          const r = payload.new as Report;
          if (seenIds.current.has(r.id)) return;
          seenIds.current.add(r.id);
          setReports(prev => [r, ...prev]);
          setToast(r);
          try { sounds.notify(); } catch { /* no-op */ }
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, supabase]);

  // Auto-dismiss toast after a few seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const unreadCount = reports.filter(r => !r.read_at).length;

  const markRead = (id: number) => {
    setReports(prev => prev.map(r => r.id === id ? { ...r, read_at: new Date().toISOString() } : r));
    startTransition(async () => {
      await supabase.from('bug_reports').update({ read_at: new Date().toISOString() }).eq('id', id);
    });
  };

  const markAllRead = () => {
    const now = new Date().toISOString();
    const ids = reports.filter(r => !r.read_at).map(r => r.id);
    setReports(prev => prev.map(r => r.read_at ? r : { ...r, read_at: now }));
    startTransition(async () => {
      if (ids.length) await supabase.from('bug_reports').update({ read_at: now }).in('id', ids);
    });
  };

  if (!isAdmin) return null;

  return (
    <>
      {/* Bug icon button + badge */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Bug reports"
        aria-label="Bug reports"
        className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-sm hover:bg-neutral-800"
      >
        🐞
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-end p-3 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="mt-12 w-full max-w-md overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
              <span className="text-sm font-semibold">Bug reports</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800 disabled:opacity-40"
                >
                  Mark all read
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-neutral-800">
              {reports.length === 0 ? (
                <p className="p-4 text-center text-sm text-neutral-500">No reports yet.</p>
              ) : reports.map(r => (
                <div key={r.id} className={`p-3 text-sm ${r.read_at ? 'opacity-60' : ''}`}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-neutral-400">
                    <span>
                      <span className="font-medium text-emerald-400">{r.reporter_username ?? '(unknown)'}</span>
                      {r.game_type && <span> · {r.game_type}</span>}
                      <span className="ml-2 text-neutral-500">{formatTime(r.created_at)}</span>
                    </span>
                    {!r.read_at && (
                      <button
                        onClick={() => markRead(r.id)}
                        className="rounded border border-neutral-700 px-1.5 py-0 text-[10px] hover:bg-neutral-800"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-neutral-200">{r.description}</p>
                  {(r.url || r.room_id) && (
                    <p className="mt-1 break-all text-[10px] text-neutral-500">
                      {r.room_id && <>room <code>{r.room_id.slice(0, 8)}</code> · </>}
                      {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{r.url}</a>}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast for newly-arrived reports */}
      {toast && !open && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-toast-in">
          <button
            onClick={() => { setOpen(true); setToast(null); }}
            className="flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-red-500/40 bg-neutral-900 px-4 py-3 text-left shadow-xl shadow-red-500/20 hover:bg-neutral-800"
          >
            <span className="text-xl">🐞</span>
            <div className="min-w-0 text-sm">
              <div className="font-medium">
                Bug report from <span className="text-emerald-400">{toast.reporter_username ?? '(unknown)'}</span>
              </div>
              <div className="truncate text-xs text-neutral-400">{toast.description}</div>
            </div>
          </button>
        </div>
      )}
    </>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString();
}

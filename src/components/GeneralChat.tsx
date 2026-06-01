'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { safeAccent } from '@/lib/accentColors';

type Msg = {
  id: number;
  body: string;
  created_at: string;
  sender_id: string;
  profiles: { username: string; accent_color?: string | null } | null;
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

/**
 * Site-wide Global Chat. Reads from `general_chat_messages`.
 * Used both standalone in the lobby AND as the "Global" tab inside rooms.
 *
 * - `embedded`: suppress the outer border/rounded wrapper (used inside tab panel).
 * - `active`:   whether this chat is the currently-visible tab; controls unread tracking.
 * - `onUnread`: called with true when a new message arrives while active=false.
 */
export default function GeneralChat({
  currentUserId,
  currentUsername,
  currentUserAccent,
  embedded = false,
  active = true,
  onUnread,
}: {
  currentUserId: string;
  currentUsername: string;
  currentUserAccent?: string | null;
  embedded?: boolean;
  active?: boolean;
  onUnread?: (hasNew: boolean) => void;
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('general_chat_messages')
        .select('id, body, created_at, sender_id, profiles(username, accent_color)')
        .order('created_at', { ascending: true })
        .limit(100);
      if (data) setMessages(data as unknown as Msg[]);
    };
    load();
    const ch = supabase
      .channel('general-chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'general_chat_messages' },
        async (payload) => {
          const m = payload.new as { id: number; body: string; created_at: string; sender_id: string };
          const { data: prof } = await supabase
            .from('profiles')
            .select('username, accent_color')
            .eq('id', m.sender_id)
            .single();
          setMessages(prev => {
            if (prev.some(x => x.id === m.id)) return prev;
            // Signal unread only when this tab isn't active and the message isn't ours.
            if (!activeRef.current && m.sender_id !== currentUserId) onUnread?.(true);
            return [...prev, { ...m, profiles: prof ? { username: prof.username, accent_color: prof.accent_color } : null }];
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setPending(true);
    setDraft('');
    const { data, error: insErr } = await supabase
      .from('general_chat_messages')
      .insert({ sender_id: currentUserId, body })
      .select('id, body, created_at, sender_id')
      .single();
    setPending(false);
    if (insErr || !data) {
      setDraft(body);
      const code = insErr && 'code' in insErr ? (insErr as { code?: string }).code : undefined;
      if (code === '42P01') setError("Global chat isn't set up yet — apply migration 004_general_chat.sql.");
      else if (code === '42501') setError("You're not allowed to post here. Try signing out and back in.");
      else setError(insErr?.message ?? 'Send failed.');
      return;
    }
    setMessages(prev =>
      prev.some(x => x.id === data.id)
        ? prev
        : [...prev, { ...data, profiles: { username: currentUsername, accent_color: currentUserAccent ?? null } }],
    );
  };

  const msgList = (
    <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm">
      {messages.length === 0 && <p className="text-neutral-500">No messages yet. Say hi!</p>}
      {messages.map(m => {
        const accent = safeAccent(m.profiles?.accent_color ?? (m.sender_id === currentUserId ? currentUserAccent : null));
        return (
          <div key={m.id} className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-medium shrink-0" style={{ color: accent }}>{m.profiles?.username || '???'}:</span>
            <span className="text-neutral-200 break-words min-w-0 flex-1">{m.body}</span>
            <span className="ml-1 shrink-0 text-[10px] tabular-nums text-neutral-600">{formatTime(m.created_at)}</span>
          </div>
        );
      })}
    </div>
  );

  const inputBar = (
    <form className="flex gap-2 border-t border-neutral-800 p-2" onSubmit={onSubmit}>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={`Message as ${currentUsername}`}
        className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
      />
      <button type="submit" disabled={pending || !draft.trim()}
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50">
        {pending ? '…' : 'Send'}
      </button>
    </form>
  );

  if (embedded) {
    return (
      <>
        {msgList}
        {error && <p className="border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">{error}</p>}
        {inputBar}
      </>
    );
  }

  return (
    <aside className="flex h-80 flex-col rounded-xl border border-neutral-800 bg-neutral-900 lg:h-[360px]">
      <div className="border-b border-neutral-800 px-4 py-2 text-sm font-medium">Global Chat</div>
      {msgList}
      {error && <p className="border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">{error}</p>}
      {inputBar}
    </aside>
  );
}

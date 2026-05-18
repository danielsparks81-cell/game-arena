'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';

type Msg = {
  id: number;
  body: string;
  created_at: string;
  sender_id: string;
  profiles: { username: string } | null;
};

/**
 * Site-wide lobby chat. Reads from `general_chat_messages` and subscribes to inserts
 * via Supabase Realtime. Designed to slot under the MembersPanel in the lobby's right
 * column, mirroring the room-chat aside in RoomClient.
 */
export default function GeneralChat({
  currentUserId,
  currentUsername,
}: {
  currentUserId: string;
  currentUsername: string;
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial load + realtime subscription
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('general_chat_messages')
        .select('id, body, created_at, sender_id, profiles(username)')
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
            .select('username')
            .eq('id', m.sender_id)
            .single();
          setMessages(prev =>
            prev.some(x => x.id === m.id)
              ? prev
              : [...prev, { ...m, profiles: prof ? { username: prof.username } : null }],
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    startTransition(async () => {
      await supabase.from('general_chat_messages').insert({ sender_id: currentUserId, body });
    });
  };

  return (
    <aside className="flex h-80 flex-col rounded-xl border border-neutral-800 bg-neutral-900 lg:h-[360px]">
      <div className="border-b border-neutral-800 px-4 py-2 text-sm font-medium">Lobby chat</div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
        {messages.length === 0 && <p className="text-neutral-500">No messages yet. Say hi!</p>}
        {messages.map(m => (
          <div key={m.id}>
            <span
              className={`font-medium ${
                m.sender_id === currentUserId ? 'text-emerald-400' : 'text-sky-400'
              }`}
            >
              {m.profiles?.username || '???'}:
            </span>{' '}
            <span className="text-neutral-200">{m.body}</span>
          </div>
        ))}
      </div>
      <form className="flex gap-2 border-t border-neutral-800 p-2" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={`Message as ${currentUsername}`}
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
}

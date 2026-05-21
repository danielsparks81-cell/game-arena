import Link from 'next/link';
import BugInbox from './BugInbox';
import ReportErrorButton from './ReportErrorButton';

export default function TopBar({
  username,
  centerSlot,
}: {
  username: string;
  /** Optional content rendered in the center of the bar (used by the room page
      for Resign / Propose Abandon buttons). */
  centerSlot?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950 px-4 py-3 sm:px-6">
      <Link href="/lobby" className="flex items-center gap-1.5 text-base font-semibold tracking-tight sm:text-lg">
        <span className="text-emerald-400">▶</span>
        <span>Game Arena Lobby</span>
      </Link>
      {centerSlot && (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          {centerSlot}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {/* Legendary card sandbox — author-time tool for building hero packs. */}
        <Link
          href="/legendary-sandbox"
          title="Legendary card sandbox — design hero packs"
          className="hidden text-xs text-neutral-400 transition hover:text-emerald-400 sm:inline"
        >
          🛠 Sandbox
        </Link>
        {/* Bug-report button for everyone; admin-only bug-inbox alongside */}
        <ReportErrorButton />
        <BugInbox />
        <Link
          href="/profile"
          className="min-w-0 truncate text-sm text-neutral-400 transition hover:text-emerald-400"
        >
          <span className="hidden sm:inline">Signed in as </span>
          <span className="truncate font-medium text-neutral-100">
            {username}
          </span>
        </Link>
        <form action="/auth/signout" method="post" className="shrink-0">
          <button className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-900 sm:px-3 sm:text-sm">
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}

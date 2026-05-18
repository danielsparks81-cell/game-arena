import Link from 'next/link';
import BugInbox from './BugInbox';

export default function TopBar({ username }: { username: string }) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950 px-4 py-3 sm:px-6">
      <Link href="/lobby" className="flex items-center gap-1.5 text-base font-semibold tracking-tight sm:text-lg">
        <span className="text-emerald-400">▶</span>
        <span>Game Arena</span>
      </Link>
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {/* Admin-only bug-report inbox (renders nothing for non-admins) */}
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

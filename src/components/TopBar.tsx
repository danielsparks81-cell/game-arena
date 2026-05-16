import Link from 'next/link';

export default function TopBar({ username }: { username: string }) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-6 py-3">
      <Link href="/lobby" className="text-lg font-semibold tracking-tight">
        <span className="text-emerald-400">▶</span> Game Arena
      </Link>
      <div className="flex items-center gap-4">
        <Link href="/profile" className="text-sm text-neutral-400 hover:text-emerald-400">
          Signed in as <span className="text-neutral-100 hover:text-emerald-400">{username}</span>
        </Link>
        <form action="/auth/signout" method="post">
          <button className="rounded-md border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-900">
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}

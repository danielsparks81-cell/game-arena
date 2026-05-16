import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 text-center">
      <div>
        <h1 className="text-5xl font-bold tracking-tight">Game Arena</h1>
        <p className="mt-3 text-neutral-400">Play turn-based games with friends, anywhere.</p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-neutral-950 hover:bg-emerald-400"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-lg border border-neutral-700 px-5 py-2.5 font-medium hover:bg-neutral-900"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}

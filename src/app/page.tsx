import Link from 'next/link';
import HeroIllustration from '@/components/HeroIllustration';

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-8">
      {/* decorative background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute left-1/4 bottom-0 h-[400px] w-[400px] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute right-1/4 top-0 h-[400px] w-[400px] rounded-full bg-rose-500/10 blur-3xl" />
      </div>

      <div className="grid w-full max-w-5xl items-center gap-8 sm:gap-10 lg:grid-cols-[1fr_1fr]">
        <div className="text-center lg:text-left">
          <h1 className="bg-gradient-to-br from-emerald-300 via-sky-300 to-violet-300 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl lg:text-6xl">
            Game Arena
          </h1>
          <p className="mt-4 text-lg text-neutral-400">
            Play turn-based board games with friends, anywhere in the world. No installs, no waiting rooms — just sign in and play.
          </p>
          <div className="mt-6 flex justify-center gap-3 lg:justify-start">
            <Link
              href="/login"
              className="rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-neutral-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-5 py-2.5 font-medium backdrop-blur transition hover:border-neutral-500 hover:bg-neutral-900"
            >
              Create account
            </Link>
          </div>
          <p className="mt-6 text-sm text-neutral-500">
            Currently featuring <span className="text-emerald-400">Tic-Tac-Toe</span> and <span className="text-amber-400">Connect Four</span>. More games coming soon.
          </p>
        </div>
        <div className="mx-auto w-full max-w-xs sm:max-w-md">
          <HeroIllustration className="h-auto w-full" />
        </div>
      </div>
    </main>
  );
}

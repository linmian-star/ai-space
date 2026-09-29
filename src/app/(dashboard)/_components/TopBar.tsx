export default function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        AI Workbench
      </span>
      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        Model: minimax/m3
      </span>
    </header>
  );
}

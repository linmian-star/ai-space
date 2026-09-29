import Link from 'next/link';

type ModuleCard = {
  title: string;
  description: string;
  href: string;
};

const MODULES: ModuleCard[] = [
  {
    title: 'AI Chat',
    description: '通用对话，流式输出',
    href: '/chat',
  },
  {
    title: 'AI Tasks',
    description: '文本任务：摘要 / 翻译 / 抽取 / 改写',
    href: '/tasks',
  },
  {
    title: 'Research Agent',
    description: '基于 Tool Calling 的多跳研究 Agent',
    href: '/research',
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-12">
      <div className="w-full max-w-3xl">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          AI Workbench
        </h1>
        <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
          基于 Next.js + AI SDK 的 AI 工作台
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {MODULES.map(m => (
            <Link
              key={m.href}
              href={m.href}
              className="group block rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            >
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {m.title}
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {m.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

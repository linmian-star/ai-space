import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, FileText, Globe, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ENTRIES = [
  {
    href: '/chat',
    icon: MessageSquare,
    title: '对话',
    desc: '和多模型自由聊天，历史记录自动保存',
  },
  {
    href: '/tasks',
    icon: FileText,
    title: '文本任务',
    desc: '长文本一键摘要，提炼要点与结构',
  },
  {
    href: '/research',
    icon: Globe,
    title: '联网研究',
    desc: '自动搜索、读取网页并给出带引用的回答',
  },
];

export default function LandingPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-6 py-16">
      {/* 背景光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(45rem_30rem_at_50%_-8%,rgba(0,0,0,0.055),transparent)] dark:bg-[radial-gradient(45rem_30rem_at_50%_-8%,rgba(255,255,255,0.07),transparent)]"
      />
      {/* 细网格 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(40rem_28rem_at_50%_20%,black,transparent)]"
      />

      <div className="relative flex w-full max-w-[560px] flex-col items-center text-center">
        {/* Logo */}
        <div className="relative mb-8">
          <div
            aria-hidden
            className="absolute -inset-5 rounded-[40px] bg-foreground/[0.04] blur-2xl dark:bg-foreground/[0.06]"
          />
          <div className="relative h-[92px] w-[92px] overflow-hidden rounded-[26px] ring-1 ring-black/5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.28)] dark:ring-white/10 sm:h-[108px] sm:w-[108px] sm:rounded-[30px]">
            <Image
              src="/logo.jpg"
              alt="AI Workbench"
              width={216}
              height={216}
              priority
              className="h-full w-full scale-[1.32] object-cover"
            />
          </div>
        </div>

        <h1 className="text-[34px] font-medium leading-tight tracking-[-0.03em] text-foreground sm:text-[42px]">
          AI Workbench
        </h1>
        <p className="mt-3 max-w-[420px] text-[15px] leading-6 text-muted-foreground">
          对话、文本任务、联网研究 —— 一个工作台全部搞定。
        </p>

        <Button asChild size="lg" className="mt-8 h-11 rounded-full px-7 text-[15px]">
          <Link href="/chat">
            开始使用
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>

        <div className="mt-14 grid w-full gap-2.5 sm:grid-cols-3">
          {ENTRIES.map(({ href, icon: Icon, title, desc }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-2xl border border-border/80 bg-card/60 p-4 text-left transition-colors hover:border-muted-foreground/30 hover:bg-card"
            >
              <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              <div className="mt-3 text-[13px] font-medium text-foreground">{title}</div>
              <div className="mt-1 text-[12px] leading-5 text-muted-foreground">{desc}</div>
            </Link>
          ))}
        </div>

        <p className="mt-14 text-[11px] tracking-wide text-muted-foreground/70">
          AI Workbench · v0.2.0
        </p>
      </div>
    </main>
  );
}

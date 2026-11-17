'use client';

import { useTheme } from 'next-themes';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PAGE_TITLES: Record<string, string> = {
  '/chat': 'AI Chat',
  '/tasks': '文本任务',
  '/research': 'Research Agent',
};

export default function TopBar() {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const baseTitle = PAGE_TITLES[pathname] ?? 'AI Workbench';
  const [sessionTitle, setSessionTitle] = useState('');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setSessionTitle(detail || '');
    };
    window.addEventListener('sessiontitle', handler);
    return () => window.removeEventListener('sessiontitle', handler);
  }, []);

  // 页面切换时清掉旧的 session 标题
  useEffect(() => {
    setSessionTitle('');
  }, [pathname]);

  const displayTitle = pathname === '/chat' && sessionTitle
    ? sessionTitle
    : baseTitle;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-background/90 px-4 pl-16 backdrop-blur-md md:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate text-sm font-medium tracking-tight text-foreground">
          {displayTitle}
        </span>
        {pathname === '/chat' && sessionTitle && (
          <span className="hidden truncate text-[11px] text-muted-foreground sm:inline-flex">
            · {baseTitle}
          </span>
        )}
        <span className="hidden rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground/70 sm:inline-flex">
          GLM-4.6
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full text-muted-foreground hover:text-foreground"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label="切换主题"
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </Button>
    </header>
  );
}

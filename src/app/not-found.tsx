import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

// 全站 404 页面：放在 app/ 根目录、不属于 (dashboard) 路由组，
// 因此渲染在 RootLayout 内（带主题），但不会套上侧边栏。
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FileQuestion className="h-8 w-8" />
      </div>

      <p className="mt-6 text-6xl font-bold tracking-tight text-muted-foreground/50">
        404
      </p>

      <h1 className="mt-4 text-xl font-semibold">抱歉，这个页面走丢了</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        你访问的地址不存在，或者页面已经被移动。
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/chat" className={buttonVariants()}>
          返回对话
        </Link>
        <Link href="/tasks" className={buttonVariants({ variant: 'outline' })}>
          文本任务
        </Link>
      </div>
    </main>
  );
}

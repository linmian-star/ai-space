import { Skeleton } from '@/components/ui/skeleton';

/**
 * AI 回复的骨架屏占位。
 *
 * 只在 status === 'submitted'（请求已发出、AI 还没吐出第一个 chunk）时渲染：
 * 一旦收到首个 chunk，useChat 会创建 assistant 消息，由 MessageBubble 接管。
 * 外层卡片样式与 MessageBubble 的 AI 气泡保持一致，切换时不会跳动。
 */
export function SkeletonBubble() {
  return (
    <div className="flex gap-3">
      {/* 头像占位：与 MessageBubble 的 AI 头像同尺寸同配色 */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-sm font-medium text-muted-foreground">
        AI
      </div>

      {/* 内容占位：三行递减，模拟正在生成的文本 */}
      <div className="w-full max-w-[85%]">
        <div className="space-y-2 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 shadow-sm">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    </div>
  );
}

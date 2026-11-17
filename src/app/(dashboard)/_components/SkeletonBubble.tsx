import { Skeleton } from '@/components/ui/skeleton';

/**
 * AI 回复的骨架屏占位。
 *
 * 只在 status === 'submitted'（请求已发出、AI 还没吐出第一个 chunk）时渲染：
 * 一旦收到首个 chunk，useChat 会创建 assistant 消息，由 MessageBubble 接管。
 * 内容宽度与 MessageBubble 的 AI 消息保持一致，切换时不会跳动。
 */
export function SkeletonBubble() {
  return (
    <div className="w-full space-y-3 py-2" role="status" aria-label="AI 正在思考">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-1/2" />
    </div>
  );
}

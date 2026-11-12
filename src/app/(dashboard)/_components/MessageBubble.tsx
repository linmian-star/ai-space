'use client';

import type { UIMessage } from 'ai';
import MarkdownView from './MarkdownView';

/**
 * 单条消息气泡组件。
 * 负责：头像、气泡样式、打字光标（流式输出最后一条 assistant 消息）。
 * Chat 页和 Research 页都用它。
 */
export function MessageBubble({
  message,
  isStreaming,
  children,
}: {
  message: UIMessage;
  /** 是否正在流式输出（决定 assistant 末尾要不要显示闪烁光标） */
  isStreaming: boolean;
  /** assistant 的内容（由父页面决定：纯 text / 混合 text+dynamic-tool） */
  children: React.ReactNode;
}) {
  const isUser = message.role === 'user';

  // 这条是不是最后一条 assistant 消息（用来判断要不要加打字光标）
  const isLastAssistant = !isUser;
  const showTypingCursor = isLastAssistant && isStreaming;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* 头像 */}
      <div
        className={
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ' +
          (isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground border border-border')
        }
      >
        {isUser ? '我' : 'AI'}
      </div>

      {/* 消息体 */}
      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {isUser ? (
          // 用户消息：渐变气泡 + 右对齐
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
            {message.parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p, i) => (
                <span key={`${message.id}-${i}`}>{p.text}</span>
              ))}
          </div>
        ) : (
          // AI 消息：卡片 + 左对齐 + 打字光标
          <div className="w-full space-y-2">
            {children}
            {showTypingCursor && (
              <span className="inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-foreground/60" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

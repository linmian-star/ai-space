'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { UIMessage } from 'ai';

/**
 * 单条消息气泡组件。
 * 负责：用户气泡、AI 消息排版、打字光标、AI 消息复制按钮。
 */
export function MessageBubble({
  message,
  isStreaming,
  children,
}: {
  message: UIMessage;
  isStreaming: boolean;
  children: React.ReactNode;
}) {
  const isUser = message.role === 'user';
  const showTypingCursor = !isUser && isStreaming;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('\n')
      .trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 隐私模式等场景 clipboard 可能不可用 */
    }
  };

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isUser ? (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-7 text-secondary-foreground">
          {message.parts
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part, index) => (
              <span key={`${message.id}-${index}`}>{part.text}</span>
            ))}
        </div>
      ) : (
        <div className="group relative min-w-0 w-full space-y-2 text-[15px] text-foreground">
          {children}
          {showTypingCursor && (
            <span className="inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-foreground/60" />
          )}
          {/* AI 消息复制按钮 - 悬停时显示 */}
          {!showTypingCursor && message.parts.some(
            (p): p is { type: 'text'; text: string } => p.type === 'text' && p.text.trim() !== '',
          ) && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="复制 AI 回复"
              title="复制"
              className="absolute -right-2 top-0 hidden h-7 w-7 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:flex group-hover:opacity-100 focus-visible:flex focus-visible:opacity-100"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

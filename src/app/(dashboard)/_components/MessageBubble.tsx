'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { UIMessage } from 'ai';
import { getImage } from '@/lib/image-store';

const IMAGE_URL_PREFIX = 'idb://';

/**
 * 用户上传的图片：消息里只存 idb://<fileId>，
 * 渲染时异步从 IndexedDB 读回 base64；读不到就兜底显示【图片已失效】。
 */
function UserImage({ url }: { url: string }) {
  const fileId = url.startsWith(IMAGE_URL_PREFIX) ? url.slice(IMAGE_URL_PREFIX.length) : '';
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(fileId === '');

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    void getImage(fileId).then(record => {
      if (cancelled) return;
      if (record?.dataUrl) setSrc(record.dataUrl);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (failed) {
    return (
      <div className="flex h-20 w-28 items-center justify-center rounded-xl border border-border/80 bg-muted px-2 text-center text-[12px] text-muted-foreground">
        【图片已失效】
      </div>
    );
  }
  if (!src) {
    return <div className="h-20 w-28 animate-pulse rounded-xl bg-muted" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="用户上传的图片"
      className="max-h-52 max-w-[220px] rounded-xl border border-border/70 object-contain"
    />
  );
}

/**
 * 单条消息气泡组件。
 * 负责：用户气泡（含图片）、AI 消息排版、打字光标、AI 消息复制按钮。
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

  const fileParts = isUser
    ? message.parts.filter((part): part is { type: 'file'; mediaType: string; url: string } =>
        part.type === 'file',
      )
    : [];
  const userText = isUser
    ? message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map(part => part.text)
        .join('')
    : '';

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
        <div className="flex max-w-[85%] flex-col items-end gap-2">
          {fileParts.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {fileParts.map((part, index) => (
                <UserImage key={`${message.id}-file-${index}`} url={part.url} />
              ))}
            </div>
          )}
          {userText.trim() !== '' && (
            <div className="whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-7 text-secondary-foreground">
              {userText}
            </div>
          )}
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

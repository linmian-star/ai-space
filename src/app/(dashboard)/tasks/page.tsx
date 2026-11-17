'use client';

import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownView from '../_components/MarkdownView';
import { MessageBubble } from '../_components/MessageBubble';
import { SkeletonBubble } from '../_components/SkeletonBubble';
import { usePersistentChat } from '../_hooks/usePersistentChat';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, Square, RotateCcw, Plus, Trash2 } from 'lucide-react';

const TASK_API = '/api/tasks/summarize';

const SUGGESTIONS = [
  '帮我总结这篇文章的核心观点',
  '提取这段文字的关键信息和要点',
  '把以下内容压缩成 3 句话',
  '梳理这段文本的逻辑结构',
];

export default function TasksPage() {
  const [input, setInput] = useState('');
  const router = useRouter();
  const activeSessionId = useUrlSessionId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    messages,
    sendMessage,
    status,
    error,
    hydrated,
    startNewSession,
    stop,
    regenerate,
    clearHistory,
  } = usePersistentChat({
    storageKey: 'tasks',
    activeSessionId: activeSessionId,
    transport: new DefaultChatTransport({ api: TASK_API }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const showEmptyState = hydrated && messages.length === 0;

  // 监听 Sidebar 点「+ 新建对话」的 clearsession 事件
  useEffect(() => {
    const handler = () => startNewSession();
    window.addEventListener('clearsession', handler);
    return () => window.removeEventListener('clearsession', handler);
  }, [startNewSession]);

  // 新建/切换后聚焦输入框
  useEffect(() => {
    if (!hydrated) return;
    textareaRef.current?.focus();
  }, [activeSessionId, hydrated, messages.length === 0]);

  const handleNewChat = () => {
    startNewSession();
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('s');
      window.history.replaceState({}, '', url.toString());
    }
    router.push('/tasks');
    window.dispatchEvent(new Event('sessionchange'));
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput('');
  };

  const composer = (
    <div className="w-full">
      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>生成失败：{error.message || '请稍后重试'}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 rounded-full text-[12px] hover:bg-destructive/10"
            onClick={() => regenerate()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      )}
      <form
        className="rounded-[26px] border border-border/90 bg-card shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-shadow focus-within:border-muted-foreground/40 focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.09)] dark:shadow-none"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          ref={textareaRef}
          rows={3}
          className="max-h-48 min-h-[88px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-2 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0"
          placeholder="把需要摘要的文本粘贴到这里…"
          value={input}
          onChange={event => setInput(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <span className="pl-1 text-[11px] text-muted-foreground/80">
            Enter 发送 · Shift + Enter 换行
          </span>
          <Button
            type={busy ? 'button' : 'submit'}
            size="icon-sm"
            className="rounded-full"
            disabled={!busy && input.trim().length === 0}
            onClick={busy ? () => stop() : undefined}
            aria-label={busy ? '停止生成' : '生成摘要'}
            title={busy ? '停止生成' : '生成摘要'}
          >
            {busy ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {showEmptyState ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="m-auto w-full max-w-[768px] px-5 py-8">
            <div className="mb-7 text-center">
              <h1 className="text-[28px] font-medium tracking-[-0.03em] text-foreground md:text-[32px]">
                文本摘要
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                粘贴一段长文本，生成简洁要点。选择建议或直接输入。
              </p>
            </div>
            {composer}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="rounded-2xl border border-border/70 px-4 py-3 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[768px] px-4 pb-10 pt-5 md:px-6">
              {!hydrated ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  正在恢复历史对话…
                </div>
              ) : (
                <>
                  <div className="mb-5 flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-full text-muted-foreground hover:text-foreground"
                      onClick={handleNewChat}
                      aria-label="新建对话"
                      title="新建对话"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      onClick={clearHistory}
                      aria-label="删除当前对话"
                      title="删除当前对话"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-col gap-7">
                    {messages.map((message, index) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        isStreaming={busy && index === messages.length - 1}
                      >
                        {message.parts
                          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                          .map((part, partIndex) =>
                            part.text.trim() === '' ? null : (
                              <div key={`${message.id}-${partIndex}`} className="w-full">
                                <MarkdownView>{part.text}</MarkdownView>
                              </div>
                            ),
                          )}
                      </MessageBubble>
                    ))}
                    {status === 'submitted' && <SkeletonBubble />}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-6 md:px-6">
            <div className="mx-auto w-full max-w-[768px]">{composer}</div>
          </div>
        </>
      )}
    </div>
  );
}

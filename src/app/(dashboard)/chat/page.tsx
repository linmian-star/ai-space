'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownView from '../_components/MarkdownView';
import { MessageBubble } from '../_components/MessageBubble';
import { SkeletonBubble } from '../_components/SkeletonBubble';
import { usePersistentChat } from '../_hooks/usePersistentChat';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, Plus, Square, Trash2, RotateCcw } from 'lucide-react';

const SUGGESTIONS = [
  '用通俗的语言解释量子计算',
  '帮我制定一个前端面试复习计划',
  '分析这段文字的逻辑并给出改进建议',
  '写一个适合周末执行的学习计划',
];

export default function ChatPage() {
  const [input, setInput] = useState('');
  const router = useRouter();
  const activeSessionId = useUrlSessionId();

  const { messages, sendMessage, status, error, hydrated, clearHistory, startNewSession, stop, regenerate, currentTitle } =
    usePersistentChat({
      storageKey: 'chat',
      activeSessionId: activeSessionId,
    });
  const busy = status === 'submitted' || status === 'streaming';
  const showEmptyState = hydrated && messages.length === 0;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoScrollRef = useRef(true);

  // ---------- 智能自动滚动 ----------
  // 用户滚到底部附近（距底部 80px 内）时恢复自动跟随；否则保留当前位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      autoScrollRef.current = distanceFromBottom < 80;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // messages 变化时：如果用户在底部附近则自动滚到底
  useEffect(() => {
    if (showEmptyState) return;
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    // requestAnimationFrame 等下一轮布局完成再滚，否则流式输出时抖动
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, showEmptyState]);

  // 水合完成后滚到底（恢复历史时 messages 会 set）
  useEffect(() => {
    if (!hydrated || showEmptyState) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // ---------- 新建/切换/删除后聚焦输入框 ----------
  const sessionKey = activeSessionId ?? 'new';
  useEffect(() => {
    if (!hydrated) return;
    textareaRef.current?.focus();
  }, [sessionKey, hydrated, messages.length === 0]);

  // ---------- 广播当前会话标题给 TopBar ----------
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessiontitle', { detail: currentTitle }));
    }
  }, [currentTitle]);

  // ---------- Sidebar 新建对话事件 ----------
  useEffect(() => {
    const handler = () => startNewSession();
    window.addEventListener('clearsession', handler);
    return () => window.removeEventListener('clearsession', handler);
  }, [startNewSession]);

  const handleNewChat = () => {
    startNewSession();
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('s');
      window.history.replaceState({}, '', url.toString());
    }
    router.push('/chat');
    window.dispatchEvent(new Event('sessionchange'));
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput('');
    // 发送后滚到底 + 恢复自动跟随
    autoScrollRef.current = true;
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
          rows={1}
          className="max-h-48 min-h-[52px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-2 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0 md:text-[15px]"
          placeholder="给 AI Workbench 发消息"
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
            aria-label={busy ? '停止生成' : '发送消息'}
            title={busy ? '停止生成' : '发送消息'}
          >
            {busy ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
        AI 可能会犯错，请核查重要信息。
      </p>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {showEmptyState ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="m-auto w-full max-w-[768px] px-5 py-8">
            <div className="mb-7 text-center">
              <h1 className="text-[28px] font-medium tracking-[-0.03em] text-foreground md:text-[32px]">
                有什么可以帮你？
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                选择一个建议，或直接输入你想解决的问题。
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
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
          >
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

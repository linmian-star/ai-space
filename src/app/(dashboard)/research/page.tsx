'use client';

import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownView from '../_components/MarkdownView';
import { MessageBubble } from '../_components/MessageBubble';
import { SkeletonBubble } from '../_components/SkeletonBubble';
import { usePersistentChat } from '../_hooks/usePersistentChat';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowUp,
  Check,
  FileText,
  Globe,
  Loader2,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react';

const RESEARCH_API = '/api/research';

const SUGGESTIONS = [
  '对比 LangGraph 和 AutoGen 的架构差异',
  '调研 2026 年前端框架趋势',
  '总结最新 AI Agent 的核心能力',
  '2026 年主流 AI 编程模型有哪些最新进展？',
];

const TOOL_LABELS: Record<string, string> = {
  search: '网页搜索',
  fetch_page: '读取网页',
};

function describeInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  if (toolName === 'search') return String(obj.query ?? '');
  if (toolName === 'fetch_page') return String(obj.url ?? '');
  return JSON.stringify(obj);
}

function describeOutput(toolName: string, output: unknown): string {
  if (output && typeof output === 'object') {
    const archived = output as { __archived?: unknown; text?: unknown };
    if (archived.__archived === true && typeof archived.text === 'string') {
      return archived.text;
    }
  }
  if (!output || typeof output !== 'object') return '完成';
  const obj = output as Record<string, unknown>;
  if (toolName === 'search') {
    const results = Array.isArray(obj.results) ? obj.results : [];
    const titles = results
      .slice(0, 3)
      .map((r, i) => `${i + 1}. ${(r as { title?: string })?.title ?? ''}`)
      .join('\n');
    return `找到 ${results.length} 条结果${titles ? '：\n' + titles : ''}`;
  }
  if (toolName === 'fetch_page') {
    const content = typeof obj.content === 'string' ? obj.content : '';
    return `已获取正文（${content.length} 字符）`;
  }
  return '完成';
}

function ToolPartView({ part }: { part: Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }> }) {
  const label = TOOL_LABELS[part.toolName] ?? part.toolName;
  const inputText = describeInput(part.toolName, part.input);
  const ToolIcon = part.toolName === 'fetch_page' ? FileText : Globe;

  let body: ReactNode;
  let statusIcon: ReactNode;
  let statusText: string;
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      statusIcon = <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
      statusText = '调用中';
      body = (
        <span className="text-muted-foreground">
          {inputText || '正在准备参数…'}
        </span>
      );
      break;
    case 'output-available':
      statusIcon = <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
      statusText = '已完成';
      body = (
        <span className="whitespace-pre-wrap text-foreground/80">
          {describeOutput(part.toolName, part.output)}
        </span>
      );
      break;
    case 'output-error':
      statusIcon = <X className="h-3.5 w-3.5 text-destructive" />;
      statusText = '失败';
      body = <span className="text-destructive">失败：{part.errorText}</span>;
      break;
    default:
      statusIcon = <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />;
      statusText = String(part.state);
      body = <span className="text-muted-foreground">处理中…</span>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/25">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <ToolIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/90">{label}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {statusIcon}
          {statusText}
        </span>
      </div>
      <div className="px-3 py-2 text-[12px] leading-5">{body}</div>
    </div>
  );
}

export default function ResearchPage() {
  const [input, setInput] = useState('');
  const router = useRouter();
  const activeSessionId = useUrlSessionId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

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
    storageKey: 'research',
    activeSessionId: activeSessionId,
    transport: new DefaultChatTransport({ api: RESEARCH_API }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const showEmptyState = hydrated && messages.length === 0;

  // ---------- 智能自动滚动（与 chat 页一致） ----------
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

  useEffect(() => {
    if (showEmptyState) return;
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, showEmptyState]);

  useEffect(() => {
    if (!hydrated || showEmptyState) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

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
    router.push('/research');
    window.dispatchEvent(new Event('sessionchange'));
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput('');
    autoScrollRef.current = true;
  };

  const composer = (
    <div className="w-full">
      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>研究失败：{error.message || '请稍后重试'}</span>
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
          rows={2}
          className="max-h-48 min-h-[72px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-2 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0"
          placeholder="例如：2026 年主流 AI 编程模型有哪些最新进展？"
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
            aria-label={busy ? '停止研究' : '开始研究'}
            title={busy ? '停止研究' : '开始研究'}
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
                联网研究
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                输入研究问题，Agent 会自动搜索、读取网页并综合回答。
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
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
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
                        <div className="w-full space-y-2">
                          {message.parts.map((part, partIndex) => {
                            switch (part.type) {
                              case 'text':
                                return part.text.trim() === '' ? null : (
                                  <div key={`${message.id}-${partIndex}`} className="w-full">
                                    <MarkdownView>{part.text}</MarkdownView>
                                  </div>
                                );
                              case 'dynamic-tool':
                                return <ToolPartView key={`${message.id}-${partIndex}`} part={part} />;
                              default:
                                return null;
                            }
                          })}
                        </div>
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

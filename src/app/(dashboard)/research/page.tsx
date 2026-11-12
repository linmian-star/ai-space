'use client';

import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownView from '../_components/MarkdownView';
import { MessageBubble } from '../_components/MessageBubble';
import { usePersistentChat } from '../_hooks/usePersistentChat';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const RESEARCH_API = '/api/research';

const TOOL_LABELS: Record<string, string> = {
  search: '🔍 网页搜索',
  fetch_page: '📄 读取网页',
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

  let body: ReactNode;
  let icon: string;
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      icon = '⚙️';
      body = <span className="text-muted-foreground">调用中… {inputText}</span>;
      break;
    case 'output-available':
      icon = '✅';
      body = (
        <span className="whitespace-pre-wrap text-sm text-foreground/80">
          {describeOutput(part.toolName, part.output)}
        </span>
      );
      break;
    case 'output-error':
      icon = '❌';
      body = <span className="text-destructive text-sm">失败：{part.errorText}</span>;
      break;
    default:
      icon = '•';
      body = <span className="text-muted-foreground text-sm">{part.state}</span>;
  }

  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs">
      <span className="text-sm">{icon}</span>
      <div className="flex-1">
        <div className="mb-1 font-medium text-sm text-foreground/90">{label}</div>
        {body}
      </div>
    </div>
  );
}

export default function ResearchPage() {
  const [input, setInput] = useState('');
  const router = useRouter();
  const activeSessionId = useUrlSessionId();
  const { messages, sendMessage, status, error, hydrated, startNewSession } =
    usePersistentChat({
      storageKey: 'research',
      activeSessionId: activeSessionId,
      transport: new DefaultChatTransport({ api: RESEARCH_API }),
    });

  const busy = status === 'submitted' || status === 'streaming';

  // 监听 Sidebar 点「+ 新建对话」的 clearsession 事件
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
    router.push('/research');
    window.dispatchEvent(new Event('sessionchange'));
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Research Agent</h1>
        <p className="text-sm text-muted-foreground">
          输入研究问题，Agent 会自动搜索、读取网页并综合回答
        </p>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={e => {
          e.preventDefault();
          const text = input.trim();
          if (!text || busy) return;
          sendMessage({ text });
          setInput('');
        }}
      >
        <Textarea
          className="min-h-[96px] max-h-[240px] resize-y"
          placeholder="例如：2026 年主流 AI 编程模型有哪些最新进展？"
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const text = input.trim();
              if (text && !busy) {
                sendMessage({ text });
                setInput('');
              }
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Enter 发送 · Shift+Enter 换行
          </span>
          <div className="flex items-center gap-2">
            {hydrated && messages.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={handleNewChat}>
                新建对话
              </Button>
            )}
            <Button type="submit" size="sm" disabled={busy || input.trim().length === 0}>
              {busy ? '研究中...' : '开始研究'}
            </Button>
          </div>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          研究失败：{error.message || '请稍后重试'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!hydrated ? (
          <div className="text-sm text-muted-foreground">正在恢复历史…</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="text-lg">🔍</span>
            </div>
            <h2 className="mb-1 text-base font-semibold">开始联网调研</h2>
            <p className="mb-6 text-sm text-muted-foreground">Agent 会自动搜索、抓网页、综合回答</p>
            <div className="grid w-full max-w-md gap-2">
              {[
                '对比 LangGraph 和 AutoGen 的架构差异',
                '调研 2026 年前端框架趋势',
                '总结最新 AI Agent 的核心能力',
              ].map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  className="rounded-lg border border-border bg-card px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {messages.map((message, idx) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={busy && idx === messages.length - 1}
              >
                <div className="w-full space-y-2">
                  {message.parts.map((part, i) => {
                    switch (part.type) {
                      case 'text':
                        return part.text.trim() === '' ? null : (
                          <div
                            key={`${message.id}-${i}`}
                            className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm shadow-sm"
                          >
                            <MarkdownView>{part.text}</MarkdownView>
                          </div>
                        );
                      case 'dynamic-tool':
                        return <ToolPartView key={`${message.id}-${i}`} part={part} />;
                      default:
                        return null;
                    }
                  })}
                </div>
              </MessageBubble>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

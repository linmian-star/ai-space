'use client';

import { DefaultChatTransport, type UIMessage } from 'ai';
import { useState, type ReactNode } from 'react';
import MarkdownView from '../_components/MarkdownView';
import { usePersistentChat } from '../_hooks/usePersistentChat';

const RESEARCH_API = '/api/research';

const TOOL_LABELS: Record<string, string> = {
  search: '🔍 网页搜索',
  fetch_page: '📄 读取网页',
};

// 把工具入参渲染成一行可读摘要
function describeInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  if (toolName === 'search') return String(obj.query ?? '');
  if (toolName === 'fetch_page') return String(obj.url ?? '');
  return JSON.stringify(obj);
}

// 把工具结果渲染成一行摘要（完整内容太长，只给概览）
function describeOutput(toolName: string, output: unknown): string {
  // 从 localStorage 恢复的历史：工具结果已瘦身成归档文本，直接展示
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
      .map((r, i) => {
        const t = (r as { title?: string })?.title ?? '';
        return `${i + 1}. ${t}`;
      })
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
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      body = <span className="text-zinc-500 dark:text-zinc-400">调用中... {inputText}</span>;
      break;
    case 'output-available':
      body = (
        <span className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
          {describeOutput(part.toolName, part.output)}
        </span>
      );
      break;
    case 'output-error':
      body = <span className="text-red-600 dark:text-red-400">失败：{part.errorText}</span>;
      break;
    default:
      body = <span className="text-zinc-500">{part.state}</span>;
  }

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 font-semibold text-zinc-800 dark:text-zinc-200">{label}</div>
      <div>{body}</div>
    </div>
  );
}

export default function ResearchPage() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, error, hydrated, clearHistory } =
    usePersistentChat({
      storageKey: 'research',
      transport: new DefaultChatTransport({ api: RESEARCH_API }),
    });

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Research Agent
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
        <textarea
          className="h-24 w-full resize-y rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          placeholder="例如：2026 年主流 AI 编程模型有哪些最新进展？"
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {busy ? '研究中...' : '开始研究'}
          </button>
          {hydrated && messages.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              清空对话
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          研究失败：{error.message || '请稍后重试'}
        </div>
      )}

      {!hydrated ? (
        <div className="text-sm text-zinc-400 dark:text-zinc-500">正在恢复历史…</div>
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map(message => (
          <div key={message.id} className="flex flex-col gap-2">
            {message.role === 'user' && (
              <div className="self-end rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
                {message.parts.map((part, i) =>
                  part.type === 'text' ? <span key={i}>{part.text}</span> : null,
                )}
              </div>
            )}
            {message.role === 'assistant' &&
              message.parts.map((part, i) => {
                switch (part.type) {
                  case 'text':
                    return part.text.trim() === '' ? null : (
                      <div
                        key={`${message.id}-${i}`}
                        className="rounded-md border border-zinc-200 bg-white p-4 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                      >
                        <MarkdownView>{part.text}</MarkdownView>
                      </div>
                    );
                  case 'dynamic-tool':
                    return <ToolPartView key={`${message.id}-${i}`} part={part} />;
                  default:
                    // reasoning 等其它 part 不在 UI 展示
                    return null;
                }
              })}
          </div>
        ))}
        </div>
      )}
    </div>
  );
}

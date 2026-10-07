'use client';

import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import MarkdownView from '../_components/MarkdownView';
import { usePersistentChat } from '../_hooks/usePersistentChat';

const TASK_API = '/api/tasks/summarize';

export default function TasksPage() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, error, hydrated, clearHistory } =
    usePersistentChat({
      storageKey: 'tasks',
      transport: new DefaultChatTransport({ api: TASK_API }),
    });

  const busy = status === 'submitted' || status === 'streaming';
  const results = messages.filter(m => m.role === 'assistant');

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          文本摘要
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          粘贴一段长文本，生成 3-5 句话的简洁要点
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
          className="h-40 w-full resize-y rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          placeholder="把需要摘要的文本粘贴到这里..."
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {busy ? '生成中...' : '生成摘要'}
          </button>
          {hydrated && results.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              清空结果
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          生成失败：{error.message || '请稍后重试'}
        </div>
      )}

      {!hydrated ? (
        <div className="text-sm text-zinc-400 dark:text-zinc-500">正在恢复历史…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {results.map(message => (
            <div
              key={message.id}
              className="rounded-md border border-zinc-200 bg-white p-4 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <MarkdownView>
                {message.parts
                  .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                  .map(p => p.text)
                  .join('')}
              </MarkdownView>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

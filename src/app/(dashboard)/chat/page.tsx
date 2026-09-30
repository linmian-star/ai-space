'use client';

import { useChat } from '@ai-sdk/react';
import { useState } from 'react';
import MarkdownView from '../_components/MarkdownView';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat();
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          AI Chat
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          通用对话，流式输出
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
          className="h-24 w-full resize-y rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-indigo-400"
          placeholder="输入消息..."
          value={input}
          onChange={e => setInput(e.currentTarget.value)}
        />
        <div>
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {busy ? '发送中...' : '发送'}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-4">
        {messages.map(message => (
          <div key={message.id} className="flex flex-col gap-2">
            {message.role === 'user' && (
              <div className="self-end rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
                {message.parts.map((part, i) =>
                  part.type === 'text' ? <span key={`${message.id}-${i}`}>{part.text}</span> : null,
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
                  default:
                    return null;
                }
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

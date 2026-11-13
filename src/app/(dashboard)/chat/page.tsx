'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownView from '../_components/MarkdownView';
import { MessageBubble } from '../_components/MessageBubble';
import { SkeletonBubble } from '../_components/SkeletonBubble';
import { usePersistentChat } from '../_hooks/usePersistentChat';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const router = useRouter();
  const activeSessionId = useUrlSessionId();

  const { messages, sendMessage, status, hydrated, clearHistory, startNewSession } =
    usePersistentChat({
      storageKey: 'chat',
      activeSessionId: activeSessionId,
    });
  const busy = status === 'submitted' || status === 'streaming';

  // 监听 Sidebar 点「+ 新建对话」的 clearsession 事件（跨组件通信）
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

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">AI Chat</h1>
          <p className="text-sm text-muted-foreground">通用对话，流式输出</p>
        </div>
        {hydrated && messages.length > 0 && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={clearHistory}>
              删除对话
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleNewChat}>
              新建对话
            </Button>
          </div>
        )}
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
          placeholder="输入消息..."
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
          <Button type="submit" size="sm" disabled={busy || input.trim().length === 0}>
            {busy ? '思考中...' : '发送'}
          </Button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto">
        {!hydrated ? (
          <div className="text-sm text-muted-foreground">正在恢复历史…</div>
        ) : messages.length === 0 ? (
          // 空状态：欢迎引导
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="text-lg font-semibold">AI</span>
            </div>
            <h2 className="mb-1 text-base font-semibold">开始一段对话</h2>
            <p className="mb-6 text-sm text-muted-foreground">有什么我可以帮你的吗？</p>
            <div className="grid w-full max-w-md gap-2">
              {[
                '帮我写一篇 React hooks 教程',
                '用通俗语言解释 Transformer',
                '给我一个前端面试复习计划',
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
                {message.parts
                  .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                  .map((p, i) =>
                    p.text.trim() === '' ? null : (
                      <div
                        key={`${message.id}-${i}`}
                        className={cn(
                          'rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm shadow-sm'
                        )}
                      >
                        <MarkdownView>{p.text}</MarkdownView>
                      </div>
                    )
                  )}
              </MessageBubble>
            ))}
            {/* 请求已发出、AI 还没吐第一个字：用骨架屏占位，避免大片空白 */}
            {status === 'submitted' && <SkeletonBubble />}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DefaultChatTransport, type UIMessage } from 'ai';
import MarkdownView from '../_components/MarkdownView';
import { MessageBubble } from '../_components/MessageBubble';
import { SkeletonBubble } from '../_components/SkeletonBubble';
import { usePersistentChat } from '../_hooks/usePersistentChat';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { deleteImage, getImage, saveImage } from '@/lib/image-store';
import { ArrowUp, Paperclip, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react';

const SUGGESTIONS = [
  '用通俗的语言解释量子计算',
  '帮我制定一个前端面试复习计划',
  '分析这段文字的逻辑并给出改进建议',
  '写一个适合周末执行的学习计划',
];

// 消息里的图片引用格式：idb://<fileId>，base64 只存在 IndexedDB
const IMAGE_URL_PREFIX = 'idb://';
// 单次请求最多 3 张图片
const MAX_IMAGES = 3;
// 压缩规则：长边 ≤ 1568px、JPEG q=0.8，单张 base64 控制在约 1.5MB 原始字节以内
const MAX_IMAGE_EDGE = 1568;
const MAX_DATA_URL_LENGTH = 2_000_000;
const MIN_JPEG_QUALITY = 0.4;

interface PendingImage {
  fileId: string;
  preview: string;
  mediaType: string;
  filename: string;
}

// 发送前把 idb://<fileId> 解析成真正的 base64 data URL。
// 后端只会收到标准 file part，永远看不到 fileId。
async function resolveImages(messages: UIMessage[]): Promise<UIMessage[]> {
  const hasImageRef = messages.some(message =>
    message.parts?.some(part => part.type === 'file' && part.url.startsWith(IMAGE_URL_PREFIX)),
  );
  if (!hasImageRef) return messages;

  return Promise.all(
    messages.map(async message => {
      const messageHasRef = message.parts?.some(
        part => part.type === 'file' && part.url.startsWith(IMAGE_URL_PREFIX),
      );
      if (!messageHasRef) return message;

      const parts: UIMessage['parts'] = [];
      for (const part of message.parts) {
        if (part.type !== 'file' || !part.url.startsWith(IMAGE_URL_PREFIX)) {
          parts.push(part);
          continue;
        }
        const record = await getImage(part.url.slice(IMAGE_URL_PREFIX.length));
        if (record?.dataUrl) {
          parts.push({
            ...part,
            url: record.dataUrl,
            mediaType: record.mediaType || part.mediaType,
          });
        }
        // 图片已被清理：丢弃该 part，绝不把 idb:// 发给后端
      }

      return {
        ...message,
        parts:
          parts.length > 0
            ? parts
            : [{ type: 'text', text: '【图片已失效】' } satisfies UIMessage['parts'][number]],
      };
    }),
  );
}

// 浏览器端压缩：canvas 缩放 + JPEG 编码，超限时逐步降质。
async function compressToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('canvas 2d context unavailable');
  }

  // 透明 PNG 转 JPEG 会变黑底，先铺白底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.8;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > MIN_JPEG_QUALITY) {
    quality = Math.max(MIN_JPEG_QUALITY, Math.round((quality - 0.1) * 100) / 100);
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}

// 模块级 transport：不随渲染重建；重试/重新生成也走同一套图片解析逻辑。
const chatTransport = new DefaultChatTransport<UIMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: async ({ messages, body, headers, credentials }) => ({
    body: { ...body, messages: await resolveImages(messages) },
    headers,
    credentials,
  }),
});

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const router = useRouter();
  const activeSessionId = useUrlSessionId();

  const { messages, sendMessage, status, error, hydrated, clearHistory, startNewSession, stop, regenerate, currentTitle } =
    usePersistentChat({
      storageKey: 'chat',
      activeSessionId: activeSessionId,
      transport: chatTransport,
    });
  const busy = status === 'submitted' || status === 'streaming';
  const showEmptyState = hydrated && messages.length === 0;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoScrollRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // pending 的镜像：异步上传过程中要读到最新数量，避免闭包拿到旧值
  const pendingRef = useRef<PendingImage[]>([]);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- 图片：选择 / 粘贴 / 拖拽 ----------
  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  };

  const addPending = (item: PendingImage) => {
    pendingRef.current = [...pendingRef.current, item];
    setPending(pendingRef.current);
  };

  const removePending = (fileId: string) => {
    pendingRef.current = pendingRef.current.filter(item => item.fileId !== fileId);
    setPending(pendingRef.current);
    void deleteImage(fileId);
  };

  const discardPending = () => {
    pendingRef.current.forEach(item => void deleteImage(item.fileId));
    pendingRef.current = [];
    setPending([]);
  };

  const handleFiles = async (incoming: FileList | File[]) => {
    const files = Array.from(incoming).filter(file => file.type.startsWith('image/'));
    if (files.length === 0) return;

    const room = MAX_IMAGES - pendingRef.current.length;
    if (room <= 0) {
      showNotice(`最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }
    if (files.length > room) {
      showNotice(`最多 ${MAX_IMAGES} 张，已忽略 ${files.length - room} 张`);
    }

    for (const file of files.slice(0, room)) {
      try {
        const dataUrl = await compressToDataUrl(file);
        const fileId = await saveImage({ dataUrl, mediaType: 'image/jpeg', filename: file.name });
        if (!fileId) {
          showNotice('图片保存失败，请重试');
          continue;
        }
        addPending({ fileId, preview: dataUrl, mediaType: 'image/jpeg', filename: file.name });
      } catch {
        showNotice('图片处理失败，请换一张试试');
      }
    }
  };

  // 卸载时清掉未发送的临时图片，避免 IndexedDB 留孤儿
  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      pendingRef.current.forEach(item => void deleteImage(item.fileId));
      pendingRef.current = [];
    };
  }, []);

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
    const handler = () => {
      discardPending();
      startNewSession();
    };
    window.addEventListener('clearsession', handler);
    return () => window.removeEventListener('clearsession', handler);
  }, [startNewSession]);

  const handleNewChat = () => {
    discardPending();
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
    const images = pendingRef.current;
    if ((!text && images.length === 0) || busy) return;

    const parts: UIMessage['parts'] = [];
    if (text) parts.push({ type: 'text', text });
    for (const image of images) {
      // 只把 fileId 放进消息；base64 在发送时由 transport 解析
      parts.push({
        type: 'file',
        mediaType: image.mediaType,
        filename: image.filename,
        url: `${IMAGE_URL_PREFIX}${image.fileId}`,
      });
    }

    // 图片已在 IndexedDB 中（渲染与发送都要用），这里只清空待发送区
    pendingRef.current = [];
    setPending([]);
    sendMessage({ parts });
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
        className={`rounded-[26px] border bg-card shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-shadow dark:shadow-none ${
          dragging
            ? 'border-foreground/40 shadow-[0_10px_36px_rgba(0,0,0,0.09)]'
            : 'border-border/90 focus-within:border-muted-foreground/40 focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.09)]'
        }`}
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
        onDragOver={event => {
          if (event.dataTransfer?.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer?.files?.length) void handleFiles(event.dataTransfer.files);
        }}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {pending.map(image => (
              <div
                key={image.fileId}
                className="group/img relative h-16 w-16 overflow-hidden rounded-xl border border-border/80"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.preview}
                  alt={image.filename}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePending(image.fileId)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-opacity sm:opacity-0 sm:group-hover/img:opacity-100"
                  aria-label="移除图片"
                  title="移除图片"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          rows={1}
          className="max-h-48 min-h-[52px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pb-2 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0 md:text-[15px]"
          placeholder={pending.length > 0 ? '针对这张图片提问…' : '给 AI Workbench 发消息'}
          value={input}
          onChange={event => setInput(event.currentTarget.value)}
          onPaste={event => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.some(file => file.type.startsWith('image/'))) {
              event.preventDefault();
              void handleFiles(files);
            }
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={event => {
                const files = event.currentTarget.files;
                if (files?.length) void handleFiles(files);
                // 重置 value，保证连续选同一张图也能触发 change
                event.currentTarget.value = '';
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || pending.length >= MAX_IMAGES}
              aria-label="添加图片"
              title={`添加图片（最多 ${MAX_IMAGES} 张）`}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <span className="truncate pl-1 text-[11px] text-muted-foreground/80">
              {notice ?? 'Enter 发送 · Shift + Enter 换行'}
            </span>
          </div>
          <Button
            type={busy ? 'button' : 'submit'}
            size="icon-sm"
            className="rounded-full"
            disabled={!busy && input.trim().length === 0 && pending.length === 0}
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

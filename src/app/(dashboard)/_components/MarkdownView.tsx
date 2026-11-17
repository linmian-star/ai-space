import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { Copy, Check, X } from 'lucide-react';

// 从 ReactNode 树中递归提取纯文本（用于 pre 组件复制代码）
function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in (node as { props?: unknown })) {
    const p = (node as { props?: { children?: ReactNode } }).props;
    if (p?.children !== undefined) return extractText(p.children);
  }
  return '';
}

// 代码块复制按钮（仅 fenced code block 加，inline code 不加）
// 三态：idle / copied / failed —— 失败时明确告知，不假装成功。
function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清掉未执行的定时器，避免在已卸载组件上 setState
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let ok = false;

    // ① 先判断 API 是否存在：非安全上下文（http + 内网 IP）下 clipboard 为 undefined
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
    }

    // ② 降级方案同样要接返回值：execCommand 失败会返回 false
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }

    setStatus(ok ? 'copied' : 'failed');

    // ③ 连点时先清旧定时器，避免上一次的 timer 提前撤掉这次的状态
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus('idle');
      timerRef.current = null;
    }, 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-zinc-300 opacity-80 transition-all hover:bg-white/15 hover:opacity-100"
      aria-label={status === 'copied' ? '已复制' : status === 'failed' ? '复制失败' : '复制代码'}
    >
      {status === 'copied' && (
        <>
          <Check className="h-3 w-3" />
          <span>已复制</span>
        </>
      )}
      {status === 'failed' && (
        <>
          <X className="h-3 w-3" />
          <span>复制失败</span>
        </>
      )}
      {status === 'idle' && (
        <>
          <Copy className="h-3 w-3" />
          <span>复制</span>
        </>
      )}
    </button>
  );
}

// 各 Markdown 元素对应的 Tailwind 样式
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 text-xl font-semibold tracking-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-6 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-base font-semibold first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-4 leading-7 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const codeText = extractText(children);
    return (
      <div className="relative mb-4 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 last:mb-0">
        <CopyButton text={codeText} />
        <pre className="overflow-x-auto p-4 pr-20 text-[13px] leading-6 text-zinc-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
          {children}
        </pre>
      </div>
    );
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-border pl-4 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border/70" />,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted/50 px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
};

export default function MarkdownView({ children }: { children: string }) {
  return (
    <div className="break-words text-[15px] leading-7 text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

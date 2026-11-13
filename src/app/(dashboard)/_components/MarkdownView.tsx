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
      className="absolute right-2 top-2 flex items-center gap-1 rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-500 opacity-70 transition-opacity hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
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
    <h1 className="mb-3 mt-4 text-xl font-bold text-zinc-900 dark:text-zinc-50">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-50">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 leading-6">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-indigo-600 dark:bg-zinc-800 dark:text-indigo-400">
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const codeText = extractText(children);
    return (
      <div className="relative mb-3">
        <CopyButton text={codeText} />
        <pre className="overflow-x-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
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
      className="text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-zinc-300 pl-3 italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-700" />,
  table: ({ children }) => (
    <table className="mb-3 border-collapse text-xs">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">{children}</td>
  ),
};

export default function MarkdownView({ children }: { children: string }) {
  return (
    <div className="text-sm text-zinc-800 dark:text-zinc-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

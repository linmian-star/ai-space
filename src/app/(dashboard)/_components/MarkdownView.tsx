import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

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
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
      {children}
    </pre>
  ),
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

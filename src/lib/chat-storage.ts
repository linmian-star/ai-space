// 对话历史 localStorage 持久化 —— 纯逻辑层（不含任何 React 代码）
//
// 设计原则：
// - 本模块只是 React state 的「存档投影」：写什么完全由调用方传入的 messages 决定，
//   不在内部读取旧存档参与合并，避免「state 一份、存储一份」的双源竞争
//   （旧闭包 + 立即生效的存储混用会导致消息被覆盖/回退）。
// - key 带版本号 ai-space:<name>:v1：将来消息结构变更直接换 v2，
//   用户浏览器里的旧数据躺在另一个 key 上，新代码读不到也不会崩。
// - 外层按「多会话」结构设计（sessions 数组），MVP 每个页面只存 1 个会话，
//   第二步做会话列表 UI 时无需迁移数据。
// - 工具结果瘦身：fetch_page 的 output 含正文/chunks/2048 维向量（单条约 160KB），
//   而前端只显示一行摘要，存盘时替换成约 50 字节的归档文本。
//   详见 research 页 describeOutput 对 __archived 的兼容。

import type { UIMessage } from 'ai';

const STORAGE_PREFIX = 'ai-space';
const STORAGE_VERSION = 1;
const TITLE_MAX_LEN = 30;
const SEARCH_RESULTS_KEEP = 5;

export interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

interface StorageShape {
  version: number;
  sessions: StoredSession[];
}

// 归档后的工具输出标记：页面恢复历史时见到 __archived 直接渲染 text。
export interface ArchivedToolOutput {
  __archived: true;
  text: string;
}

export interface SaveSessionInput {
  id: string;
  createdAt: number;
  messages: UIMessage[];
}

function storageKey(name: string): string {
  return `${STORAGE_PREFIX}:${name}:v${STORAGE_VERSION}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // 极端兜底（非安全上下文的旧浏览器）：时间戳 + 随机串
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// 从第一条用户消息生成会话标题（纯派生，不需要单独维护）。
export function deriveTitle(messages: UIMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return '新对话';
  const text = firstUser.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '新对话';
  return text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN)}…` : text;
}

// 把单个工具的「内存版 output」转成「存档版 output」。
// 只登记确实体积大的工具；其他工具原样保留。
function slimToolOutput(toolName: unknown, output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const obj = output as Record<string, unknown>;

  if (toolName === 'fetch_page') {
    // 页面只用 content.length 显示一行摘要；正文/chunks/embeddings 全部丢弃。
    const content = typeof obj.content === 'string' ? obj.content : '';
    const archived: ArchivedToolOutput = {
      __archived: true,
      text: `已获取正文（${content.length} 字符）`,
    };
    return archived;
  }

  if (toolName === 'search') {
    // describeOutput 只展示前 3 条标题；url 一并保留（体积很小），丢掉 snippet。
    const raw = Array.isArray(obj.results) ? obj.results : [];
    const results = raw.slice(0, SEARCH_RESULTS_KEEP).map(item => {
      const r = (item ?? {}) as Record<string, unknown>;
      return {
        title: typeof r.title === 'string' ? r.title : '',
        url: typeof r.url === 'string' ? r.url : '',
      };
    });
    return { results };
  }

  return output;
}

// 产出消息数组的「瘦身深拷贝」：绝不修改 useChat 内存中的原始 part 对象。
// 用户文字 / AI 文字 / reasoning 思考过程原样保留（思考过程约 1-2KB，不大）。
function slimMessages(messages: UIMessage[]): UIMessage[] {
  const cloned = JSON.parse(JSON.stringify(messages)) as Array<{
    parts?: Array<Record<string, unknown>>;
  }>;

  for (const message of cloned) {
    if (!Array.isArray(message.parts)) continue;
    message.parts = message.parts.map(part => {
      if (
        part &&
        part.type === 'dynamic-tool' &&
        part.state === 'output-available'
      ) {
        return { ...part, output: slimToolOutput(part.toolName, part.output) };
      }
      return part;
    });
  }

  return cloned as unknown as UIMessage[];
}

// 读取并校验存档形状；坏 JSON / 版本不符 / 结构错误一律返回 null，
// 由调用方当作「全新会话」处理，保证页面绝不因旧数据白屏。
function readShape(k: string): StorageShape | null {
  if (!isBrowser()) return null;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(k);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StorageShape>;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (!Array.isArray(parsed.sessions)) return null;
    return parsed as StorageShape;
  } catch {
    return null;
  }
}

// 水合时调用：恢复最近更新的会话（MVP 只有一个，取 updatedAt 最大的最稳）。
export function loadSession(name: string): StoredSession | null {
  const shape = readShape(storageKey(name));
  if (!shape || shape.sessions.length === 0) return null;
  const sorted = [...shape.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted[0] ?? null;
}

// 删除指定页面的历史（清空按钮用）。
export function clearSession(name: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(storageKey(name));
  } catch {
    // 隐私模式等场景 localStorage 可能整体不可用：静默忽略。
  }
}

// 容量兜底：写入失败（超 5MB 配额）时，从最老的会话开始逐个丢弃后重试。
// 当前会话永远最后被牺牲；全部删光仍失败则放弃保存（静默）——
// 内存里的对话进行不受任何影响。
function writeWithEviction(k: string, shape: StorageShape): void {
  const ordered = [...shape.sessions].sort((a, b) => a.updatedAt - b.updatedAt);

  for (let drop = 0; drop <= ordered.length; drop++) {
    const sessions = ordered.slice(drop);
    try {
      window.localStorage.setItem(
        k,
        JSON.stringify({ version: STORAGE_VERSION, sessions }),
      );
      return;
    } catch {
      // 配额不足：丢一个最老会话，下一轮再试。
    }
  }
}

// 保存当前会话。messages 为空等价于清除存档。
// 存档内容完全来自入参（state 的投影），不在此读取旧数据合并。
export function saveSession(name: string, input: SaveSessionInput): void {
  if (!isBrowser()) return;
  const k = storageKey(name);

  if (input.messages.length === 0) {
    clearSession(name);
    return;
  }

  const now = Date.now();
  const session: StoredSession = {
    id: input.id,
    title: deriveTitle(input.messages),
    createdAt: input.createdAt || now,
    updatedAt: now,
    messages: slimMessages(input.messages),
  };

  writeWithEviction(k, { version: STORAGE_VERSION, sessions: [session] });
}

export { createId as newSessionId };

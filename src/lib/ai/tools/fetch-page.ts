import { tool } from 'ai';
import { z } from 'zod';
import {
  MAX_FETCHES,
  type EmbeddedChunk,
  type FetchQuality,
  type ResearchChunk,
  type ResearchState,
} from '../research-state';
import { embedChunks } from '../embedding';
import type { VectorStore } from '../vector-store';

const MAX_CHARS = 8000;

// 分块参数：固定值，不自行修改。
// CHUNK_SIZE=1500 约为 1-2 个段落，远小于单页 8000 字符上限；
// CHUNK_OVERLAP=150（size 的 10%）保证跨边界句子不被截断。
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 150;

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

// 优先定位语义正文区域：先找 <main>，再找 <article>；
// 都找不到时返回 null，由调用方回退到整页清洗。
// 作用是跳过 nextjs.org 这类站点 <main> 之前几十 KB 的站点级导航/页头文本。
function extractMain(html: string): string | null {
  const mainMatch = html.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (mainMatch) return mainMatch[0];
  const articleMatch = html.match(/<article[\s>][\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];
  return null;
}

// 不引入 cheerio/readability 的极简网页正文提取：
// 先限定到 <main>/<article> 正文区域 → 去掉 nav/header/footer 等非正文标签
// → 去标签 → 压空白 → 截断。
function htmlToText(html: string): string {
  const scope = extractMain(html) ?? html;

  const withoutNoise = scope
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  const text = decodeHtml(withoutNoise.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

  return text.length > MAX_CHARS
    ? text.slice(0, MAX_CHARS) + '\n\n[内容过长，已截断]'
    : text;
}

// 错误页面关键词：匹配正文前 500 字符，命中则判为 unusable。
// 只收录高置信度的错误/拦截信号，宁松勿严。
const ERROR_PAGE_PATTERNS: RegExp[] = [
  /404\s*(not found|page not found|error)/i,
  /page not found/i,
  /access denied/i,
  /forbidden/i,
  /403\s*(error|forbidden)/i,
  /please (log ?in|sign ?in)/i,
  /login required/i,
  /sign in (to|required)/i,
  /unauthorized/i,
  /access denied/i,
  /请求被拒绝|访问被拒绝|页面未找到|页面不存在/i,
  /登录后|请登录/i,
];

// 页面质量判断：纯函数、确定性、保守。
// - content 为空或 < 50 字符 → unusable
// - 前 500 字符命中错误页关键词 → unusable
// - 50 ≤ length < 200 → weak（太短，可能只有标题或导航片段）
// - length ≥ 200 → usable（正常技术文章通常远超此阈值，不会误杀）
export function assessQuality(content: string): FetchQuality {
  if (content.length < 50) return 'unusable';

  const head = content.slice(0, 500);
  for (const re of ERROR_PAGE_PATTERNS) {
    if (re.test(head)) return 'unusable';
  }

  if (content.length < 200) return 'weak';

  return 'usable';
}

// 纯函数：将一篇正文切分为多个 ResearchChunk。
// 不依赖网络、state、LLM；只做确定性字符串处理。
//
// 策略：
// 1. trim 后为空 → []
// 2. 整页 < CHUNK_SIZE → 单个 chunk，不强行切分
// 3. 按空行分段，trim 后丢弃空段落
// 4. 单段 > CHUNK_SIZE 时用固定窗口二次切分（步进 = CHUNK_SIZE - CHUNK_OVERLAP）
// 5. 剩余段按顺序贪婪打包（段间用 \n\n 连接，不超 CHUNK_SIZE）
// 6. index 从 0 递增，id = `${normalizedUrl}#${index}`
export function chunkContent(content: string, normalizedUrl: string): ResearchChunk[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];

  // 整页很短：直接一个 chunk
  if (trimmed.length < CHUNK_SIZE) {
    return [
      { id: `${normalizedUrl}#0`, sourceUrl: normalizedUrl, content: trimmed, index: 0 },
    ];
  }

  // 按空行分段
  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // 长段落二次切分，收集所有 segment（每个 ≤ CHUNK_SIZE）
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= CHUNK_SIZE) {
      segments.push(para);
    } else {
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + CHUNK_SIZE, para.length);
        segments.push(para.slice(start, end));
        if (end >= para.length) break;
        start += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }
  }

  // 贪婪打包：段间用 \n\n 连接，不超过 CHUNK_SIZE
  const chunkTexts: string[] = [];
  let current = '';
  for (const seg of segments) {
    if (current.length === 0) {
      current = seg;
    } else {
      const candidate = current + '\n\n' + seg;
      if (candidate.length <= CHUNK_SIZE) {
        current = candidate;
      } else {
        chunkTexts.push(current);
        current = seg;
      }
    }
  }
  if (current.length > 0) chunkTexts.push(current);

  return chunkTexts.map((text, i) => ({
    id: `${normalizedUrl}#${i}`,
    sourceUrl: normalizedUrl,
    content: text,
    index: i,
  }));
}

// 工具工厂：传入当前请求的 ResearchState 和 VectorStore，共享抓取预算、页面缓存与向量库。
export function createFetchPageTool(
  state: ResearchState,
  vectorStore: VectorStore,
) {
  return tool({
    description:
      'Fetch a web page by URL and return its main content as plain text. Call this AFTER search to read the most relevant result pages in depth.',
    inputSchema: z.object({
      // 不用 z.url()：模型偶尔会传缺协议的 URL，严格校验会直接中断工具循环。
      // 保持放宽为字符串，在 execute 内统一用 state.normalizeUrl 规范化，让模型有机会自纠。
      url: z.string().min(1).describe('The full URL of the page to fetch'),
    }),
    execute: async ({
      url,
    }): Promise<{
      url: string;
      content: string;
      quality: FetchQuality;
      chunks: ResearchChunk[];
      embeddings: EmbeddedChunk[];
      cached: boolean;
    }> => {
      // 统一规范化：与 search 去重同一规则，规范化结果同时作为缓存 key
      const normalizedUrl = state.normalizeUrl(url);

      // 缓存命中：直接返回，不重复发起 HTTP 请求（含质量等级、chunk 列表与 embedding）
      const cached = state.getCachedFetch(normalizedUrl);
      if (cached) {
        return {
          url: cached.url,
          content: cached.content,
          quality: cached.quality,
          chunks: cached.chunks,
          embeddings: cached.embeddings,
          cached: true,
        };
      }

      // 硬预算：超限直接由代码阻止，不依赖模型自觉
      if (!state.canFetch()) {
        throw new Error(
          `Fetch budget exhausted: at most ${MAX_FETCHES} pages per research run. Do not fetch more pages; write your final answer from the content you already have.`,
        );
      }
      // 发起新抓取即消耗额度（无论成败都计数），防止模型用失败重试绕过预算
      state.beginFetch();

      const res = await fetch(normalizedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        // 工具调用失败由 AI SDK 转成 tool-error，模型可据此改选其它链接
        signal: AbortSignal.timeout(20000),
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`Fetch failed: HTTP ${res.status} for ${normalizedUrl}`);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const html = await res.text();
      const content = htmlToText(html);
      const quality = assessQuality(content);
      const chunks = chunkContent(content, normalizedUrl);
      // 对 chunk 列表进行向量化：单个 chunk 失败会被跳过（warn 记录），
      // 返回仅包含成功项的 EmbeddedChunk[]。整页不会因一个 chunk 失败而丢失。
      const embeddings = await embedChunks(chunks);
      // 部分失败提示：embeddings 数量少于 chunks 说明有 chunk 向量化失败，
      // 不阻断流程——页面正文与成功 chunk 仍会进入 state / Vector DB。
      if (embeddings.length < chunks.length) {
        console.warn(
          `[fetch_page] partial embedding failure: ${embeddings.length}/${chunks.length} chunks succeeded for ${normalizedUrl}`,
        );
      }
      // 成功后写入缓存（含质量等级、chunk 列表与 embedding）：同一 URL 再次 fetch 直接命中
      state.recordFetch(normalizedUrl, content, quality, chunks, embeddings);
      // 把向量写入 Vector Store（幂等，以 chunk.id 为主键）。
      // 向量库写入失败不破坏已成功的 fetch：正文与 embedding 仍在 state 中，
      // 只影响该页 chunk 无法被向量检索到，因此降级为 warning 而非 tool error。
      try {
        await vectorStore.upsert(embeddings);
      } catch (error) {
        console.warn(
          '[research] vector store upsert failed (non-blocking):',
          error instanceof Error ? error.message : error,
        );
      }
      return { url: normalizedUrl, content, quality, chunks, embeddings, cached: false };
    },
  });
}

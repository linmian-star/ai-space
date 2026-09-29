import { tool } from 'ai';
import { z } from 'zod';
import { MAX_SEARCHES, type ResearchState } from '../research-state';

// 极简 HTML 实体解码（Node 运行时无 DOM）。
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

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

// 过滤统计：raw 为解析出的原始条目数，deduped 为重复 URL 数，filtered 为无关/无效数。
type SearchStats = {
  raw: number;
  kept: number;
  deduped: number;
  filtered: number;
};

// —— 基础过滤规则（零依赖、保守）：目标只过滤"明显垃圾"，宁松勿严 ——

// 明显非网页内容的文件直链（按 pathname 扩展名识别）
const BLOCKED_FILE_RE = /\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|exe|dmg|apk|csv|tar|gz)([?#]|$)/i;

// 英文停用词：不作为相关性判断依据（避免 the/what/how 之类虚词干扰计数）
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'what', 'which', 'how', 'why', 'when',
  'where', 'who', 'does', 'do', 'did', 'can', 'could', 'should', 'would',
  'will', 'its', 'it', 'this', 'that', 'these', 'those', 'new', 'vs', 'by',
  'at', 'as', 'has', 'have', 'had', 'not', 'from', 'into', 'about', 'please',
]);

// 轻量分词：拉丁/数字词（小写、≥2 字符、排除停用词）+ 中文相邻二字组合。
// 返回词项集合与拉丁词数量，只求词项重叠判断，不做真正的语义分析。
function tokenize(text: string): { tokens: Set<string>; latinCount: number } {
  const tokens = new Set<string>();
  let latinCount = 0;
  const lower = text.toLowerCase();

  for (const word of lower.match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 2 && !STOPWORDS.has(word)) {
      tokens.add(word);
      latinCount++;
    }
  }
  for (const seg of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let i = 0; i + 1 < seg.length; i++) tokens.add(seg.slice(i, i + 2));
  }
  return { tokens, latinCount };
}

// 判断 title+snippet 是否与 query 存在基础词项重叠。宁松勿严：
// - 命中 ≥2 个词项：保留
// - 仅命中 1 个：query 宽泛（拉丁词 ≤2 个，如 "react 入门"）时保留；
//   query 具体（拉丁词 ≥3 个）时单 token 命中证据不足，过滤
//   （避免服装品牌 "Next" 搭 Next.js query 的便车，同时不误杀 "React 教程" 这类宽泛结果）
// - 零命中或 query 无有效词：无有效词时不过滤，零命中过滤
function isPlausiblyRelevant(
  queryTokens: Set<string>,
  queryLatinCount: number,
  title: string,
  snippet: string,
): boolean {
  if (queryTokens.size === 0) return true;

  const haystack = tokenize(`${title} ${snippet}`).tokens;
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) hits++;
  }
  if (hits >= 2) return true;
  return hits === 1 && queryLatinCount <= 2;
}

// 工具工厂：传入当前请求的 ResearchState，共享搜索预算。
// Bing 搜索逻辑本身保持不变。
export function createSearchTool(state: ResearchState) {
  return tool({
    description:
      'Search the web with Bing. Returns a list of results with title, url and snippet. Use this first to find relevant pages, then use fetch_page to read the most relevant ones.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe('Max number of results, default 5'),
    }),
    execute: async ({
      query,
      limit = 5,
    }): Promise<{ results: SearchResult[]; stats: SearchStats }> => {
      // 硬预算：检查+预留一步完成（原子），且必须发生在 await 之前——
      // 并发 tool call 下先到者占名额，后到者立即被拒，任何情况不超 MAX_SEARCHES
      if (!state.reserveSearchSlot()) {
        throw new Error(
          `Search budget exhausted: at most ${MAX_SEARCHES} searches per research run. Do not search again; answer from the pages you already fetched.`,
        );
      }

      const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`;

      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        throw new Error(`Search request failed: HTTP ${res.status}`);
      }

      const html = await res.text();
      const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];

      const stats: SearchStats = { raw: 0, kept: 0, deduped: 0, filtered: 0 };
      const results: SearchResult[] = [];
      // 结果内 URL 去重：Bing 偶尔返回重复 URL，key 用规范化后的地址
      const seenUrls = new Set<string>();
      // 相关性判断用的 query 词项，解析一次复用
      const { tokens: queryTokens, latinCount: queryLatinCount } = tokenize(query);

      for (const block of blocks) {
        const linkMatch = block.match(
          /<h2[^>]*>\s*<a[^>]*href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/,
        );
        if (!linkMatch) continue;

        const snippetMatch =
          block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ??
          block.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);

        const result = {
          url: decodeHtml(linkMatch[1]),
          title: stripTags(linkMatch[2]),
          snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
        };
        // 空标题 / 空 URL 直接丢弃
        if (!result.title || !result.url) continue;
        stats.raw++;

        // 明显无效 URL：只保留 http/https（挡住 javascript:/data:/mailto: 等）
        if (!/^https?:\/\//i.test(result.url)) {
          stats.filtered++;
          continue;
        }

        // 明显的文件直链：pdf/zip/exe 等不是可阅读的网页正文；
        // 畸形 URL 无法解析时同样按无效丢弃
        let pathname = '';
        try {
          pathname = new URL(result.url).pathname;
        } catch {
          stats.filtered++;
          continue;
        }
        if (BLOCKED_FILE_RE.test(pathname)) {
          stats.filtered++;
          continue;
        }

        // 重复 URL：以规范化地址为 key
        const key = state.normalizeUrl(result.url);
        if (seenUrls.has(key)) {
          stats.deduped++;
          continue;
        }

        // 轻量相关性：title+snippet 与 query 存在基础词项重叠才保留，
        // 只拦截明显离谱的结果（中文 query 对英文结果仍可经拉丁词命中）
        if (!isPlausiblyRelevant(queryTokens, queryLatinCount, result.title, result.snippet)) {
          stats.filtered++;
          continue;
        }

        seenUrls.add(key);
        results.push(result);
        stats.kept++;
        if (results.length >= limit) break;
      }

      return { results, stats };
    },
  });
}

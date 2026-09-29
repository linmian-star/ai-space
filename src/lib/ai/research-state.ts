// 单次研究请求的 Research State：本次 runResearch 的搜索/抓取预算、页面缓存与已读资料。
// 每次请求在 runResearch 内新建实例，不同请求之间不共享任何状态。

// 硬预算：由代码强制执行，不依赖模型自觉遵守 Prompt。
export const MAX_SEARCHES = 3;
export const MAX_FETCHES = 5;

// 页面质量等级：fetch_page 提取正文后做确定性判断的结果。
// - usable: 正文长度足够，具有正常连续文本
// - weak: 正文过短或可能主要是导航/片段，价值存疑但保留
// - unusable: 正文为空或明显是 404/错误/登录墙等无效页面
export type FetchQuality = 'usable' | 'weak' | 'unusable';

// 正文切分后的最小检索单元，供后续 Retrieval 使用。
// 不包含 embedding、score 等后续阶段才需要的字段。
export type ResearchChunk = {
  // 全局唯一 id：`${normalizedUrl}#${index}`
  id: string;
  // 规范化后的来源 URL
  sourceUrl: string;
  // 该 chunk 的文本内容
  content: string;
  // 该来源内部的顺序，0-based
  index: number;
};

// ResearchChunk 经 Embedding Model 向量化后的结果，与原 chunk 一一对应。
// 不包含 score、similarity 等检索阶段才需要的字段。
export type EmbeddedChunk = {
  id: string;
  sourceUrl: string;
  content: string;
  index: number;
  // 文本对应的 embedding 向量
  embedding: number[];
};

// 检索结果：chunk 的业务字段 + 与 query 的相似度分数。
// 不携带 embedding 向量：检索结果只供 buildContext 消费（content/sourceUrl/similarity），
// 向量始终留在 LanceDB 表内用于计算 _distance，无需回传到应用层。
export type RetrievedChunk = {
  id: string;
  sourceUrl: string;
  content: string;
  index: number;
  // 与 query 向量的 cosine similarity，范围 [-1, 1]
  similarity: number;
};

// 一次成功抓取的页面资料。
export type FetchedSource = {
  // 规范化后的 URL（同时作为缓存 key）
  url: string;
  // 经 main/article 提取与去噪后的纯文本正文
  content: string;
  // 页面质量等级（不删除 content，仅标记供后续阶段参考）
  quality: FetchQuality;
  // 正文切分后的 chunk 列表（供后续 Retrieval 使用）
  chunks: ResearchChunk[];
  // chunk 向量化后的结果（与 chunks 一一对应，供后续相似度检索使用）
  embeddings: EmbeddedChunk[];
};

// 研究阶段结束时模型提交的结构化摘要，供 Synthesis 阶段使用。
export type ResearchBrief = {
  // 已从实际 fetch 内容中确认的关键发现
  findings: string[];
  // 当前仍然无法确认的信息（可以为空）
  unresolved: string[];
  // 最终准备作为依据的 URL（必须来自已成功 fetch 的页面）
  sourceUrls: string[];
};

export type ResearchState = {
  readonly searchCount: number;
  readonly fetchCount: number;
  // 已成功抓取的页面：规范化 URL → 资料（后续 Synthesis 阶段可直接引用）
  readonly fetchedSources: ReadonlyMap<string, FetchedSource>;
  // 研究是否已通过 finish_research 正常结束
  readonly researchComplete: boolean;
  // 研究阶段提交的结构化摘要（researchComplete 为 true 时有值）
  readonly brief: ResearchBrief | null;
  // URL 规范化：补协议、去 hash、去末尾斜杠，统一作为去重与缓存 key
  normalizeUrl(raw: string): string;
  // 原子预留一次搜索名额：无剩余名额返回 false（不消耗），有则计数并返回 true。
  // 检查与预留必须在同一同步操作内完成——若拆成 canSearch + recordSearch 两步，
  // 并发 tool call 会在两步之间双双通过检查，导致实际放行次数超过 MAX_SEARCHES。
  // 名额在发起 Bing 请求前预留（无论请求成败都计数），防止失败重试绕过预算。
  reserveSearchSlot(): boolean;
  canFetch(): boolean;
  // 发起新抓取前调用，消耗一次抓取额度（无论成败都计数，防止失败重试绕过预算）
  beginFetch(): void;
  getCachedFetch(url: string): FetchedSource | undefined;
  // 抓取成功后写入缓存（含质量等级、chunk 列表与 embedding）
  recordFetch(url: string, content: string, quality: FetchQuality, chunks: ResearchChunk[], embeddings: EmbeddedChunk[]): void;
  // finish_research 调用：写入 brief 并标记研究结束
  markResearchComplete(brief: ResearchBrief): void;
};

// 纯函数：URL 规范化，search 去重与 fetch 缓存共用同一规则。
export function normalizeUrl(raw: string): string {
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    // 解析失败时返回仅补了协议的结果，不阻断工具循环
    return value;
  }
}

export function createResearchState(): ResearchState {
  let searchCount = 0;
  let fetchCount = 0;
  const fetchedSources = new Map<string, FetchedSource>();
  let researchComplete = false;
  let brief: ResearchBrief | null = null;

  return {
    get searchCount() {
      return searchCount;
    },
    get fetchCount() {
      return fetchCount;
    },
    get fetchedSources() {
      return fetchedSources;
    },
    get researchComplete() {
      return researchComplete;
    },
    get brief() {
      return brief;
    },
    normalizeUrl,
    reserveSearchSlot: () => {
      if (searchCount >= MAX_SEARCHES) return false;
      searchCount += 1;
      return true;
    },
    canFetch: () => fetchCount < MAX_FETCHES,
    beginFetch: () => {
      fetchCount += 1;
    },
    getCachedFetch: (url) => fetchedSources.get(normalizeUrl(url)),
    recordFetch: (url, content, quality, chunks, embeddings) => {
      const normalized = normalizeUrl(url);
      fetchedSources.set(normalized, { url: normalized, content, quality, chunks, embeddings });
    },
    markResearchComplete: (b) => {
      brief = b;
      researchComplete = true;
    },
  };
}

import { embed } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import type { EmbeddedChunk, ResearchChunk } from './research-state';

// Embedding 模型：与 chat 模型共享同一 OPENROUTER_API_KEY，但使用不同的模型。
// nvidia/nemotron-3-embed-1b:free：OpenRouter 免费 embedding 模型。
export const embeddingModel = openrouter.textEmbeddingModel(
  'nvidia/nemotron-3-embed-1b:free',
);

// 可注入的 embedding 函数类型，便于测试时用 mock 替换真实网络调用。
export type EmbedFn = (text: string) => Promise<number[]>;

// 默认实现：调用真实 OpenRouter Embedding API
export const defaultEmbed: EmbedFn = async (text) => {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  });
  return embedding;
};

// 将单个 ResearchChunk 向量化为 EmbeddedChunk。
// 保留原 chunk 的 id / sourceUrl / content / index，新增 embedding 字段。
// 失败时抛出清晰错误，不静默吞掉，不修改已有 fetch / research 状态。
export async function embedChunk(
  chunk: ResearchChunk,
  embedFn: EmbedFn = defaultEmbed,
): Promise<EmbeddedChunk> {
  const embedding = await embedFn(chunk.content);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(
      `Embedding failed for chunk ${chunk.id}: received empty or non-array result`,
    );
  }
  return {
    id: chunk.id,
    sourceUrl: chunk.sourceUrl,
    content: chunk.content,
    index: chunk.index,
    embedding,
  };
}

// 批量 embedding 的固定并发度：同一时间最多 4 个请求在途。
// 不使用无界 Promise.all(chunks.map(...))，避免一次性打出大量 API 请求。
const EMBED_CONCURRENCY = 4;

// 批量将 ResearchChunk 列表向量化（有限并发，worker pool 模式）。
// 容错策略：单个 chunk embedding 失败时跳过该 chunk（记录 warn），
// 继续处理其余 chunk，返回仅包含成功项的 EmbeddedChunk[]。
// 这样一个 chunk 的网络抖动不会导致整页内容无法进入 state / Vector DB。
// 结果按输入位置写入，再过滤掉失败留下的 undefined 空洞（顺序与原 chunks 一致）。
export async function embedChunks(
  chunks: ResearchChunk[],
  embedFn: EmbedFn = defaultEmbed,
): Promise<EmbeddedChunk[]> {
  const results: (EmbeddedChunk | undefined)[] = new Array(chunks.length);
  // 下一个待领取的 chunk 下标：领取是同步操作，多个 worker 之间不会重复领取
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < chunks.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await embedChunk(chunks[index], embedFn);
      } catch (error) {
        // 单个 chunk 失败：记录可观测日志，跳过该位置，继续处理剩余 chunk
        console.warn(
          `[embedChunks] embedding failed for chunk ${chunks[index].id}, skipping:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  };

  // worker 数量不超过 chunk 数量：空列表时 0 个 worker，Promise.all([]) 直接返回 []
  const workerCount = Math.min(EMBED_CONCURRENCY, chunks.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  // 过滤失败留下的 undefined 空洞，只返回成功的 EmbeddedChunk
  return results.filter(
    (r): r is EmbeddedChunk => r !== undefined,
  );
}

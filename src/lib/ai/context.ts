import type { RetrievedChunk } from './research-state';

// RAG Context 构建层：把 Retrieval 返回的 Top-K RetrievedChunk
// 格式化为可直接注入 LLM prompt 的纯文本。
//
// 职责边界：只负责格式化检索结果。
// 不负责搜索 / Fetch / Embedding / Retrieval / 调用 LLM，也不修改原始 chunk 数据。

// 空 chunks 或全部 chunk 都没有有效 content 时返回的明确占位文本。
const EMPTY_CONTEXT = 'No relevant context found.';

// 将单个 RetrievedChunk 格式化为一个 Source 文本块。
function formatChunk(chunk: RetrievedChunk, order: number): string {
  // similarity 保留 4 位小数，方便调试；范围理论上是 [-1, 1]
  const similarity = chunk.similarity.toFixed(4);
  return [
    `[Source ${order}]`,
    `URL: ${chunk.sourceUrl}`,
    `Similarity: ${similarity}`,
    'Content:',
    chunk.content.trim(),
  ].join('\n');
}

// 把 Top-K 检索结果整理为 LLM 可用的文本 Context。
// 顺序与 retrieveTopK 返回顺序一致（已按 similarity 降序）。
export function buildContext(chunks: RetrievedChunk[]): string {
  // 跳过 content 为空（或纯空白）的 chunk
  const valid = chunks.filter((chunk) => chunk.content.trim().length > 0);

  if (valid.length === 0) {
    return EMPTY_CONTEXT;
  }

  return valid
    .map((chunk, i) => formatChunk(chunk, i + 1))
    .join('\n\n');
}

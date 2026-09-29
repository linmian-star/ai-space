import type { EmbeddedChunk, RetrievedChunk } from './research-state';
import type { EmbedFn } from './embedding';
import { defaultEmbed } from './embedding';

// ── Cosine Similarity（旧内存检索实现，已由 LanceDB Vector Store 取代）──
// 生产链路现在使用 vector-store.ts 的 cosine ANN 检索；
// 这两个纯函数暂时保留作为参考实现与历史测试依赖，暂无生产调用者，可在后续清理中删除。
// 公式：cos(A, B) = (A · B) / (|A| × |B|)
// 不使用任何第三方向量数据库或数学库。

/** @deprecated 已由 VectorStore（LanceDB cosine 检索）取代，仅保留作参考/测试。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new Error('cosineSimilarity: both arguments must be arrays');
  }
  if (a.length === 0 || b.length === 0) {
    throw new Error('cosineSimilarity: vectors must not be empty');
  }
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (a=${a.length}, b=${b.length})`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  // 零向量：至少一个向量的模为 0，无法计算角度，抛出明确错误
  if (normA === 0 || normB === 0) {
    throw new Error('cosineSimilarity: zero vector has undefined direction');
  }

  return dot / (normA * normB);
}

// ── Query Embedding ──
// 用户查询也使用与 chunk 相同的 Embedding Model，不创建第二套 Provider。

export async function embedQuery(
  query: string,
  embedFn: EmbedFn = defaultEmbed,
): Promise<number[]> {
  const vector = await embedFn(query);
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(
      'embedQuery: received empty or non-array result from embedding model',
    );
  }
  return vector;
}

// ── Top-K Retrieval（旧内存实现，已由 VectorStore.search 取代）──
// 遍历所有 chunks → 逐个计算 cosine similarity → 降序排序 → 取前 topK。
/** @deprecated 已由 VectorStore.search（LanceDB）取代，仅保留作参考/测试。 */
export function retrieveTopK(
  queryVector: number[],
  chunks: EmbeddedChunk[],
  topK: number,
): RetrievedChunk[] {
  if (topK <= 0) {
    throw new Error(`retrieveTopK: topK must be positive, got ${topK}`);
  }

  // 空 chunks：安全返回空数组，不报错
  if (chunks.length === 0) {
    return [];
  }

  const scored: RetrievedChunk[] = chunks.map((chunk) => ({
    id: chunk.id,
    sourceUrl: chunk.sourceUrl,
    content: chunk.content,
    index: chunk.index,
    similarity: cosineSimilarity(queryVector, chunk.embedding),
  }));

  // 降序排序
  scored.sort((x, y) => y.similarity - x.similarity);

  // topK > chunks.length 时安全返回全部，不产生 undefined
  return scored.slice(0, Math.min(topK, scored.length));
}

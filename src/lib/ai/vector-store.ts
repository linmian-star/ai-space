// Vector Store：把 EmbeddedChunk 的向量与必要 metadata 写入嵌入式向量库 LanceDB，
// 并提供基于向量的相似度检索，替代原来的「内存遍历 + cosineSimilarity + sort + slice」。
//
// 设计约束：
// - 每个 runResearch 请求创建一个独立的、请求隔离的 store（独立 table 名），
//   请求结束后 drop，保证不同请求之间绝不共享向量数据（与 ResearchState 的隔离原则一致）。
// - LanceDB 是嵌入式文件型向量库（无需独立服务进程），数据落在项目 .data/lancedb 下。
// - 距离度量使用 cosine：LanceDB 返回的 _distance = 1 - cosine similarity，
//   因此 similarity = 1 - _distance，与原 retrieval.ts 的语义保持一致。

import * as lancedb from '@lancedb/lancedb';
import path from 'node:path';
import type { EmbeddedChunk, RetrievedChunk } from './research-state';

// 与 embedding.ts 中 nvidia/nemotron-3-embed-1b:free 的实际维度保持一致。
export const EMBEDDING_DIM = 2048;

// LanceDB 数据文件目录。
// 本地开发：项目根/.data/lancedb。
// Vercel Serverless：函数实例的文件系统只读，只有 /tmp 可写，故落到 /tmp 下。
// 这与请求级隔离语义天然吻合：/tmp 本就是实例级临时目录，随实例回收而清理。
const DB_DIR = process.env.VERCEL
  ? path.join('/tmp', '.data', 'lancedb')
  : path.join(process.cwd(), '.data', 'lancedb');

// VectorStore 最小抽象：只暴露 RAG 当前需要的两个能力 + 资源释放。
// 未来如需替换为 Qdrant / pgvector，只需提供同接口的新实现。
export interface VectorStore {
  // 写入/更新 chunk 向量。以 chunk.id 为主键，相同 id 覆盖而非产生重复（幂等）。
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  // 用 query 向量做相似度检索，返回按 similarity 降序的 Top-K。
  // 空库时返回 []；维度不符时抛出明确错误。
  search(queryVector: number[], topK: number): Promise<RetrievedChunk[]>;
  // 请求结束释放资源（删除请求隔离的 table）。
  close(): Promise<void>;
}

// LanceDB 表中的行结构：向量列 embedding + metadata 列。
type LanceRow = {
  id: string;
  sourceUrl: string;
  content: string;
  chunkIndex: number;
  embedding: number[];
};

function toRows(chunks: EmbeddedChunk[]): LanceRow[] {
  return chunks.map((chunk) => {
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `VectorStore upsert: chunk ${chunk.id} embedding dimension must be ${EMBEDDING_DIM}, got ${chunk.embedding?.length}`,
      );
    }
    return {
      id: chunk.id,
      sourceUrl: chunk.sourceUrl,
      content: chunk.content,
      chunkIndex: chunk.index,
      embedding: chunk.embedding,
    };
  });
}

// 把 LanceDB 返回行（含 _distance）转换为现有 RAG 使用的 RetrievedChunk。
// cosine 距离下 similarity = 1 - _distance，并夹到 [-1, 1] 消除浮点误差。
// 不转换/携带 embedding 列：向量留在表内，检索结果不携带向量（下游无消费者）。
//
// 局部容错：无效 row 返回 null（由 search() 过滤跳过），单条坏 row 不影响其他 row：
// - content 必须是真正的 string 且 trim 后非空——避免 undefined/null 被
//   String() 强转成 "undefined"/"null" 垃圾文本，绕过 buildContext 的空内容
//   过滤混入 Synthesis prompt
// - _distance 缺失时兜底为 1（similarity = 0）；NaN/±Infinity 会使 similarity
//   非有限，整条跳过（distance 有限 ⇒ similarity 必为有限数）
// 导出仅供测试脚本直接验证纯函数逻辑。
export function rowToRetrieved(row: Record<string, unknown>): RetrievedChunk | null {
  const content = row.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  const rawDistance = row._distance;
  const distance = typeof rawDistance === 'number' ? rawDistance : 1;
  if (!Number.isFinite(distance)) {
    return null;
  }

  return {
    id: String(row.id),
    sourceUrl: String(row.sourceUrl),
    content,
    index: Number(row.chunkIndex),
    similarity: Math.max(-1, Math.min(1, 1 - distance)),
  };
}

// 创建一个请求隔离的 LanceDB Vector Store。
export async function createVectorStore(): Promise<VectorStore> {
  const db = await lancedb.connect(DB_DIR);
  // 每次请求唯一的表名，结束时 drop；不与其他请求共享数据。
  const tableName = `research_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
  let table: lancedb.Table | null = null;

  return {
    async upsert(chunks: EmbeddedChunk[]): Promise<void> {
      if (chunks.length === 0) return;
      const rows = toRows(chunks);

      if (table === null) {
        // 第一批数据：直接建表（LanceDB 从等长 number[] 推断 embedding 为
        // fixed-size-list<float>[2048]）
        table = await db.createTable(tableName, rows, { mode: 'overwrite' });
        return;
      }

      // 后续批次：以 id 为主键 merge insert——存在则更新，不存在则插入，
      // 保证相同 chunk id 永远不产生重复行。
      await table
        .mergeInsert('id')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(rows);
    },

    async search(queryVector: number[], topK: number): Promise<RetrievedChunk[]> {
      if (topK <= 0) {
        throw new Error(`VectorStore search: topK must be positive, got ${topK}`);
      }
      if (!Array.isArray(queryVector) || queryVector.length === 0) {
        throw new Error('VectorStore search: queryVector must be a non-empty array');
      }
      if (queryVector.length !== EMBEDDING_DIM) {
        throw new Error(
          `VectorStore search: queryVector dimension must be ${EMBEDDING_DIM}, got ${queryVector.length}`,
        );
      }

      // 还没有任何 chunk 写入（例如所有 fetch 都失败）：安全返回空结果
      if (table === null) return [];

      const rows = (await table
        .query()
        .nearestTo(queryVector)
        .distanceType('cosine')
        // 只取业务列，不回传向量列（similarity 由 _distance 计算，无需向量）：
        // 检索结果不携带 2048 维 embedding，省掉 Arrow 向量的解包与内存占用。
        // 显式 select '_distance'：当前版本 LanceDB 在指定列时仍会自动附带，
        // 但未来版本将不再附带，必须显式声明才能保证 similarity 计算不退化。
        .select(['id', 'sourceUrl', 'content', 'chunkIndex', '_distance'])
        .limit(topK)
        .toArray()) as Record<string, unknown>[];

      // LanceDB 已按 cosine 距离升序返回（= similarity 降序）。
      // 过滤掉无效 row：单条坏数据被跳过，不影响其他正常 chunk，顺序保持不变。
      return rows
        .map(rowToRetrieved)
        .filter((r): r is RetrievedChunk => r !== null);
    },

    async close(): Promise<void> {
      // 从未写入过 chunk 时 table 尚未创建，dropTable 会抛 "not found"——
      // 这种情况视为清理成功。
      const hadTable = table !== null;
      table = null;
      if (hadTable) {
        await db.dropTable(tableName);
      }
    },
  };
}

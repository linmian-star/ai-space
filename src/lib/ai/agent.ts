import {
  streamText,
  convertToModelMessages,
  isStepCount,
  createUIMessageStream,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { chatModel } from './models';
import {
  createResearchState,
  type ResearchState,
} from './research-state';
import { createResearchTools } from './tools';
import { embedQuery } from './retrieval';
import { createVectorStore, type VectorStore } from './vector-store';
import { buildContext } from './context';
import { evaluateSynthesis, buildRetryFeedback } from './evaluation';
import type { EmbedFn } from './embedding';

// Research Stage：模型在此阶段使用 search / fetch_page 收集资料，
// 收集到足够资料后调用 finish_research 结束研究。
const RESEARCH_SYSTEM_PROMPT = `你是一个研究助手。请按以下步骤工作：

1. 使用 search 工具搜索相关信息
2. 使用 fetch_page 工具阅读最相关页面的正文
3. 当已有足够资料回答用户问题时，调用 finish_research 工具结束研究

规则：
- findings 必须基于实际 fetch_page 读到的正文内容，不得编造
- sourceUrls 必须来自实际成功 fetch_page 的页面 URL
- 如果信息不足，可以继续搜索和阅读
- 调用 finish_research 之后不要再调用任何工具
- 搜索最多 3 次，页面抓取最多 5 次（由代码强制执行）`;

// Synthesis Stage：不包含任何工具，仅根据 Research 阶段收集的资料生成最终回答。
const SYNTHESIS_SYSTEM_PROMPT = `你是一个综合分析助手。请根据已经获取的研究资料，回答用户的原始问题。

规则：
- 回答必须基于提供的页面正文内容，不得编造
- 如果提供的资料中有无法确认的内容，明确标注为信息缺口
- 如果研究阶段因预算耗尽而未正常结束（没有结构化摘要），基于已有资料尽力回答，并说明研究未充分完成
- 回答末尾附上参考来源的 URL
- 输出一段完整的中文回答`;

// Synthesis 阶段从全部已 embedding 的 chunk 中检索的 Top-K 数量。
// 每个 chunk 最多 1500 字符，8 个约 12000 字符的聚焦资料。
export const SYNTHESIS_TOP_K = 8;

// 从 UIMessage[] 中提取最后一条用户消息的纯文本。
function extractUserQuestion(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].parts
        .filter(
          (p): p is { type: 'text'; text: string } => p.type === 'text',
        )
        .map((p) => p.text)
        .join('');
    }
  }
  return '';
}

// RAG 接线：用户问题 → query embedding → Vector Store 相似度检索 → buildContext。
// 不再在 agent 中遍历内存 chunk：检索由 LanceDB 完成。
// embedFn 参数仅供测试注入 mock；生产环境使用默认的真实 Embedding Model。
// 任何 embedding/retrieval 失败时，降级为 buildContext([])
// （返回 "No relevant context found."），保证 Synthesis 一定能继续执行。
export async function buildRetrievedContext(
  question: string,
  vectorStore: VectorStore,
  embedFn?: EmbedFn,
): Promise<string> {
  try {
    const queryVector = await embedQuery(question, embedFn);
    const retrieved = await vectorStore.search(queryVector, SYNTHESIS_TOP_K);
    return buildContext(retrieved);
  } catch (error) {
    // 不静默吞掉：记录服务端警告，但不阻断 Synthesis
    console.warn(
      '[research] retrieval failed, falling back to empty context:',
      error instanceof Error ? error.message : error,
    );
    return buildContext([]);
  }
}

// 构建 Synthesis 阶段的输入文本：用户问题 + 研究 brief + RAG 检索 Context。
// feedback 参数可选：Retry 时传入 Evaluator 反馈，让模型修正上一次回答。
export function buildSynthesisPrompt(
  question: string,
  state: ResearchState,
  context: string,
  feedback?: string,
): string {
  const lines: string[] = [];
  lines.push('## 用户问题');
  lines.push(question);
  lines.push('');

  if (state.researchComplete && state.brief) {
    lines.push('## 研究状态：已正常完成');
    lines.push('');
    lines.push('## 研究发现');
    state.brief.findings.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
    lines.push('');
    if (state.brief.unresolved.length > 0) {
      lines.push('## 未解决问题');
      state.brief.unresolved.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
      lines.push('');
    }
    lines.push('## 参考来源 URL');
    state.brief.sourceUrls.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
    lines.push('');
  } else {
    lines.push(
      '## 研究状态：因预算耗尽而结束，未获得结构化摘要。请基于已有资料回答，并说明研究未充分完成。',
    );
    lines.push('');
  }

  // RAG Context：retrieveTopK 返回的 Top-K 片段（已按 similarity 降序）
  lines.push('## 参考资料（按与用户问题的相关性排序）');
  lines.push(context);
  lines.push('');

  if (context === 'No relevant context found.') {
    lines.push(
      '注意：当前没有检索到任何相关资料。不要假装资料存在或凭空编造；如果资料不足以回答，请明确说明信息不足。',
    );
    lines.push('');
  }

  // Retry 时追加 Evaluator 反馈，让模型知道上一次回答的具体问题
  if (feedback) {
    lines.push(feedback);
    lines.push('');
  }

  return lines.join('\n');
}

// 把已经确定的最终答案字符串构造成 UI message stream。
// 在 Evaluator 判定结束后才调用，保证用户只看到最终答案，
// 不会先看到 Synthesis #1 再看到 Retry 答案。
// 文本按片段分块发送（此时答案已完整生成，这不是 token 级实时流式，
// 仅为了兼容现有 UI 的 text-delta 渲染协议）。
export function createFinalAnswerStream(finalAnswer: string): ReadableStream<UIMessageChunk> {
  const textId = crypto.randomUUID();

  // 按字符数切成小块，避免单个 delta 过大；纯渲染用途。
  const CHUNK = 50;
  const deltas: string[] = [];
  for (let i = 0; i < finalAnswer.length; i += CHUNK) {
    deltas.push(finalAnswer.slice(i, i + CHUNK));
  }

  const parts: UIMessageChunk[] = [
    { type: 'start-step' },
    { type: 'text-start', id: textId },
    ...deltas.map(
      (delta): UIMessageChunk => ({ type: 'text-delta', id: textId, delta }),
    ),
    { type: 'text-end', id: textId },
    { type: 'finish-step' },
  ];

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

// Research Agent：两阶段编排——Research Stage（带工具）→ Synthesis Stage（无工具）。
// 无论 Research 因 finish_research 还是预算耗尽结束，都一定进入 Synthesis。
export async function runResearch(messages: UIMessage[]) {
  const state = createResearchState();
  // 请求隔离的 Vector Store：独立 table，请求结束后 drop
  const vectorStore = await createVectorStore();
  const question = extractUserQuestion(messages);

  return createUIMessageStream({
    execute: async ({ writer }) => {
      try {
      // ── Stage 1: Research ──
      const researchResult = streamText({
        model: chatModel,
        system: RESEARCH_SYSTEM_PROMPT,
        tools: createResearchTools(state, vectorStore),
        // 停止条件：达到 8 步上限，或 finish_research 设置了 researchComplete
        stopWhen: [isStepCount(8), () => state.researchComplete],
        messages: await convertToModelMessages(messages),
      });

      // 手动读取 Research UI 流并转发到 writer，
      // 这样能在 Research 完全结束后再构建 Synthesis 输入。
      const researchUIStream = toUIMessageStream({
        stream: researchResult.stream,
      });
      const reader = researchUIStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
        }
      } catch {
        // Research 流出错时仍进入 Synthesis，基于已获取的资料回答
      }

      // ── Stage 2: Synthesis（无 tools）+ Evaluator 闭环 ──
      // 关键时序：Synthesis #1 与可能的 Retry #2 都不提前发送给用户，
      // 等 Evaluator 判定出 finalAnswer 之后，才通过 writer 输出一次。
      const context = await buildRetrievedContext(question, vectorStore);

      // Synthesis #1：生成完整答案（此时不 merge 到用户流）
      const synthesisPrompt = buildSynthesisPrompt(question, state, context);
      const firstResult = streamText({
        model: chatModel,
        system: SYNTHESIS_SYSTEM_PROMPT,
        prompt: synthesisPrompt,
      });
      const firstAnswer = await firstResult.text;

      // Evaluator #1
      let finalAnswer = firstAnswer;
      try {
        const firstEvaluation = await evaluateSynthesis(
          question,
          context,
          state.brief,
          firstAnswer,
        );
        console.log('[research] evaluation #1:', JSON.stringify(firstEvaluation, null, 2));

        // PASS → 第一次答案即最终答案（finalAnswer 已是 firstAnswer）
        // FAIL → 最多 Retry 1 次 Synthesis（不重做 Research / RAG）
        if (!firstEvaluation.pass) {
          console.warn(
            '[research] evaluation #1 FAIL (score=%d), retrying synthesis...',
            firstEvaluation.score,
          );
          const feedback = buildRetryFeedback(firstEvaluation);
          const retryPrompt = buildSynthesisPrompt(question, state, context, feedback);
          const retryResult = streamText({
            model: chatModel,
            system: SYNTHESIS_SYSTEM_PROMPT,
            prompt: retryPrompt,
          });
          const retryAnswer = await retryResult.text;
          finalAnswer = retryAnswer;

          // Evaluator #2：只记录，无论 PASS/FAIL 都使用第二次答案，绝不第三次重试
          try {
            const retryEvaluation = await evaluateSynthesis(
              question,
              context,
              state.brief,
              retryAnswer,
            );
            console.log('[research] evaluation #2:', JSON.stringify(retryEvaluation, null, 2));
            if (!retryEvaluation.pass) {
              console.warn(
                '[research] retry still FAIL (score=%d), using retry answer as final',
                retryEvaluation.score,
              );
            }
          } catch (error) {
            console.warn(
              '[research] retry evaluation failed (non-blocking):',
              error instanceof Error ? error.message : error,
            );
          }
        }
      } catch (error) {
        // Evaluator #1 自身失败（API/JSON/Zod）→ 降级：使用第一次答案，不 Retry
        console.warn(
          '[research] evaluation failed (non-blocking):',
          error instanceof Error ? error.message : error,
        );
      }

      // 最终答案只在此处发送一次：用户永远只看到 Evaluator 判定后的答案
      writer.merge(createFinalAnswerStream(finalAnswer));
      } finally {
        // 请求结束释放请求隔离的向量表：失败也要清理，不影响已经输出的答案
        try {
          await vectorStore.close();
        } catch (error) {
          console.warn(
            '[research] vector store close failed (non-blocking):',
            error instanceof Error ? error.message : error,
          );
        }
      }
    },
  });
}

import { tool } from 'ai';
import { z } from 'zod';
import type { ResearchState } from '../research-state';

// finish_research 工具：模型在收集到足够资料后调用，标记研究阶段结束。
// 不进行任何网络请求；仅校验 sourceUrls 并写入 ResearchState.brief。
export function createFinishResearchTool(state: ResearchState) {
  return tool({
    description:
      'Call this when you have gathered enough information to answer the user question. This signals that research is complete and synthesis will begin. Do not call any other tools after this.',
    inputSchema: z.object({
      findings: z
        .array(z.string())
        .min(1)
        .describe('Key findings confirmed from fetched page content'),
      unresolved: z
        .array(z.string())
        .optional()
        .describe('Items that could not be confirmed, can be empty'),
      sourceUrls: z
        .array(z.string().min(1))
        .min(1)
        .describe('URLs of pages that were successfully fetched and are the basis for findings'),
    }),
    execute: async ({
      findings,
      unresolved = [],
      sourceUrls,
    }): Promise<{ success: boolean; message: string }> => {
      // 校验：sourceUrls 必须来自本次实际成功 fetch 的页面
      const fetchedUrls = new Set([...state.fetchedSources.keys()]);
      const invalid = sourceUrls.filter(
        (url) => !fetchedUrls.has(state.normalizeUrl(url)),
      );
      if (invalid.length > 0) {
        throw new Error(
          `sourceUrls must be from pages you actually fetched. These URLs were not fetched: ${invalid.join(', ')}`,
        );
      }

      // 规范化后写入 brief
      state.markResearchComplete({
        findings,
        unresolved,
        sourceUrls: sourceUrls.map((url) => state.normalizeUrl(url)),
      });

      return { success: true, message: 'Research completed. Synthesis will begin.' };
    },
  });
}

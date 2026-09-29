import { generateText } from 'ai';
import { z } from 'zod';
import { chatModel } from './models';
import type { ResearchBrief } from './research-state';

// ── EvaluationResult Schema ──
// 用 Zod 定义结构化输出 schema，在 generateText 后手动解析+验证。

// Issue 类型枚举：每个值对应一种具体的质量问题。
const IssueTypeSchema = z.enum([
  'unsupported_claim', // 答案中的陈述在 RAG Context 中找不到依据
  'missing_finding', // brief.findings 中的关键发现未在答案中体现
  'unanswered_question', // 用户问题未被完整回答
  'phantom_citation', // 答案引用了不属于 brief.sourceUrls 的 URL
  'missing_gap_annotation', // 资料不足以支持某结论但未标注信息缺口
]);

// 各维度评分（0-100）
const DimensionsSchema = z.object({
  relevance: z.number().int().min(0).max(100),
  groundedness: z.number().int().min(0).max(100),
  factuality: z.number().int().min(0).max(100),
  citationMatch: z.number().int().min(0).max(100),
  coverage: z.number().int().min(0).max(100),
});

const IssueSchema = z.object({
  type: IssueTypeSchema,
  description: z.string(),
  evidence: z.string().optional(),
});

const EvaluationResultSchema = z.object({
  pass: z.boolean(),
  score: z.number().int().min(0).max(100),
  dimensions: DimensionsSchema,
  issues: z.array(IssueSchema),
  summary: z.string(),
});

// 导出 TypeScript 类型
export type IssueType = z.infer<typeof IssueTypeSchema>;
export type EvaluationIssue = z.infer<typeof IssueSchema>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// Evaluator 的系统 prompt：只根据已有资料做判断，不搜索互联网。
// 要求输出 JSON，因为当前模型不支持 generateObject 的 structured output。
const EVALUATOR_SYSTEM_PROMPT = `你是一个研究质量评估员。你的任务是评估一个研究助手的最终回答的质量。

你必须仅基于提供的资料进行评估，不要使用自身知识判断事实真假，不要搜索互联网。

评估维度：
- relevance（相关性）：回答是否回答了用户的问题
- groundedness（依据性）：回答中的陈述是否能从参考资料中找到依据
- factuality（事实性）：是否存在参考资料中无依据的陈述（100 = 完全无编造）
- citationMatch（引用匹配）：回答中引用的 URL 是否来自合法来源列表
- coverage（覆盖度）：研究发现中的关键发现是否在回答中被体现

每个维度评分 0-100。总分 0-100，60 分以上为 pass=true。

如果发现问题，在 issues 中给出具体类型和描述。不要编造不存在的问题。

issues 的 type 只能是以下值之一：
- unsupported_claim
- missing_finding
- unanswered_question
- phantom_citation
- missing_gap_annotation

你必须输出一个合法的 JSON 对象，不要输出任何其他内容。JSON 格式如下：

{
  "pass": true,
  "score": 85,
  "dimensions": {
    "relevance": 90,
    "groundedness": 80,
    "factuality": 85,
    "citationMatch": 100,
    "coverage": 70
  },
  "issues": [
    {
      "type": "missing_finding",
      "description": "研究发现中提到的缓存策略未在回答中体现",
      "evidence": "findings #2"
    }
  ],
  "summary": "回答整体质量良好，但遗漏了部分研究发现。"
}

只输出 JSON，不要输出 markdown 代码块、不要输出解释性文字。`;

// 构建 Evaluator 的用户 prompt
function buildEvaluatorPrompt(
  question: string,
  context: string,
  brief: ResearchBrief | null,
  answer: string,
): string {
  const lines: string[] = [];

  lines.push('## 用户问题');
  lines.push(question);
  lines.push('');

  if (brief) {
    lines.push('## 研究发现（findings）');
    brief.findings.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
    lines.push('');

    if (brief.unresolved.length > 0) {
      lines.push('## 未解决问题（unresolved）');
      brief.unresolved.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
      lines.push('');
    }

    lines.push('## 合法来源 URL（sourceUrls）');
    brief.sourceUrls.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
    lines.push('');
  } else {
    lines.push('## 研究状态：因预算耗尽而结束，无结构化摘要');
    lines.push('');
  }

  lines.push('## 参考资料（RAG Context）');
  lines.push(context);
  lines.push('');

  lines.push('## 待评估的最终回答');
  lines.push(answer);
  lines.push('');

  return lines.join('\n');
}

// 从 LLM 文本输出中提取 JSON 并用 Zod 验证。
// 模型可能输出 markdown 代码块包裹的 JSON，需兼容处理。
function parseEvaluationResult(text: string): EvaluationResult {
  // 尝试直接解析
  let jsonText = text.trim();

  // 去掉可能的 ```json ... ``` 包裹
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  }

  // 找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(jsonText);
  return EvaluationResultSchema.parse(parsed);
}

// 评估 Synthesis 的最终答案。
// 使用 generateText + JSON prompt + Zod 验证（当前模型不支持 generateObject）。
// 任何失败（API 错误、JSON 解析失败、Zod 验证失败等）都抛出，
// 由调用方（agent.ts）catch 并降级为 console.warn。
export async function evaluateSynthesis(
  question: string,
  context: string,
  brief: ResearchBrief | null,
  answer: string,
): Promise<EvaluationResult> {
  const prompt = buildEvaluatorPrompt(question, context, brief, answer);

  const { text } = await generateText({
    model: chatModel,
    system: EVALUATOR_SYSTEM_PROMPT,
    prompt,
  });

  return parseEvaluationResult(text);
}

// 将 EvaluationResult 转换为给 Synthesis 的修正反馈文本。
// 只提取 issues 和 summary，让模型知道上一次回答的具体问题。
export function buildRetryFeedback(evaluation: EvaluationResult): string {
  const lines: string[] = [];
  lines.push('## 自动评估反馈（上一次回答未通过质量检查，请修正）');
  lines.push(`总分: ${evaluation.score}/100`);
  lines.push(`评估摘要: ${evaluation.summary}`);
  lines.push('');

  if (evaluation.issues.length > 0) {
    lines.push('### 需要修正的问题：');
    evaluation.issues.forEach((issue, i) => {
      lines.push(`${i + 1}. [${issue.type}] ${issue.description}`);
      if (issue.evidence) {
        lines.push(`   证据: ${issue.evidence}`);
      }
    });
    lines.push('');
  }

  lines.push('请根据以上反馈修正你的回答。');
  return lines.join('\n');
}

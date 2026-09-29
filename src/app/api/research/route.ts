import {
  type UIMessage,
  createUIMessageStreamResponse,
} from 'ai';
import { runResearch } from '@/lib/ai/agent';

// Research Agent 端点。route 只负责取参数 → 调能力层 → 返回流。
// runResearch 现在返回 createUIMessageStream 的 ReadableStream（含两阶段），
// route 无需再手动 toUIMessageStream。
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const stream = await runResearch(messages);

  return createUIMessageStreamResponse({ stream });
}

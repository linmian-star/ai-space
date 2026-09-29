import {
  type UIMessage,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from 'ai';
import { getTask } from '@/lib/tasks/config';
import { runTask } from '@/lib/tasks/runner';

// 文本任务统一端点：/api/tasks/[id]
// route 只负责取参数、校验、调用能力层、返回流，业务逻辑都在 lib/tasks。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!getTask(id)) {
    return Response.json({ error: `Unknown task: ${id}` }, { status: 404 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = await runTask(id, messages);

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}

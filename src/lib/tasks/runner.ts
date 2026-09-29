import {
  streamText,
  convertToModelMessages,
  type UIMessage,
} from 'ai';
import { chatModel } from '@/lib/ai/models';
import { getTask } from './config';

// 所有文本任务的统一执行入口：按 id 取任务配置，注入其 system prompt 后调用模型。
// 未知任务 id 抛错，由 route 层处理为 404。
export async function runTask(taskId: string, messages: UIMessage[]) {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  return streamText({
    model: chatModel,
    system: task.systemPrompt,
    // v7 中 convertToModelMessages 返回 Promise，必须 await（与 chat route 保持一致）
    messages: await convertToModelMessages(messages),
  });
}

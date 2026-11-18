import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from 'ai';
import { chatModel, visionModel } from '@/lib/ai/models';

// 消息里只要出现图片，就必须切到视觉模型；否则纯文本模型会返回 400。
function hasImagePart(messages: UIMessage[]): boolean {
  return messages.some(message =>
    message.parts?.some(
      part => part.type === 'file' && part.mediaType.startsWith('image/'),
    ),
  );
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: hasImagePart(messages) ? visionModel : chatModel,
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}

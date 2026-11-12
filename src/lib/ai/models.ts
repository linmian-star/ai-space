import { createOpenAI } from '@ai-sdk/openai';

// 智谱 BigModel 提供 OpenAI 兼容接口（/chat/completions、/embeddings）。
// API Key 形如 id.secret，读取环境变量 ZHIPU_API_KEY。
//
// fetch 包装的作用：glm-4.6 默认开启思考链，首字节要 20s+；
// 显式关闭后同样问题 3~5s 返回，且已实测不影响 tool calling。
// 这里统一注入 thinking.disabled，避免每条业务链路各写一遍。
export const zhipu = createOpenAI({
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY,
  fetch: async (input, init) => {
    if (init?.body && typeof init.body === 'string' && String(input).includes('/chat/completions')) {
      try {
        const body = JSON.parse(init.body);
        body.thinking = { type: 'disabled' };
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        // 非 JSON body 原样透传
      }
    }
    return fetch(input, init);
  },
});

// 全项目唯一的默认模型来源。Chat / Tasks / Research 共用，换 slug 只改这里。
// glm-4.6：支持 tool calling，Research Agent 的多步工具调用依赖这一点。
export const DEFAULT_MODEL_ID = 'glm-4.6';

// 显式走 .chat()（/chat/completions），不要用 zhipu(id) 让它按模型名猜端点。
export const chatModel = zhipu.chat(DEFAULT_MODEL_ID);

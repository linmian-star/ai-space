import { openrouter } from '@openrouter/ai-sdk-provider';

// 全项目唯一的默认模型来源。Chat / Tasks 共用，换 slug 只改这里。
export const DEFAULT_MODEL_ID = 'inclusionai/ling-3.0-flash-sante:free';

// openrouter() 默认实例自动读取环境变量 OPENROUTER_API_KEY
export const chatModel = openrouter(DEFAULT_MODEL_ID);

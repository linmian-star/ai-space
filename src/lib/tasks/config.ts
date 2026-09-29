// 文本任务的配置定义。新增任务（翻译/抽取等）只需往 TASKS 里加一条，
// route、runner、前端都不需要改动。

export type TaskConfig = {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
};

export const TASKS: TaskConfig[] = [
  {
    id: 'summarize',
    title: '文本摘要',
    description: '将长文本浓缩为 3-5 句话的简洁要点',
    systemPrompt:
      '你是一个专业的文本摘要助手。请把用户提供的文本浓缩为 3-5 句话的简洁要点，使用中文输出。要求：只输出要点本身，每句话一个要点，不要添加标题、前言或额外解释。',
  },
];

export function getTask(id: string): TaskConfig | undefined {
  return TASKS.find(task => task.id === id);
}

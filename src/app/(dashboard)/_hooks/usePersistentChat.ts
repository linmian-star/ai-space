'use client';

// 带 localStorage 持久化的 useChat —— 三个对话页面（chat/tasks/research）共用。
//
// 对外返回值与 useChat 完全一致（多了 hydrated / clearHistory），
// 页面里的发送、流式接收、渲染逻辑一行都不用改——「包装而非替换」。
//
// 三条关键设计：
// 1. 单一事实来源 = useChat 的 messages state。localStorage 只是它的存档投影，
//    绝不在保存时读旧存档参与合并（避免陈旧闭包 + 存储双写导致消息覆盖/回退）。
// 2. 水合安全：第一次渲染不碰 localStorage（服务器与浏览器首次渲染一致），
//    在 useEffect 中恢复，绝不触发 Next.js SSR hydration mismatch。
// 3. 防抖落盘：流式输出 messages 高频变化时静默 400ms 才写一次；
//    status 回到 ready 后立即补写一次，保证最终内容不依赖计时器。

import { useChat, type UseChatHelpers, type UseChatOptions } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSession,
  loadSession,
  newSessionId,
  saveSession,
} from '@/lib/chat-storage';

const SAVE_DEBOUNCE_MS = 400;

type PersistentOptions<UI_MESSAGE extends UIMessage> = UseChatOptions<UI_MESSAGE> & {
  // localStorage 存储标识：'chat' | 'tasks' | 'research'
  storageKey: string;
};

export interface PersistentChatHelpers<UI_MESSAGE extends UIMessage>
  extends UseChatHelpers<UI_MESSAGE> {
  // 水合恢复是否完成；完成前页面显示「正在恢复历史…」占位，避免空白闪烁
  hydrated: boolean;
  // 清空当前对话并删除存档
  clearHistory: () => void;
}

export function usePersistentChat<UI_MESSAGE extends UIMessage = UIMessage>(
  options: PersistentOptions<UI_MESSAGE>,
): PersistentChatHelpers<UI_MESSAGE> {
  const { storageKey, ...chatOptions } = options;
  const chat = useChat(chatOptions);
  const { messages, setMessages, status } = chat;

  const [hydrated, setHydrated] = useState(false);

  // 会话元数据快照：水合时从存档带出，之后只在内存维护；
  // 保存时与当前 messages 一起整体写入（存储层不参与合并）。
  const sessionIdRef = useRef<string | null>(null);
  const createdAtRef = useRef(0);
  const hydratedRef = useRef(false);

  // 让防抖回调/卸载场景始终读到最新值，又不把它们放进 effect 依赖反复重绑。
  // 注意：ref 只能在 effect 中同步（React 19 规则禁止 render 期间写 ref）。
  const messagesRef = useRef(messages);
  const storageKeyRef = useRef(storageKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 声明在防抖/落盘 effect 之前，保证 commit 后 flush 读到的 ref 已更新。
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    storageKeyRef.current = storageKey;
  }, [storageKey]);

  // 立即落盘（防抖静默后 / 流结束时调用）。
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!hydratedRef.current) return;

    const current = messagesRef.current;
    if (current.length === 0) {
      // 对话被清空：同步删掉元数据与存档。
      sessionIdRef.current = null;
      createdAtRef.current = 0;
      clearSession(storageKeyRef.current);
      return;
    }

    if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
    if (!createdAtRef.current) createdAtRef.current = Date.now();

    saveSession(storageKeyRef.current, {
      id: sessionIdRef.current,
      createdAt: createdAtRef.current,
      messages: current,
    });
  }, []);

  // ① 水合后恢复历史（只在 storageKey 变化时执行一次）。
  // 从 localStorage（浏览器外部数据源）同步到 React state 是 effect 的正当用途：
  // 首次 render 不能读 localStorage，否则 SSR 与客户端首帧不一致。
  useEffect(() => {
    const stored = loadSession(storageKey);
    if (stored && stored.messages.length > 0) {
      sessionIdRef.current = stored.id;
      createdAtRef.current = stored.createdAt;
      setMessages(stored.messages as UI_MESSAGE[]);
    }
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部存储水合只能在 effect 后触发
    setHydrated(true);
    // setMessages 引用稳定，storageKey 三页均为常量。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // ② messages 变化 → 防抖落盘。水合未完成时不调度（防止空数组覆盖存档）。
  useEffect(() => {
    if (!hydrated) return;
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [messages, hydrated, flush]);

  // ③ 流结束（ready）立即补写一次最终内容。
  useEffect(() => {
    if (hydrated && status === 'ready') flush();
  }, [status, hydrated, flush]);

  const clearHistory = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    sessionIdRef.current = null;
    createdAtRef.current = 0;
    clearSession(storageKeyRef.current);
    setMessages([] as UI_MESSAGE[]);
  }, [setMessages]);

  return { ...chat, hydrated, clearHistory };
}

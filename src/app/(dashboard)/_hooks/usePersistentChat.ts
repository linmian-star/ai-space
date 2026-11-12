'use client';

// 带 localStorage 持久化的 useChat —— 三个对话页面（chat/tasks/research）共用。
//
// 对外返回值与 useChat 完全一致（多了 hydrated / sessions / activeSessionId /
// switchSession / startNewSession / clearHistory），页面里的发送、流式接收、渲染逻辑
// 一行都不用改——「包装而非替换」。
//
// 三条关键设计：
// 1. 单一事实来源 = useChat 的 messages state。localStorage 只是它的存档投影，
//    绝不在保存时读旧存档参与合并（避免陈旧闭包 + 存储双写导致消息覆盖/回退）。
// 2. 水合安全：第一次渲染不碰 localStorage（服务器与浏览器首次渲染一致），
//    在 useEffect 中恢复，绝不触发 Next.js SSR hydration mismatch。
// 3. 防抖落盘：流式输出 messages 高频变化时静默 400ms 才写一次；
//    status 回到 ready 后立即补写一次，保证最终内容不依赖计时器。
//
// 多会话模式（v2 新增）：
// - options 可选 activeSessionId：传入则按 id 精确恢复；不传则取最近更新的会话
//   （tasks / research 页不传，保持单会话旧行为完全不变）。
// - 切换会话必须先 stop() 停掉当前流、flush() 落盘，再 setMessages 目标会话，
//   避免正在流式输出的消息被存档覆盖。

import { useChat, type UseChatHelpers, type UseChatOptions } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSession,
  deleteSession,
  listSessions,
  loadSession,
  loadSessionById,
  newSessionId,
  saveSession,
  type SessionMeta,
} from '@/lib/chat-storage';

const SAVE_DEBOUNCE_MS = 400;

type PersistentOptions<UI_MESSAGE extends UIMessage> = UseChatOptions<UI_MESSAGE> & {
  // localStorage 存储标识：'chat' | 'tasks' | 'research'
  storageKey: string;
  // 可选：指定恢复哪个会话（多会话模式用）；不传则取最近一条
  activeSessionId?: string | null;
};

export interface PersistentChatHelpers<UI_MESSAGE extends UIMessage>
  extends UseChatHelpers<UI_MESSAGE> {
  // 水合恢复是否完成；完成前页面显示「正在恢复历史…」占位，避免空白闪烁
  hydrated: boolean;
  // 当前激活会话 id（可能为 null = 新对话，尚未落盘）
  activeSessionId: string | null;
  // 按 updatedAt 倒序的会话列表（轻量元数据，不带 messages）
  sessions: SessionMeta[];
  // 切到指定会话；正在流式输出时会先停止
  switchSession: (id: string) => void;
  // 开新对话（清空当前 messages，不删任何存档）
  startNewSession: () => void;
  // 删除当前会话的存档（清空页面 + 从列表移除）
  clearHistory: () => void;
  // 手动刷新 sessions 列表（Sidebar 可订阅）
  refreshSessions: () => void;
}

export function usePersistentChat<UI_MESSAGE extends UIMessage = UIMessage>(
  options: PersistentOptions<UI_MESSAGE>,
): PersistentChatHelpers<UI_MESSAGE> {
  const { storageKey, activeSessionId, ...chatOptions } = options;
  const chat = useChat(chatOptions);
  const { messages, setMessages, status, stop } = chat;

  const [hydrated, setHydrated] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  // 会话元数据快照：水合时从存档带出，之后只在内存维护；
  // 保存时与当前 messages 一起整体写入（存储层不参与合并）。
  const sessionIdRef = useRef<string | null>(null);
  const createdAtRef = useRef(0);
  const hydratedRef = useRef(false);

  // 让防抖回调/卸载场景始终读到最新值，又不把它们放进 effect 依赖反复重绑。
  // 注意：ref 只能在 effect 中同步（React 19 规则禁止 render 期间写 ref）。
  const messagesRef = useRef(messages);
  const storageKeyRef = useRef(storageKey);
  const activeIdRef = useRef(activeSessionId ?? null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 声明在防抖/落盘 effect 之前，保证 commit 后 flush 读到的 ref 已更新。
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    storageKeyRef.current = storageKey;
  }, [storageKey]);
  useEffect(() => {
    activeIdRef.current = activeSessionId ?? null;
  }, [activeSessionId]);

  // 刷新 sessions 列表（从存储层重新读）。
  const refreshSessions = useCallback(() => {
    if (!hydratedRef.current) return;
    setSessions(listSessions(storageKeyRef.current));
  }, []);

  // 立即落盘（防抖静默后 / 流结束时调用）。
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!hydratedRef.current) return;

    const current = messagesRef.current;
    const sk = storageKeyRef.current;

    if (current.length === 0) {
      // 对话被清空：同步删掉元数据；存档由调用方（clearHistory）处理
      sessionIdRef.current = null;
      createdAtRef.current = 0;
      return;
    }

    if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
    if (!createdAtRef.current) createdAtRef.current = Date.now();

    saveSession(sk, {
      id: sessionIdRef.current,
      createdAt: createdAtRef.current,
      messages: current,
    });
    // 落盘后通知 Sidebar 刷新会话列表（hook 内部 state 更新不影响 Sidebar）
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('sessionchange'));
    }
    // 落盘成功后刷新侧边栏列表（标题可能从「新对话」变成 deriveTitle 结果）
    refreshSessions();
  }, [refreshSessions]);

  // 水合时追踪上一次的 activeSessionId，用于判断「用户主动新建对话」
  // （activeSessionId 从有值 → null，这时不该自动加载最近一条旧会话）
  const prevActiveIdRef = useRef<string | null | undefined>(undefined);

  // ① 水合后恢复历史。
  // 有 activeSessionId → 按 id 精确取；没有 → 取最近一条（旧行为兜底）。
  // 只在 storageKey 或 activeSessionId 变化时执行。
  useEffect(() => {
    const sk = storageKey;
    const targetId = activeSessionId ?? null;
    const prev = prevActiveIdRef.current;
    prevActiveIdRef.current = targetId;

    let stored = null;
    if (targetId) {
      stored = loadSessionById(sk, targetId);
      // id 不存在（被手动删了 / 跨设备）→ 降级取最近一条
      if (!stored) stored = loadSession(sk);
    } else if (prev !== undefined && prev !== null) {
      // activeSessionId 从有值 → null：用户主动新建对话，保持空状态，不自动加载旧会话
      stored = null;
    } else {
      // 首次进入页面 / storageKey 变化：取最近一条（旧行为兜底）
      stored = loadSession(sk);
    }

    if (stored && stored.messages.length > 0) {
      sessionIdRef.current = stored.id;
      createdAtRef.current = stored.createdAt;
      setMessages(stored.messages as UI_MESSAGE[]);
    } else {
      sessionIdRef.current = null;
      createdAtRef.current = 0;
      setMessages([] as UI_MESSAGE[]);
    }

    setSessions(listSessions(sk));
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部存储水合只能在 effect 后触发
    setHydrated(true);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, activeSessionId]);

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

  // ④ storageKey 变化时：清定时器 + 清老 storage 的存档引用（已在 effect ① 处理）。
  //    这里只做卸载清理，防止跨页面跳转时把新页面的 messages 写进老 storageKey。
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [storageKey]);

  // 删除当前会话的存档 + 重置内存态。
  // 多会话模式下只删这一条，不是整个 storageKey。
  const clearHistory = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const sk = storageKeyRef.current;
    if (sessionIdRef.current) {
      deleteSession(sk, sessionIdRef.current);
    }
    sessionIdRef.current = null;
    createdAtRef.current = 0;
    setMessages([] as UI_MESSAGE[]);
    refreshSessions();
    // 同步清掉 URL 参数 + 通知 Sidebar（chat/page 顶部删除按钮用）
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('s')) {
        url.searchParams.delete('s');
        window.history.replaceState({}, '', url.toString());
      }
      window.dispatchEvent(new Event('sessionchange'));
    }
  }, [setMessages, refreshSessions]);

  // 切到指定会话：停流 → 落盘当前 → 加载目标。
  // 目标 id 与当前相同则跳过。
  const switchSession = useCallback(
    (id: string) => {
      // 正在流式输出时先停
      if (status === 'submitted' || status === 'streaming') {
        try { stop(); } catch { /* useChat 未暴露 stop() 时忽略 */ }
      }
      // 先把当前会话落盘（防抖可能还没刷）
      flush();
      // 从存储加载目标
      const sk = storageKeyRef.current;
      const target = loadSessionById(sk, id);
      if (!target) return;
      sessionIdRef.current = target.id;
      createdAtRef.current = target.createdAt;
      setMessages(target.messages as UI_MESSAGE[]);
      refreshSessions();
    },
    [flush, refreshSessions, setMessages, status, stop],
  );

  // 开新对话：停流 → 落盘当前 → 重置元数据 → 清空 messages。
  const startNewSession = useCallback(() => {
    if (status === 'submitted' || status === 'streaming') {
      try { stop(); } catch { /* ignore */ }
    }
    flush();
    sessionIdRef.current = null;
    createdAtRef.current = 0;
    setMessages([] as UI_MESSAGE[]);
  }, [flush, setMessages, status, stop]);

  return {
    ...chat,
    hydrated,
    activeSessionId: sessionIdRef.current,
    sessions,
    switchSession,
    startNewSession,
    clearHistory,
    refreshSessions,
  };
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, ListTodo, Search, Bot, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteSession,
  listSessions,
  type SessionMeta,
} from '@/lib/chat-storage';
import { useUrlSessionId } from '../_hooks/useUrlSessionId';

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
};

const NAV_ITEMS: NavItem[] = [
  { group: '对话', label: 'Chat', href: '/chat', icon: MessageSquare },
  { group: '工具', label: 'Tasks', href: '/tasks', icon: ListTodo },
  { group: '研究', label: 'Research', href: '/research', icon: Search },
];

// pathname → storageKey 映射；不在三个页面上返回 null（历史区块不显示）
function getStorageKey(pathname: string): string | null {
  if (pathname === '/chat') return 'chat';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/research') return 'research';
  return null;
}
// 对应的 href：storageKey 'chat' → '/chat'，用于新建/跳转时的动态路径
const STORAGE_KEY_TO_HREF: Record<string, string> = {
  chat: '/chat',
  tasks: '/tasks',
  research: '/research',
};

// 把时间戳格式化成相对时间（今天/昨天/MM-DD）
function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (isToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isYesterday) return '昨天';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const currentStorageKey = getStorageKey(pathname);
  const currentHref = currentStorageKey ? STORAGE_KEY_TO_HREF[currentStorageKey] : '/chat';

  const activeSessionId = useUrlSessionId();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  // 刷新列表：读当前模块的 localStorage
  const refresh = useCallback(() => {
    if (typeof window === 'undefined' || !currentStorageKey) return;
    setSessions(listSessions(currentStorageKey));
  }, [currentStorageKey]);

  // 初次加载 + 切换到不同模块时刷新
  useEffect(() => {
    refresh();
  }, [refresh, currentStorageKey]);

  // 监听 storage 变更（跨标签同步）+ 内部 sessionchange 事件
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!currentStorageKey) return;
      if (e.key?.startsWith(`ai-space:${currentStorageKey}:`)) refresh();
    };
    const onSessionChange = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('sessionchange', onSessionChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sessionchange', onSessionChange);
    };
  }, [refresh, currentStorageKey]);

  // 按 group 分组导航
  const grouped = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const handleNewChat = () => {
    if (!currentStorageKey) return;
    // 通知当前页面清空 messages（Sidebar 不知道页面的 hook，用事件广播）
    window.dispatchEvent(new Event('clearsession'));
    // 先手动清掉 URL 参数（router.push 是软导航，不会立即改 window.location）
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('s');
      window.history.replaceState({}, '', url.toString());
    }
    router.push(currentHref);
    window.dispatchEvent(new Event('sessionchange'));
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentStorageKey) return;
    deleteSession(currentStorageKey, id);
    // 如果删的是当前激活会话：手动清 URL（不要再 router.push，软导航会覆盖 replaceState）
    if (activeSessionId === id && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('s');
      window.history.replaceState({}, '', url.toString());
    }
    refresh();
    window.dispatchEvent(new Event('sessionchange'));
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      {/* 顶部品牌区 */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold leading-tight">AI Workbench</span>
          <span className="text-[11px] text-muted-foreground leading-tight">Next.js · AI SDK</span>
        </div>
      </div>

      {/* 导航分组 */}
      <nav className="flex shrink-0 flex-col px-2 py-3">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="mb-3">
            <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group}
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {/* Active态左侧竖条 */}
                    {active && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                    )}
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 历史会话区块（仅三个对话页面显示） */}
      {currentStorageKey && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border px-2 py-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              历史
            </span>
            <button
              type="button"
              onClick={handleNewChat}
              title="新建对话"
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {sessions.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                暂无历史
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {sessions.map(s => {
                  const isActive = activeSessionId === s.id;
                  return (
                    <Link
                      key={s.id}
                      href={`${currentHref}?s=${s.id}`}
                      onClick={() => window.dispatchEvent(new Event('sessionchange'))}
                      className={cn(
                        "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <span className="flex-1 truncate" title={s.title}>
                        {s.title || '新对话'}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70 group-hover:hidden">
                        {formatTime(s.updatedAt)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        title="删除"
                        className="hidden shrink-0 h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 group-hover:flex"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部版本号 */}
      <div className="border-t border-border px-4 py-3">
        <div className="text-[11px] text-muted-foreground">
          v0.2.0
        </div>
      </div>
    </aside>
  );
}

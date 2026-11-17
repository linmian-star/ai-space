'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, ListTodo, Search, Bot, Plus, Trash2, Menu, X, PanelLeftClose, PanelLeft } from "lucide-react";
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
};

const NAV_ITEMS: NavItem[] = [
  { label: '对话', href: '/chat', icon: MessageSquare },
  { label: '文本任务', href: '/tasks', icon: ListTodo },
  { label: '联网研究', href: '/research', icon: Search },
];

const SESSION_GROUPS = ['今天', '昨天', '过去 7 天', '更早'];

function getStorageKey(pathname: string): string | null {
  if (pathname === '/chat') return 'chat';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/research') return 'research';
  return null;
}
const STORAGE_KEY_TO_HREF: Record<string, string> = {
  chat: '/chat',
  tasks: '/tasks',
  research: '/research',
};

function getSessionGroup(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.floor((startOfToday - startOfDate) / 86_400_000);

  if (daysAgo <= 0) return '今天';
  if (daysAgo === 1) return '昨天';
  if (daysAgo < 7) return '过去 7 天';
  return '更早';
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const currentStorageKey = getStorageKey(pathname);
  const currentHref = currentStorageKey ? STORAGE_KEY_TO_HREF[currentStorageKey] : '/chat';

  const activeSessionId = useUrlSessionId();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(() => {
    if (typeof window === 'undefined' || !currentStorageKey) return;
    setSessions(listSessions(currentStorageKey));
  }, [currentStorageKey]);

  useEffect(() => {
    const refreshTimer = setTimeout(refresh, 0);
    return () => clearTimeout(refreshTimer);
  }, [refresh]);

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

  const groupedSessions = SESSION_GROUPS.map(label => ({
    label,
    items: sessions.filter(session => getSessionGroup(session.updatedAt) === label),
  })).filter(group => group.items.length > 0);

  const handleNewChat = () => {
    if (!currentStorageKey) return;
    window.dispatchEvent(new Event('clearsession'));
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
    if (activeSessionId === id && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('s');
      window.history.replaceState({}, '', url.toString());
    }
    refresh();
    window.dispatchEvent(new Event('sessionchange'));
  };

  return (
    <>
      {/* 汉堡按钮 - 仅移动端显示 */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="打开侧边栏"
        className={cn(
          'fixed left-3 top-2.5 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-background/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-foreground md:hidden',
          mobileOpen && 'hidden',
        )}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* 遮罩层 - 仅移动端 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* 侧边栏本体 */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
          // 桌面端：常驻，宽度根据 collapsed 切换
          collapsed ? 'md:w-[64px]' : 'md:w-[264px]',
          // 移动端：fixed 滑入
          'w-[280px] fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 md:static md:translate-x-0 md:shrink-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* 品牌区 + 折叠按钮 */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border/70 px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          {!collapsed && (
            <span className="flex-1 truncate text-sm font-semibold tracking-tight md:block">
              AI Workbench
            </span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="折叠侧边栏"
            title="折叠侧边栏"
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭侧边栏"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 折叠后展开按钮 */}
        {collapsed && (
          <div className="shrink-0 px-2 pt-2">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="展开侧边栏"
              title="展开侧边栏"
              className="flex h-9 w-full items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 新建对话按钮 */}
        <div className={cn('shrink-0 pt-3', collapsed ? 'px-2 pb-1' : 'px-3 pb-1')}>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={!currentStorageKey}
            title="新建对话"
            className={cn(
              'flex h-10 w-full items-center rounded-xl border border-sidebar-border bg-background text-sm font-medium shadow-xs transition-all hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
              collapsed ? 'justify-center px-0' : 'gap-2.5 px-3',
            )}
          >
            <Plus className="h-4 w-4" />
            {!collapsed && <span>新建对话</span>}
          </button>
        </div>

        {/* 导航 */}
        <nav className={cn('flex shrink-0 flex-col gap-0.5 py-3', collapsed ? 'px-2' : 'px-3')}>
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-xl text-[13px] transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {/* 历史会话 - 折叠时隐藏 */}
        {currentStorageKey && !collapsed && (
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
            <div className="mb-2 flex items-center justify-between px-3 text-[11px] text-muted-foreground">
              <span>对话记录</span>
              {sessions.length > 0 && <span>{sessions.length}</span>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {sessions.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground/80">
                  暂无历史对话
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedSessions.map(group => (
                    <section key={group.label}>
                      <h2 className="px-3 pb-1.5 text-[11px] font-medium text-muted-foreground/80">
                        {group.label}
                      </h2>
                      <div className="flex flex-col gap-0.5">
                        {group.items.map(session => {
                          const isActive = activeSessionId === session.id;
                          return (
                            <Link
                              key={session.id}
                              href={`${currentHref}?s=${session.id}`}
                              onClick={() => {
                                window.dispatchEvent(new Event('sessionchange'));
                                setMobileOpen(false);
                              }}
                              className={cn(
                                'group flex h-9 items-center gap-1 rounded-lg px-3 text-[13px] transition-colors',
                                isActive
                                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                                  : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                              )}
                            >
                              <span className="flex-1 truncate" title={session.title}>
                                {session.title || '新对话'}
                              </span>
                              <button
                                type="button"
                                onClick={event => handleDeleteSession(event, session.id)}
                                title="删除对话"
                                aria-label="删除对话"
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-destructive opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </Link>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 底部版本号 - 折叠时也显示 */}
        {!collapsed && (
          <div className="shrink-0 border-t border-sidebar-border/70 px-5 py-3 text-[11px] text-muted-foreground/70">
            AI Workbench · v0.2.0
          </div>
        )}
      </aside>
    </>
  );
}

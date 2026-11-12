'use client';

import { useEffect, useState } from 'react';

// 从 URL ?s=<id> 读当前激活的会话 id。
// SSR 安全：首帧不碰 window，useEffect 里才读取。
// 监听 popstate（浏览器前进后退）和 sessionchange（内部导航后手动广播）。
//
// 三个模块（chat / tasks / research）以及 Sidebar 都需要读这个参数，
// 所以抽到 _hooks 下统一复用，避免每个文件都复制 20 行相同代码。
export function useUrlSessionId(): string | null {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return;
      const sp = new URLSearchParams(window.location.search);
      setId(sp.get('s'));
    };
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('sessionchange', read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('sessionchange', read);
    };
  }, []);

  return id;
}

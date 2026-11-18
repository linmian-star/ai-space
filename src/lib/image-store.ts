// 图片仓库（IndexedDB）—— 聊天记录 localStorage 只保存 fileId，
// 压缩后的 base64 全部落在这里，规避 localStorage 5MB 配额。
//
// 设计原则：
// - 所有 API 永不抛错：IndexedDB 在隐私模式 / 被禁用 / 服务端渲染时静默降级，
//   由调用方兜底成「图片已失效」。
// - 单例连接：openDb 只开一次，失败也缓存 null，避免每次读写都重试。
// - 批量删除走单个事务，删除会话时一次清干净，避免存留孤儿图片。

const DB_NAME = 'ai-space-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

export interface StoredImage {
  id: string;
  dataUrl: string;
  mediaType: string;
  filename?: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function createFileId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// 写入一张图片，返回 fileId；失败返回 null（调用方提示即可，不影响对话）。
export async function saveImage(input: {
  dataUrl: string;
  mediaType: string;
  filename?: string;
}): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;

  const record: StoredImage = {
    id: createFileId(),
    dataUrl: input.dataUrl,
    mediaType: input.mediaType,
    filename: input.filename,
    createdAt: Date.now(),
  };

  const ok = await new Promise<boolean>(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });

  return ok ? record.id : null;
}

// 按 fileId 读回图片；不存在或读失败返回 null。
export async function getImage(id: string): Promise<StoredImage | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as StoredImage | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// 批量删除（删除会话时级联清理用）；单事务，失败静默。
export async function deleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  if (!db) return;

  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteImage(id: string): Promise<void> {
  await deleteImages([id]);
}

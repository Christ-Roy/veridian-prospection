const cache = new Map<string, { data: unknown; expires: number }>();

export function cached<T>(key: string, ttlMs: number, fn: () => T): T;
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
export function cached<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): T | Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.expires > now) {
    return entry.data as T;
  }
  const result = fn();
  if (result instanceof Promise) {
    return result.then((data) => {
      cache.set(key, { data, expires: now + ttlMs });
      return data;
    });
  }
  cache.set(key, { data: result, expires: now + ttlMs });
  return result;
}

export function invalidate(key: string) {
  cache.delete(key);
}

export function invalidatePrefix(prefix: string) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

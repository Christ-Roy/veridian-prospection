/**
 * In-memory rate limiter per key (userId or IP).
 * Sliding window: tracks timestamps of recent requests.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const buckets = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) buckets.delete(key);
  }
}, 300_000);

/**
 * Check if a request should be rate-limited.
 * @param key - unique identifier (e.g. "leads:userId" or "pages:userId")
 * @param maxRequests - max requests allowed in the window
 * @param windowMs - time window in milliseconds
 * @returns true if the request should be BLOCKED (over limit)
 */
export function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(key, entry);
  }

  // Remove timestamps outside the window
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    return true; // Rate limited
  }

  entry.timestamps.push(now);
  return false;
}

import Redis from 'ioredis';
import config from './index';

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  keyPrefix: config.redis.keyPrefix,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) {
      console.error('[Redis] Max reconnection attempts reached, giving up');
      return null;
    }
    const delay = Math.min(times * 200, 2000);
    console.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('ready', () => console.log('[Redis] Ready'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('close', () => console.warn('[Redis] Connection closed'));
redis.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));

export async function connectRedis(): Promise<void> {
  await redis.connect();
  await redis.ping();
  console.log('[Redis] PING OK');
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  console.log('[Redis] Connection closed');
}

export async function setCache(
  key: string,
  value: unknown,
  ttlSeconds = config.redis.ttlSeconds,
): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function getCache<T = unknown>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function deleteCache(key: string): Promise<void> {
  await redis.del(key);
}

export async function deleteCacheByPattern(pattern: string): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) await redis.del(...keys);
}

export default redis;

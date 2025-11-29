import { createClient, RedisClientType } from 'redis';
import config from '../utils/config';
import logger from '../utils/logger';

class RedisCache {
  private client: RedisClientType;
  private static instance: RedisCache;
  private isConnected = false;

  private constructor() {
    this.client = createClient({
      url: config.redis.url,
      password: config.redis.password,
      database: config.redis.db || 0,
    });

    this.client.on('error', (err: Error) => {
      logger.error({ err }, 'Redis client error');
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      logger.warn('Redis client disconnected');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });
  }

  public static getInstance(): RedisCache {
    if (!RedisCache.instance) {
      RedisCache.instance = new RedisCache();
    }
    return RedisCache.instance;
  }

  public async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  public async get<T = string>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as T;
      }
    } catch (error) {
      logger.error({ error, key }, 'Redis GET error');
      return null;
    }
  }

  public async set(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
      
      return true;
    } catch (error) {
      logger.error({ error, key }, 'Redis SET error');
      return false;
    }
  }

  public async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error({ error, key }, 'Redis DEL error');
      return false;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error({ error, key }, 'Redis EXISTS error');
      return false;
    }
  }

  public async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error({ error, key }, 'Redis INCR error');
      return 0;
    }
  }

  public async expire(key: string, seconds: number): Promise<boolean> {
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error({ error, key }, 'Redis EXPIRE error');
      return false;
    }
  }

  public async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error({ error, pattern }, 'Redis KEYS error');
      return [];
    }
  }

  public async flushDb(): Promise<boolean> {
    try {
      await this.client.flushDb();
      return true;
    } catch (error) {
      logger.error({ error }, 'Redis FLUSHDB error');
      return false;
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch (error) {
      logger.error({ error }, 'Redis health check failed');
      return false;
    }
  }

  // Cache helper with automatic JSON serialization
  public async cache<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      logger.debug({ key }, 'Cache hit');
      return cached;
    }

    logger.debug({ key }, 'Cache miss, fetching data');
    const data = await fetchFn();
    await this.set(key, data, ttlSeconds);
    return data;
  }
}

export default RedisCache.getInstance();

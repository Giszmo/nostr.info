import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

const env = process.env;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseDatabaseUrl(url: string): {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
} {
  // Parse postgres://user:password@host:port/database
  const match = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!match) {
    throw new Error('Invalid DATABASE_URL format');
  }

  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: parseInt(match[4], 10),
    database: match[5],
  };
}

const databaseUrl = env.DATABASE_URL || 'postgresql://nostr:password@localhost:5432/nostr_analytics';
const dbConfig = parseDatabaseUrl(databaseUrl);

export const config: AppConfig = {
  node_env: (env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  log_level: (env.LOG_LEVEL as AppConfig['log_level']) || 'info',
  log_pretty: parseBoolean(env.LOG_PRETTY, true),

  database: {
    url: databaseUrl,
    user: env.POSTGRES_USER || dbConfig.user,
    password: env.POSTGRES_PASSWORD || dbConfig.password,
    database: env.POSTGRES_DB || dbConfig.database,
    host: dbConfig.host,
    port: dbConfig.port,
    ssl: parseBoolean(env.DB_SSL, false),
    max_connections: parseNumber(env.DB_MAX_CONNECTIONS, 20),
  },

  redis: {
    url: env.REDIS_URL || 'redis://localhost:6379',
    password: env.REDIS_PASSWORD,
    db: parseNumber(env.REDIS_DB, 0),
  },

  collector: {
    relay_reconnect_delay: parseNumber(env.RELAY_RECONNECT_DELAY, 30000),
    event_buffer_size: parseNumber(env.EVENT_BUFFER_SIZE, 1000),
    event_flush_interval: parseNumber(env.EVENT_FLUSH_INTERVAL, 10000),
    stats_compute_interval: parseNumber(env.STATS_COMPUTE_INTERVAL, 60000), // 1 minute
    max_concurrent_connections: parseNumber(env.MAX_CONCURRENT_CONNECTIONS, 250),
  },

  api: {
    port: parseNumber(env.API_PORT, 3000),
    host: env.API_HOST || '0.0.0.0',
    cors_origins: env.ALLOWED_ORIGINS || '*',
    rate_limit_window_ms: parseNumber(env.RATE_LIMIT_WINDOW_MS, 60000), // 1 minute
    rate_limit_max_requests: parseNumber(env.RATE_LIMIT_MAX_REQUESTS, 1000), // 100 requests per minute (allows ~1 per client every 10s for 100 concurrent clients)
  },
};

export default config;

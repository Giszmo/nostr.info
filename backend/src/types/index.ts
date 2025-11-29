// TypeScript types for Nostr events and database models

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[] | undefined;
}

export interface NostrRelayMessage {
  type: 'EVENT' | 'EOSE' | 'NOTICE' | 'OK' | 'CLOSED' | 'AUTH';
  subscriptionId?: string;
  event?: NostrEvent;
  eventId?: string;
  accepted?: boolean;
  message?: string;
}

// Database models
export interface Relay {
  id: string;
  url: string;
  host: string;
  is_active: boolean;
  is_discovered: boolean;
  last_connected_at?: Date;
  last_disconnected_at?: Date;
  connection_attempts: number;
  avg_latency_ms?: number;
  total_events: number;
  events_per_hour: number;
  health_score: number;
  uptime_percentage: number;
  nip11_data?: NIP11Data;
  supported_nips?: number[];
  relay_countries?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface NIP11Data {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_filters?: number;
    max_limit?: number;
    max_subid_length?: number;
    min_prefix?: number;
    max_event_tags?: number;
    max_content_length?: number;
    min_pow_difficulty?: number;
    auth_required?: boolean;
    payment_required?: boolean;
  };
  retention?: Array<{
    kinds?: number[];
    time?: number;
    count?: number;
  }>;
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: {
    admission?: Array<{ amount: number; unit: string }>;
    subscription?: Array<{ amount: number; unit: string; period: number }>;
    publication?: Array<{ kinds: number[]; amount: number; unit: string }>;
  };
}

export interface EventAggregated {
  id: string;
  day: Date;
  relay_id: string;
  event_kind: number;
  event_count: number;
  unique_authors: number;
  avg_content_length?: number;
  zap_amount_sats: number;
  created_at: Date;
  updated_at: Date;
}

export interface Client {
  id: string;
  name: string;
  normalized_name: string;
  total_events: number;
  unique_users: number;
  first_seen_at: Date;
  last_seen_at: Date;
  kind_distribution: Record<string, number>;
  created_at: Date;
  updated_at: Date;
}

export interface ActiveUser {
  id: string;
  day: Date;
  pubkey: string;
  event_count: number;
  relay_count: number;
  relays: string[];
  metadata?: {
    name?: string;
    about?: string;
    picture?: string;
    nip05?: string;
  };
  created_at: Date;
}

export interface StatisticsSnapshot {
  id: string;
  computed_at: Date;
  time_range: '24h' | '7d' | '30d' | '90d' | 'all';
  total_relays: number;
  active_relays: number;
  total_events: number;
  unique_authors: number;
  avg_latency_ms: number;
  relay_stats: RelayStats[];
  event_distribution: EventDistribution;
  client_stats: ClientStats[];
  top_relays: TopRelay[];
  activity_timeline: ActivityTimelineEntry[];
  data_quality_score: number;
  created_at: Date;
}

export interface RelayStats {
  url: string;
  events: number;
  latency: number;
  health_score: number;
  uptime: number;
}

export interface EventDistribution {
  by_kind: Record<number, number>;
  by_day: Record<string, number>;
}

export interface ClientStats {
  name: string;
  count: number;
  percentage: number;
}

export interface TopRelay {
  url: string;
  rank: number;
  events: number;
  active_users: number;
  health_score: number;
}

export interface ActivityTimelineEntry {
  timestamp: number;
  date: string;
  events: number;
  active_users: number;
  zaps: number;
}

export interface RelayLog {
  id: string;
  relay_id: string;
  event_type: 'connect' | 'disconnect' | 'error' | 'message';
  message: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

// Configuration types
export interface DatabaseConfig {
  url: string;
  user: string;
  password: string;
  database: string;
  host: string;
  port: number;
  ssl?: boolean;
  max_connections?: number;
}

export interface RedisConfig {
  url: string;
  password?: string;
  db?: number;
}

export interface CollectorConfig {
  relay_reconnect_delay: number;
  event_buffer_size: number;
  event_flush_interval: number;
  stats_compute_interval: number;
  max_concurrent_connections: number;
}

export interface APIConfig {
  port: number;
  host: string;
  cors_origins: string | string[];
  rate_limit_window_ms: number;
  rate_limit_max_requests: number;
}

export interface AppConfig {
  node_env: 'development' | 'production' | 'test';
  log_level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  log_pretty: boolean;
  database: DatabaseConfig;
  redis: RedisConfig;
  collector: CollectorConfig;
  api: APIConfig;
}

// Event buffer types
export interface BufferedEvent {
  relay: string;
  event: NostrEvent;
  received_at: number;
}

// Statistics computation types
export interface ComputationResult {
  success: boolean;
  time_range: string;
  computed_at: Date;
  duration_ms: number;
  records_processed: number;
  errors?: string[];
}

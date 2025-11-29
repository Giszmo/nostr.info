-- Database schema for Nostr Analytics
-- PostgreSQL 14+

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm; 

-- Relays table
CREATE TABLE IF NOT EXISTS relays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT UNIQUE NOT NULL,
    host TEXT NOT NULL,
    
    -- Connection status
    is_active BOOLEAN DEFAULT true,
    is_discovered BOOLEAN DEFAULT false,
    last_connected_at TIMESTAMP,
    last_disconnected_at TIMESTAMP,
    connection_attempts INTEGER DEFAULT 0,
    
    -- Performance metrics
    avg_latency_ms INTEGER,
    total_events BIGINT DEFAULT 0,
    events_per_hour FLOAT DEFAULT 0,
    
    -- Health scoring
    health_score FLOAT DEFAULT 0,
    uptime_percentage FLOAT DEFAULT 0,
    
    -- NIP-11 metadata
    nip11_data JSONB,
    supported_nips INTEGER[],
    relay_countries TEXT[],
    
    -- Event kind distribution
    kind_distribution JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT url_format CHECK (url ~ '^wss?://')
);

CREATE INDEX idx_relays_active ON relays(is_active) WHERE is_active = true;
CREATE INDEX idx_relays_health ON relays(health_score DESC);
CREATE INDEX idx_relays_url_trgm ON relays USING gin(url gin_trgm_ops);
CREATE INDEX idx_relays_nip11 ON relays USING gin(nip11_data);

-- Events aggregated by day, relay, and kind
CREATE TABLE IF NOT EXISTS events_aggregated (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    day DATE NOT NULL,
    relay_id UUID REFERENCES relays(id) ON DELETE CASCADE,
    event_kind INTEGER NOT NULL,
    event_count INTEGER DEFAULT 0,
    unique_authors INTEGER DEFAULT 0,
    
    -- Additional metrics
    avg_content_length INTEGER,
    zap_amount_sats BIGINT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(day, relay_id, event_kind)
);

CREATE INDEX idx_events_day ON events_aggregated(day DESC);
CREATE INDEX idx_events_relay ON events_aggregated(relay_id);
CREATE INDEX idx_events_kind ON events_aggregated(event_kind);
CREATE INDEX idx_events_day_kind ON events_aggregated(day DESC, event_kind);

-- Client statistics
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    normalized_name TEXT,
    
    -- Metrics
    total_events BIGINT DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    first_seen_at TIMESTAMP,
    last_seen_at TIMESTAMP,
    
    -- Event kind distribution
    kind_distribution JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_clients_name ON clients(name);
CREATE INDEX idx_clients_events ON clients(total_events DESC);
CREATE INDEX idx_clients_normalized ON clients USING gin(normalized_name gin_trgm_ops);

-- Active users tracking
CREATE TABLE IF NOT EXISTS active_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    day DATE NOT NULL,
    pubkey TEXT NOT NULL,
    
    -- Activity metrics
    event_count INTEGER DEFAULT 0,
    relay_count INTEGER DEFAULT 0,
    relays TEXT[],
    
    -- User metadata (cached from kind 0)
    metadata JSONB,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(day, pubkey)
);

CREATE INDEX idx_active_users_day ON active_users(day DESC);
CREATE INDEX idx_active_users_pubkey ON active_users(pubkey);
CREATE INDEX idx_active_users_day_count ON active_users(day DESC, event_count DESC);

-- Statistics snapshots (precomputed data for API)
CREATE TABLE IF NOT EXISTS statistics_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    time_range TEXT NOT NULL, -- '24h', '7d', '30d', '90d', 'all'
    
    -- Overview stats
    total_relays INTEGER,
    active_relays INTEGER,
    total_events BIGINT,
    unique_authors INTEGER,
    avg_latency_ms INTEGER,
    
    -- Detailed data (JSON for flexibility)
    relay_stats JSONB,
    event_distribution JSONB,
    client_stats JSONB,
    top_relays JSONB,
    activity_timeline JSONB,
    
    -- Metadata
    data_quality_score FLOAT DEFAULT 1.0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(time_range, computed_at)
);

CREATE INDEX idx_stats_time_range ON statistics_snapshots(time_range, computed_at DESC);
CREATE INDEX idx_stats_computed ON statistics_snapshots(computed_at DESC);

-- Relay connection logs (for debugging and monitoring)
CREATE TABLE IF NOT EXISTS relay_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    relay_id UUID REFERENCES relays(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'connect', 'disconnect', 'error', 'message'
    
    message TEXT,
    metadata JSONB,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_relay_logs_relay ON relay_logs(relay_id, created_at DESC);
CREATE INDEX idx_relay_logs_type ON relay_logs(event_type, created_at DESC);

-- Partitioning for relay_logs (optional, for high-volume)
-- CREATE TABLE relay_logs_y2025m11 PARTITION OF relay_logs
-- FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

-- Event deduplication (temporary table for recent events)
CREATE TABLE IF NOT EXISTS event_ids_recent (
    event_id TEXT PRIMARY KEY,
    seen_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_event_ids_seen ON event_ids_recent(seen_at);

-- Auto-cleanup old event IDs (keep only last 7 days)
-- This should be run periodically via cron
CREATE OR REPLACE FUNCTION cleanup_old_event_ids() RETURNS void AS $$
BEGIN
    DELETE FROM event_ids_recent WHERE seen_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Update timestamps trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_relays_updated_at BEFORE UPDATE ON relays
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_aggregated_updated_at BEFORE UPDATE ON events_aggregated
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE OR REPLACE VIEW relay_health_summary AS
SELECT 
    r.url,
    r.is_active,
    r.health_score,
    r.avg_latency_ms,
    r.uptime_percentage,
    COUNT(ea.id) as total_event_records,
    SUM(ea.event_count) as total_events,
    MAX(ea.day) as last_event_day
FROM relays r
LEFT JOIN events_aggregated ea ON r.id = ea.relay_id
GROUP BY r.id, r.url, r.is_active, r.health_score, r.avg_latency_ms, r.uptime_percentage
ORDER BY r.health_score DESC;

CREATE OR REPLACE VIEW daily_network_stats AS
SELECT 
    day,
    COUNT(DISTINCT relay_id) as active_relays,
    SUM(event_count) as total_events,
    COUNT(DISTINCT event_kind) as unique_kinds,
    SUM(zap_amount_sats) as total_zaps_sats
FROM events_aggregated
GROUP BY day
ORDER BY day DESC;

-- Seed initial data (relays from _data/relays.yml will be inserted by seed script)

-- Performance notes:
-- 1. Consider partitioning events_aggregated by day if data volume grows large
-- 2. Use BRIN indexes for time-based queries on large tables
-- 3. Set up regular VACUUM ANALYZE jobs
-- 4. Monitor query performance with pg_stat_statements

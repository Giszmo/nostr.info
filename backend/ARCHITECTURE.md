# Backend Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         NOSTR.INFO BACKEND                                │
│                    (Production-Ready Architecture)                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  EXTERNAL: Nostr Network                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  240+ Nostr Relays (WebSocket Connections)                         │   │
│  │  wss://relay.damus.io, wss://nos.lol, wss://relay.nostr.band...   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  COLLECTOR SERVICE (Container 1)                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  RelayCollectorService                                             │   │
│  │  • Maintains WebSocket connections to all relays                  │   │
│  │  • Subscribes to event kinds: 0,1,3,7,9735,30023                 │   │
│  │  • Buffers events (1000 at a time)                                │   │
│  │  • Deduplicates using Set + Redis                                 │   │
│  │  • Auto-reconnects on disconnect (30s delay)                      │   │
│  │  • Logs connection status & errors                                │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│                                    │ Batch Insert                          │
│                                    ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Event Buffer → Flush (every 10s or 1000 events)                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DATABASE LAYER                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL 15 (Container 2)                                       │   │
│  │                                                                     │   │
│  │  Tables:                                                            │   │
│  │  • relays             - Relay info & health metrics               │   │
│  │  • events_aggregated  - Events by day/relay/kind                  │   │
│  │  • clients            - Client usage stats                        │   │
│  │  • active_users       - Daily active users                        │   │
│  │  • statistics_snapshots - Precomputed statistics                  │   │
│  │  • relay_logs         - Connection logs                           │   │
│  │                                                                     │   │
│  │  Indexes: Optimized for time-series & aggregation queries         │   │
│  │  Views: relay_health_summary, daily_network_stats                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Read Aggregated Data
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STATISTICS SERVICE (Part of Collector Container)                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  StatisticsService                                                 │   │
│  │  • Runs every 5 minutes (cron: */5 * * * *)                       │   │
│  │  • Computes 5 time ranges: 24h, 7d, 30d, 90d, all                │   │
│  │  • Aggregates:                                                     │   │
│  │    - Overview stats (relays, events, users, latency)              │   │
│  │    - Relay performance metrics                                    │   │
│  │    - Event distribution by kind & day                             │   │
│  │    - Client usage statistics                                      │   │
│  │    - Top 10 relays by activity                                    │   │
│  │    - Activity timeline                                            │   │
│  │  • Saves snapshots to database                                    │   │
│  │  • Caches in Redis (1 hour TTL)                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Store Computed Stats
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CACHE LAYER                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Redis 7 (Container 3)                                             │   │
│  │                                                                     │   │
│  │  Cached Keys:                                                       │   │
│  │  • stats:24h   - 24 hour statistics (TTL: 1h)                     │   │
│  │  • stats:7d    - 7 day statistics (TTL: 1h)                       │   │
│  │  • stats:30d   - 30 day statistics (TTL: 1h)                      │   │
│  │  • stats:90d   - 90 day statistics (TTL: 1h)                      │   │
│  │  • stats:all   - All-time statistics (TTL: 1h)                    │   │
│  │  • event:{id}  - Event deduplication (TTL: 24h)                   │   │
│  │                                                                     │   │
│  │  Purpose: Fast API responses without DB queries                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Read Cached Stats
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  API SERVICE (Container 4)                                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Express REST API Server                                           │   │
│  │                                                                     │   │
│  │  Middleware:                                                        │   │
│  │  • Helmet (security headers)                                       │   │
│  │  • CORS (allow all origins)                                        │   │
│  │  • Compression (gzip)                                              │   │
│  │  • Rate Limiting (100 req/15min)                                   │   │
│  │                                                                     │   │
│  │  Endpoints:                                                         │   │
│  │  GET /health                       - Health check                  │   │
│  │  GET /api/v1/docs                  - API documentation            │   │
│  │  GET /api/v1/stats/overview        - General stats                │   │
│  │  GET /api/v1/stats/relays          - Relay data                   │   │
│  │  GET /api/v1/stats/events/:range   - Event stats                  │   │
│  │  GET /api/v1/stats/clients         - Client stats                 │   │
│  │  GET /api/v1/stats/top-relays      - Top relays                   │   │
│  │  GET /api/v1/stats/activity        - Activity timeline            │   │
│  │  GET /api/v1/stats/full/:range     - Full snapshot                │   │
│  │                                                                     │   │
│  │  Response Time: <50ms (cached) / <200ms (database)                │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                    │                                       │
│                          PORT 3000 │                                       │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ HTTP/JSON
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CONSUMERS                                                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  nostr.info      │  │  Third-party     │  │  Mobile Apps    │         │
│  │  Website         │  │  Developers      │  │  & Tools        │         │
│  │  (Jekyll)        │  │  & Services      │  │                 │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘


DATA FLOW:
──────────

1. Nostr Relays → WebSocket → Collector Service
2. Collector Service → Buffer (1000 events) → PostgreSQL (batch insert)
3. Statistics Service (cron) → Read PostgreSQL → Compute Stats → Save snapshot
4. Statistics Service → Cache in Redis (1 hour TTL)
5. API Service → Read Redis (or PostgreSQL fallback) → Return JSON
6. Consumers → HTTP GET → API Service → Receive JSON


SCALABILITY:
────────────

Horizontal Scaling:
├── Collector: Can run multiple instances (load balancing relays)
├── API: Can run multiple instances behind load balancer
├── Database: Can add read replicas for scaling reads
└── Redis: Can cluster for high availability

Vertical Scaling:
├── Increase CPU/RAM for collector (more concurrent connections)
├── Increase PostgreSQL connections pool size
└── Optimize queries with additional indexes


MONITORING:
───────────

Logs:
├── Structured JSON logs (Pino)
├── Log aggregation: docker-compose logs -f
└── Production: Send to ELK/Loki/CloudWatch

Metrics:
├── Collector: Connection status, events processed, buffer size
├── API: Request count, response time, error rate
├── Database: Query performance, connection pool usage
└── Redis: Cache hit rate, memory usage

Alerts:
├── Service down (health check fails)
├── High error rate (>5%)
├── Database connection errors
└── Redis memory warning


DEPLOYMENT OPTIONS:
───────────────────

Option 1: Docker Compose (Single Server)
├── Best for: Small to medium traffic
├── Cost: $24-48/month (DigitalOcean/Linode)
└── Setup: docker-compose up -d

Option 2: Kubernetes (Multi-Server)
├── Best for: High traffic, HA requirements
├── Cost: $200+/month
└── Setup: kubectl apply -f k8s/

Option 3: Serverless (Partial)
├── API on AWS Lambda / Cloud Run
├── Collector on dedicated server
└── Cost: Pay per request


SECURITY:
─────────

✓ Rate limiting (100 req/15min per IP)
✓ Helmet security headers
✓ CORS configured (allow all for public API)
✓ No authentication (read-only public data)
✓ Input validation (query parameters)
✓ SQL injection protection (parameterized queries)
⚠ Add HTTPS in production
⚠ Add API keys if abuse occurs
⚠ Set up firewall rules


PERFORMANCE BENCHMARKS:
───────────────────────

Expected Load:
├── Events: 10,000+ per minute
├── API Requests: 100+ per second (cached)
├── Concurrent WebSocket Connections: 240+
└── Database Writes: 1000 events per 10 seconds (batch)

Resource Usage:
├── Collector: ~150MB RAM, 10-20% CPU
├── API: ~50MB RAM, 5% CPU
├── PostgreSQL: ~500MB RAM, 10-15% CPU
├── Redis: ~100MB RAM, 2% CPU
└── Total: ~800MB RAM, 30% CPU (4-core)

Response Times:
├── API (cached): <50ms
├── API (database): <200ms
├── Statistics computation: 2-5 seconds
└── Event flush: <1 second


FUTURE ENHANCEMENTS:
────────────────────

Phase 2:
├── WebSocket API for real-time updates
├── GraphQL endpoint for flexible queries
├── User authentication & private relays
└── Webhook notifications

Phase 3:
├── Machine learning for relay recommendations
├── Spam detection & filtering
├── Advanced analytics dashboard
└── Historical data export

Phase 4:
├── Paid tiers for higher rate limits
├── Custom alerts & notifications
├── White-label API for resellers
└── Multi-region deployment

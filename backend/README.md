# Nostr.info Backend Service

Backend data collector and API service for nostr.info. This service:

- Connects to 240+ Nostr relays
- Collects and aggregates event data
- Computes statistics and analytics
- Provides REST API endpoints
- Caches data in Redis for fast access

## Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **API**: Express with CORS, rate limiting, compression
- **WebSocket**: ws library for Nostr relay connections
- **Logging**: Pino (structured JSON logs)
- **Process Management**: PM2 / Docker

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration

# Start PostgreSQL and Redis (with Docker)
docker-compose up -d postgres redis

# Run database migrations
npm run db:migrate

# Start in development mode
npm run dev
```

### Production with Docker

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Services

### Collector Service
Connects to Nostr relays, collects events, and stores aggregated data.

```bash
npm run start:collector
```

### API Service
Serves REST API endpoints for statistics and analytics.

```bash
npm run start:api
```

## API Endpoints

- `GET /health` - Health check
- `GET /api/v1/stats/overview` - Overview statistics
- `GET /api/v1/stats/relays` - Relay statistics
- `GET /api/v1/stats/events/:range` - Event statistics by time range
- `GET /api/v1/stats/clients` - Client distribution
- `GET /api/v1/stats/top-relays` - Top relays by activity
- `GET /api/v1/stats/activity` - Activity timeline

### Query Parameters

- `range`: Time range filter (`24h`, `7d`, `30d`, `90d`, `all`)

## Configuration

See `.env.example` for all configuration options.

Key settings:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `API_PORT`: API server port (default: 3000)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

## Database

### Migrations

```bash
npm run db:migrate
```

### Schema

- `relays`: Relay information and health metrics
- `events_aggregated`: Aggregated event counts by day, relay, kind
- `clients`: Client usage statistics
- `active_users`: Active user tracking
- `statistics_snapshots`: Precomputed statistics
- `relay_logs`: Connection logs for debugging

## Development

```bash
# Run in watch mode
npm run dev

# Type checking
npm run build

# Linting
npm run lint

# Format code
npm run format
```

## Deployment

### Docker (Recommended)

```bash
# Production deployment
docker-compose up -d

# Scale collector instances
docker-compose up -d --scale collector=2
```

### Systemd

```ini
[Unit]
Description=Nostr Collector Service
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=nostr
WorkingDirectory=/opt/nostr-backend
ExecStart=/usr/bin/node dist/collector.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## Monitoring

Check collector status:
```bash
curl http://localhost:3000/health
```

View logs:
```bash
# Docker
docker-compose logs -f collector
docker-compose logs -f api

# Direct
tail -f logs/collector.log
```

## Performance

- **Event buffer**: 1000 events (configurable)
- **Flush interval**: 10 seconds
- **Statistics computation**: Every 5 minutes
- **API cache TTL**: 1 hour
- **Database connections**: 20 max

## License

MIT

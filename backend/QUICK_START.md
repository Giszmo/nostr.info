# Quick Start Guide - Nostr.info Backend

## 🚀 One-Command Start

```bash
cd backend && ./setup.sh
```

## 📋 Prerequisites

- Node.js 18+
- Docker & Docker Compose
- 2GB+ RAM available

## ⚡ Quick Commands

### Start Everything
```bash
docker-compose up -d
```

### Stop Everything
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f
docker-compose logs -f collector  # Just collector
docker-compose logs -f api        # Just API
```

### Check Health
```bash
curl http://localhost:3000/health
```

### Test API
```bash
# Overview stats
curl http://localhost:3000/api/v1/stats/overview

# Top relays
curl http://localhost:3000/api/v1/stats/top-relays?range=7d

# Activity timeline
curl http://localhost:3000/api/v1/stats/activity?range=30d
```

### Restart Services
```bash
docker-compose restart collector
docker-compose restart api
```

### Database Access
```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U nostr -d nostr_analytics

# Inside psql:
\dt                           # List tables
SELECT COUNT(*) FROM relays;  # Count relays
\q                            # Quit
```

### Redis Access
```bash
# Connect to Redis
docker-compose exec redis redis-cli

# Inside redis-cli:
KEYS *                    # List all keys
GET stats:24h             # Get cached stats
PING                      # Test connection
EXIT                      # Quit
```

## 🛠️ Development Commands

```bash
# Install dependencies
npm install

# Run migrations
npm run db:migrate

# Start in dev mode (auto-reload)
npm run dev

# Build TypeScript
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

## 📊 Monitoring

### Check Collector Status
```bash
docker-compose logs collector | tail -n 20
```

### Check Database Size
```bash
docker-compose exec postgres psql -U nostr -d nostr_analytics -c "
  SELECT 
    pg_size_pretty(pg_database_size('nostr_analytics')) as db_size,
    (SELECT COUNT(*) FROM relays) as relay_count,
    (SELECT COUNT(*) FROM events_aggregated) as event_records,
    (SELECT COUNT(*) FROM statistics_snapshots) as stat_snapshots;
"
```

### Check Redis Memory
```bash
docker-compose exec redis redis-cli INFO memory | grep used_memory_human
```

### Monitor API Requests
```bash
docker-compose logs api | grep "API request"
```

## 🔧 Troubleshooting

### Collector Not Starting
```bash
# Check logs for errors
docker-compose logs collector | grep ERROR

# Restart collector
docker-compose restart collector

# Check relay connections
docker-compose logs collector | grep "Connected to relay"
```

### API Returns 404
```bash
# Check if statistics computed
docker-compose logs collector | grep "Statistics computed"

# Manually trigger computation
docker-compose exec collector node -e "
  require('./dist/services/statistics').StatisticsService
    .computeAllStatistics()
    .then(() => console.log('Done'))
"
```

### Database Connection Failed
```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check connection
docker-compose exec postgres pg_isready -U nostr

# Restart PostgreSQL
docker-compose restart postgres
```

### Out of Memory
```bash
# Check Docker stats
docker stats

# Increase Docker memory limit
# Docker Desktop: Settings → Resources → Memory
```

## 📁 Important Files

```
backend/
├── .env                    # Configuration (create from .env.example)
├── docker-compose.yml      # Container orchestration
├── IMPLEMENTATION.md       # Full documentation
├── ARCHITECTURE.md         # System architecture diagram
├── README.md              # Detailed readme
└── src/
    ├── collector.ts       # Collector entry point
    ├── api-server.ts      # API entry point
    ├── services/          # Core services
    ├── database/          # Database & cache
    └── api/               # API routes
```

## 🌐 Endpoints Quick Reference

```
GET  http://localhost:3000/health
GET  http://localhost:3000/api/v1/docs
GET  http://localhost:3000/api/v1/stats/overview?range=24h
GET  http://localhost:3000/api/v1/stats/relays?range=7d
GET  http://localhost:3000/api/v1/stats/events/30d
GET  http://localhost:3000/api/v1/stats/clients?range=7d
GET  http://localhost:3000/api/v1/stats/top-relays?range=30d
GET  http://localhost:3000/api/v1/stats/activity?range=7d
```

**Time ranges**: `24h`, `7d`, `30d`, `90d`, `all`

## 🔐 Security Checklist

- [ ] Change default passwords in `.env`
- [ ] Set `NODE_ENV=production` for production
- [ ] Enable HTTPS (use Nginx/Caddy reverse proxy)
- [ ] Set up firewall rules
- [ ] Configure `ALLOWED_ORIGINS` for CORS
- [ ] Monitor rate limit logs
- [ ] Regular backups of PostgreSQL

## 💾 Backup & Restore

### Backup Database
```bash
docker-compose exec postgres pg_dump -U nostr nostr_analytics > backup.sql
```

### Restore Database
```bash
docker-compose exec -T postgres psql -U nostr nostr_analytics < backup.sql
```

### Backup Everything
```bash
docker-compose down
tar -czf nostr-backup-$(date +%Y%m%d).tar.gz backend/
docker-compose up -d
```

## 🎯 Performance Tips

1. **Increase Event Buffer**: Edit `.env` → `EVENT_BUFFER_SIZE=2000`
2. **Adjust Flush Interval**: Edit `.env` → `EVENT_FLUSH_INTERVAL=5000`
3. **More Database Connections**: Edit `.env` → `DB_MAX_CONNECTIONS=50`
4. **Redis Memory**: Edit `docker-compose.yml` → Add `--maxmemory 512mb`
5. **CPU Limits**: Edit `docker-compose.yml` → Add `cpus: "2"`

## 📈 Scaling Up

### Multiple Collectors
```bash
docker-compose up -d --scale collector=3
```

### Multiple API Instances
```bash
docker-compose up -d --scale api=2
```

### Add Load Balancer
```yaml
# docker-compose.yml
nginx:
  image: nginx:alpine
  ports:
    - "80:80"
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf
```

## 🆘 Get Help

- **Logs**: `docker-compose logs -f`
- **Errors**: Look for `ERROR` or `FATAL` in logs
- **API Docs**: http://localhost:3000/api/v1/docs
- **Database**: Check `relay_logs` table for connection issues

## ✅ Verification Checklist

After starting, verify:

```bash
# 1. All containers running
docker-compose ps

# 2. Health check passes
curl http://localhost:3000/health

# 3. Relays connected
docker-compose logs collector | grep "Connected to relay" | wc -l

# 4. Stats available
curl http://localhost:3000/api/v1/stats/overview

# 5. Database has data
docker-compose exec postgres psql -U nostr -d nostr_analytics -c "
  SELECT COUNT(*) FROM relays WHERE is_active = true;
"
```

## 🎉 Success Indicators

- ✅ Health endpoint returns `{"status":"ok"}`
- ✅ Collector logs show "Connected to relay"
- ✅ API returns statistics (not 404)
- ✅ Database has relay records
- ✅ Redis has cached keys

---

**Need more details?** Check:
- `IMPLEMENTATION.md` - Full implementation guide
- `ARCHITECTURE.md` - System architecture
- `README.md` - Detailed documentation

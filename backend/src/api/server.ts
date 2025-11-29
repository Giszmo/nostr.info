import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
// import rateLimit from 'express-rate-limit';
import { StatisticsService } from '../services/statistics';
import redis from '../database/redis';
import db from '../database/client';
import logger from '../utils/logger';
import config from '../utils/config';

const app = express();
const statisticsService = new StatisticsService();

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.json());

// CORS
app.use(
  cors({
    origin: config.api.cors_origins,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: false,
    maxAge: 86400, // 24 hours
  })
);

// Rate limiting
// Rate limiting middleware removed

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path, ip: req.ip }, 'API request');
  next();
});

// Health check
app.get('/health', async (_req: Request, res: Response) => {
  const dbHealthy = await db.healthCheck();
  const redisHealthy = await redis.healthCheck();

  const healthy = dbHealthy && redisHealthy;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
    },
  });
});

// API v1 endpoints

// Overview statistics
app.get('/api/v1/stats/overview', async (req: Request, res: Response) => {
  try {
    const timeRange = (req.query.range as string) || '24h';
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json({
      total_relays: snapshot.total_relays,
      active_relays: snapshot.active_relays,
      total_events: snapshot.total_events,
      unique_authors: snapshot.unique_authors,
      avg_latency_ms: snapshot.avg_latency_ms,
      updated_at: snapshot.computed_at,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get overview stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Relay statistics
app.get('/api/v1/stats/relays', async (req: Request, res: Response) => {
  try {
    const timeRange = (req.query.range as string) || '24h';
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json({
      relays: snapshot.relay_stats,
      updated_at: snapshot.computed_at,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get relay stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Event statistics by time range
app.get('/api/v1/stats/events/:range', async (req: Request, res: Response) => {
  try {
    const timeRange = req.params.range;
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json({
      time_range: timeRange,
      total_events: snapshot.total_events,
      distribution: snapshot.event_distribution,
      activity_timeline: snapshot.activity_timeline,
      updated_at: snapshot.computed_at,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get event stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client statistics
app.get('/api/v1/stats/clients', async (req: Request, res: Response) => {
  try {
    const timeRange = (req.query.range as string) || '24h';
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json({
      clients: snapshot.client_stats,
      updated_at: snapshot.computed_at,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get client stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Top relays
app.get('/api/v1/stats/top-relays', async (req: Request, res: Response) => {
  try {
    const timeRange = (req.query.range as string) || '24h';
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json({
      top_relays: snapshot.top_relays,
      updated_at: snapshot.computed_at,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get top relays');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Activity timeline
app.get('/api/v1/stats/activity', async (req: Request, res: Response) => {
  try {
    const timeRange = (req.query.range as string) || '7d';
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json({
      activity: snapshot.activity_timeline,
      updated_at: snapshot.computed_at,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get activity timeline');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Full snapshot (for testing)
app.get('/api/v1/stats/full/:range', async (req: Request, res: Response) => {
  try {
    const timeRange = req.params.range;
    const snapshot = await statisticsService.getLatestSnapshot(timeRange);

    if (!snapshot) {
      return res.status(404).json({ error: 'Statistics not available yet' });
    }

    res.json(snapshot);
  } catch (error) {
    logger.error({ error }, 'Failed to get full snapshot');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API documentation
app.get('/api/v1/docs', (_req: Request, res: Response) => {
  res.json({
    version: '1.0.0',
    endpoints: {
      '/health': 'Health check for all services',
      '/api/v1/stats/overview': 'General network statistics',
      '/api/v1/stats/relays': 'Relay health and performance data',
      '/api/v1/stats/events/:range': 'Event counts by time range (24h, 7d, 30d, 90d)',
      '/api/v1/stats/clients': 'Client distribution statistics',
      '/api/v1/stats/top-relays': 'Top relays by activity',
      '/api/v1/stats/activity': 'Activity timeline',
      '/api/v1/stats/full/:range': 'Complete statistics snapshot',
    },
    query_parameters: {
      range: 'Time range filter (24h, 7d, 30d, 90d, all)',
    },
    rate_limits: {
      window: '15 minutes',
      max_requests: 100,
    },
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export async function startAPIServer(): Promise<void> {
  await db.initialize();
  await redis.connect();

  app.listen(config.api.port, config.api.host, () => {
    logger.info(
      { host: config.api.host, port: config.api.port },
      'API server started'
    );
  });
}

export default app;

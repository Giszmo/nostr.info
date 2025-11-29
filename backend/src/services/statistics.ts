import db from '../database/client';
import redis from '../database/redis';
import logger from '../utils/logger';
import { StatisticsSnapshot, ComputationResult } from '../types';

export class StatisticsService {
  public async computeAllStatistics(): Promise<ComputationResult[]> {
    const timeRanges = ['24h', '7d', '30d', '90d', 'all'] as const;
    const results: ComputationResult[] = [];

    for (const range of timeRanges) {
      const result = await this.computeStatistics(range);
      results.push(result);
    }

    return results;
  }

  public async computeStatistics(timeRange: '24h' | '7d' | '30d' | '90d' | 'all'): Promise<ComputationResult> {
    const startTime = Date.now();
    const computedAt = new Date();

    logger.info({ timeRange }, 'Computing statistics');

    try {
      // Get date range
      const { startDate, endDate } = this.getDateRange(timeRange);

      // Compute all statistics
      const [
        overviewStats,
        relayStats,
        eventDistribution,
        clientStats,
        topRelays,
        activityTimeline,
      ] = await Promise.all([
        this.computeOverviewStats(startDate, endDate),
        this.computeRelayStats(startDate, endDate),
        this.computeEventDistribution(startDate, endDate),
        this.computeClientStats(startDate, endDate),
        this.computeTopRelays(startDate, endDate),
        this.computeActivityTimeline(startDate, endDate),
      ]);

      // Create snapshot
      const snapshot: Omit<StatisticsSnapshot, 'id' | 'created_at'> = {
        computed_at: computedAt,
        time_range: timeRange,
        ...overviewStats,
        relay_stats: relayStats,
        event_distribution: eventDistribution,
        client_stats: clientStats,
        top_relays: topRelays,
        activity_timeline: activityTimeline,
        data_quality_score: 1.0,
      };

      // Save to database
      await this.saveSnapshot(snapshot);

      // Cache in Redis (1 hour TTL for API access)
      await redis.set(`stats:${timeRange}`, snapshot, 3600);

      const duration = Date.now() - startTime;

      logger.info({ timeRange, duration }, 'Statistics computed successfully');

      return {
        success: true,
        time_range: timeRange,
        computed_at: computedAt,
        duration_ms: duration,
        records_processed: overviewStats.total_events,
      };
    } catch (error) {
      logger.error({ error, timeRange }, 'Failed to compute statistics');
      return {
        success: false,
        time_range: timeRange,
        computed_at: computedAt,
        duration_ms: Date.now() - startTime,
        records_processed: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  private getDateRange(timeRange: '24h' | '7d' | '30d' | '90d' | 'all'): { startDate: string; endDate: string } {
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];

    let startDate: string;
    switch (timeRange) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case 'all':
        startDate = '2020-01-01'; // Nostr started around 2020
        break;
    }

    return { startDate, endDate };
  }

  private async computeOverviewStats(startDate: string, endDate: string) {
    const [relaysCount, eventsSum, usersCount, avgLatency] = await Promise.all([
      // Total and active relays
      db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_active = true) as active
        FROM relays
      `),
      
      // Total events
      db.query(`
        SELECT 
          COALESCE(SUM(event_count), 0) as total_events
        FROM events_aggregated
        WHERE day >= $1 AND day <= $2
      `, [startDate, endDate]),
      
      // Unique authors
      db.query(`
        SELECT COUNT(DISTINCT pubkey) as unique_authors
        FROM active_users
        WHERE day >= $1 AND day <= $2
      `, [startDate, endDate]),
      
      // Average latency
      db.query(`
        SELECT COALESCE(AVG(avg_latency_ms), 0)::int as avg_latency
        FROM relays
        WHERE avg_latency_ms IS NOT NULL
      `),
    ]);

    return {
      total_relays: parseInt((relaysCount.rows[0] as any)?.total || '0', 10),
      active_relays: parseInt((relaysCount.rows[0] as any)?.active || '0', 10),
      total_events: parseInt((eventsSum.rows[0] as any)?.total_events || '0', 10),
      unique_authors: parseInt((usersCount.rows[0] as any)?.unique_authors || '0', 10),
      avg_latency_ms: parseInt((avgLatency.rows[0] as any)?.avg_latency || '0', 10),
    };
  }

  private async computeRelayStats(startDate: string, endDate: string) {
    const result = await db.query(`
      SELECT 
        r.url,
        COALESCE(SUM(ea.event_count), 0) as events,
        r.avg_latency_ms as latency,
        r.health_score,
        r.uptime_percentage as uptime
      FROM relays r
      LEFT JOIN events_aggregated ea ON r.id = ea.relay_id
        AND ea.day >= $1 AND ea.day <= $2
      WHERE r.is_active = true
      GROUP BY r.id, r.url, r.avg_latency_ms, r.health_score, r.uptime_percentage
      ORDER BY events DESC
      LIMIT 100
    `, [startDate, endDate]);

    return result.rows.map((row: any) => ({
      url: row.url,
      events: parseInt(row.events, 10),
      latency: parseInt(row.latency || '0', 10),
      health_score: parseFloat(row.health_score || '0'),
      uptime: parseFloat(row.uptime || '0'),
    }));
  }

  private async computeEventDistribution(startDate: string, endDate: string) {
    const [byKind, byDay] = await Promise.all([
      // Events by kind
      db.query(`
        SELECT 
          event_kind,
          SUM(event_count) as count
        FROM events_aggregated
        WHERE day >= $1 AND day <= $2
        GROUP BY event_kind
        ORDER BY count DESC
        LIMIT 50
      `, [startDate, endDate]),
      
      // Events by day
      db.query(`
        SELECT 
          day::text,
          SUM(event_count) as count
        FROM events_aggregated
        WHERE day >= $1 AND day <= $2
        GROUP BY day
        ORDER BY day DESC
      `, [startDate, endDate]),
    ]);

    return {
      by_kind: Object.fromEntries(
        byKind.rows.map((row: any) => [row.event_kind, parseInt(row.count, 10)])
      ),
      by_day: Object.fromEntries(
        byDay.rows.map((row: any) => [row.day, parseInt(row.count, 10)])
      ),
    };
  }

  private async computeClientStats(startDate: string, endDate: string) {
    const result = await db.query(`
      SELECT 
        name,
        total_events as count,
        kind_distribution,
        last_seen_at
      FROM clients
      WHERE last_seen_at >= $1
      ORDER BY total_events DESC
      LIMIT 20
    `, [startDate]);

    const total = result.rows.reduce((sum: any, row: any) => sum + parseInt(row.count, 10), 0);

    return result.rows.map((row: any) => {
      const count = parseInt(row.count, 10);
      const kindDist = row.kind_distribution || {};
      
      return {
        name: row.name,
        count,
        percentage: (total as number) > 0 ? (count / (total as number)) * 100 : 0,
        kinds: kindDist,
        lastSeen: row.last_seen_at,
      };
    });
  }

  private async computeTopRelays(startDate: string, endDate: string) {
    const result = await db.query(`
      SELECT 
        r.id,
        r.url,
        COALESCE(SUM(ea.event_count), 0) as events,
        COUNT(DISTINCT au.pubkey) as active_users,
        r.health_score
      FROM relays r
      LEFT JOIN events_aggregated ea ON r.id = ea.relay_id
        AND ea.day >= $1 AND ea.day <= $2
      LEFT JOIN active_users au ON au.day >= $1 AND au.day <= $2
        AND r.url = ANY(au.relays)
      WHERE r.is_active = true
      GROUP BY r.id, r.url, r.health_score
      HAVING SUM(ea.event_count) > 0
      ORDER BY events DESC
      LIMIT 10
    `, [startDate, endDate]);

    // Get kind distribution for each relay
    const topRelaysWithKinds = await Promise.all(result.rows.map(async (row: any) => {
      const kindDist = await db.query(`
        SELECT 
          event_kind,
          SUM(event_count) as count
        FROM events_aggregated
        WHERE relay_id = $1 AND day >= $2 AND day <= $3
        GROUP BY event_kind
        ORDER BY count DESC
        LIMIT 10
      `, [row.id, startDate, endDate]);

      const kinds = Object.fromEntries(
        kindDist.rows.map((k: any) => [k.event_kind.toString(), parseInt(k.count, 10)])
      );

      // Update relay's kind_distribution in database
      await db.query(
        'UPDATE relays SET kind_distribution = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(kinds), row.id]
      );

      return {
        url: row.url,
        rank: result.rows.indexOf(row) + 1,
        events: parseInt(row.events, 10),
        active_users: parseInt(row.active_users || '0', 10),
        health_score: parseFloat(row.health_score || '0'),
        kind_distribution: kinds,
      };
    }));

    return topRelaysWithKinds;
  }

  private async computeActivityTimeline(startDate: string, endDate: string) {
    const result = await db.query(`
      SELECT 
        ea.day,
        SUM(ea.event_count) as events,
        COUNT(DISTINCT au.pubkey) as active_users,
        COALESCE(SUM(ea.zap_amount_sats), 0) as zaps
      FROM events_aggregated ea
      LEFT JOIN active_users au ON ea.day = au.day
      WHERE ea.day >= $1 AND ea.day <= $2
      GROUP BY ea.day
      ORDER BY ea.day ASC
    `, [startDate, endDate]);

    return result.rows.map((row: any) => ({
      timestamp: new Date(row.day).getTime() / 1000,
      date: row.day,
      events: parseInt(row.events, 10),
      active_users: parseInt(row.active_users || '0', 10),
      zaps: parseInt(row.zaps || '0', 10),
    }));
  }

  private async saveSnapshot(snapshot: Omit<StatisticsSnapshot, 'id' | 'created_at'>): Promise<void> {
    await db.query(
      `INSERT INTO statistics_snapshots (
        computed_at, time_range, total_relays, active_relays, total_events,
        unique_authors, avg_latency_ms, relay_stats, event_distribution,
        client_stats, top_relays, activity_timeline, data_quality_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        snapshot.computed_at,
        snapshot.time_range,
        snapshot.total_relays,
        snapshot.active_relays,
        snapshot.total_events,
        snapshot.unique_authors,
        snapshot.avg_latency_ms,
        JSON.stringify(snapshot.relay_stats),
        JSON.stringify(snapshot.event_distribution),
        JSON.stringify(snapshot.client_stats),
        JSON.stringify(snapshot.top_relays),
        JSON.stringify(snapshot.activity_timeline),
        snapshot.data_quality_score,
      ]
    );
  }

  public async getLatestSnapshot(timeRange: string): Promise<StatisticsSnapshot | null> {
    // Try Redis cache first
    const cached = await redis.get<StatisticsSnapshot>(`stats:${timeRange}`);
    if (cached) {
      return cached;
    }

    // Fall back to database
    const result = await db.query<StatisticsSnapshot>(
      `SELECT * FROM statistics_snapshots
       WHERE time_range = $1
       ORDER BY computed_at DESC
       LIMIT 1`,
      [timeRange]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const snapshot = result.rows[0];
    
    // Cache for next time
    await redis.set(`stats:${timeRange}`, snapshot, 3600);

    return snapshot;
  }

  public async cleanOldSnapshots(daysToKeep: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await db.query(
      'DELETE FROM statistics_snapshots WHERE computed_at < $1',
      [cutoffDate]
    );

    logger.info({ deleted: result.rowCount }, 'Cleaned old statistics snapshots');
    return result.rowCount || 0;
  }

  /**
   * Start the statistics computation service
   * Runs computations on an interval
   */
  public async start(): Promise<void> {
    logger.info('Starting statistics computation service');

    // Compute initial statistics
    await this.computeAllStatistics();

    // Set up interval for periodic computation (every 1 minute)
    setInterval(async () => {
      try {
        await this.computeAllStatistics();
      } catch (error) {
        logger.error({ error }, 'Failed to compute statistics on interval');
      }
    }, 60000); // 1 minute

    logger.info('Statistics computation service started with 1-minute interval');
  }
}


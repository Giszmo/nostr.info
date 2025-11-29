import { RelayCollectorService } from './services/relay-collector';
import { StatisticsService } from './services/statistics';
import db from './database/client';
import redis from './database/redis';
import logger from './utils/logger';
import config from './utils/config';
import cron from 'node-cron';

const collectorService = new RelayCollectorService();
const statisticsService = new StatisticsService();

async function main() {
  logger.info('Starting Nostr Data Collector');
  logger.info({ config: { node_env: config.node_env } }, 'Configuration loaded');

  try {
    // Initialize database and Redis
    await db.initialize();
    await redis.connect();

    logger.info('Database and Redis connected');

    // Start relay collector
    await collectorService.start();

    // Schedule statistics computation (every 5 minutes)
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Running scheduled statistics computation');
      try {
        await statisticsService.computeAllStatistics();
      } catch (error) {
        logger.error({ error }, 'Failed to compute statistics');
      }
    });

    // Run initial statistics computation
    setTimeout(async () => {
      logger.info('Running initial statistics computation');
      await statisticsService.computeAllStatistics();
    }, 10000); // Wait 10 seconds for data to accumulate

    // Cleanup old snapshots daily
    cron.schedule('0 2 * * *', async () => {
      logger.info('Running scheduled snapshot cleanup');
      try {
        await statisticsService.cleanOldSnapshots(7);
      } catch (error) {
        logger.error({ error }, 'Failed to cleanup snapshots');
      }
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      
      await collectorService.stop();
      await redis.disconnect();
      await db.close();
      
      logger.info('Collector service stopped gracefully');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info('Collector service is running');

    // Log status every minute
    setInterval(() => {
      const status = collectorService.getStatus();
      logger.info({ status }, 'Collector status');
    }, 60000);

  } catch (error) {
    logger.fatal({ error }, 'Failed to start collector service');
    process.exit(1);
  }
}

main();

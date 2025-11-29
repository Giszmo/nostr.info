import { startAPIServer } from './api/server';
import { StatisticsService } from './services/statistics';
import logger from './utils/logger';

async function main() {
  logger.info('Starting Nostr API Server');

  try {
    // Start the API server immediately
    await startAPIServer();

    // Start the statistics computation service in the background
    const statisticsService = new StatisticsService();
    statisticsService.start().catch((error) => {
      logger.error({ error }, 'Statistics service error');
    });
    logger.info('Statistics service started in background');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start API server');
    process.exit(1);
  }
}

main();

import pino from 'pino';
import config from './config';

const logger = pino({
  level: config.log_level,
  transport: config.log_pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export default logger;

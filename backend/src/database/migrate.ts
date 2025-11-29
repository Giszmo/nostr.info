import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import db from './client';
import logger from '../utils/logger';

async function migrate() {
  logger.info('Running database migrations');

  try {
    await db.initialize();

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');

    // Split SQL into statements, handling function definitions with $$
    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;
    
    for (const line of schema.split('\n')) {
      current += line + '\n';
      
      // Track $$ delimiters for function definitions
      if (line.includes('$$')) {
        inDollarQuote = !inDollarQuote;
      }
      
      // Statement ends with semicolon outside dollar quotes
      if (line.trim().endsWith(';') && !inDollarQuote) {
        statements.push(current.trim());
        current = '';
      }
    }

    logger.info({ count: statements.length }, 'Executing SQL statements');

    for (const statement of statements) {
      if (statement.length > 0 && !statement.startsWith('--')) {
        try {
          await db.query(statement);
        } catch (error: any) {
          // Ignore "already exists" errors (code 42P07, 42710, 42P16)
          if (error.code !== '42P07' && error.code !== '42710' && error.code !== '42P16') {
            logger.error({ statement: statement.substring(0, 150), error }, 'Statement failed');
            throw error;
          }
        }
      }
    }

    logger.info('Schema applied successfully');

    // Seed relays from YAML
    const relaysYamlPath = path.join(__dirname, '../../_data/relays.yml');
    try {
      const relaysYaml = await fs.readFile(relaysYamlPath, 'utf-8');
      const relaysData = yaml.parse(relaysYaml);
      const relays = relaysData.wss || [];

      logger.info({ count: relays.length }, 'Seeding relays from _data/relays.yml');

      for (const relayHost of relays) {
        const url = `wss://${relayHost}`;
        const host = relayHost;

        await db.query(
          `INSERT INTO relays (url, host, is_active, is_discovered)
           VALUES ($1, $2, true, false)
           ON CONFLICT (url) DO NOTHING`,
          [url, host]
        );
      }

      logger.info('Relays seeded successfully');
    } catch (error) {
      logger.warn({ error }, 'Could not seed relays from YAML, skipping');
    }

    logger.info('Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

migrate();

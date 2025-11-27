import WebSocket from 'ws';
import { NostrEvent, NostrFilter, BufferedEvent, Relay } from '../types';
import db from '../database/client';
import redis from '../database/redis';
import logger from '../utils/logger';
import config from '../utils/config';

interface RelayConnection {
  relay: Relay;
  ws: WebSocket | null;
  subscriptionId: string;
  reconnectTimeout?: NodeJS.Timeout;
  isConnecting: boolean;
  lastEventTime: number;
}

export class RelayCollectorService {
  private connections: Map<string, RelayConnection> = new Map();
  private eventBuffer: BufferedEvent[] = [];
  private processedEventIds: Set<string> = new Set();
  private flushInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor() {
    // Limit processed event IDs to prevent memory leak
    setInterval(() => {
      if (this.processedEventIds.size > 100000) {
        logger.info('Clearing processed event IDs cache');
        this.processedEventIds.clear();
      }
    }, 3600000); // Every hour
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Relay collector is already running');
      return;
    }

    logger.info('Starting relay collector service');
    this.isRunning = true;

    // Load relays from database
    await this.loadRelays();

    // Start event buffer flush interval
    this.flushInterval = setInterval(() => {
      this.flushEventBuffer();
    }, config.collector.event_flush_interval);

    // Start relay discovery process (runs every 5 minutes)
    setInterval(() => {
      this.runRelayDiscovery();
    }, 5 * 60 * 1000);

    // Run initial discovery after 30 seconds
    setTimeout(() => {
      this.runRelayDiscovery();
    }, 30000);

    logger.info(`Relay collector service started with ${this.connections.size} relays`);
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping relay collector service');
    this.isRunning = false;

    // Clear flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Flush remaining events
    await this.flushEventBuffer();

    // Close all connections
    for (const [url] of this.connections) {
      this.disconnectRelay(url);
    }

    logger.info('Relay collector service stopped');
  }

  private async loadRelays(): Promise<void> {
    try {
      const result = await db.query<Relay>('SELECT * FROM relays WHERE is_active = true');
      
      logger.info(`Loading ${result.rows.length} active relays`);

      for (const relay of result.rows) {
        await this.connectRelay(relay);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load relays from database');
      throw error;
    }
  }

  private async connectRelay(relay: Relay): Promise<void> {
    if (this.connections.has(relay.url)) {
      logger.debug({ url: relay.url }, 'Relay already connected');
      return;
    }

    const connection: RelayConnection = {
      relay,
      ws: null,
      subscriptionId: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      isConnecting: false,
      lastEventTime: Date.now(),
    };

    this.connections.set(relay.url, connection);
    await this.establishConnection(relay.url);
  }

  private async establishConnection(url: string): Promise<void> {
    const connection = this.connections.get(url);
    if (!connection || connection.isConnecting) {
      return;
    }

    connection.isConnecting = true;
    const startTime = Date.now();

    try {
      const ws = new WebSocket(url, {
        handshakeTimeout: 10000,
        perMessageDeflate: false,
      });

      connection.ws = ws;

      ws.on('open', async () => {
        const latency = Date.now() - startTime;
        logger.info({ url, latency }, 'Connected to relay');

        connection.isConnecting = false;

        // Update relay connection status
        await this.updateRelayStatus(url, 'connected', latency);

        // Fetch NIP-11 metadata
        await this.fetchNIP11(url);

        // Subscribe to recent events
        this.subscribeToEvents(url, connection.subscriptionId);

        // Store connection log
        await this.logRelayEvent(url, 'connect', 'Successfully connected', { latency });
      });

      ws.on('message', async (data: Buffer) => {
        await this.handleMessage(url, data);
      });

      ws.on('error', async (error: Error) => {
        logger.error({ url, error: error.message }, 'Relay WebSocket error');
        await this.updateRelayStatus(url, 'error');
        await this.logRelayEvent(url, 'error', error.message);
      });

      ws.on('close', async (code: number, reason: Buffer) => {
        logger.info({ url, code, reason: reason.toString() }, 'Relay connection closed');
        connection.isConnecting = false;
        
        await this.updateRelayStatus(url, 'disconnected');
        await this.logRelayEvent(url, 'disconnect', `Connection closed: ${code}`);

        // Schedule reconnection
        this.scheduleReconnection(url);
      });

      ws.on('ping', () => {
        ws.pong();
      });

    } catch (error) {
      connection.isConnecting = false;
      logger.error({ url, error }, 'Failed to establish connection');
      this.scheduleReconnection(url);
    }
  }

  private subscribeToEvents(url: string, subscriptionId: string): void {
    const connection = this.connections.get(url);
    if (!connection || !connection.ws || connection.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Subscribe to all events from now on.
    const filters: NostrFilter[] = [
      {}, // An empty filter subscribes to all events
    ];

    const subscription = ['REQ', subscriptionId, ...filters];

    try {
      connection.ws.send(JSON.stringify(subscription));
      logger.debug({ url, subscriptionId }, 'Subscribed to events');
    } catch (error) {
      logger.error({ url, error }, 'Failed to send subscription');
    }
  }

  private async handleMessage(url: string, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString());

      if (!Array.isArray(message) || message.length < 2) {
        return;
      }

      const [type, ...rest] = message;

      switch (type) {
        case 'EVENT':
          if (rest.length >= 2) {
            const [_subscriptionId, event] = rest;
            await this.handleEvent(url, event as NostrEvent);
          }
          break;

        case 'EOSE':
          logger.debug({ url, subscriptionId: rest[0] }, 'End of stored events');
          break;

        case 'NOTICE':
          logger.info({ url, notice: rest[0] }, 'Relay notice');
          break;

        case 'OK':
          // Event acceptance response
          break;

        case 'CLOSED':
          logger.info({ url, reason: rest[1] }, 'Subscription closed by relay');
          break;

        case 'AUTH':
          logger.debug({ url }, 'Auth challenge received (not handling yet)');
          break;

        default:
          logger.debug({ url, type }, 'Unknown message type');
      }

      // Update last event time
      const connection = this.connections.get(url);
      if (connection) {
        connection.lastEventTime = Date.now();
      }

    } catch (error) {
      logger.error({ url, error }, 'Failed to parse relay message');
    }
  }

  private async handleEvent(url: string, event: NostrEvent): Promise<void> {
    // Check for duplicates
    if (this.processedEventIds.has(event.id)) {
      return;
    }

    // Validate event
    if (!this.validateEvent(event)) {
      logger.warn({ url, eventId: event.id }, 'Invalid event received');
      return;
    }

    // Mark as processed
    this.processedEventIds.add(event.id);

    // Add to buffer
    this.eventBuffer.push({
      relay: url,
      event,
      received_at: Date.now(),
    });

    // Flush if buffer is full
    if (this.eventBuffer.length >= config.collector.event_buffer_size) {
      await this.flushEventBuffer();
    }

    // Cache event ID in Redis for distributed deduplication
    await redis.set(`event:${event.id}`, '1', 86400); // 24 hour TTL
  }

  private validateEvent(event: NostrEvent): boolean {
    return !!(
      event.id &&
      event.pubkey &&
      event.created_at &&
      typeof event.kind === 'number' &&
      Array.isArray(event.tags) &&
      typeof event.content === 'string' &&
      event.sig
    );
  }

  private async flushEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    logger.info({ count: events.length }, 'Flushing event buffer');

    try {
      await db.transaction(async (client) => {
        for (const { relay, event } of events) {
          // Get relay ID
          const relayResult = await client.query<{ id: string }>(
            'SELECT id FROM relays WHERE url = $1',
            [relay]
          );

          if (relayResult.rows.length === 0) {
            continue;
          }

          const relayId = relayResult.rows[0].id;
          const day = new Date(event.created_at * 1000).toISOString().split('T')[0];

          // Upsert event aggregation
          await client.query(
            `INSERT INTO events_aggregated (day, relay_id, event_kind, event_count, unique_authors)
             VALUES ($1, $2, $3, 1, 1)
             ON CONFLICT (day, relay_id, event_kind)
             DO UPDATE SET 
               event_count = events_aggregated.event_count + 1,
               updated_at = NOW()`,
            [day, relayId, event.kind]
          );

          // Update relay total events
          await client.query(
            'UPDATE relays SET total_events = total_events + 1, updated_at = NOW() WHERE id = $1',
            [relayId]
          );

          // Track active user
          await client.query(
            `INSERT INTO active_users (day, pubkey, event_count, relay_count, relays)
             VALUES ($1, $2, 1, 1, ARRAY[$3::text])
             ON CONFLICT (day, pubkey)
             DO UPDATE SET 
               event_count = active_users.event_count + 1,
               relay_count = (
                 SELECT COUNT(DISTINCT r) 
                 FROM unnest(array_append(active_users.relays, $3::text)) AS r
               ),
               relays = array_append(active_users.relays, $3::text)`,
            [day, event.pubkey, relay]
          );

          // Handle kind 0 (metadata)
          if (event.kind === 0) {
            try {
              const metadata = JSON.parse(event.content);
              await client.query(
                `UPDATE active_users 
                 SET metadata = $1 
                 WHERE day = $2 AND pubkey = $3 AND metadata IS NULL`,
                [JSON.stringify(metadata), day, event.pubkey]
              );
            } catch (e) {
              // Invalid JSON in metadata
            }
          }

          // Handle kind 9735 (zaps)
          if (event.kind === 9735) {
            const zapAmount = this.extractZapAmount(event);
            if (zapAmount > 0) {
              await client.query(
                `UPDATE events_aggregated 
                 SET zap_amount_sats = zap_amount_sats + $1 
                 WHERE day = $2 AND relay_id = $3 AND event_kind = 9735`,
                [zapAmount, day, relayId]
              );
            }
          }

          // Handle kind 10002 (relay lists - NIP-65) for relay discovery
          if (event.kind === 10002) {
            await this.discoverRelaysFromEvent(event, client);
          }

          // Track client
          const client_name = this.extractClient(event);
          if (client_name) {
            await client.query(
              `INSERT INTO clients (name, normalized_name, total_events, unique_users, first_seen_at, last_seen_at)
               VALUES ($1, $2, 1, 1, NOW(), NOW())
               ON CONFLICT (name)
               DO UPDATE SET 
                 total_events = clients.total_events + 1,
                 last_seen_at = NOW()`,
              [client_name, client_name.toLowerCase()]
            );
          }
        }
      });

      logger.info({ count: events.length }, 'Successfully flushed events to database');
    } catch (error) {
      logger.error({ error, count: events.length }, 'Failed to flush events');
      // Put events back in buffer for retry
      this.eventBuffer.unshift(...events);
    }
  }

    // Ensure relay exists in DB before update/log
  private async ensureRelayExists(url: string): Promise<void> {
    // Extract host from URL
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      host = url.replace(/^wss?:\/\//, '').split('/')[0];
    }
    await db.query(
      `INSERT INTO relays (url, host, is_active, is_discovered)
       VALUES ($1, $2, true, true)
       ON CONFLICT (url) DO NOTHING`,
      [url, host]
    );
  }

  private extractClient(event: NostrEvent): string | null {
    // Look for client tag
    for (const tag of event.tags) {
      if (tag[0] === 'client' && tag[1]) {
        return tag[1];
      }
    }

    // Try parsing content for client info
    if (event.kind === 0) {
      try {
        const metadata = JSON.parse(event.content);
        if (metadata.client) return metadata.client;
      } catch {
        // Not JSON
      }
    }

    return null;
  }

  private extractZapAmount(event: NostrEvent): number {
    try {
      const bolt11Tag = event.tags.find((tag) => tag[0] === 'bolt11');
      if (bolt11Tag && bolt11Tag[1]) {
        // Simplified amount extraction - you'd use a proper bolt11 decoder
        const match = bolt11Tag[1].match(/(\d+)m/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    } catch {
      // Ignore errors
    }
    return 0;
  }

  private async fetchNIP11(url: string): Promise<void> {
    try {
      const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
      const response = await fetch(httpUrl, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const nip11 = (await response.json()) as { supported_nips?: number[] };
        await db.query(
          'UPDATE relays SET nip11_data = $1, supported_nips = $2 WHERE url = $3',
          [JSON.stringify(nip11), nip11.supported_nips || [], url]
        );
        logger.debug({ url }, 'Fetched NIP-11 metadata');
      }
    } catch (error) {
      logger.debug({ url, error }, 'Failed to fetch NIP-11 metadata');
    }
  }

  private async updateRelayStatus(
    url: string,
    status: 'connected' | 'disconnected' | 'error',
    latency?: number
  ): Promise<void> {
    try {
      await this.ensureRelayExists(url);
      if (status === 'connected') {
        await db.query(
          `UPDATE relays 
           SET last_connected_at = NOW(), 
               connection_attempts = connection_attempts + 1,
               avg_latency_ms = $1,
               updated_at = NOW()
           WHERE url = $2`,
          [latency, url]
        );
      } else {
        await db.query(
          'UPDATE relays SET last_disconnected_at = NOW(), updated_at = NOW() WHERE url = $1',
          [url]
        );
      }
    } catch (error) {
      logger.error({ url, error }, 'Failed to update relay status');
    }
  }

  private async logRelayEvent(
    url: string,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.ensureRelayExists(url);
      const relayResult = await db.query<{ id: string }>(
        'SELECT id FROM relays WHERE url = $1',
        [url]
      );

      if (relayResult.rows.length > 0) {
        await db.query(
          'INSERT INTO relay_logs (relay_id, event_type, message, metadata) VALUES ($1, $2, $3, $4)',
          [relayResult.rows[0].id, eventType, message, JSON.stringify(metadata || {})]
        );
      }
    } catch (error) {
      logger.error({ url, error }, 'Failed to log relay event');
    }
  }

  private scheduleReconnection(url: string): void {
    const connection = this.connections.get(url);
    if (!connection) {
      return;
    }

    // Clear existing timeout
    if (connection.reconnectTimeout) {
      clearTimeout(connection.reconnectTimeout);
    }

    // Schedule reconnection
    connection.reconnectTimeout = setTimeout(() => {
      logger.info({ url }, 'Attempting to reconnect');
      this.establishConnection(url);
    }, config.collector.relay_reconnect_delay);
  }

  private disconnectRelay(url: string): void {
    const connection = this.connections.get(url);
    if (!connection) {
      return;
    }

    // Clear reconnect timeout
    if (connection.reconnectTimeout) {
      clearTimeout(connection.reconnectTimeout);
    }

    // Close WebSocket
    if (connection.ws) {
      connection.ws.close();
      connection.ws = null;
    }

    this.connections.delete(url);
    logger.info({ url }, 'Disconnected from relay');
  }

  public getStatus() {
    const connected = Array.from(this.connections.values()).filter(
      (c) => c.ws && c.ws.readyState === WebSocket.OPEN
    ).length;

    return {
      isRunning: this.isRunning,
      totalRelays: this.connections.size,
      connectedRelays: connected,
      eventBufferSize: this.eventBuffer.length,
      processedEventIds: this.processedEventIds.size,
    };
  }

  /**
   * Discover new relays from NIP-65 relay list events (kind 10002)
   */
  private async discoverRelaysFromEvent(event: NostrEvent, client: any): Promise<void> {
    if (!event.tags || !Array.isArray(event.tags)) {
      return;
    }

    // Extract relay URLs from 'r' tags
    const relayUrls = event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .flatMap((tag) => this.splitRelayTagValue(tag[1]))
      .map((url) => this.normalizeRelayUrl(url))
      .filter((url) => {
        if (!url) return false;
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
        } catch {
          return false;
        }
      });

    // Add unique discovered relays to database
    for (const url of relayUrls) {
      try {
        // Check if relay already exists
        const existingRelay = await client.query(
          'SELECT id FROM relays WHERE url = $1',
          [url]
        );

        if (existingRelay.rows.length === 0) {
          // Add new discovered relay
          const host = new URL(url).host;
          const insertResult: any = await client.query(
            `INSERT INTO relays (url, host, is_active, is_discovered)
             VALUES ($1, $2, true, true)
             ON CONFLICT (url) DO NOTHING
             RETURNING id, url`,
            [url, host]
          );
          
          if (insertResult.rows.length > 0) {
            logger.info({ url, discoveredFrom: event.pubkey }, 'Discovered new relay from NIP-65');
            
            // Attempt to connect to the newly discovered relay after a delay
            setTimeout(() => {
              this.connectDiscoveredRelay(url);
            }, Math.random() * 10000); // Random delay 0-10 seconds
          }
        }
      } catch (error) {
        logger.debug({ url, error }, 'Failed to add discovered relay');
      }
    }
  }

  /**
   * Periodically query for relay lists from active users
   */
  private async runRelayDiscovery(): Promise<void> {
    try {
      // Get active users from last 24 hours
      const result = await db.query<{ pubkey: string }>(
        `SELECT DISTINCT pubkey 
         FROM active_users 
         WHERE day >= CURRENT_DATE - INTERVAL '1 day' 
         LIMIT 100`
      );

      if (result.rows.length === 0) {
        logger.debug('No active users found for relay discovery');
        return;
      }

      const pubkeys = result.rows.map((r) => r.pubkey);
      logger.info({ count: pubkeys.length }, 'Running relay discovery for active users');

      // Get connected relays
      const connectedRelays = Array.from(this.connections.values())
        .filter((c) => c.ws && c.ws.readyState === WebSocket.OPEN)
        .slice(0, 10); // Use up to 10 relays for discovery

      if (connectedRelays.length === 0) {
        logger.debug('No connected relays available for discovery');
        return;
      }

      // Query for relay lists in batches
      const batchSize = 50;
      for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);

        connectedRelays.forEach((connection) => {
          if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
            const discoverySubId = `discovery-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const subscription = [
              'REQ',
              discoverySubId,
              {
                kinds: [10002],
                authors: batch,
                limit: batch.length,
              },
            ];

            try {
              connection.ws.send(JSON.stringify(subscription));
              logger.debug({ relay: connection.relay.url, authors: batch.length }, 'Requested relay lists');
            } catch (error) {
              logger.error({ relay: connection.relay.url, error }, 'Failed to send discovery request');
            }
          }
        });
      }

      logger.info('Relay discovery queries sent');
    } catch (error) {
      logger.error({ error }, 'Failed to run relay discovery');
    }
  }

  /**
   * Connect to a newly discovered relay
   */
  private async connectDiscoveredRelay(url: string): Promise<void> {
    try {
      // Fetch relay from database
      const result: any = await db.query(
        'SELECT * FROM relays WHERE url = $1 AND is_active = true',
        [url]
      );

      if (result.rows.length > 0) {
        const relay = result.rows[0];
        await this.connectRelay(relay);
        logger.info({ url }, 'Connected to discovered relay');
      }
    } catch (error) {
      logger.error({ url, error }, 'Failed to connect to discovered relay');
    }
  }

  /**
   * Split relay tag value that may contain multiple URLs
   */
  private splitRelayTagValue(rawValue: string): string[] {
    if (!rawValue || typeof rawValue !== 'string') {
      return [];
    }

    let working = rawValue.trim();
    if (!working) {
      return [];
    }

    // Try to decode URL encoding
    try {
      working = decodeURIComponent(working);
    } catch {
      // Keep original if decode fails
    }

    // Replace common separators with space
    working = working.replace(/[\s,;|]+/g, ' ').trim();
    if (!working) {
      return [];
    }

    return working.split(' ').filter(Boolean);
  }

  /**
   * Normalize relay URL to standard format
   */
  private normalizeRelayUrl(url: string): string {
    if (!url) {
      return '';
    }

    try {
      // Trim whitespace
      url = url.trim();

      // Add wss:// if no protocol specified
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        url = 'wss://' + url;
      }

      // Parse and reconstruct URL to normalize
      const parsed = new URL(url);
      
      // Remove trailing slash
      let normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch {
      return '';
    }
  }
}


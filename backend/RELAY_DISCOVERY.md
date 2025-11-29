# Relay Discovery Feature (NIP-65)

## Overview

The backend collector service now includes automatic relay discovery using NIP-65 relay list events (kind 10002). This allows the system to dynamically discover new relays that users are actively using across the Nostr network.

## How It Works

### 1. Event Subscription
The collector subscribes to kind 10002 events (relay lists) from all connected relays:
```typescript
{ kinds: [10002], limit: 100, since: oneHourAgo }
```

### 2. Processing Relay List Events
When a kind 10002 event is received:
- Extracts relay URLs from `r` tags in the event
- Handles multiple URL formats and separators (spaces, commas, semicolons)
- Normalizes URLs to standard format (wss://)
- Validates URLs (must be valid WebSocket URLs)
- Inserts new relays into database with `is_discovered = true`

### 3. Periodic Discovery
Every 5 minutes, the service:
- Queries for up to 100 active users from the last 24 hours
- Sends REQ messages to connected relays requesting relay lists from these users
- Processes discovered relays as they arrive

Initial discovery runs 30 seconds after service start.

### 4. Automatic Connection
When a new relay is discovered:
- It's added to the database immediately
- A connection attempt is scheduled with a random 0-10 second delay
- The relay is treated like any other relay (health monitoring, event collection)

## Database Schema

Discovered relays are marked in the database:
```sql
is_discovered BOOLEAN DEFAULT false
```

This allows you to:
- Distinguish between curated relays (from relays.yml) and discovered relays
- Query statistics separately
- Build UI features showing relay discovery metrics

## Code Implementation

### Main Components

1. **discoverRelaysFromEvent()** - Processes individual NIP-65 events
   - Extracts and validates relay URLs
   - Adds unique relays to database
   
2. **runRelayDiscovery()** - Periodic discovery process
   - Queries active users
   - Sends REQ messages for relay lists
   - Runs every 5 minutes

3. **connectDiscoveredRelay()** - Connects to newly found relays
   - Fetches relay from database
   - Establishes WebSocket connection
   - Begins event collection

4. **Helper Methods**
   - `splitRelayTagValue()` - Handles multiple URLs in one tag
   - `normalizeRelayUrl()` - Standardizes URL format

## Statistics & Monitoring

Discovered relay counts can be tracked via:

```sql
-- Total discovered relays
SELECT COUNT(*) FROM relays WHERE is_discovered = true;

-- Active discovered relays
SELECT COUNT(*) FROM relays WHERE is_discovered = true AND is_active = true;

-- Discovered vs curated
SELECT 
  is_discovered,
  COUNT(*) as count,
  AVG(health_score) as avg_health
FROM relays
GROUP BY is_discovered;
```

## API Endpoints

The statistics API can be extended to include discovery metrics:

```typescript
GET /api/v1/stats/discovery
{
  "total_discovered": 450,
  "active_discovered": 320,
  "recently_discovered": 15,  // Last 24h
  "discovery_rate": 12.5      // Per day average
}
```

## Configuration

Relay discovery behavior can be tuned via config:

```typescript
// In config.ts
collector: {
  discovery_interval: 5 * 60 * 1000,      // 5 minutes
  discovery_user_limit: 100,               // Users to query
  discovery_relay_limit: 10,               // Relays to query from
  discovery_connection_delay: [0, 10000],  // Random delay range
}
```

## Benefits

1. **Network Coverage** - Automatically expands relay coverage
2. **Decentralization** - Discovers relays across the network organically
3. **User-Driven** - Focuses on relays that real users are actually using
4. **No Manual Updates** - Reduces need for manual relay list maintenance
5. **Better Stats** - More comprehensive network statistics

## Comparison with Original

The original client-side implementation:
- Discovered relays in browser
- Limited by browser connections (~240 relays)
- No persistence across sessions

The new backend implementation:
- Discovers relays server-side
- No connection limits (can handle 1000+ relays)
- Persistent storage in PostgreSQL
- Automatic reconnection and health monitoring
- Better performance (dedicated server resources)

## Example Flow

```
1. User publishes relay list (kind 10002) with tag: ["r", "wss://new-relay.com"]
2. Collector receives event from connected relay
3. Processes event, extracts "wss://new-relay.com"
4. Checks database - relay doesn't exist
5. Inserts: INSERT INTO relays (url, is_discovered) VALUES ('wss://new-relay.com', true)
6. Schedules connection in 7 seconds (random delay)
7. Connection established, begins collecting events
8. New relay appears in statistics and API responses
```

## Future Enhancements

- [ ] Relay reputation scoring based on discovery frequency
- [ ] Geographic clustering of discovered relays
- [ ] Relay recommendation API based on user patterns
- [ ] Discovery metrics in real-time dashboard
- [ ] Automatic pruning of inactive discovered relays
- [ ] NIP-11 metadata fetching for discovered relays

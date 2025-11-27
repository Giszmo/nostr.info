---
permalink: /js/statistics.js
layout: none
---

// Statistics tracking and visualization for Nostr network
// Uses backend API for data consistency and scalability
const API_BASE_URL = 'http://localhost:3000/api/v1'; // Backend API endpoint
const API_POLL_INTERVAL = 60000; // Poll backend every 60 seconds
const LIMIT = 100; // Events to request from each relay
const UPDATE_INTERVAL = 5000; // Update stats every 5 seconds
const CHART_UPDATE_INTERVAL = 30000; // Update charts every 30 seconds (reduced from 10s to avoid rate limiting)

// API Response caching to avoid rate limiting
const apiCache = {
  eventDistribution: { data: null, timestamp: 0 },
  topRelays: { data: null, timestamp: 0 },
  topClients: { data: null, timestamp: 0 }
};
const CACHE_TTL = 60000; // 60 second cache for API responses

// Helper function to get cached API data or fetch fresh
async function getCachedApiData(endpoint, cacheKey) {
  const now = Date.now();
  const cached = apiCache[cacheKey];
  
  // Return cached data if still fresh
  if (cached && cached.data && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.warn(`[API Cache] Error fetching ${endpoint}:`, response.status);
      return cached?.data || null; // Return stale cache if available
    }
    
    const data = await response.json();
    apiCache[cacheKey] = { data, timestamp: now };
    return data;
  } catch (err) {
    console.error(`[API Cache] Error fetching ${endpoint}:`, err);
    return cached?.data || null; // Return stale cache if available
  }
}

// Normalize relay URLs to avoid duplicates
function normalizeRelayUrl(url) {
  if (!url) return null;
  
  // Add wss:// if not present
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = 'wss://' + url;
  }
  
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '').toLowerCase();
  } catch (err) {
    url = url.replace(/\s+/g, '');
  }
  
  // Remove trailing slash
  url = url.replace(/\/$/, '');
  
  // Convert to lowercase for consistency
  url = url.toLowerCase();
  
  return url;
}
// Allow header search to filter visible relay cards and tables on statistics page
window.applyStatisticsSearch = function(query){
  try{
    const q = (query || '').trim().toLowerCase();
    // Filter relay cards if present
    const cards = document.querySelectorAll('.relay-card, .relay-card-header, .top-relays-container .relay-card');
    if(cards && cards.length){
      cards.forEach(c=>{
        const text = c.textContent || '';
        c.style.display = q === '' || text.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    }
    // Filter top-relays table rows if present
    const rows = document.querySelectorAll('.top-relays-table tbody tr');
    if(rows && rows.length){
      rows.forEach(r=>{
        r.style.display = q === '' || r.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    }
  }catch(e){ console.error('applyStatisticsSearch failed', e); }
}

// Global data storage
let relays = [];
let discoveredRelays = new Map(); // URL -> relay object
let allEvents = [];
let eventKindCounts = {};
let activeUsersPubkeys = new Set();
let statsStartTime = Date.now();
let timeRangeMs = 24 * 60 * 60 * 1000; // Default 24 hours
let relayDiscoveryInProgress = false;
let discoveredRelayCount = 0;

const ICON_CONNECTED = `{% fa_svg fas.fa-circle-check %}`;
// Use icons that are present in the site's FA set to avoid missing icons at runtime
const ICON_SUCCESS = `{% fa_svg fas.fa-chart-line %}`; // replaced fa-gauge-high
const ICON_CURATED = `{% fa_svg fas.fa-clipboard-list %}`;
const ICON_DISCOVERED = `{% fa_svg fas.fa-magnifying-glass %}`; // replaced fa-compass

const NIP_BASE_URL = 'https://github.com/nostr-protocol/nips/blob/master/';
const EVENT_KIND_INFO = {
  0: { label: 'User Metadata', nip: `${NIP_BASE_URL}01.md` },
  1: { label: 'Text Note', nip: `${NIP_BASE_URL}10.md` },
  2: { label: 'Recommend Relay', nip: `${NIP_BASE_URL}01.md` },
  3: { label: 'Follow List', nip: `${NIP_BASE_URL}02.md` },
  4: { label: 'Encrypted Direct Message', nip: `${NIP_BASE_URL}04.md` },
  5: { label: 'Event Deletion', nip: `${NIP_BASE_URL}09.md` },
  6: { label: 'Repost', nip: `${NIP_BASE_URL}18.md` },
  7: { label: 'Reaction', nip: `${NIP_BASE_URL}25.md` },
  8: { label: 'Badge Award', nip: `${NIP_BASE_URL}58.md` },
  9: { label: 'Chat Message', nip: `${NIP_BASE_URL}C7.md` },
  11: { label: 'Thread', nip: `${NIP_BASE_URL}7D.md` },
  13: { label: 'Seal', nip: `${NIP_BASE_URL}59.md` },
  14: { label: 'Private Direct Message', nip: `${NIP_BASE_URL}17.md` },
  15: { label: 'File Message', nip: `${NIP_BASE_URL}17.md` },
  16: { label: 'Generic Repost', nip: `${NIP_BASE_URL}18.md` },
  17: { label: 'External Reaction', nip: `${NIP_BASE_URL}25.md` },
  20: { label: 'Picture Event', nip: `${NIP_BASE_URL}68.md` },
  21: { label: 'Video Event', nip: `${NIP_BASE_URL}71.md` },
  22: { label: 'Portrait Video Event', nip: `${NIP_BASE_URL}71.md` },
  30: { label: 'Internal Reference', nip: 'https://wikistr.com/nkbip-03*fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1' },
  31: { label: 'External Web Reference', nip: 'https://wikistr.com/nkbip-03*fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1' },
  32: { label: 'Hardcopy Reference', nip: 'https://wikistr.com/nkbip-03*fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1' },
  33: { label: 'Prompt Reference', nip: 'https://wikistr.com/nkbip-03*fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1' },
  40: { label: 'Channel Creation', nip: `${NIP_BASE_URL}28.md` },
  41: { label: 'Channel Metadata', nip: `${NIP_BASE_URL}28.md` },
  42: { label: 'Channel Message', nip: `${NIP_BASE_URL}28.md` },
  43: { label: 'Channel Hide Message', nip: `${NIP_BASE_URL}28.md` },
  44: { label: 'Channel Mute User', nip: `${NIP_BASE_URL}28.md` },
  60: { label: 'Ride Sharing', nip: null },
  62: { label: 'Request to Vanish', nip: `${NIP_BASE_URL}62.md` },
  64: { label: 'Chess (PGN)', nip: `${NIP_BASE_URL}64.md` },
  1059: { label: 'Gift Wrap', nip: `${NIP_BASE_URL}59.md` },
  1063: { label: 'File Metadata', nip: `${NIP_BASE_URL}94.md` },
  1068: { label: 'Poll', nip: `${NIP_BASE_URL}88.md` },
  1111: { label: 'Comment', nip: `${NIP_BASE_URL}22.md` },
  1222: { label: 'Voice Message', nip: `${NIP_BASE_URL}A0.md` },
  1311: { label: 'Live Chat Message', nip: `${NIP_BASE_URL}53.md` },
  1984: { label: 'Reporting', nip: `${NIP_BASE_URL}56.md` },
  1985: { label: 'Label', nip: `${NIP_BASE_URL}32.md` },
  1986: { label: 'Relay Review', nip: null },
  2003: { label: 'Torrent', nip: `${NIP_BASE_URL}35.md` },
  2004: { label: 'Torrent Comment', nip: `${NIP_BASE_URL}35.md` },
  22242: { label: 'Client Authentication', nip: `${NIP_BASE_URL}42.md` },
  22820: { label: 'WebRTC Connection', nip: null },
  22955: { label: 'WebRTC Signaling', nip: null },
  23194: { label: 'Wallet Request', nip: `${NIP_BASE_URL}47.md` },
  23195: { label: 'Wallet Response', nip: `${NIP_BASE_URL}47.md` },
  24133: { label: 'Nostr Connect', nip: `${NIP_BASE_URL}46.md` },
  27235: { label: 'HTTP Auth', nip: `${NIP_BASE_URL}98.md` },
  30000: { label: 'Follow Set', nip: `${NIP_BASE_URL}51.md` },
  30001: { label: 'Generic Set', nip: `${NIP_BASE_URL}51.md` },
  30002: { label: 'Relay Set', nip: `${NIP_BASE_URL}51.md` },
  30003: { label: 'Bookmark Set', nip: `${NIP_BASE_URL}51.md` },
  30004: { label: 'Curation Set', nip: `${NIP_BASE_URL}51.md` },
  30008: { label: 'Profile Badges', nip: `${NIP_BASE_URL}58.md` },
  30009: { label: 'Badge Definition', nip: `${NIP_BASE_URL}58.md` },
  30015: { label: 'Interest Set', nip: `${NIP_BASE_URL}51.md` },
  30023: { label: 'Long-form Content', nip: `${NIP_BASE_URL}23.md` },
  30024: { label: 'Draft Long-form Content', nip: `${NIP_BASE_URL}23.md` },
  30030: { label: 'Emoji Set', nip: `${NIP_BASE_URL}51.md` },
  30311: { label: 'Live Event', nip: `${NIP_BASE_URL}53.md` },
  30312: { label: 'Interactive Room', nip: `${NIP_BASE_URL}53.md` },
  30313: { label: 'Conference Event', nip: `${NIP_BASE_URL}53.md` },
  30315: { label: 'User Status', nip: `${NIP_BASE_URL}38.md` },
  30818: { label: 'Wiki Article', nip: `${NIP_BASE_URL}54.md` },
  30819: { label: 'Wiki Redirect', nip: `${NIP_BASE_URL}54.md` },
  31922: { label: 'Date Calendar Event', nip: `${NIP_BASE_URL}52.md` },
  31923: { label: 'Time Calendar Event', nip: `${NIP_BASE_URL}52.md` },
  31924: { label: 'Calendar', nip: `${NIP_BASE_URL}52.md` },
  31925: { label: 'Calendar RSVP', nip: `${NIP_BASE_URL}52.md` },
  31989: { label: 'Handler Recommendation', nip: `${NIP_BASE_URL}89.md` },
  31990: { label: 'Handler Information', nip: `${NIP_BASE_URL}89.md` },
  34550: { label: 'Community Definition', nip: `${NIP_BASE_URL}72.md` },
  39089: { label: 'Starter Pack', nip: `${NIP_BASE_URL}51.md` },
  39701: { label: 'Web Bookmark', nip: `${NIP_BASE_URL}B0.md` },
  9734: { label: 'Zap Request', nip: `${NIP_BASE_URL}57.md` },
  9735: { label: 'Zap', nip: `${NIP_BASE_URL}57.md` },
  9802: { label: 'Highlight', nip: `${NIP_BASE_URL}84.md` },
  10000: { label: 'Mute List', nip: `${NIP_BASE_URL}51.md` },
  10001: { label: 'Pin List', nip: `${NIP_BASE_URL}51.md` },
  10002: { label: 'Relay List Metadata', nip: `${NIP_BASE_URL}65.md` },
  10003: { label: 'Bookmark List', nip: `${NIP_BASE_URL}51.md` },
  10004: { label: 'Communities List', nip: `${NIP_BASE_URL}51.md` },
  10005: { label: 'Public Chats List', nip: `${NIP_BASE_URL}51.md` },
  10006: { label: 'Blocked Relays List', nip: `${NIP_BASE_URL}51.md` },
  10007: { label: 'Search Relays List', nip: `${NIP_BASE_URL}51.md` },
  10009: { label: 'User Groups', nip: `${NIP_BASE_URL}51.md` },
  10012: { label: 'Favorite Relays List', nip: `${NIP_BASE_URL}51.md` },
  10013: { label: 'Private Event Relay List', nip: `${NIP_BASE_URL}37.md` },
  10015: { label: 'Interests List', nip: `${NIP_BASE_URL}51.md` },
  10019: { label: 'Nutzap Mint Recommendation', nip: `${NIP_BASE_URL}61.md` },
  10020: { label: 'Media Follows', nip: `${NIP_BASE_URL}51.md` },
  10030: { label: 'User Emoji List', nip: `${NIP_BASE_URL}51.md` },
  10050: { label: 'Relay List to Receive DMs', nip: `${NIP_BASE_URL}17.md` },
  10051: { label: 'KeyPackage Relays List', nip: `${NIP_BASE_URL}EE.md` },
  10063: { label: 'User Server List', nip: 'https://github.com/hzrd149/blossom' },
  10096: { label: 'File Storage Server List', nip: `${NIP_BASE_URL}96.md` },
  10166: { label: 'Relay Monitor Announcement', nip: `${NIP_BASE_URL}66.md` },
  10312: { label: 'Room Presence', nip: `${NIP_BASE_URL}53.md` },
  10377: { label: 'Proxy Announcement', nip: 'https://github.com/Origami74/nostr-epoxy-reverse-proxy' },
  11111: { label: 'Transport Method Announcement', nip: 'https://github.com/Origami74/nostr-epoxy-reverse-proxy' },
  13194: { label: 'Wallet Info', nip: `${NIP_BASE_URL}47.md` },
  17375: { label: 'Cashu Wallet Event', nip: `${NIP_BASE_URL}60.md` },
  21000: { label: 'Lightning Pub RPC', nip: 'https://github.com/shocknet/Lightning.Pub/blob/master/proto/autogenerated/client.md' },
  38383: { label: 'Peer-to-peer Order Event', nip: `${NIP_BASE_URL}69.md` },
  30078: { label: 'App-specific Data', nip: `${NIP_BASE_URL}78.md` },
  24242: { label: 'Media Server Blob', nip: 'https://github.com/hzrd149/blossom' }
};

// Chart instances
let eventKindsChart = null;
let eventKindsBarChart = null;
let clientCounts = {};

// Function to recalculate client counts from all events (used after changing extraction logic)
function recalculateClientCounts() {
  clientCounts = {};
  allEvents.forEach(event => {
    const client = extractClientFromEvent(event);
    if (client) {
      clientCounts[client] = (clientCounts[client] || 0) + 1;
    }
  });
  console.log(`Recalculated client counts: ${Object.keys(clientCounts).length} unique clients found`);
}

const metadataByPubkey = new Map();
const eventsByKind = new Map([[ 'all', [] ]]);
const MAX_EVENTS_TRACKED = 400;
const MAX_EVENTS_PER_KIND = 120;
const eventListeners = new Set();
let connectionSnapshot = {
  total: 0,
  connected: 0,
  successRate: 0,
  curated: { total: 0, connected: 0 },
  discovered: { total: 0, connected: 0 },
  updatedAt: null
};
const seenFeedEventIds = new Set();
const feedEventIdQueue = [];
const MAX_FEED_TRACKED_IDS = 600;

window.nostrStats = window.nostrStats || {};

Object.assign(window.nostrStats, {
  getEventsForKind(kind = 'all') {
    const key = kind === 'all' ? 'all' : String(kind);
    const bucket = eventsByKind.get(key);
    return bucket ? bucket.slice() : [];
  },
  getMetadataForPubkey(pubkey) {
    if (!pubkey) return null;
    return metadataByPubkey.get(pubkey) || null;
  },
  getAvailableEventKinds() {
    return Array.from(eventsByKind.keys())
      .filter(key => key !== 'all')
      .map(Number)
      .sort((a, b) => a - b);
  },
  getKindLabel(kind) {
    return getKindInfo(Number(kind)).label;
  },
  getConnectionSnapshot() {
    return {
      total: connectionSnapshot.total,
      connected: connectionSnapshot.connected,
      successRate: connectionSnapshot.successRate,
      updatedAt: connectionSnapshot.updatedAt,
      curated: {
        total: connectionSnapshot.curated.total,
        connected: connectionSnapshot.curated.connected
      },
      discovered: {
        total: connectionSnapshot.discovered.total,
        connected: connectionSnapshot.discovered.connected
      }
    };
  },
  subscribeEvents(listener) {
    if (typeof listener !== 'function') return () => {};
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  },
  getLegacyStats() {
    const cutoffTime = Date.now() - timeRangeMs;
    const totalRelays = relays.length;
    const connectedRelays = relays.filter(r => r.connected).length;
    const activeRelays = relays.filter(r => r.connected && r.events > 0).length;
    const recentEvents = allEvents.filter(e => e.created_at * 1000 >= cutoffTime);
    const totalEvents = recentEvents.length;
    
    const relaysWithLatency = relays.filter(r => r.latencies.length > 0);
    let avgResponseMs = null;
    if (relaysWithLatency.length > 0) {
      const allLatencies = relaysWithLatency.flatMap(r => r.latencies);
      avgResponseMs = Math.round(allLatencies.reduce((sum, l) => sum + l, 0) / allLatencies.length);
    }
    
    // Get total unique clients from the legacy extraction method
    const totalClients = Object.keys(clientCounts).length;
    
    return {
      totalRelays,
      connectedRelays,
      activeRelays,
      totalEvents,
      avgResponseMs,
      timeRangeMs,
      totalClients,
      allEvents: allEvents.slice() // Return all events for consistent data source
    };
  },
  getAllEvents() {
    return allEvents.slice();
  },
  getRelays() {
    return relays.map(r => ({
      url: r.url,
      connected: r.connected,
      events: r.events,
      isDiscovered: r.isDiscovered,
      latencies: r.latencies.slice()
    }));
  },
  getClientCounts() {
    // Return a copy of the clientCounts object
    return Object.assign({}, clientCounts);
  },
  getTotalClients() {
    // Return the total number of unique clients detected
    return Object.keys(clientCounts).length;
  },
  recalculateClientCounts() {
    // Expose the recalculation function so it can be called externally
    recalculateClientCounts();
    return Object.keys(clientCounts).length;
  }
});

function notifyEventsUpdated(reason = 'events') {
  const payload = { reason, updatedAt: Date.now() };
  eventListeners.forEach(listener => {
    try {
      listener(payload);
    } catch (err) {
      console.error('nostrStats listener failed', err);
    }
  });
  document.dispatchEvent(new CustomEvent('nostrStats:eventsUpdated', { detail: payload }));
}

function recordEventForFeeds(event) {
  if (!event || typeof event.kind === 'undefined') return;
  if (!event.id) return;

  if (seenFeedEventIds.has(event.id)) {
    return;
  }
  seenFeedEventIds.add(event.id);
  feedEventIdQueue.push(event.id);
  if (feedEventIdQueue.length > MAX_FEED_TRACKED_IDS) {
    const oldestId = feedEventIdQueue.shift();
    if (oldestId) {
      seenFeedEventIds.delete(oldestId);
    }
  }
  const kindKey = String(event.kind);

  if (!eventsByKind.has(kindKey)) {
    eventsByKind.set(kindKey, []);
  }
  const bucket = eventsByKind.get(kindKey);
  bucket.unshift(event);
  if (bucket.length > MAX_EVENTS_PER_KIND) {
    bucket.length = MAX_EVENTS_PER_KIND;
  }

  let allBucket = eventsByKind.get('all');
  if (!allBucket) {
    allBucket = [];
    eventsByKind.set('all', allBucket);
  }
  allBucket.unshift(event);
  if (allBucket.length > MAX_EVENTS_TRACKED) {
    allBucket.length = MAX_EVENTS_TRACKED;
  }
}

function recordMetadataEvent(event) {
  if (!event || !event.pubkey || !event.content) return;
  try {
    const parsed = typeof event.content === 'string' ? JSON.parse(event.content) : {};
    const profile = {
      pubkey: event.pubkey,
      name: parsed.name || '',
      displayName: parsed.display_name || parsed.displayName || parsed.name || '',
      about: parsed.about || '',
      picture: parsed.picture || parsed.image || '',
      nip05: parsed.nip05 || '',
      lud16: parsed.lud16 || parsed.lud06 || '',
      updatedAt: (event.created_at || 0) * 1000,
      raw: event
    };
    metadataByPubkey.set(event.pubkey, profile);
    notifyEventsUpdated('metadata');
  } catch (err) {
    // metadata can be invalid JSON; ignore silently
  }
}

function setupStatisticsTabs() {
  const tabs = Array.from(document.querySelectorAll('.stats-tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  if (!tabs.length || !panels.length) {
    return;
  }

  tabs.forEach(tab => {
    const isActive = tab.classList.contains('active');
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  panels.forEach(panel => {
    const isActive = panel.classList.contains('active');
    panel.toggleAttribute('hidden', !isActive);
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(btn => {
        const isCurrent = btn === tab;
        btn.classList.toggle('active', isCurrent);
        btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        btn.setAttribute('tabindex', isCurrent ? '0' : '-1');
      });
      panels.forEach(panel => {
        const isCurrent = panel.dataset.tabPanel === target;
        panel.classList.toggle('active', isCurrent);
        panel.toggleAttribute('hidden', !isCurrent);
      });
    });
  });
}

// Backend API Integration - PRIMARY DATA SOURCE FOR STATISTICS
// ALL statistics shown in the UI come from backend API (/api/v1/stats/overview)
// DO NOT calculate metrics from local relay connections
let backendStatsCache = null;
let lastBackendUpdate = 0;

// Expose to window so React components can access it
window.backendStatsCache = backendStatsCache;

// Fetch statistics from backend API
// This is the AUTHORITATIVE source for all display metrics
async function fetchBackendStats() {
  try {
    const url = `${API_BASE_URL}/stats/overview?range=24h`;
    console.log(`[Backend] Fetching from: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`[Backend] API returned HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    console.log('[Backend] ✅ Stats received successfully:', {
      total_relays: data.total_relays,
      active_relays: data.active_relays,
      total_events: data.total_events,
      unique_authors: data.unique_authors,
      avg_latency_ms: data.avg_latency_ms,
      updated_at: data.updated_at
    });
    
    backendStatsCache = data;
    lastBackendUpdate = Date.now();
    
    // CRITICAL: Update window reference so React components can access it
    window.backendStatsCache = backendStatsCache;
    console.log('[Backend] Updated window.backendStatsCache:', window.backendStatsCache);
    
    // Update UI with backend data
    updateAnalyticsFromBackend(data);
    
    return data;
  } catch (error) {
    console.error('[Backend] ❌ Error fetching stats:', error.message);
    console.error('[Backend] Stack:', error.stack);
    return null;
  }
}

// Update analytics with backend data
function updateAnalyticsFromBackend(backendData) {
  if (!backendData) return;
  
  console.log('[Backend Update] Updating UI with backend data');
  
  // Update connection status banner with backend data
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    const totalRelays = backendData.total_relays || 0;
    const activeRelays = backendData.active_relays || 0;
    const totalEvents = backendData.total_events || 0;
    const uniqueAuthors = backendData.unique_authors || 0;
    
    const textEl = statusEl.querySelector('.events-progress-text');
    if (textEl) {
      textEl.textContent = `${activeRelays}/${totalRelays} relays online · ${totalEvents.toLocaleString()} events · ${uniqueAuthors.toLocaleString()} authors`;
    }
    
    const indicator = statusEl.querySelector('.events-progress-indicator');
    if (indicator && activeRelays > 0) {
      indicator.classList.add('is-ready');
    }
  }
  
  // Update all charts with backend data
  console.log('[Backend Update] Updating charts with backend data');
  updateKindsChart();
  updateKindsBarChart();
  updateTopRelays();
  
  // Sync with analytics system if available
  if (window.analytics) {
    console.log('[Backend Update] Notifying analytics system');
    window.analytics.notifyListeners('backend-update', {
      totalRelays: backendData.total_relays,
      activeRelays: backendData.active_relays,
      totalEvents: backendData.total_events,
      uniqueAuthors: backendData.unique_authors,
      avgLatency: backendData.avg_latency_ms
    });
  }
  
  // Dispatch global event for React components to listen to
  console.log('[Backend Update] Dispatching global backend-stats-updated event');
  window.dispatchEvent(new CustomEvent('backend-stats-updated', {
    detail: backendData,
    bubbles: true,
    composed: true
  }));
  
  // Force React update by updating timestamp
  window.backendStatsUpdatedAt = Date.now();
  
  // Also dispatch a version-increment counter to force React re-renders
  window.backendStatsVersion = (window.backendStatsVersion || 0) + 1;
  console.log('[Backend Update] Backend stats version:', window.backendStatsVersion);
}

// Initialize on page load
window.addEventListener('load', () => {
  console.log('=== NOSTR.INFO STATISTICS PAGE INITIALIZATION ===');
  console.log('Backend API URL:', API_BASE_URL);
  
  setupStatisticsTabs();
  initializeStatistics();
  setupCharts();
  
  // PRIMARY: Fetch from backend API for statistics
  console.log('[Initialization] Attempting to fetch statistics from backend API...');
  fetchBackendStats()
    .then(data => {
      if (data) {
        console.log('[Initialization] ✅ SUCCESS - Backend API available, using backend data exclusively');
        console.log('[Initialization] Data:', data);
        // Backend provides authoritative statistics data
        startBackendPolling();
        console.log('[Initialization] Backend polling started (60s interval)');
        // DO NOT connect to relays for statistics - backend is authoritative
      } else {
        console.warn('[Initialization] ⚠️ FALLBACK - Backend API unavailable, falling back to relay connections');
        console.warn('[Initialization] This should only happen if backend is not running');
        // Fallback ONLY if backend is down
        connectToRelays();
        startRelayDiscovery();
      }
    })
    .catch(error => {
      console.error('[Initialization] ❌ EXCEPTION - Failed to initialize:', error);
      console.warn('[Initialization] Falling back to relay connections');
      connectToRelays();
      startRelayDiscovery();
    });
  
  startPeriodicUpdates();
  console.log('[Initialization] Periodic UI updates started');
});

// Poll backend API for updated statistics
function startBackendPolling() {
  let lastPoll = 0;
  setInterval(() => {
    const now = Date.now();
    if (now - lastPoll >= API_POLL_INTERVAL) {
      fetchBackendStats();
      lastPoll = now;
    }
  }, API_POLL_INTERVAL);
}

function initializeStatistics() {
  // Load relay list from Jekyll data
  const relayUrls = {{ site.data.relays.wss | jsonify }};
  
  // Normalize URLs to avoid duplicates
  const allRelayUrls = [...new Set(
    relayUrls.map(url => normalizeRelayUrl(url)).filter(url => url)
  )];
  
  relays = allRelayUrls.map(url => createRelayObject(url));
  
  // Initialize discovered relays map
  relays.forEach(relay => {
    discoveredRelays.set(relay.url, relay);
  });
  
  console.log(`[Initialization] Initialized with ${relays.length} curated relays`);
}

function createRelayObject(url) {
  return {
    url: url,
    connected: false,
    answered: false,
    events: 0,
    eventsByKind: {},
    eventsList: [],
    activeUsers: new Set(),
    latencies: [],
    connectedAt: null,
    disconnectedAt: null,
    ws: null,
    tried: false,
    isDiscovered: false,
    reliability: 0, // 0-100 score based on uptime and responsiveness
    lastConnectionAttempt: null
  };
}

const MAX_CONCURRENT_RELAYS = 20;
let relayQueue = [];
let activeRelayCount = 0;

function connectToRelays() {
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    const textEl = statusEl.querySelector('.events-progress-text');
    const indicator = statusEl.querySelector('.events-progress-indicator');
    if (textEl) {
      textEl.textContent = `Connecting to ${relays.length} relays…`;
    }
    if (indicator) {
      indicator.classList.remove('is-ready');
    }
  }
  relayQueue = relays.map((r, i) => ({ relay: r, index: i }));
  activeRelayCount = 0;
  startRelayPool();
}

function startRelayPool() {
  while (activeRelayCount < MAX_CONCURRENT_RELAYS && relayQueue.length > 0) {
    const { relay, index } = relayQueue.shift();
    activeRelayCount++;
    setupWebSocketWithPool(relay, index);
  }
}

function setupWebSocketWithPool(relay, index) {
  if (relay.tried) {
    activeRelayCount--;
    startRelayPool();
    return;
  }
  relay.tried = true;
  const ws = new WebSocket(relay.url);
  relay.ws = ws;
  const reqSentAt = {};
  ws.onopen = () => {
    relay.connected = true;
    relay.answered = true;
    relay.connectedAt = Date.now();
    console.log(`Connected to ${relay.url}`);
    // ...existing code...
    const now = Math.floor(Date.now() / 1000);
    const since = now - Math.floor(timeRangeMs / 1000);
    reqSentAt['main'] = Date.now();
    ws.send(JSON.stringify(["REQ", "stats-main", {
      "limit": LIMIT,
      "since": since,
      "until": now + 3600
    }]));
    reqSentAt['meta'] = Date.now();
    ws.send(JSON.stringify(["REQ", "stats-meta", {"kinds": [0], "limit": 100}]));
    updateConnectionStatus();
  };
  ws.onmessage = (msg) => {
    // ...existing code...
    try {
      const data = JSON.parse(msg.data);
      if (data[0] === 'EVENT') {
        const subscriptionId = data[1];
        const event = data[2];
        if (event.kind === 0) {
          recordMetadataEvent(event);
          if (subscriptionId === 'stats-meta') {
            return;
          }
        }
        if (reqSentAt[subscriptionId.replace('stats-', '')]) {
          const latency = Date.now() - reqSentAt[subscriptionId.replace('stats-', '')];
          relay.latencies.push(latency);
          if (relay.latencies.length > 100) {
            relay.latencies.shift();
          }
        }
        if (event.kind === 10002 && subscriptionId === 'stats-relay-lists') {
          processRelayListEvent(event);
        }
        if (subscriptionId === 'stats-main' && event.kind !== 0 && event.kind !== 3) {
          relay.events++;
          relay.eventsList.push(event);
          if (relay.eventsList.length > MAX_EVENTS_PER_KIND) {
            relay.eventsList.shift();
          }
          if (!relay.eventsByKind[event.kind]) {
            relay.eventsByKind[event.kind] = 0;
          }
          relay.eventsByKind[event.kind]++;
          if (!eventKindCounts[event.kind]) {
            eventKindCounts[event.kind] = 0;
          }
          eventKindCounts[event.kind]++;
          if (event.pubkey) {
            relay.activeUsers.add(event.pubkey);
            activeUsersPubkeys.add(event.pubkey);
          }
          if (!allEvents.find(e => e.id === event.id)) {
            event.receivedAt = Date.now();
            event.relayUrl = relay.url;
            allEvents.push(event);
            // Extract client information when available and count
            const client = extractClientFromEvent(event);
            if (client) {
              clientCounts[client] = (clientCounts[client] || 0) + 1;
            }
            recordEventForFeeds(event);
            notifyEventsUpdated();
          }
        }
      } else if (data[0] === 'EOSE') {
        const subscriptionId = data[1];
        ws.send(JSON.stringify(["CLOSE", subscriptionId]));
      }
    } catch (e) {
      console.error(`Error processing message from ${relay.url}:`, e);
    }
  };
  ws.onclose = () => {
    relay.connected = false;
    console.log(`Disconnected from ${relay.url}`);
    updateConnectionStatus();
    activeRelayCount--;
    startRelayPool();
  };
  ws.onerror = (e) => {
    relay.connected = false;
    relay.disconnectedAt = Date.now();
    console.error(`Error with ${relay.url}:`, e);
    updateConnectionStatus();
    updateRelayReliability(relay);
    activeRelayCount--;
    startRelayPool();
  };
}

function setupWebSocket(relay, index) {
  if (relay.tried) return;
  
  relay.tried = true;
  const ws = new WebSocket(relay.url);
  relay.ws = ws;
  
  const reqSentAt = {};
  
  ws.onopen = () => {
    relay.connected = true;
    relay.answered = true;
    relay.connectedAt = Date.now();
    console.log(`Connected to ${relay.url}`);
    
    // Request recent events
    const now = Math.floor(Date.now() / 1000);
    const since = now - Math.floor(timeRangeMs / 1000);
    reqSentAt['main'] = Date.now();
    ws.send(JSON.stringify(["REQ", "stats-main", {
      "limit": LIMIT,
      "since": since,
      "until": now + 3600
    }]));
    
    // Request metadata
    reqSentAt['meta'] = Date.now();
    ws.send(JSON.stringify(["REQ", "stats-meta", {"kinds": [0], "limit": 100}]));
    
    updateConnectionStatus();
  };
  
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      
      if (data[0] === 'EVENT') {
        const subscriptionId = data[1];
        const event = data[2];
        if (event.kind === 0) {
          recordMetadataEvent(event);
          if (subscriptionId === 'stats-meta') {
            return;
          }
        }
        
        // Calculate latency
        if (reqSentAt[subscriptionId.replace('stats-', '')]) {
          const latency = Date.now() - reqSentAt[subscriptionId.replace('stats-', '')];
          relay.latencies.push(latency);
          if (relay.latencies.length > 100) {
            relay.latencies.shift();
          }
        }
        
        // Process relay list events (NIP-65 kind 10002)
        if (event.kind === 10002 && subscriptionId === 'stats-relay-lists') {
          processRelayListEvent(event);
        }
        
        // Only process non-metadata events for main stats
        if (subscriptionId === 'stats-main' && event.kind !== 0 && event.kind !== 3) {
          relay.events++;
          relay.eventsList.push(event);
          if (relay.eventsList.length > MAX_EVENTS_PER_KIND) {
            relay.eventsList.shift();
          }
          
          // Track event kind
          if (!relay.eventsByKind[event.kind]) {
            relay.eventsByKind[event.kind] = 0;
          }
          relay.eventsByKind[event.kind]++;
          
          // Track global event kinds
          if (!eventKindCounts[event.kind]) {
            eventKindCounts[event.kind] = 0;
          }
          eventKindCounts[event.kind]++;
          
          // Track active user
          if (event.pubkey) {
            relay.activeUsers.add(event.pubkey);
            activeUsersPubkeys.add(event.pubkey);
          }
          
          // Add to global events list
          if (!allEvents.find(e => e.id === event.id)) {
            event.receivedAt = Date.now();
            event.relayUrl = relay.url;
            allEvents.push(event);
            recordEventForFeeds(event);
            notifyEventsUpdated();
          }
        }
      } else if (data[0] === 'EOSE') {
        const subscriptionId = data[1];
        ws.send(JSON.stringify(["CLOSE", subscriptionId]));
      }
    } catch (e) {
      console.error(`Error processing message from ${relay.url}:`, e);
    }
  };
  
  ws.onclose = () => {
    relay.connected = false;
    console.log(`Disconnected from ${relay.url}`);
    updateConnectionStatus();
  };
  
  ws.onerror = (e) => {
    relay.connected = false;
    relay.disconnectedAt = Date.now();
    console.error(`Error with ${relay.url}:`, e);
    updateConnectionStatus();
    updateRelayReliability(relay);
  };
}

// Relay Discovery System
function startRelayDiscovery() {
  console.log('Starting relay discovery...');
  relayDiscoveryInProgress = true;
  
  // Wait a bit for initial connections, then start discovering
  setTimeout(() => {
    discoverRelaysFromUsers();
  }, 10000); // Wait 10 seconds for initial connections
  
  // Periodically check for new users and discover their relays
  setInterval(() => {
    discoverRelaysFromUsers();
  }, 60000); // Every minute
}

function discoverRelaysFromUsers() {
  if (activeUsersPubkeys.size === 0) {
    console.log('No active users yet, skipping relay discovery');
    return;
  }
  
  console.log(`Discovering relays from ${activeUsersPubkeys.size} active users...`);
  
  // Get connected relays
  const connectedRelays = relays.filter(r => r.connected && r.ws);
  if (connectedRelays.length === 0) {
    console.log('No connected relays to query');
    return;
  }
  
  // Request relay lists (NIP-65 kind 10002) from active users
  const pubkeyArray = Array.from(activeUsersPubkeys);
  const batchSize = 50; // Request in batches
  
  for (let i = 0; i < pubkeyArray.length; i += batchSize) {
    const batch = pubkeyArray.slice(i, i + batchSize);
    
    connectedRelays.forEach(relay => {
      if (relay.ws && relay.ws.readyState === WebSocket.OPEN) {
        relay.ws.send(JSON.stringify([
          "REQ",
          "stats-relay-lists",
          {
            "kinds": [10002],
            "authors": batch,
            "limit": batch.length
          }
        ]));
      }
    });
  }
}

function processRelayListEvent(event) {
  if (!event.tags || !Array.isArray(event.tags)) return;
  
  // Extract relay URLs from tags
  const relayUrls = event.tags
    .filter(tag => tag[0] === 'r' && tag[1])
    .flatMap(tag => splitRelayTagValue(tag[1]))
    .map(url => normalizeRelayUrl(url))
    .filter(url => {
      if (!url) return false;
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });
  
  relayUrls.forEach(url => addDiscoveredRelay(url));
}

function splitRelayTagValue(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return [];
  let working = rawValue.trim();
  if (!working) return [];

  try {
    working = decodeURIComponent(working);
  } catch (_) {
    // ignore decode failures, keep original string
  }

  working = working.replace(/[\s,;|]+/g, ' ').trim();
  if (!working) return [];

  return working.split(' ').filter(Boolean);
}

function addDiscoveredRelay(url) {
  // Normalize the URL before checking/adding
  url = normalizeRelayUrl(url);
  if (!url) return;
  
  // Check if we already have this relay
  if (discoveredRelays.has(url)) {
    // Don't mark curated relays as discovered - they should keep their status
    return;
  }
  
  // Add new discovered relay (ONLY if it's not already in our curated list)
  console.log(`Discovered new relay: ${url}`);
  const newRelay = createRelayObject(url);
  newRelay.isDiscovered = true;  // Mark as newly discovered
  
  discoveredRelays.set(url, newRelay);
  relays.push(newRelay);
  discoveredRelayCount++;
  
  // Try to connect to the new relay
  setTimeout(() => {
    setupWebSocket(newRelay, relays.length - 1);
  }, Math.random() * 5000); // Random delay 0-5 seconds
}

function updateRelayReliability(relay) {
  // Calculate reliability score based on:
  // - Connection success/failure
  // - Uptime
  // - Response time (latency)
  // - Number of events delivered
  
  let score = 0;
  
  // Connection history
  if (relay.answered) score += 40;
  if (relay.connected) score += 20;
  
  // Uptime (if we have connection time)
  if (relay.connectedAt && relay.connected) {
    const uptimeMinutes = (Date.now() - relay.connectedAt) / 60000;
    score += Math.min(20, uptimeMinutes / 5); // Up to 20 points for 100+ minutes uptime
  }
  
  // Latency (average of recent latencies)
  if (relay.latencies.length > 0) {
    const avgLatency = relay.latencies.reduce((a, b) => a + b, 0) / relay.latencies.length;
    if (avgLatency < 100) score += 10;
    else if (avgLatency < 500) score += 5;
  }
  
  // Events delivered
  if (relay.events > 50) score += 10;
  else if (relay.events > 10) score += 5;
  
  relay.reliability = Math.min(100, score);
}

function updateConnectionStatus() {
  const snapshot = buildConnectionSnapshot();
  connectionSnapshot = snapshot;

  const statusEl = document.getElementById('connection-status');
  if (!statusEl) {
    notifyEventsUpdated('connection');
    return;
  }

  const indicator = statusEl.querySelector('.events-progress-indicator');
  const textEl = statusEl.querySelector('.events-progress-text');
  if (!indicator || !textEl) {
    notifyEventsUpdated('connection');
    return;
  }

  if (!snapshot || !snapshot.total) {
    textEl.textContent = 'Connecting to relays…';
    indicator.classList.remove('is-ready');
    notifyEventsUpdated('connection');
    return;
  }

  const success = snapshot.successRate ? Math.round(snapshot.successRate) : 0;
  const curatedPart = snapshot.curated && snapshot.curated.total
    ? ` · ${snapshot.curated.connected}/${snapshot.curated.total} curated`
    : '';
  const discoveredPart = snapshot.discovered && snapshot.discovered.total
    ? ` · ${snapshot.discovered.connected}/${snapshot.discovered.total} discovered`
    : '';

  textEl.textContent = `${snapshot.connected}/${snapshot.total} relays online (${success}% success)${curatedPart}${discoveredPart}`;

  if (snapshot.connected > 0) {
    indicator.classList.add('is-ready');
  } else {
    indicator.classList.remove('is-ready');
  }

  notifyEventsUpdated('connection');
}

function buildConnectionSnapshot() {
  const total = relays.length;
  const connected = relays.filter(r => r.connected).length;
  const discoveredRelays = relays.filter(r => r.isDiscovered);
  const discoveredConnected = discoveredRelays.filter(r => r.connected).length;
  const curatedRelays = relays.filter(r => !r.isDiscovered);
  const curatedConnected = curatedRelays.filter(r => r.connected).length;

  return {
    total,
    connected,
    successRate: total ? (connected / total) * 100 : 0,
    curated: { total: curatedRelays.length, connected: curatedConnected },
    discovered: { total: discoveredRelays.length, connected: discoveredConnected },
    updatedAt: Date.now()
  };
}

function startPeriodicUpdates() {
  // Update statistics display
  setInterval(() => {
    updateStatistics();
  }, UPDATE_INTERVAL);
  
  // Update charts less frequently (they're more expensive)
  setInterval(() => {
    updateCharts();
  }, CHART_UPDATE_INTERVAL);
  
  // Recalculate client counts periodically to catch any changes in extraction logic
  setInterval(() => {
    recalculateClientCounts();
  }, 30000); // Every 30 seconds
  
  // Initial update
  setTimeout(() => {
    updateStatistics();
    updateCharts();
    // Also recalculate client counts after initial events are loaded
    setTimeout(() => {
      recalculateClientCounts();
    }, 5000); // Wait 5 seconds for events to load first
  }, 2000);
}

function updateStatistics() {
  updateNetworkOverview();
  updateNetworkAnalytics();
  // Note: updateTopRelays moved to updateCharts() to avoid rate limiting
  updateKindsTable();
}

function updateNetworkOverview() {
  // Use backend data if available for accuracy
  if (backendStatsCache) {
    const backendData = backendStatsCache;
    setElementText('stat-total-relays', backendData.total_relays || 0);
    setElementText('stat-connected-relays', backendData.active_relays || 0);
    setElementText('stat-active-relays', backendData.active_relays || 0);
    setElementText('stat-total-events', (backendData.total_events || 0).toLocaleString());
    setElementText('stat-avg-response', (backendData.avg_latency_ms || 0).toFixed(0) + 'ms');
    return; // Use backend data exclusively
  }
  
  // Fallback: Use local relay connections data
  const now = Date.now();
  const cutoffTime = now - timeRangeMs;
  
  // Total relays being monitored
  const totalRelays = relays.length;
  const connectedRelays = relays.filter(r => r.connected).length;
  
  // Active relays (connected and actually sending events)
  const activeRelays = relays.filter(r => r.connected && r.events > 0).length;
  
  // Total events in time range
  const recentEvents = allEvents.filter(e => e.created_at * 1000 >= cutoffTime);
  const totalEvents = recentEvents.length;
  
  // Average response time across all relays with latency data
  const relaysWithLatency = relays.filter(r => r.latencies.length > 0);
  let avgResponse = 'N/A';
  if (relaysWithLatency.length > 0) {
    const allLatencies = relaysWithLatency.flatMap(r => r.latencies);
    avgResponse = (allLatencies.reduce((sum, l) => sum + l, 0) / allLatencies.length).toFixed(0) + 'ms';
  }
  
  // Update DOM
  setElementText('stat-total-relays', totalRelays);
  setElementText('stat-connected-relays', connectedRelays);
  setElementText('stat-active-relays', activeRelays);
  setElementText('stat-total-events', totalEvents.toLocaleString());
  setElementText('stat-avg-response', avgResponse);
}

function updateNetworkAnalytics() {
  const totalRelays = relays.length;
  
  // Relay discovery stats
  const discoveredCount = relays.filter(r => r.isDiscovered).length;
  const curatedCount = relays.filter(r => !r.isDiscovered).length;
  const allActive = relays.filter(r => r.connected && r.events > 0).length;
  
  setElementText('relays-discovered', `${discoveredCount} (${relays.filter(r => r.isDiscovered && r.connected).length} connected)`);
  setElementText('relays-curated', `${curatedCount} (${relays.filter(r => !r.isDiscovered && r.connected).length} connected)`);
  setElementText('relays-all-active', allActive);
  
  // Relay performance categories
  const highPerf = relays.filter(r => r.events >= LIMIT && r.connected).length;
  const highVol = relays.filter(r => r.events >= LIMIT).length;
  const active = relays.filter(r => r.connected && r.events > 0).length; // Same as allActive
  const connected = relays.filter(r => r.connected).length;
  
  setElementText('relays-high-perf', highPerf);
  setElementText('relays-high-vol', highVol);
  setElementText('relays-active', active);
  setElementText('relays-connected', connected);
  
  // Update bars
  setBarWidth('relays-high-perf-bar', (highPerf / totalRelays) * 100);
  setBarWidth('relays-high-vol-bar', (highVol / totalRelays) * 100);
  setBarWidth('relays-active-bar', (active / totalRelays) * 100);
  setBarWidth('relays-connected-bar', (connected / totalRelays) * 100);
  
  // Average latency with relay names
  const relaysWithLatency = relays.filter(r => r.latencies.length > 0);
  if (relaysWithLatency.length > 0) {
    // Calculate average latency for each relay
    const relayAvgLatencies = relaysWithLatency.map(r => ({
      url: r.url,
      avgLatency: r.latencies.reduce((sum, l) => sum + l, 0) / r.latencies.length
    }));
    
    // Find fastest and slowest
    const fastest = relayAvgLatencies.reduce((min, r) => r.avgLatency < min.avgLatency ? r : min);
    const slowest = relayAvgLatencies.reduce((max, r) => r.avgLatency > max.avgLatency ? r : max);
    
    // Overall average
    const allLatencies = relaysWithLatency.flatMap(r => r.latencies);
    const avgLatency = (allLatencies.reduce((sum, l) => sum + l, 0) / allLatencies.length).toFixed(0);
    
    setElementText('avg-latency', avgLatency);
    setElementText('fastest-latency', `${fastest.avgLatency.toFixed(0)}ms`);
    setElementText('fastest-relay', fastest.url);
    setElementText('slowest-latency', `${slowest.avgLatency.toFixed(0)}ms`);
    setElementText('slowest-relay', slowest.url);
  }
}

function updateTopRelays() {
  const tbody = document.getElementById('top-relays-tbody');
  if (!tbody) return;

  // Fetch top relays from backend API with caching
  getCachedApiData(`${API_BASE_URL}/stats/top-relays?range=24h`, 'topRelays')
    .then(data => {
      if (!data || !data.top_relays) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem"><span class="loading">No relay activity yet</span></td></tr>';
        return;
      }

      const topRelays = data.top_relays.slice(0, 20); // Top 20 from backend

      if (topRelays.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem"><span class="loading">No relay activity yet</span></td></tr>';
        return;
      }

      tbody.innerHTML = topRelays.map((relay, index) => {
        // Status: show health_score from backend
        const status = typeof relay.health_score === 'number'
          ? `<span class="status-badge online">${relay.health_score}</span>`
          : `<span class="status-badge offline">N/A</span>`;

        // Events: show events from backend
        const events = typeof relay.events === 'number'
          ? relay.events.toLocaleString()
          : 'N/A';

        // Active users from backend
        const activeUsers = typeof relay.active_users === 'number'
          ? relay.active_users.toLocaleString()
          : 'N/A';

        // Latency from backend
        const avgLatency = relay.avg_latency_ms !== undefined && relay.avg_latency_ms !== null
          ? `${relay.avg_latency_ms.toFixed(0)}ms`
          : '-';

        // Top kinds from backend
        let topKindsStr = 'N/A';
        if (Array.isArray(relay.top_kinds) && relay.top_kinds.length > 0) {
          topKindsStr = relay.top_kinds.join(', ');
        }

        return `
          <tr>
            <td class="text-center">#${index + 1}</td>
            <td><code>${relay.url}</code></td>
            <td class="text-center">${status}</td>
            <td class="text-right">${events}</td>
            <td class="text-right">${activeUsers}</td>
            <td class="text-right">${avgLatency}</td>
            <td>${topKindsStr}</td>
          </tr>
        `;
      }).join('');
    })
    .catch(err => {
      console.error('[Top Relays] Error:', err);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem"><span class="loading">Error loading relay data</span></td></tr>';
    });
}

function calculateEventsPerMinute(relay) {
  if (!relay || !Array.isArray(relay.eventsList) || relay.eventsList.length === 0) {
    return 0;
  }
  const timestamps = relay.eventsList
    .map(e => Number(e.created_at) || 0)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (timestamps.length < 2) {
    return timestamps.length; // assume per minute roughly count value
  }
  const minTime = timestamps[0];
  const maxTime = timestamps[timestamps.length - 1];
  const spanSeconds = Math.max(60, maxTime - minTime);
  return relay.eventsList.length / (spanSeconds / 60);
}

function getTopKindForRelay(relay) {
  if (!relay || !relay.eventsByKind) return null;
  let topKindId = null;
  let topCount = 0;
  Object.entries(relay.eventsByKind).forEach(([kind, count]) => {
    if (count > topCount) {
      topCount = count;
      topKindId = Number(kind);
    }
  });
  if (topKindId === null) return null;
  const info = getKindInfo(topKindId);
  return { id: topKindId, count: topCount, label: info.label };
}

function updateKindsTable() {
  const tbody = document.getElementById('kinds-table-body');
  if (!tbody) return;
  
  const sortedKinds = Object.entries(eventKindCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20); // Top 20 kinds
  
  if (sortedKinds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem">No events received yet</td></tr>';
    return;
  }
  
  const totalEvents = sortedKinds.reduce((sum, [_, count]) => sum + count, 0);
  
  tbody.innerHTML = sortedKinds.map(([kind, count]) => {
    const kindId = parseInt(kind);
    const percentage = ((count / totalEvents) * 100).toFixed(1);
    const { label, nip } = getKindInfo(kindId);
    const labelHtml = nip
      ? `<a href="${nip}" target="_blank" rel="noopener">${label}</a>`
      : label;
    
    return `
      <tr>
        <td><strong>${labelHtml}</strong> <small>(${kindId})</small></td>
        <td>${count.toLocaleString()}</td>
        <td>${percentage}%</td>
        <td>
          <div class="distribution-bar">
            <div class="distribution-fill" style="width: ${percentage}%"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function setupCharts() {
  // Check if Chart.js is available
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded, loading from CDN...');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload = () => {
      console.log('Chart.js loaded');
      initializeCharts();
    };
    document.head.appendChild(script);
  } else {
    initializeCharts();
  }
}

function initializeCharts() {
  // Event kinds pie chart
  const kindsCanvas = document.getElementById('event-kinds-chart');
  if (kindsCanvas) {
    eventKindsChart = new Chart(kindsCanvas, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [{
          data: [],
          backgroundColor: [
            'rgba(255, 99, 132, 0.8)',
            'rgba(54, 162, 235, 0.8)',
            'rgba(255, 206, 86, 0.8)',
            'rgba(75, 192, 192, 0.8)',
            'rgba(153, 102, 255, 0.8)',
            'rgba(255, 159, 64, 0.8)',
            'rgba(199, 199, 199, 0.8)',
            'rgba(83, 102, 255, 0.8)',
            'rgba(255, 99, 255, 0.8)',
            'rgba(99, 255, 132, 0.8)'
          ],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: {
              boxWidth: 15,
              padding: 10
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Clients bar chart (shows client software usage extracted from events)
  const kindsBarCanvas = document.getElementById('event-kinds-bar-chart');
  if (kindsBarCanvas) {
    eventKindsBarChart = new Chart(kindsBarCanvas, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Client Count',
          data: [],
          backgroundColor: [
            'rgba(255, 99, 132, 0.8)',
            'rgba(54, 162, 235, 0.8)',
            'rgba(255, 206, 86, 0.8)',
            'rgba(75, 192, 192, 0.8)',
            'rgba(153, 102, 255, 0.8)',
            'rgba(255, 159, 64, 0.8)',
            'rgba(199, 199, 199, 0.8)',
            'rgba(83, 102, 255, 0.8)',
            'rgba(255, 99, 255, 0.8)',
            'rgba(99, 255, 132, 0.8)'
          ],
          borderWidth: 2
        }]
      },
      options: {
        indexAxis: 'y', // horizontal bar chart
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.parsed.x || context.parsed.y || 0;
                return `${label}: ${value}`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Count'
            },
            beginAtZero: true
          },
          y: {
            title: {
              display: true,
              text: 'Client'
            }
          }
        }
      }
    });
  }
}

function updateCharts() {
  updateKindsChart();
  updateKindsBarChart();
  updateTopRelays();
}

// Attempt to extract client info from an event
function extractClientFromEvent(event) {
  if (!event) return null;

  // 1) Look for explicit client tag: ['client', 'NAME'] - This is the primary method
  if (Array.isArray(event.tags)) {
    for (const t of event.tags) {
      if (Array.isArray(t) && t.length >= 2) {
        const key = String(t[0]).toLowerCase();
        if (key === 'client' && t[1]) {
          return String(t[1]).trim();
        }
      }
    }
  }

  // 2) If no client tag found, return 'Unknown' to maintain consistency with ClientStats
  // (Previously we had complex fallback logic, but the simple approach works better)
  return 'Unknown';
}

function updateKindsChart() {
  if (!eventKindsChart) return;
  
  // Fetch event distribution from backend API with caching
  getCachedApiData(`${API_BASE_URL}/stats/events/24h`, 'eventDistribution')
    .then(data => {
      if (!data || !data.distribution || !data.distribution.by_kind) {
        console.warn('[Event Kinds Chart] No event kind distribution data from backend');
        return;
      }

      const kindData = data.distribution.by_kind;
      const sortedKinds = Object.entries(kindData)
        .map(([kind, count]) => [parseInt(kind, 10), count])
        .filter(([kind, count]) => !isNaN(kind) && typeof count === 'number')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (sortedKinds.length === 0) {
        console.log('[Event Kinds Chart] No event kinds data available');
        return;
      }

      const labels = [];
      const chartData = [];
      sortedKinds.forEach(([kind, count]) => {
        const kindInfo = getKindInfo(kind);
        const label = (kindInfo && kindInfo.label) ? kindInfo.label : `Kind ${kind}`;
        labels.push(`${label} (${kind})`);
        chartData.push(count);
      });

      console.log('[Event Kinds Chart] Updating with:', { labels, chartData });
      eventKindsChart.data.labels = labels;
      eventKindsChart.data.datasets[0].data = chartData;
      eventKindsChart.update('none');
      console.log('[Event Kinds Chart] ✓ Updated with backend data');
    })
    .catch(err => {
      console.error('[Event Kinds Chart] Error:', err);
    });
}

function updateKindsBarChart() {
  if (!eventKindsBarChart) return;

  // Fetch client stats from backend API with caching
  getCachedApiData(`${API_BASE_URL}/stats/clients?range=24h`, 'topClients')
    .then(data => {
      if (!data || !data.clients) {
        console.warn('[Client Stats Chart] No client data from backend');
        return;
      }

      // Backend returns: { clients: [{name, count, event_count, last_seen, kinds}, ...], updated_at }
      // Sort by event_count and take top 20
      const sortedClients = data.clients
        .filter(c => c.name && c.name !== 'Unknown') // Exclude Unknown
        .sort((a, b) => (b.event_count || b.count || 0) - (a.event_count || a.count || 0))
        .slice(0, 20);

      if (sortedClients.length === 0) {
        console.log('[Client Stats Chart] No client data available');
        return;
      }

      const labels = sortedClients.map(c => c.name);
      const chartData = sortedClients.map(c => c.event_count || c.count || 0);

      console.log('[Client Stats Chart] Updating with:', { count: labels.length, labels });
      
      eventKindsBarChart.data.labels = labels;
      eventKindsBarChart.data.datasets[0].data = chartData;
      eventKindsBarChart.update('none');
      console.log('[Client Stats Chart] ✓ Updated with backend data:', sortedClients.length, 'clients');
    })
    .catch(err => {
      console.error('[Client Stats Chart] Error:', err);
    });
}

function updateTimeRange() {
  const select = document.getElementById('time-range');
  if (!select) return;
  
  const value = select.value;
  switch (value) {
    case '24h':
      timeRangeMs = 24 * 60 * 60 * 1000;
      break;
    case '7d':
      timeRangeMs = 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      timeRangeMs = 30 * 24 * 60 * 60 * 1000;
      break;
    case '90d':
      timeRangeMs = 90 * 24 * 60 * 60 * 1000;
      break;
  }
  
  // Reconnect with new time range
  refreshStatistics();
}

function refreshStatistics() {
  // Refresh statistics from backend API
  console.log('[Refresh] Refreshing statistics from backend');
  
  if (backendStatsCache) {
    // If backend available, debounce manual refreshes to avoid spamming backend
    if (!window._lastManualRefresh || Date.now() - window._lastManualRefresh > API_POLL_INTERVAL) {
      window._lastManualRefresh = Date.now();
      fetchBackendStats().then(data => {
        if (data) {
          console.log('[Refresh] ✅ Backend data refreshed');
          updateStatistics();
          updateCharts();
        } else {
          console.warn('[Refresh] ⚠️ Backend fetch failed');
        }
      });
    } else {
      console.warn('[Refresh] Manual refresh ignored to avoid backend rate limit');
    }
  } else {
    // If backend not available, fall back to relay refresh
    console.log('[Refresh] Backend not available, falling back to relay connections');
    
    // Clear existing data
    allEvents = [];
    eventTimeline = [];
    eventKindCounts = {};
    clientCounts = {};
    activeUsersPubkeys = new Set();
    statsStartTime = Date.now();
    
    // Disconnect and reconnect
    relays.forEach(relay => {
      if (relay.ws) {
        relay.ws.close();
      }
      relay.connected = false;
      relay.tried = false;
      relay.events = 0;
      relay.eventsByKind = {};
      relay.eventsList = [];
      relay.activeUsers = new Set();
      relay.latencies = [];
    });
    
    // Reconnect
    setTimeout(() => {
      connectToRelays();
    }, 500);
    
    // Update immediately
    updateStatistics();
    updateCharts();
  }
}

// Utility functions
function setElementText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

function setBarWidth(id, percentage) {
  const el = document.getElementById(id);
  if (el) {
    el.style.width = `${Math.min(100, percentage)}%`;
  }
}

function formatTimeBucket(timestamp, bucketSize) {
  const date = new Date(timestamp);
  const hours = timeRangeMs / (1000 * 60 * 60);
  
  if (hours <= 24) {
    // Show hours for 24h view
    return date.getHours().toString().padStart(2, '0') + ':00';
  } else if (hours <= 168) {
    // Show day/hour for 7d view
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()] + ' ' + date.getHours().toString().padStart(2, '0') + 'h';
  } else {
    // Show date for 30d/90d view
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
}

function getKindInfo(kind) {
  return EVENT_KIND_INFO[kind] || { label: `Kind ${kind}`, nip: null };
}

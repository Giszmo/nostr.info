---
permalink: /js/analytics.js
layout: none
---

/**
 * Nostr Analytics Manager
 * Comprehensive analytics tracking for Nostr network data
 */

class NostrAnalytics {
  constructor() {
    this.eventData = new Map(); // timestamp -> { events, zaps, kinds, clients }
    this.clientStats = new Map(); // client -> { count, lastSeen, kinds }
    this.userStats = new Map(); // pubkey -> { eventCount, followers, score }
    this.activeUsers = new Map(); // date -> Set(pubkeys)
    this.relayStats = new Map(); // relay -> connection stats
    
    this.timeFilter = {
      range: null, // 7, 30, 90 days or null for all
      startDate: null,
      endDate: null
    };
    
    this.listeners = new Set();
    this.isTracking = false;
  }

  // Event tracking methods
  trackEvent(event) {
    if (!event || !event.created_at || !event.id) return;
    
    // Check for duplicates using event ID
    if (this.processedEventIds && this.processedEventIds.has(event.id)) {
      return; // Already processed this event
    }
    
    // Initialize processed events set if not exists
    if (!this.processedEventIds) {
      this.processedEventIds = new Set();
    }
    
    // Mark event as processed
    this.processedEventIds.add(event.id);
    
    const timestamp = Math.floor(event.created_at / 86400) * 86400; // Daily buckets
    const dateKey = new Date(timestamp * 1000).toISOString().split('T')[0];
    
    // Initialize daily data
    if (!this.eventData.has(dateKey)) {
      this.eventData.set(dateKey, {
        events: 0,
        zaps: 0,
        kinds: new Map(),
        clients: new Map(),
        trusted: 0,
        untrusted: 0
      });
    }
    
    const dayData = this.eventData.get(dateKey);
    dayData.events++;
    
    // Track event kinds
    const kind = event.kind || 'unknown';
    dayData.kinds.set(kind, (dayData.kinds.get(kind) || 0) + 1);
    
    // Track client from tags
    const clientTag = this.extractClient(event);
    if (clientTag) {
      dayData.clients.set(clientTag, (dayData.clients.get(clientTag) || 0) + 1);
      this.updateClientStats(clientTag, event);
    }
    
    // Track zaps (kind 9735)
    if (event.kind === 9735) {
      const zapAmount = this.extractZapAmount(event);
      dayData.zaps += zapAmount;
    }
    
    // Track active users
    if (event.pubkey) {
      if (!this.activeUsers.has(dateKey)) {
        this.activeUsers.set(dateKey, new Set());
      }
      this.activeUsers.get(dateKey).add(event.pubkey);
      this.updateUserStats(event.pubkey, event);
    }
    
    // Trust scoring (simplified)
    if (this.isTrustedEvent(event)) {
      dayData.trusted++;
    } else {
      dayData.untrusted++;
    }
    
    this.notifyListeners('event', { event, dayData });
  }
  
  extractClient(event) {
    if (!event) return 'Unknown';

    // 1) Look for explicit client tag: ['client', 'NAME']
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

    // 2) Try to parse JSON content for common client fields
    if (event.content && typeof event.content === 'string') {
      try {
        const parsed = JSON.parse(event.content);
        const candidates = ['client', 'client_name', 'user_agent', 'app', 'software'];
        for (const c of candidates) {
          if (parsed && parsed[c]) {
            return String(parsed[c]).trim();
          }
        }
      } catch (e) {
        // content is not JSON; try simple heuristics
        const content = event.content.toLowerCase();
        // look for common client tokens
        const tokens = ['iris', 'damus', 'noot', 'nos', 'nostr', 'nsec', 'pleb', 'nostr-react', 'nostr.java', 'nnostr', 'nostrkit', 'nostr-js'];
        for (const tkn of tokens) {
          if (content.includes(tkn)) {
            return tkn;
          }
        }
      }
    }

    // 3) Fallback: try user_agent tag
    const userAgent = event.tags?.find(tag => tag[0] === 'user_agent');
    if (userAgent && userAgent[1]) {
      return userAgent[1].split('/')[0];
    }

    return 'Unknown';
  }
  
  extractZapAmount(event) {
    try {
      // Look for bolt11 in tags to extract amount
      const bolt11Tag = event.tags?.find(tag => tag[0] === 'bolt11');
      if (bolt11Tag && bolt11Tag[1]) {
        // Simplified amount extraction - in practice you'd use a proper bolt11 decoder
        const match = bolt11Tag[1].match(/(\d+)m/);
        if (match) {
          return parseInt(match[1]);
        }
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }
  
  updateClientStats(client, event) {
    if (!this.clientStats.has(client)) {
      this.clientStats.set(client, {
        count: 0,
        lastSeen: 0,
        kinds: new Map(),
        firstSeen: event.created_at
      });
    }
    
    const stats = this.clientStats.get(client);
    stats.count++;
    stats.lastSeen = Math.max(stats.lastSeen, event.created_at);
    
    const kind = event.kind || 'unknown';
    stats.kinds.set(kind, (stats.kinds.get(kind) || 0) + 1);
  }
  
  updateUserStats(pubkey, event) {
    if (!this.userStats.has(pubkey)) {
      this.userStats.set(pubkey, {
        eventCount: 0,
        followers: new Set(),
        following: new Set(),
        score: 0,
        lastActivity: 0,
        metadata: null  // Store kind 0 metadata
      });
    }
    
    const stats = this.userStats.get(pubkey);
    stats.eventCount++;
    stats.lastActivity = Math.max(stats.lastActivity, event.created_at);
    
    // Track metadata (kind 0)
    if (event.kind === 0 && event.content) {
      try {
        const metadata = JSON.parse(event.content);
        stats.metadata = {
          name: metadata.name || '',
          picture: metadata.picture || '',
          about: metadata.about || '',
          nip05: metadata.nip05 || ''
        };
      } catch (e) {
        // Invalid JSON in metadata
      }
    }
    
    // Track follows (kind 3)
    if (event.kind === 3 && event.tags) {
      stats.following.clear();
      event.tags
        .filter(tag => tag[0] === 'p')
        .forEach(tag => {
          if (tag[1]) {
            stats.following.add(tag[1]);
            // Add reverse relationship
            if (!this.userStats.has(tag[1])) {
              this.userStats.set(tag[1], {
                eventCount: 0,
                followers: new Set(),
                following: new Set(),
                score: 0,
                lastActivity: 0,
                metadata: null
              });
            }
            this.userStats.get(tag[1]).followers.add(pubkey);
          }
        });
    }
  }
  
  // Set metadata for a user directly (used when loading from legacy system)
  setUserMetadata(pubkey, metadata) {
    if (!this.userStats.has(pubkey)) {
      this.userStats.set(pubkey, {
        eventCount: 0,
        followers: new Set(),
        following: new Set(),
        score: 0,
        lastActivity: 0,
        metadata: null
      });
    }
    
    const stats = this.userStats.get(pubkey);
    if (!stats.metadata || !stats.metadata.name) {
      // Only set if we don't already have metadata
      stats.metadata = metadata;
      this.notifyListeners('metadata', { pubkey, metadata });
    }
  }
  
  isTrustedEvent(event) {
    // Simplified trust scoring - in practice this would be more sophisticated
    const userStats = this.userStats.get(event.pubkey);
    if (!userStats) return false;
    
    // Trust based on follower count and activity
    return userStats.followers.size > 5 && userStats.eventCount > 10;
  }
  
  // Data retrieval methods with filtering
  getActivityData(timeRange = null) {
    const filtered = this.filterByTimeRange(this.eventData, timeRange);
    const result = [];
    
    for (const [date, data] of filtered) {
      result.push({
        date,
        timestamp: new Date(date).getTime() / 1000,
        events: data.events,
        zaps: data.zaps,
        trusted: data.trusted,
        untrusted: data.untrusted,
        kinds: Object.fromEntries(data.kinds),
        clients: Object.fromEntries(data.clients)
      });
    }
    
    const sorted = result.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`getActivityData(timeRange=${timeRange}) returned ${sorted.length} days`, sorted.slice(0, 3));
    return sorted;
  }
  
  getClientStats(limit = 20) {
    const clients = Array.from(this.clientStats.entries())
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        lastSeen: stats.lastSeen,
        kinds: Object.fromEntries(stats.kinds),
        firstSeen: stats.firstSeen
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    
    return clients;
  }
  
  getActiveUsersData(timeRange = null) {
    const filtered = this.filterByTimeRange(this.activeUsers, timeRange);
    const result = [];
    
    for (const [date, users] of filtered) {
      result.push({
        date,
        timestamp: new Date(date).getTime() / 1000,
        dailyActive: users.size,
        // Calculate weekly active (7-day rolling window)
        weeklyActive: this.getWeeklyActiveUsers(date)
      });
    }
    
    return result.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  getWeeklyActiveUsers(targetDate) {
    const target = new Date(targetDate);
    const weekStart = new Date(target);
    weekStart.setDate(target.getDate() - 6);
    
    const weeklyUsers = new Set();
    
    for (let d = new Date(weekStart); d <= target; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      const dayUsers = this.activeUsers.get(dateKey);
      if (dayUsers) {
        dayUsers.forEach(user => weeklyUsers.add(user));
      }
    }
    
    return weeklyUsers.size;
  }
  
  getPageRankData(limit = 100) {
    // Calculate PageRank based on follow relationships and include metadata
    const users = Array.from(this.userStats.entries())
      .map(([pubkey, stats]) => ({
        pubkey,
        followerCount: stats.followers.size,
        followingCount: stats.following.size,
        eventCount: stats.eventCount,
        score: this.calculateUserScore(stats),
        metadata: stats.metadata  // Include metadata from kind 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return users;
  }
  
  calculateUserScore(userStats) {
    // Simplified PageRank-like scoring
    const followers = userStats.followers.size;
    const activity = Math.log10(userStats.eventCount + 1);
    const recency = userStats.lastActivity > (Date.now() / 1000 - 86400 * 30) ? 1.2 : 1.0;
    
    return followers * activity * recency;
  }
  
  filterByTimeRange(dataMap, timeRange) {
    // If no filter, return all data
    if (!timeRange && timeRange !== 0) return dataMap;
    
    const now = new Date();
    let startDate;
    
    if (typeof timeRange === 'number' && timeRange > 0) {
      // Days ago
      startDate = new Date(now.getTime() - timeRange * 24 * 60 * 60 * 1000);
    } else if (timeRange && timeRange.start && timeRange.end) {
      // Custom range
      startDate = new Date(timeRange.start * 1000);
    } else {
      // Return all data if no valid range
      return dataMap;
    }
    
    const filtered = new Map();
    for (const [key, value] of dataMap) {
      const date = new Date(key);
      if (date >= startDate) {
        filtered.set(key, value);
      }
    }
    
    console.log(`filterByTimeRange(${timeRange}) startDate=${startDate?.toISOString()}, filtered from ${dataMap.size} to ${filtered.size} entries`);
    return filtered;
  }
  
  // Time filter management
  setTimeRange(range) {
    this.timeFilter.range = range;
    this.timeFilter.startDate = null;
    this.timeFilter.endDate = null;
    this.notifyListeners('timeFilter', this.timeFilter);
  }
  
  setCustomTimeRange(startDate, endDate) {
    this.timeFilter.range = 'custom';
    this.timeFilter.startDate = startDate;
    this.timeFilter.endDate = endDate;
    this.notifyListeners('timeFilter', this.timeFilter);
  }
  
  getCurrentTimeRange() {
    if (this.timeFilter.range === 'custom') {
      return {
        start: this.timeFilter.startDate,
        end: this.timeFilter.endDate
      };
    }
    return this.timeFilter.range;
  }
  
  // Event listeners
  addListener(callback) {
    this.listeners.add(callback);
  }
  
  removeListener(callback) {
    this.listeners.delete(callback);
  }
  
  notifyListeners(type, data) {
    this.listeners.forEach(callback => {
      try {
        callback(type, data);
      } catch (e) {
        console.error('Analytics listener error:', e);
      }
    });
  }
  
  // Data persistence
  saveToStorage() {
    try {
      const data = {
        eventData: Array.from(this.eventData.entries()).map(([k, v]) => [
          k, {
            ...v,
            kinds: Array.from(v.kinds.entries()),
            clients: Array.from(v.clients.entries())
          }
        ]),
        clientStats: Array.from(this.clientStats.entries()).map(([k, v]) => [
          k, {
            ...v,
            kinds: Array.from(v.kinds.entries())
          }
        ]),
        userStats: Array.from(this.userStats.entries()).map(([k, v]) => [
          k, {
            ...v,
            followers: Array.from(v.followers),
            following: Array.from(v.following)
          }
        ]),
        activeUsers: Array.from(this.activeUsers.entries()).map(([k, v]) => [
          k, Array.from(v)
        ]),
        processedEventIds: this.processedEventIds ? Array.from(this.processedEventIds) : []
      };
      
      localStorage.setItem('nostrAnalytics', JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save analytics data:', e);
    }
  }
  
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('nostrAnalytics');
      if (!stored) return;
      
      const data = JSON.parse(stored);
      
      // Restore eventData
      this.eventData = new Map(data.eventData.map(([k, v]) => [
        k, {
          ...v,
          kinds: new Map(v.kinds),
          clients: new Map(v.clients)
        }
      ]));
      
      // Restore clientStats
      this.clientStats = new Map(data.clientStats.map(([k, v]) => [
        k, {
          ...v,
          kinds: new Map(v.kinds)
        }
      ]));
      
      // Restore userStats
      this.userStats = new Map(data.userStats.map(([k, v]) => [
        k, {
          ...v,
          followers: new Set(v.followers),
          following: new Set(v.following)
        }
      ]));
      
      // Restore activeUsers
      this.activeUsers = new Map(data.activeUsers.map(([k, v]) => [
        k, new Set(v)
      ]));
      
      // Restore processed event IDs
      this.processedEventIds = new Set(data.processedEventIds || []);
      
      console.log('Analytics data loaded from storage');
    } catch (e) {
      console.error('Failed to load analytics data:', e);
    }
  }
  
  // Summary statistics
  getSummaryStats() {
    const totalEvents = Array.from(this.eventData.values())
      .reduce((sum, day) => sum + day.events, 0);
      
    const totalZaps = Array.from(this.eventData.values())
      .reduce((sum, day) => sum + day.zaps, 0);
      
    const totalClients = this.clientStats.size;
    const totalUsers = this.userStats.size;
    const daysTracked = this.eventData.size;
    
    const topClient = Array.from(this.clientStats.entries())
      .sort((a, b) => b[1].count - a[1].count)[0];
    
    return {
      totalEvents,
      totalZaps,
      totalClients,
      totalUsers,
      daysTracked,
      topClient: topClient ? topClient[0] : 'N/A',
      avgEventsPerDay: daysTracked > 0 ? Math.round(totalEvents / daysTracked) : 0
    };
  }
  
  // Clear data
  reset() {
    this.eventData.clear();
    this.clientStats.clear();
    this.userStats.clear();
    this.activeUsers.clear();
    this.relayStats.clear();
    if (this.processedEventIds) {
      this.processedEventIds.clear();
    }
    localStorage.removeItem('nostrAnalytics');
    this.notifyListeners('reset', null);
  }
}

// Global analytics instance
window.NostrAnalytics = NostrAnalytics;
window.analytics = new NostrAnalytics();

// Auto-save every 5 minutes
setInterval(() => {
  window.analytics.saveToStorage();
}, 5 * 60 * 1000);

// Load on initialization
window.analytics.loadFromStorage();
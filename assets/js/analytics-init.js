---
permalink: /js/analytics-init.js
layout: none
---

/**
 * Analytics Dashboard Initialization
 * Integrates the new analytics system with existing nostr.info infrastructure
 * 
 * NOTE: With backend API mode, analytics focuses on dashboard data visualization
 * rather than real-time relay event collection (which backend handles)
 */

// Initialize analytics dashboard when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Wait a bit for statistics.js to initialize
  setTimeout(() => {
    initializeAnalyticsDashboard();
  }, 1000);
});

// Also listen for backend stats updates
document.addEventListener('backend-stats-updated', function(event) {
  if (window.analytics && event.detail) {
    console.log('[Analytics] Backend stats updated:', event.detail);
    // Notify analytics listeners about backend update
    if (window.analytics.notifyListeners) {
      window.analytics.notifyListeners('backend-update', event.detail);
    }
  }
});

function initializeAnalyticsDashboard() {
  // Ensure required libraries are loaded
  if (typeof window.analytics === 'undefined' || 
      typeof window.TimeRangeFilter === 'undefined' ||
      typeof window.mountAnalyticsDashboard === 'undefined') {
    console.error('[Analytics] Analytics components not loaded');
    return;
  }

  try {
    console.log('[Analytics] Initializing analytics dashboard');
    
    // Initialize time filter - DISABLED: Not yet implemented for real-time sorting
    // const timeFilter = new TimeRangeFilter('analytics-time-filter', window.analytics);
    
    // Mount React dashboard
    const dashboardRoot = window.mountAnalyticsDashboard('analytics-dashboard-root', window.analytics);
    
    // Backend API mode: Don't connect to relays for statistics
    // Analytics will focus on dashboard visualization of backend-provided data
    console.log('[Analytics] Backend API mode - skipping relay connections for statistics');
    
    // If backend data is available, load it into analytics
    if (window.backendStatsCache) {
      console.log('[Analytics] Loading backend statistics into analytics system');
      loadBackendStatsIntoAnalytics(window.backendStatsCache);
    }
    
    // Listen for future backend updates
    window.addEventListener('backend-stats-updated', (event) => {
      console.log('[Analytics] Backend update received');
      loadBackendStatsIntoAnalytics(event.detail);
    });
    
    console.log('[Analytics] Dashboard initialized successfully (backend mode)');
    
  } catch (error) {
    console.error('[Analytics] Failed to initialize dashboard:', error);
  }
}

// Load backend statistics into the analytics system
function loadBackendStatsIntoAnalytics(backendData) {
  if (!backendData || !window.analytics) return;
  
  try {
    console.log('[Analytics] Loading backend data: relays=' + backendData.total_relays + 
                ', events=' + backendData.total_events + ', authors=' + backendData.unique_authors);
    
    // Create synthetic event for analytics to track
    // This allows analytics system to work even though we're not collecting individual events
    const syntheticEvent = {
      id: 'backend-snapshot-' + Date.now(),
      created_at: Math.floor(Date.now() / 1000),
      kind: 999, // Custom kind for backend snapshots
      pubkey: 'backend-collector',
      content: JSON.stringify({
        total_relays: backendData.total_relays,
        active_relays: backendData.active_relays,
        total_events: backendData.total_events,
        unique_authors: backendData.unique_authors,
        avg_latency_ms: backendData.avg_latency_ms
      }),
      tags: [['backend', 'snapshot']],
      sig: ''
    };
    
    // Notify analytics about the backend data
    if (window.analytics.notifyListeners) {
      window.analytics.notifyListeners('backend-snapshot', {
        totalRelays: backendData.total_relays,
        activeRelays: backendData.active_relays,
        totalEvents: backendData.total_events,
        uniqueAuthors: backendData.unique_authors,
        avgLatency: backendData.avg_latency_ms,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('[Analytics] Error loading backend data:', error);
  }
}

// Sync analytics with backend stats updates
function syncWithNostrStats() {
  console.log('[Analytics] Backend stats updated, syncing analytics');
  if (window.backendStatsCache && window.analytics) {
    loadBackendStatsIntoAnalytics(window.backendStatsCache);
  }
}

// DEPRECATED: Sample data generation removed
// Analytics now uses backend API data for statistics

// Sync analytics with nostrStats data (fallback - not used in backend mode)
function syncWithNostrStatsLegacy() {
  console.log('[Analytics] Legacy relay sync called (should not happen in backend mode)');
}

// Load metadata from the legacy statistics system's metadataByPubkey cache
function loadMetadataFromLegacySystem() {
  console.log('[Analytics] Backend mode: metadata loading from legacy system disabled');
  // In backend mode, metadata comes from backend API, not relay connections
}

// Export for global access
window.initializeAnalyticsDashboard = initializeAnalyticsDashboard;
window.syncWithNostrStats = syncWithNostrStats;
window.loadBackendStatsIntoAnalytics = loadBackendStatsIntoAnalytics;
import React, { useState, useEffect } from 'react';

const formatNumber = (num) => num.toLocaleString();
const formatSats = (sats) => `${formatNumber(sats)} sats`;

export const OverviewStats = ({ analytics }) => {
  const [summaryStats, setSummaryStats] = useState({});
  const [backendStats, setBackendStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [backendVersion, setBackendVersion] = useState(0);
  
  // Get backend stats from window.backendStatsCache (set by statistics.js)
  const getBackendStats = () => {
    if (window.backendStatsCache) {
      console.log('[OverviewStats] Backend stats found:', window.backendStatsCache);
      return {
        totalRelays: window.backendStatsCache.total_relays,
        activeRelays: window.backendStatsCache.active_relays,
        totalEvents: window.backendStatsCache.total_events,
        uniqueAuthors: window.backendStatsCache.unique_authors,
        avgLatencyMs: window.backendStatsCache.avg_latency_ms,
        updatedAt: window.backendStatsCache.updated_at
      };
    }
    console.log('[OverviewStats] No backend stats available yet');
    return {};
  };
  
  useEffect(() => {
    // Initial setup
    const stats = analytics.getSummaryStats();
    setSummaryStats(stats);
    
    // Get backend stats (may be empty if not loaded yet)
    const backend = getBackendStats();
    setBackendStats(backend);
    setLoading(false);
    
    // Listen for analytics updates
    const handleUpdate = (type, data) => {
      console.log('[OverviewStats] Analytics update:', type, data);
      if (type === 'event' || type === 'eventBatch') {
        const updatedStats = analytics.getSummaryStats();
        setSummaryStats(updatedStats);
      } else if (type === 'backend-update') {
        // Backend data was updated - fetch it
        console.log('[OverviewStats] Backend update received from analytics');
        const backend = getBackendStats();
        setBackendStats(backend);
      }
    };
    
    analytics.addListener(handleUpdate);
    
    // Also listen for backend updates from window global events
    const handleBackendUpdate = (event) => {
      console.log('[OverviewStats] Caught global backend-stats-updated event', event.detail);
      const backend = getBackendStats();
      setBackendStats(backend);
    };
    
    window.addEventListener('backend-stats-updated', handleBackendUpdate, { passive: true });
    
    // Watch for version changes (backend stats updated)
    const versionInterval = setInterval(() => {
      const currentVersion = window.backendStatsVersion || 0;
      if (currentVersion !== backendVersion) {
        console.log('[OverviewStats] Backend version changed:', backendVersion, '->', currentVersion);
        setBackendVersion(currentVersion);
        const backend = getBackendStats();
        if (backend.totalRelays) {
          console.log('[OverviewStats] Updating backend stats from version change');
          setBackendStats(backend);
        }
      }
    }, 500);
    
    return () => {
      analytics.removeListener(handleUpdate);
      window.removeEventListener('backend-stats-updated', handleBackendUpdate);
      clearInterval(versionInterval);
    };
  }, [analytics, backendVersion]);
  
  if (loading) {
    return null;
  }
  
  console.log('[OverviewStats] Rendering with:', {
    backendStats,
    summaryStats
  });
  
  // PRIORITY: Use backend data for overview stats (it's authoritative)
  // Fall back to analytics data only if backend is not available
  const totalRelays = backendStats.totalRelays || 0;
  const activeRelays = backendStats.activeRelays || 0;
  const totalEvents = backendStats.totalEvents || summaryStats.totalEvents || 0;
  const uniqueAuthors = backendStats.uniqueAuthors || 0;
  const avgLatencyMs = backendStats.avgLatencyMs || null;
  
  const stats = [
    {
      label: 'Total Relays',
      value: formatNumber(totalRelays),
      highlight: totalRelays > 1000,
    },
    {
      label: 'Active Relays',
      value: formatNumber(activeRelays),
      highlight: activeRelays > 1000,
    },
    {
      label: 'Total Events',
      value: formatNumber(totalEvents),
      highlight: false,
    },
    {
      label: 'Unique Authors',
      value: formatNumber(uniqueAuthors),
      highlight: false,
    },
    {
      label: 'Avg Latency',
      value: avgLatencyMs ? `${avgLatencyMs}ms` : 'N/A',
      highlight: false,
    },
    {
      label: 'Total Zaps',
      value: formatSats(summaryStats.totalZaps || 0),
      highlight: false,
    },
    {
      label: 'Total Users',
      value: formatNumber(summaryStats.totalUsers || 0),
      highlight: false,
    },
  ];
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`border text-neutral-100 p-3 rounded-lg text-center ${
            stat.highlight
              ? 'bg-purple-900/20 border-purple-700'
              : 'bg-neutral-700 border-neutral-600'
          }`}
        >
          <div className="text-2xl font-bold">{stat.value}</div>
          <div className="text-xs text-neutral-400">{stat.label}</div>
        </div>
      ))}
    </div>
  );
};
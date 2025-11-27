import React, { useState, useEffect } from 'react';

const formatNumber = (num) => num.toLocaleString();
const formatSats = (sats) => `${formatNumber(sats)} sats`;

export const OverviewStats = ({ analytics }) => {
  const [backendStats, setBackendStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [zaps, setZaps] = useState(0);
  const [totalClients, setTotalClients] = useState(0);

  // Get backend stats from window.backendStatsCache (set by statistics.js)
  const getBackendStats = () => {
    if (window.backendStatsCache) {
      return {
        totalRelays: window.backendStatsCache.total_relays,
        activeRelays: window.backendStatsCache.active_relays,
        totalEvents: window.backendStatsCache.total_events,
        uniqueAuthors: window.backendStatsCache.unique_authors,
        avgLatencyMs: window.backendStatsCache.avg_latency_ms,
        updatedAt: window.backendStatsCache.updated_at,
        totalZaps: window.backendStatsCache.total_zaps || 0,
        totalClients: window.backendStatsCache.total_clients || (window.backendStatsCache.client_stats ? window.backendStatsCache.client_stats.length : 0),
      };
    }
    return {};
  };

  // Fetch zaps and clients only once on initial mount
  useEffect(() => {
    fetch('http://localhost:3000/api/v1/stats/events/24h')
      .then(res => res.json())
      .then(data => {
        if (data.activity_timeline && Array.isArray(data.activity_timeline)) {
          const totalZaps = data.activity_timeline.reduce((sum, day) => sum + (day.zaps || 0), 0);
          setZaps(totalZaps);
        }
      });

    fetch('http://localhost:3000/api/v1/stats/clients')
      .then(res => res.json())
      .then(data => {
        if (data.clients && Array.isArray(data.clients)) {
          setTotalClients(data.clients.length);
        }
      });
  }, []);

  // Handle backendStats updates and UI refresh
  useEffect(() => {
    const backend = getBackendStats();
    setBackendStats(backend);
    setLoading(false);

    const handleBackendUpdate = (event) => {
      const backend = getBackendStats();
      setBackendStats(backend);
    };
    window.addEventListener('backend-stats-updated', handleBackendUpdate, { passive: true });

    const versionInterval = setInterval(() => {
      const currentVersion = window.backendStatsVersion || 0;
      if (currentVersion !== backendStats.version) {
        setBackendStats(getBackendStats());
      }
    }, 500);

    return () => {
      window.removeEventListener('backend-stats-updated', handleBackendUpdate);
      clearInterval(versionInterval);
    };
  }, [backendStats]);

  if (loading) {
    return null;
  }

  // Use backend data for overview stats (it's authoritative)
  const totalRelays = backendStats.totalRelays || 0;
  const activeRelays = backendStats.activeRelays || 0;
  const totalEvents = backendStats.totalEvents || 0;
  const uniqueAuthors = backendStats.uniqueAuthors || 0;
  const avgLatencyMs = backendStats.avgLatencyMs || null;
  // Zaps and clients now come from API calls

  const stats = [
    {
      label: 'Active Relays (Connected)',
      value: formatNumber(activeRelays),
      highlight: activeRelays > 1000,
      tooltip: `Total Relays: ${formatNumber(totalRelays)}`,
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
      value: formatSats(zaps),
      highlight: false,
    },
    {
      label: 'Total Clients',
      value: formatNumber(totalClients),
      highlight: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`border bg-neutral-700 text-neutral-100 p-3 rounded-lg text-center ${
            stat.highlight
              ? 'border-purple-700'
              : 'border-neutral-600'
          }`}
          title={stat.tooltip || ''}
        >
          <div className="text-2xl font-bold">{stat.value}</div>
          <div className="text-xs text-neutral-400">{stat.label}</div>
          {stat.tooltip && (
            <div className="text-xs text-neutral-500 mt-1">{stat.tooltip}</div>
          )}
        </div>
      ))}
    </div>
  );
};
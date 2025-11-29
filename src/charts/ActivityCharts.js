import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

// Format utilities
const formatNumber = (num) => num.toLocaleString();
const formatDate = (timestamp) => new Date(timestamp * 1000).toLocaleDateString();
const formatSats = (sats) => `${formatNumber(sats)} sats`;

// Helper function to calculate activity data from raw events (for consistency with legacy stats)
const calculateActivityFromEvents = (events, timeRange) => {
  if (!events || events.length === 0) return [];
  
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (timeRange === '7d' ? 7 * 86400 : timeRange === '30d' ? 30 * 86400 : 86400);
  
  const dayMap = new Map();
  
  events.forEach(event => {
    if (event.created_at < startTime) return;
    
    const dayTimestamp = Math.floor(event.created_at / 86400) * 86400;
    
    if (!dayMap.has(dayTimestamp)) {
      dayMap.set(dayTimestamp, {
        timestamp: dayTimestamp,
        events: 0,
        trusted: 0,
        untrusted: 0,
        zaps: 0,
        kinds: {}
      });
    }
    
    const day = dayMap.get(dayTimestamp);
    day.events++;
    
    // Count zaps (kind 9735)
    if (event.kind === 9735) {
      day.zaps++;
    }
    
    // Track event kinds
    day.kinds[event.kind] = (day.kinds[event.kind] || 0) + 1;
    
    // For trusted/untrusted, we'll just count all as trusted since we don't have WoT data here
    day.trusted++;
  });
  
  return Array.from(dayMap.values()).sort((a, b) => a.timestamp - b.timestamp);
};

// Activity Charts Component
export const ActivityCharts = ({ analytics, timeRange }) => {
  const [activityData, setActivityData] = useState([]);
  const [hiddenLines, setHiddenLines] = useState({});
  const [useLegacyData, setUseLegacyData] = useState(false);
  
  useEffect(() => {
    // Check if we should use legacy stats for consistency
    const shouldUseLegacy = window.nostrStats && typeof window.nostrStats.getAllEvents === 'function';
    setUseLegacyData(shouldUseLegacy);
    
    console.log('[ActivityCharts] Initialized, using legacy data:', shouldUseLegacy);
    
    // Initial load - use legacy events if available
    let data;
    if (shouldUseLegacy) {
      const legacyEvents = window.nostrStats.getAllEvents();
      // Calculate activity data from legacy events
      data = calculateActivityFromEvents(legacyEvents, timeRange);
    } else {
      data = analytics.getActivityData(timeRange);
    }
    setActivityData(data);
    
    // Listen for analytics updates
    const handleUpdate = (type, data) => {
      console.log('[ActivityCharts] Update event:', type);
      if (type === 'event' || type === 'eventBatch') {
        let updatedData;
        if (shouldUseLegacy) {
          const legacyEvents = window.nostrStats.getAllEvents();
          updatedData = calculateActivityFromEvents(legacyEvents, timeRange);
        } else {
          updatedData = analytics.getActivityData(timeRange);
        }
        setActivityData(updatedData);
      } else if (type === 'backend-update') {
        // When backend updates, refresh activity data
        let updatedData;
        if (shouldUseLegacy) {
          const legacyEvents = window.nostrStats.getAllEvents();
          updatedData = calculateActivityFromEvents(legacyEvents, timeRange);
        } else {
          updatedData = analytics.getActivityData(timeRange);
        }
        setActivityData(updatedData);
      }
    };
    
    analytics.addListener(handleUpdate);
    
    // Listen for backend updates
    const handleBackendUpdate = () => {
      console.log('[ActivityCharts] Backend update received');
      let updatedData;
      if (shouldUseLegacy) {
        const legacyEvents = window.nostrStats.getAllEvents();
        updatedData = calculateActivityFromEvents(legacyEvents, timeRange);
      } else {
        updatedData = analytics.getActivityData(timeRange);
      }
      setActivityData(updatedData);
    };
    
    window.addEventListener('backend-stats-updated', handleBackendUpdate, { passive: true });
    
    return () => {
      analytics.removeListener(handleUpdate);
      window.removeEventListener('backend-stats-updated', handleBackendUpdate);
    };
  }, [analytics, timeRange]);
  
  const chartData = useMemo(() => {
    return activityData.map(day => ({
      date: formatDate(day.timestamp),
      events: day.events,
      trusted: day.trusted,
      untrusted: day.untrusted,
      zaps: day.zaps
    }));
  }, [activityData]);
  
  const zapsChartData = useMemo(() => {
    return activityData.map(day => ({
      date: formatDate(day.timestamp),
      zaps: day.zaps
    }));
  }, [activityData]);
  
  const kindsChartData = useMemo(() => {
    const kindsAgg = {};
    activityData.forEach(day => {
      Object.entries(day.kinds || {}).forEach(([kind, count]) => {
        kindsAgg[kind] = (kindsAgg[kind] || 0) + count;
      });
    });
    
    return Object.entries(kindsAgg)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([kind, count]) => ({ kind, count }));
  }, [activityData]);
  
  const trustChartData = useMemo(() => {
    const totalTrusted = activityData.reduce((sum, day) => sum + day.trusted, 0);
    const totalUntrusted = activityData.reduce((sum, day) => sum + day.untrusted, 0);
    
    return [
      { name: 'Trusted', value: totalTrusted },
      { name: 'Untrusted', value: totalUntrusted }
    ];
  }, [activityData]);
  
  const COLORS = ['rgba(99, 102, 241, 0.8)', 'rgba(236, 72, 153, 0.8)'];
  
  const handleLegendClick = (e) => {
    if (e.dataKey) {
      setHiddenLines(prev => ({
        ...prev,
        [e.dataKey]: !prev[e.dataKey]
      }));
    }
  };
  
  return (
    <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
      <div className="flex items-center justify-between border-b-2 border-neutral-600 pb-2 mb-3">
        <h2 className="text-xl font-bold text-neutral-100">Activity Over Time</h2>
      </div>
      
      {/* Daily Event Count Chart */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-300 mb-2">Daily Event Count</h3>
        <div style={{ height: '350px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 163, 163, 0.1)" />
              <XAxis 
                dataKey="date" 
                stroke="rgb(163, 163, 163)" 
                angle={-45} 
                textAnchor="end" 
                height={80} 
              />
              <YAxis stroke="rgb(163, 163, 163)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(38, 38, 38)',
                  border: '1px solid rgb(82, 82, 82)',
                }}
                labelStyle={{ color: 'rgb(212, 212, 212)' }}
              />
              <Legend 
                onClick={handleLegendClick}
                wrapperStyle={{ color: 'rgb(212, 212, 212)', cursor: 'pointer' }}
              />
              {!hiddenLines.events && (
                <Line
                  type="monotone"
                  dataKey="events"
                  stroke="rgba(99, 102, 241, 0.8)"
                  strokeWidth={2}
                  name="Total Events"
                />
              )}
              {!hiddenLines.trusted && (
                <Line
                  type="monotone"
                  dataKey="trusted"
                  stroke="rgba(34, 197, 94, 0.8)"
                  strokeWidth={2}
                  name="Trusted Events"
                />
              )}
              {!hiddenLines.untrusted && (
                <Line
                  type="monotone"
                  dataKey="untrusted"
                  stroke="rgba(239, 68, 68, 0.8)"
                  strokeWidth={2}
                  name="Untrusted Events"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Daily Zaps Value Chart */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-300 mb-2">Daily Zaps Value (Sats)</h3>
        <div style={{ height: '350px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={zapsChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 163, 163, 0.1)" />
              <XAxis 
                dataKey="date" 
                stroke="rgb(163, 163, 163)" 
                angle={-45} 
                textAnchor="end" 
                height={80} 
              />
              <YAxis stroke="rgb(163, 163, 163)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(38, 38, 38)',
                  border: '1px solid rgb(82, 82, 82)',
                }}
                labelStyle={{ color: 'rgb(212, 212, 212)' }}
                formatter={(value) => [formatSats(value), 'Zaps']}
              />
              <Bar dataKey="zaps" fill="rgba(245, 158, 11, 0.8)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Event Kinds Distribution */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-300 mb-2">Event Kinds Distribution</h3>
        <div style={{ height: '350px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={kindsChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(163, 163, 163, 0.1)" />
              <XAxis 
                dataKey="kind" 
                stroke="rgb(163, 163, 163)" 
                angle={-45} 
                textAnchor="end" 
                height={100} 
              />
              <YAxis stroke="rgb(163, 163, 163)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(38, 38, 38)',
                  border: '1px solid rgb(82, 82, 82)',
                }}
                labelStyle={{ color: 'rgb(212, 212, 212)' }}
                formatter={(value) => [formatNumber(value), 'Events']}
              />
              <Bar dataKey="count" fill="rgba(139, 92, 246, 0.8)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Trust Distribution Pie Chart */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-300 mb-2">Event Trust Distribution</h3>
        <div style={{ height: '300px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={trustChartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {trustChartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(38, 38, 38)',
                  border: '1px solid rgb(82, 82, 82)',
                }}
                labelStyle={{ color: 'rgb(212, 212, 212)' }}
              />
              <Legend wrapperStyle={{ color: 'rgb(212, 212, 212)' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
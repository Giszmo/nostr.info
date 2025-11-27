import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const formatNumber = (num) => num.toLocaleString();
const formatDate = (timestamp) => new Date(timestamp * 1000).toLocaleDateString();

export const ActiveUsersStats = ({ analytics, timeRange }) => {
  const [activeUsersData, setActiveUsersData] = useState([]);
  
  useEffect(() => {
    // Initial load
    const data = analytics.getActiveUsersData(timeRange);
    setActiveUsersData(data);
    console.log('[ActiveUsersStats] Initialized with', data.length, 'days of data');
    
    // Listen for analytics updates
    const handleUpdate = (type, data) => {
      console.log('[ActiveUsersStats] Update event:', type);
      if (type === 'event' || type === 'eventBatch') {
        const updatedData = analytics.getActiveUsersData(timeRange);
        setActiveUsersData(updatedData);
      } else if (type === 'backend-update') {
        // When backend updates, also refresh active users
        const updatedData = analytics.getActiveUsersData(timeRange);
        setActiveUsersData(updatedData);
      }
    };
    
    analytics.addListener(handleUpdate);
    
    // Listen for backend updates
    const handleBackendUpdate = () => {
      console.log('[ActiveUsersStats] Backend update received');
      const updatedData = analytics.getActiveUsersData(timeRange);
      setActiveUsersData(updatedData);
    };
    
    window.addEventListener('backend-stats-updated', handleBackendUpdate, { passive: true });
    
    return () => {
      analytics.removeListener(handleUpdate);
      window.removeEventListener('backend-stats-updated', handleBackendUpdate);
    };
  }, [analytics, timeRange]);
  
  const chartData = useMemo(() => {
    return activeUsersData.map(day => ({
      date: formatDate(day.timestamp),
      dailyActive: day.dailyActive,
      weeklyActive: day.weeklyActive
    }));
  }, [activeUsersData]);
  
  const currentStats = useMemo(() => {
    if (activeUsersData.length === 0) return { daily: 0, weekly: 0 };
    
    const latest = activeUsersData[activeUsersData.length - 1];
    return {
      daily: latest.dailyActive,
      weekly: latest.weeklyActive
    };
  }, [activeUsersData]);
  
  if (activeUsersData.length === 0) {
    return (
      <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
        <div className="text-center text-neutral-300">Loading active users data...</div>
      </div>
    );
  }
  
  return (
    <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
      <div className="flex items-center justify-between border-b-2 border-neutral-600 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold text-neutral-100">Active Users Analytics</h2>
          <p className="text-xs text-neutral-400 mt-1">
            Tracking trusted daily and weekly active user counts across the Nostr network
          </p>
        </div>
      </div>
      
      {/* Current Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-neutral-700 rounded-lg p-4 border border-neutral-600">
          <div className="text-2xl font-bold text-neutral-100">{formatNumber(currentStats.daily)}</div>
          <div className="text-sm text-neutral-400">Daily Active Users</div>
          <div className="text-xs text-neutral-500 mt-1">Latest 24h period</div>
        </div>
        <div className="bg-neutral-700 rounded-lg p-4 border border-neutral-600">
          <div className="text-2xl font-bold text-neutral-100">{formatNumber(currentStats.weekly)}</div>
          <div className="text-sm text-neutral-400">Weekly Active Users</div>
          <div className="text-xs text-neutral-500 mt-1">Latest 7-day period</div>
        </div>
      </div>
      
      {/* Active Users Over Time Chart */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-300 mb-2">Active Users Over Time</h3>
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
                formatter={(value, name) => [formatNumber(value), name]}
              />
              <Legend wrapperStyle={{ color: 'rgb(212, 212, 212)' }} />
              <Line
                type="monotone"
                dataKey="dailyActive"
                stroke="rgba(34, 197, 94, 0.8)"
                strokeWidth={2}
                name="Daily Active"
              />
              <Line
                type="monotone"
                dataKey="weeklyActive"
                stroke="rgba(99, 102, 241, 0.8)"
                strokeWidth={2}
                name="Weekly Active"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Growth Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        <div className="bg-neutral-700 rounded-lg p-3 border border-neutral-600">
          <div className="text-lg font-semibold text-neutral-100">
            {activeUsersData.length > 0 ? formatNumber(Math.max(...activeUsersData.map(d => d.dailyActive))) : '0'}
          </div>
          <div className="text-xs text-neutral-400">Peak Daily Users</div>
        </div>
        <div className="bg-neutral-700 rounded-lg p-3 border border-neutral-600">
          <div className="text-lg font-semibold text-neutral-100">
            {activeUsersData.length > 0 ? formatNumber(Math.max(...activeUsersData.map(d => d.weeklyActive))) : '0'}
          </div>
          <div className="text-xs text-neutral-400">Peak Weekly Users</div>
        </div>
        <div className="bg-neutral-700 rounded-lg p-3 border border-neutral-600">
          <div className="text-lg font-semibold text-neutral-100">
            {activeUsersData.length > 1 ? 
              (((currentStats.daily / activeUsersData[activeUsersData.length - 8]?.dailyActive || 1) - 1) * 100).toFixed(1) + '%' : 
              '0%'
            }
          </div>
          <div className="text-xs text-neutral-400">7-Day Growth</div>
        </div>
      </div>
    </div>
  );
};
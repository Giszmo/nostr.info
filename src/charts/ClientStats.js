import React, { useState, useEffect } from 'react';

const formatNumber = (num) => num.toLocaleString();
const formatDate = (timestamp) => new Date(timestamp * 1000).toLocaleDateString();

export const ClientStats = ({ analytics }) => {
  const [clientData, setClientData] = useState([]);
  const [backendVersion, setBackendVersion] = useState(0);
  
  // Fetch client stats from backend API
  const fetchClientStats = async () => {
    try {
      const API_BASE_URL = 'http://localhost:3000/api/v1';
      const response = await fetch(`${API_BASE_URL}/stats/clients?range=24h`);
      
      if (!response.ok) {
        console.warn('[ClientStats] Backend API error:', response.status);
        return null;
      }
      
      const data = await response.json();
      console.log('[ClientStats] Fetched from backend API:', data.clients?.length || 0, 'clients');
      
      // Transform backend data format to component format
      if (data.clients && Array.isArray(data.clients)) {
        // Backend returns { name, count, event_count, last_seen, kinds }
        const formatted = data.clients.map(client => ({
          name: client.name || client.client_name || 'Unknown',
          count: client.count || client.event_count || 0,
          lastSeen: client.last_seen || Math.floor(Date.now() / 1000),
          kinds: client.kinds || {}
        })).slice(0, 20);
        
        return formatted;
      }
      
      return null;
    } catch (error) {
      console.error('[ClientStats] Error fetching from backend:', error);
      return null;
    }
  };
  
  useEffect(() => {
    console.log('[ClientStats] Initializing - using backend API for client stats');
    
    // Initial fetch
    fetchClientStats().then(data => {
      if (data) {
        setClientData(data);
      }
    });
    
    // Listen for backend updates and refetch
    const handleBackendUpdate = (event) => {
      console.log('[ClientStats] Backend update event received');
      fetchClientStats().then(data => {
        if (data) {
          setClientData(data);
        }
      });
    };
    
    window.addEventListener('backend-stats-updated', handleBackendUpdate, { passive: true });
    
    // Also listen to backend version updates from window
    const versionCheckInterval = setInterval(() => {
      if (window.backendStatsVersion && window.backendStatsVersion !== backendVersion) {
        console.log('[ClientStats] Backend version changed:', backendVersion, '->', window.backendStatsVersion);
        setBackendVersion(window.backendStatsVersion);
        
        fetchClientStats().then(data => {
          if (data) {
            setClientData(data);
          }
        });
      }
    }, 1000);
    
    // Poll for updates every 60 seconds (match backend poll interval)
    const pollInterval = setInterval(() => {
      fetchClientStats().then(data => {
        if (data) {
          setClientData(data);
        }
      });
    }, 60000);
    
    return () => {
      window.removeEventListener('backend-stats-updated', handleBackendUpdate);
      clearInterval(versionCheckInterval);
      clearInterval(pollInterval);
    };
  }, [backendVersion]);
  
  if (clientData.length === 0) {
    return (
      <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
        <div className="text-center text-neutral-300">Loading client data...</div>
      </div>
    );
  }
  
  return (
    <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
      <div className="flex items-center justify-between border-b-2 border-neutral-600 pb-2 mb-3">
        <h2 className="text-xl font-bold text-neutral-100">Client Statistics</h2>
      </div>
      
      {/* Client Information Table - Mobile Responsive */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm min-w-max md:min-w-0">
          <thead className="bg-neutral-700 text-neutral-100 border-b border-neutral-600 sticky top-0">
            <tr>
              <th className="p-2 text-left whitespace-nowrap">Client</th>
              <th className="p-2 text-right whitespace-nowrap">Events</th>
              <th className="p-2 text-left whitespace-nowrap hidden sm:table-cell">Last Activity</th>
              <th className="p-2 text-left whitespace-nowrap hidden md:table-cell">Top Kinds</th>
            </tr>
          </thead>
          <tbody>
            {clientData.map((client) => {
              const kindsEntries = Object.entries(client.kinds || {}).sort((a, b) => b[1] - a[1]);
              let kindsStr;
              if (kindsEntries.length === 0) {
                kindsStr = 'N/A';
              } else if (kindsEntries.length <= 3) {
                kindsStr = kindsEntries.map(([kind]) => kind).join(', ');
              } else {
                const topThree = kindsEntries.slice(0, 3).map(([kind]) => kind).join(', ');
                const remaining = kindsEntries.length - 3;
                kindsStr = `${topThree} + ${remaining} more`;
              }
              
              return (
                <tr
                  key={client.name}
                  className="border-b border-neutral-700 hover:bg-neutral-700/50 text-xs md:text-sm"
                >
                  <td className="p-2 font-semibold text-neutral-200 whitespace-nowrap">{client.name}</td>
                  <td className="p-2 text-neutral-300 text-right whitespace-nowrap">{formatNumber(client.count)}</td>
                  <td className="p-2 text-neutral-400 text-xs whitespace-nowrap hidden sm:table-cell">
                    {formatDate(client.lastSeen)}
                  </td>
                  <td className="p-2 text-xs text-neutral-400 hidden md:table-cell">{kindsStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
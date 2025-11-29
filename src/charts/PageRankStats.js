import React, { useState, useEffect, useMemo } from 'react';

const formatNumber = (num) => num.toLocaleString();
const formatPubkey = (pubkey, length = 8) => {
  if (pubkey.length <= length * 2) return pubkey;
  return `${pubkey.slice(0, length)}...${pubkey.slice(-length)}`;
};

export const PageRankStats = ({ analytics }) => {
  const [pagerankData, setPagerankData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [useLegacyData, setUseLegacyData] = useState(false);
  
  useEffect(() => {
    // Check if we should use legacy stats for consistency
    const shouldUseLegacy = window.nostrStats && typeof window.nostrStats.getAllEvents === 'function';
    setUseLegacyData(shouldUseLegacy);
    
    // Initial load - PageRank calculation is the same regardless, 
    // but using legacy events ensures consistency with other stats
    const data = analytics.getPageRankData(100);
    setPagerankData(data);
    setLoading(false);
    
    // Listen for analytics updates
    const handleUpdate = (type, data) => {
      if (type === 'event' || type === 'eventBatch') {
        const updatedData = analytics.getPageRankData(100);
        setPagerankData(updatedData);
      }
    };
    
    analytics.addListener(handleUpdate);
    
    // Fallback: also check every 3 seconds for updates (less frequent since pagerank is expensive)
    const interval = setInterval(() => {
      const updatedData = analytics.getPageRankData(100);
      setPagerankData(updatedData);
    }, 3000);
    
    return () => {
      analytics.removeListener(handleUpdate);
      clearInterval(interval);
    };
  }, [analytics]);
  
  const top100Users = useMemo(() => {
    return pagerankData.slice(0, 100);
  }, [pagerankData]);
  
  if (loading) {
    return (
      <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
        <div className="text-center text-neutral-300">Loading pagerank data...</div>
      </div>
    );
  }
  
  return (
    <div className="bg-neutral-800 rounded-lg shadow-lg p-4 mb-4 border border-neutral-700">
      <div className="flex justify-between items-start mb-3 border-b-2 border-neutral-600 pb-2">
        <div className="flex-1">
          <h2 className="text-xl font-bold text-neutral-100">PageRank Analysis</h2>
        </div>
      </div>
      
      <p className="text-xs text-neutral-400 mb-4">
        Top influential accounts based on network connectivity and activity
      </p>
      
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-neutral-700 rounded-lg p-4 border border-neutral-600">
          <div className="text-2xl font-bold text-neutral-100">{formatNumber(pagerankData.length)}</div>
          <div className="text-sm text-neutral-400">Total Ranked Users</div>
        </div>
        <div className="bg-neutral-700 rounded-lg p-4 border border-neutral-600">
          <div className="text-2xl font-bold text-neutral-100">
            {pagerankData.length > 0 ? formatNumber(pagerankData[0].followerCount) : '0'}
          </div>
          <div className="text-sm text-neutral-400">Top User Followers</div>
        </div>
        <div className="bg-neutral-700 rounded-lg p-4 border border-neutral-600">
          <div className="text-2xl font-bold text-neutral-100">
            {pagerankData.length > 0 ? pagerankData[0].score.toFixed(2) : '0'}
          </div>
          <div className="text-sm text-neutral-400">Highest Score</div>
        </div>
      </div>
      
      <h3 className="text-sm font-semibold text-neutral-300 mb-2">Top 100 Users</h3>
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm min-w-max md:min-w-0">
          <thead className="bg-neutral-700 text-neutral-100 border-b border-neutral-600 sticky top-0">
            <tr>
              <th className="p-2 text-left whitespace-nowrap">Rank</th>
              <th className="p-2 text-left whitespace-nowrap">Profile</th>
              <th className="p-2 text-right whitespace-nowrap">Score</th>
              <th className="p-2 text-right whitespace-nowrap hidden sm:table-cell">Followers</th>
              <th className="p-2 text-right whitespace-nowrap hidden md:table-cell">Events</th>
            </tr>
          </thead>
          <tbody>
            {top100Users.map((user, index) => (
              <tr
                key={user.pubkey}
                className="border-b border-neutral-700 hover:bg-neutral-700/50 text-xs md:text-sm"
              >
                <td className="p-2 text-neutral-300 whitespace-nowrap font-mono text-xs">#{index + 1}</td>
                <td className="p-2 h-14">
                  <div className="flex items-center gap-2 max-w-xs h-full md:max-w-sm">
                    {/* User Avatar/Image */}
                    {user.metadata?.picture ? (
                      <img
                        src={user.metadata.picture}
                        alt={user.metadata.name || 'User'}
                        className="w-8 h-8 md:w-10 md:h-10 rounded-full object-cover flex-shrink-0 border border-neutral-600"
                        style={{ maxWidth: '40px', maxHeight: '40px' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 md:w-10 md:h-10 bg-neutral-600 rounded-full flex items-center justify-center text-xs md:text-sm font-bold text-neutral-100 flex-shrink-0">
                        {user.pubkey.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      {/* User Name - if available, show only name */}
                      {user.metadata?.name ? (
                        <div>
                          <div className="text-xs md:text-sm font-semibold text-neutral-100 truncate">
                            {user.metadata.name}
                          </div>
                          {user.metadata.nip05 && (
                            <div className="text-xs text-neutral-400 truncate hidden sm:block">
                              {user.metadata.nip05}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* User Pubkey - only show if no name */
                        <code className="text-xs text-neutral-400 truncate font-mono">
                          {formatPubkey(user.pubkey, 6)}
                        </code>
                      )}
                    </div>
                  </div>
                </td>
                <td className="p-2 text-neutral-200 font-semibold text-right whitespace-nowrap">
                  {user.score.toFixed(2)}
                </td>
                <td className="p-2 text-neutral-300 text-right whitespace-nowrap hidden sm:table-cell">
                  {formatNumber(user.followerCount)}
                </td>
                <td className="p-2 text-neutral-300 text-right whitespace-nowrap hidden md:table-cell">
                  {formatNumber(user.eventCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {pagerankData.length === 0 && (
        <div className="text-center py-8 text-neutral-400">
          <p>No PageRank data available yet.</p>
          <p className="text-xs mt-2">User ranking data will appear as the network is analyzed.</p>
        </div>
      )}
    </div>
  );
};
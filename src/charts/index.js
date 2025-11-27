// Main entry point for all chart components
import React from 'react';
import ReactDOM from 'react-dom/client';

// Import all chart components
import { ActivityCharts } from './ActivityCharts';
import { ClientStats } from './ClientStats';
// import { ActiveUsersStats } from './ActiveUsersStats';
import { PageRankStats } from './PageRankStats';
import { OverviewStats } from './OverviewStats';

// Tab component for organizing different views
const Tabs = ({ tabs, activeTab, onTabChange }) => {
  const activeTabContent = tabs.find(tab => tab.id === activeTab)?.content;
  
  return (
    <div>
      {/* Tab Headers */}
      <div className="bg-neutral-800 rounded-lg shadow-lg mb-4 border border-neutral-700 overflow-x-auto">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex-1 min-w-fit px-6 py-3 text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? 'bg-neutral-700 text-neutral-100 border-b-2 border-purple-500'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-750'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      
      {/* Tab Content */}
      <div>{activeTabContent}</div>
    </div>
  );
};

// Main Analytics Dashboard Component
const AnalyticsDashboard = ({ analytics }) => {
  const [activeTab, setActiveTab] = React.useState('overview');
  const [timeRange, setTimeRange] = React.useState(null);
  const [forceUpdate, setForceUpdate] = React.useState(0);
  
  // Listen to analytics time filter changes
  React.useEffect(() => {
    const handleTimeFilter = (type, data) => {
      if (type === 'timeFilter') {
        const newRange = analytics.getCurrentTimeRange();
        console.log('Time range changed:', newRange);
        setTimeRange(newRange);
        // Force a re-render of all child components
        setForceUpdate(prev => prev + 1);
      }
    };
    
    analytics.addListener(handleTimeFilter);
    return () => analytics.removeListener(handleTimeFilter);
  }, [analytics]);
  
  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <>
          <OverviewStats analytics={analytics} />
          {/* <ActiveUsersStats analytics={analytics} timeRange={timeRange} /> */}
        </>
      ),
    },
    {
      id: 'clients',
      label: 'Client Stats',
      content: <ClientStats analytics={analytics} />,
    },
    {
      id: 'pagerank',
      label: 'PageRank',
      content: <PageRankStats analytics={analytics} />,
    },
  ];
  
  return (
    <div className="analytics-dashboard">
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

// Export components individually and as a bundle
export {
  ActivityCharts,
  ClientStats,
  // ActiveUsersStats,
  PageRankStats,
  OverviewStats,
  AnalyticsDashboard,
  Tabs
};

// Global mount function for easy integration
window.mountAnalyticsDashboard = (containerId, analytics) => {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('Analytics dashboard container not found:', containerId);
    return;
  }
  
  const root = ReactDOM.createRoot(container);
  root.render(<AnalyticsDashboard analytics={analytics} />);
  return root;
};

// Export for webpack
export default {
  ActivityCharts,
  ClientStats,
  // ActiveUsersStats,
  PageRankStats,
  OverviewStats,
  AnalyticsDashboard,
  Tabs,
  mountAnalyticsDashboard: window.mountAnalyticsDashboard
};
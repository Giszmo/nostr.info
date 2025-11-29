---
layout: page
permalink: /
---
<link rel="stylesheet" href="/assets/css/main.css">
<link rel="stylesheet" href="/assets/css/statistics.css">
<link rel="stylesheet" href="/assets/css/analytics.css">
<link rel="stylesheet" href="/assets/css/events.css">
<script src="/js/analytics.js"></script>
<script src="/js/components/time-filter.js"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="/assets/dist/charts.js"></script>
<script src="/js/analytics-init.js"></script>
<script src="/js/statistics.js"></script>

<div class="statistics-container">

  <div class="events-progress-banner" id="connection-status" role="status" aria-live="polite">
    <span class="events-progress-indicator"></span>
    <span class="events-progress-text">Connecting to relays…</span>
  </div>

  <!-- Analytics Dashboard Section -->
  <div class="analytics-dashboard-container">

    <!-- Time Range Filter - DISABLED: Not yet implemented for real-time sorting -->
    <!-- <div id="analytics-time-filter"></div> -->

    <!-- Analytics Dashboard -->
    <div id="analytics-dashboard-root"></div>
  </div>

  <!-- Legacy Statistics Controls -->
  <div class="controls-container">
    <div class="filter-group">
      <label for="time-range">Legacy Time Range:</label>
      <select name="time-range" id="time-range" class="filter-select" onchange="updateTimeRange()">
        <option value="24h" selected>Last 24 Hours</option>
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
        <option value="90d">Last 90 Days</option>
      </select>
    </div>
    <button id="refresh-stats" class="refresh-button" onclick="refreshStatistics()">{% fa_svg fas.fa-arrows-rotate %} Refresh</button>
  </div>

  <nav class="stats-tabs" aria-label="Statistics sections" role="tablist">
    <button type="button" class="stats-tab active" id="tab-button-distribution" role="tab" aria-selected="true" aria-controls="tab-distribution" data-tab="distribution">{% fa_svg fas.fa-bullseye %}<span>Event Distribution</span></button>
    <button type="button" class="stats-tab" id="tab-button-top-relays" role="tab" aria-selected="false" aria-controls="tab-top-relays" data-tab="top-relays">{% fa_svg fas.fa-trophy %}<span>Top Relays</span></button>
  </nav>

  <div class="tab-panels">
  <section class="stats-section tab-panel active" id="tab-distribution" data-tab-panel="distribution" role="tabpanel" aria-labelledby="tab-button-distribution">
      <div class="distribution-container">
        <div class="chart-container chart-small" style="width:100%;max-width:450px;margin:auto;display:inline-block;vertical-align:top;height:450px;overflow:hidden;">
          <div style="text-align:center;margin-bottom:0.5rem;">
            <h3 style="margin:0;font-size:1rem;color:#333;">Event Kinds Distribution</h3>
            <small style="color:#888;font-size:0.85rem;">Proportional breakdown of event kinds</small>
          </div>
          <div style="position:relative;height:350px;width:100%;">
            <canvas id="event-kinds-chart"></canvas>
          </div>
        </div>
        <div class="chart-container chart-large" style="width:100%;max-width:700px;margin:auto;display:inline-block;vertical-align:top;height:450px;overflow:hidden;">
          <div style="text-align:center;margin-bottom:0.5rem;">
            <h3 style="margin:0;font-size:1rem;color:#333;">Client Software Usage</h3>
            <small style="color:#888;font-size:0.85rem;">Top 20 clients by event count</small>
          </div>
          <div style="position:relative;height:350px;width:100%;">
            <canvas id="event-kinds-bar-chart"></canvas>
          </div>
        </div>
      </div>
    </section>
  <section class="stats-section tab-panel" id="tab-top-relays" data-tab-panel="top-relays" role="tabpanel" aria-labelledby="tab-button-top-relays" hidden>
      <div class="top-relays-container">
        <table class="top-relays-table" id="top-relays-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Relay URL</th>
              <th>Status</th>
              <th>Events</th>
              <th>Active Users</th>
              <th>Avg Latency</th>
              <th>Top Kinds</th>
            </tr>
          </thead>
          <tbody id="top-relays-tbody">
            <tr>
              <td colspan="7" style="text-align:center;padding:2rem">
                <span class="loading">Loading relay data...</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

</div>

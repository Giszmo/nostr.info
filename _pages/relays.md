---
layout: page
title: Relays
permalink: /relays/
---

<link rel="stylesheet" href="/assets/css/main.css">
<link rel="stylesheet" href="/assets/css/relays.css">
<link rel="stylesheet" href="/assets/css/relays-grid.css">
<script src="/js/relays.js"></script>

<div class="relays-container">

  <div class="controls-container">
    <div id="relay-filters">
      <button id="connectNewRelays" class="connect-button" onclick="connectRelays()">
        {% fa_svg fas.fa-arrows-rotate %} Connect New Relays
      </button>
      <div class="filters-row" style="margin-top:0.75rem">
        <div class="filter-item">
          <label for="nip11-nips">{% fa_svg fas.fa-hashtag %} Supported NIPs</label>
          <select id="nip11-nips" class="filter-select" onchange="setDirty()">
            <option value="all" selected>Any NIP</option>
            <!-- options populated dynamically by JS -->
          </select>
        </div>

        <div class="filter-item">
          <label for="relay-sort">{% fa_svg fas.fa-sort %} Sort</label>
          <select id="relay-sort" class="filter-select" onchange="setDirty()">
            <option value="default" selected>Default</option>
            <option value="latency">Avg Latency</option>
            <option value="activeUsers">Active Users</option>
            <option value="payment_required">Payment Required</option>
            <option value="auth_required">Auth Required</option>
            <option value="max_limit">Max Limit</option>
            <option value="max_subscriptions">Max Subscriptions</option>
            <option value="created_at_lower_limit">Created At Lower Limit</option>
          </select>
        </div>
      </div>
    </div>
<br>
<div id="output"></div>

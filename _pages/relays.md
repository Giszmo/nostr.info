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
    <select name="tab" id="tab" class="tab-select" onchange="setDirty()">
      <option value="relays">📡 Show Relays</option>
      <option value="events">📝 Show Events</option>
    </select>

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
    <div id="event-filters">
      <div class="filters-row">
        <div class="filter-item">
          <label for="kind-filter">{% fa_svg fas.fa-shapes %} Event Type</label>
          <select name="kind-filter" id="kind-filter" class="filter-select" onchange="setDirty()">
            <option value="all">{% fa_svg fas.fa-list %} All Types</option>
            <option value="unknown">{% fa_svg fas.fa-circle-question %} Unhandled</option>
            <option value="0">{% fa_svg fas.fa-user %} Metadata</option>
            <option value="1">{% fa_svg fas.fa-comment %} Public Post</option>
            <option value="2">{% fa_svg fas.fa-tower-broadcast %} Relay Rec</option>
            <option value="3">{% fa_svg fas.fa-users %} Follows</option>
            <option value="4">{% fa_svg fas.fa-envelope %} DM</option>
            <option value="5">{% fa_svg fas.fa-trash %} Deletions</option>
            <option value="6">{% fa_svg fas.fa-retweet %} Boost</option>
            <option value="7">{% fa_svg fas.fa-heart %} Reactions</option>
            <option value="30">{% fa_svg fas.fa-chess %} Chess</option>
            <option value="40">{% fa_svg fas.fa-bullhorn %} Channel Create</option>
            <option value="41">{% fa_svg fas.fa-pen %} Channel Update</option>
            <option value="42">{% fa_svg fas.fa-comments %} Channel Msg</option>
            <option value="43">{% fa_svg fas.fa-eye-slash %} Hide</option>
            <option value="44">{% fa_svg fas.fa-volume-xmark %} Mute</option>
            <option value="60">{% fa_svg fas.fa-car %} Ride Share</option>
          </select>
        </div>

        <div class="filter-item filter-item-wide">
          <label for="pubkey-filter">{% fa_svg fas.fa-key %} Public Key</label>
          <input type="text" 
                 name="pubkey-filter" 
                 id="pubkey-filter" 
                 class="filter-input" 
                 placeholder="Enter public key (hex or npub)..." 
                 onchange="setDirty()">
        </div>

        <div class="filter-item">
          <label for="degree-filter">{% fa_svg fas.fa-diagram-project %} Depth</label>
          <select name="degree-filter" 
                  id="degree-filter" 
                  class="filter-select" 
                  disabled 
                  onchange="setDirty()">
            <option value="0">{% fa_svg fas.fa-bullseye %} Direct</option>
            <option value="1">{% fa_svg fas.fa-user-group %} 1st Degree</option>
            <option value="2">{% fa_svg fas.fa-share-nodes %} 2nd Degree</option>
            <option value="3">{% fa_svg fas.fa-sitemap %} 3rd Degree</option>
            <option value="4">{% fa_svg fas.fa-network-wired %} 4th Degree</option>
            <option value="5">{% fa_svg fas.fa-globe %} 5th Degree</option>
          </select>
        </div>
      </div>
    </div>
<br>
<div id="output"></div>

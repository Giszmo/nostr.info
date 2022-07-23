---
layout: home
---

<link rel="stylesheet" href="/assets/css/main.css">
<script src="/assets/js/main.js"></script>

<select name="tab" id="tab" onchange="setDirty()">
  <option value="relays">Show Relays</option>
  <option value="events">Show Events</option>
</select>
<br>

<div id="relay-filters">
  <label for="relay-filter">Filter by Relay performance:</label>
  <select name="relay-filter" id="relay-filter" onchange="setDirty()">
    <option value="sentConnected">Sent us many without dropping</option>
    <option value="sentMany">Sent us many events</option>
    <option value="sent">Sent us events</option>
    <option value="didConnect" default>Accepted WebSocket connection</option>
    <option value="all">All</option>
  </select>
  <br><input id="connectNewRelays" type="button" onclick="connectRelays()" value="Connect new relays!">
</div>
<div id="event-filters">
  <label for="kind-filter">Filter by Kind:</label>
  <select name="kind-filter" id="kind-filter" onchange="setDirty()">
    <option value="all">kind-*: All kinds</option>
    <option value="unknown">kind-?: Stuff we don't handle yet</option>
    <option value="0">kind-0: Metadata</option>
    <option value="1">kind-1: Public Post</option>
    <option value="2">kind-2: Relay Recommendation</option>
    <option value="3">kind-3: Follows List</option>
    <option value="4">kind-4: DM</option>
    <option value="5">kind-5: Deletions</option>
    <option value="6">kind-6: Quoted Boost</option>
    <option value="7">kind-7: Reactions</option>
    <option value="30">kind-30: Chess</option>
    <option value="60">kind-60: Ride Sharing</option>
  </select>
  <br>
  <label for="pubkey-filter">Filter by Pubkey:</label>
  <input type="text" name="pubkey-filter" id="pubkey-filter" onchange="setDirty()">
  <label for="degree-filter">... and follows of degree:</label>
  <select name="degree-filter" id="degree-filter" disabled onchange="setDirty()">
    <option value="0">Only the pubkey</option>
    <option value="1">Follows of the pubkey</option>
    <option value="2">Follows² of the pubkey</option>
    <option value="3">Follows³ of the pubkey</option>
    <option value="4">Follows⁴ of the pubkey</option>
    <option value="5">Follows⁵ of the pubkey</option>
  </select>
</div>
<br>
<div id="output"></div>

---
layout: home
---

<link rel="stylesheet" href="/assets/css/main.css">
<script src="/assets/js/main.js"></script>
<br>
<label for="kind-filter">Filter by Kind:</label>
<select name="kind-filter" id="kind-filter" onchange="dirty=true">
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
  <option value="60">kind-60: Ride Sharing</option>
</select>
<br>
<label for="pubkey-filter">Filter by Pubkey:</label>
<input type="text" name="pubkey-filter" id="pubkey-filter" onchange="dirty=true">
<label for="degree-filter">... and follows of degree:</label>
<select name="degree-filter" id="degree-filter" disabled onchange="dirty=true">
  <option value="0">Only the pubkey</option>
  <option value="1">Follows of the pubkey</option>
  <option value="2">Follows² of the pubkey</option>
  <option value="3">Follows³ of the pubkey</option>
  <option value="4">Follows⁴ of the pubkey</option>
  <option value="5">Follows⁵ of the pubkey</option>
</select>
<br>
<div id="output"></div>

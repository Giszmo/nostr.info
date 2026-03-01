---
layout: page
title: Relays
permalink: /relays/
---

<link rel="stylesheet" href="/assets/css/main.css">
<script src="/js/relays.js"></script>

<select name="tab" id="tab" onchange="setDirty()">
  <option value="relays">Show Relays</option>
  <option value="events">Show Events</option>
</select>
<button id="stop-btn" hidden onclick="toggleStop()" style="margin-left:8px;">⏹ Stop</button>
<br>

<div id="relay-filters">
  <label for="relay-filter">Filter by Relay performance:</label>
  <select name="relay-filter" id="relay-filter" onchange="setDirty()">
    <option value="sentConnected">Sent us many without dropping</option>
    <option value="sentMany">Sent us many events</option>
    <option value="sent">Sent us events</option>
    <option value="didConnect" selected>Accepted WebSocket connection</option>
    <option value="all">All</option>
  </select>
  <br><input id="connectNewRelays" type="button" onclick="connectRelays()" value="Connect new relays!">
</div>
<div id="event-filters">
  <label for="kind-filter">Filter by Kind:</label>
  <select name="kind-filter" id="kind-filter" onchange="setDirty()">
    <option value="all">All kinds</option>
    <option value="unknown">Unknown (not in any category)</option>
    <option value="cat-core">── Core (NIP-01) ──</option>
    <option value="0">  kind-0: Metadata</option>
    <option value="1">  kind-1: Public Post</option>
    <option value="2">  kind-2: Relay Recommendation</option>
    <option value="3">  kind-3: Follows List</option>
    <option value="5">  kind-5: Deletions</option>
    <option value="6">  kind-6: Repost (NIP-18)</option>
    <option value="7">  kind-7: Reactions</option>
    <option value="8">  kind-8: Badge Award (NIP-58)</option>
    <option value="9">  kind-9: Chat Message (NIP-C7)</option>
    <option value="11">  kind-11: Thread (NIP-7D)</option>
    <option value="16">  kind-16: Generic Repost (NIP-18)</option>
    <option value="cat-encryption">── Encryption &amp; DMs ──</option>
    <option value="4">  kind-4: Encrypted DM (NIP-04)</option>
    <option value="13">  kind-13: Seal (NIP-59)</option>
    <option value="14">  kind-14: Direct Message (NIP-17)</option>
    <option value="1059">  kind-1059: Gift Wrap (NIP-59)</option>
    <option value="10050">  kind-10050: DM Relay List (NIP-17)</option>
    <option value="20004">  kind-20004: Ephemeral Encrypted</option>
    <option value="22456">  kind-22456: Ephemeral Encrypted</option>
    <option value="cat-media">── Media ──</option>
    <option value="20">  kind-20: Picture (NIP-68)</option>
    <option value="21">  kind-21: Video Event (NIP-71)</option>
    <option value="22">  kind-22: Short Video (NIP-71)</option>
    <option value="1063">  kind-1063: File Metadata (NIP-94)</option>
    <option value="cat-chat">── Chat (NIP-28) ──</option>
    <option value="40">  kind-40: Channel created</option>
    <option value="41">  kind-41: Channel metadata update</option>
    <option value="42">  kind-42: Channel message</option>
    <option value="43">  kind-43: Hide message</option>
    <option value="44">  kind-44: Mute user</option>
    <option value="cat-relaymon">── Relay Monitoring (NIP-66) ──</option>
    <option value="1066">  kind-1066: Relay Monitor Delta</option>
    <option value="10166">  kind-10166: Relay Monitor Announcement</option>
    <option value="20166">  kind-20166: Relay Monitor Ephemeral</option>
    <option value="30166">  kind-30166: Relay Discovery</option>
    <option value="cat-lists">── Lists (NIP-51) ──</option>
    <option value="10000">  kind-10000: Mute List</option>
    <option value="10002">  kind-10002: Relay List Metadata (NIP-65)</option>
    <option value="10003">  kind-10003: Bookmark List</option>
    <option value="10009">  kind-10009: Pin List</option>
    <option value="30000">  kind-30000: Follow Sets</option>
    <option value="cat-dvm">── DVM (NIP-90) ──</option>
    <option value="dvm-request">  kind-5xxx: DVM Job Requests</option>
    <option value="5300">  kind-5300: DVM Content Discovery Request</option>
    <option value="dvm-result">  kind-6xxx: DVM Job Results</option>
    <option value="6300">  kind-6300: DVM Content Discovery Result</option>
    <option value="7000">  kind-7000: DVM Job Feedback</option>
    <option value="cat-marketplace">── Marketplace (NIP-15) ──</option>
    <option value="30017">  kind-30017: Marketplace Stall</option>
    <option value="30018">  kind-30018: Marketplace Product</option>
    <option value="38383">  kind-38383: P2P Trade Order (NIP-69)</option>
    <option value="38384">  kind-38384: P2P Trade Event</option>
    <option value="38385">  kind-38385: P2P Trade Event</option>
    <option value="cat-content">── Long-form &amp; Content ──</option>
    <option value="30023">  kind-30023: Long-form Article (NIP-23)</option>
    <option value="1984">  kind-1984: Report (NIP-56)</option>
    <option value="1985">  kind-1985: Label (NIP-32)</option>
    <option value="30311">  kind-30311: Live Event (NIP-53)</option>
    <option value="30315">  kind-30315: User Status (NIP-38)</option>
    <option value="cat-developer">── Developer (NIP-34) ──</option>
    <option value="30617">  kind-30617: Repository Announcement</option>
    <option value="31234">  kind-31234: Draft Event (NIP-37)</option>
    <option value="cat-webrtc">── WebRTC / Ephemeral ──</option>
    <option value="21647">  kind-21647: WebRTC Signaling</option>
    <option value="22416">  kind-22416: WebRTC Signaling</option>
    <option value="22811">  kind-22811: WebRTC Signaling</option>
    <option value="25050">  kind-25050: WebRTC/Peer Signaling</option>
    <option value="29333">  kind-29333: WebRTC Signaling</option>
    <option value="21111">  kind-21111: Ephemeral Sync</option>
    <option value="22651">  kind-22651: Ephemeral</option>
    <option value="20000">  kind-20000: Bitchat Geohash</option>
    <option value="20001">  kind-20001: Ephemeral Geohash</option>
    <option value="cat-connect">── Nostr Connect &amp; Wallet ──</option>
    <option value="24133">  kind-24133: Nostr Connect (NIP-46)</option>
    <option value="24242">  kind-24242: Blossom Media Server</option>
    <option value="13194">  kind-13194: NWC Wallet Info (NIP-47)</option>
    <option value="13196">  kind-13196: NWC Event</option>
    <option value="cat-social">── Social ──</option>
    <option value="9735">  kind-9735: Zap Receipt (NIP-57)</option>
    <option value="30078">  kind-30078: App-specific Data</option>
    <option value="31990">  kind-31990: Handler Information</option>
    <option value="cat-other">── Other / Unknown ──</option>
    <option value="30">  kind-30: Chess</option>
    <option value="60">  kind-60: Ride Sharing</option>
    <option value="443">  kind-443: Marmot KeyPackage</option>
    <option value="445">  kind-445: Marmot Group Event</option>
    <option value="1000">  kind-1000: Reserved</option>
    <option value="1009">  kind-1009: Unknown (seen in use)</option>
    <option value="4515">  kind-4515: Unknown (seen in use)</option>
    <option value="1808">  kind-1808: Unknown (seen in use)</option>
    <option value="1809">  kind-1809: Unknown (seen in use)</option>
    <option value="10007">  kind-10007: Unknown (seen in use)</option>
    <option value="10099">  kind-10099: Unknown (seen in use)</option>
    <option value="10100">  kind-10100: Unknown (seen in use)</option>
    <option value="11998">  kind-11998: Unknown (seen in use)</option>
    <option value="15750">  kind-15750: Unknown (seen in use)</option>
    <option value="23023">  kind-23023: Unknown (seen in use)</option>
    <option value="30081">  kind-30081: Unknown (seen in use)</option>
    <option value="30333">  kind-30333: Unknown (seen in use)</option>
    <option value="30515">  kind-30515: Unknown (seen in use)</option>
    <option value="31000">  kind-31000: Unknown (seen in use)</option>
    <option value="31991">  kind-31991: Unknown (seen in use)</option>
    <option value="34838">  kind-34838: Unknown (seen in use)</option>
    <option value="38225">  kind-38225: Unknown (seen in use)</option>
    <option value="38422">  kind-38422: Unknown (seen in use)</option>
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

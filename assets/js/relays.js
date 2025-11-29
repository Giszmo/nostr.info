---
permalink: /js/relays.js
layout: none
---

function shuffle(array) {
  var random = array.map(Math.random);
  array.sort(function(a, b) {
    return random[a] - random[b];
  });
}

let relays = [];
let discoveredRelays = new Map();
let tableSortColumn = 'status'; // Default sort by status (connected first)
let tableSortAscending = false; // Descending by default (connected first)

window.addEventListener('load', () => {
  // Support both the legacy `site.data.relays.wss` (array of host strings)
  // and the future structured `site.data.relays` (array of objects).
  const rawRelaysData = {{ site.data.relays | jsonify }};
  let relayEntries = [];
  if (Array.isArray(rawRelaysData)) {
    relayEntries = rawRelaysData;
  } else if (rawRelaysData && rawRelaysData.wss) {
    relayEntries = rawRelaysData.wss;
  } else {
    relayEntries = [];
  }

  relays = relayEntries.map(it=>{
    // allow strings (hostnames) and objects
    const src = (typeof it === 'string') ? { host: it } : it || {};
    const url = src.url || (src.host ? `wss://${src.host}` : (src.wss ? `wss://${src.wss}` : ''));
    return Object.assign({
      url,
    tried: -1,
    connected: false,
    answered: false,
    events: 0,
    wrongKind: 0,
    invalid: 0,
    msg: "",
    latencies: [],
    activeUsers: new Set(),
    eventsByKind: {},
    eventsList: [],
    connectedAt: null,
    firstEventAt: null,
    nip11: null,
      isDiscovered: false,
      // preserve any static metadata from `_data` if present
      _static: src
    })});
  relays.forEach(relay => discoveredRelays.set(relay.url, relay));
  shuffle(relays);
  relays.forEach((r, id) => { setupWs(r, id) });
  window.tab = document.getElementById("tab") || { value: "relays" };
  window.relayFilters = document.getElementById("relay-filters");
  // legacy filters (relay-filter, activity-filter, uptime-filter) removed
  window.nip11Nips = document.getElementById("nip11-nips");
  window.relaySort = document.getElementById("relay-sort");
  window.connectRelaysBtn = document.getElementById("connectNewRelays");
  window.eventFilters = document.getElementById("event-filters") || { hidden: true };
  window.kindFilter = document.getElementById("kind-filter") || { value: "all" };
  window.pubkeyFilter = document.getElementById("pubkey-filter") || {
    value: "",
    setAttribute: function(){},
    removeAttribute: function(){},
    focus: function(){},
  };
  window.degreeFilter = document.getElementById("degree-filter") || {
    value: "0",
    setAttribute: function(){},
    removeAttribute: function(){},
  };
  window.output = document.getElementById("output");
  window.expandedEvent = "";
  window.addEventListener('scroll', handleScrollStart, true);
  output.addEventListener('scroll', handleScrollStart);
});

function addDiscoveredRelay(url) {
  url = url.trim().toLowerCase();
  if (!url.startsWith('wss://')) return;
  if (discoveredRelays.has(url)) {
    const existingRelay = discoveredRelays.get(url);
    if (!existingRelay.isDiscovered) existingRelay.isDiscovered = true;
    return;
  }
  const newRelay = {
    url,
    tried: -1,
    connected: false,
    answered: false,
    events: 0,
    wrongKind: 0,
    invalid: 0,
    msg: "",
    latencies: [],
    activeUsers: new Set(),
    eventsByKind: {},
    eventsList: [],
    connectedAt: null,
    firstEventAt: null,
    nip11: null,
    isDiscovered: true
  };
  discoveredRelays.set(url, newRelay);
  relays.push(newRelay);
  setupWs(newRelay, relays.length - 1);
}

// Expose a simple API so header search can call into relays filtering
window.applyRelaySearch = function(query){
  try{
    window._relayTextFilter = (query || '').trim().toLowerCase();
    // Re-render the table if already on relays view
    if(document.querySelector('.relays-container')){
      // support common output IDs used by the template
      const output = document.getElementById('relays-output') || document.getElementById('output') || document.querySelector('.relays-container #output');
      if(output) output.innerHTML = relaysTable();
    }
  }catch(e){ console.error('applyRelaySearch failed', e); }
}

const LIMIT = 100 // how many events to show
const throttleMs = 500
var received = []
const meta = {}
const follows = {}

var tUpdate = 0
var isScrolling = false
var scrollTimeout = null

// Detect when user is scrolling and pause updates
function handleScrollStart() {
  isScrolling = true
  clearTimeout(scrollTimeout)
  scrollTimeout = setTimeout(() => {
    isScrolling = false
  }, 150) // User stopped scrolling for 150ms
}

function setDirty() {
  const t = ts()
  // ms since last scheduled update. Negative if in the future.
  const dt = t - tUpdate
  if (dt > 0) {
    // No update is scheduled for now or the future. Schedule one for at least
    // [throttleMs] ms after the prior one.
    tUpdate = Math.max(tUpdate + throttleMs, t)    
    setTimeout(() => {
      // Skip update if user is actively scrolling
      if (!isScrolling) {
        update()
      } else {
        // Reschedule for later
        setDirty()
      }
    }, tUpdate - t)
  }
}

function update() {
  const nearFuture = ts() / 1000 + 60 * 60
  received = received
    // near future
    .filter(it=>it.created_at<nearFuture)
    // newest first
    .sort( (a,b) => b.created_at - a.created_at )
    // clip to only LIMIT events
    .slice(0, LIMIT)

  // Save scroll position before updating
  const outputElement = output
  const scrollLeft = outputElement.scrollLeft
  const scrollTop = outputElement.scrollTop
  
  // Find any scrollable table wrapper and save its scroll position
  const tableWrapper = outputElement.querySelector('.relay-table-wrapper')
  const tableScrollLeft = tableWrapper ? tableWrapper.scrollLeft : 0
  const hasScrolled = tableScrollLeft > 0

  if (window.eventFilters) window.eventFilters.hidden = true
  if (relayFilters) relayFilters.hidden = false
  if (output) output.innerHTML = relaysTable()
  
  // Only restore scroll if user had scrolled before
  if (hasScrolled || scrollLeft > 0 || scrollTop > 0) {
    // Restore scroll position after updating - use immediate + RAF for reliability
    const newTableWrapper = outputElement.querySelector('.relay-table-wrapper')
    if (newTableWrapper && tableScrollLeft > 0) {
      // Set immediately
      newTableWrapper.scrollLeft = tableScrollLeft
      // Also set after next paint
      requestAnimationFrame(() => {
        if (newTableWrapper.scrollLeft !== tableScrollLeft) {
          newTableWrapper.scrollLeft = tableScrollLeft
        }
      })
      // Add scroll listener to this new wrapper
      newTableWrapper.addEventListener('scroll', handleScrollStart, { passive: true })
    }
    
    outputElement.scrollLeft = scrollLeft
    outputElement.scrollTop = scrollTop
  }
}

function connectRelays() {
  relays.forEach((r, id) => {
    if (r.tried < 0) {
      setupWs(r, id)
    }
  })
}

function sortRelaysTableBy(column) {
  if (tableSortColumn === column) {
    tableSortAscending = !tableSortAscending;
  } else {
    tableSortColumn = column;
    tableSortAscending = column === 'url'; // URL ascending by default, others descending
  }
  setDirty();
}

function relaysTable() {
  connectRelaysBtn.hidden = relays.filter(it=>it.tried<0).length === 0;
  
  // Start with all relays; legacy performance/activity/uptime filters removed
  // Allow text search filter from header via window._relayTextFilter
  let filteredRelays = relays.slice();
  if(window._relayTextFilter && window._relayTextFilter.length){
    const q = window._relayTextFilter.toLowerCase();
    filteredRelays = filteredRelays.filter(r => {
      const name = (r._static && r._static.name) ? String(r._static.name).toLowerCase() : '';
      const url = r.url ? String(r.url).toLowerCase() : '';
      const nip11 = r.nip11 ? JSON.stringify(r.nip11).toLowerCase() : '';
      return name.indexOf(q) !== -1 || url.indexOf(q) !== -1 || nip11.indexOf(q) !== -1;
    });
  }
  
  // (text search removed per request)

  // Supported NIPs filter
  const selectedNip = (nip11Nips && nip11Nips.value) ? nip11Nips.value : 'all';
  if (selectedNip && selectedNip !== 'all') {
    filteredRelays = filteredRelays.filter(r => {
      const nips = (r.nip11 && r.nip11.supported_nips) || (r._static && r._static.supported_nips) || [];
      return Array.isArray(nips) && nips.indexOf(parseInt(selectedNip)) !== -1;
    });
  }

  // Sorting (keep old sort dropdown logic)
  const sortBy = (relaySort && relaySort.value) ? relaySort.value : 'default';
  if (sortBy && sortBy !== 'default') {
    // helper to read limitation values from nip11 or static metadata
    function getLimitationValue(relay, key) {
      const lim = (relay.nip11 && relay.nip11.limitation) || (relay._static && relay._static.limitation) || {};
      if (!lim) return null;
      const v = lim[key];
      return (v === undefined) ? null : v;
    }

    filteredRelays.sort((a,b) => {
      switch(sortBy) {
        case 'latency': return ( (a.latencies.length>0 ? (a.latencies.reduce((s,v)=>s+v,0)/a.latencies.length) : Infinity) - (b.latencies.length>0 ? (b.latencies.reduce((s,v)=>s+v,0)/b.latencies.length) : Infinity) );
        case 'activeUsers': return (b.activeUsers.size || 0) - (a.activeUsers.size || 0);
        case 'payment_required': {
          const av = getLimitationValue(a, 'payment_required');
          const bv = getLimitationValue(b, 'payment_required');
          const an = av === true ? 1 : (av === false ? 0 : -1);
          const bn = bv === true ? 1 : (bv === false ? 0 : -1);
          return bn - an; // true first
        }
        case 'auth_required': {
          const av = getLimitationValue(a, 'auth_required');
          const bv = getLimitationValue(b, 'auth_required');
          const an = av === true ? 1 : (av === false ? 0 : -1);
          const bn = bv === true ? 1 : (bv === false ? 0 : -1);
          return bn - an; // true first
        }
        case 'max_limit': {
          const av = getLimitationValue(a, 'max_limit');
          const bv = getLimitationValue(b, 'max_limit');
          const an = (av === null) ? -Infinity : Number(av);
          const bn = (bv === null) ? -Infinity : Number(bv);
          return bn - an; // larger max first
        }
        case 'max_subscriptions': {
          const av = getLimitationValue(a, 'max_subscriptions');
          const bv = getLimitationValue(b, 'max_subscriptions');
          const an = (av === null) ? -Infinity : Number(av);
          const bn = (bv === null) ? -Infinity : Number(bv);
          return bn - an;
        }
        case 'created_at_lower_limit': {
          const av = getLimitationValue(a, 'created_at_lower_limit');
          const bv = getLimitationValue(b, 'created_at_lower_limit');
          const an = (av === null) ? -Infinity : Number(av);
          const bn = (bv === null) ? -Infinity : Number(bv);
          return bn - an;
        }
        default: return 0;
      }
    });
  }

  // Table column sorting
  filteredRelays.sort((a, b) => {
    let comparison = 0;
    
    switch(tableSortColumn) {
      case 'url':
        comparison = a.url.localeCompare(b.url);
        break;
      case 'status':
        const aStatus = a.tried < 0 ? 2 : (a.connected ? 0 : 1);
        const bStatus = b.tried < 0 ? 2 : (b.connected ? 0 : 1);
        comparison = aStatus - bStatus;
        break;
      case 'events':
        comparison = (a.events || 0) - (b.events || 0);
        break;
      case 'users':
        comparison = (a.activeUsers.size || 0) - (b.activeUsers.size || 0);
        break;
      case 'latency':
        const aLatency = a.latencies.length > 0 ? (a.latencies.reduce((s,v)=>s+v,0)/a.latencies.length) : Infinity;
        const bLatency = b.latencies.length > 0 ? (b.latencies.reduce((s,v)=>s+v,0)/b.latencies.length) : Infinity;
        comparison = aLatency - bLatency;
        break;
      case 'connected':
        const aTime = a.connectedAt || 0;
        const bTime = b.connectedAt || 0;
        comparison = aTime - bTime;
        break;
    }
    
    return tableSortAscending ? comparison : -comparison;
  });
  
  const tableRows = filteredRelays.map((r, idx)=>{
    // Find the original index in the relays array
    const originalIdx = relays.findIndex(relay => relay.url === r.url)
    
    const statusIcon = r.tried < 0
      ? `<span class="status-badge pending">{% fa_svg fas.fa-clock %}</span>`
      : r.connected
        ? `<span class="status-badge online">{% fa_svg fas.fa-circle-check %}</span>`
        : r.answered
          ? `<span class="status-badge offline">{% fa_svg fas.fa-circle-xmark %}</span>`
          : `<span class="status-badge offline">{% fa_svg fas.fa-circle-xmark %}</span>`;
    
    const avgLatency = r.latencies.length > 0 
      ? (r.latencies.reduce((sum, l) => sum + l, 0) / r.latencies.length).toFixed(0)
      : '-';
    
    const connectedTime = r.connectedAt 
      ? formatDuration(ts() - r.connectedAt)
      : '-';
    
    const activeUsers = r.activeUsers.size;
    
    // Get top 3 event kinds
    let topKindsStr = '-';
    if (r.eventsByKind && Object.keys(r.eventsByKind).length > 0) {
      const sortedKinds = Object.entries(r.eventsByKind)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([kind]) => kind);
      
      if (sortedKinds.length > 0) {
        topKindsStr = sortedKinds.join(', ');
        const remainingKinds = Object.keys(r.eventsByKind).length - 3;
        if (remainingKinds > 0) {
          topKindsStr += ` <small class="text-muted">+${remainingKinds}</small>`;
        }
      }
    }
    
    return `
      <tr onclick="showRelayDetails(${originalIdx})" style="cursor:pointer">
        <td class="text-center">${idx + 1}</td>
        <td><code>${r.url}</code></td>
        <td class="text-center">${statusIcon}</td>
        <td class="text-right">${r.events > 0 ? `<strong>${r.events}</strong>` : '0'}</td>
        <td class="text-right">${activeUsers > 0 ? activeUsers : '-'}</td>
        <td class="text-right">${avgLatency}${avgLatency !== '-' ? 'ms' : ''}</td>
        <td class="text-center">${connectedTime}</td>
        <td>${topKindsStr}</td>
      </tr>
    `;
  }).join('');
  
  const sortIndicator = (column) => {
    if (tableSortColumn !== column) return '';
    return tableSortAscending ? ' ▲' : ' ▼';
  };
  
  return `
    <div class="relays-table-container">
      <table class="relays-table">
        <thead>
          <tr>
            <th class="text-center">#</th>
            <th class="sortable" onclick="sortRelaysTableBy('url')">Relay URL${sortIndicator('url')}</th>
            <th class="text-center sortable" onclick="sortRelaysTableBy('status')">Status${sortIndicator('status')}</th>
            <th class="text-right sortable" onclick="sortRelaysTableBy('events')">Events${sortIndicator('events')}</th>
            <th class="text-right sortable" onclick="sortRelaysTableBy('users')">Active Users${sortIndicator('users')}</th>
            <th class="text-right sortable" onclick="sortRelaysTableBy('latency')">Avg Latency${sortIndicator('latency')}</th>
            <th class="text-center sortable" onclick="sortRelaysTableBy('connected')">Connected Time${sortIndicator('connected')}</th>
            <th>Top Kinds</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
    <div class="relay-info-notes">
      <p><sup>1</sup> Events count shows the number of events received after requesting ${LIMIT} most recent events. Events for metadata and follows are not included in this count.</p>
      <p><sup>2</sup> Status indicates current connection state: Connected (active), Disconnected (lost connection), Failed (never connected), or Pending (not yet attempted).</p>
    </div>
  <div style='margin:8px'>
    Total: ${relays.length} relays. ${relays.filter(r => r.connected).length} connected. ${relays.filter(r => r.events > 0).length} active.
  </div>`
}

function eventsTable() {
  const kindFiltered = filterByKind()
  const filtered = filterByPubkey(kindFiltered)
  
  return `${filtered.length}/${LIMIT} Events:<br>`
    + filtered.map(it => eventBadge(it)).join('<br>')
}

function filterByPubkey(list) {
  const pubkey = pubkeyFilter.value
  const degree = degreeFilter.value
  if (!pubkey) {
    return list
  }
  if (pubkey.length != 64) {
    return []
  }
  const followsByDegree = [new Set()]
  followsByDegree[0].add(pubkey)
  for (n=1; n<= degree; n++) {
    // determine the n-th degree of follows
    const f = new Set()
    followsByDegree[n - 1]
      .forEach(it => {
        (follows[it] || [])
          .forEach(x => f.add(x))
        })
    for (i=0; i<n; i++) {
      // store each pubkey only in the lowest degree
      followsByDegree[i].forEach(it => f.delete(it))
    }
    followsByDegree[n] = f
  }
  return list.map(it => {
    it.degree = followsByDegree.findIndex(x => x.has(it.pubkey))
    return it
  }).filter(e => e.degree >= 0)
}

function filterByKind() {
  const kind = kindFilter.value
  if (kind === 'all') {
    return received
  } else if (kind === 'unknown') {
    const knownKinds = [0,1,2,3,4,5,6,7,30,40,41,42,43,44,60]
    return received.filter(ev => !knownKinds.includes(ev.kind))
  } else {
    return received.filter(it => it.kind == kind)
  }
}

function setPubkey(pubkey) {
  pubkeyFilter.value=pubkey
  setDirty()
}

function nameFromPubkey(pubkey) {
  const m = meta[pubkey]
  const img = (m && m.picture) || '/assets/smallNoicon.png'
  const name = (m && m.name) || pubkey || 'unknown'
  return `<span class="meta" onclick="setPubkey('${pubkey}')">
  <img src="${img}">&nbsp;${escapeHTML(name)}
</span>`
}

function setExpand(id) {
  expandedEvent = id
  setDirty()
}

function rawEventWidget(event) {
  // TODO: show copy button which copies without pretty-print
  const e = JSON.stringify(
    event,
    (key, value) => {
      if (["relays"].includes(key)) {
        return undefined
      }
      return value
    },
    2)
  const eRelays = '<table><tr><td>#</td><td>Relay</td><td>dt</td><td>event #<sup>1</sup></td></tr>' +
    event.relays.map((it,i)=>`<tr><td>${i+1}</td><td>${relays[it.id].url.slice(6)}</td><td>${
    i==0
      ? 'first'
      : `+${it.timeMs - event.relays[0].timeMs}ms`
    }</td><td>${it.count}</td></tr>`).join('') +
    '<tr><td colspan="4"><sup>1</sup>The n-th event processed from this relay.</td></tr></table>'
  
  return `<br>Received in this order from:${eRelays}<pre>${escapeHTML(e)}</pre>`
}

function getKindName(kind) {
  const kindNames = {
    0: 'Metadata',
    1: 'Text Note',
    2: 'Relay Recommendation',
    3: 'Contacts',
    4: 'Encrypted Direct Message',
    5: 'Event Deletion',
    6: 'Repost',
    7: 'Reaction',
    30: 'Chess (PGN)',
    40: 'Channel Creation',
    41: 'Channel Metadata',
    42: 'Channel Message',
    43: 'Channel Hide Message',
    44: 'Channel Mute User',
    60: 'Ride Sharing',
    1059: 'Gift Wrap',
    1984: 'Reporting',
    9734: 'Zap Request',
    9735: 'Zap',
    10000: 'Mute List',
    10001: 'Pin List',
    10002: 'Relay List Metadata',
    22820: 'WebRTC Connection',
    22955: 'WebRTC Signaling',
    30000: 'Categorized People',
    30001: 'Categorized Bookmarks',
    30023: 'Long-form Content'
  }
  return kindNames[kind] || `Kind ${kind}`
}

function formatEventContent(event, maxLength = 200) {
  const content = event.content
  
  // Truncate very long content
  if (content.length > maxLength) {
    return escapeHTML(content.substring(0, maxLength)) + '...'
  }
  
  // Try to parse JSON content
  try {
    const parsed = JSON.parse(content)
    const jsonStr = JSON.stringify(parsed, null, 2)
    if (jsonStr.length > maxLength) {
      return `<details class="json-content"><summary>View JSON content (${jsonStr.length} chars)</summary><pre>${escapeHTML(jsonStr)}</pre></details>`
    }
    return `<details class="json-content"><summary>View JSON content</summary><pre>${escapeHTML(jsonStr)}</pre></details>`
  } catch(e) {
    // Not JSON, return as-is with truncation
    if (content.length > maxLength) {
      return escapeHTML(content.substring(0, maxLength)) + '...'
    }
    return escapeHTML(content)
  }
}

function formatTags(tags) {
  if (!tags || tags.length === 0) return ''
  
  const tagSummary = tags.map(tag => {
    const [type, value, ...rest] = tag
    const truncatedValue = value && value.length > 50 ? value.substring(0, 50) + '...' : value
    switch(type) {
      case 'p': return `<span class="tag tag-p" title="Pubkey: ${value}">👤 @${value.substring(0, 8)}...</span>`
      case 'e': return `<span class="tag tag-e" title="Event: ${value}">📝 Event: ${value.substring(0, 8)}...</span>`
      case 't': return `<span class="tag tag-t">#${escapeHTML(value || '')}</span>`
      case 'r': return `<span class="tag tag-r" title="${escapeHTML(value || '')}">🔗 ${escapeHTML(truncatedValue || '')}</span>`
      case 'bolt11': return `<span class="tag tag-other" title="${escapeHTML(value || '')}">bolt11: ${escapeHTML(value ? value.substring(0, 12) : '')}...</span>`
      case 'description': return `<span class="tag tag-other">description: ${escapeHTML(value ? value.substring(0, 20) : '')}...</span>`
      case 'preimage': return `<span class="tag tag-other">preimage: ${escapeHTML(value ? value.substring(0, 12) : '')}...</span>`
      default: {
        const displayValue = value ? (value.length > 20 ? value.substring(0, 20) + '...' : value) : ''
        return `<span class="tag tag-other" title="${escapeHTML(type)}: ${escapeHTML(value || '')}">${escapeHTML(type)}: ${escapeHTML(displayValue)}</span>`
      }
    }
  }).join(' ')
  
  return `<div class="event-tags">${tagSummary}</div>`
}

function eventBadge(event) {
  const degree = pubkeyFilter.value ? `<span class="degree-badge">D=${event.degree}</span> ` : '';
  const pubkey = event.pubkey || '';
  const profile = meta[pubkey] || {};
  const profileName = profile.name ? escapeHTML(profile.name) : pubkey.substring(0, 8);
  const profilePic = profile.picture ? `<img src="${escapeHTML(profile.picture)}" alt="profile" style="width:32px;height:32px;border-radius:50%;margin-right:0.5em;vertical-align:middle">` : '';
  const expandCollapse = (event.id === expandedEvent)
    ? `<span class='collapse' onclick='setExpand("")'>▼ </span>`
    : `<span class='expand' onclick='setExpand("${event.id}")'>▶ </span>`;
  const kindBadge = `<span class="kind-badge kind-${event.kind}" title="${getKindName(event.kind)}">${event.kind}</span>`;
  const timestamp = `<span class="event-time">${timeFormat(event.created_at)}</span>`;
  var badge = `<div class="event-card kind-${event.kind}">
    <div class="event-header" style="display:flex;align-items:center;gap:0.5em;">
      ${expandCollapse}${kindBadge} ${timestamp} ${degree}${profilePic}<span style="font-weight:600">${profileName}</span>
    </div>
    <div class="event-body">`;
    
  switch (event.kind) {
    case 0: {
        try {
          const metadata = JSON.parse(event.content)
          badge += `<strong>📝 Updated profile metadata:</strong><br>`
          if (metadata.name) badge += `Name: ${escapeHTML(metadata.name)}<br>`
          if (metadata.about) badge += `About: ${escapeHTML(metadata.about)}<br>`
          if (metadata.picture) badge += `Picture: <img src="${escapeHTML(metadata.picture)}" style="max-width:50px;max-height:50px;vertical-align:middle"><br>`
        } catch(e) {
          badge += `Updated metadata (invalid JSON)`
        }
        break
      }
    case 1: {
        const truncatedContent = event.content.length > 300 ? event.content.substring(0, 300) + '...' : event.content
        badge += `<div class="text-content">${escapeHTML(truncatedContent)}</div>`
        break
      }
    case 2: {
        badge += `📡 Recommends relay: <code>${escapeHTML(event.content)}</code>`
        break
      }
    case 3: {
        badge += `👥 Shared contact list with <strong>${event.tags.filter(t => t[0] === 'p').length}</strong> follows`
        break
      }
    case 4: {
        const pTag = event.tags.find(it=>it[0] === 'p')
        const recipientPubkey = pTag && pTag[1]
        const recipient = recipientPubkey ? ` to ${nameFromPubkey(recipientPubkey)}` : ''
        badge += `🔒 Encrypted Direct Message${recipient}<br><em>Length: ${event.content.length} chars (encrypted)</em>`
        break
      }
    case 5: {
        const eTag = event.tags.find(t => t[0] === 'e')
        badge += `🗑️ Deletion request${eTag ? ` for event <code>${eTag[1].substring(0, 16)}...</code>` : ''}`
        break
      }
    case 6: {
        const eTag = event.tags.find(t => t[0] === 'e')
        badge += `🔄 Reposted${eTag ? ` event <code>${eTag[1].substring(0, 16)}...</code>` : ' an event'}`
        if (event.content) badge += `<br>Comment: ${escapeHTML(event.content)}`
        break
      }
    case 7: {
        const reaction = event.content || '👍'
        const eTag = event.tags.find(t => t[0] === 'e')
        badge += `${escapeHTML(reaction)} Reacted${eTag ? ` to event <code>${eTag[1].substring(0, 16)}...</code>` : ''}`
        break
      }
    case 30: {
        badge += `♟️ Chess move (PGN):<br><code>${escapeHTML(event.content.substring(0, 200))}</code>`
        break
      }
    case 40: {
        try {
          const content = JSON.parse(event.content)
          badge += `📢 Created channel: <strong>${escapeHTML(content.name || 'Unnamed')}</strong>`
          if (content.about) badge += `<br>${escapeHTML(content.about)}`
        } catch(e) {
          badge += `📢 Created a channel`
        }
        break
    }
    case 41: {
        badge += `⚙️ Updated channel metadata`
        break
    }
    case 42: {
        const eTag = event.tags.find(tag => tag[0] === 'e')
        badge += `💬 Channel message${eTag ? ` in <code>${eTag[1].substring(0, 16)}...</code>` : ''}<br>`
        badge += `<div class="text-content">${escapeHTML(event.content.substring(0, 300))}</div>`
        break
    }
    case 43: {
        try {
          const content = JSON.parse(event.content)
          badge += `🚫 Hid message${content.reason ? `: ${escapeHTML(content.reason)}` : ''}`
        } catch(e) {
          badge += `🚫 Hid a message`
        }
        break
    }
    case 44: {
        const pTag = event.tags.find(tag => tag[0] === 'p')
        const mutedPubkey = pTag && pTag[1]
        try {
          const content = JSON.parse(event.content)
          badge += `🔇 Muted user${mutedPubkey ? ` ${nameFromPubkey(mutedPubkey)}` : ''}${content.reason ? `: ${escapeHTML(content.reason)}` : ''}`
        } catch(e) {
          badge += `🔇 Muted a user`
        }
        break
    }
    case 60: {
        badge += `🚗 Ride sharing: ${formatEventContent(event)}`
        break
      }
    case 1059: {
        const pTag = event.tags.find(t => t[0] === 'p')
        badge += `🎁 Gift Wrapped message${pTag ? ` for ${nameFromPubkey(pTag[1])}` : ''}<br>`
        badge += `<em>Encrypted payload (${event.content.length} chars)</em>`
        break
      }
    case 1984: {
        badge += `🚨 Reported content`
        break
      }
    case 9734: {
        badge += `⚡ Zap request`
        break
      }
    case 9735: {
        const bolt11Tag = event.tags.find(t => t[0] === 'bolt11')
        const descTag = event.tags.find(t => t[0] === 'description')
        const preimageTag = event.tags.find(t => t[0] === 'preimage')
        badge += `⚡ <strong>Zap Receipt</strong>`
        if (bolt11Tag) {
          const bolt11 = bolt11Tag[1]
          badge += `<br>Payment: <code>${escapeHTML(bolt11.substring(0, 20))}...</code>`
        }
        if (descTag) {
          try {
            const desc = JSON.parse(descTag[1])
            if (desc.amount) {
              const sats = desc.amount / 1000
              badge += `<br>Amount: ${sats} sats`
            }
          } catch(e) {}
        }
        if (preimageTag) {
          badge += `<br>Preimage: <code>${escapeHTML(preimageTag[1].substring(0, 16))}...</code>`
        }
        break
      }
    case 10002: {
        const relayTags = event.tags.filter(t => t[0] === 'r')
        badge += `📡 <strong>Relay List Metadata</strong> (${relayTags.length} relays)<br>`
        if (relayTags.length > 0) {
          const relayList = relayTags.slice(0, 3).map(t => `<code>${escapeHTML(t[1])}</code>`).join(', ')
          badge += relayList
          if (relayTags.length > 3) badge += ` and ${relayTags.length - 3} more...`
        }
        break
      }
    case 22820: {
        badge += `🔗 <strong>WebRTC Connection</strong><br>`
        const xTag = event.tags.find(t => t[0] === 'x')
        if (xTag) badge += `Connection ID: <code>${escapeHTML(xTag[1])}</code><br>`
        badge += `<div class="text-content">${formatEventContent(event, 100)}</div>`
        break
      }
    case 22955: {
        badge += `📞 <strong>WebRTC Signaling</strong><br>`
        try {
          const data = JSON.parse(event.content)
          if (data.peerId) badge += `Peer ID: <code>${escapeHTML(data.peerId.substring(0, 16))}...</code><br>`
          if (data.offer) badge += `Type: ${escapeHTML(data.offer.type)}<br>`
        } catch(e) {}
        const xTag = event.tags.find(t => t[0] === 'x')
        if (xTag) badge += `Connection ID: <code>${escapeHTML(xTag[1])}</code>`
        break
      }
    case 30001: {
        badge += `🔖 <strong>Categorized Bookmarks</strong><br>`
        const dTag = event.tags.find(t => t[0] === 'd')
        if (dTag && dTag[1]) badge += `Category: <strong>${escapeHTML(dTag[1])}</strong><br>`
        const bookmarkTags = event.tags.filter(t => t[0] === 'e' || t[0] === 'a')
        badge += `Bookmarks: ${bookmarkTags.length} items`
        break
      }
    case 30023: {
        badge += `📄 <strong>Long-form Content</strong><br>`
        const titleTag = event.tags.find(t => t[0] === 'title')
        if (titleTag) badge += `<strong>${escapeHTML(titleTag[1])}</strong><br>`
        const summaryTag = event.tags.find(t => t[0] === 'summary')
        if (summaryTag) {
          badge += `<em>${escapeHTML(summaryTag[1])}</em><br>`
        } else if (event.content) {
          const preview = event.content.substring(0, 200)
          badge += `<div class="text-content">${escapeHTML(preview)}${event.content.length > 200 ? '...' : ''}</div>`
        }
        break
      }
    case 22955: {
        badge += `📞 WebRTC Signaling Event<br>`
        badge += `<div class="text-content">${formatEventContent(event, 150)}</div>`
        break
      }
    default: {
        badge += `<strong>⚠️ Unhandled Event Type: ${getKindName(event.kind)}</strong><br>`
        badge += `<div class="text-content">${formatEventContent(event, 150)}</div>`
        break
      }
  }
  
  badge += `</div>` // Close event-body
  
  // Add tags display
  if (event.tags && event.tags.length > 0) {
    badge += formatTags(event.tags)
  }
  
  badge += `</div>` // Close event-card
  
  return badge + (event.id === expandedEvent ? rawEventWidget(event) : '')
}

const ts = () => (new Date()).getTime()

function testNip11(relay) {
  const httpUrl = 'https' +  relay.url.slice(3)
  fetch(httpUrl, {
    headers: {
      Accept: "application/nostr+json"
    }
  }).then(it => {
    it.json().then(it => {
  relay.nip11 = it
  // Update global NIP-11 options (supported NIPs) when we get new info
  try { updateNip11Options(); } catch(e) {}
  try { setDirty(); } catch(e) {}
      // Optionally, set a flag for UI if needed
    }).catch(err => {
      relay.nip11 = null
      if (window.location.search.includes('debug')) console.warn('NIP-11 JSON parse error:', err)
    })
  }).catch(err => {
    relay.nip11 = null
    if (window.location.search.includes('debug')) console.warn('NIP-11 fetch error:', err)
  })
}

function setupWs(relay, id) {
  testNip11(relay)
  const ws = new WebSocket(relay.url)
  relay.ws = ws
  relay.tried = ts()
  const reqSentAt = {} // track when REQ was sent for latency calculation
  ws.onmessage = msg => {
    var arr
    setDirty()
    try {
      arr = JSON.parse(msg.data)
    } catch (e) {
      console.log(`${relay.url} sent weird msg "${msg.data}".`)
      return
    }
    if (arr[0] === 'EVENT') {
      const event = arr[2]
      const subId = arr[1]
      
      // Track latency for first event in each subscription
      if (reqSentAt[subId] && relay.latencies.length < 100) {
        relay.latencies.push(ts() - reqSentAt[subId])
        delete reqSentAt[subId]
      }
      
      // Track first event timestamp
      if (!relay.firstEventAt) {
        relay.firstEventAt = ts()
      }
      
      // Track active users
      if (event.pubkey) {
        relay.activeUsers.add(event.pubkey)
      }
      
      // Track events by kind
      if (event.kind !== undefined) {
        relay.eventsByKind[event.kind] = (relay.eventsByKind[event.kind] || 0) + 1
        // Store the actual event (limit to last 100 per relay)
        if (!relay.eventsList) relay.eventsList = []
        relay.eventsList.unshift(event)
        if (relay.eventsList.length > 100) {
          relay.eventsList = relay.eventsList.slice(0, 100)
        }
      }
      
      if (arr[1] === "main") {
        relay.events++
      }
      const prior = received.find(e=>e.id==event.id)
      if (prior) {
        if (0 > prior.relays.findIndex(i=>i.id==id)) {
          prior.relays.push({id: id,count:relay.events,timeMs:ts()})
        }
        if (arr[1] === "main") {
          return // this event was handled by main already
        }
      }
      switch (arr[1]) {
        case 'meta':
          if (event.kind === 0) {
            try {
              const m = JSON.parse(event.content)
              meta[event.pubkey] = m
            } catch(e) {
              console.log(`Should "${escapeHTML(event.content)}" be valid JSON?`)
            }
          } else {
            relay.wrongKind++
            relay.msg = msg.data
          }
          break
        case 'follows':
          if (event.kind === 3) {
            follows[event.pubkey] = event.tags.filter(it => it[0] === "p").map(it => it[1])
          } else {
            relay.wrongKind++
            relay.msg = msg.data
          }
          break
        case 'relays':
          if (event.kind === 2) {
            const ipRegExp = /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/g;
            let relayUrl = event.content.replace(/(\n|\r|\t|\/| )+$/, '').replace(/^(\n|\r|\t| )+/, '').toLowerCase();
            if (relayUrl.includes('localhost') || ipRegExp.test(relayUrl)) break;
            addDiscoveredRelay(relayUrl);
          } else {
            relay.wrongKind++;
            relay.msg = msg.data;
          }
          break
        case 'main':
          event.relays = [{id: id,count:relay.events,timeMs:ts()}]
          if (!event.tags) {
            relay.invalid++
            relay.msg = msg.data
            console.log(`${relay.url} sent event with no tags.`)
            event.tags = []
          }
          received.push(event)
          break
      }
    } else if (arr[0] === 'EOSE') {
      if (['meta','follows','relays'].includes(arr[1])) {
        ws.send(`["CLOSE","${arr[1]}"]`)
      }
    } else {
      console.log(`Unexpected command ${arr[0]}`)
    }
  }
  ws.onclose = () => {
    relay.connected = false
    relay.connectedAt = null
    setDirty()
    console.log(`${relay.url} disconnected.`)
  }
  ws.onerror = (e) => {
    relay.connected = false
    relay.connectedAt = null
    setDirty()
    console.log(`${relay.url} had an error: ${JSON.stringify(e)}`)
  }
  ws.onopen = event => {
    relay.connected = true
    relay.answered = true
    relay.connectedAt = ts()
    setDirty()
    reqSentAt['main'] = ts()
    ws.send(`["REQ","main",{"limit":${LIMIT},"until":${(ts() / 1000 + 60 * 60).toFixed()}}]`)
    reqSentAt['meta'] = ts()
    ws.send('["REQ","meta",{"kinds":[0]}]')
    reqSentAt['follows'] = ts()
    ws.send('["REQ","follows",{"kinds":[3]}]')
    reqSentAt['relays'] = ts()
    ws.send('["REQ","relays",{"kinds":[2]}]')
  }
}

Number.prototype.pad = function(size) {
    var s = String(this);
    while (s.length < (size || 2)) {s = "0" + s;}
    return s;
}

function timeFormat(ts) {
  let d = new Date(ts * 1000)
  return `${d.getYear()-100}-${(d.getMonth()+1).pad(2)}-${(d.getDate()).pad(2)} ` +
         `${d.getHours().pad(2)}:${d.getMinutes().pad(2)}:${d.getSeconds().pad(2)}`
}

function escapeHTML(str){
  var p = document.createElement("p");
  p.appendChild(document.createTextNode(str));
  return p.innerHTML;
}

function guessClient(event) {
  if (event.tags.find(i => i[0] === 'client' && i[1] === 'more-speech')) {
    return '<a href="https://github.com/unclebob/more-speech">more-speech</a>'
  }
  return null
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function showRelayDetails(idx, selectedKind = null) {
  const relay = relays[idx]
  
  if (selectedKind !== null) {
    // Show events of the selected kind
    showRelayEventsByKind(idx, selectedKind)
    return
  }
  
  const eventKinds = Object.entries(relay.eventsByKind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => {
      const kindName = getKindName(parseInt(kind))
      return `<tr class="kind-row" onclick="event.stopPropagation(); showRelayDetails(${idx}, ${kind})">
        <td><strong>${kindName}</strong> (${kind})</td>
        <td>${count}</td>
      </tr>`
    })
    .join('')
  
  const avgLatency = relay.latencies.length > 0 
    ? (relay.latencies.reduce((sum, l) => sum + l, 0) / relay.latencies.length).toFixed(0)
    : 'N/A'
  
  const modalHtml = `
    <div id="relay-modal" onclick="closeRelayModal(event)">
      <div class="modal-content" onclick="event.stopPropagation()">
        <span class="close" onclick="closeRelayModal()">&times;</span>
        ${relay.nip11 ? `
          <div class="nip11-info modern-modal" style="margin-bottom:2em;">
            ${relay.nip11.banner ? `<div class="nip11-banner"><img src="${escapeHTML(relay.nip11.banner)}" alt="Relay Banner" style="max-width:100%;border-radius:8px;margin-bottom:1em"></div>` : '<div class="nip11-banner" style="height:40px;background:#eee;border-radius:8px;margin-bottom:1em;text-align:center;line-height:40px;color:#aaa">No banner</div>'}
            <div style="display:flex;align-items:center;gap:1em;margin-bottom:1em">
              ${relay.nip11.icon ? `<img src="${escapeHTML(relay.nip11.icon)}" alt="Relay Icon" class="nip11-icon" style="width:48px;height:48px;border-radius:50%;">` : '<span class="nip11-icon" style="width:48px;height:48px;display:inline-block;background:#eee;border-radius:50%;text-align:center;line-height:48px;color:#aaa">No icon</span>'}
              <div>
                <div style="font-size:1.3em;font-weight:600;">${relay.nip11.name ? escapeHTML(relay.nip11.name) : '<span style="color:#aaa">Unknown</span>'}</div>
                ${relay.nip11.software ? `<div style="font-size:0.95em;color:#666">${escapeHTML(relay.nip11.software)}</div>` : ''}
                ${relay.nip11.version ? `<div style="font-size:0.95em;color:#666">v${escapeHTML(relay.nip11.version)}</div>` : ''}
              </div>
            </div>
            ${relay.nip11.description ? `<div style="margin-bottom:1em;color:#444">${escapeHTML(relay.nip11.description)}</div>` : ''}
            ${relay.nip11.pubkey ? `<div style="margin-bottom:0.5em"><strong>Pubkey:</strong> <code>${escapeHTML(relay.nip11.pubkey)}</code></div>` : ''}
            ${relay.nip11.contact ? `<div style="margin-bottom:0.5em"><strong>Contact:</strong> <a href="${escapeHTML(relay.nip11.contact)}" target="_blank">${escapeHTML(relay.nip11.contact)}</a></div>` : ''}
            ${relay.nip11.limitation ? `<div style="margin-bottom:0.5em"><strong>Limitations:</strong><ul style='margin:0.5em 0 0 1em;padding:0;list-style:disc;'>${Object.entries(relay.nip11.limitation).map(([k,v]) => `<li><span style='font-weight:500'>${escapeHTML(k)}</span>: <span style='color:#007bff'>${escapeHTML(String(v))}</span></li>`).join('')}</ul></div>` : ''}
            ${relay.nip11.retention ? `<div style="margin-bottom:0.5em"><strong>Retention:</strong> <code>${escapeHTML(JSON.stringify(relay.nip11.retention,null,2))}</code></div>` : ''}
            ${relay.nip11.payment_url ? `<div style="margin-bottom:0.5em"><strong>Payment URL:</strong> <a href="${escapeHTML(relay.nip11.payment_url)}" target="_blank">${escapeHTML(relay.nip11.payment_url)}</a></div>` : ''}
            ${relay.nip11.bolt11 ? `<div style="margin-bottom:0.5em"><strong>Payment (bolt11):</strong> <code>${escapeHTML(relay.nip11.bolt11)}</code></div>` : ''}
            ${relay.nip11.supported_nips ? `<div style="margin-bottom:0.5em"><strong>Supported NIPs:</strong> <span class="nip11-nips">${relay.nip11.supported_nips.map(nip => `<span class="nip-badge">NIP-${nip}</span>`).join(' ')}</span></div>` : ''}
            <details style="margin-top:1em"><summary>Raw NIP-11 JSON</summary><pre style="background:#f8f9fa;border-radius:6px;padding:8px;font-size:12px;overflow-x:auto">${escapeHTML(JSON.stringify(relay.nip11,null,2))}</pre></details>
          </div>
        ` : ''}
        <h2>${relay.url}</h2>
        <div class="relay-stats">
          <div class="stat-item">
            <div class="stat-label">Status</div>
            <div class="stat-value ${relay.connected ? 'online' : 'offline'}">
              ${relay.connected ? 'Online' : 'Offline'}
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Events Seen</div>
            <div class="stat-value">${relay.events}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Active Users</div>
            <div class="stat-value">${relay.activeUsers.size}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Avg Latency</div>
            <div class="stat-value">${avgLatency}ms</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Connected Time</div>
            <div class="stat-value">${relay.connectedAt ? formatDuration(ts() - relay.connectedAt) : 'N/A'}</div>
          </div>
        </div>
        <h3>Event Kinds Breakdown <small style="color:#6c757d">(Click to view events)</small></h3>
        <div class="kinds-table-container">
          <table class="kinds-table">
            <thead><tr><th>Kind</th><th>Count</th></tr></thead>
            <tbody>
              ${eventKinds.length > 0 ? eventKinds : '<tr><td colspan="2">No events received yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
  
  const existingModal = document.getElementById('relay-modal')
  if (existingModal) {
    existingModal.remove()
  }
  
  document.body.insertAdjacentHTML('beforeend', modalHtml)
}

function showRelayEventsByKind(idx, kind) {
  const relay = relays[idx]
  const kindInt = parseInt(kind)
  const kindName = getKindName(kindInt)
  
  // Filter events by kind
  const eventsOfKind = (relay.eventsList || []).filter(e => e.kind === kindInt)
  
  let infoMsg = '';
  if (eventsOfKind.length === 0) {
    infoMsg = '<p style="text-align:center;color:#6c757d;padding:2rem">No events of this kind found</p>';
  } else if (relay.eventsByKind && relay.eventsByKind[kind]) {
    if (relay.eventsByKind[kind] > 0 && eventsOfKind.length === 0) {
      infoMsg = `<p style="text-align:center;color:#d9534f;padding:1rem">${relay.eventsByKind[kind]} events of this kind were tallied, but none are available to show. Only the most recent events are stored.</p>`;
    } else if (relay.eventsByKind[kind] > eventsOfKind.length) {
      infoMsg = `<p style="text-align:center;color:#888;padding:0.5rem">Showing the most recent ${eventsOfKind.length} of ${relay.eventsByKind[kind]} events.</p>`;
    }
  }
  const eventsHtml = eventsOfKind.length > 0
    ? infoMsg + eventsOfKind.slice(0, 20).map(event => {
        const shortId = event.id ? event.id.substring(0, 8) : 'unknown';
        const timestamp = timeFormat(event.created_at);
        const pubkey = event.pubkey || '';
        const pubkeyShort = pubkey.substring(0, 8);
        // Try to get metadata for pubkey
        const profile = meta[pubkey] || {};
        const profileName = profile.name ? escapeHTML(profile.name) : pubkeyShort;
        const profilePic = profile.picture ? `<img src="${escapeHTML(profile.picture)}" alt="profile" style="width:32px;height:32px;border-radius:50%;margin-right:0.5em;vertical-align:middle">` : '';
        const contentPreview = event.content.length > 100 
          ? escapeHTML(event.content.substring(0, 100)) + '...'
          : escapeHTML(event.content);
        const tagsHtml = event.tags && event.tags.length > 0
          ? `<div class="event-tags-preview">Tags: ${event.tags.map(tag => `<span class="event-tag" style="background:#eee;border-radius:4px;padding:2px 6px;margin:2px;display:inline-block;font-size:0.95em">${escapeHTML(tag.join(':'))}</span>`).join(' ')}</div>`
          : '';
        return `
          <div class="relay-event-card" style="margin-bottom:1em;padding:1em;border-radius:8px;background:#fafbfc;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
            <div class="event-meta" style="display:flex;align-items:center;gap:0.5em;margin-bottom:0.5em">
              ${profilePic}
              <span class="event-pubkey" title="${event.pubkey}" style="font-weight:600">${profileName}</span>
              <span class="event-timestamp" style="margin-left:auto;color:#888">${timestamp}</span>
            </div>
            <!-- ID hidden for cleaner look -->
            ${event.content ? `<div class="event-content-preview" style="margin-bottom:0.5em;color:#333">${contentPreview}</div>` : ''}
            ${tagsHtml}
          </div>
        `;
      }).join('')
    : infoMsg;
  
  const modalHtml = `
    <div id="relay-modal" onclick="closeRelayModal(event)">
      <div class="modal-content" onclick="event.stopPropagation()">
        <span class="close" onclick="closeRelayModal()">&times;</span>
        <button class="back-button" onclick="showRelayDetails(${idx})">← Back to Relay Overview</button>
        <h2>${relay.url}</h2>
        <h3>${kindName} Events (${eventsOfKind.length} total${eventsOfKind.length > 20 ? ', showing first 20' : ''})</h3>
        
        <div class="relay-events-container">
          ${eventsHtml}
        </div>
      </div>
    </div>
  `
  
  const existingModal = document.getElementById('relay-modal')
  if (existingModal) {
    existingModal.remove()
  }
  
  document.body.insertAdjacentHTML('beforeend', modalHtml)
}

function closeRelayModal(event) {
  const modal = document.getElementById('relay-modal')
  if (modal && (!event || event.target === modal)) {
    modal.remove()
  }
}

// Populate the Supported NIPs select from available NIP-11 data and `_static` entries.
function updateNip11Options() {
  if (!nip11Nips) return;
  const seen = new Set();
  relays.forEach(r => {
    const nips = (r._static && r._static.supported_nips) || (r.nip11 && r.nip11.supported_nips) || [];
    if (Array.isArray(nips)) nips.forEach(n => seen.add(String(n)));
  });
  // Remove existing non-default options
  for (let i = nip11Nips.options.length - 1; i >= 0; i--) {
    if (nip11Nips.options[i].value === 'all') continue;
    nip11Nips.remove(i);
  }
  const sorted = Array.from(seen).map(Number).filter(n=>!Number.isNaN(n)).sort((a,b)=>a-b);
  sorted.forEach(n => {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.text = `NIP-${n}`;
    nip11Nips.appendChild(opt);
  });
}

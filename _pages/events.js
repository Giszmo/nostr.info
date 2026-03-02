---
permalink: /js/events.js
layout: none
---

function shuffle(array) {
  var random = array.map(Math.random);
  array.sort(function(a, b) {
    return random[a] - random[b];
  });
}

window.addEventListener('load', () => {
  window.relays = {{ site.data.relays.wss | jsonify }}.map(it=>{ return {
    url: `wss://${it}`,
    tried: -1, // we tried to connect it
    connected: false, // currently connected
    answered: false, // was connected in the past
    events: 0, // event counter
    wrongKind: 0, // count unexpected events
    invalid: 0, // events with missing parts
    msg: ""
  }})
  shuffle(relays)
  relays.forEach((r, id) => { setupWs(r, id) })
  window.eventFilters = document.getElementById("event-filters")
  window.kindFilter = document.getElementById("kind-filter")
  window.pubkeyFilter = document.getElementById("pubkey-filter")
  window.degreeFilter = document.getElementById("degree-filter")
  window.output = document.getElementById("output")
  window.stopBtn = document.getElementById("stop-btn")
  window.expandedEvent = ""
  // Apply URL params to filters
  applyUrlParams()
})

function applyUrlParams() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('kind')) {
    const v = params.get('kind')
    // Check if the value exists as an option
    if ([...kindFilter.options].some(o => o.value === v)) {
      kindFilter.value = v
    }
  }
  if (params.has('pubkey')) {
    pubkeyFilter.value = params.get('pubkey')
  }
  if (params.has('degree')) {
    degreeFilter.value = params.get('degree')
  }
}

function updateUrl() {
  const params = new URLSearchParams()
  if (kindFilter.value !== 'all') {
    params.set('kind', kindFilter.value)
  }
  if (pubkeyFilter.value) {
    params.set('pubkey', pubkeyFilter.value)
  }
  if (pubkeyFilter.value && degreeFilter.value !== '0') {
    params.set('degree', degreeFilter.value)
  }
  const qs = params.toString()
  const newUrl = window.location.pathname + (qs ? '?' + qs : '')
  window.history.replaceState(null, '', newUrl)
}

const DISPLAY_LIMIT = 100 // how many events to show after filtering
const PER_KIND_LIMIT = 100 // how many events to keep per kind
const throttleMs = 500
var receivedByKind = {} // kind -> array of events, max PER_KIND_LIMIT each
var receivedById = {} // id -> event reference, for fast dedup
var isStopped = false

function getReceived() {
  // Flatten all per-kind buckets into one array
  return Object.values(receivedByKind).flat()
}

function storeEvent(event) {
  const k = event.kind
  if (!receivedByKind[k]) receivedByKind[k] = []
  receivedByKind[k].push(event)
  receivedById[event.id] = event
  // Trim this kind's bucket if over limit (drop oldest by _firstSeen)
  if (receivedByKind[k].length > PER_KIND_LIMIT) {
    receivedByKind[k].sort((a, b) => b._firstSeen - a._firstSeen)
    // Remove evicted events from the id index
    const evicted = receivedByKind[k].slice(PER_KIND_LIMIT)
    evicted.forEach(e => delete receivedById[e.id])
    receivedByKind[k] = receivedByKind[k].slice(0, PER_KIND_LIMIT)
  }
}

function totalStored() {
  let n = 0
  for (const k in receivedByKind) n += receivedByKind[k].length
  return n
}

function kindsStored() {
  return Object.keys(receivedByKind).length
}
const meta = {}
const follows = {}

function toggleStop() {
  if (!window.relays) return // not initialized yet
  isStopped = !isStopped
  if (isStopped) {
    // Close only the "main" event subscription — keep meta/follows/relays alive
    relays.forEach(r => {
      try {
        if (r.ws && r.ws.readyState === 1) {
          r.ws.send('["CLOSE","main"]')
        }
      } catch(e) { console.log('Error closing main sub:', e) }
    })
    updateStopBtn()
    setDirty()
  } else {
    // Re-subscribe to "main" on connected relays, reconnect dead ones
    relays.forEach((r, id) => {
      try {
        if (r.ws && r.ws.readyState === 1) {
          // Still connected — just re-subscribe
          r.ws.send(`["REQ","main",{"limit":${DISPLAY_LIMIT},"until":${(ts() / 1000 + 60 * 60).toFixed()}}]`)
        } else {
          // Connection lost — reconnect fully
          r.tried = -1
          r.connected = false
          setupWs(r, id)
        }
      } catch(e) { console.log('Error restarting sub:', e) }
    })
    updateStopBtn()
    setDirty()
  }
}

function updateStopBtn() {
  if (!stopBtn) return
  if (isStopped) {
    stopBtn.textContent = '▶ Start'
  } else {
    stopBtn.textContent = '⏹ Stop'
  }
}

var tUpdate = 0
function setDirty() {
  const t = ts()
  // ms since last scheduled update. Negative if in the future.
  const dt = t - tUpdate
  if (dt > 0) {
    // No update is scheduled for now or the future. Schedule one for at least
    // [throttleMs] ms after the prior one.
    tUpdate = Math.max(tUpdate + throttleMs, t)    
    setTimeout(() => {
      update()
    }, tUpdate - t)
  }
}

function countForKind(val) {
  if (val === 'all') return totalStored()
  if (val === 'unknown') {
    return getReceived().filter(ev =>
      !allCategorizedKinds.has(ev.kind) &&
      !(ev.kind >= 5000 && ev.kind <= 5999) &&
      !(ev.kind >= 6000 && ev.kind <= 6999) &&
      ev.kind !== 7000
    ).length
  }
  if (val === 'dvm-request') return getReceived().filter(it => it.kind >= 5000 && it.kind <= 5999).length
  if (val === 'dvm-result') return getReceived().filter(it => it.kind >= 6000 && it.kind <= 6999).length
  if (val === 'cat-dvm') {
    return getReceived().filter(it =>
      (it.kind >= 5000 && it.kind <= 5999) ||
      (it.kind >= 6000 && it.kind <= 6999) ||
      it.kind === 7000
    ).length
  }
  if (kindCategories[val]) {
    const kinds = kindCategories[val]
    if (Array.isArray(kinds)) {
      return kinds.reduce((sum, k) => sum + (receivedByKind[k] || []).length, 0)
    }
    return 0
  }
  // Single kind
  return (receivedByKind[val] || []).length
}

function updateFilterCounts() {
  for (const opt of kindFilter.options) {
    // Store original label on first pass
    if (!opt.dataset.label) opt.dataset.label = opt.textContent
    const count = countForKind(opt.value)
    const suffix = count === 0 ? '' : count >= 100 ? ' (100+)' : ` (${count})`
    opt.textContent = opt.dataset.label + suffix
  }
}

function update() {
  if (pubkeyFilter.value) {
    degreeFilter.removeAttribute('disabled')
  } else {
    degreeFilter.setAttribute('disabled', '')
  }
  updateFilterCounts()
  updateUrl()
  output.innerHTML = eventsTable()
}

function eventsTable() {
  const kindFiltered = filterByKind()
  const filtered = filterByPubkey(kindFiltered)
  // sort by first-seen, newest first
  filtered.sort((a, b) => b._firstSeen - a._firstSeen)
  const displayed = filtered.slice(0, DISPLAY_LIMIT)
  
  return `${displayed.length}/${filtered.length} Events (${totalStored()} stored across ${kindsStored()} kinds):<br>`
    + displayed.map(it => eventBadge(it)).join('<br>')
}

// Track which pubkeys we've already requested follows for
var followsRequested = new Set()

function requestFollows(pubkeys) {
  // Request kind-3 events for specific pubkeys we haven't fetched yet
  const needed = pubkeys.filter(p => !followsRequested.has(p) && !follows[p])
  if (needed.length === 0) return
  needed.forEach(p => followsRequested.add(p))
  relays.forEach(r => {
    if (r.ws && r.ws.readyState === 1) {
      // Use a unique sub id to avoid collisions
      const subId = `follows-${needed[0].slice(0, 8)}`
      r.ws.send(JSON.stringify(["REQ", subId, {"kinds": [3], "authors": needed, "limit": needed.length}]))
    }
  })
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
  for (let n = 1; n <= degree; n++) {
    const f = new Set()
    followsByDegree[n - 1]
      .forEach(it => {
        (follows[it] || [])
          .forEach(x => f.add(x))
        })
    for (let i = 0; i < n; i++) {
      followsByDegree[i].forEach(it => f.delete(it))
    }
    followsByDegree[n] = f
    // Request follow lists for this degree's pubkeys so the next degree works
    if (n < degree) {
      requestFollows([...f])
    }
  }
  // Also request follows for the root pubkey if we don't have them
  requestFollows([pubkey])
  return list.map(it => {
    it.degree = followsByDegree.findIndex(x => x.has(it.pubkey))
    return it
  }).filter(e => e.degree >= 0)
}

const kindCategories = {
  'cat-core':        [0,1,2,3,5,6,7,8,9,11,16],
  'cat-encryption':  [4,13,14,1059,10050,20004,22456],
  'cat-media':       [20,21,22,1063],
  'cat-chat':        [40,41,42,43,44],
  'cat-relaymon':    [1066,10166,20166,30166],
  'cat-lists':       [10000,10002,10003,10009,30000],
  'cat-dvm':         'dvm', // special: 5000-5999, 6000-6999, 7000, 5300, 6300
  'cat-marketplace': [30017,30018,38383,38384,38385],
  'cat-content':     [30023,1984,1985,30311,30315],
  'cat-developer':   [30617,31234],
  'cat-webrtc':      [21647,22416,22811,25050,29333,21111,22651,20000,20001],
  'cat-connect':     [24133,24242,13194,13196],
  'cat-social':      [9735,30078,31990],
  'cat-other':       [30,60,443,445,1000,1009,4515,1808,1809,10007,10099,10100,11998,15750,23023,30081,30333,30515,31000,31991,34838,38225,38422],
}

// All explicitly categorized kinds (flat set for "unknown" filter)
const allCategorizedKinds = new Set(
  Object.values(kindCategories)
    .filter(v => Array.isArray(v))
    .flat()
)

function filterByKind() {
  const kind = kindFilter.value
  if (kind === 'all') {
    return getReceived()
  } else if (kind === 'unknown') {
    // Anything not in ANY category and not in DVM ranges
    return getReceived().filter(ev =>
      !allCategorizedKinds.has(ev.kind) &&
      !(ev.kind >= 5000 && ev.kind <= 5999) &&
      !(ev.kind >= 6000 && ev.kind <= 6999) &&
      ev.kind !== 7000
    )
  } else if (kind === 'dvm-request') {
    // Fast path: grab matching kind buckets directly
    return getReceived().filter(it => it.kind >= 5000 && it.kind <= 5999)
  } else if (kind === 'dvm-result') {
    return getReceived().filter(it => it.kind >= 6000 && it.kind <= 6999)
  } else if (kind === 'cat-dvm') {
    return getReceived().filter(it =>
      (it.kind >= 5000 && it.kind <= 5999) ||
      (it.kind >= 6000 && it.kind <= 6999) ||
      it.kind === 7000
    )
  } else if (kindCategories[kind]) {
    const kinds = kindCategories[kind]
    if (Array.isArray(kinds)) {
      // Fast path: grab buckets directly
      return kinds.flatMap(k => receivedByKind[k] || [])
    }
    return getReceived()
  } else {
    // Single kind — direct bucket lookup
    return (receivedByKind[kind] || []).slice()
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
  update() // immediate — no throttle for expand/collapse
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

function eventBadge(event) {
  const degree = pubkeyFilter.value
    ? `(D=${event.degree}) `
    : ''
  const from = nameFromPubkey(event.pubkey)
  const expandCollapse = (event.id === expandedEvent)
    ? `<span class='collapse' onclick='setExpand("")'>[–] </span>`
    : `<span class='expand' onclick='setExpand("${event.id}")'>[+] </span>`
  var badge = `<span class="event kind-${event.kind}">${expandCollapse}${timeFormat(event.created_at)}${degree} ${from} `
  switch (event.kind) {
    case 0: {
        badge += `Updated metadata.`
        break
      }
    case 1: {
        badge += escapeHTML(event.content)
        break
      }
    case 2: {
        badge += ` recommends relay ${escapeHTML(event.content)}`
        break
      }
    case 3: {
        badge += ` shared their ${event.tags.length} follows`
        break
      }
    case 4: {
        const pTag = event.tags.find(it=>it[0] === 'p')
        const recipientPubkey = pTag && pTag[1]
        const recipient = recipientPubkey
          ? ` to ${nameFromPubkey(recipientPubkey)}`
          : ''
        badge += ` Encrypted message (length: ${event.content.length})${recipient}.`
        break
      }
    case 5: {
        badge += ` marked an event for deletion.`
        break
      }
    case 6: {
        // NIP-18: Repost
        const eTag6 = event.tags.find(t => t[0] === 'e')
        const repostRef = eTag6 ? escapeHTML(eTag6[1].slice(0,16) + '…') : '(no ref)'
        badge += ` reposted event ${repostRef}`
        break
      }
    case 7: {
        badge += ` boosted an event with ${event.content.length === 0
          ? ' implicit 👍'
          : `explicit ${escapeHTML(event.content)}`}.`
        break
      }
    case 8: {
        // NIP-58: Badge Award
        const badgeTag = event.tags.find(t => t[0] === 'a')
        const badgeName = badgeTag ? escapeHTML(badgeTag[1].split(':').pop()) : 'unknown badge'
        badge += ` awarded badge: ${badgeName}`
        break
      }
    case 9: {
        // NIP-C7: Chat Message
        const preview9 = event.content ? escapeHTML(event.content.slice(0, 100)) + (event.content.length > 100 ? '…' : '') : ''
        badge += ` ${preview9}`
        break
      }
    case 11: {
        // NIP-7D: Thread
        const preview11 = event.content ? escapeHTML(event.content.slice(0, 100)) + (event.content.length > 100 ? '…' : '') : ''
        badge += ` thread: ${preview11}`
        break
      }
    case 13: {
        // NIP-59: Seal
        badge += ` sealed event (encrypted)`
        break
      }
    case 14: {
        // NIP-17: Direct Message
        const pTags14 = event.tags.filter(t => t[0] === 'p')
        badge += ` encrypted DM to ${pTags14.length} recipient(s)`
        break
      }
    case 16: {
        // NIP-18: Generic Repost
        const kTag16 = event.tags.find(t => t[0] === 'k')
        const repostedKind = kTag16 ? escapeHTML(kTag16[1]) : '?'
        badge += ` reposted kind-${repostedKind} event`
        break
      }
    case 20: {
        // NIP-68: Picture
        const urlTag20 = event.tags.find(t => t[0] === 'url' || t[0] === 'imeta')
        const picUrl = urlTag20 ? escapeHTML(urlTag20[1].slice(0,60)) : ''
        badge += ` shared a picture${picUrl ? ': ' + picUrl : ''}`
        break
      }
    case 21: {
        // NIP-71: Video Event
        badge += ` shared a video`
        break
      }
    case 22: {
        // NIP-71: Short Video
        badge += ` shared a short video`
        break
      }
    case 30: {
        badge += ` Something about chess: ${escapeHTML(event.content)}`
        break
      }
    case 40: {
        const content = JSON.parse(event.content)
        badge += ` Created a new channel called "${content.name}"`
        break
    }
    case 41: {
        badge += ` Updated channel metadata`
        break
    }
    case 42: {
        const eTag = event.tags.find(tag => tag[0] === 'e')
        if (eTag) {
          const channelPubkey = eTag[1];
          badge += ` Sent a new message to channel ${channelPubkey}`
        }
        break
    }
    case 43: {
        const content = JSON.parse(event.content)
        const reason = content.reason ? content.reason : "Unknown reason"
        badge += ` Hid a message (${reason})`
        break
    }
    case 44: {
        const pTag = event.tags.find(tag => tag[0] === 'p')
        const mutedPubkey = pTag[1]
        const content = JSON.parse(event.content)
        const reason = content.reason ? content.reason : "Unknown reason"
        badge += ` Muted user ${nameFromPubkey(mutedPubkey)} (${reason})}`
        break
    }
    case 60: {
        badge += ` Something about ride sharing: ${escapeHTML(event.content)}`
        break
      }
    case 443: {
        badge += ` Marmot key package`
        break
      }
    case 445: {
        badge += ` Marmot group event`
        break
      }
    case 1000: {
        badge += ` unknown kind 1000`
        break
      }
    case 1009: {
        badge += ` unknown kind 1009`
        break
      }
    case 1059: {
        // NIP-59: Gift Wrap
        badge += ` gift-wrapped event (encrypted)`
        break
      }
    case 1063: {
        // NIP-94: File metadata
        const urlTag = event.tags.find(t => t[0] === 'url')
        const mTag = event.tags.find(t => t[0] === 'm')
        const nameTag = event.tags.find(t => t[0] === 'name') || event.tags.find(t => t[0] === 'filename')
        const filename = nameTag ? escapeHTML(nameTag[1]) : (urlTag ? escapeHTML(urlTag[1].split('/').pop()) : 'unknown')
        const mime = mTag ? escapeHTML(mTag[1]) : 'unknown type'
        badge += ` shared a file: ${filename} (${mime})`
        break
      }
    case 1066: {
        // NIP-66: Relay Monitor Delta
        const dTag1066 = event.tags.find(t => t[0] === 'd')
        const relayUrl1066 = dTag1066 ? escapeHTML(dTag1066[1]) : 'unknown relay'
        badge += ` relay status change: ${relayUrl1066}`
        break
      }
    case 1808: {
        badge += ` unknown kind 1808`
        break
      }
    case 1809: {
        badge += ` unknown kind 1809`
        break
      }
    case 1984: {
        // NIP-56: Report
        const pTag = event.tags.find(t => t[0] === 'p')
        const reportedETag = event.tags.find(t => t[0] === 'e')
        const reportedTag = reportedETag || pTag
        const reportType = event.tags.find(t => t[0] === 'report')
        const reported = reportedTag ? escapeHTML(reportedTag[1].slice(0, 16) + '…') : 'unknown'
        const reason = reportType ? escapeHTML(reportType[1]) : (event.content ? escapeHTML(event.content.slice(0, 60)) : 'no reason given')
        badge += ` reported ${reported}: ${reason}`
        break
      }
    case 1985: {
        // NIP-32: Label
        const LTag = event.tags.find(t => t[0] === 'L')
        const lTag = event.tags.find(t => t[0] === 'l')
        const labelNs = LTag ? escapeHTML(LTag[1]) : ''
        const labelVal = lTag ? escapeHTML(lTag[1]) : '(no label)'
        badge += ` labeled: ${labelVal}${labelNs ? ' [' + labelNs + ']' : ''}`
        break
      }
    case 4515: {
        badge += ` unknown kind 4515`
        break
      }
    case 5300: {
        // NIP-90 specific: content discovery request
        badge += ` DVM: content discovery request`
        break
      }
    case 6300: {
        // NIP-90 specific: content discovery result
        badge += ` DVM: content discovery result`
        break
      }
    case 7000: {
        // NIP-90: Job Feedback
        const statusTag7000 = event.tags.find(t => t[0] === 'status')
        const fbStatus = statusTag7000 ? escapeHTML(statusTag7000[1]) : ''
        badge += ` DVM job feedback${fbStatus ? ': ' + fbStatus : ''}`
        break
      }
    case 9735: {
        // NIP-57: Zap receipt
        const zapPTag = event.tags.find(t => t[0] === 'p')
        const bolt11Tag = event.tags.find(t => t[0] === 'bolt11')
        const amountTag = event.tags.find(t => t[0] === 'amount')
        const descTag = event.tags.find(t => t[0] === 'description')
        const recipient = zapPTag ? nameFromPubkey(zapPTag[1]) : 'unknown'
        let sender = 'unknown sender'
        if (descTag) {
          try {
            const desc = JSON.parse(descTag[1])
            if (desc.pubkey) sender = nameFromPubkey(desc.pubkey)
          } catch(e) {}
        }
        let msats = '?'
        if (amountTag) {
          msats = escapeHTML(amountTag[1])
        } else if (bolt11Tag) {
          // Try to extract amount from bolt11 human-readable part
          const b11 = bolt11Tag[1]
          const m = b11.match(/^lnbc(\d+)([munp])/i)
          if (m) {
            const val = parseInt(m[1])
            const mult = m[2].toLowerCase()
            const multipliers = { m: 100000000, u: 100000, n: 100, p: 0.1 }
            msats = Math.round(val * (multipliers[mult] || 1)).toString()
          }
        }
        badge += ` zapped ${recipient} — ${msats} msats (from ${sender})`
        break
      }
    case 10002: {
        // NIP-65: Relay list metadata
        const relayTags = event.tags.filter(t => t[0] === 'r')
        badge += ` updated relay list (${relayTags.length} relays)`
        break
      }
    case 10000: {
        // NIP-51: Mute List
        const muteTags = event.tags.filter(t => t[0] === 'p' || t[0] === 'e' || t[0] === 't' || t[0] === 'word')
        badge += ` updated mute list (${muteTags.length} entries)`
        break
      }
    case 10003: {
        // NIP-51: Bookmark List
        const bookmarkTags = event.tags.filter(t => t[0] === 'e')
        badge += ` updated bookmarks (${bookmarkTags.length} entries)`
        break
      }
    case 10007: {
        badge += ` unknown kind 10007`
        break
      }
    case 10009: {
        // NIP-51: Pin List
        badge += ` updated pins`
        break
      }
    case 10050: {
        // NIP-17: DM Relay List
        badge += ` updated DM relay list`
        break
      }
    case 10099: {
        badge += ` unknown kind 10099`
        break
      }
    case 10100: {
        badge += ` unknown kind 10100`
        break
      }
    case 10166: {
        // NIP-66: Relay Monitor Announcement
        const cTags10166 = event.tags.filter(t => t[0] === 'c').map(t => escapeHTML(t[1]))
        badge += ` relay monitor announcement${cTags10166.length ? ': checks ' + cTags10166.slice(0,3).join(', ') : ''}`
        break
      }
    case 11998: {
        badge += ` unknown kind 11998`
        break
      }
    case 13194: {
        // NIP-47: Wallet Connect Info
        badge += ` NWC wallet info`
        break
      }
    case 13196: {
        badge += ` NWC event`
        break
      }
    case 15750: {
        badge += ` unknown kind 15750`
        break
      }
    case 20000: {
        const gTag20000 = event.tags.find(t => t[0] === 'g')
        const geohash20000 = gTag20000 ? escapeHTML(gTag20000[1]) : ''
        badge += ` bitchat message${geohash20000 ? ' @ ' + geohash20000 : ''}`
        break
      }
    case 20001: {
        const gTag20001 = event.tags.find(t => t[0] === 'g')
        const geohash20001 = gTag20001 ? escapeHTML(gTag20001[1]) : ''
        badge += ` ephemeral kind 20001${geohash20001 ? ' @ ' + geohash20001 : ''}`
        break
      }
    case 20004: {
        badge += ` ephemeral encrypted event`
        break
      }
    case 20166: {
        // NIP-66: Relay Monitor Ephemeral
        const dTag20166 = event.tags.find(t => t[0] === 'd')
        const url20166 = dTag20166 ? escapeHTML(dTag20166[1]) : ''
        badge += ` relay status update (ephemeral)${url20166 ? ': ' + url20166 : ''}`
        break
      }
    case 21111: {
        badge += ` ephemeral sync event`
        break
      }
    case 21647: {
        badge += ` WebRTC signaling`
        break
      }
    case 22416: {
        badge += ` WebRTC signaling`
        break
      }
    case 22456: {
        badge += ` ephemeral encrypted event`
        break
      }
    case 22651: {
        badge += ` ephemeral kind 22651`
        break
      }
    case 22811: {
        badge += ` WebRTC signaling`
        break
      }
    case 23023: {
        badge += ` unknown kind 23023`
        break
      }
    case 24133: {
        // NIP-46: Nostr Connect
        badge += ` Nostr Connect request`
        break
      }
    case 24242: {
        // Blossom
        badge += ` Blossom media server event`
        break
      }
    case 25050: {
        badge += ` WebRTC/peer signaling`
        break
      }
    case 29333: {
        badge += ` WebRTC signaling`
        break
      }
    case 30023: {
        // NIP-23: Long-form article
        const titleTag = event.tags.find(t => t[0] === 'title')
        const title = titleTag ? escapeHTML(titleTag[1]) : 'Untitled'
        const preview = event.content ? escapeHTML(event.content.slice(0, 80)) + (event.content.length > 80 ? '…' : '') : ''
        badge += ` published article: <strong>${title}</strong> — ${preview}`
        break
      }
    case 30000: {
        // NIP-51: Follow Sets
        const dTag30000 = event.tags.find(t => t[0] === 'd')
        const setName = dTag30000 ? escapeHTML(dTag30000[1]) : 'unnamed'
        const pCount30000 = event.tags.filter(t => t[0] === 'p').length
        badge += ` follow set: ${setName} (${pCount30000} follows)`
        break
      }
    case 30017: {
        // NIP-15: Marketplace Stall
        let stallName = ''
        try { stallName = JSON.parse(event.content).name || '' } catch(e) {}
        badge += ` marketplace stall${stallName ? ': ' + escapeHTML(stallName) : ''}`
        break
      }
    case 30018: {
        // NIP-15: Marketplace Product
        let productName = ''
        try { productName = JSON.parse(event.content).name || '' } catch(e) {}
        badge += ` marketplace product${productName ? ': ' + escapeHTML(productName) : ''}`
        break
      }
    case 30078: {
        // App-specific data
        const appTag = event.tags.find(t => t[0] === 'd')
        const appName = appTag ? escapeHTML(appTag[1]) : 'unknown app'
        badge += ` app-specific data for: ${appName}`
        break
      }
    case 30081: {
        badge += ` unknown kind 30081`
        break
      }
    case 30166: {
        // NIP-66: Relay Discovery
        const dTag30166 = event.tags.find(t => t[0] === 'd')
        const relayUrl30166 = dTag30166 ? escapeHTML(dTag30166[1]) : 'unknown'
        const rttTag = event.tags.find(t => t[0] === 'rtt-open')
        const rtt = rttTag ? ` RTT:${escapeHTML(rttTag[1])}ms` : ''
        const nipCount = event.tags.filter(t => t[0] === 'N').length
        const nipStr = nipCount ? ` NIPs:${nipCount}` : ''
        badge += ` relay discovery: ${relayUrl30166}${rtt}${nipStr}`
        break
      }
    case 30311: {
        // NIP-53: Live Event
        const titleTag = event.tags.find(t => t[0] === 'title')
        const statusTag = event.tags.find(t => t[0] === 'status')
        const title = titleTag ? escapeHTML(titleTag[1]) : 'Untitled event'
        const status = statusTag ? escapeHTML(statusTag[1]) : 'unknown'
        badge += ` live event: <strong>${title}</strong> (${status})`
        break
      }
    case 30315: {
        // NIP-38: User Status
        const dTag30315 = event.tags.find(t => t[0] === 'd')
        const statusType = dTag30315 ? escapeHTML(dTag30315[1]) : 'general'
        const statusContent = event.content ? escapeHTML(event.content.slice(0, 80)) : ''
        badge += ` status [${statusType}]: ${statusContent}`
        break
      }
    case 30333: {
        badge += ` unknown kind 30333`
        break
      }
    case 30515: {
        badge += ` unknown kind 30515`
        break
      }
    case 30617: {
        // NIP-34: Repository Announcement
        const dTag30617 = event.tags.find(t => t[0] === 'd')
        const repoName = dTag30617 ? escapeHTML(dTag30617[1]) : 'unknown repo'
        badge += ` repository announcement: ${repoName}`
        break
      }
    case 31000: {
        const dTag31000 = event.tags.find(t => t[0] === 'd')
        const d31000 = dTag31000 ? escapeHTML(dTag31000[1]) : ''
        badge += ` unknown kind 31000${d31000 ? ': ' + d31000 : ''}`
        break
      }
    case 31234: {
        // NIP-37: Draft Event
        badge += ` draft event`
        break
      }
    case 31990: {
        // Handler information
        const dTag = event.tags.find(t => t[0] === 'd')
        const kTag = event.tags.find(t => t[0] === 'k')
        const handlerName = dTag ? escapeHTML(dTag[1]) : 'unknown handler'
        const handlerKind = kTag ? escapeHTML(kTag[1]) : '?'
        badge += ` handler info: ${handlerName} (for kind ${handlerKind})`
        break
      }
    case 31991: {
        badge += ` unknown kind 31991`
        break
      }
    case 34838: {
        badge += ` unknown kind 34838`
        break
      }
    case 38225: {
        badge += ` unknown kind 38225`
        break
      }
    case 38383: {
        // NIP-69: P2P Order
        badge += ` P2P trade order`
        break
      }
    case 38384: {
        badge += ` P2P trade event`
        break
      }
    case 38385: {
        badge += ` P2P trade event`
        break
      }
    case 38422: {
        badge += ` unknown kind 38422`
        break
      }
    default: {
        // For DVM job requests (5000-5999) and results (6000-6999)
        if (event.kind >= 5000 && event.kind <= 5999) {
          badge += ` DVM job request (kind ${event.kind})`
        } else if (event.kind >= 6000 && event.kind <= 6999) {
          badge += ` DVM job result (kind ${event.kind})`
        } else {
          const preview = event.content ? escapeHTML(event.content.slice(0, 100)) + (event.content.length > 100 ? '…' : '') : ''
          const tagCount = event.tags ? event.tags.length : 0
          badge += ` unknown kind ${event.kind}${preview ? ': ' + preview : ''} [${tagCount} tags]`
        }
        break
      }
  }
  return badge + '</span>' + (event.id === expandedEvent
    ? rawEventWidget(event)
    : '')
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
      relay.nip11=it
      console.log(it)
    }).catch(console.error)
  }).catch(console.error)
}

function setupWs(relay, id) {
  // testNip11(relay)
  const ws = new WebSocket(relay.url)
  relay.ws = ws
  relay.tried = ts()
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
      if (arr[1] === "main") {
        relay.events++
      }
      const prior = receivedById[event.id]
      if (prior) {
        if (0 > prior.relays.findIndex(i=>i.id==id)) {
          prior.relays.push({id: id,count:relay.events,timeMs:ts()})
        }
        if (arr[1] === "main") {
          return // this event was handled by main already
        }
      }
      const subId = arr[1]
      // Route follows-* targeted subs to the follows handler
      const subType = subId.startsWith('follows') ? 'follows' : subId
      switch (subType) {
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
            setDirty() // re-render — new follow data may expand degree results
          } else {
            relay.wrongKind++
            relay.msg = msg.data
          }
          break
        case 'relays':
          if (event.kind === 2) {
            const ipRegExp = /[0-9]+.[0-9]+.[0-9]+.[0-9]+/g
            const relayUrl = event
              .content
              .replace(/(\n|\r|\t|\/| )+$/, '')
              .replace(/^(\n|\r|\t| )+/, '')
              .toLowerCase()
            if (relays.findIndex(it=>it.url==relayUrl)>=0 || // we have this one already.
                !relayUrl.startsWith('wss://') || // only ssl for now
                ipRegExp.test(relayUrl) || // IPs don't support ssl
                relayUrl.includes('localhost')) { // localhost?
              break
            }
            relays.push({
              url: relayUrl,
              tried: -1,
              connected: false,
              answered: false,
              events: 0,
              wrongKind: 0,
              invalid: 0,
              msg: ""
            })
          } else {
            relay.wrongKind++
            relay.msg = msg.data
          }
          break
        case 'main':
          event.relays = [{id: id,count:relay.events,timeMs:ts()}]
          event._firstSeen = ts()
          if (!event.tags) {
            relay.invalid++
            relay.msg = msg.data
            console.log(`${relay.url} sent event with no tags.`)
            event.tags = []
          }
          storeEvent(event)
          break
      }
    } else if (arr[0] === 'EOSE') {
      if (['meta','follows','relays'].includes(arr[1]) || arr[1].startsWith('follows-')) {
        ws.send(`["CLOSE","${arr[1]}"]`)
      }
    } else {
      console.log(`Unexpected command ${arr[0]}`)
    }
  }
  ws.onclose = () => {
    relay.connected = false
    setDirty()
    console.log(`${relay.url} disconnected.`)
  }
  ws.onerror = (e) => {
    relay.connected = false
    setDirty()
    console.log(`${relay.url} had an error: ${JSON.stringify(e)}`)
  }
  ws.onopen = event => {
    relay.connected = true
    relay.answered = true
    setDirty()
    ws.send(`["REQ","main",{"limit":${DISPLAY_LIMIT},"until":${(ts() / 1000 + 60 * 60).toFixed()}}]`)
    ws.send('["REQ","meta",{"kinds":[0]}]')
    ws.send('["REQ","follows",{"kinds":[3]}]')
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

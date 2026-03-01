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
  window.tab = document.getElementById("tab")
  window.relayFilters = document.getElementById("relay-filters")
  window.relayQualityFilter = document.getElementById("relay-filter")
  window.connectRelaysBtn = document.getElementById("connectNewRelays")
  window.eventFilters = document.getElementById("event-filters")
  window.kindFilter = document.getElementById("kind-filter")
  window.pubkeyFilter = document.getElementById("pubkey-filter")
  window.degreeFilter = document.getElementById("degree-filter")
  window.output = document.getElementById("output")
  window.pauseBtn = document.getElementById("pause-btn")
  window.expandedEvent = ""
})

const LIMIT = 100 // how many events to show
const throttleMs = 500
var received = []
var paused_buffer = []
var isPaused = false
const meta = {}
const follows = {}

function togglePause() {
  isPaused = !isPaused
  if (!isPaused) {
    // Flush buffered events into received
    paused_buffer.forEach(ev => received.push(ev))
    paused_buffer = []
    updatePauseBtn()
    setDirty()
  } else {
    updatePauseBtn()
  }
}

function updatePauseBtn() {
  if (!pauseBtn) return
  if (isPaused) {
    pauseBtn.textContent = `⏸ Paused (${paused_buffer.length} buffered)`
  } else {
    pauseBtn.textContent = '⏸ Pause'
  }
}

var tUpdate = 0
function setDirty() {
  if (isPaused) return
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

function update() {
  const nearFuture = ts() / 1000 + 60 * 60
  received = received
    // near future
    .filter(it=>it.created_at<nearFuture)
    // newest first
    .sort( (a,b) => b.created_at - a.created_at )
    // clip to only LIMIT events
    .slice(0, LIMIT)

  eventFilters.hidden = true
  relayFilters.hidden = true
  switch(tab.value) {
    case "relays":
      relayFilters.hidden = false
      if (pauseBtn) pauseBtn.hidden = true
      output.innerHTML = relaysTable()
      break
    case "events":
      if (pubkeyFilter.value) {
        degreeFilter.removeAttribute('disabled')
      } else {
        degreeFilter.setAttribute('disabled', '')
      }
      eventFilters.hidden = false
      if (pauseBtn) pauseBtn.hidden = false
      output.innerHTML = eventsTable()
      break
  }
}

function connectRelays() {
  relays.forEach((r, id) => {
    if (r.tried < 0) {
      setupWs(r, id)
    }
  })
}

function relaysTable() {
  connectRelaysBtn.hidden = relays.filter(it=>it.tried<0).length === 0
  return '<table>' +
    '<tr><td>Relay</td><td>Events<sup>1</sup></td><td>Connection<sup>2</sup></td><td>Comment</td></tr>' +
    relays.filter(r=>{
      switch (relayQualityFilter.value) {
        case 'all': return true
        case 'didConnect': return r.answered
        case 'sent': return r.events > 0
        case 'sentMany': return r.events >= LIMIT
        case 'sentConnected': return r.events >= LIMIT && r.connected
        default: return false
      }
    }).map(r=>`<tr><td>${r.url}</td><td>${r.events}</td><td>${
      r.tried < 0
        ? '?'
        : r.connected
          ? 'true'
          : r.answered
            ? 'lost'
            : 'false'
        }</td><td>${ (r.wrongKind > 0
          ? r.wrongKind + ' unrequested'
          : '') + (r.invalid > 0
            ? '<br>' + r.invalid + ' invalid'
            : '') + (r.msg.length > 0
              ? ` (${r.msg})`
              : '')}</td></tr>`).join('') +
        `<tr><td colspan="5"><sup>1</sup> counting all events received after requesting ${LIMIT} most recent events.<br>Events received to determine names and follows are not counted.</td></tr>` +
        '<tr><td colspan="5"><sup>2</sup> "false" = connection never succeeded. "?" = we haven\'t tried yet. Press button above to try.</td></tr>' +
    '</table>'
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
    const knownKinds = [0,1,2,3,4,5,6,7,30,40,41,42,43,44,60,1063,1984,9735,10002,30023,30078,30311,31990]
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
        badge += ` made a "quoted boost". Damus sends and interprets those. ${JSON.stringify({tags:event.tags,content:escapeHTML(event.content)})}`
        break
      }
    case 7: {
        badge += ` boosted an event with ${event.content.length === 0
          ? ' implicit 👍'
          : `explicit ${escapeHTML(event.content)}`}.`
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
    case 30023: {
        // NIP-23: Long-form article
        const titleTag = event.tags.find(t => t[0] === 'title')
        const title = titleTag ? escapeHTML(titleTag[1]) : 'Untitled'
        const preview = event.content ? escapeHTML(event.content.slice(0, 80)) + (event.content.length > 80 ? '…' : '') : ''
        badge += ` published article: <strong>${title}</strong> — ${preview}`
        break
      }
    case 30078: {
        // App-specific data
        const appTag = event.tags.find(t => t[0] === 'd')
        const appName = appTag ? escapeHTML(appTag[1]) : 'unknown app'
        badge += ` app-specific data for: ${appName}`
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
    case 31990: {
        // Handler information
        const dTag = event.tags.find(t => t[0] === 'd')
        const kTag = event.tags.find(t => t[0] === 'k')
        const handlerName = dTag ? escapeHTML(dTag[1]) : 'unknown handler'
        const handlerKind = kTag ? escapeHTML(kTag[1]) : '?'
        badge += ` handler info: ${handlerName} (for kind ${handlerKind})`
        break
      }
    default: {
        badge += ` unhandled kind ${event.kind} event with ${JSON.stringify({tags:event.tags,content:escapeHTML(event.content)})}.`
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
          if (!event.tags) {
            relay.invalid++
            relay.msg = msg.data
            console.log(`${relay.url} sent event with no tags.`)
            event.tags = []
          }
          if (isPaused) {
            paused_buffer.push(event)
            updatePauseBtn()
          } else {
            received.push(event)
          }
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
    ws.send(`["REQ","main",{"limit":${LIMIT},"until":${(ts() / 1000 + 60 * 60).toFixed()}}]`)
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

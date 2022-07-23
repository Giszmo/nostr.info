window.addEventListener('load', () => {
  window.relays = [
    'wss://nostr-pub.wellorder.net',
    'wss://nostr-relay.wlvs.space',
    'wss://nostr-verified.wellorder.net',
    'wss://nostr.openchain.fr',
    'wss://relay.damus.io',
    'wss://relay.nostr.info',
    // 'wss://nostr-relay.untethr.me',
    'wss://relay.minds.com/nostr/v1/ws',
    'wss://nostr.oxtr.dev',
    'wss://nostr.semisol.dev',
    'wss://nostr-relay.untethr.me',
    'wss://nostr.bitcoiner.social',
    'wss://nostr.onsats.org',
    'wss://nostr.drss.io',
    'wss://nostr.rocks',
    'wss://rsslay.fiatjaf.com',
    'wss://freedom-relay.herokuapp.com/ws',
    'wss://nostr.delo.software',
    'wss://nostr.unknown.place',
    'wss://relayer.fiatjaf.com',
    'wss://nostr-relay.freeberty.net',
    // 'ws://jgqaglhautb4k6e6i2g34jakxiemqp6z4wynlirltuukgkft2xuglmqd.onion',
  ].map(it=>{ return {
    url: it,
    tried: -1, // we tried to connect it
    connected: false, // currently connected
    answered: false, // was connected in the past
    events: 0 // event counter
  }})
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
  window.expandedEvent = ""
  setInterval(() => {
    if (dirty) {
      update()
    }
  }, 1000)
})

const LIMIT = 500 // how many events to show
var received = []
var dirty = true
const meta = {}
const follows = {}

function update() {
  eventFilters.hidden = true
  relayFilters.hidden = true
  switch(tab.value) {
    case "relays":
      relayFilters.hidden = false
      output.innerHTML = relaysTable()
      break
    case "events":
      if (pubkeyFilter.value) {
        degreeFilter.removeAttribute('disabled')
      } else {
        degreeFilter.setAttribute('disabled', '')
      }
      eventFilters.hidden = false
      output.innerHTML = eventsTable()
      break
  }
  dirty = false
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
    '<tr><td>Relay</td><td>Events<sup>1</sup></td><td>Connection<sup>2</sup></td></tr>' +
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
        }</td></tr>`).join('') +
        `<tr><td colspan="3"><sup>1</sup> counting all events received after requesting ${LIMIT} most recent events.<br>Events received to determine names and follows are not counted.</td></tr>` +
        '<tr><td colspan="3"><sup>2</sup> "false" = connection never succeeded. "?" = we haven\'t tried yet. Press button above to try.</td></tr>' +
    '</table>'
}

function eventsTable() {
  // newest first
  received = received.sort( (a,b) => b.created_at - a.created_at )
  // clip to only LIMIT events
  received = received.slice(0, LIMIT)
  
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
    const knownKinds = [0,1,2,3,4,5,6,7,30,60]
    return received.filter(ev => !knownKinds.includes(ev.kind))
  } else {
    return received.filter(it => it.kind == kind)
  }
}

function setPubkey(pubkey) {
  pubkeyFilter.value=pubkey
  dirty=true
}

function nameFromPubkey(pubkey) {
  const m = meta[pubkey]
  const img = (m && m.picture) || '/assets/smallNoicon.png'
  const name = (m && m.name) || pubkey || 'unknown'
  return `<span class="meta" onclick="setPubkey('${pubkey}')">
  <img src="${img}">&nbsp;${name}
</span>`
}

function setExpand(id) {
  expandedEvent = id
  dirty = true
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
        badge += ` made a "quoted boost". Damus sends and interprets those. ${JSON.stringify({tags:event.tags,content:event.content})}`
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
    case 60: {
        badge += ` Something about ride sharing: ${escapeHTML(event.content)}`
        break
      }
    default: {
        badge += ` unhandled kind ${event.kind} event with ${JSON.stringify({tags:event.tags,content:event.content})}.`
        break
      }
  }
  return badge + '</span>' + (event.id === expandedEvent
    ? rawEventWidget(event)
    : '')
}

const ts = () => (new Date()).getTime()

function setupWs(relay, id) {
  const ws = new WebSocket(relay.url)
  relay.ws = ws
  relay.tried = ts()
  ws.onmessage = msg => {
    var arr
    dirty = true
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
        return // this event was handled already
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
          }
          break
        case 'follows':
          if (event.kind === 3) {
            follows[event.pubkey] = event.tags.filter(it => it[0] === "p").map(it => it[1])
          }
          break
        case 'relays':
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
            events: 0
          })
          break
        case 'main':
          event.relays = [{id: id,count:relay.events,timeMs:ts()}]
          if (!event.tags) {
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
    }
  }
  ws.onclose = () => {
    relay.connected = false
    dirty = true
    console.log(`${relay.url} disconnected. Not reconnecting in 5s`)
    // setTimeout(() => {
    //   setupWs(url)
    // }, 5000)
  }
  ws.onopen = event => {
    relay.connected = true
    relay.answered = true
    dirty = true
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
  return `${d.getYear()-100}-${(d.getMonth()+1).pad(2)}-${(d.getDate()+1).pad(2)} ` +
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

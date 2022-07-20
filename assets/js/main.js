window.addEventListener('load', () => {
  setupWs('wss://relay.nostr.info/')
  setupWs('wss://nostr-pub.wellorder.net')
  setupWs('wss://relay.damus.io')
  setupWs('wss://nostr.rocks')
  window.kindFilter = document.getElementById("kind-filter")
  window.pubkeyFilter = document.getElementById("pubkey-filter")
  window.degreeFilter = document.getElementById("degree-filter")
  window.output = document.getElementById("output")
  setInterval(() => {
    if (dirty) {
      update()
    }
  }, 1000)
})

const LIMIT = 2000 // how many events to show
var received = []
var dirty = true
const meta = {}
const follows = {}

function update() {
  // dedupe
  received = [...new Map(received.map(x => [x.id, x])).values()]
  // newest first
  received = received.sort( (a,b) => b.created_at - a.created_at )
  // clip to only LIMIT events
  received = received.slice(0, LIMIT)
  
  const kindFiltered = filterByKind()
  const filtered = filterByPubkey(kindFiltered)
  
  output.innerHTML = `${filtered.length}/${LIMIT} Events:<br>`
    + filtered.map(it => eventBadge(it)).join('<br>')
  
  if (pubkeyFilter.value) {
    degreeFilter.removeAttribute('disabled')
  } else {
    degreeFilter.setAttribute('disabled', '')
  }
  dirty = false
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
    const knownKinds = [0,1,2,3,4,5,6,7,60]
    return received.filter(ev => !knownKinds.includes(ev.kind))
  } else {
    return received.filter(it => it.kind == kind)
  }
}

function nameFromPubkey(pubkey) {
  const m = meta[pubkey]
  const img = (m && m.picture) || '/assets/smallNoicon.png'
  const name = (m && m.name) || pubkey || 'unknown'
  return `<span class="meta"><img src="${img}">&nbsp;${name}</span>`
}

function eventBadge(event) {
  const degree = pubkeyFilter.value
    ? `(D=${event.degree}) `
    : ''
  const from = nameFromPubkey(event.pubkey)
  var badge = `<span class="event kind-${event.kind}">${timeFormat(event.created_at)}${degree} ${from} `
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
        const recipientPubkey = event.tags.filter(it=>it[0] === 'p')[0][1]
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
    case 60: {
        badge += ` Something about ride sharing: ${escapeHTML(event.content)}`
        break
      }
    default: {
        badge += ` unhandled kind ${event.kind} event with ${JSON.stringify({tags:event.tags,content:event.content})}.`
        break
      }
  }
  return badge + '</span>'
}

function setupWs(url) {
  const ws = new WebSocket(url)
  ws.onmessage = msg => {
    const arr = JSON.parse(msg.data)
    if (arr[0] === 'EVENT') {
      if (arr[1] == "meta") {
        const event = arr[2]
        if (event.kind === 0) {
          try {
            const m = JSON.parse(event.content)
            meta[event.pubkey] = m
          } catch(e) {
            console.log(`Should "${escapeHTML(event.content)}" be valid JSON?`)
          }
        }
      } if (arr[1] == "follows") {
        const event = arr[2]
        if (event.kind === 3) {
          follows[event.pubkey] = event.tags.filter(it => it[0] === "p").map(it => it[1])
        }
      } else if (arr[1] === "main") {
        const event = arr[2]
        received.unshift(event)
      }
      dirty = true
    } else if (arr[0] === 'EOSE') {
      if (arr[1] === 'meta') {
        ws.send('["CLOSE","meta"]')
      } else if (arr[1] === 'follows') {
        ws.send('["CLOSE","follows"]')
      }
    }
  }
  ws.onclose = () => {
    setTimeout(() => {
      setupWs(url)
    }, 5000)
  }
  ws.onopen = event => {
    ws.send(`["REQ","main",{"limit":${LIMIT},"before":${(new Date().getTime() / 1000 + 60 * 60)}}]`)
    ws.send('["REQ","meta",{"kinds":[0]}]')
    ws.send('["REQ","follows",{"kinds":[3]}]')
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

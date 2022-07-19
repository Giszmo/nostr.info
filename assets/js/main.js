window.addEventListener('load', () => {
  setupWs('wss://relay.nostr.info/')
  setupWs('wss://nostr-pub.wellorder.net')
  setupWs('wss://relay.damus.io')
  window.output = document.getElementById("output")
  window.kindFilter = document.getElementById("kind-filter")
  setInterval(() => {
    if (dirty) {
      // dedupe
      received = [...new Map(received.map(x => [x.id, x])).values()]
      received = received.sort( (a,b) => b.created_at - a.created_at )
      received = received.slice(0, LIMIT)
      const kind = kindFilter.value
      if (kind === 'all') {
        filtered = received
      } else if (kind === 'unknown') {
        const knownKinds = [0,1,2,3,4,5,6,7,60]
        filtered = received.filter(ev => !knownKinds.includes(ev.kind))
      } else {
        filtered = received.filter(it => it.kind == kind)
      }
      output.innerHTML = filtered.map(it => eventBadge(it)).join('<br>')
      dirty = false
    }
  }, 1000)
})

const LIMIT = 2000 // how many events to show
var received = []
var dirty = true
const meta = {}

function nameFromPubkey(pubkey) {
  const m = meta[pubkey]
  const img = (m && m.picture) || '/assets/smallNoicon.png'
  const name = (m && m.name) || pubkey || 'unknown'
  return `<span class="meta"><img src="${img}">&nbsp;${name}</span>`
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

function eventBadge(event) {
  const from = nameFromPubkey(event.pubkey)
  var badge = `<span class="event kind-${event.kind}">${timeFormat(event.created_at)} ${from} `
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
      } else if (arr[1] === "main") {
        const event = arr[2]
        received.unshift(event)
      }
      dirty = true
    } else if (arr[0] === 'EOSE') {
      if (arr[1] === 'meta') {
        ws.send('["CLOSE","meta"]')
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
  }
}

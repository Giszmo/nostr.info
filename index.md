---
layout: home
---
<style>
.event {
  white-space: nowrap;
  background-color: lightgray;
}

.kind-0 {
  background-color: lightblue;
}

.kind-1 {
  background-color: lightgreen;
}

.kind-2 {
  background-color: pink;
}

.kind-3 {
  background-color: navy;
  color: white;
}

.kind-4 {
  background-color: lightcoral;
}
</style>

<label for="kind-filter">Filter by Kind:</label>
<select name="kind-filter" id="kind-filter" onchange="dirty=true">
  <option value="all">All</option>
  <option value="0">kind-0: Metadata</option>
  <option value="1">kind-1: Public Post</option>
  <option value="2">kind-2: Relay Recommendation</option>
  <option value="3">kind-3: Follows List</option>
  <option value="4">kind-4: DM</option>
</select>

<div id="output"></div>
<script>
  window.addEventListener('load', () => {setup('wss://relay.nostr.info/')})
  window.addEventListener('load', () => {setup('wss://nostr-pub.wellorder.net')})
  const LIMIT = 2000 // how many events to show
  const output = document.getElementById("output")
  const kindFilter = document.getElementById("kind-filter")
  var received = []
  var dirty = true
  
  const names = {}

  function nameFromPubkey(pubkey) {
    return ('' + (names[pubkey] || pubkey || 'unknown')).substring(0,15)
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
    const client = guessClient(event)
    var badge = `<span class="event kind-${event.kind}">${timeFormat(event.created_at)} ${from}${client ? ` (using ${client})` : ""}: `
    switch (event.kind) {
      case 0: {
          badge += `Updated metadata.`
          break
        }
      case 1: {
          const referencing = []
          const eReferences = event.tags.filter(it=>it[0] === 'e').length
          const pReferences = event.tags.filter(it=>it[0] === 'p').length
          if (eReferences > 0) {
            referencing.push(`${eReferences} events`)
          }
          if (pReferences > 0) {
            referencing.push(`${pReferences} pubkeys`)
          }
          const references = referencing.length > 0
            ? 'referencing ' + referencing.join(' and ')
            : ''
          badge += `Broadcast ${references}: ${escapeHTML(event.content)}`
          break
        }
      case 2: {
          badge += ` recommends the relay ${escapeHTML(event.content)}`
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
          badge += ` sent an encrypted message (length: ${event.content.length})${recipient}.`
          break
        }
      default: {
          badge += ` sent a kind ${event.kind} event with ${JSON.stringify({tags:event.tags,content:event.content})}.`
          break
        }
    }
    return badge + '</span>'
  }

  function setup(url) {
    const ws = new WebSocket(url)
    ws.onmessage = msg => {
      const arr = JSON.parse(msg.data)
      if (arr[0] === 'EVENT') {
        if (arr[1] == "meta") {
          const event = arr[2]
          if (event.kind === 0) {
            try {
              const meta = JSON.parse(event.content)
              names[event.pubkey] = meta.name
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
        setup(url)
      }, 5000)
    }
    ws.onopen = event => {
      ws.send(`["REQ","main",{"limit":${LIMIT},"before":${(new Date().getTime() / 1000 + 60 * 60)}}]`)
      ws.send('["REQ","meta",{"kinds":[0]}]')
    }
  }
  setInterval(() => {
    if (dirty) {
      // dedupe
      received = [...new Map(received.map(x => [x.id, x])).values()]
      received = received.sort( (a,b) => b.created_at - a.created_at )
      received = received.slice(0, LIMIT)
      const kind = kindFilter.value
      if (kind !== 'all') {
        filtered = received.filter(it => it.kind == kind)
      } else {
        filtered = received
      }
      output.innerHTML = filtered.map(it => eventBadge(it)).join('<br>')
      dirty = false
    }
  }, 1000)
</script>

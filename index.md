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

<div id="output"></div>
<script>
  window.onload = setup
  const output = document.getElementById("output");
  var received = []
  var ws
  var dirty = true
  
  const names = {}

  function nameFromPubkey(pubkey) {
    return ('' + (names[pubkey] || pubkey || 'unknown')).substring(0,15)
  }

  function eventBadge(event) {
    const name = nameFromPubkey(event.pubkey)
    var badge = `<span class="event kind-${event.kind}">${name}`
    switch (event.kind) {
      case 0: {
          badge += ` updated their metadata.`
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
          const references = referencing.join(' and ')
          badge += ` broadcast ${references}: ${event.content}`
          break
        }
      case 2: {
          badge += ` recommends the relay ${event.content}`
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
          badge += ` sent an encrypted message${recipient}.`
          break
        }
      default: {
          badge += ` sent a kind ${event.kind} event with ${JSON.stringify({tags:event.tags,content:event.content})}.`
          break
        }
    }
    return badge + '</span>'
  }

  function setup() {
    ws = new WebSocket("wss://relay.nostr.info/")
    ws.onmessage = msg => {
      const arr = JSON.parse(msg.data)
      if (arr[0] === 'EVENT') {
        if (arr[1] == "meta") {
          const event = arr[2]
          if (event.kind === 0) {
            const meta = JSON.parse(event.content)
            names[event.pubkey] = meta.name
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
    ws.onclose = setup
    ws.onopen = event => {
      ws.send('["REQ","main",{"limit":100}]')
      ws.send('["REQ","meta",{"kinds":[0]}]')
    }
  }

  setInterval(() => {
    if (dirty) {
      received = received.slice(0, 100)
      output.innerHTML = received.map(it => eventBadge(it)).join('<br>')
      dirty = false
    }
  }, 1000)
</script>

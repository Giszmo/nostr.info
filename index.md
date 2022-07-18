---
layout: home
---
<style>
.event {
  white-space: nowrap;
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
  background-color: lightred;
}
</style>

<div id="output"></div>
<script>
  window.onload = setup
  const output = document.getElementById("output");
  var received = []
  var ws
  
  const names = {}

  function nameFromPubkey(pubkey) {
    return (names[pubkey] || pubkey || 'unknown').substring(0,15)
  }

  function eventBadge(event) {
    const name = nameFromPubkey(event.pubkey)
    var badge = `<span class="event kind-${event.kind}">${name}`
    switch (event.kind) {
      case 0: {
          const meta = JSON.parse(event.content)
          names[event.pubkey] = meta.name
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
          badge += ` shared his ${event.tags.length} follows`
          break
        }
      case 4: {
          const recipientPubkey = event.tags.filter(it=>it[0] === 'p')[0]
          const recipient = recipientPubkey
            ? ` to ${nameFromPubkey(recipientPubkey)}`
            : ''
          badge += ` sent an encrypted direct message${recipient}.`
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
      if (msg.data && msg.data.startsWith('["EVENT",')) {
        received.unshift(JSON.parse(msg.data)[2])
      }
    }
    ws.onclose = setup
    ws.onopen = event => {
      ws.send('["REQ","",{"limit":20}]')
    }
  }

  setInterval(() => {
    received = received.slice(0, 10)
    output.innerHTML = received.map(it => eventBadge(it)).join('<br>')
  }, 1000)
</script>

---
layout: home
---

<textarea id="output" wrap="off" style="min-height: 20em;width: 100%"></textarea>
<script>
  window.onload = setup
  var received = []
  const output = document.getElementById("output");
  var ws

  function setup() {
    ws = new WebSocket("wss://relay.nostr.info/")
    ws.onmessage = msg => {
      if (msg.data && msg.data.startsWith('["EVENT",')) {
        received.unshift(msg.data)
      }
    }
    ws.onclose = setup
    ws.onopen = event => {
      ws.send('["REQ","",{"limit":20}]')
    }
  }

  setInterval(() => {
    received = received.slice(0, 10)
    output.value = received.join('\n')
  }, 1000)
</script>

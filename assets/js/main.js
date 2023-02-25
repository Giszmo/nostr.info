function shuffle(array) {
  var random = array.map(Math.random);
  array.sort(function(a, b) {
    return random[a] - random[b];
  });
}

window.addEventListener('load', () => {
  window.relays = [
    'wss://nostr.wine',
    'wss://astral.ninja',
    'wss://at.nostrworks.com',
    'wss://brb.io',
    'wss://btc.klendazu.com',
    'wss://deschooling.us',
    'wss://expensive-relay.fiatjaf.com',
    'wss://freedom-relay.herokuapp.com/ws',
    'wss://jiggytom.ddns.net',
    'wss://knostr.neutrine.com',
    'wss://lv01.tater.ninja',
    'wss://mule.platanito.org',
    'wss://no.contry.xyz',
    'wss://node01.nostress.cc',
    'wss://nos.lol',
    'wss://nostr-01.bolt.observer',
    'wss://nostr-1.nbo.angani.co',
    'wss://nostr1.starbackr.me',
    'wss://nostr1.tunnelsats.com',
    'wss://nostr2.actn.io',
    'wss://nostr2.namek.link',
    'wss://nostr-2.orba.ca',
    'wss://nostr-2.zebedee.cloud',
    'wss://nostr3.actn.io',
    'wss://nostr-3.orba.ca',
    'wss://relay.nostr-latam.link',
    'wss://nostr.8e23.net',
    'wss://nostr.actn.io',
    'wss://nostr-alpha.gruntwerk.org',
    'wss://nostr.aozing.com',
    'wss://nostr.bch.ninja',
    'wss://nostr-bg01.ciph.rs',
    'wss://nostr.bitcoiner.social',
    'wss://nostr.blocs.fr',
    'wss://nostr.bongbong.com',
    'wss://nostr.bostonbtc.com',
    'wss://nostr.cercatrova.me',
    'wss://nostr.chaker.net',
    'wss://nostr.coinos.io',
    'wss://nostr.coollamer.com',
    'wss://nostr.corebreach.com',
    'wss://no.str.cr',
    'wss://nostr.d11n.net',
    'wss://nostr.datamagik.com',
    'wss://nostr.delo.software',
    'wss://nostr.demovement.net',
    'wss://nostr.developer.li',
    'wss://nostr-dev.wellorder.net',
    'wss://nostr.digitalreformation.info',
    'wss://nostr.drss.io',
    'wss://nostream.gromeul.eu',
    'wss://nostr.easydns.ca',
    'wss://nostr.einundzwanzig.space',
    'wss://nostr.ethtozero.fr',
    'wss://nostrex.fly.dev',
    'wss://nostr.f44.dev',
    'wss://nostr.fly.dev',
    'wss://nostr.fmt.wiz.biz',
    'wss://nostr.formigator.eu',
    'wss://nostr.gromeul.eu',
    'wss://nostr.gruntwerk.org',
    'wss://nostr.hackerman.pro',
    'wss://nostr.handyjunky.com',
    'wss://nostr.hugo.md',
    'wss://nostr.hyperlingo.com',
    'wss://nostrical.com',
    'wss://nostrich.friendship.tw',
    'wss://nostr.itssilvestre.com',
    'wss://nostr.jiashanlu.synology.me',
    'wss://nostr.jimc.me',
    'wss://nostr.kollider.xyz',
    'wss://nostr.leximaster.com',
    'wss://nostr.lnprivate.network',
    'wss://nostr.mado.io',
    'wss://nostr.massmux.com',
    'wss://nostr.mikedilger.com',
    'wss://nostr.milou.lol',
    'wss://nostr.mom',
    'wss://nostr.mouton.dev',
    'wss://nostr.mrbits.it',
    'wss://nostr.mustardnodes.com',
    'wss://nostr.mwmdev.com',
    'wss://nostr.namek.link',
    'wss://nostr.ncsa.illinois.edu',
    'wss://nostr.nodeofsven.com',
    'wss://nostr.noones.com',
    'wss://nostr.nordlysln.net',
    'wss://nostr.nymsrelay.com',
    'wss://nostr.ono.re',
    'wss://nostr.onsats.org',
    'wss://nostr.ownscale.org',
    'wss://nostr.oooxxx.ml',
    'wss://nostr.openchain.fr',
    'wss://nostr.orangepill.dev',
    'wss://nostr.orba.ca',
    'wss://no-str.org',
    'wss://nostr.oxtr.dev',
    'wss://nostr.p2sh.co',
    'wss://nostr.pobblelabs.org',
    'wss://nostr-pub1.southflorida.ninja',
    'wss://nostr-pub.semisol.dev',
    'wss://nostr-pub.wellorder.net',
    'wss://nostr.radixrat.com',
    'wss://nostr.rdfriedl.com',
    'wss://nostr-relay.alekberg.net',
    'wss://nostr-relay.australiaeast.cloudapp.azure.com',
    'wss://nostr-relay.bitcoin.ninja',
    'wss://nostrrelay.com',
    'wss://nostr-relay.derekross.me',
    'wss://nostr-relay-dev.wlvs.space',
    'wss://nostr-relay.digitalmob.ro',
    'wss://nostr.relayer.se',
    'wss://nostr-relay.freeberty.net',
    'wss://nostr-relay.freedomnode.com',
    'wss://nostr-relay.gkbrk.com',
    'wss://nostr-relay.j3s7m4n.com',
    'wss://nostr-relay.lnmarkets.com',
    'wss://nostr-relay.nonce.academy',
    'wss://nostr-relay.schnitzel.world',
    'wss://nostr-relay.smoove.net',
    'wss://nostr-relay.trustbtc.org',
    'wss://nostr-relay.untethr.me',
    // 'wss://nostr-relay.untethr.me',
    'wss://nostr-relay.usebitcoin.space',
    'wss://nostr-relay.wlvs.space',
    'wss://nostr-relay.wolfandcrow.tech',
    'wss://nostr.rewardsbunny.com',
    'wss://nostr.robotechy.com',
    'wss://nostr.rocks',
    'wss://nostr.roundrockbitcoiners.com',
    'wss://nostr.sandwich.farm',
    'wss://nostr.satsophone.tk',
    'wss://nostr.screaminglife.io',
    'wss://nostr.sectiontwo.org',
    'wss://nostr.semisol.dev',
    'wss://nostr.shadownode.org',
    'wss://nostr.shawnyeager.net',
    'wss://nostr.shmueli.org',
    'wss://nostr.simatime.com',
    'wss://nostr.slothy.win',
    'wss://nostr.sovbit.com',
    'wss://nostr.supremestack.xyz',
    'wss://nostr.swiss-enigma.ch',
    'wss://nostr.thesimplekid.com',
    'wss://nostr.tunnelsats.com',
    'wss://nostr.unknown.place',
    'wss://nostr.uselessshit.co',
    'wss://nostr.utxo.lol',
    'wss://nostr.v0l.io',
    'wss://nostr-verified.wellorder.net',
    'wss://nostr-verif.slothy.win',
    'wss://nostr.vulpem.com',
    'wss://nostr.w3ird.tech',
    'wss://nostr.walletofsatoshi.com',
    'wss://no.str.watch',
    'wss://nostr.whoop.ph',
    'wss://nostr.xpersona.net',
    'wss://nostr.yael.at',
    'wss://nostr.zaprite.io',
    'wss://nostr.zebedee.cloud',
    'wss://nostr.zenon.wtf',
    'wss://nostr.zerofeerouting.com',
    'wss://nostr.zoomout.chat',
    'wss://paid.no.str.cr',
    'wss://pow32.nostr.land',
    'wss://private-nostr.v0l.io',
    'wss://public.nostr.swissrouting.com',
    'wss://relay.21spirits.io',
    'wss://relay.bitid.nz',
    'wss://relay.boring.surf',
    'wss://relay.cryptocculture.com',
    'wss://relay.cynsar.foundation',
    'wss://relay.damus.io',
    'wss://relay.dev.kronkltd.net',
    'wss://relayer.fiatjaf.com',
    'wss://relay.farscapian.com',
    'wss://relay.futohq.com',
    'wss://relay.grunch.dev',
    'wss://relay.kronkltd.net',
    'wss://relay.lexingtonbitcoin.org',
    'wss://relay.minds.com/nostr/v1/ws',
    'wss://relay.minds.io/nostr/v1/ws',
    'wss://relay.mynostr.id',
    'wss://relay.n057r.club',
    'wss://relay.nosphr.com',
    'wss://relay.nostr.au',
    'wss://relay.nostr.band',
    'wss://relay.nostr.bg',
    'wss://relay.nostr.ch',
    'wss://relay.nostr.express',
    'wss://relay.nostrgraph.net',
    'wss://relay.nostrich.de',
    'wss://relay.nostrid.com',
    'wss://relay.nostr.info',
    'wss://relay.nostr.lu.ke',
    'wss://relay.nostrmoto.xyz',
    'wss://relay.nostr.nu',
    'wss://relay.nostropolis.xyz/websocket',
    'wss://relay.nostr.pro',
    'wss://relay.nostrprotocol.net',
    'wss://relay.nostr.ro',
    'wss://relay.nostr.scot',
    'wss://relay.nostr.vision',
    'wss://relay.nostr.xyz',
    'wss://relay.nvote.co',
    'wss://relay.nvote.co:443',
    'wss://relay.nyx.ma',
    'wss://relay.oldcity-bitcoiners.info',
    'wss://relay-pub.deschooling.us',
    'wss://relay.r3d.red',
    'wss://relay.realsearch.cc',
    'wss://relay.ryzizub.com',
    'wss://nostr-01.dorafactory.org',
    'wss://relay.sendstr.com',
    'wss://relay.snort.social',
    'wss://relay.sovereign-stack.org',
    'wss://relay.stoner.com',
    'wss://relay.taxi',
    'wss://relay.valireum.net',
    'wss://rsslay.fiatjaf.com',
    'wss://rsslay.nostr.moe',
    'wss://rsslay.nostr.net',
    'wss://satstacker.cloud',
    'wss://sg.qemura.xyz',
    'wss://student.chadpolytechnic.com',
    'wss://wizards.wormrobot.org',
    'wss://wlvs.space',
    'wss://middling.myddns.me:8080',
    'wss://relay.nostr.or.jp'
    // 'ws://jgqaglhautb4k6e6i2g34jakxiemqp6z4wynlirltuukgkft2xuglmqd.onion'
  ].map(it=>{ return {
    url: it,
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
  window.expandedEvent = ""
})

const LIMIT = 100 // how many events to show
const throttleMs = 500
var received = []
const meta = {}
const follows = {}

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
        badge += ` Muted user ${nameFromPubkey(mutedPubkey)} (${reason})}}`
        break
    }
    case 60: {
        badge += ` Something about ride sharing: ${escapeHTML(event.content)}`
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

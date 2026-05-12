---
layout: none
permalink: /js/resources.js
---

// nostr.info/resources/ - nostr-native resource directory
// Loads from kind 30078 events, enriches with profiles, reactions, zaps

console.log('[resources.js] version: 20260512j');

const RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
  'wss://nostr.oxtr.dev',
  'wss://relay.snort.social',
];

// Public key of the nostr.info curator account (npub form — no private keys in repo)
const CURATOR_NPUB = 'npub1c4ptewkhdzhzqutt0tq60z44jzhw2pg9pj888m905pv3m23svcqska5c34';
const NAMESPACE   = 'nostr.info/resource';
const logR = (...a) => { try { console.log('[nostr.info]', ...a); } catch(e) {} };
const FALLBACK_MS = 8000;

let allResourceEvents = [];
let curatedResources  = [];
let communityResources = [];
let allResources      = [];
let allTags           = [];
let tagCounts         = {};
let activeTags        = ['client'];
let curatedOnly       = true;
let searchQuery       = '';
let loadedFrom        = '…';
let profileCache      = {};   // pubkey hex → {name, picture, npub, lud16}
let reactionCache     = {};   // slug → {byAuthor: {pubkeyHex: {emoji,eventId,created_at}}, zapMsat, zaps: [{senderHex,msat,created_at,eventId}]}

// renderOrder: slug[] — set once by relay data, never changed by user actions.
// This prevents cards jumping around when you like/dislike.
let renderOrder = null;

// ─── Bech32 helpers (for hex→npub) ───────────────────────────────────────────
const B32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function b32Polymod(v) {
  const G = [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  let c=1;
  for(const d of v){const b=c>>25;c=((c&0x1ffffff)<<5)^d;for(let i=0;i<5;i++)c^=(b>>i)&1?G[i]:0;}
  return c;
}
function b32HrpExpand(hrp){const r=[];for(const c of hrp)r.push(c.charCodeAt(0)>>5);r.push(0);for(const c of hrp)r.push(c.charCodeAt(0)&31);return r;}
function b32Convert(data,from,to,pad){
  let acc=0,bits=0,ret=[];
  const mv=(1<<to)-1,ma=(1<<(from+to-1))-1;
  for(const v of data){acc=((acc<<from)|v)&ma;bits+=from;while(bits>=to){bits-=to;ret.push((acc>>bits)&mv);}}
  if(pad&&bits)ret.push((acc<<(to-bits))&mv);
  return ret;
}
function b32Encode(hrp, bytes) {
  const data = b32Convert(Array.from(bytes),8,5,true);
  const combined=[...b32HrpExpand(hrp),...data];
  const pm=b32Polymod([...combined,0,0,0,0,0,0])^1;
  let r=hrp+'1';
  for(const d of data)r+=B32_CHARSET[d];
  for(let i=0;i<6;i++)r+=B32_CHARSET[(pm>>(5*(5-i)))&31];
  return r;
}
function b32Decode(bech) {
  const p=bech.lastIndexOf('1');
  if(p<1||p+7>bech.length)return null;
  const hrp=bech.slice(0,p),data=[];
  for(let i=p+1;i<bech.length;i++){const d=B32_CHARSET.indexOf(bech[i]);if(d<0)return null;data.push(d);}
  if(b32Polymod([...b32HrpExpand(hrp),...data])!==1)return null;
  return{hrp,data:data.slice(0,-6)};
}
// Decode npub/nsec → hex bytes
function bech32ToHex(bech32str) {
  const dec = b32Decode(bech32str.toLowerCase());
  if (!dec) return null;
  const bytes = b32Convert(dec.data, 5, 8, false);
  if (!bytes || bytes.length !== 32) return null;
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Resolved at startup — hex form used internally for pubkey comparisons
const CURATOR = bech32ToHex(CURATOR_NPUB);

function hexToNpub(hex) {
  const bytes=new Uint8Array(hex.length/2);
  for(let i=0;i<hex.length;i+=2)bytes[i/2]=parseInt(hex.slice(i,i+2),16);
  return b32Encode('npub',bytes);
}
function nsecToHex(nsec) {
  const dec=b32Decode(nsec.toLowerCase());
  if(!dec||dec.hrp!=='nsec')return null;
  const bytes=b32Convert(dec.data,5,8,false);
  if(!bytes||bytes.length!==32)return null;
  return bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
}
function normalizePubkey(raw) {
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  if (raw.toLowerCase().startsWith('npub1') && raw.length >= 60) {
    const h = bech32ToHex(raw);
    if (h) return h;
  }
  return null;
}

// ─── LNURL / Zap helpers ──────────────────────────────────────────────────────
async function fetchLnurlPay(lud16) {
  const [name, domain] = (lud16 || '').split('@');
  if (!name || !domain) return null;
  try {
    const res = await fetch(`https://${domain}/.well-known/lnurlp/${name}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'ERROR') return null;
    return data;
  } catch(e) { return null; }
}

async function fetchInvoice(callback, msats, signedZapReq) {
  try {
    const url = new URL(callback);
    url.searchParams.set('amount', String(msats));
    if (signedZapReq) url.searchParams.set('nostr', JSON.stringify(signedZapReq));
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === 'ERROR') return null;
    return data.pr || null;
  } catch(e) { return null; }
}

async function signZapRequest(recipientHex, eventId, msats) {
  const req = {
    kind: 9734,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', recipientHex],
      ...(eventId ? [['e', eventId]] : []),
      ['amount', String(msats)],
      ['relays', ...RELAYS.slice(0, 3)],
    ],
  };
  return await window.nostr.signEvent(req);
}

// Send a single NIP-57 zap to one recipient.
async function doZap(recipientHex, eventId, sats) {
  const prof = profileCache[recipientHex];
  if (!prof?.lud16) {
    alert('No lightning address found for this recipient. They may not have set one.');
    return false;
  }
  const lnurlData = await fetchLnurlPay(prof.lud16);
  if (!lnurlData) {
    alert(`Could not reach LNURL service for ${prof.lud16}`);
    return false;
  }
  const msats = sats * 1000;
  let signedReq = null;
  if (lnurlData.allowsNostr && window.nostr) {
    try { signedReq = await signZapRequest(recipientHex, eventId, msats); } catch(e) {}
  }
  const invoice = await fetchInvoice(lnurlData.callback, msats, signedReq);
  if (!invoice) {
    alert(`Could not get invoice from ${prof.lud16}`);
    return false;
  }
  window.location.href = 'lightning:' + invoice;
  return true;
}

// ─── Zap modal ────────────────────────────────────────────────────────────────
// Normalise split array into [{pubkey, sats}] given total sats.
function allocateSats(splits, totalSats) {
  const active = splits.filter(s => s.weight > 0);
  if (!active.length) return [];
  const totalW = active.reduce((a, s) => a + s.weight, 0);
  let remaining = totalSats;
  const result = active.map((s, i) => {
    const share = i === active.length - 1
      ? remaining
      : Math.floor(totalSats * s.weight / totalW);
    remaining -= share;
    return { pubkey: s.pubkey, sats: share };
  });
  return result.filter(r => r.sats > 0);
}

let _zapModal = null;
let _zapQueue  = false;
let _zapAllocs = [];  // current payment allocations, mutated as payments complete
let _zapEventId = '';
const _zapLnurlCache = new Map(); // pubkey → lnurlData, populated during pre-check

// ── NWC (Nostr Wallet Connect, NIP-47) ────────────────────────────────────────
const NWC_LS_KEY = 'nostr_wallet_connect';

function nwcGetConnection() {
  try { return JSON.parse(localStorage.getItem(NWC_LS_KEY) || 'null'); } catch { return null; }
}
function nwcSaveConnection(str) {
  try { localStorage.setItem(NWC_LS_KEY, JSON.stringify({ uri: str })); } catch {}
}
function nwcClearConnection() {
  try { localStorage.removeItem(NWC_LS_KEY); } catch {}
}

// Parse nostr+walletconnect:// URI
function nwcParse(uri) {
  try {
    const u = new URL(uri.replace('nostr+walletconnect://', 'https://'));
    const pubkey = u.hostname;
    const relays = u.searchParams.getAll('relay').map(r => r.trim()).filter(Boolean);
    const secret = u.searchParams.get('secret');
    if (!pubkey || relays.length === 0 || !secret) return null;
    return { pubkey, relays, secret };
  } catch { return null; }
}

// Send a pay_invoice NWC request and wait for response (timeout 30s)
async function nwcPayInvoice(conn, invoice) {
  if (!window.__nwcCrypto) throw new Error('NWC crypto not available');
  const key   = ensureNwcKey(conn.secret);
  const sk    = key.skBytes;
  const content   = JSON.stringify({ method: 'pay_invoice', params: { invoice } });
  const encrypted = window.__nwcCrypto.encrypt(sk, conn.pubkey, content);
  const reqEvent  = window.__nwcCrypto.finalizeEvent({
    kind: 23194,
    created_at: Math.floor(Date.now()/1000),
    tags: [['p', conn.pubkey]],
    content: encrypted,
  }, sk);

  // Try each relay in order; fail only when all have been exhausted.
  const relays = (conn.relays && conn.relays.length) ? conn.relays : [conn.relay];
  let lastErr = new Error('NWC relay error');
  for (const relay of relays) {
    try {
      const result = await new Promise((resolve, reject) => {
        let ws;
        const timer = setTimeout(() => { ws?.close(); reject(new Error('NWC timeout (30s)')); }, 30000);
        const since = Math.floor(Date.now()/1000) - 5;
        try {
          ws = new WebSocket(relay);
          ws.onopen = () => {
            ws.send(JSON.stringify(['REQ', 'nwc1', { kinds:[23195], '#e':[reqEvent.id], '#p':[key.pk], since, limit:1 }]));
            ws.send(JSON.stringify(['EVENT', reqEvent]));
          };
          ws.onmessage = msg => {
            try {
              const d = JSON.parse(msg.data);
              if (d[0]==='EVENT' && d[2]?.kind===23195) {
                clearTimeout(timer); ws.close();
                const dec = window.__nwcCrypto.decrypt(sk, conn.pubkey, d[2].content);
                const res = JSON.parse(dec);
                if (res.error) reject(new Error(res.error.message || 'NWC error'));
                else resolve(res.result);
              }
            } catch(e) {}
          };
          ws.onerror = () => { clearTimeout(timer); reject(new Error('NWC relay error')); };
        } catch(e) { clearTimeout(timer); reject(e); }
      });
      return result; // success on first working relay
    } catch (e) {
      lastErr = e;
      // try next relay
    }
  }
  throw lastErr;
}

// ── NWC key helper ────────────────────────────────────────────────────────────
let _nwcClientKey = null; // ephemeral session keypair for NWC requests
function ensureNwcKey(secretHex) {
  if (_nwcClientKey) return _nwcClientKey;
  let skBytes;
  if (secretHex) {
    skBytes = hexToBytes(secretHex);
  } else {
    skBytes = new Uint8Array(32);
    crypto.getRandomValues(skBytes);
  }
  const skHex = Array.from(skBytes).map(b=>b.toString(16).padStart(2,'0')).join('');
  const pk = window.__nwcCrypto.getPublicKey(skBytes);
  _nwcClientKey = { skHex, skBytes, pk };
  return _nwcClientKey;
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length/2);
  for (let i=0;i<arr.length;i++) arr[i]=parseInt(hex.slice(i*2,i*2+2),16);
  return arr;
}

// ── Zap trigger ───────────────────────────────────────────────────────────────
function triggerZapFromBtn(btn) {
  triggerZap(btn.dataset.eventid, btn.dataset.splits);
}

async function triggerZap(eventId, zapSplitsJson) {
  if (_zapQueue) return;
  let splits;
  try { splits = JSON.parse(zapSplitsJson); } catch(e) { splits = []; }
  splits = splits.map(s => ({ ...s, pubkey: normalizePubkey(s.pubkey) })).filter(s => s.pubkey && s.weight > 0);
  if (!splits.length) { alert('No recipients configured for this resource.'); return; }

  // Pre-check lud16 for each recipient (parallel)
  const totalW = splits.reduce((a, s) => a + s.weight, 0);
  _zapLnurlCache.clear();
  const recipients = await Promise.all(splits.map(async s => {
    const p    = profileCache[s.pubkey] || {};
    const npub = hexToNpub(s.pubkey);
    const name = p.name || (npub.slice(0,14)+'…');
    const pct  = Math.round(100 * s.weight / totalW);
    const lnurlData = p.lud16 ? await fetchLnurlPay(p.lud16).catch(()=>null) : null;
    if (lnurlData) _zapLnurlCache.set(s.pubkey, lnurlData); // cache for later use
    return { pubkey: s.pubkey, npub, name, pct, picture: p.picture, lud16: p.lud16, lnurlData, weight: s.weight };
  }));

  const zapable = recipients.filter(r => r.lnurlData);
  const noZap   = recipients.filter(r => !r.lnurlData);
  const zapW    = zapable.reduce((a, r) => a + r.weight, 0);
  zapable.forEach(r => { r.effectivePct = Math.round(100 * r.weight / (zapW || 1)); });

  showZapModal(eventId, recipients, zapable, noZap);
}

// ── Phase 1: amount entry ─────────────────────────────────────────────────────
function showZapModal(eventId, recipients, zapable, noZap) {
  let zm = document.getElementById('zapModal');
  if (!zm) {
    zm = document.createElement('div');
    zm.id = 'zapModal';
    zm.style.cssText = 'position:fixed;inset:0;z-index:9300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);font-family:system-ui,sans-serif;';
    zm.addEventListener('click', e => { if (e.target===zm) zm.style.display='none'; });
    document.body.appendChild(zm);
  }
  _zapModal   = zm;
  _zapEventId = eventId;

  const recipientRows = recipients.map(r => {
    const avatar   = `<img src="${r.picture ? esc(r.picture) : '/images/nostrich.webp'}" onerror="this.src='/images/nostrich.webp'" style="width:28px;height:28px;border-radius:50%;flex-shrink:0;">`;
    const nameLink = `<a href="https://njump.me/${r.npub}" target="_blank" style="color:#333;text-decoration:none;font-weight:500;">${esc(r.name)}</a>`;
    if (r.lnurlData) {
      return `<div class="zap-recipient-row zap-recipient-ok">
        ${avatar}
        <span class="zap-recipient-name">${nameLink}</span>
        <span class="zap-recipient-pct">${r.effectivePct}%</span>
      </div>`;
    }
    return `<div class="zap-recipient-row zap-recipient-nozap">
      ${avatar}
      <span class="zap-recipient-name">${nameLink}<span class="zap-nozap-hint"> — no lightning address</span></span>
      <a href="https://njump.me/${r.npub}" target="_blank" class="zap-setup-link">Ask ↗</a>
    </div>`;
  }).join('');

  const note = noZap.length && zapable.length
    ? `<p class="zap-modal-note">⚡ Skipping ${noZap.length} without lightning. ${zapable.length} will receive zaps.</p>`
    : !zapable.length
    ? `<p class="zap-modal-note zap-modal-note--warn">None of the contributors have a lightning address yet.</p>`
    : '';

  const nwcConn = nwcGetConnection();
  const nwcBadge = nwcConn
    ? `<span class="nwc-badge">⚡ Wallet connected</span>`
    : `<button class="nwc-connect-btn" onclick="openNwcConnect()">Connect wallet for one-tap zaps</button>`;

  const amountHtml = zapable.length ? `
    <div class="zap-amount-section">
      <div class="zap-presets">${[21,100,500,1000,5000].map(n=>`<button class="zap-preset" onclick="document.getElementById('zapAmountInput').value=${n};updateZapPreview(${n})">${n}</button>`).join('')}</div>
      <input id="zapAmountInput" type="number" min="1" value="1000"
        style="width:100%;padding:10px;border:1px solid #dadce0;border-radius:8px;font-size:16px;box-sizing:border-box;margin-top:6px;"
        oninput="updateZapPreview(parseInt(this.value)||0)"
        onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();zapProceed()}">
      <div id="zapPreview" style="margin-top:10px;font-size:12px;color:#888;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px;">
      <button onclick="zapProceed()" class="zap-send-btn">⚡ Zap</button>
    </div>
    <div style="margin-top:10px;">${nwcBadge}</div>` : '';

  zm.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:440px;width:100%;margin:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
      <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;font-size:16px;font-weight:700;">⚡ Zap</div>
      <div style="padding:16px 20px;">
        <div class="zap-recipients">${recipientRows}</div>
        ${note}
        ${amountHtml}
      </div>
    </div>`;
  zm.style.display = 'flex';
  zm.dataset.zapable = JSON.stringify(zapable.map(r => ({ pubkey: r.pubkey, weight: r.weight, name: r.name, npub: r.npub, picture: r.picture||'', lud16: r.lud16||'' })));
  setTimeout(() => { document.getElementById('zapAmountInput')?.focus(); updateZapPreview(1000); }, 50);
}

function updateZapPreview(total) {
  const el = document.getElementById('zapPreview');
  if (!el || !total) return;
  const zm = _zapModal;
  if (!zm) return;
  const zapable = JSON.parse(zm.dataset.zapable || '[]');
  const allocs  = allocateSats(zapable, total);
  el.innerHTML = allocs.map(a => {
    const r = zapable.find(x => x.pubkey === a.pubkey) || {};
    return `<span style="margin-right:10px;">${esc(r.name||'?')} <b>${a.sats}</b> sats</span>`;
  }).join('');
}

// ── Phase 2: pay each recipient ───────────────────────────────────────────────
async function zapProceed() {
  const zm = _zapModal;
  if (!zm || _zapQueue) return;
  const input   = document.getElementById('zapAmountInput');
  const total   = parseInt(input?.value || '0', 10);
  if (!total || total < 1) { input?.focus(); return; }
  const zapable = JSON.parse(zm.dataset.zapable || '[]');
  const allocs  = allocateSats(zapable, total);
  if (!allocs.length) return;

  // Enrich allocs with profile info
  _zapAllocs  = allocs.map(a => {
    const r = zapable.find(x => x.pubkey === a.pubkey) || {};
    return { ...a, name: r.name, npub: r.npub, picture: r.picture, lud16: r.lud16, status: 'pending' };
  });

  // Try NWC first if connected
  const nwcConn = nwcGetConnection();
  const nwcParsed = nwcConn ? nwcParse(nwcConn.uri) : null;
  if (nwcParsed && window.__nwcCrypto) {
    showZapPaymentPhase(allocs, total, 'nwc');
    await doNwcZaps(nwcParsed);
  } else {
    showZapPaymentPhase(allocs, total, 'manual');
  }
}

function showZapPaymentPhase(allocs, total, mode) {
  const zm = _zapModal;
  if (!zm) return;
  const rows = _zapAllocs.map((a, i) => {
    const avatar = `<img src="${a.picture || '/images/nostrich.webp'}" onerror="this.src='/images/nostrich.webp'" style="width:26px;height:26px;border-radius:50%;flex-shrink:0;">`;
    const nameLink = `<a href="https://njump.me/${a.npub}" target="_blank" style="color:#333;text-decoration:none;font-weight:500;">${esc(a.name||'?')}</a>`;
    const payBtn = mode === 'manual'
      ? `<button id="zapPayBtn${i}" class="zap-pay-btn" onclick="zapPayOne(${i})">Pay ${a.sats} sats</button>`
      : `<span id="zapPayBtn${i}" class="zap-pay-status zap-paying">…</span>`;
    return `<div class="zap-pay-row" id="zapPayRow${i}">${avatar}<span class="zap-pay-name">${nameLink}</span>${payBtn}</div>`;
  }).join('');

  zm.querySelector('div > div:last-child').innerHTML = `
    <div style="font-size:13px;color:#888;margin-bottom:10px;">Total: <b>${total} sats</b></div>
    <div class="zap-pay-list">${rows}</div>
    ${mode==='manual' ? '<p class="zap-modal-note" style="margin-top:10px;">Pay each invoice — your wallet app will open. Come back to pay the next.</p>' : ''}`;
  _zapQueue = true;
}

async function zapPayOne(idx) {
  const a = _zapAllocs[idx];
  if (!a || a.status !== 'pending') return;
  const btn = document.getElementById(`zapPayBtn${idx}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  a.status = 'opening';
  try {
    const lnurlData = _zapLnurlCache.get(a.pubkey)
      || await fetchLnurlPay(a.lud16).catch(()=>null);
    if (!lnurlData) throw new Error('LNURL unreachable');
    const msats = a.sats * 1000;
    let signedReq = null;
    if (lnurlData.allowsNostr && window.nostr) {
      try { signedReq = await signZapRequest(a.pubkey, _zapEventId, msats); } catch(e) {}
    }
    const invoice = await fetchInvoice(lnurlData.callback, msats, signedReq);
    if (!invoice) throw new Error('No invoice');
    window.location.href = 'lightning:' + invoice;
    setTimeout(() => markZapPaid(idx), 3000);
  } catch(e) {
    a.status = 'error';
    if (btn) { btn.disabled = false; btn.textContent = `Retry ${a.sats} sats`; btn.style.background='#fce8e6'; }
  }
}

function markZapPaid(idx) {
  const a = _zapAllocs[idx];
  if (!a) return;
  a.status = 'paid';
  const btn = document.getElementById(`zapPayBtn${idx}`);
  if (btn) { btn.className = 'zap-pay-status zap-paid'; btn.textContent = 'Paid ✓'; }
  const allDone = _zapAllocs.every(x => x.status === 'paid' || x.status === 'skipped');
  if (allDone) { _zapQueue = false; setTimeout(() => { if (_zapModal) _zapModal.style.display='none'; }, 1500); }
}

async function doNwcZaps(conn) {
  // Use _zapAllocs (enriched with lud16) not the bare allocations arg
  const results = await Promise.allSettled(_zapAllocs.map(async (a, i) => {
    const lnurlData = _zapLnurlCache.get(a.pubkey)
      || await fetchLnurlPay(a.lud16).catch(()=>null);
    if (!lnurlData) throw new Error(`No lightning address for ${a.name}`);
    const msats = a.sats * 1000;
    let signedReq = null;
    if (lnurlData.allowsNostr && window.nostr) {
      try { signedReq = await signZapRequest(a.pubkey, _zapEventId, msats); } catch(e) {}
    }
    const invoice = await fetchInvoice(lnurlData.callback, msats, signedReq);
    if (!invoice) throw new Error(`Could not get invoice for ${a.name}`);
    await nwcPayInvoice(conn, invoice);
    markZapPaid(i);
  }));
  _zapQueue = false;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      _zapAllocs[i].status = 'error';
      const btn = document.getElementById(`zapPayBtn${i}`);
      if (btn) {
        btn.className = 'zap-pay-status';
        btn.textContent = 'Failed — ' + (r.reason?.message || 'unknown error');
        btn.style.color = '#c5221f';
      }
    }
  });
}

// ── NWC connect UI ────────────────────────────────────────────────────────────
function openNwcConnect() {
  let dm = document.getElementById('nwcModal');
  if (!dm) {
    dm = document.createElement('div');
    dm.id = 'nwcModal';
    dm.style.cssText = 'position:fixed;inset:0;z-index:9400;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);font-family:system-ui,sans-serif;';
    dm.addEventListener('click', e => { if (e.target===dm) dm.style.display='none'; });
    document.body.appendChild(dm);
  }
  const existing = nwcGetConnection();
  dm.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:400px;width:100%;margin:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
      <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;font-size:16px;font-weight:700;">⚡ Connect Lightning Wallet</div>
      <div style="padding:16px 20px;">
        <p style="font-size:13px;color:#555;margin:0 0 12px;">Connect a NWC-compatible wallet (Alby Hub, Mutiny, etc.) to pay all split recipients at once without leaving the page.</p>
        <label style="font-size:12px;font-weight:600;color:#444;display:block;margin-bottom:6px;">Wallet connection string</label>
        <input id="nwcUriInput" type="text" placeholder="nostr+walletconnect://..."
          style="width:100%;padding:10px;border:1px solid #dadce0;border-radius:8px;font-size:13px;font-family:monospace;box-sizing:border-box;"
          value="${existing ? existing.uri : ''}">
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button onclick="saveNwcConnection()" style="flex:1;padding:10px;border:none;border-radius:8px;background:#f59e0b;color:#fff;font-weight:700;cursor:pointer;">Save</button>
          ${existing ? `<button onclick="nwcClearConnection();document.getElementById('nwcModal').style.display='none'" style="padding:10px 14px;border:1px solid #dadce0;border-radius:8px;background:#fff;cursor:pointer;color:#c5221f;">Disconnect</button>` : ''}
        </div>
        <p style="font-size:11px;color:#aaa;margin:8px 0 0;">Stored in localStorage. Gives spending access — use a budget-limited connection.</p>
      </div>
    </div>`;
  dm.style.display = 'flex';
  setTimeout(() => document.getElementById('nwcUriInput')?.focus(), 50);
}

function saveNwcConnection() {
  const val = document.getElementById('nwcUriInput')?.value?.trim();
  if (!val || !val.startsWith('nostr+walletconnect://')) {
    alert('Please paste a valid nostr+walletconnect:// connection string.');
    return;
  }
  if (!nwcParse(val)) { alert('Could not parse connection string.'); return; }
  nwcSaveConnection(val);
  document.getElementById('nwcModal').style.display = 'none';
  // Re-render zap modal if open
  if (_zapModal && _zapModal.style.display !== 'none') {
    const badge = _zapModal.querySelector('.nwc-connect-btn');
    if (badge) badge.outerHTML = `<span class="nwc-badge">⚡ Wallet connected</span>`;
  }
}
// ─── Zap details modal (who zapped + who gets paid) ───────────────────────────
function showZapDetails(slug) {
  const r = allResources.find(x => x.slug === slug);
  const rc = reactionCache[slug] || { byAuthor: {}, zapMsat: 0, zaps: [] };
  let dm = document.getElementById('zapDetailsModal');
  if (!dm) {
    dm = document.createElement('div');
    dm.id = 'zapDetailsModal';
    dm.style.cssText = 'position:fixed;inset:0;z-index:9350;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);font-family:system-ui,sans-serif;';
    dm.addEventListener('click', e => { if (e.target===dm) dm.style.display='none'; });
    document.body.appendChild(dm);
  }
  dm.style.display = 'flex';

  // Zaps list (one row per zap receipt — each is a single payment)
  const zaps = (rc.zaps || []).sort((a,b) => b.created_at - a.created_at);
  const zapperRows = zaps.length ? zaps.map(z => {
    const p = profileCache[z.senderHex] || {};
    const npub = hexToNpub(z.senderHex);
    const name = p.name || (npub.slice(0,12)+'…');
    const sats = Math.floor(z.msat / 1000);
    const ago = timeAgo(z.created_at);
    const avatar = `<img class="zd-avatar" src="${p.picture ? esc(p.picture) : '/images/nostrich.webp'}" onerror="this.src='/images/nostrich.webp'">`;
    return `<div class="zd-row">
      <a href="https://njump.me/${npub}" target="_blank">${avatar}</a>
      <span class="zd-name"><a href="https://njump.me/${npub}" target="_blank">${esc(name)}</a></span>
      <span class="zd-amount">${sats} sats</span>
      <span class="zd-ago">${ago}</span>
    </div>`;
  }).join('') : '<p class="zd-empty">No zaps yet. Be the first! ⚡</p>';

  dm.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:460px;width:100%;margin:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.2);max-height:80vh;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;font-size:16px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
        ⚡ Zaps (${zaps.length})
        <button onclick="document.getElementById('zapDetailsModal').style.display='none'" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888;line-height:1;">&times;</button>
      </div>
      <div style="padding:16px 20px;overflow-y:auto;flex:1;">
        <div class="zd-section">${zapperRows}</div>
      </div>
    </div>`;
}

function timeAgo(ts) {
  const s = Math.floor(Date.now()/1000) - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  if (s < 86400*30) return Math.floor(s/86400) + 'd ago';
  return Math.floor(s/86400/30) + 'mo ago';
}


// ─── Escaping ─────────────────────────────────────────────────────────────────
function esc(t) {
  const d=document.createElement('div');d.textContent=t;return d.innerHTML;
}

// ─── Markdown editor helpers ──────────────────────────────────────────────────
function mdWrap(id, before, after) {
  const ta = document.getElementById(id);
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'text';
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  ta.focus();
}
function mdLink(id) {
  const ta = document.getElementById(id);
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'link text';
  const url = prompt('URL:', 'https://');
  if (!url) return;
  const ins = `[${sel}](${url})`;
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  ta.setSelectionRange(s, s + ins.length);
  ta.focus();
}
function mdPrefix(id, prefix) {
  const ta = document.getElementById(id);
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  const lines = ta.value.slice(s, e).split('\n');
  const ins = lines.map(l => prefix + l).join('\n');
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  ta.setSelectionRange(s, s + ins.length);
  ta.focus();
}
// Calls fn() immediately if logged in, otherwise opens login modal then calls fn().
// fn() is deferred until loggedInPubkey is actually set.
function requireLogin(fn) {
  if (loggedInPubkey) { fn(); return; }
  launchLogin();
  const h = async (e) => {
    if (e.detail.type !== 'login' && e.detail.type !== 'signup') return;
    document.removeEventListener('nlAuth', h, true);
    // Wait until the main nlAuth handler sets loggedInPubkey (it's async due to getPublicKey)
    for (let i = 0; i < 20 && !loggedInPubkey; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
    fn();
  };
  document.addEventListener('nlAuth', h, true);
}

// ─── In-place card patching (no full re-render for counter updates) ──────────
// Updates only the action bar of a specific card without touching sort order or
// other cards. Used for reactions so the list doesn't jump around.
function patchCardActions(slug) {
  const r = allResources.find(x => x.slug === slug);
  if (!r) return;
  const rc      = reactionCache[slug] || { byAuthor: {}, zapMsat: 0 };
  const counts  = reactionCounts(rc);
  const myVote  = loggedInPubkey ? rc.byAuthor[loggedInPubkey]?.emoji : null;
  const likeN   = counts['+'] || 0;
  const dislikeN= counts['-'] || 0;
  const slug_   = esc(r.slug);
  const aHex    = esc(r.pubkeyHex || '');

  // Patch the 👍/👎 buttons by finding the .resource-actions div inside the same card
  const repliesDiv = document.getElementById(`replies-${slug_}`);
  const actionsDiv = repliesDiv?.closest('.resource-card,.resource-card-proposal')?.querySelector('.resource-actions');
  if (!actionsDiv) return;

  const btns = actionsDiv.querySelectorAll('.action-btn');
  if (btns.length < 2) return;

  // 👍 button (index 0)
  btns[0].className = `action-btn${myVote==='+'?' action-active':''}`;
  btns[0].title = myVote==='+' ? 'Remove like' : 'Like';
  btns[0].innerHTML = `👍${likeN?' '+likeN:''}`;

  // 👎 button (index 1)
  btns[1].className = `action-btn${myVote==='-'?' action-active':''}`;
  btns[1].title = myVote==='-' ? 'Remove dislike' : 'Dislike';
  btns[1].innerHTML = `👎${dislikeN?' '+dislikeN:''}`;

  // Also patch stats bar counters
  const likeStats = document.querySelectorAll('.stat.community');
  // (stats bar is separate, leave it alone — it'll update on next full render)
}
// reactionCache keyed by SLUG (stable across event replacements).
// Structure: { byAuthor: { pubkeyHex: { emoji, eventId } }, zapMsat: 0, zaps: [...] }
// The `a` tag `30078:<authorHex>:<slug>` is the stable NIP-01 address.

function slugToAddr(slug, authorHex) {
  return `30078:${authorHex}:${slug}`;
}

// Compute display counts from byAuthor: last reaction per author wins.
function reactionCounts(rc) {
  const counts = {};
  Object.values(rc.byAuthor || {}).forEach(({ emoji }) => {
    counts[emoji] = (counts[emoji] || 0) + 1;
  });
  return counts;
}

async function reactToResource(slug, authorHex, emoji) {
  requireLogin(async () => {
    const addr = slugToAddr(slug, authorHex);
    if (!reactionCache[slug]) reactionCache[slug] = { byAuthor: {}, zapMsat: 0, zaps: [] };
    const rc = reactionCache[slug];
    const existing = rc.byAuthor[loggedInPubkey];

    // If same emoji already: delete it (toggle off)
    if (existing && existing.emoji === emoji) {
      try {
        const del = {
          kind: 5,
          content: '',
          created_at: Math.floor(Date.now() / 1000),
          tags: [['e', existing.eventId]],
        };
        const signed = await window.nostr.signEvent(del);
        await publishEvent(signed);
        delete rc.byAuthor[loggedInPubkey];
        patchCardActions(slug);   // update button in-place, no list jump
      } catch(e) { console.error('delete reaction failed:', e); }
      return;
    }

    // Delete previous reaction of different emoji if any
    if (existing) {
      try {
        const del = {
          kind: 5,
          content: '',
          created_at: Math.floor(Date.now() / 1000),
          tags: [['e', existing.eventId]],
        };
        const signed = await window.nostr.signEvent(del);
        await publishEvent(signed);
      } catch(e) { /* best effort */ }
    }

    // Publish new reaction referencing the stable `a` address
    try {
      const ev = {
        kind: 7,
        content: emoji,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['a', addr],
          ['p', authorHex],
          ['k', '30078'],
        ],
      };
      const signed = await window.nostr.signEvent(ev);
      await publishEvent(signed);
      rc.byAuthor[loggedInPubkey] = { emoji, eventId: signed.id };
      patchCardActions(slug);   // update counter in-place, no list jump
    } catch(e) { console.error('react failed:', e); }
  });
}

// ─── Replies (NIP-1 kind:1, referencing stable `a` address) ─────────────────
// replyCache keyed by SLUG. Fetches by #a filter so replies survive replacement.
const replyCache = {};

async function loadReplies(slug, authorHex) {
  if (!replyCache[slug]) replyCache[slug] = [];
  const seen = new Set();
  const addr = slugToAddr(slug, authorHex);
  await queryAll(RELAYS.slice(0, 2), { kinds: [1], '#a': [addr], limit: 50 }, ev => {
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    if (replyCache[slug].find(r => r.id === ev.id)) return;
    replyCache[slug].push({ id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at });
    if (!profileCache[ev.pubkey]) {
      queryAll(RELAYS.slice(0, 1), { kinds: [0], authors: [ev.pubkey] }, pev => {
        try {
          const c = JSON.parse(pev.content);
          profileCache[ev.pubkey] = { name: c.display_name||c.name||'', picture: c.picture||'', lud16: c.lud16||'', npub: hexToNpub(ev.pubkey) };
        } catch(e) {}
      }, 3000);
    }
  }, 6000);
  replyCache[slug].sort((a, b) => a.created_at - b.created_at);
  patchReplyCount(slug);
}

function toggleReplies(slug, authorHex) {
  const wrap = document.getElementById('replies-' + slug);
  if (!wrap) return;
  if (wrap.dataset.open === '1') {
    wrap.innerHTML = '';
    wrap.dataset.open = '0';
    return;
  }
  wrap.dataset.open = '1';
  wrap.innerHTML = '<p style="color:#888;font-size:12px;padding:6px 0;">Loading replies…</p>';
  loadReplies(slug, authorHex).then(() => renderReplies(slug, authorHex));
}

function renderReplies(slug, authorHex) {
  const wrap = document.getElementById('replies-' + slug);
  if (!wrap || wrap.dataset.open !== '1') return;
  const replies = replyCache[slug] || [];
  const items = replies.map(r => {
    const p = profileCache[r.pubkey] || {};
    const npub = hexToNpub(r.pubkey);
    const name = p.name || (npub.slice(0,12)+'…');
    const avatar = p.picture
      ? `<img class="avatar" src="${esc(p.picture)}" onerror="this.src='/images/nostrich.webp'" style="width:18px;height:18px;">`
      : `<img class="avatar" src="/images/nostrich.webp" style="width:18px;height:18px;">`;
    const when = new Date(r.created_at * 1000).toLocaleDateString();
    return `<div class="reply-item">
      <span class="reply-author">${avatar} <a href="https://njump.me/${npub}" target="_blank">${esc(name)}</a> <span class="reply-date">${when}</span></span>
      <span class="reply-content">${esc(r.content)}</span>
    </div>`;
  }).join('');
  wrap.innerHTML = (items || '<p style="color:#888;font-size:12px;padding:4px 0;">No replies yet.</p>')
    + `<div class="reply-compose">
      <textarea id="reply-text-${slug}" rows="2" placeholder="Write a reply…" style="width:100%;padding:6px;box-sizing:border-box;font-size:13px;border:1px solid #dadce0;border-radius:6px;resize:vertical;"></textarea>
      <button class="split-add-btn" style="margin-top:4px;" onclick="postReply('${esc(slug)}','${esc(authorHex)}')">Reply</button>
    </div>`;
}

function patchReplyCount(slug) {
  const wrap = document.getElementById('replies-' + slug);
  if (!wrap) return;
  let actionsDiv = wrap.previousElementSibling;
  if (actionsDiv && actionsDiv.classList.contains('resource-proposals')) {
    actionsDiv = actionsDiv.previousElementSibling;
  }
  if (!actionsDiv || !actionsDiv.classList.contains('resource-actions')) return;
  const btns = actionsDiv.querySelectorAll('.action-btn');
  if (btns.length < 3) return;
  const n = (replyCache[slug] || []).length;
  btns[2].textContent = '💬 Replies' + (n ? ' ' + n : '');
}

async function postReply(slug, authorHex) {
  requireLogin(async () => {
    const ta = document.getElementById('reply-text-' + slug);
    const content = ta?.value?.trim();
    if (!content) return;
    const addr = slugToAddr(slug, authorHex);
    try {
      const ev = {
        kind: 1,
        content,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['a', addr, '', 'root'],
          ['p', authorHex],
        ],
      };
      const signed = await window.nostr.signEvent(ev);
      await publishEvent(signed);
      if (!replyCache[slug]) replyCache[slug] = [];
      if (!replyCache[slug].find(r => r.id === signed.id)) {
        replyCache[slug].push({ id: signed.id, pubkey: signed.pubkey, content, created_at: signed.created_at });
      }
      if (ta) ta.value = '';
      renderReplies(slug, authorHex);
      patchReplyCount(slug);
    } catch(e) { alert('Reply failed: ' + (e.message||e)); }
  });
}

// ─── Markdown → HTML (blockquotes, bold, links, code) ─────────────────────────
function mdToHtml(raw) {
  if (!raw) return '';
  const lines = raw.split('\n');
  const out = [];
  let inUl = false, inOl = false;

  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  const parseInline = (text) => {
    const tokens = [];
    const save = (html) => {
      tokens.push(html);
      return '§§T' + (tokens.length - 1) + '§§';
    };
    let s = text;
    s = s.replace(/`([^`]+)`/g, (m, code) => save('<code>' + esc(code) + '</code>'));
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, url) => save('<a href="' + esc(url) + '" target="_blank">' + esc(txt) + '</a>'));
    s = s.replace(/\*\*(.+?)\*\*/g, (m, inner) => save('<strong>' + esc(inner) + '</strong>'));
    s = s.replace(/__(.+?)__/g, (m, inner) => save('<strong>' + esc(inner) + '</strong>'));
    s = s.replace(/\*(.+?)\*/g, (m, inner) => save('<em>' + esc(inner) + '</em>'));
    s = s.replace(/_(.+?)_/g, (m, inner) => save('<em>' + esc(inner) + '</em>'));
    s = s.replace(/~~(.+?)~~/g, (m, inner) => save('<del>' + esc(inner) + '</del>'));
    const d = document.createElement('div');
    d.textContent = s;
    s = d.innerHTML;
    s = s.replace(/§§T(\d+)§§/g, (m, i) => tokens[+i]);
    return s;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blockquotes: collect consecutive lines and recursively parse inner content
    if (/^\s*>/.test(line)) {
      closeLists();
      const bqLines = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        bqLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      i--; // step back so outer loop increments correctly
      const innerHtml = mdToHtml(bqLines.join('\n'));
      out.push('<blockquote>' + innerHtml + '</blockquote>');
      continue;
    }

    // Headings (# ## ###)
    if (/^#{1,3}\s+/.test(trimmed)) {
      closeLists();
      const level = trimmed.match(/^(#{1,3})\s+/)[1].length;
      const text = trimmed.replace(/^#{1,3}\s+/, '');
      out.push('<h' + level + '>' + parseInline(text) + '</h' + level + '>');
      continue;
    }

    if (/^[-+*]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^[-+*]\s+/, '');
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push('<li>' + parseInline(item) + '</li>');
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const item = trimmed.replace(/^\d+\.\s+/, '');
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push('<li>' + parseInline(item) + '</li>');
      continue;
    }
    closeLists();
    if (trimmed) {
      out.push('<p>' + parseInline(trimmed) + '</p>');
    }
  }
  closeLists();
  return out.join('');
}

// ─── Relay helpers ────────────────────────────────────────────────────────────
function query(relayUrl, filter, onEvent, onEose, timeoutMs=8000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if(!done){done=true;try{ws.close();}catch(e){}resolve();} };
    let ws;
    try {
      ws = new WebSocket(relayUrl);
    } catch(e) { resolve(); return; }
    const sub = 'sub_' + Math.random().toString(36).slice(2);
    ws.onopen    = () => ws.send(JSON.stringify(['REQ', sub, filter]));
    ws.onmessage = msg => {
      const d = JSON.parse(msg.data);
      if (d[0]==='EVENT' && d[1]===sub) onEvent(d[2]);
      if (d[0]==='EOSE') { onEose?.(); finish(); }
    };
    ws.onerror = finish;
    ws.onclose = finish;  // relay closed without EOSE — don't wait for timeout
    setTimeout(finish, timeoutMs);
  });
}

async function queryAll(relays, filter, onEvent, timeoutMs=8000) {
  await Promise.all(relays.map(url => query(url, filter, onEvent, null, timeoutMs)));
}

// ─── IDB cache ────────────────────────────────────────────────────────────────────────────────
const IDB_NAME    = 'nostr-resources';
const IDB_STORE   = 'events';
const IDB_VERSION = 1;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbLoadAll() {
  try {
    logR("idb:loadAll:start");
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  } catch(e) { return []; }
}

async function idbSaveAll(events) {
  try {
    if (!events.length) return;
    logR("idb:saveAll:", events.length);
    const db = await idbOpen();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    events.forEach(ev => { if (ev.id) store.put(ev); });
    return new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch(e) {}
}

// ─── Loading ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function connectRelays() {
  logR("connectRelays:start");
  // 1. Show IDB cache immediately so something renders while relays load
  const cached = await idbLoadAll();
  if (cached.length > 0) {
    logR("connectRelays:idb loaded", cached.length, "events");
    // Route cached events by kind: entries first, then profiles, then reactions/zaps
    const entryEvents = [];
    const profileEvents = [];
    const reactionEvents = [];
    cached.forEach(ev => {
      if (ev.kind === 30078) entryEvents.push(ev);
      else if (ev.kind === 0) profileEvents.push(ev);
      else if (ev.kind === 7 || ev.kind === 9735 || ev.kind === 1) reactionEvents.push(ev);
    });
    entryEvents.forEach(ev => { if (!allResourceEvents.some(e => e.id === ev.id)) allResourceEvents.push(ev); });
    loadedFrom = 'cache';
    const cachedSlugs = new Set(entryEvents.map(ev => ev.tags?.find(t=>t[0]==='d')?.[1]).filter(Boolean));
    setStatus('⧳ Showing ' + cachedSlugs.size + ' cached resources — loading fresh from relays…');
    dedupAndRender();
    // Now that eventIdToSlug is built, hydrate profiles and reactions from cache
    profileEvents.forEach(ev => {
      try {
        const c = JSON.parse(ev.content);
        profileCache[ev.pubkey] = {
          name:    c.display_name || c.name || '',
          picture: c.picture || '',
          npub:    hexToNpub(ev.pubkey),
          lud16:   c.lud16 || '',
        };
      } catch(e){}
    });
    reactionEvents.forEach(ev => {
      if (ev.kind === 1) handleReplyEv(ev);
      else handleReactionEv(ev);
    });
    render();
    loadSecondary();
  } else {
    logR("connectRelays:idb empty");
    setStatus('⧳ Loading resources from nostr relays…');
  }

  // 2. Fetch fresh from all relays in parallel; update when all done
  const seenIds   = new Set(allResourceEvents.map(e => e.id));
  let doneCount   = 0;
  let relayDone   = false;
  const TOTAL     = RELAYS.length;
  const newEvents = [];

  const tryRender = () => {
    if (relayDone) return;
    relayDone = true;
    loadedFrom = 'nostr';
    logR("tryRender: relay load done, newEvents:", newEvents.length, "cached:", cached.length);
    if (newEvents.length > 0 || cached.length === 0) {
      // New events arrived or nothing was in cache — do a full render
      if (allResourceEvents.length > 0) idbSaveAll(allResourceEvents);
      renderOrder = null;
      dedupAndRender();
      loadSecondary();
    }
    // Always update status: relay load done, live subscription still watching
    setStatus('👁 Watching for updates…');
  };

  RELAYS.forEach(url => {
    try {
      logR("ws:creating", url);
      const ws = new WebSocket(url);
      let done = false;
      const finish = () => { if (done) return; done = true; if (++doneCount >= TOTAL) tryRender(); };
      ws.onopen = () => {
        logR("ws:open", url);
        ws.send(JSON.stringify(['REQ','r1',{kinds:[30078],'#t':[NAMESPACE],limit:1000}]));
      };
      ws.onmessage = msg => {
        try {
          const d = JSON.parse(msg.data);
          if (d[0]==='EVENT' && !seenIds.has(d[2].id)) {
            seenIds.add(d[2].id);
            allResourceEvents.push(d[2]);
            newEvents.push(d[2]);
            if (newEvents.length <= 3 || newEvents.length % 50 === 0) logR('ws:event', url, 'id:', d[2].id?.slice(0,8)+'…', 'slug:', d[2].tags?.find(t=>t[0]==='d')?.[1]||'?');
          }
          if (d[0]==='EOSE') { logR('ws:eose', url, 'events:', newEvents.length); ws.close(); finish(); }
        } catch(e) {}
      };
      ws.onclose = () => { logR("ws:close", url); finish(); };
      ws.onerror = (err) => { logR("ws:error", url, err?.type || ''); finish(); };
    } catch(e) { logR("ws:construct-error", url, e.message); if (++doneCount >= TOTAL) tryRender(); }
  });

  // Hard timeout — render whatever we have after FALLBACK_MS
  setTimeout(() => { if (!relayDone) { logR("connectRelays:FALLBACK_MS timeout", FALLBACK_MS, "ms"); tryRender(); } }, FALLBACK_MS);
}

// ─── Live subscription for new events ────────────────────────────────────────
function startLiveSubscription() {
  logR("liveSub:start");
  const since = Math.floor(Date.now() / 1000);
  // Connect to a subset of reliable relays to avoid too many connections
  ['wss://relay.primal.net', 'wss://nos.lol', 'wss://nostr.oxtr.dev'].forEach(url => {
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => { logR("liveSub:open", url); ws.send(JSON.stringify(['REQ','live',{kinds:[30078],'#t':[NAMESPACE],since,limit:0}])); };
      ws.onmessage = msg => {
        const d = JSON.parse(msg.data);
        if (d[0] !== 'EVENT') return;
        const ev = d[2];
        if (allResourceEvents.some(e => e.id === ev.id)) return; // already have it
        allResourceEvents.push(ev);
        renderOrder = null;
        dedupAndRender();
        // Flash the new entry briefly to signal it appeared
        const slug = ev.tags?.find(t=>t[0]==='d')?.[1];
        if (slug) setTimeout(() => {
          const el = document.querySelector(`[data-slug="${slug}"]`);
          if (el) { el.classList.add('card-flash'); setTimeout(() => el.classList.remove('card-flash'), 1500); }
        }, 50);
      };
      ws.onerror = (e) => logR("liveSub:error", url, e?.type);
      ws.onclose = () => logR("liveSub:close", url);
    } catch(e) {}
  });
}

// ─── Reaction / Zap event processor (used for fresh AND cached events) ────────
function handleReplyEv(ev) {
  const aTag = ev.tags.find(t => t[0] === 'a')?.[1];
  if (!aTag) return;
  const slug = aTag.split(':').slice(2).join(':') || null;
  if (!slug) return;
  if (!replyCache[slug]) replyCache[slug] = [];
  if (!replyCache[slug].find(r => r.id === ev.id)) {
    replyCache[slug].push({ id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at });
    replyCache[slug].sort((a, b) => a.created_at - b.created_at);
  }
}

function handleReactionEv(ev) {
  // Try #a tag first (stable address)
  const aTag = ev.tags.find(t => t[0] === 'a')?.[1];
  let slug = null;
  if (aTag) {
    slug = aTag.split(':').slice(2).join(':') || null;
  }
  // Fall back to #e tag — use eventIdToSlug reverse map which covers ALL versions
  if (!slug) {
    const eTag = ev.tags.find(t => t[0] === 'e')?.[1];
    if (eTag) slug = eventIdToSlug[eTag] || null;
  }
  if (!slug) return;
  if (!reactionCache[slug]) reactionCache[slug] = { byAuthor: {}, zapMsat: 0, zaps: [] };
  const rc = reactionCache[slug];

  if (ev.kind === 7) {
    const emoji = ev.content || '+';
    const prev = rc.byAuthor[ev.pubkey];
    if (!prev || ev.created_at >= prev.created_at) {
      rc.byAuthor[ev.pubkey] = { emoji, eventId: ev.id, created_at: ev.created_at };
    }
  }
  if (ev.kind === 9735) {
    try {
      const desc = ev.tags.find(t => t[0] === 'description')?.[1];
      const zapReq = JSON.parse(desc || '{}');
      const amountTag = zapReq.tags?.find(t => t[0] === 'amount');
      const msat = amountTag ? parseInt(amountTag[1] || 0) : 0;
      rc.zaps = rc.zaps || [];
      if (msat > 0 && !rc.zaps.find(z => z.eventId === ev.id)) {
        rc.zapMsat += msat;
        rc.zaps.push({
          senderHex: zapReq.pubkey || ev.pubkey,
          msat,
          created_at: ev.created_at,
          eventId: ev.id,
        });
      }
    } catch(e) {}
  }
}

// ─── Secondary: profiles, reactions, zaps ────────────────────────────────────
async function loadSecondary() {
  const secondaryEvents = []; // collect for IDB cache
  const trackEv = (ev) => { secondaryEvents.push(ev); };

  // Profiles: submitters + everyone in zap-split lists (NOT the curator pubkey)
  const pubkeys = [...new Set([
    ...allResources.map(r => r.submitterPubkey || r.pubkeyHex).filter(Boolean),
    ...allResources.flatMap(r => r.zapSplits.map(s => s.pubkey)),
  ])];
  if (pubkeys.length > 0) {
    const seen = new Set();
    await queryAll(RELAYS.slice(0,3), {kinds:[0], authors: pubkeys}, ev => {
      if (seen.has(ev.pubkey)) return;
      seen.add(ev.pubkey);
      trackEv(ev);
      try {
        const c = JSON.parse(ev.content);
        profileCache[ev.pubkey] = {
          name:    c.display_name || c.name || '',
          picture: c.picture || '',
          npub:    hexToNpub(ev.pubkey),
          lud16:   c.lud16 || '',
        };
      } catch(e){}
    }, 6000);
  }

  // Reactions (kind 7), zap receipts (kind 9735), and replies (kind 1)
  const addrs = allResources
    .filter(r => r.pubkeyHex && r.slug)
    .map(r => slugToAddr(r.slug, r.pubkeyHex));

  const allVersionEventIds = Object.values(slugEventIds)
    .flatMap(s => [...s])
    .filter(id => id && id.length === 64);

  const chunks = (arr) => { const r = []; for (let i=0;i<arr.length;i+=200) r.push(arr.slice(i,i+200)); return r; };
  const promises = [];
  if (addrs.length > 0) {
    for (const chunk of chunks(addrs)) {
      promises.push(queryAll(RELAYS, { kinds:[1,7,9735], '#a': chunk }, ev => {
        trackEv(ev);
        if (ev.kind === 1) handleReplyEv(ev);
        else handleReactionEv(ev);
      }, 8000));
    }
  }
  if (allVersionEventIds.length > 0) {
    for (const chunk of chunks(allVersionEventIds)) {
      promises.push(queryAll(RELAYS, { kinds:[7,9735], '#e': chunk }, ev => { trackEv(ev); handleReactionEv(ev); }, 8000));
    }
  }
  await Promise.all(promises);

  // Cache all secondary events (profiles, reactions, zaps) to IDB
  if (secondaryEvents.length > 0) {
    logR("loadSecondary:cache", secondaryEvents.length, "events");
    idbSaveAll(secondaryEvents);
  }

  // Re-render with enriched data — reset order so reactions/zaps affect ranking
  renderOrder = null;
  render();
}

// ─── WoT / Anchor ─────────────────────────────────────────────────────────────
// anchorPubkey: the pubkey whose curation we use as the trust anchor.
//   Default = CURATOR (Leo's curator account, hardcoded).
//   When logged in: switches to loggedInPubkey automatically.
//   Can be overridden to any npub via the anchor picker.
let anchorPubkey    = CURATOR;
let anchorFollows   = new Set();   // pubkeys the anchor follows (kind 3)
let anchorFollowsLoaded = false;

async function loadAnchorFollows(pubkey) {
  anchorFollows = new Set();
  anchorFollowsLoaded = false;
  try {
    await queryAll(RELAYS.slice(0, 3), { kinds: [3], authors: [pubkey], limit: 1 }, ev => {
      const ptags = ev.tags?.filter(t => t[0] === 'p') || [];
      ptags.forEach(t => anchorFollows.add(t[1]));
    }, 3000);
  } catch(e) {}
  anchorFollows.add(pubkey); // anchor always trusts themselves

  // For the default (not-logged-in) curator anchor, also load follows-of-follows
  // so the directory shows depth-2 WoT entries, not just anchor + 1 hop.
  if (pubkey === CURATOR) {
    const hop1 = Array.from(anchorFollows).filter(pk => pk !== pubkey);
    if (hop1.length > 0) {
      try {
        await queryAll(RELAYS.slice(0, 3), { kinds: [3], authors: hop1 }, ev => {
          const ptags = ev.tags?.filter(t => t[0] === 'p') || [];
          ptags.forEach(t => anchorFollows.add(t[1]));
        }, 4000);
      } catch(e) {}
    }
  }

  anchorFollowsLoaded = true;
}

function setAnchor(pubkey) {
  anchorPubkey = pubkey;
  renderOrder = null;
  loadAnchorFollows(pubkey).then(() => {
    renderOrder = null;
    dedupAndRender();
    loadSecondary();
  });
  updateAnchorUI();
}

function wotTrust(pubkey) {
  // Returns trust level: 3 = anchor themselves, 2 = direct follow, 1 = outside WoT
  if (pubkey === anchorPubkey) return 3;
  if (anchorFollows.has(pubkey)) return 2;
  return 1;
}

// Pick the best version of a slug given current WoT.
// Priority: anchor's own > anchor's direct follows (newest) > everyone else (newest)
function pickWinner(group) {
  // Within WoT (trust >= 2), newest event wins regardless of whether it's
  // the anchor or a direct follow. The anchor doesn't get priority over a newer edit
  // from someone they follow — that would mean Leo's edits show as "proposals" on his
  // own entries just because the curator has an older version.
  // Outside WoT: newest wins as fallback.
  const wot = group.filter(ev => wotTrust(ev.pubkey) >= 2);
  const pool = wot.length > 0 ? wot : group;
  pool.sort((a, b) => b.created_at - a.created_at);
  const winner = pool[0];
  // Credit the original submitter if the anchor published this
  const submitterEv = winner.pubkey === anchorPubkey
    ? group.find(e => e.pubkey !== anchorPubkey && wotTrust(e.pubkey) >= 1)
    : null;
  return { winner, submitterPubkey: submitterEv?.pubkey || null };
}

// ─── Dedup & parse ────────────────────────────────────────────────────────────
// slugEventIds: slug → Set<eventId> for ALL versions (all authors).
// eventIdToSlug: eventId → slug reverse map — needed for Amethyst-style #e reactions
//   that point to any version's event id, not just the winning one.
// slugVersions: slug → sorted array of all raw events (newest first) — for diff panel
const slugEventIds = {};
const eventIdToSlug = {};
let slugVersions = {};  // mutable, rebuilt each time

function dedupAndRender() {
  logR("dedupAndRender:allResourceEvents:", allResourceEvents.length);
  const byD = {};
  const tallies = {};
  allResourceEvents.forEach(ev => {
    const d = ev.tags?.find(t=>t[0]==='d')?.[1];
    if (!d) return;
    if (!byD[d]) byD[d] = [];
    byD[d].push(ev);
    // Track every event id → slug (all versions, all authors)
    if (!slugEventIds[d]) slugEventIds[d] = new Set();
    slugEventIds[d].add(ev.id);
    eventIdToSlug[ev.id] = d;
  });

  // Store all versions per slug for the diff/review panel
  slugVersions = {};
  Object.entries(byD).forEach(([d, group]) => {
    group.sort((a,b) => b.created_at - a.created_at);
    slugVersions[d] = group;
  });

  const inWoT = [], outsideWoT = [];
  Object.values(byD).forEach(group => {
    group.sort((a,b) => b.created_at - a.created_at);
    const { winner, submitterPubkey } = pickWinner(group);
    const trust = wotTrust(winner.pubkey);
    if (trust >= 2) {
      inWoT.push({ ev: winner, submitterPubkey });
    } else {
      outsideWoT.push({ ev: winner, submitterPubkey });
    }
  });

  // "curated" = within anchor's WoT (anchor + follows); "community" = outside WoT
  curatedResources   = inWoT.map(({ev, submitterPubkey}) => parseEvent(ev, submitterPubkey));
  communityResources = outsideWoT.map(({ev, submitterPubkey}) => parseEvent(ev, submitterPubkey));
  allResources       = [...curatedResources, ...communityResources];

  const tagSet = new Set();
  tagCounts = {};
  allResources.forEach(r => {
    const uniq = new Set([...r.platforms, ...r.tags, ...r.nips, ...(r.license ? [r.license] : [])]);
    uniq.forEach(t => {
      tagSet.add(t);
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  allTags = Array.from(tagSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));

  // Corpus frequency maps for edit-modal suggestions
  window._corpusFreq = {
    tags: {}, platforms: {}, nips: {}, progLangs: {}, licenses: {}, splits: new Set()
  };
  allResources.forEach(r => {
    r.tags.forEach(t => window._corpusFreq.tags[t] = (window._corpusFreq.tags[t] || 0) + 1);
    r.platforms.forEach(t => window._corpusFreq.platforms[t] = (window._corpusFreq.platforms[t] || 0) + 1);
    r.nips.forEach(t => window._corpusFreq.nips[t] = (window._corpusFreq.nips[t] || 0) + 1);
    r.progLangs.forEach(t => window._corpusFreq.progLangs[t] = (window._corpusFreq.progLangs[t] || 0) + 1);
    if (r.license) window._corpusFreq.licenses[r.license] = (window._corpusFreq.licenses[r.license] || 0) + 1;
    (r.zapSplits || []).forEach(s => window._corpusFreq.splits.add(s.pubkey));
  });

  render();
}

function parseEvent(ev, submitterPubkey = null) {
  const tags = ev.tags || [];
  let content = {};
  try { content = JSON.parse(ev.content); } catch(e){}
  const d       = tags.find(t=>t[0]==='d')?.[1] || '';
  const catTags = [...new Set(tags.filter(t=>t[0]==='t' && t[1]!==NAMESPACE).map(t=>t[1]))];
  const platforms = [...new Set(tags.filter(t=>t[0]==='platform').map(t=>t[1]))];
  const nips    = [...new Set(tags.filter(t=>t[0]==='nip').map(t=>'NIP-'+t[1]))];
  const license = tags.find(t=>t[0]==='license')?.[1] || '';
  const progLangs = tags.filter(t=>t[0]==='progLang').map(t=>t[1]);
  const refs    = tags.filter(t=>t[0]==='r').map(t=>t[1]);
  const git     = content.git || refs.find(r=>r.includes('github.com')) || '';
  const web     = content.web || refs.find(r=>!r.includes('github.com')) || '';
  // zap-split: [{pubkey, weight, label}, ...]
  // Each tag: ["zap-split", "<hex>", "<weight>", "<label>"]
  // Backward compat: old "submitter" tag becomes a single-entry split.
  let zapSplits = tags
    .filter(t => t[0] === 'zap-split' && t[1])
    .map(t => ({ pubkey: normalizePubkey(t[1]), weight: parseInt(t[2] || '1', 10) || 1, label: t[3] || '' }))
    .filter(s => s.pubkey);
  if (!zapSplits.length) {
    // Legacy: migrate old submitter tag into a two-entry split
    const legacySub = normalizePubkey(tags.find(t => t[0] === 'submitter')?.[1]);
    if (legacySub && legacySub !== ev.pubkey) {
      zapSplits = [
        { pubkey: ev.pubkey,   weight: 1, label: 'curator' },
        { pubkey: legacySub,   weight: 1, label: 'original submitter' },
      ];
    }
  }
  return {
    eventId:      ev.id,
    createdAt:    ev.created_at,
    pubkeyHex:    ev.pubkey,
    isCurated:    wotTrust(ev.pubkey) === 3, // published by the current anchor themselves
    isWoT:        wotTrust(ev.pubkey) >= 2,  // published by anchor or a direct follow
    submitterPubkey, // non-null when anchor curated someone else's submission
    title:        content.title || d,
    slug:         d,
    url:          git || web || '#',
    web, git,
    description:  content.description || '',
    instances:    content.instances || [],
    tags:         catTags, platforms, nips, license, progLangs,
    zapSplits,
    authorNPub:   wotTrust(ev.pubkey) === 3 ? '' : hexToNpub(ev.pubkey),
    discontinued: catTags.includes('discontinued') || tags.some(t => t[0] === 'discontinued'),
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────
function setStatus(msg) {
  // Use a dedicated status bar above results, never wipe the cards
  let el = document.getElementById('loadStatus');
  if (!el) {
    el = document.createElement('p');
    el.id = 'loadStatus';
    el.style.cssText = 'text-align:center;color:#888;font-size:13px;padding:6px 0;margin:0;min-height:22px;';
    const results = document.getElementById('results');
    if (results) results.parentNode.insertBefore(el, results);
  }
  el.textContent = msg;
}

function render() {
  const pool = curatedOnly ? curatedResources : allResources;
  logR("render:pool:", pool.length, "curatedOnly:", curatedOnly, "allResources:", allResources.length);
  const q = searchQuery.toLowerCase();
  const filtered = pool.filter(r => {
    if (activeTags.length) {
      const all = [...r.tags, ...r.platforms, ...r.nips, ...(r.license ? [r.license] : [])];
      if (!activeTags.every(t => all.includes(t))) return false;
    }
    if (q) {
      const haystack = [r.title, r.description, ...r.tags, ...r.platforms, ...(r.license ? [r.license] : [])].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // ── Sort by zaps → net reactions → title, but only compute order from relay data.
  // renderOrder is set here and preserved across user interactions (like/reply)
  // so cards don't jump around when you click something.
  if (renderOrder === null) {
    logR("render:computing sort...");
    const scored = filtered.map(r => {
      const ra = reactionCache[r.slug] || {};
      const zapSats = Math.floor((ra.zapMsat || 0) / 1000);
      const ca = reactionCounts(ra);
      const net = (ca['+'] || 0) - (ca['-'] || 0);
      return { slug: r.slug, zapSats, net, discontinued: r.discontinued ? 1 : 0 };
    });
    // Discontinued always sorts behind active entries
    scored.sort((a, b) =>
      a.discontinued - b.discontinued ||
      b.zapSats - a.zapSats ||
      b.net - a.net ||
      a.slug.localeCompare(b.slug)
    );
    renderOrder = scored.map(s => s.slug);
  }

  // Apply the stable order — items not in renderOrder go to the end
  filtered.sort((a, b) => {
    const ia = renderOrder.indexOf(a.slug);
    const ib = renderOrder.indexOf(b.slug);
    if (ia === -1 && ib === -1) return a.title.localeCompare(b.title);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const sourceIcon = loadedFrom==='nostr' ? '📡 nostr' : loadedFrom==='cache' ? '💾 cache' : '…';
  const communityNote = (!curatedOnly && communityResources.length > 0)
    ? `<div class="community-notice">👥 Showing ${communityResources.length} community entr${communityResources.length===1?'y':'ies'}</div>`
    : (curatedOnly && communityResources.length > 0)
    ? `<div class="community-notice community-notice--hidden">👥 ${communityResources.length} community entr${communityResources.length===1?'y':'ies'} hidden — <a href="javascript:void(0)" onclick="document.getElementById('curatedCb').checked=false;document.getElementById('curatedCb').dispatchEvent(new Event('change'))">show all</a></div>`
    : '';
  let html = `<div class="stats-bar">
    <span class="stat curated">🔭 In WoT: ${curatedResources.length}</span>
    <span class="stat community">👥 Outside WoT: ${communityResources.length}</span>
    <span class="stat source">${sourceIcon}</span>
    <span class="stat filtered">Showing ${filtered.length} of ${pool.length}</span>
  </div>${communityNote}`;

  html += filtered.map(r => renderCard(r)).join('');

  // ── Submit placeholder card ─────────────────────
  html += renderSubmitCard();

  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.innerHTML = html;
  renderToggles(pool);
  // After DOM update, show "more…" only on cards that are actually clipped
  requestAnimationFrame(checkAllDescOverflows);
}

function renderCard(r) {
  // (no per-card logging to avoid flooding)
  const rc   = reactionCache[r.slug]    || { byAuthor: {}, zapMsat: 0 };

  // Determine which pubkey to show as the author/provider of this resource.
  // For curated entries: show the SUBMITTER's profile (the person who built it).
  // Curator profile is hidden until WoT features are implemented.
  const displayPubkey = r.submitterPubkey || (r.isCurated ? null : r.pubkeyHex);
  const prof = displayPubkey ? (profileCache[displayPubkey] || {}) : {};
  const authorNpub = displayPubkey ? hexToNpub(displayPubkey) : '';

  // Reaction counts: one vote per author, last one wins
  const counts = reactionCounts(rc);

  const zapSats  = rc.zapMsat > 0 ? Math.floor(rc.zapMsat / 1000) : 0;
  const zapLabel = zapSats >= 1000 ? (zapSats/1000).toFixed(1)+'k' : (zapSats || '');
  const splitCount = r.zapSplits.length;
  const zapTitle = splitCount > 1 ? `Zap (split between ${splitCount} contributors)` : 'Zap this resource';
  // Store splits as a data attribute to avoid quoting/newline issues in onclick
  const splitsAttr = esc(JSON.stringify(splitCount ? r.zapSplits : [{ pubkey: r.pubkeyHex, weight: 1 }]));
  const hasZaps = zapSats > 0;
  const zapBtn = hasZaps
    ? `<span class="zap-btn-group"><button class="action-btn zap-action-btn" title="${esc(zapTitle)}" data-eventid="${esc(r.eventId)}" data-splits='${splitsAttr}' onclick="triggerZapFromBtn(this)">⚡</button><button class="action-btn zap-count-btn" title="View zap details" onclick="showZapDetails('${esc(r.slug)}')">${zapLabel}</button></span>`
    : `<button class="action-btn zap-action-btn" title="${esc(zapTitle)}" data-eventid="${esc(r.eventId)}" data-splits='${splitsAttr}' onclick="triggerZapFromBtn(this)">⚡</button>`;

  // Reaction pills (emoji reactions only — not + or -)
  let reactionHtml = '';
  const emojis = Object.entries(counts).filter(([e]) => e !== '+' && e !== '-').sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (emojis.length) reactionHtml = emojis.map(([e,n]) => `<span class="pill reaction">${esc(e)} ${n}</span>`).join('');

  // GitHub stars — shown only when count is known from shields.io (hide on 'invalid')
  let ghStars = '';
  if (r.git?.includes('github.com')) {
    const ghPath = r.git.replace('https://github.com/', '');
    ghStars = `<img class="gh-stars" src="https://img.shields.io/github/stars/${esc(ghPath)}.svg?style=social" alt="stars" loading="lazy" onerror="this.style.display='none'">`;
  }

  // Edit button — always visible. If not logged in, clicking opens login modal first.
  const editBtn = `<button class="edit-btn" onclick="requireLogin(()=>editResource('${esc(r.slug)}'))" title="Suggest an edit">✎ Edit</button>`;

  // Delete button — only shown to the author of the winning version (the logged-in user who published it)
  const deleteBtn = (loggedInPubkey && loggedInPubkey === r.pubkeyHex)
    ? `<button class="delete-btn" onclick="deleteResource('${esc(r.slug)}','${esc(r.eventId)}')" title="Delete this entry">🗑</button>`
    : '';

  // Timestamp — "edited X ago"
  const tsAgo = (() => {
    const secs = Math.floor(Date.now()/1000) - r.createdAt;
    if (secs < 60)   return 'just now';
    if (secs < 3600) return Math.floor(secs/60) + 'm ago';
    if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
    if (secs < 86400*30) return Math.floor(secs/86400) + 'd ago';
    if (secs < 86400*365) return Math.floor(secs/86400/30) + 'mo ago';
    return Math.floor(secs/86400/365) + 'y ago';
  })();

  // ── Byline: "[avatar][name] published Xm ago  content by [av][av]+N" ────────
  // Publisher = whoever signed this event version (r.pubkeyHex)
  // Contributors = zapSplits entries (weight>0 only, already filtered at publish time)
  const pubProf = profileCache[r.pubkeyHex] || {};
  const pubNpub = hexToNpub(r.pubkeyHex);
  const pubName = pubProf.name || (pubNpub.slice(0,12)+'…');
  const pubAvatar = `<img class="byline-avatar" src="${pubProf.picture ? esc(pubProf.picture) : '/images/nostrich.webp'}" onerror="this.src='/images/nostrich.webp'">`;
  const pubLink = `<a href="https://njump.me/${pubNpub}" target="_blank" class="byline-publisher">${pubAvatar}<span>${esc(pubName)}</span></a>`;

  // Contributors (zapSplits, weight>0, deduplicated, publisher excluded from right side)
  const contribPks = r.zapSplits
    .filter(s => s.weight > 0 && s.pubkey !== r.pubkeyHex)
    .map(s => s.pubkey);
  const MAX_AVATARS = 3;
  const shownPks  = contribPks.slice(0, MAX_AVATARS);
  const overflow  = contribPks.length - shownPks.length;
  let contentByHtml = '';
  if (contribPks.length > 0) {
    const avatarStack = shownPks.map(pk => {
      const p = profileCache[pk] || {};
      const npub = hexToNpub(pk);
      const title = p.name || npub.slice(0,14)+'…';
      return `<a href="https://njump.me/${npub}" target="_blank" title="${esc(title)}"><img class="byline-avatar byline-contrib" src="${p.picture ? esc(p.picture) : '/images/nostrich.webp'}" onerror="this.src='/images/nostrich.webp'"></a>`;
    }).join('');
    const overflowBadge = overflow > 0 ? `<span class="byline-overflow">+${overflow}</span>` : '';
    contentByHtml = `<span class="byline-content-by">content by ${avatarStack}${overflowBadge}</span>`;
  }

  const bylineHtml = `<div class="byline">
    ${pubLink}
    <span class="byline-ts" title="${new Date(r.createdAt*1000).toLocaleString()}">published ${tsAgo}</span>
    ${contentByHtml}
  </div>`;

  // Instances
  const instHtml = r.instances.length ? `<div class="resource-instances">Instances: ${r.instances.map(i=>{
    const name = typeof i==='string' ? i : (i.name||i.url);
    const url  = typeof i==='string' ? i : i.url;
    const com  = typeof i==='string' ? '' : (i.comment ? ' — '+i.comment : '');
    return `<a href="${esc(url)}" target="_blank">${esc(name)}</a>${esc(com)}`;
  }).join(' · ')}</div>` : '';

  const descHtml = r.description ? `<div class="resource-desc"><div class="resource-desc-inner" onload="checkDescOverflow(this)">${mdToHtml(r.description)}</div><button class="desc-expand desc-expand--hidden" onclick="toggleDesc(this)">more…</button></div>` : '';
  const discontinuedBadge = r.discontinued ? `<span class="pill discontinued" title="This project appears to be discontinued">🪦 discontinued</span>` : '';
  const cardClass = r.discontinued ? 'resource-card resource-card--discontinued' : 'resource-card';

  // Proposals: versions from authors OUTSIDE the WoT.
  // WoT members all compete on newest-wins; a WoT member's version is never a proposal.
  // Exception: show logged-in user's own superseded version so they can diff/override.
  const versions = slugVersions[r.slug] || [];
  const winnerCreatedAt = versions.find(v => v.id === r.eventId)?.created_at ?? 0;

  // Outside-WoT proposals: newer than winner, from non-WoT authors
  const pendingProposals = versions.filter(v =>
    v.pubkey !== r.pubkeyHex &&
    wotTrust(v.pubkey) < 2 &&
    v.created_at >= winnerCreatedAt
  );

  // My superseded: I'm in WoT but my version lost to a newer WoT edit
  const mySuperseded = loggedInPubkey && loggedInPubkey !== r.pubkeyHex && wotTrust(loggedInPubkey) >= 2
    ? versions.find(v => v.pubkey === loggedInPubkey && !pendingProposals.includes(v))
    : null;

  const totalProposals = pendingProposals.length + (mySuperseded ? 1 : 0);
  const mySupersededLabel = mySuperseded ? ' (incl. yours)' : '';

  const proposalBadge = totalProposals > 0
    ? `<button class="action-btn proposals-btn" onclick="toggleProposals('${esc(r.slug)}')" title="See ${totalProposals} proposal${totalProposals>1?'s':''}">${totalProposals} proposal${totalProposals>1?'s':''}${mySupersededLabel}</button>`
    : '';

  // Review button shown to any logged-in user
  const reviewBtn = (loggedInPubkey && totalProposals > 0)
    ? `<button class="action-btn approve-btn" onclick="showProposalDiff('${esc(r.slug)}')" title="Review proposals">📋 Review</button>`
    : '';

  // Action bar: reactions + reply + zap + proposals
  const slug_  = esc(r.slug);
  const aHex   = esc(r.pubkeyHex || '');
  const myVote = loggedInPubkey ? rc.byAuthor[loggedInPubkey]?.emoji : null;
  const likeN  = counts['+'] || 0;
  const dislikeN = counts['-'] || 0;
  const replyN = (replyCache[r.slug] || []).length;
  const actionBar = r.slug ? `
    <div class="resource-actions">
      <button class="action-btn${myVote==='+'?' action-active':''}" onclick="requireLogin(()=>reactToResource('${slug_}','${aHex}','+'))" title="${myVote==='+'?'Remove like':'Like'}">👍${likeN?' '+likeN:''}</button>
      <button class="action-btn${myVote==='-'?' action-active':''}" onclick="requireLogin(()=>reactToResource('${slug_}','${aHex}','-'))" title="${myVote==='-'?'Remove dislike':'Dislike'}">👎${dislikeN?' '+dislikeN:''}</button>
      <button class="action-btn" onclick="toggleReplies('${slug_}','${aHex}')" title="Replies">💬 Replies${replyN?' '+replyN:''}</button>
      ${zapBtn}
      ${proposalBadge}${reviewBtn}
    </div>
    <div class="resource-proposals" id="proposals-${slug_}" style="display:none;"></div>
    <div class="resource-replies" id="replies-${slug_}" data-open="0"></div>` : '';

  return `<div class="${cardClass}" data-slug="${slug_}">
    <div class="resource-header">
      <span class="resource-title">${esc(r.title)}</span>
      <div class="resource-header-right">
        ${r.web ? `<a href="${esc(r.web)}" target="_blank" class="card-link-icon" title="Website">🌐</a>` : ''}
        ${r.git ? `<a href="${esc(r.git)}" target="_blank" class="card-link-icon" title="Source">💻</a>` : ''}
        ${deleteBtn}
        ${editBtn}
        ${ghStars}
      </div>
    </div>
    ${bylineHtml}
    ${r.license||r.progLangs.length ? `<div class="resource-meta">
      ${r.license?`<span class="meta-item">License: ${esc(r.license)}</span>`:''}
      ${r.progLangs.length?`<span class="meta-item">with ${esc(r.progLangs.join(', '))}</span>`:''}
    </div>` : ''}
    ${instHtml}
    <div class="resource-tags">
      ${discontinuedBadge}
      ${r.platforms.map(t=>`<span class="pill platform" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`).join('')}
      ${r.tags.filter(t=>t!=='discontinued').map(t=>`<span class="pill" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`).join('')}
      ${r.nips.map(t=>`<span class="pill nip" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`).join('')}
      ${r.license?`<span class="pill license" onclick="clickTag('${esc(r.license)}')">${esc(r.license)}</span>`:''}
      ${reactionHtml}
    </div>
    ${descHtml}
    ${actionBar}
  </div>`;
}

function renderSubmitCard() {
  const pubKey = loggedInPubkey;
  const prof = pubKey ? (profileCache[pubKey] || {}) : {};
  const npub = pubKey ? hexToNpub(pubKey) : '';
  const name = prof.name || (npub.slice(0, 12) + '…') || 'You';
  const avatar = prof.picture || '/images/nostrich.webp';

  const cta = pubKey
    ? '<span style="color:#2563eb;font-weight:500;">+ Submit your resource</span>'
    : '<span style="color:#2563eb;font-weight:500;">Log in to submit</span>';
  const onclick = pubKey ? 'showSubmitForm()' : 'requireLogin(null)';

  return `<div class="resource-card resource-card--submit" onclick="${onclick}" title="Submit a new Nostr resource">
    <div class="resource-header">
      <span class="resource-title" style="color:#999;font-weight:400;">Your project here?</span>
    </div>
    <div class="byline">
      <span class="byline-publisher">
        <img class="byline-avatar" src="${esc(avatar)}" onerror="this.src='/images/nostrich.webp'">
        <span style="color:#666;">${esc(name)}</span>
      </span>
      <span class="byline-ts">will appear here once published</span>
    </div>
    <div class="resource-desc" style="color:#aaa;margin-top:4px;">Describe your Nostr project, add links and tags so others can find it.</div>
    <div class="resource-actions" style="justify-content:center;margin-top:8px;">${cta}</div>
  </div>`;
}

function renderToggles(pool) {
  const filtered = pool.filter(r => {
    if (!activeTags.length) return true;
    const all = [...r.tags, ...r.platforms, ...r.nips, ...(r.license ? [r.license] : [])];
    return activeTags.every(t => all.includes(t));
  });
  const available = new Set();
  filtered.forEach(r => {
    r.platforms.forEach(t=>available.add(t));
    r.tags.forEach(t=>available.add(t));
    r.nips.forEach(t=>available.add(t));
    if (r.license) available.add(r.license);
  });

  const toggles = document.getElementById('toggles');
  if (!toggles) return;
  toggles.innerHTML = '';
  activeTags.forEach(t => {
    const b = document.createElement('span');
    b.className='filter-pill active'; b.textContent='✓ '+t+' ('+(tagCounts[t]||0)+')';
    b.onclick=()=>clickTag(t); toggles.appendChild(b);
  });
  Array.from(available).sort((a,b)=>(tagCounts[b]||0)-(tagCounts[a]||0)||a.localeCompare(b)).forEach(t => {
    if (activeTags.includes(t)) return;
    const b = document.createElement('span');
    b.className='filter-pill available'; b.textContent=t+' ('+(tagCounts[t]||0)+')';
    b.onclick=()=>clickTag(t); toggles.appendChild(b);
  });
  new Set(allTags).forEach(t => {
    if (activeTags.includes(t)||available.has(t)) return;
    const b = document.createElement('span');
    b.className='filter-pill unavailable'; b.textContent=t+' ('+(tagCounts[t]||0)+')';
    b.onclick=()=>clickTag(t); toggles.appendChild(b);
  });
}

function clickTag(t) {
  const i=activeTags.indexOf(t);
  if(i>=0)activeTags.splice(i,1); else activeTags.push(t);
  renderOrder = null; // recompute sort on filter change
  render();
}
function toggleDesc(btn) {
  const inner = btn.previousElementSibling;
  if (!inner) return;
  const expanded = inner.classList.toggle('expanded');
  btn.textContent = expanded ? 'less…' : 'more…';
}
// After cards are inserted into DOM, check which desc-inners are actually clipped
// and only show the "more…" button for those.
function checkAllDescOverflows() {
  document.querySelectorAll('.resource-desc-inner').forEach(inner => {
    const btn = inner.nextElementSibling;
    if (!btn || !btn.classList.contains('desc-expand')) return;
    if (inner.scrollHeight > inner.clientHeight + 4) {
      btn.classList.remove('desc-expand--hidden');
    } else {
      btn.classList.add('desc-expand--hidden');
    }
  });
}

async function deleteResource(slug, eventId) {
  if (!loggedInPubkey) return;
  if (!confirm(`Delete "${slug}"? This publishes a NIP-09 deletion event. Other users' copies are not affected.`)) return;
  try {
    const ev = {
      kind: 5,
      content: 'deleted',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', eventId],
        ['a', `30078:${loggedInPubkey}:${slug}`],
      ],
    };
    const signed = await window.nostr.signEvent(ev);
    await publishEvent(signed);
    // Remove from local cache so card disappears immediately
    allResourceEvents = allResourceEvents.filter(e => e.id !== eventId && !(e.pubkey === loggedInPubkey && e.tags?.find(t=>t[0]==='d')?.[1] === slug));
    renderOrder = null;
    dedupAndRender();
  } catch(e) {
    alert('Delete failed: ' + (e.message || e));
  }
}


// ─── Login / Auth (nostr-login handles NIP-07, NIP-46 bunkers, Amber, nsec) ──
let loggedInPubkey  = null;
let _editingSlug    = null;   // non-null when form is in edit mode
let _editSplits     = [];     // [{pubkey, weight, label}] carried into the split editor

// Fetch the logged-in user's own kind:0 profile and update header
async function fetchOwnProfile() {
  if (!loggedInPubkey || profileCache[loggedInPubkey]) return;
  await queryAll(RELAYS.slice(0, 2), { kinds: [0], authors: [loggedInPubkey] }, ev => {
    try {
      const c = JSON.parse(ev.content);
      profileCache[loggedInPubkey] = {
        name:    c.display_name || c.name || '',
        picture: c.picture || '',
        lud16:   c.lud16 || '',
        npub:    hexToNpub(loggedInPubkey),
      };
    } catch(e) {}
  }, 4000);
  // After fetching, re-render header with real data
  updateLoginUI();
}

function launchLogin() {
  // nostr-auth.js handles all cases: NIP-07 extension, nsec, NIP-46 bunker URI, QR.
  // On mobile: Amber NIP-55 intents don't work in browser contexts (can't receive
  // the signed event back). Users should use Amber's "Nostr Connect" (NIP-46 bunker)
  // mode instead: open Amber → Connect apps → copy bunker URI → paste below.
  document.dispatchEvent(new CustomEvent("nlLaunch", { detail: "welcome" }));
}


// ─── Submit / Edit modal ──────────────────────────────────────────────────────
let _submitModal = null;

function getSubmitModal() {
  if (_submitModal) return _submitModal;
  const overlay = document.createElement('div');
  overlay.id = 'submitOverlay';
  overlay.innerHTML = `
    <div id="submitBox">
      <div id="submitBoxHeader" style="position:relative;">
        <h3 id="submitBoxTitle" style="margin:0;font-size:16px;">Submit a Nostr Resource</h3>
        <button type="button" id="helpToggleBtn" class="help-toggle" onclick="toggleHelpMode()" title="Toggle help hints">?</button>
      </div>
      <div id="submitBoxBody">
        <div id="helpLegend" class="help-legend">
          <div class="legend-row">
            Colors:
            <span><span class="legend-pill you">selected by you</span></span>
            <span><span class="legend-pill other">selected by others</span></span>
            <span><span class="legend-pill none">selected by nobody</span></span>
          </div>
        </div>
        <p style="font-size:12px;color:#666;margin:0 0 12px">
          Publishes a kind 30078 event. Anyone can submit; curation determines what surfaces by default.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label style="font-size:12px;">Title<br><input id="sfTitle" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;"></label>
          <label style="font-size:12px;">Slug (d-tag) <span style="color:#888;font-weight:normal;font-size:11px;">— same slug = propose edit · new slug = fork</span><br><input id="sfSlug" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;font-family:monospace;"></label>
          <label style="font-size:12px;">Git URL<br><input id="sfGit" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;"></label>
          <label style="font-size:12px;">Web URL<br><input id="sfWeb" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;"></label>
          <div style="grid-column:1/-1;">
            <div style="font-size:12px;margin-bottom:3px;">Description
              <span class="md-toolbar" style="margin-left:8px;">
                <button type="button" class="md-btn" title="Bold" onclick="mdWrap('sfDesc','**','**')"><b>B</b></button>
                <button type="button" class="md-btn" title="Italic" onclick="mdWrap('sfDesc','_','_')"><i>I</i></button>
                <button type="button" class="md-btn" title="Code" onclick="mdWrap('sfDesc','\`','\`')"><code>\`\`</code></button>
                <button type="button" class="md-btn" title="Link" onclick="mdLink('sfDesc')">🔗</button>
                <button type="button" class="md-btn" title="Bullet list" onclick="mdPrefix('sfDesc','- ')">≡</button>
              </span>
              <span style="font-size:11px;color:#aaa;margin-left:6px;">Markdown</span>
            </div>
            <div id="sfDescTabs" class="desc-tabs"></div>
            <textarea id="sfDesc" rows="6" style="width:100%;padding:6px;margin-top:2px;min-height:120px;font-family:monospace;font-size:12px;box-sizing:border-box;resize:vertical;"></textarea>
            <div id="sfDescPreview" class="desc-preview" style="display:none;"></div>
          </div>
          <input type="hidden" id="sfTags">
          <input type="hidden" id="sfPlatforms">
          <input type="hidden" id="sfNips">
          <input type="hidden" id="sfProgLangs">
          <input type="hidden" id="sfLicense">
          <div style="grid-column:1/-1;">
            <div class="tag-section-label">Tags<span class="section-hint"> — click to toggle</span></div>
            <div id="sfTagsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfTagsAdd" placeholder="Add new tag..." oninput="filterTagButtons('sfTagsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfTagsWrap','sfTags',this.value,false);this.value='';filterTagButtons('sfTagsWrap','')}"><button type="button" onclick="addNewValue('sfTagsWrap','sfTags',document.getElementById('sfTagsAdd').value,false);document.getElementById('sfTagsAdd').value='';filterTagButtons('sfTagsWrap','')">+ Add</button></div>
          </div>
          <div style="grid-column:1/-1;">
            <div class="tag-section-label">Platforms<span class="section-hint"> — click to toggle</span></div>
            <div id="sfPlatformsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfPlatformsAdd" placeholder="Add new platform..." oninput="filterTagButtons('sfPlatformsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfPlatformsWrap','sfPlatforms',this.value,false);this.value='';filterTagButtons('sfPlatformsWrap','')}"><button type="button" onclick="addNewValue('sfPlatformsWrap','sfPlatforms',document.getElementById('sfPlatformsAdd').value,false);document.getElementById('sfPlatformsAdd').value='';filterTagButtons('sfPlatformsWrap','')">+ Add</button></div>
          </div>
          <div style="grid-column:1/-1;">
            <div class="tag-section-label">NIPs<span class="section-hint"> — click to toggle</span></div>
            <div class="help-only" style="font-size:11px;color:#888;margin-bottom:4px;">
              <a href="https://github.com/nostr-protocol/nips" target="_blank" rel="noopener" style="color:#888;">NIP repository →</a>
            </div>
            <div id="sfNipsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfNipsAdd" placeholder="NIP number (e.g. 23)..." oninput="filterTagButtons('sfNipsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfNipsWrap','sfNips',this.value,false);this.value='';filterTagButtons('sfNipsWrap','')}"><button type="button" onclick="addNewValue('sfNipsWrap','sfNips',document.getElementById('sfNipsAdd').value,false);document.getElementById('sfNipsAdd').value='';filterTagButtons('sfNipsWrap','')">+ Add</button></div>
          </div>
          <div style="grid-column:1/-1;">
            <div class="tag-section-label">Programming languages<span class="section-hint"> — click to toggle</span></div>
            <div id="sfProgLangsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfProgLangsAdd" placeholder="Add new language..." oninput="filterTagButtons('sfProgLangsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfProgLangsWrap','sfProgLangs',this.value,false);this.value='';filterTagButtons('sfProgLangsWrap','')}"><button type="button" onclick="addNewValue('sfProgLangsWrap','sfProgLangs',document.getElementById('sfProgLangsAdd').value,false);document.getElementById('sfProgLangsAdd').value='';filterTagButtons('sfProgLangsWrap','')">+ Add</button></div>
          </div>
          <div style="grid-column:1/-1;">
            <div class="tag-section-label">License<span class="section-hint"> — click one</span></div>
            <div id="sfLicenseWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfLicenseAdd" placeholder="Add new license..." oninput="filterTagButtons('sfLicenseWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfLicenseWrap','sfLicense',this.value,true);this.value='';filterTagButtons('sfLicenseWrap','')}"><button type="button" onclick="addNewValue('sfLicenseWrap','sfLicense',document.getElementById('sfLicenseAdd').value,true);document.getElementById('sfLicenseAdd').value='';filterTagButtons('sfLicenseWrap','')">+ Add</button></div>
          </div>
          <div style="grid-column:1/-1;font-size:12px;">
            <div style="margin-bottom:3px;">Instances <span style="color:#888;font-weight:normal;">(one per line: <code>https://url</code> or <code>Name | https://url | comment</code>)</span></div>
            <textarea id="sfInstances" rows="3" style="width:100%;padding:6px;margin-top:2px;font-family:monospace;font-size:11px;box-sizing:border-box;resize:vertical;" placeholder="https://relay.example.com&#10;My Instance | https://example.com | self-hosted"></textarea>
          </div>
          <label style="grid-column:1/-1;font-size:12px;">Product author npub <span style="color:#888;font-weight:normal;">(optional — auto-added to zap split at weight 100)</span><br>
            <input id="sfAuthorNpub" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;font-family:monospace;font-size:11px;" placeholder="npub1…" oninput="onAuthorNpubInput(this.value)">
          </label>
          <label style="grid-column:1/-1;font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="sfDiscontinued" style="cursor:pointer;">
            <span>🪦 Mark as discontinued (sorts behind active entries)</span>
          </label>
        </div>
        <div class="split-section" style="margin:14px 0 4px;">
          <div class="split-section-label" style="font-size:12px;font-weight:600;color:#444;">⚡ Zap split <span class="split-section-hint" style="font-weight:normal;color:#888;">— share zaps with contributors</span></div>
          <div id="sfSplits" style="margin-top:8px;"></div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
          <button onclick="submitResource()">Publish</button>
          <button onclick="closeSubmitModal()">Cancel</button>
          <span id="sfStatus" style="font-size:13px;flex:1;"></span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  let mdOnOverlay = false;
  overlay.addEventListener('mousedown', e => { mdOnOverlay = (e.target === overlay); });
  overlay.addEventListener('click', e => { if (e.target === overlay && mdOnOverlay) closeSubmitModal(); });
  // Ctrl+Enter anywhere in the modal submits the form
  overlay.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitResource(); }
  });
  _submitModal = overlay;
  return overlay;
}

function openSubmitModal() {
  const m = getSubmitModal();
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeSubmitModal() {
  if (_submitModal) _submitModal.style.display = 'none';
  document.body.style.overflow = '';
}

function showSubmitForm() {
  _editingSlug = null;
  openSubmitModal();
  document.getElementById('submitBoxTitle').textContent = 'Submit a Nostr Resource';
  const slugEl = document.getElementById('sfSlug');
  if (slugEl) slugEl.readOnly = false;
  ['sfTitle','sfSlug','sfGit','sfWeb','sfDesc','sfTags','sfPlatforms','sfNips','sfProgLangs','sfLicense','sfAuthorNpub'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const discEl = document.getElementById('sfDiscontinued');
  if (discEl) discEl.checked = false;
  const instEl = document.getElementById('sfInstances');
  if (instEl) instEl.value = '';
  document.getElementById('sfStatus').textContent = '';
  _editSplits = seedSplitWithSelf([]);
  renderSplitEditor(_editSplits);
  updateSplitSuggestions(null);
  // Clear button grids and description tabs
  const emptySets = { tags:{}, platforms:{}, nips:{}, progLangs:{}, licenses:{} };
  const corpusTags = [...new Set(allResources.flatMap(r => r.tags))].sort();
  const corpusPlats = [...new Set(allResources.flatMap(r => r.platforms))].sort();
  const corpusNips = [...new Set(allResources.flatMap(r => r.nips))].sort();
  const corpusLangs = [...new Set(allResources.flatMap(r => r.progLangs))].sort();
  const corpusLicenses = [...new Set(allResources.flatMap(r => r.license ? [r.license] : []))].sort();
  renderTagButtons('sfTagsWrap', 'sfTags', corpusTags, [], emptySets.tags, false);
  renderTagButtons('sfPlatformsWrap', 'sfPlatforms', corpusPlats, [], emptySets.platforms, false);
  renderTagButtons('sfNipsWrap', 'sfNips', corpusNips, [], emptySets.nips, false);
  renderTagButtons('sfProgLangsWrap', 'sfProgLangs', corpusLangs, [], emptySets.progLangs, false);
  renderTagButtons('sfLicenseWrap', 'sfLicense', corpusLicenses, [], emptySets.licenses, true);
  const tabsWrap = document.getElementById('sfDescTabs');
  const preview = document.getElementById('sfDescPreview');
  if (tabsWrap) tabsWrap.innerHTML = '';
  if (preview) preview.style.display = 'none';
  const ta = document.getElementById('sfDesc');
  if (ta) ta.style.display = '';
}

// Called when product author npub is typed in — resolve profile and add to split
function onAuthorNpubInput(val) {
  val = val.trim();
  if (!val) return;
  let hex = null;
  if (val.startsWith('npub1')) hex = bech32ToHex(val);
  else if (/^[0-9a-f]{64}$/.test(val)) hex = val;
  if (!hex) return;
  // Add to split if not already there, at weight 100
  if (!_editSplits.find(s => s.pubkey === hex)) {
    _editSplits.push({ pubkey: hex, weight: 100 });
    renderSplitEditor(_editSplits);
    // Fetch profile for display
    if (!profileCache[hex]) {
      queryAll(RELAYS.slice(0,2), { kinds:[0], authors:[hex] }, ev => {
        try {
          const c = JSON.parse(ev.content);
          profileCache[hex] = { name: c.display_name||c.name||'', picture: c.picture||'', lud16: c.lud16||'', npub: hexToNpub(hex) };
        } catch(e) {}
      }, 4000).then(() => renderSplitEditor(_editSplits));
    }
  }
}

function editResource(slug) {
  const r = allResources.find(x => x.slug === slug);
  if (!r) return;
  _editingSlug = slug;

  let splits = r.zapSplits.map(s => ({ pubkey: s.pubkey, weight: s.weight }));
  if (!splits.length && r.pubkeyHex) {
    splits = [{ pubkey: r.pubkeyHex, weight: 100 }];
  }
  _editSplits = seedSplitWithSelf(splits);

  openSubmitModal();
  document.getElementById('submitBoxTitle').textContent = `Editing: ${r.title}`;
  document.getElementById('sfSlug').value      = r.slug;
  document.getElementById('sfSlug').readOnly   = false;  // editable: same slug = edit/proposal, new slug = fork
  document.getElementById('sfTitle').value     = r.title;
  document.getElementById('sfGit').value       = r.git || '';
  document.getElementById('sfWeb').value       = r.web || '';
  document.getElementById('sfDesc').value      = r.description || '';
  document.getElementById('sfTags').value      = r.tags.filter(t => t !== 'discontinued').join(', ');
  document.getElementById('sfPlatforms').value = r.platforms.join(', ');
  // Populate newly-added fields from parsed resource + raw event
  const srcEv = (slugVersions[slug] || []).find(v => v.id === r.eventId);
  const srcTags = srcEv?.tags || [];
  document.getElementById('sfNips').value      = srcTags.filter(t=>t[0]==='nip').map(t=>t[1]).join(', ');
  document.getElementById('sfProgLangs').value = srcTags.filter(t=>t[0]==='progLang').map(t=>t[1]).join(', ');
  document.getElementById('sfLicense').value   = srcTags.find(t=>t[0]==='license')?.[1] || '';
  // Instances: stringify each entry as "Name | url | comment" or just url
  let srcContent = {}; try { srcContent = JSON.parse(srcEv?.content || '{}'); } catch(e) {}
  const instLines = (srcContent.instances || []).map(i => {
    if (typeof i === 'string') return i;
    const parts = [i.url || ''];
    if (i.name && i.name !== i.url) parts.unshift(i.name);
    if (i.comment) parts.push(i.comment);
    return parts.length > 1 ? parts.join(' | ') : parts[0];
  });
  document.getElementById('sfInstances').value = instLines.join('\n');
  const discEl = document.getElementById('sfDiscontinued');
  if (discEl) discEl.checked = r.discontinued || false;
  // Pre-fill the author npub field if we know it
  const authorNpubEl = document.getElementById('sfAuthorNpub');
  if (authorNpubEl) {
    // Pre-fill only with a split entry that is neither the editor nor the curator —
    // i.e. someone who is plausibly the actual product author.
    const externalSplit = _editSplits.find(s =>
      s.pubkey !== loggedInPubkey && s.pubkey !== CURATOR
    );
    authorNpubEl.value = externalSplit ? hexToNpub(externalSplit.pubkey) : '';
  }
  document.getElementById('sfStatus').textContent = '';
  renderSplitEditor(_editSplits);
  updateSplitSuggestions(slug);

  // Build corpus value sets for button grids
  const corpusTags = [...new Set(allResources.flatMap(r => r.tags))].sort();
  const corpusPlats = [...new Set(allResources.flatMap(r => r.platforms))].sort();
  const corpusNips = [...new Set(allResources.flatMap(r => r.nips))].sort();
  const corpusLangs = [...new Set(allResources.flatMap(r => r.progLangs))].sort();
  const corpusLicenses = [...new Set(allResources.flatMap(r => r.license ? [r.license] : []))].sort();

  const suggestions = gatherSlugSuggestions(slug);
  renderTagButtons('sfTagsWrap', 'sfTags', corpusTags, r.tags.filter(t => t !== 'discontinued'), suggestions.tags, false);
  renderTagButtons('sfPlatformsWrap', 'sfPlatforms', corpusPlats, r.platforms, suggestions.platforms, false);
  renderTagButtons('sfNipsWrap', 'sfNips', corpusNips, srcTags.filter(t=>t[0]==='nip').map(t=>'NIP-'+t[1]), suggestions.nips, false);
  renderTagButtons('sfProgLangsWrap', 'sfProgLangs', corpusLangs, srcTags.filter(t=>t[0]==='progLang').map(t=>t[1]), suggestions.progLangs, false);
  const currentLicense = srcTags.find(t=>t[0]==='license')?.[1] || '';
  renderTagButtons('sfLicenseWrap', 'sfLicense', corpusLicenses, currentLicense ? [currentLicense] : [], suggestions.licenses, true);

  // Suggested instances as commented lines
  const instEl = document.getElementById('sfInstances');
  if (instEl) {
    const suggestedInstances = Object.entries(suggestions.instances || {});
    if (suggestedInstances.length) {
      const allInstAuthors = new Set();
      suggestedInstances.forEach(([_, meta]) => meta.authors.forEach(a => allInstAuthors.add(a)));
      const instAuthorList = Array.from(allInstAuthors).slice(0,3).join(', ') + (allInstAuthors.size > 3 ? ` +${allInstAuthors.size-3} more` : '');
      const commentLines = [`# Suggested instances by ${instAuthorList}:`];
      suggestedInstances.forEach(([val, meta]) => {
        commentLines.push(`# ${val}  // ${meta.authors.slice(0,2).join(', ')}${meta.authors.length>2?'...':''}`);
      });
      commentLines.push('#');
      const existing = instEl.value.trim();
      instEl.value = commentLines.join('\n') + (existing ? '\n\n' + existing : '');
    }
  }

  // Description tabs for other authors
  renderDescTabs(slug, r.description || '');

  // Fetch own profile if needed so the split editor shows our name/avatar
  if (loggedInPubkey && !profileCache[loggedInPubkey]) {
    queryAll(RELAYS.slice(0,2), { kinds:[0], authors:[loggedInPubkey] }, ev => {
      try {
        const c = JSON.parse(ev.content);
        profileCache[loggedInPubkey] = { name: c.display_name||c.name||'', picture: c.picture||'', lud16: c.lud16||'', npub: hexToNpub(loggedInPubkey) };
      } catch(e) {}
    }, 4000).then(() => { renderSplitEditor(_editSplits); updateSplitSuggestions(slug); });
  }
}

// ─── Proposal / diff viewer ──────────────────────────────────────────────────
function toggleProposals(slug) {
  const wrap = document.getElementById('proposals-' + slug);
  if (!wrap) return;
  if (wrap.style.display !== 'none') { wrap.style.display = 'none'; return; }
  const r = allResources.find(x => x.slug === slug);
  if (!r) return;
  const versions = slugVersions[slug] || [];
  const winnerTs = versions.find(v => v.id === r.eventId)?.created_at ?? 0;

  // Outside-WoT proposals newer than winner
  const outsideProposals = versions.filter(v =>
    v.pubkey !== r.pubkeyHex && wotTrust(v.pubkey) < 2 && v.created_at >= winnerTs
  );
  // My own superseded version (I'm in WoT but curator's batch edit overtook me)
  const myOwn = loggedInPubkey && loggedInPubkey !== r.pubkeyHex && wotTrust(loggedInPubkey) >= 2
    ? versions.find(v => v.pubkey === loggedInPubkey && !outsideProposals.includes(v))
    : null;

  const allProposals = [...(myOwn ? [myOwn] : []), ...outsideProposals];
  if (!allProposals.length) return;

  const rows = allProposals.map(ev => {
    const p = profileCache[ev.pubkey] || {};
    const npub = hexToNpub(ev.pubkey);
    const name = p.name || (npub.slice(0,14)+'…');
    const isMe = ev.pubkey === loggedInPubkey;
    const avatar = p.picture
      ? `<img src="${esc(p.picture)}" onerror="this.src='/images/nostrich.webp'" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;">`
      : `<img src="/images/nostrich.webp" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;">`;
    const date = new Date(ev.created_at*1000).toLocaleDateString();
    let evContent={}; try{evContent=JSON.parse(ev.content);}catch(e){}
    const title = evContent.title || ev.tags?.find(t=>t[0]==='d')?.[1]||'';
    const supersededLabel = isMe ? ' <span style="color:#b06000;font-size:11px;">⚠ yours (superseded)</span>' : '';
    const adoptLabel = isMe ? '↩ Override' : (loggedInPubkey === CURATOR ? '✓ Approve' : loggedInPubkey ? '✓ Adopt' : '');
    const approveHtml = adoptLabel
      ? `<button class="action-btn approve-btn" onclick="approveProposal('${esc(slug)}','${esc(ev.id)}')">${adoptLabel}</button>`
      : '';
    return `<div class="proposal-row${isMe ? ' proposal-row--mine' : ''}">
      <span class="proposal-author">${avatar} <a href="https://njump.me/${npub}" target="_blank">${esc(name)}</a>${supersededLabel}</span>
      <span class="proposal-title">${esc(title)}</span>
      <span class="proposal-date">${date}</span>
      <button class="action-btn" onclick="showProposalDiff('${esc(slug)}','${esc(ev.id)}')">⟷ Diff</button>
      ${approveHtml}
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="proposals-panel">${rows}</div>`;
  wrap.style.display = 'block';
}

function showProposalDiff(slug, proposalEventId) {
  const r = allResources.find(x => x.slug === slug);
  if (!r) return;
  const versions = slugVersions[slug] || [];
  const currentEv = versions.find(v => v.id === r.eventId) || versions[0];
  const winnerTs = currentEv?.created_at ?? 0;
  const proposal = proposalEventId
    ? versions.find(v => v.id === proposalEventId)
    : versions.find(v => v.pubkey !== r.pubkeyHex && v.created_at >= winnerTs);
  if (!proposal) return;

  // Build full tag diff — compare every tag (except d, id, sig, pubkey, created_at)
  // Group tags by key → values string for comparison
  const SKIP_KEYS = new Set(['d']);
  function tagMap(ev) {
    const m = {};
    (ev.tags || []).forEach(t => {
      if (SKIP_KEYS.has(t[0])) return;
      const key = t[0];
      const val = t.slice(1).join('\t');
      if (!m[key]) m[key] = [];
      m[key].push(val);
    });
    return m;
  }
  const curTags = tagMap(currentEv);
  const propTags = tagMap(proposal);
  const allTagKeys = [...new Set([...Object.keys(curTags), ...Object.keys(propTags)])].sort();

  // Content JSON fields
  let curContent = {}, propContent = {};
  try { curContent  = JSON.parse(currentEv.content); } catch(e) {}
  try { propContent = JSON.parse(proposal.content); } catch(e) {}
  const allContentKeys = [...new Set([...Object.keys(curContent), ...Object.keys(propContent)])];

  const rows = [];

  // Metadata: author, date
  rows.push(['meta', 'Author',
    hexToNpub(currentEv.pubkey).slice(0,20)+'…',
    hexToNpub(proposal.pubkey).slice(0,20)+'…',
    currentEv.pubkey !== proposal.pubkey]);
  rows.push(['meta', 'Date',
    new Date(currentEv.created_at*1000).toLocaleString(),
    new Date(proposal.created_at*1000).toLocaleString(),
    currentEv.created_at !== proposal.created_at]);

  // Content fields
  allContentKeys.forEach(k => {
    const cur  = curContent[k]  !== undefined ? JSON.stringify(curContent[k])  : '';
    const prop = propContent[k] !== undefined ? JSON.stringify(propContent[k]) : '';
    rows.push(['content', 'content.' + k, cur, prop, cur !== prop]);
  });

  // Tag fields
  allTagKeys.forEach(k => {
    const curV  = (curTags[k]  || []).join(' | ');
    const propV = (propTags[k] || []).join(' | ');
    rows.push(['tag', 'tag[' + k + ']', curV, propV, curV !== propV]);
  });

  const changedCount = rows.filter(r => r[4]).length;

  const renderRows = (showAll) => rows.map(([type, label, cur, prop, changed]) => {
    if (!showAll && !changed) return '';
    const cls = changed ? ' diff-changed' : '';
    const propCls = changed ? ' diff-new' : '';
    return `<tr class="${cls}">
      <td class="diff-label" style="font-size:11px;color:${type==='meta'?'#aaa':'#555'};white-space:nowrap;">${esc(label)}</td>
      <td class="diff-current"><pre class="diff-pre">${esc(cur||'—')}</pre></td>
      <td class="diff-proposed${propCls}"><pre class="diff-pre">${esc(prop||'—')}</pre></td>
    </tr>`;
  }).join('');

  const pNpub = hexToNpub(proposal.pubkey);
  const pProf = profileCache[proposal.pubkey] || {};
  const pName = pProf.name || (pNpub.slice(0,14)+'…');
  const cNpub = hexToNpub(currentEv.pubkey);
  const cProf = profileCache[currentEv.pubkey] || {};
  const cName = cProf.name || (cNpub.slice(0,14)+'…');

  const adoptLabel = loggedInPubkey === CURATOR ? '✓ Approve' : loggedInPubkey ? '✓ Adopt this version' : '';
  const approveHtml = adoptLabel
    ? `<button onclick="approveProposal('${esc(slug)}','${esc(proposal.id)}')" style="background:#137333;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:14px;">${adoptLabel}</button>`
    : '';
  const editFromHtml = loggedInPubkey
    ? `<button onclick="editFromProposal('${esc(slug)}','${esc(proposal.id)}')" style="background:#1a73e8;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:14px;">✎ Edit from this</button>`
    : '';

  let dm = document.getElementById('diffModal');
  if (!dm) {
    dm = document.createElement('div');
    dm.id = 'diffModal';
    dm.style.cssText = 'position:fixed;inset:0;z-index:9100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';
    document.body.appendChild(dm);
    let mdOnDm = false;
    dm.addEventListener('mousedown', e => { mdOnDm = (e.target===dm); });
    dm.addEventListener('click', e => { if(e.target===dm && mdOnDm) dm.style.display='none'; });
  }

  const buildModal = (showAll) => `
    <div style="background:#fff;border-radius:10px;max-width:900px;width:100%;margin:16px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e0e0e0;flex-shrink:0;">
        <div>
          <strong style="font-size:15px;">Diff: ${esc(slug)}</strong>
          <span style="font-size:12px;color:#888;margin-left:8px;">${changedCount} field${changedCount!==1?'s':''} differ</span><br>
          <span style="font-size:12px;color:#666;">
            Current: <a href="https://njump.me/${cNpub}" target="_blank">${esc(cName)}</a>
            &nbsp;→&nbsp; Proposal: <a href="https://njump.me/${pNpub}" target="_blank">${esc(pName)}</a>
            &nbsp;<a href="https://njump.me/${proposal.id}" target="_blank" style="color:#aaa;font-size:11px;">event ↗</a>
          </span>
        </div>
        <button onclick="document.getElementById('diffModal').style.display='none'" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888;">&times;</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:12px 18px;">
        <table class="diff-table" style="font-size:12px;width:100%;">
          <thead><tr>
            <th class="diff-label" style="width:130px;">Field</th>
            <th class="diff-current">Current (${esc(cName)})</th>
            <th class="diff-proposed">Proposal (${esc(pName)})</th>
          </tr></thead>
          <tbody>${renderRows(showAll)}</tbody>
        </table>
        <div style="margin-top:8px;text-align:right;">
          <button onclick="__diffShowAll=!__diffShowAll;document.getElementById('diffModal').innerHTML=buildDiffModal(__diffShowAll)"
            style="font-size:12px;color:#1a73e8;background:none;border:none;cursor:pointer;padding:4px 8px;">
            ${showAll ? 'Hide equal fields' : 'Show all fields (' + rows.length + ')'}
          </button>
        </div>
      </div>
      <div style="padding:14px 18px;border-top:1px solid #e0e0e0;display:flex;gap:10px;align-items:center;flex-shrink:0;flex-wrap:wrap;">
        ${approveHtml}
        ${editFromHtml}
        <span id="diffStatus" style="font-size:13px;flex:1;"></span>
      </div>
    </div>`;

  window.__diffShowAll = false;
  window.buildDiffModal = buildModal;
  dm.innerHTML = buildModal(false);
  dm.style.display = 'flex';
}


async function approveProposal(slug, proposalEventId) {
  if (!loggedInPubkey) { requireLogin(() => approveProposal(slug, proposalEventId)); return; }
  const versions = slugVersions[slug] || [];
  const proposal = versions.find(v => v.id === proposalEventId);
  if (!proposal) { alert('Proposal not found.'); return; }
  const set = (msg, col='#333') => {
    const el = document.getElementById('diffStatus');
    if (el) { el.textContent=msg; el.style.color=col; }
  };
  try {
    set('Signing…');
    // Publish curator's own version copying the proposal's tags+content
    // Strip old d-tag and namespace t-tag, keep everything else
    const newTags = [
      ['d', slug], ['t', NAMESPACE],
      ...proposal.tags.filter(t => t[0]!=='d' && !(t[0]==='t' && t[1]===NAMESPACE)),
    ];
    const event = { kind:30078, created_at:Math.floor(Date.now()/1000), tags:newTags, content:proposal.content };
    const signed = await window.nostr.signEvent(event);
    set('Publishing…');
    await publishEvent(signed);
    set('✅ Approved!', '#137333');
    if (!allResourceEvents.some(e => e.id === signed.id)) {
      allResourceEvents.push(signed);
    }
    renderOrder = null;
    dedupAndRender();
    setTimeout(() => { document.getElementById('diffModal').style.display='none'; }, 1200);
  } catch(e) { set('Error: '+(e.message||e), '#c5221f'); }
}

// ─── Tag / Platform / NIP / ProgLang / License button grids ─────────────────
function gatherSlugSuggestions(slug) {
  const versions = (slugVersions[slug] || []);
  const currentPubkey = loggedInPubkey;
  const suggestions = {
    tags: {}, platforms: {}, nips: {}, progLangs: {}, licenses: {},
    splits: {}, instances: {}, descriptions: {}
  };
  versions.forEach(ev => {
    if (ev.pubkey === currentPubkey) return;
    const p = profileCache[ev.pubkey] || {};
    const name = p.name || (hexToNpub(ev.pubkey).slice(0,10)+'…');
    const add = (bucket, val) => {
      if (!val) return;
      if (!bucket[val]) bucket[val] = { authors: new Set(), authorHexes: new Set() };
      bucket[val].authors.add(name);
      bucket[val].authorHexes.add(ev.pubkey);
    };
    (ev.tags || []).forEach(t => {
      if (t[0] === 't' && t[1] !== NAMESPACE) add(suggestions.tags, t[1]);
      if (t[0] === 'platform') add(suggestions.platforms, t[1]);
      if (t[0] === 'nip') add(suggestions.nips, 'NIP-' + t[1]);
      if (t[0] === 'progLang') add(suggestions.progLangs, t[1]);
      if (t[0] === 'license') add(suggestions.licenses, t[1]);
    });
    // zap splits
    (ev.tags || []).filter(t => t[0] === 'zap-split' && t[1]).forEach(t => {
      const pk = normalizePubkey(t[1]);
      if (!pk) return;
      if (!suggestions.splits[pk]) suggestions.splits[pk] = { authors: new Set(), authorHexes: new Set(), weight: parseInt(t[2]||'1',10)||1 };
      suggestions.splits[pk].authors.add(name);
      suggestions.splits[pk].authorHexes.add(ev.pubkey);
    });
    // instances from content
    let content = {}; try { content = JSON.parse(ev.content); } catch(e){}
    (content.instances || []).forEach(inst => {
      const line = typeof inst === 'string' ? inst : [inst.name, inst.url, inst.comment].filter(Boolean).join(' | ');
      add(suggestions.instances, line);
    });
    // description
    if (content.description) {
      if (!suggestions.descriptions[ev.pubkey]) suggestions.descriptions[ev.pubkey] = { name, text: content.description, hex: ev.pubkey };
    }
  });
  // convert Sets to Arrays
  Object.values(suggestions.tags).forEach(v => v.authors = Array.from(v.authors));
  Object.values(suggestions.platforms).forEach(v => v.authors = Array.from(v.authors));
  Object.values(suggestions.nips).forEach(v => v.authors = Array.from(v.authors));
  Object.values(suggestions.progLangs).forEach(v => v.authors = Array.from(v.authors));
  Object.values(suggestions.licenses).forEach(v => v.authors = Array.from(v.authors));
  Object.values(suggestions.instances).forEach(v => v.authors = Array.from(v.authors));
  Object.values(suggestions.splits).forEach(v => v.authors = Array.from(v.authors));
  return suggestions;
}

let _helpMode = false;

function toggleHelpMode() {
  _helpMode = !_helpMode;
  const btn = document.getElementById('helpToggleBtn');
  const legend = document.getElementById('helpLegend');
  const box = document.getElementById('submitBox');
  if (btn) btn.classList.toggle('on', _helpMode);
  if (legend) legend.classList.toggle('on', _helpMode);
  if (box) box.classList.toggle('help-on', _helpMode);
  // Re-render all button grids to show/hide inline author hints
  if (_editingSlug) {
    const r = allResources.find(x => x.slug === _editingSlug);
    if (r) {
      const suggestions = gatherSlugSuggestions(_editingSlug);
      const srcEv = (slugVersions[_editingSlug] || []).find(v => v.id === r.eventId);
      const srcTags = srcEv?.tags || [];
      const corpusTags = [...new Set(allResources.flatMap(r => r.tags))].sort();
      const corpusPlats = [...new Set(allResources.flatMap(r => r.platforms))].sort();
      const corpusNips = [...new Set(allResources.flatMap(r => r.nips))].sort();
      const corpusLangs = [...new Set(allResources.flatMap(r => r.progLangs))].sort();
      const corpusLicenses = [...new Set(allResources.flatMap(r => r.license ? [r.license] : []))].sort();
      renderTagButtons('sfTagsWrap', 'sfTags', corpusTags, r.tags.filter(t => t !== 'discontinued'), suggestions.tags, false);
      renderTagButtons('sfPlatformsWrap', 'sfPlatforms', corpusPlats, r.platforms, suggestions.platforms, false);
      renderTagButtons('sfNipsWrap', 'sfNips', corpusNips, srcTags.filter(t=>t[0]==='nip').map(t=>'NIP-'+t[1]), suggestions.nips, false);
      renderTagButtons('sfProgLangsWrap', 'sfProgLangs', corpusLangs, srcTags.filter(t=>t[0]==='progLang').map(t=>t[1]), suggestions.progLangs, false);
      const currentLicense = srcTags.find(t=>t[0]==='license')?.[1] || '';
      renderTagButtons('sfLicenseWrap', 'sfLicense', corpusLicenses, currentLicense ? [currentLicense] : [], suggestions.licenses, true);
    }
  }
}

function filterTagButtons(containerId, query) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const q = query.trim().toLowerCase();
  wrap.querySelectorAll('.tag-btn').forEach(btn => {
    const val = (btn.dataset.val || '').toLowerCase();
    btn.style.display = (!q || val.includes(q)) ? '' : 'none';
  });
}

function addNewValue(containerId, hiddenInputId, rawVal, singleSelect) {
  let val = rawVal.trim();
  if (!val) return;
  // NIP normalization: strip prefix, keep digits only, reformat as NIP-NN with leading zero
  if (containerId.includes('Nips')) {
    val = val.replace(/^nip-?/i, '').replace(/\D/g, '');
    if (!val) return;
    val = 'NIP-' + String(parseInt(val, 10)).padStart(2, '0');
  }
  const wrap = document.getElementById(containerId);
  const input = document.getElementById(hiddenInputId);
  if (!wrap || !input) return;
  // Check if already exists as a button
  if (wrap.querySelector(`button[data-val="${CSS.escape(val)}"]`)) {
    // Just activate it
    const btn = wrap.querySelector(`button[data-val="${CSS.escape(val)}"]`);
    if (btn) {
      if (singleSelect) {
        wrap.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
      }
      btn.classList.add('active');
    }
  } else {
    // Create new button and append
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-btn active';
    btn.dataset.val = val;
    btn.textContent = val;
    btn.onclick = () => toggleTagBtn(btn, hiddenInputId, singleSelect);
    wrap.appendChild(btn);
  }
  // Update hidden input
  if (singleSelect) {
    input.value = val;
  } else {
    const active = Array.from(wrap.querySelectorAll('.tag-btn.active')).map(b => b.dataset.val);
    input.value = active.join(', ');
  }
}

function renderTagButtons(containerId, hiddenInputId, allValues, selectedValues, suggestions, singleSelect) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const selSet = new Set(selectedValues);
  // Build ordered list: suggestions first, then by frequency
  const ordered = [];
  const seen = new Set();
  // 1. suggestions (highlighted)
  Object.entries(suggestions || {}).forEach(([val, meta]) => {
    if (seen.has(val)) return;
    seen.add(val);
    ordered.push({ val, active: selSet.has(val), suggested: true, authors: meta.authors || [] });
  });
  // 2. corpus frequency rest
  const freq = window._corpusFreq || {};
  const bucketFreq = (() => {
    if (containerId.includes('Tags')) return freq.tags;
    if (containerId.includes('Platforms')) return freq.platforms;
    if (containerId.includes('Nips')) return freq.nips;
    if (containerId.includes('ProgLangs')) return freq.progLangs;
    if (containerId.includes('License')) return freq.licenses;
    return {};
  })();
  allValues.forEach(val => {
    if (seen.has(val)) return;
    seen.add(val);
    ordered.push({ val, active: selSet.has(val), suggested: false, authors: [] });
  });
  // sort: active first, then suggested, then by freq
  ordered.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
    const fa = bucketFreq[a.val] || 0;
    const fb = bucketFreq[b.val] || 0;
    return fb - fa || a.val.localeCompare(b.val);
  });

  wrap.innerHTML = ordered.map(o => {
    const cls = ['tag-btn', o.active ? 'active' : '', o.suggested ? 'suggested' : ''].join(' ');
    const authorHint = o.authors.length ? `<span class="suggest-authors" title="Suggested by ${esc(o.authors.join(', '))}">👤${o.authors.length}</span>` : '';
    const authorInline = o.authors.length ? `<span class="suggest-authors-inline">by ${esc(o.authors.slice(0,2).join(', '))}${o.authors.length>2?'...':''}</span>` : '';
    return `<button type="button" class="${cls}" onclick="toggleTagBtn(this,'${hiddenInputId}',${singleSelect})" data-val="${esc(o.val)}">${esc(o.val)}${authorHint}${authorInline}</button>`;
  }).join('');
}

function toggleTagBtn(el, hiddenInputId, singleSelect) {
  const wrap = el.closest('.tag-btn-grid');
  const input = document.getElementById(hiddenInputId);
  if (!input) return;
  const val = el.dataset.val;
  if (singleSelect) {
    // Only one can be active
    wrap.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    input.value = val;
  } else {
    el.classList.toggle('active');
    const active = Array.from(wrap.querySelectorAll('.tag-btn.active')).map(b => b.dataset.val);
    input.value = active.join(', ');
  }
}

function renderDescTabs(slug, currentDesc) {
  const tabsWrap = document.getElementById('sfDescTabs');
  const preview = document.getElementById('sfDescPreview');
  const ta = document.getElementById('sfDesc');
  if (!tabsWrap) return;
  const suggestions = gatherSlugSuggestions(slug);
  const others = Object.values(suggestions.descriptions || {});
  if (!others.length) { tabsWrap.innerHTML = ''; preview.style.display = 'none'; ta.style.display = ''; return; }

  let html = `<button type="button" class="desc-tab active" onclick="showDescTab('self','${esc(slug)}')" data-tab="self">✎ Your version</button>`;
  others.forEach(o => {
    const avatar = profileCache[o.hex]?.picture ? `<img class="tab-avatar" src="${esc(profileCache[o.hex].picture)}" onerror="this.style.display='none'">` : '';
    html += `<button type="button" class="desc-tab" onclick="showDescTab('${esc(o.hex)}','${esc(slug)}')" data-tab="${esc(o.hex)}">${avatar}${esc(o.name)}</button>`;
  });
  tabsWrap.innerHTML = html;
  preview.style.display = 'none';
  ta.style.display = '';
}

function showDescTab(tabKey, slug) {
  const tabsWrap = document.getElementById('sfDescTabs');
  const preview = document.getElementById('sfDescPreview');
  const ta = document.getElementById('sfDesc');
  if (!tabsWrap || !preview || !ta) return;
  tabsWrap.querySelectorAll('.desc-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabKey));
  if (tabKey === 'self') {
    preview.style.display = 'none';
    ta.style.display = '';
    return;
  }
  const suggestions = gatherSlugSuggestions(slug);
  const desc = suggestions.descriptions[tabKey];
  if (!desc) return;
  ta.style.display = 'none';
  preview.style.display = '';
  // Diff highlighting: split into paragraphs, compare to current text
  const currentParas = (ta.value || '').split(/\n+/).filter(Boolean);
  const otherParas = (desc.text || '').split(/\n+/).filter(Boolean);
  const currentSet = new Set(currentParas);
  const html = otherParas.map(p => {
    if (currentSet.has(p)) return `<div>${esc(p)}</div>`;
    const partial = currentParas.some(cp => cp.includes(p) || p.includes(cp));
    const cls = partial ? 'desc-para-diff' : 'desc-para-added';
    return `<div class="${cls}">${esc(p)}</div>`;
  }).join('\n');
  preview.innerHTML = html;
}

function updateSplitSuggestions(slug) {
  const wrap = document.getElementById('sfSplits');
  if (!wrap) return;
  const suggestions = gatherSlugSuggestions(slug);
  const existingHexes = new Set(_editSplits.map(s => s.pubkey));
  const suggestedSplits = Object.entries(suggestions.splits || {}).filter(([pk]) => !existingHexes.has(pk));
  if (!suggestedSplits.length) return;
  // Build suggestion headline
  const allAuthors = new Set();
  suggestedSplits.forEach(([_, meta]) => meta.authors.forEach(a => allAuthors.add(a)));
  const authorList = Array.from(allAuthors).slice(0,3).join(', ') + (allAuthors.size > 3 ? ` +${allAuthors.size-3} more` : '');
  const headline = `<div class="split-suggestion-headline">⚡ Contributors mentioned by ${esc(authorList)}:</div>`;
  const rows = suggestedSplits.map(([pk, meta]) => {
    const p = profileCache[pk] || {};
    const npub = hexToNpub(pk);
    const name = p.name || (npub.slice(0, 14) + '…');
    const avatar = p.picture ? `<img class="avatar" src="${esc(p.picture)}" onerror="this.src='/images/nostrich.webp'">` : '<span class="avatar-placeholder">👤</span>';
    return `<div class="split-row suggested" data-pubkey="${esc(pk)}">
      <span class="split-avatar">${avatar}</span>
      <span class="split-name"><a href="https://njump.me/${npub}" target="_blank">${esc(name)}</a></span>
      <span style="font-size:11px;color:#888;margin-left:auto;">Suggested by ${esc(meta.authors.join(', '))}</span>
      <button type="button" class="split-add-btn" onclick="adoptSplitSuggestion('${esc(pk)}',${meta.weight})" style="margin-left:8px;">+ Add</button>
    </div>`;
  }).join('');
  // Append after the normal split rows
  let existing = wrap.querySelector('.split-suggestions');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'split-suggestions';
  div.innerHTML = headline + rows;
  wrap.appendChild(div);
}

function adoptSplitSuggestion(pubkey, weight) {
  if (_editSplits.find(s => s.pubkey === pubkey)) return;
  _editSplits.push({ pubkey, weight: weight || 1 });
  renderSplitEditor(_editSplits);
  updateSplitSuggestions(_editingSlug);
  if (!profileCache[pubkey]) {
    queryAll(RELAYS.slice(0,2), { kinds:[0], authors:[pubkey] }, ev => {
      try {
        const c = JSON.parse(ev.content);
        profileCache[pubkey] = { name: c.display_name||c.name||'', picture: c.picture||'', npub: hexToNpub(pubkey), lud16: c.lud16||'' };
      } catch(e){}
    }, 4000).then(() => { renderSplitEditor(_editSplits); updateSplitSuggestions(_editingSlug); });
  }
}

function buildTagDatalist() {
  // Legacy no-op — replaced by button grids
}

// ─── Split editor ───────────────────────────────────────────────────────────
function renderSplitEditor(splits) {
  const wrap = document.getElementById('sfSplits');
  if (!wrap) return;

  if (!splits.length) {
    wrap.innerHTML = '<p class="split-empty">No contributors — zaps go entirely to the publisher. <button type="button" class="split-add-btn" onclick="addSplitRow()">+ Add contributor</button></p>';
    return;
  }

  const rows = splits.map((s, i) => {
    const p      = profileCache[s.pubkey] || {};
    const npub   = hexToNpub(s.pubkey);
    const name   = p.name || (npub.slice(0, 14) + '…');
    const avatar = p.picture
      ? `<img class="avatar" src="${esc(p.picture)}" onerror="this.src='/images/nostrich.webp'">`
      : '<span class="avatar-placeholder">👤</span>';
    const w = s.weight;
    return `
      <div class="split-row" data-index="${i}">
        <span class="split-avatar">${avatar}</span>
        <span class="split-name"><a href="https://njump.me/${npub}" target="_blank">${esc(name)}</a></span>
        <input class="split-slider" type="range" min="0" max="100" value="${w}"
          data-idx="${i}"
          oninput="_editSplits[${i}].weight=parseInt(this.value);this.nextElementSibling.textContent=this.value">
        <span class="split-weight">${w}</span>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="split-rows">${rows}</div>
    <div class="split-footer">
      <button type="button" class="split-add-btn" onclick="addSplitRow()">+ Add contributor</button>
      <span class="split-hint">0 = excluded on publish · 100 = full share · relative weights (50+50 = equal split)</span>
    </div>`;
  // Re-attach split suggestions if we're editing
  if (_editingSlug) updateSplitSuggestions(_editingSlug);
}

function addSplitRow() {
  const raw = prompt('Add contributor (paste npub or hex pubkey):')?.trim();
  if (!raw) return;
  let hex;
  if (raw.startsWith('npub1')) {
    hex = bech32ToHex(raw);
  } else if (/^[0-9a-f]{64}$/.test(raw)) {
    hex = raw;
  }
  if (!hex) { alert('Invalid pubkey. Paste an npub or 64-char hex.'); return; }
  if (_editSplits.find(s => s.pubkey === hex)) { alert('Already in the split list.'); return; }
  _editSplits.push({ pubkey: hex, weight: 100 });
  // Kick off profile fetch if we don't have it yet
  if (!profileCache[hex]) {
    queryAll(RELAYS.slice(0,2), { kinds:[0], authors:[hex] }, ev => {
      try {
        const c = JSON.parse(ev.content);
        profileCache[hex] = { name: c.display_name||c.name||'', picture: c.picture||'', npub: hexToNpub(hex), lud16: c.lud16||'' };
      } catch(e) {}
    }, 4000).then(() => renderSplitEditor(_editSplits));
  }
  renderSplitEditor(_editSplits);
}

// Seed the split editor with the logged-in user at weight 100 (plus any existing splits)
function seedSplitWithSelf(existingSplits) {
  if (!loggedInPubkey) return existingSplits;
  // If self already present, leave as-is
  if (existingSplits.find(s => s.pubkey === loggedInPubkey)) return existingSplits;
  return [{ pubkey: loggedInPubkey, weight: 100 }, ...existingSplits];
}

function updateAnchorUI() {
  const chip = document.getElementById('anchorChip');
  if (!chip) return;
  const anchorProf = profileCache[anchorPubkey] || {};
  const anchorNpub = hexToNpub(anchorPubkey);
  const anchorName = anchorProf.name || (anchorNpub.slice(0, 12) + '…');
  const isDefault  = anchorPubkey === CURATOR;
  const isSelf     = anchorPubkey === loggedInPubkey;

  if (isSelf) {
    // When viewing own WoT, chip is redundant (it's them)
    chip.style.display = 'none';
  } else {
    chip.style.display = 'inline';
    chip.innerHTML = `🔭 <a href="javascript:void(0)" onclick="openAnchorPicker()" style="color:#888;text-decoration:none;" title="Change trust anchor">${esc(anchorName)}'s WoT</a>`;
  }
}

let _anchorPickerModal = null;

function openAnchorPicker() {
  // Build list of known resource publishers from what we've seen
  const publishers = [...new Set(allResourceEvents.map(e => e.pubkey))]
    .filter(pk => pk && pk.length === 64)
    .sort((a, b) => {
      // sort by number of events published
      const ca = allResourceEvents.filter(e => e.pubkey === a).length;
      const cb = allResourceEvents.filter(e => e.pubkey === b).length;
      return cb - ca;
    })
    .slice(0, 50);

  const rows = publishers.map(pk => {
    const p    = profileCache[pk] || {};
    const npub = hexToNpub(pk);
    const name = p.name || (npub.slice(0, 16) + '…');
    const cnt  = allResourceEvents.filter(e => e.pubkey === pk).length;
    const avatar = p.picture
      ? `<img src="${esc(p.picture)}" onerror="this.src='/images/nostrich.webp'" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;">`
      : `<img src="/images/nostrich.webp" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;">`;
    const active = pk === anchorPubkey ? ' style="font-weight:600;background:#e8f0fe;"' : '';
    return `<div class="anchor-row"${active} onclick="pickAnchor('${esc(pk)}')">
      ${avatar}<span>${esc(name)}</span>
      <span style="margin-left:auto;font-size:11px;color:#aaa;">${cnt} events</span>
    </div>`;
  }).join('');

  if (!_anchorPickerModal) {
    const dm = document.createElement('div');
    dm.id = 'anchorPickerModal';
    dm.style.cssText = 'position:fixed;inset:0;z-index:9200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
    dm.addEventListener('click', e => { if (e.target === dm) dm.style.display='none'; });
    document.body.appendChild(dm);
    _anchorPickerModal = dm;
  }

  _anchorPickerModal.innerHTML = `
    <div style="background:#fff;border-radius:10px;max-width:480px;width:100%;margin:16px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid #e0e0e0;flex-shrink:0;">
        <strong style="font-size:15px;">🔭 Choose trust anchor</strong>
        <p style="margin:6px 0 0;font-size:12px;color:#666;">Whose follows define what's curated? Default = ${esc(hexToNpub(CURATOR).slice(0,16))}… (Leo's curator account)</p>
      </div>
      <div style="overflow-y:auto;flex:1;padding:8px 0;">
        ${rows || '<p style="padding:12px 18px;color:#888;font-size:13px;">No publishers loaded yet.</p>'}
      </div>
      <div style="padding:12px 18px;border-top:1px solid #e0e0e0;flex-shrink:0;">
        <div style="font-size:12px;margin-bottom:6px;color:#555;">Or enter any npub:</div>
        <div style="display:flex;gap:8px;">
          <input id="anchorNpubInput" type="text" placeholder="npub1…" style="flex:1;padding:6px;border:1px solid #dadce0;border-radius:6px;font-size:13px;font-family:monospace;">
          <button onclick="pickAnchorFromInput()" style="padding:6px 14px;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;">Use</button>
        </div>
        ${loggedInPubkey ? `<button onclick="pickAnchor('${esc(loggedInPubkey)}')" style="margin-top:8px;padding:6px 14px;border:1px solid #dadce0;border-radius:6px;background:#f8f9fa;cursor:pointer;font-size:12px;width:100%;">↩ Use my own WoT</button>` : ''}
        <button onclick="pickAnchor('${esc(CURATOR)}')" style="margin-top:6px;padding:6px 14px;border:1px solid #dadce0;border-radius:6px;background:#f8f9fa;cursor:pointer;font-size:12px;width:100%;">↩ Use default curator (Leo's curator)</button>
      </div>
    </div>`;
  _anchorPickerModal.style.display = 'flex';
}

function pickAnchor(pubkey) {
  if (_anchorPickerModal) _anchorPickerModal.style.display = 'none';
  setAnchor(pubkey);
}

function pickAnchorFromInput() {
  const val = document.getElementById('anchorNpubInput')?.value?.trim();
  if (!val) return;
  let hex = null;
  if (val.startsWith('npub1')) hex = bech32ToHex(val);
  else if (/^[0-9a-f]{64}$/.test(val)) hex = val;
  if (!hex) { alert('Invalid npub or hex pubkey'); return; }
  pickAnchor(hex);
}

function updateLoginUI() {
  const loginBtn   = document.getElementById('loginBtn');
  const loggedAs   = document.getElementById('loggedInAs');
  if (loggedInPubkey) {
    if (loginBtn)   loginBtn.style.display = 'none';
    const npub = hexToNpub(loggedInPubkey);
    const prof = profileCache[loggedInPubkey] || {};
    const avatarSrc = prof.picture || '/images/nostrich.webp';
    const name = prof.name ? esc(prof.name) : npub.slice(0,14) + '…';
    const sessionType = window.nostr?._getSessionType?.() || 'bunker';
    const sessionLabel = sessionType === 'ext' ? '🧩 Browser extension'
      : sessionType === 'nsec' ? '🔑 Local key'
      : '🔗 Bunker / QR signer';
    if (loggedAs) loggedAs.innerHTML = `
      <span class="auth-chip" tabindex="0" onclick="toggleAuthDropdown(event)">
        <img src="${esc(avatarSrc)}" onerror="this.src='/images/nostrich.webp'"
          style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">
        <span style="vertical-align:middle;font-size:13px;">${name}</span>
        <span style="vertical-align:middle;font-size:10px;color:#999;">▾</span>
      </span>
      <div class="auth-dropdown" id="authDropdown" style="display:none;">
        <div class="auth-dropdown-npub">${npub}</div>
        <div class="auth-dropdown-method">${sessionLabel}</div>
        <button class="auth-dropdown-logout" onclick="doLogout()">↩ Logout</button>
      </div>`;
  } else {
    if (loginBtn)   loginBtn.style.display = 'inline';
    if (loggedAs)   loggedAs.textContent = '';
  }
  // Re-render cards so edit buttons / vote state update
  if (allResources.length) render();
  updateAnchorUI();
}

function toggleAuthDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('authDropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // close on next outside click
    setTimeout(() => document.addEventListener('click', function _c() {
      dd.style.display = 'none';
      document.removeEventListener('click', _c);
    }), 0);
  }
}

function doLogout() {
  document.getElementById('authDropdown')?.style && (document.getElementById('authDropdown').style.display = 'none');
  nwcClearConnection();
  if (window.nostr?.logout) window.nostr.logout();
  else document.dispatchEvent(new CustomEvent('nlLogout'));
}

async function publishEvent(signed) {
  // Send to ALL relays in parallel. For each relay:
  // - connect, send EVENT, wait for OK or a short grace period, then close.
  // - Do NOT close immediately after send — buffered sends can be dropped.
  // Returns as soon as at least one relay acknowledges, throws only if all fail.
  return new Promise((resolve, reject) => {
    let successes = 0;
    let closed    = 0;
    const total   = RELAYS.length;
    const done    = (url, ok) => {
      if (ok) { successes++; if (successes === 1) resolve(url); }
      else     closed++;
      if (closed + successes === total && successes === 0)
        reject(new Error('All relays failed or timed out'));
    };
    RELAYS.forEach(url => {
      try {
        const ws = new WebSocket(url);
        let timer;
        ws.onopen = () => {
          ws.send(JSON.stringify(['EVENT', signed]));
          // Give relay 3s to respond with OK, then close regardless
          timer = setTimeout(() => { ws.close(); done(url, false); }, 3000);
        };
        ws.onmessage = msg => {
          try {
            const d = JSON.parse(msg.data);
            if (d[0] === 'OK' && d[1] === signed.id) {
              clearTimeout(timer);
              ws.close();
              done(url, d[2] !== false); // d[2]=true means accepted
            }
          } catch(e) {}
        };
        ws.onerror = () => { clearTimeout(timer); done(url, false); };
        ws.onclose = () => {}; // handled above
        // Hard timeout: 5s total
        setTimeout(() => { try { ws.close(); } catch(e){} done(url, false); }, 5000);
      } catch(e) { done(url, false); }
    });
  });
}

async function submitResource() {
  const status = document.getElementById("sfStatus");
  const set = (msg, col="#333") => { status.innerHTML=msg; status.style.color=col; };

  if (!window.nostr) {
    set("Please log in first (click 🔑 Login above).","#b06000");
    return;
  }

  set("Preparing…");
  const slug  = document.getElementById("sfSlug").value.trim().toLowerCase().replace(/[^a-z0-9.-]/g,"");
  const title = document.getElementById("sfTitle").value.trim();
  const git   = document.getElementById("sfGit").value.trim();
  const web   = document.getElementById("sfWeb").value.trim();
  const desc  = document.getElementById("sfDesc").value.trim();
  const tags  = document.getElementById("sfTags").value.split(",").map(s=>s.trim()).filter(Boolean);
  const plats = document.getElementById("sfPlatforms").value.split(",").map(s=>s.trim()).filter(Boolean);
  const nips  = document.getElementById("sfNips").value.split(",").map(s=>s.trim().replace(/^nip-?/i,'')).filter(Boolean);
  const progLangs = document.getElementById("sfProgLangs").value.split(",").map(s=>s.trim()).filter(Boolean);
  const license = document.getElementById("sfLicense").value.trim();
  // Parse instances from textarea (one per line: url OR "Name | url | comment")
  const instances = document.getElementById("sfInstances").value.split("\n")
    .map(l => l.trim()).filter(Boolean).map(l => {
      const parts = l.split('|').map(p => p.trim());
      if (parts.length === 1) return parts[0]; // plain url
      const obj = { url: parts[1] || parts[0] };
      if (parts[0] && parts[0] !== obj.url) obj.name = parts[0];
      if (parts[2]) obj.comment = parts[2];
      return obj;
    });
  const isDiscontinued = document.getElementById("sfDiscontinued")?.checked || false;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!slug)  return set("Slug is required (used as the event d-tag).","#c5221f");
  if (!title) return set("Title is required.","#c5221f");
  if (!git && !web) return set("At least one URL (Git or Web) is required.","#c5221f");
  if (git  && !/^https?:\/\//.test(git))  return set("Git URL must start with https://","#c5221f");
  if (web  && !/^https?:\/\//.test(web))  return set("Web URL must start with https://","#c5221f");
  if (!tags.length && !plats.length) return set("Please add at least one tag or platform (e.g. client, web).","#c5221f");
  // ────────────────────────────────────────────────────────────────────────────

  // Always use the form slug; if it changed during edit, old slug gets retired.
  const finalSlug = slug;
  const oldSlug = _editingSlug;

  // Build zap-split tags from the editor state.
  // Only include entries with weight > 0.
  const activeSplits = _editSplits.filter(s => s.weight > 0);
  const splitTags = activeSplits.map(s => ['zap-split', s.pubkey, String(s.weight)]);

  // When editing, carry forward any tags from the source event that we don't
  // explicitly handle in the form (e.g. future custom tags). This prevents
  // silent data loss when the form doesn't expose every tag type.
  const HANDLED_TAG_KEYS = new Set(['d','t','platform','r','zap-split','nip','progLang','license']);
  const passthroughTags = [];
  if (oldSlug) {
    const r = allResources.find(x => x.slug === oldSlug);
    const srcEv = r ? (slugVersions[oldSlug] || []).find(v => v.id === r.eventId) : null;
    if (srcEv) {
      for (const t of (srcEv.tags || [])) {
        if (!HANDLED_TAG_KEYS.has(t[0])) passthroughTags.push(t);
      }
    }
  }

  const event = {
    kind: 30078,
    created_at: Math.floor(Date.now()/1000),
    tags: [
      ['d', finalSlug], ['t', NAMESPACE],
      ...tags.map(t=>['t',t]),
      ...(isDiscontinued ? [['t','discontinued']] : []),
      ...plats.map(p=>['platform',p]),
      ...nips.map(n=>['nip',n]),
      ...(license ? [['license',license]] : []),
      ...progLangs.map(l=>['progLang',l]),
      ...(git?[['r',git]]:[]),
      ...(web?[['r',web]]:[]),
      ...splitTags,
      ...passthroughTags,
    ],
    content: JSON.stringify({title, description:desc, git, web, instances}),
  };

  // nostr-login handles ALL signer types transparently:
  // - NIP-07 browser extension (Alby, nos2x, Flamingo...)
  // - NIP-46 bunker URL (nsec.app, highlighter.com...)
  // - Amber on Android (NIP-55 intent)
  // - local nsec (entered in nostr-login UI)
  set("Waiting for signer (extension / bunker / Amber)…");
  let signed;
  try {
    signed = await window.nostr.signEvent(event);
  } catch(e) {
    return set("Signing failed: "+(e.message||e),"#c5221f");
  }

  set("Publishing…");
  try {
    const relay = await publishEvent(signed);
    set("✅ Published to " + relay, "#137333");
    _editingSlug = null;
    _editSplits  = [];
    // Inject the new event directly — no page reload needed
    if (!allResourceEvents.some(e => e.id === signed.id)) {
      allResourceEvents.push(signed);
    }
    renderOrder = null;
    dedupAndRender();
    setTimeout(() => closeSubmitModal(), 1200);
  } catch(e) { set("Signed but could not reach any relay.", "#b06000"); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener("load", async () => {
  logR("init:start");
  startLiveSubscription();
  document.getElementById("curatedCb")?.addEventListener("change", e => {
    curatedOnly = e.target.checked; renderOrder = null; render();
  });
  document.getElementById("searchInput")?.addEventListener("input", e => {
    searchQuery = e.target.value; renderOrder = null; render();
  });

  // Listen for future login/logout events (manual login via modal)
  document.addEventListener("nlAuth", async e => {
    if (e.detail.type === "login" || e.detail.type === "signup") {
      try {
        loggedInPubkey = await window.nostr.getPublicKey();
        await fetchOwnProfile();
        // When logged in, switch anchor to own pubkey so their WoT takes over
        setAnchor(loggedInPubkey);
      } catch(err) {}
    } else {
      loggedInPubkey = null;
      nwcClearConnection();
      // On logout, revert anchor to default curator
      setAnchor(CURATOR);
    }
    updateLoginUI();
  });

  const sessionType = window.nostr?._getSessionType?.();
  logR("init:sessionType", sessionType);
  if (!sessionType) {
    logR("init:no saved session");
  }
  // Also give late-injecting extensions a moment
  await new Promise(r => setTimeout(r, 100));

  logR("init:followsPromise:begin");
  // Start connectRelays immediately so IDB cache shows something fast.
  // loadAnchorFollows runs in parallel; when it finishes, re-render with correct WoT.
  // Session resolution happens in the background: fast signers resolve before any UI
  // appears, slow bunkers show progressive feedback ("It\'s taking longer than expected…").
  const followsPromise = (async () => {
    let resolvedPubkey = null;
    if (window.nostr) {
      const start = performance.now();
      let statusTimer = null;
      let longWaitTimer = null;
      // Show feedback only if session takes longer than expected
      statusTimer = setTimeout(() => {
        setStatus('⧳ Connecting to your signer…');
      }, 1500);
      longWaitTimer = setTimeout(() => {
        setStatus('⧳ It\'s taking longer than expected to talk to your bunker…');
      }, 5000);
      try {
        resolvedPubkey = await Promise.race([
          window.nostr.getPublicKey(),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('Signer connection timeout')), 30000))
        ]);
        clearTimeout(statusTimer);
        clearTimeout(longWaitTimer);
        const elapsed = Math.round(performance.now() - start);
        logR("init:pubkey resolved", elapsed, "ms");
        if (elapsed > 1500) {
          setStatus('✓ Signer connected.');
          setTimeout(() => setStatus(''), 2500);
        }
      } catch(e) {
        clearTimeout(statusTimer);
        clearTimeout(longWaitTimer);
        logR("init:session failed", e.message);
        setStatus('⚠ Could not reach your signer. Login actions are unavailable.');
      }
    }
    if (resolvedPubkey) {
      loggedInPubkey = resolvedPubkey;
      try { await fetchOwnProfile(); } catch(e){}
      anchorPubkey = loggedInPubkey;
      updateLoginUI();
      updateAnchorUI();
      await loadAnchorFollows(loggedInPubkey);
    } else {
      await loadAnchorFollows(CURATOR);
    }
    // Re-render with correct WoT once follows are loaded
    logR("init:followsPromise:done", anchorPubkey?.slice(0,16)+'…');
    renderOrder = null;
    dedupAndRender();
  })();

  // Show empty state + submit card immediately (before any relay data)
  logR("init:render");
  render();
  // Kick off relay loading immediately (shows IDB cache right away)
  logR("init:call connectRelays");
  connectRelays();
});

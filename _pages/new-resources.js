---
layout: none
permalink: /js/new-resources.js
---

// nostr.info - Collaborative Directories NIP Demo (kind:30890/30891)
// Parallel implementation; does NOT touch /nips/ or /resources/

console.log('[new-resources.js] version: 20260522k-stage');

const RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.mostr.pub',
  'wss://nostr.oxtr.dev',
  'wss://relay.snort.social',
  'wss://nostr.mom',
];

// Public key of the nostr.info curator account (npub form — no private keys in repo)
// Override before loading the script via window.CURATOR_NPUB / window.NAMESPACE
const CURATOR_NPUB = window.CURATOR_NPUB || 'npub1c4ptewkhdzhzqutt0tq60z44jzhw2pg9pj888m905pv3m23svcqska5c34';
const NAMESPACE   = window.NAMESPACE || 'nostr.info/resource';
const logR = (...a) => { try { console.log('[nostr.info]', ...a); } catch(e) {} };
const FALLBACK_MS = 8000;

let allResourceEvents = [];
let curatedResources  = [];
let communityResources = [];
let deletedResources   = [];
let allResources      = [];
let allTags           = [];
let allPlatforms      = [];
let allRegularTags    = [];
let allNipsList       = [];
let allLicenses       = [];
let allStatuses       = [];
let allNipCategories  = [];
let namespaceDefinition = null;  // kind:30891 for active namespace
let contributors = new Map();    // pubkey → {hop, source} for active namespace
let anchorPubkey;   // current trust anchor (set after CURATOR is defined)
let tagCounts         = {};
let activeTags        = window.DEFAULT_TAGS || [];
let viewMode          = 0;  // 0 = WoT only, 1 = all, 2 = proposals only
let searchQuery       = '';
let loadedFrom        = '…';
let profileCache      = {};   // pubkey hex → {name, picture, npub, lud16}

// Persistent profile cache, shared across /newResources, /newNips, /resources, /nips.
// Lets the anchor pill show "<name>'s WoT" on first paint instead of "<npub1…>'s WoT"
// for anyone we've seen on any nostr.info page before.
const PROFILE_LS_KEY = 'nostr-info-profile-cache-v1';
const PROFILE_LS_MAX = 2000;

function hydrateProfileCache() {
  try {
    const raw = localStorage.getItem(PROFILE_LS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    for (const [pk, p] of Object.entries(map)) {
      if (!profileCache[pk]) profileCache[pk] = p;
    }
  } catch(e) {}
}

let _profilePersistTimer = null;
function setProfile(pubkey, data) {
  if (!pubkey || !data) return;
  profileCache[pubkey] = data;
  // Coalesce writes — profile floods during loadSecondary would otherwise hammer localStorage.
  clearTimeout(_profilePersistTimer);
  _profilePersistTimer = setTimeout(persistProfileCache, 300);
  // If this is the logged-in user's profile, refresh the header chip too —
  // it stays stale otherwise after a fresh login (fetchOwnProfile may resolve
  // before loadSecondary delivers the kind:0 from the relays we actually hit).
  if (typeof loggedInPubkey !== 'undefined' && pubkey === loggedInPubkey
      && typeof updateLoginUI === 'function') {
    try { updateLoginUI(); } catch(_) {}
  }
}

function persistProfileCache() {
  try {
    let entries = Object.entries(profileCache);
    if (entries.length > PROFILE_LS_MAX) {
      // Drop entries without a name first, then arbitrary truncation
      entries.sort((a, b) => (b[1]?.name ? 1 : 0) - (a[1]?.name ? 1 : 0));
      entries = entries.slice(0, PROFILE_LS_MAX);
    }
    localStorage.setItem(PROFILE_LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch(e) {}
}

hydrateProfileCache();
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
anchorPubkey = CURATOR;  // default trust anchor is the curator

// Hydrate the WoT from localStorage synchronously at module load, so cards
// arriving from IDB/relays are marked in-WoT immediately on subsequent visits.
// (loadContributorsCache is declared lower; hoisted by const? No — `function`
// declarations are hoisted, const isn't. So we inline the localStorage read
// here and the formal saver/loader sit alongside buildContributors below.)
try {
  const WOT_LS_KEY = 'nostr-info-wot-v1';
  const WOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const all = JSON.parse(localStorage.getItem(WOT_LS_KEY) || '{}');
  const entry = all[NAMESPACE + ':' + CURATOR];
  if (entry && Date.now() - entry.ts < WOT_TTL_MS) {
    for (const k of Object.keys(entry.map || {})) contributors.set(k, entry.map[k]);
  }
} catch(_) {}

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
  closeFocusedEntry();
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
// The `a` tag format is `30890:pubkey:d-value` (NIP-01 address).
function slugToAddr(slug, authorHex) {
  return `30890:${authorHex}:${slug}`;
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
          ['k', String(addr.split(':')[0] || '30890')],
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
          setProfile(ev.pubkey, { name: c.display_name||c.name||'', picture: c.picture||'', lud16: c.lud16||'', npub: hexToNpub(ev.pubkey) });
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

// ─── Djot → HTML (uses bundled @djot/djot library from assets/js/djot-*.js)
function djotToHtml(raw) {
  if (!raw) return '';
  if (typeof window.djot === 'undefined') {
    // If djot library hasn't loaded yet, return a version that preserves line breaks
    return raw.split('\n').map(l => l ? esc(l) : '').join('<br>');
  }
  try {
    const doc = window.djot.parse(raw);
    return window.djot.renderHTML(doc);
  } catch (e) {
    console.warn('djot parse error:', e);
    return raw.split('\n').map(l => l ? esc(l) : '').join('<br>');
  }
}

function mdToHtml(raw) {
  // All content in the new NIP is Djot. marked.js is no longer used.
  return djotToHtml(raw);
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
const IDB_NAME    = 'nostr-newdir-' + (NAMESPACE.replace(/[^a-z0-9_-]/gi, '-'));
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
      if (ev.kind === 30890 || ev.kind === 30891) entryEvents.push(ev);
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
        setProfile(ev.pubkey, {
          name:    c.display_name || c.name || '',
          picture: c.picture || '',
          npub:    hexToNpub(ev.pubkey),
          lud16:   c.lud16 || '',
        });
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
        ws.send(JSON.stringify(['REQ','r1',{kinds:[30890,30891],'#n':[NAMESPACE],limit:1000}]));
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
      ws.onopen = () => { logR("liveSub:open", url); ws.send(JSON.stringify(['REQ','live',{kinds:[30890,30891],'#n':[NAMESPACE],since,limit:0}])); };
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
        setProfile(ev.pubkey, {
          name:    c.display_name || c.name || '',
          picture: c.picture || '',
          npub:    hexToNpub(ev.pubkey),
          lud16:   c.lud16 || '',
        });
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

// ─── NIP-compliant Trust Graph (replaces loadAnchorFollows / wotTrust / pickWinner) ──────────
// namespaceDefinition: the active kind:30891 event
// contributors: Map<pubkey, {hop, source}>  source = 'owner'|'expert'|'follow'

async function resolveNamespaceDefinition(ownerPubkey) {
  // Query for the owner's latest kind:30891 for this namespace slug
  logR("resolveNamespace:query", ownerPubkey);
  let def = null;
  await queryAll(RELAYS.slice(0, 3), { kinds: [30891], authors: [ownerPubkey], '#d': [NAMESPACE], limit: 1 }, ev => {
    if (!def || ev.created_at > def.created_at) def = ev;
  }, 4000);
  namespaceDefinition = def;
  logR("resolveNamespace:found", def ? 'yes' : 'no');
  return def;
}

// Persist a built contributor set so the next load can mark WoT entries
// immediately instead of showing "In <X>'s WoT: 0" for 5+ seconds while the
// kind:3 chain re-queries.
const WOT_LS_KEY = 'nostr-info-wot-v1';
const WOT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
function wotKey(anchorPubkey) { return NAMESPACE + ':' + anchorPubkey; }
function saveContributorsCache(anchorPubkey) {
  try {
    const map = {}; for (const [k, v] of contributors) map[k] = v;
    const all = JSON.parse(localStorage.getItem(WOT_LS_KEY) || '{}');
    all[wotKey(anchorPubkey)] = { map, ts: Date.now() };
    localStorage.setItem(WOT_LS_KEY, JSON.stringify(all));
  } catch(_) {}
}
function loadContributorsCache(anchorPubkey) {
  try {
    const all = JSON.parse(localStorage.getItem(WOT_LS_KEY) || '{}');
    const entry = all[wotKey(anchorPubkey)];
    if (!entry) return null;
    if (Date.now() - entry.ts > WOT_TTL_MS) return null;
    const m = new Map();
    for (const k of Object.keys(entry.map || {})) m.set(k, entry.map[k]);
    return m;
  } catch(_) { return null; }
}

async function buildContributors(anchorPubkey) {
  // If we have a cached set for this anchor, seed it immediately so the
  // first render after this resolves has the WoT marks. The relay queries
  // below will then refresh and replace.
  const cached = loadContributorsCache(anchorPubkey);
  contributors = cached || new Map();
  const def = namespaceDefinition || await resolveNamespaceDefinition(anchorPubkey);
  if (!def) {
    // Fallback: if no namespace definition, only the anchor is a contributor
    contributors.set(anchorPubkey, { hop: 0, source: 'owner' });
    return;
  }

  // Parse trust depths from namespace definition
  const expertsDepth = parseInt(def.tags?.find(t => t[0] === 'experts')?.[1] || '0', 10);
  const followsDepth = parseInt(def.tags?.find(t => t[0] === 'follows')?.[1] || '0', 10);

  // Hop 0: owner always contributes
  contributors.set(anchorPubkey, { hop: 0, source: 'owner' });

  // Always include the namespace curator as a qualifying contributor,
  // regardless of current anchor (so curated data is never filtered out).
  const curatorHex = (typeof window !== 'undefined' && window.CURATOR_NPUB
    ? normalizePubkey(window.CURATOR_NPUB)
    : null) || '3ba92045d75d0b0a39351b10f726463bdc6dda6f0c91d54140d582d42f8a2281';
  if (curatorHex !== anchorPubkey && !contributors.has(curatorHex)) {
    contributors.set(curatorHex, { hop: 0, source: 'owner' });
  }

  // ── Follow graph ──
  if (followsDepth >= 1) {
    const hop1Follows = new Set();
    try {
      await queryAll(RELAYS.slice(0, 3), { kinds: [3], authors: [anchorPubkey], limit: 1 }, ev => {
        (ev.tags || []).filter(t => t[0] === 'p').forEach(t => hop1Follows.add(t[1]));
      }, 3000);
    } catch(e) {}
    hop1Follows.forEach(pk => {
      if (!contributors.has(pk)) contributors.set(pk, { hop: 1, source: 'follow' });
    });

    if (followsDepth >= 2) {
      const hop1List = Array.from(hop1Follows);
      if (hop1List.length > 0) {
        try {
          await queryAll(RELAYS.slice(0, 3), { kinds: [3], authors: hop1List }, ev => {
            (ev.tags || []).filter(t => t[0] === 'p').forEach(t => {
              if (!contributors.has(t[1])) contributors.set(t[1], { hop: 2, source: 'follow' });
            });
          }, 4000);
        } catch(e) {}
      }
    }
  }

  // ── Expert graph ──
  // Hop 1: owner's explicit p tags on namespace definition
  const hop1Experts = new Set();
  (def.tags || []).filter(t => t[0] === 'p').forEach(t => hop1Experts.add(t[1]));
  hop1Experts.forEach(pk => {
    const existing = contributors.get(pk);
    if (!existing || existing.hop > 1) {
      contributors.set(pk, { hop: 1, source: 'expert' });
    }
  });

  // Hop 2: each L1 expert's own kind:30891 for this slug → their p tags
  if (expertsDepth >= 2 && hop1Experts.size > 0) {
    const expertList = Array.from(hop1Experts);
    try {
      await queryAll(RELAYS.slice(0, 3), { kinds: [30891], authors: expertList, '#d': [NAMESPACE] }, ev => {
        // Only use the p tags, NOT the experts/follows depth params
        (ev.tags || []).filter(t => t[0] === 'p').forEach(t => {
          if (!contributors.has(t[1])) contributors.set(t[1], { hop: 2, source: 'expert' });
        });
      }, 4000);
    } catch(e) {}
  }
  // Persist for the next page load — see WOT_LS_KEY notes above.
  saveContributorsCache(anchorPubkey);
}

function wotTrust(pubkey) {
  const c = contributors.get(pubkey);
  if (!c) return 1; // outside WoT
  return c.hop === 0 ? 3 : (c.hop <= 2 ? 2 : 1);
}

function pickWinner(group) {
  // Get namespace depths
  const def = namespaceDefinition;
  const expertsDepth = parseInt(def?.tags?.find(t => t[0] === 'experts')?.[1] || '0', 10);
  const followsDepth = parseInt(def?.tags?.find(t => t[0] === 'follows')?.[1] || '0', 10);

  // Filter to contributors within namespace depth, applying per-entry tightening
  const qualifying = group.filter(ev => {
    const c = contributors.get(ev.pubkey);
    if (!c) return false;

    // Per-entry tightening
    const entryFollows = ev.tags?.find(t => t[0] === 'follows')?.[1];
    const entryExperts = ev.tags?.find(t => t[0] === 'experts')?.[1];
    const effectiveFollowsDepth = entryFollows !== undefined
      ? Math.min(parseInt(entryFollows, 10), followsDepth)
      : followsDepth;
    const effectiveExpertsDepth = entryExperts !== undefined
      ? Math.min(parseInt(entryExperts, 10), expertsDepth)
      : expertsDepth;

    if (c.source === 'follow' && c.hop > effectiveFollowsDepth) return false;
    if (c.source === 'expert' && c.hop > effectiveExpertsDepth) return false;
    // Owner (hop 0) always qualifies
    return true;
  });

  const pool = qualifying.length > 0 ? qualifying : group;
  pool.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  const winner = pool[0];

  // Submitter attribution: if winner is owner/curator, credit the community submitter
  const submitterEv = winner && winner.pubkey === anchorPubkey
    ? group.find(e => e.pubkey !== anchorPubkey && contributors.has(e.pubkey))
    : null;
  return { winner, submitterPubkey: submitterEv?.pubkey || null };
}

async function setAnchor(pubkey) {
  anchorPubkey = pubkey;
  renderOrder = null;
  await resolveNamespaceDefinition(pubkey);
  await buildContributors(pubkey);
  renderOrder = null;
  dedupAndRender();
  loadSecondary();
  updateLoginUI();   // chip name follows the anchor — needs to repaint
  // Fire-and-forget: ensure the anchor's own profile is fetched so the pill stops
  // showing a truncated npub. Re-render once it arrives. Skip if already cached.
  fetchAnchorProfile(pubkey);
}

async function fetchAnchorProfile(pubkey) {
  if (!pubkey || profileCache[pubkey]) return;
  try {
    let got = false;
    await queryAll(RELAYS.slice(0, 3), { kinds: [0], authors: [pubkey] }, ev => {
      try {
        const c = JSON.parse(ev.content);
        setProfile(pubkey, {
          name:    c.display_name || c.name || '',
          picture: c.picture || '',
          npub:    hexToNpub(pubkey),
          lud16:   c.lud16 || '',
        });
        got = true;
      } catch(e) {}
    }, 4000);
    if (got) { render(); updateLoginUI(); }
  } catch(e) {}
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

  const inWoT = [], outsideWoT = [], deleted = [];
  Object.values(byD).forEach(group => {
    group.sort((a,b) => b.created_at - a.created_at);
    const { winner, submitterPubkey } = pickWinner(group);
    // Community-deleted: the winning version carries a 'deleted' tag. Keep the entry
    // so a curator can find and undo an accidental tombstoning via the edit modal.
    const isDeleted = winner.tags?.some(t => (t[0] === 'deleted') || (t[0] === 't' && t[1] === 'deleted'));
    if (isDeleted) {
      deleted.push({ ev: winner, submitterPubkey });
      return;
    }
    const trust = wotTrust(winner.pubkey);
    if (trust >= 2) {
      inWoT.push({ ev: winner, submitterPubkey });
    } else {
      outsideWoT.push({ ev: winner, submitterPubkey });
    }
  });

  // "curated" = within anchor's WoT (anchor + follows); "community" = outside WoT;
  // "deleted" = tombstoned entries from any author, shown only in the Deleted view-mode.
  curatedResources   = inWoT.map(({ev, submitterPubkey}) => parseEvent(ev, submitterPubkey));
  communityResources = outsideWoT.map(({ev, submitterPubkey}) => parseEvent(ev, submitterPubkey));
  deletedResources   = deleted.map(({ev, submitterPubkey}) => parseEvent(ev, submitterPubkey));
  allResources       = [...curatedResources, ...communityResources, ...deletedResources];

  const tagSet = new Set();
  const platformSet = new Set();
  const regularTagSet = new Set();
  const nipSet = new Set();
  const licenseSet = new Set();
  const statusSet = new Set();
  const nipCatSet = new Set();
  tagCounts = {};
  const STATUS_WORDS = new Set(['draft','final','deprecated','mandatory','optional','recommended']);
  allResources.forEach(r => {
    r.platforms.forEach(t => { tagSet.add(t); platformSet.add(t); tagCounts[t] = (tagCounts[t] || 0) + 1; });
    r.tags.forEach(t => { tagSet.add(t); regularTagSet.add(t); tagCounts[t] = (tagCounts[t] || 0) + 1; });
    r.nips.forEach(t => { tagSet.add(t); nipSet.add(t); tagCounts[t] = (tagCounts[t] || 0) + 1; });
    if (r.license) { tagSet.add(r.license); licenseSet.add(r.license); tagCounts[r.license] = (tagCounts[r.license] || 0) + 1; }
    // NIP-specific corpus
    (r.status || []).forEach(s => { statusSet.add(s); tagCounts[s] = (tagCounts[s] || 0) + 1; });
    r.tags.forEach(t => { if (STATUS_WORDS.has(t)) { statusSet.add(t); tagCounts[t] = (tagCounts[t] || 0) + 1; } else { nipCatSet.add(t); } });
  });
  allTags = Array.from(tagSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));
  allPlatforms = Array.from(platformSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));
  // Subtract platforms from regular tags so an item isn't both (e.g. "web" is a platform, not a tag)
  const platformDedupedTags = new Set(allPlatforms);
  allRegularTags = Array.from(regularTagSet).filter(t => !platformDedupedTags.has(t)).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));
  allNipsList = Array.from(nipSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));
  allLicenses = Array.from(licenseSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));
  allStatuses = Array.from(statusSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));
  allNipCategories = Array.from(nipCatSet).sort((a, b) => (tagCounts[b]||0)-(tagCounts[a]||0) || a.localeCompare(b));

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
  // If a deep-link modal is showing the "Loading…" placeholder, fill it in now.
  refreshFocusedFromData();
  // Apply the initial #slug if the page was loaded with one and we now have data.
  if (!_focusedSlug) syncFocusToHash();
}

// ─── Event parsing ─────────────────────────────────────────────────────────────────────
// Collaborative Directories NIP (kind:30890/30891)
//   - Scoped d-tags:   ["d", "nips/nip-01"] or ["d", "nostrPr/my-project"]
//   - Namespace tag:  ["n", "nips"] or ["n", "nostrPr"]
//   - Content:         Djot plaintext (never JSON)
//   - Metadata:        title, summary, status, web, git, instance, platform,
//                      nip, progLang, license, zap, follows, experts
//   - Curated entries: published by the namespace owner (hop 0)
//   - Proposals:       published by any contributor within trust depth
//
// parseEvent: kind:30890/30891 ONLY. No legacy fallback.
function parseEvent(ev, submitterPubkey = null) {
  const tags = ev.tags || [];

  // d-tag is scoped: "nips/nip-01" or "nostrPr/my-project"
  const d = tags.find(t => t[0] === 'd')?.[1] || '';
  const n = tags.find(t => t[0] === 'n')?.[1] || NAMESPACE;

  // Content is plaintext / Djot (never JSON)
  const description = ev.content || '';

  const tagTitle    = tags.find(t => t[0] === 'title')?.[1];
  const tagSummary  = tags.find(t => t[0] === 'summary')?.[1];
  const tagStatus   = [...new Set(tags.filter(t => t[0] === 'status').map(t => t[1]))];
  const catTags     = [...new Set(tags.filter(t => t[0] === 't' && t[1] !== NAMESPACE).map(t => t[1]))];
  const platforms   = [...new Set(tags.filter(t => t[0] === 'platform').map(t => t[1]))];
  const nips        = [...new Set(tags.filter(t => t[0] === 'nip').map(t => 'NIP-' + t[1]))];
  const license     = tags.find(t => t[0] === 'license')?.[1] || '';
  const progLangs   = tags.filter(t => t[0] === 'progLang').map(t => t[1]);
  const refs        = tags.filter(t => t[0] === 'r').map(t => t[1]);

  const web      = tags.find(t => t[0] === 'web')?.[1] || '';
  const git      = tags.find(t => t[0] === 'git')?.[1] || '';
  const instances = tags.filter(t => t[0] === 'instance').map(t => t[1]);

  // Title: explicit tag → d-tag tail
  const title = tagTitle || d.split('/').pop() || '';

  // Description: tag summary → content
  const desc = tagSummary || description || '';

  // URL
  const url = web || git || (refs[0] || '#');

  // Zap splits: ["zap", pubkey, relay, weight]
  const zapSplits = tags
    .filter(t => t[0] === 'zap' && t[1])
    .map(t => ({ pubkey: normalizePubkey(t[1]), relay: t[2] || 'wss://relay.primal.net', weight: parseInt(t[3] || '1', 10) || 1 }))
    .filter(s => s.pubkey);

  // Per-entry tightening
  const entryFollows = tags.find(t => t[0] === 'follows')?.[1];
  const entryExperts = tags.find(t => t[0] === 'experts')?.[1];

  return {
    eventId:      ev.id,
    createdAt:    ev.created_at,
    pubkeyHex:    ev.pubkey,
    isCurated:    wotTrust(ev.pubkey) === 3,
    isWoT:        wotTrust(ev.pubkey) >= 2,
    submitterPubkey,
    title,
    slug:         d,
    url,
    web, git,
    description:  desc,
    instances,
    tags:         catTags, platforms, nips, license, progLangs,
    status:       tagStatus,
    zapSplits,
    entryFollows,
    entryExperts,
    authorNPub:   wotTrust(ev.pubkey) === 3 ? '' : hexToNpub(ev.pubkey),
    discontinued: catTags.includes('discontinued') || tags.some(t => t[0] === 'discontinued'),
    deleted:      catTags.includes('deleted')     || tags.some(t => t[0] === 'deleted'),
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

function renderAnchorPill(pubkey, isActive, count) {
  const p = profileCache[pubkey] || {};
  const npub = hexToNpub(pubkey);
  const name = p.name || (npub.slice(0, 12) + '…');
  const avatar = p.picture
    ? `<img src="${esc(p.picture)}" onerror="this.onerror=null;this.src='/images/nostrich.webp'" class="anchor-pill-avatar" alt="">`
    : `<img src="/images/nostrich.webp" class="anchor-pill-avatar" alt="">`;
  const countHtml = isActive ? `: ${count}` : '';
  // Active pill: clicking re-asserts viewMode 0 + clears filters (legacy behavior).
  // Inactive pill: clicking switches the anchor to this pubkey AND lands in WoT view.
  const onclick = isActive
    ? `viewMode=0;activeTags=[];searchQuery='';renderOrder=null;render();document.getElementById('searchInput').value='';`
    : `viewMode=0;pickAnchor('${esc(pubkey)}');`;
  const cls = 'stat curated' + (isActive ? ' stat--active' : '');
  const tip = isActive ? `Show ${esc(name)}'s WoT` : `Switch to ${esc(name)}'s WoT`;
  return `<span class="${cls}" onclick="${onclick}" style="cursor:pointer" title="${tip}">🔭 In ${avatar}${esc(name)}'s WoT${countHtml}</span>`;
}

function render() {
  // When a slug is focused via #fragment, render the dedicated entry view in
  // place of the list — normal document flow, no fixed positioning.
  if (_focusedSlug) {
    renderFocusedEntry();
    return;
  }
  const toggles = document.getElementById('toggles');
  if (toggles) toggles.style.display = '';
  const controls = document.querySelector('.controls');
  if (controls) controls.style.display = '';
  // viewMode: 0 = WoT only, 1 = all (non-deleted), 2 = outside WoT, 3 = deleted (cemetery view)
  let pool;
  if (viewMode === 3) {
    pool = deletedResources;
  } else if (viewMode === 2) {
    pool = communityResources;
  } else if (viewMode === 1) {
    pool = [...curatedResources, ...communityResources];
  } else {
    pool = curatedResources;
  }
  logR("render:pool:", pool.length, "viewMode:", viewMode, "allResources:", allResources.length);
  const q = searchQuery.toLowerCase();
  const filtered = pool.filter(r => {
    if (activeTags.length) {
      const all = [...r.tags, ...r.platforms, ...r.nips, ...(r.license ? [r.license] : []), ...(r.status || [])];
      if (!activeTags.every(t => all.includes(t))) return false;
    }
    if (q) {
      const haystack = [r.title, r.description, ...r.tags, ...r.platforms, ...(r.license ? [r.license] : []), ...(r.status || [])].join(' ').toLowerCase();
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

  const hasFilters = activeTags.length || searchQuery;
  const clearBtn   = hasFilters
    ? `<button class="action-btn" onclick="activeTags=[];searchQuery='';renderOrder=null;render();document.getElementById('searchInput').value='';" style="margin-left:auto;font-size:12px;">✕ Clear ${activeTags.map(t=>'#'+t).join(' ')}${searchQuery?' search':''}</button>`
    : '';
  const filterNote = hasFilters
    ? ` (filtered from ${pool.length})`
    : '';
  const isCuratorAnchor = anchorPubkey === CURATOR;
  const isSelfAnchor    = loggedInPubkey && anchorPubkey === loggedInPubkey;
  const isOtherAnchor   = !isCuratorAnchor && !isSelfAnchor;
  const activeCount     = curatedResources.length;
  let anchorPills = renderAnchorPill(CURATOR, isCuratorAnchor && viewMode===0, activeCount);
  if (loggedInPubkey && loggedInPubkey !== CURATOR) {
    anchorPills += renderAnchorPill(loggedInPubkey, isSelfAnchor && viewMode===0, activeCount);
  }
  if (isOtherAnchor) {
    anchorPills += renderAnchorPill(anchorPubkey, viewMode===0, activeCount);
  }

  const totalLive = curatedResources.length + communityResources.length;
  const deletedPill = deletedResources.length
    ? `<span class="stat deleted ${viewMode===3?'stat--active':''}" onclick="viewMode=3;activeTags=[];searchQuery='';renderOrder=null;render();document.getElementById('searchInput').value='';" style="cursor:pointer" title="Show entries tombstoned via community deletion — open one and uncheck 'deleted' in the edit form to restore">💀 Deleted: ${deletedResources.length}</span>`
    : '';
  let html = `<div class="stats-bar">
    ${anchorPills}
    <span class="stat all ${viewMode===1?'stat--active':''}" onclick="viewMode=1;activeTags=[];searchQuery='';renderOrder=null;render();document.getElementById('searchInput').value='';" style="cursor:pointer" title="Show all entries">🌐 All: ${totalLive}</span>
    <span class="stat community ${viewMode===2?'stat--active':''}" onclick="viewMode=2;activeTags=[];searchQuery='';renderOrder=null;render();document.getElementById('searchInput').value='';" style="cursor:pointer" title="Show outside-WoT entries only">👥 Outside WoT: ${communityResources.length}</span>
    ${deletedPill}
    <span class="stat filtered">${filtered.length}${filterNote}${clearBtn ? ' — ' : ''}</span>
    ${clearBtn}
  </div>`;

  html += filtered.map(r => renderCard(r)).join('');

  // ── Submit placeholder card ─────────────────────
  html += renderSubmitCard();

  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.innerHTML = html;
  renderToggles(pool);
  // After DOM update, show "more…" only on cards that are actually clipped
  requestAnimationFrame(checkAllDescOverflows);
}

function renderResourceCard(r) {
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

  // Instance/store/mirror links — events store them as either bare URL or
  // "Name | url | comment" strings; legacy data may pre-parse into objects.
  const instHtml = r.instances.length ? `<div class="resource-instances">${r.instances.map(i=>{
    const inst = parseInstance(i);
    if (!inst || !inst.url) return '';
    const com = inst.comment ? ' — ' + esc(inst.comment) : '';
    return `<a href="${esc(inst.url)}" target="_blank">${esc(inst.name || inst.url)}</a>${com}`;
  }).filter(Boolean).join(' · ')}</div>` : '';

  const descHtml = r.description ? `<div class="resource-desc"><div class="resource-desc-inner" onload="checkDescOverflow(this)">${mdToHtml(r.description)}</div><button class="desc-expand desc-expand--hidden" onclick="toggleDesc(this)">more…</button></div>` : '';
  const discontinuedBadge = r.discontinued ? `<span class="pill discontinued" title="This project appears to be discontinued">🪦 discontinued</span>` : '';
  const deletedBadge = r.deleted ? `<span class="pill deleted-badge" title="Tombstoned via community curation. Edit and uncheck 'deleted' to restore.">💀 deleted</span>` : '';
  const cardClass = [
    'resource-card',
    r.discontinued && 'resource-card--discontinued',
    r.deleted && 'resource-card--deleted',
  ].filter(Boolean).join(' ');

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
        <a class="card-permalink" href="${esc(LIST_BASE_PATH + slugSuffix(r.slug))}" title="Permalink — share this URL">🔗</a>
        ${r.web ? `<a href="${esc(r.web)}" target="_blank" class="card-link-icon" title="Website">🌐</a>` : ''}
        ${r.git ? `<a href="${esc(r.git)}" target="_blank" class="card-link-icon" title="Source">💻</a>` : ''}
        ${deleteBtn}
        ${editBtn}
      </div>
    </div>
    ${bylineHtml}
    ${r.progLangs.length ? `<div class="resource-meta">
      ${r.progLangs.length?`<span class="meta-item">with ${esc(r.progLangs.join(', '))}</span>`:''}
    </div>` : ''}
    ${instHtml}
    <div class="resource-tags">
      ${deletedBadge}
      ${discontinuedBadge}
      ${r.platforms.map(t=>`<span class="pill platform" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`).join('')}
      ${r.tags.filter(t=>t!=='discontinued'&&t!=='deleted').map(t=>`<span class="pill" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`).join('')}
      ${r.nips.map(t=>`<span class="pill nip" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`).join('')}
      ${r.license?`<span class="pill license" onclick="clickTag('${esc(r.license)}')">${esc(r.license)}</span>`:''}
      ${reactionHtml}
    </div>
    ${descHtml}
    ${actionBar}
  </div>`;
}

// ─── NIP Card ────────────────────────────────────────────────────────────────────────────
// Clean, information-dense card for NIP entries. No GitHub stars, no repo icons,
// no programming languages, no instances. Just number, title, status, abstract,
// category tags, and actions.

function renderNipCard(r) {
  const rc = reactionCache[r.slug] || { byAuthor: {}, zapMsat: 0 };
  const counts = reactionCounts(rc);
  const slug_  = esc(r.slug);

  const zapSats  = rc.zapMsat > 0 ? Math.floor(rc.zapMsat / 1000) : 0;
  const zapLabel = zapSats >= 1000 ? (zapSats/1000).toFixed(1)+'k' : (zapSats || '');
  const splitCount = r.zapSplits.length;
  const zapTitle = splitCount > 1 ? `Zap (split between ${splitCount} contributors)` : 'Zap this NIP';
  const splitsAttr = esc(JSON.stringify(splitCount ? r.zapSplits : [{ pubkey: r.pubkeyHex, weight: 1 }]));
  const hasZaps = zapSats > 0;
  const zapBtn = hasZaps
    ? `<span class="zap-btn-group"><button class="action-btn zap-action-btn" title="${esc(zapTitle)}" data-eventid="${esc(r.eventId)}" data-splits='${splitsAttr}' onclick="triggerZapFromBtn(this)">⚡</button><button class="action-btn zap-count-btn" title="View zap details" onclick="showZapDetails('${esc(r.slug)}')">${zapLabel}</button></span>`
    : `<button class="action-btn zap-action-btn" title="${esc(zapTitle)}" data-eventid="${esc(r.eventId)}" data-splits='${splitsAttr}' onclick="triggerZapFromBtn(this)">⚡</button>`;

  // Status badges: draft/final/deprecated + mandatory/optional/recommended
  // All tags — status included — are clickable filter pills.
  const STATUS_META = { draft:'#f59e0b', final:'#137333', deprecated:'#80868b', mandatory:'#c5221f', optional:'#2563eb', recommended:'#7b3fb5' };
  const allTagsClickable = [...r.status, ...r.tags].map(t => {
    const col = STATUS_META[t] || '#666';
    return `<span class="pill" style="background:${col}15;color:${col};border:1px solid ${col}40;" onclick="clickTag('${esc(t)}')">${esc(t)}</span>`;
  }).join('');

  const editBtn = `<button class="edit-btn" onclick="requireLogin(()=>editResource('${esc(r.slug)}'))" title="Suggest an edit">✎ Edit</button>`;
  const deleteBtn = (loggedInPubkey && loggedInPubkey === r.pubkeyHex)
    ? `<button class="delete-btn" onclick="deleteResource('${esc(r.slug)}','${esc(r.eventId)}')" title="Delete this entry">🗑</button>`
    : '';

  const tsAgo = (() => {
    const secs = Math.floor(Date.now()/1000) - r.createdAt;
    if (secs < 60)   return 'just now';
    if (secs < 3600) return Math.floor(secs/60) + 'm ago';
    if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
    if (secs < 86400*30) return Math.floor(secs/86400) + 'd ago';
    if (secs < 86400*365) return Math.floor(secs/86400/30) + 'mo ago';
    return Math.floor(secs/86400/365) + 'y ago';
  })();

  const pubProf = profileCache[r.pubkeyHex] || {};
  const pubNpub = hexToNpub(r.pubkeyHex);
  const pubName = pubProf.name || (pubNpub.slice(0,12)+'…');
  const pubAvatar = `<img class="byline-avatar" src="${pubProf.picture ? esc(pubProf.picture) : '/images/nostrich.webp'}" onerror="this.src='/images/nostrich.webp'">`;
  const pubLink = `<a href="https://njump.me/${pubNpub}" target="_blank" class="byline-publisher">${pubAvatar}<span>${esc(pubName)}</span></a>`;

  const bylineHtml = `<div class="byline">
    ${pubLink}
    <span class="byline-ts" title="${new Date(r.createdAt*1000).toLocaleString()}">published ${tsAgo}</span>
  </div>`;

  const discontinuedBadge = r.discontinued ? `<span class="pill discontinued" title="This NIP appears to be discontinued">🪦 discontinued</span>` : '';
  const deletedBadge = r.deleted ? `<span class="pill deleted-badge" title="Tombstoned via community curation. Edit and uncheck 'deleted' to restore.">💀 deleted</span>` : '';
  const cardClass = [
    'resource-card', 'nip-card',
    r.discontinued && 'resource-card--discontinued',
    r.deleted && 'resource-card--deleted',
  ].filter(Boolean).join(' ');

  // NIP description with raw toggle
  const descHtml = r.description ? `<div class="resource-desc" id="desc-${slug_}">
    <div class="resource-desc-inner desc-rendered" id="rendered-${slug_}">${mdToHtml(r.description)}</div>
    <div class="resource-desc-inner desc-raw" id="raw-${slug_}" style="display:none;">
      <pre style="white-space:pre-wrap;font-size:13px;background:#f8f9fa;padding:12px;border-radius:6px;overflow:auto;">${esc(r.description)}</pre>
    </div>
    <div class="desc-actions">
      <button class="action-btn raw-toggle-btn" id="rawbtn-${slug_}" onclick="toggleNipRaw('${slug_}')" title="Toggle raw view">📄 Raw</button>
      <button class="desc-expand desc-expand--hidden" id="expand-${slug_}" onclick="toggleDesc(this)">more…</button>
    </div>
  </div>` : '';

  // Proposals
  const versions = slugVersions[r.slug] || [];
  const winnerCreatedAt = versions.find(v => v.id === r.eventId)?.created_at ?? 0;
  const pendingProposals = versions.filter(v => v.pubkey !== r.pubkeyHex && wotTrust(v.pubkey) < 2 && v.created_at >= winnerCreatedAt);
  const mySuperseded = loggedInPubkey && loggedInPubkey !== r.pubkeyHex && wotTrust(loggedInPubkey) >= 2
    ? versions.find(v => v.pubkey === loggedInPubkey && !pendingProposals.includes(v))
    : null;
  const totalProposals = pendingProposals.length + (mySuperseded ? 1 : 0);
  const mySupersededLabel = mySuperseded ? ' (incl. yours)' : '';
  const proposalBadge = totalProposals > 0
    ? `<button class="action-btn proposals-btn" onclick="toggleProposals('${esc(r.slug)}')" title="See ${totalProposals} proposal${totalProposals>1?'s':''}">${totalProposals} proposal${totalProposals>1?'s':''}${mySupersededLabel}</button>`
    : '';
  const reviewBtn = (loggedInPubkey && totalProposals > 0)
    ? `<button class="action-btn approve-btn" onclick="showProposalDiff('${esc(r.slug)}')" title="Review proposals">📋 Review</button>`
    : '';

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
    <div class="nip-header">
      <div class="nip-number">${esc(slugSuffix(r.slug).toUpperCase())}</div>
      <div class="nip-header-right">
        <a class="card-permalink" href="${esc(LIST_BASE_PATH + slugSuffix(r.slug))}" title="Permalink — share this URL">🔗</a>
        ${deleteBtn}
        ${editBtn}
      </div>
    </div>
    <div class="nip-title">${esc(r.title)}</div>
    <div class="resource-tags" style="margin-top:2px;">
      ${deletedBadge}
      ${allTagsClickable}
      ${discontinuedBadge}
    </div>
    ${bylineHtml}
    ${descHtml}
    ${actionBar}
  </div>`;
}

// ─── Card dispatcher ────────────────────────────────────────────────────────────────────────────
function renderCard(r) {
  return NAMESPACE === 'nips' ? renderNipCard(r) : renderResourceCard(r);
}

// ─── Focused entry view (path-routed, in-place page swap) ────────────────────
// /nip-05 replaces the list with NIP-05's full card; the URL stays a real path
// so it survives copy/paste outside the SPA. Cross-NIP links use absolute paths
// (`[Kind 0](/nip-24#kind-0)`) — standard fragments, standard scrolling.
// Normal document flow; History.pushState handles in-app navigation; nginx
// try_files maps `/<slug>` → `<list-page>/index.html` for direct hits.
function slugSuffix(fullSlug) {
  const i = (fullSlug || '').indexOf('/');
  return i === -1 ? fullSlug : fullSlug.slice(i + 1);
}

// "Name | url | comment" / "url" / {name,url,comment} → normalized object.
// Used for both 'instance' tag values and legacy JSON-content instance arrays.
function parseInstance(s) {
  if (!s) return null;
  if (typeof s !== 'string') return s;
  const parts = s.split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length === 1) return { name: parts[0], url: parts[0], comment: '' };
  return { name: parts[0], url: parts[1] || '', comment: parts[2] || '' };
}

// The list page that owns the entry routes. Pages set window.LIST_BASE_PATH
// in their include so nginx can map /<slug> back to <base>/index.html.
const LIST_BASE_PATH = window.LIST_BASE_PATH
  || (NAMESPACE === 'nips' ? '/nips/' : '/newResources/');

// Returns {slug, anchor} | null based on current location. Entries live
// under LIST_BASE_PATH so the path is /nips/<slug>, /newResources/<slug>,
// etc. — the prefix keeps slugs from colliding with other top-level routes.
//   /nips/nip-24            → {slug:'nips/nip-24', anchor:null}
//   /nips/nip-24#kind-0     → {slug:'nips/nip-24', anchor:'kind-0'}
//   /nips/ or /nips/index   → null (list view)
// Back-compat: legacy compound fragment ("#nip-24/kind-0") and root-level
// /<slug> paths still resolve for any links published before this scheme.
function parseLocation() {
  const path = location.pathname.replace(/\/+$/, '');
  const base = LIST_BASE_PATH.replace(/\/+$/, '');
  const prefix = base + '/';
  if (path === base || path === base + '/index.html') {
    // List view — fall through to hash handling below
  } else if (path.startsWith(prefix)) {
    const suffix = path.slice(prefix.length);
    if (suffix) {
      const anchor = (location.hash || '').replace(/^#/, '').trim() || null;
      return { slug: NAMESPACE + '/' + suffix.toLowerCase(), anchor };
    }
  } else if (path && path !== base) {
    // Pre-scope root-level path (e.g. published before the /nips/ prefix).
    const suffix = path.split('/').pop();
    if (suffix) {
      const anchor = (location.hash || '').replace(/^#/, '').trim() || null;
      return { slug: NAMESPACE + '/' + suffix.toLowerCase(), anchor };
    }
  }
  const raw = (location.hash || '').replace(/^#/, '').trim();
  if (!raw) return null;
  const slashIdx = raw.indexOf('/');
  if (slashIdx === -1) return { slug: NAMESPACE + '/' + raw.toLowerCase(), anchor: null };
  return {
    slug:   NAMESPACE + '/' + raw.slice(0, slashIdx).toLowerCase(),
    anchor: raw.slice(slashIdx + 1),
  };
}
function slugFromFragment() {
  const p = parseLocation();
  return p ? p.slug : null;
}
// Djot wraps headings in <section id="Heading-Title">, preserving original
// casing. NIP markdown links use lowercase. Match case-insensitively.
function scrollToAnchorInFocused(anchor) {
  if (!anchor) return;
  const focused = document.querySelector('.focused-entry');
  if (!focused) return;
  let el = focused.querySelector('#' + (window.CSS?.escape ? CSS.escape(anchor) : anchor));
  if (!el) {
    const lowered = anchor.toLowerCase();
    el = Array.from(focused.querySelectorAll('[id]'))
      .find(e => e.id.toLowerCase() === lowered);
  }
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let _focusedSlug = null;
let _savedScrollY = 0;

function renderFocusedEntry() {
  // Hide controls + toggles so the focused entry is the only thing on the page.
  const toggles = document.getElementById('toggles');
  if (toggles) toggles.style.display = 'none';
  const controls = document.querySelector('.controls');
  if (controls) controls.style.display = 'none';

  const resultsEl = document.getElementById('results');
  if (!resultsEl) return;
  const r = allResources.find(x => x.slug === _focusedSlug);
  const suffix = slugSuffix(_focusedSlug);
  const back = `<button class="focused-back" onclick="closeFocusedEntry()" title="Back to list (Esc)">← Back to list</button>`;
  if (r) {
    resultsEl.innerHTML = back + `<div class="focused-entry">${renderCard(r)}</div>`;
  } else {
    resultsEl.innerHTML = back + `<div class="focused-entry"><p style="text-align:center;color:#888;padding:32px;">Loading <strong>${esc(suffix)}</strong>…</p></div>`;
  }
}

function focusEntry(slug, anchor) {
  if (!slug) return;
  if (slug !== _focusedSlug) {
    if (!_focusedSlug) _savedScrollY = window.scrollY;
    _focusedSlug = slug;
    render();
  }
  if (anchor) requestAnimationFrame(() => scrollToAnchorInFocused(anchor));
  else window.scrollTo(0, 0);
}

// User-initiated navigation: write the URL bar, run focusEntry, push history.
function navigateToEntry(slug, anchor) {
  const suffix = slugSuffix(slug);
  const url = LIST_BASE_PATH + suffix + (anchor ? '#' + anchor : '');
  if (location.pathname + location.hash !== url) {
    history.pushState({ slug, anchor }, '', url);
  }
  focusEntry(slug, anchor);
}

function closeFocusedEntry() {
  if (!_focusedSlug) return;
  _focusedSlug = null;
  if (location.pathname !== LIST_BASE_PATH || location.hash) {
    history.pushState({}, '', LIST_BASE_PATH);
  }
  render();
  window.scrollTo(0, _savedScrollY || 0);
}

// Read the URL and align focus state with it. Used for initial load and for
// popstate (browser back/forward).
function syncFocusToLocation() {
  const p = parseLocation();
  if (p) focusEntry(p.slug, p.anchor);
  else if (_focusedSlug) { _focusedSlug = null; render(); window.scrollTo(0, _savedScrollY || 0); }
}
// Back-compat name used by other code paths.
const syncFocusToHash = syncFocusToLocation;

// If we're showing a "Loading…" placeholder and the entry just arrived,
// re-render and re-apply any sub-anchor from the URL.
function refreshFocusedFromData() {
  if (!_focusedSlug) return;
  if (!allResources.find(x => x.slug === _focusedSlug)) return;
  render();
  const p = parseLocation();
  if (p?.anchor) requestAnimationFrame(() => scrollToAnchorInFocused(p.anchor));
}

// Intercept clicks on internal anchors that point at one of our entry paths.
// Recognises both the new scoped form (/nips/nip-24) and the legacy bare form
// (/nip-24) for links published before the prefix scheme.
document.addEventListener('click', e => {
  if (e.defaultPrevented) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const a = e.target.closest && e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  if (a.target === '_blank' || a.hasAttribute('download')) return;
  let url;
  try { url = new URL(href, location.origin); } catch(_) { return; }
  if (url.origin !== location.origin) return;
  const p = url.pathname.replace(/\/+$/, '');
  const base = LIST_BASE_PATH.replace(/\/+$/, '');
  let suffix = null;
  if (p === base + '/' || p === base) {
    return; // link to the list itself — let browser handle it
  } else if (p.startsWith(base + '/')) {
    suffix = p.slice(base.length + 1);
  } else {
    // Legacy bare /<suffix> path (still allowed for backward compat).
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 1) suffix = parts[0];
  }
  if (!suffix || suffix.includes('/')) return;
  const slug = NAMESPACE + '/' + suffix.toLowerCase();
  if (!allResources.find(x => x.slug === slug)) return;
  e.preventDefault();
  navigateToEntry(slug, url.hash.replace(/^#/, '') || null);
});

window.addEventListener('popstate', syncFocusToLocation);
window.addEventListener('hashchange', syncFocusToLocation);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _focusedSlug) closeFocusedEntry();
});

function renderSubmitCard() {
  const pubKey = loggedInPubkey;
  const prof = pubKey ? (profileCache[pubKey] || {}) : {};
  const npub = pubKey ? hexToNpub(pubKey) : '';
  const name = prof.name || (npub.slice(0, 12) + '…') || 'You';
  const avatar = prof.picture || '/images/nostrich.webp';

  const isNips = NAMESPACE === 'nips';
  const cta = pubKey
    ? `<span style="color:#2563eb;font-weight:500;">+ Submit your ${isNips ? 'NIP' : 'resource'}</span>`
    : '<span style="color:#2563eb;font-weight:500;">Log in to submit</span>';
  const onclick = pubKey ? 'showSubmitForm()' : 'requireLogin(null)';
  const placeholderLabel = isNips ? 'Your NIP here?' : 'Your project here?';
  const submitTitle = isNips ? 'Submit a new NIP' : 'Submit a new Nostr resource';

  return `<div class="resource-card resource-card--submit" onclick="${onclick}" title="${submitTitle}">
    <div class="resource-header">
      <span class="resource-title" style="color:#999;font-weight:400;">${placeholderLabel}</span>
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

// Filter UX: compact strip of group buttons by default; clicking a button
// expands a pill panel beneath the strip. Multiple groups can be open at
// once. Active filters add a count badge to their group button.
const _expandedFilterGroups = new Set();
function toggleFilterGroup(name) {
  if (_expandedFilterGroups.has(name)) _expandedFilterGroups.delete(name);
  else _expandedFilterGroups.add(name);
  // re-render only the toggles (cheap); avoid full render() unless filters change.
  renderToggles(_lastTogglePool || []);
}

let _lastTogglePool = null;

function renderToggles(pool) {
  _lastTogglePool = pool;
  const toggles = document.getElementById('toggles');
  if (!toggles) return;

  // Compute the per-pill availability based on currently-active filters.
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
    (r.status || []).forEach(s => available.add(s));
  });

  const groups = NAMESPACE === 'nips'
    ? [['Tags', allTags]]
    : [
        ['Platforms', allPlatforms],
        ['Tags',      allRegularTags],
        ['NIPs',      allNipsList],
        ['Licenses',  allLicenses],
      ];

  const stripBtns = groups
    .filter(([, items]) => items.length)
    .map(([name, items]) => {
      const activeCount = items.filter(t => activeTags.includes(t)).length;
      const isOpen = _expandedFilterGroups.has(name);
      const caret = isOpen ? '–' : '+';
      const badge = activeCount ? ` <span class="filter-group-badge">${activeCount}</span>` : '';
      return `<button class="filter-group-btn${isOpen ? ' open' : ''}${activeCount ? ' has-active' : ''}" type="button" onclick="toggleFilterGroup('${esc(name)}')">${esc(name)}${badge} <span class="filter-group-caret">${caret}</span></button>`;
    }).join('');

  const renderPills = (items) => {
    const active = items.filter(t => activeTags.includes(t));
    const avail  = items.filter(t => !activeTags.includes(t) && available.has(t));
    const unavail = items.filter(t => !activeTags.includes(t) && !available.has(t));
    const span = (cls, prefix, t) => `<span class="filter-pill ${cls}" onclick="clickTag('${esc(t)}')">${prefix}${esc(t)} (${tagCounts[t] || 0})</span>`;
    return [
      ...active.map(t => span('active', '✓ ', t)),
      ...avail.map(t => span('available', '', t)),
      ...unavail.map(t => span('unavailable', '', t)),
    ].join('');
  };

  const expandedPanels = groups
    .filter(([name, items]) => _expandedFilterGroups.has(name) && items.length)
    .map(([name, items]) => `<div class="filter-panel" role="region" aria-label="${esc(name)} filters">${renderPills(items)}</div>`)
    .join('');

  toggles.innerHTML = `<div class="filter-strip">${stripBtns}</div>${expandedPanels}`;
}

function clickTag(t) {
  const i=activeTags.indexOf(t);
  if(i>=0)activeTags.splice(i,1); else activeTags.push(t);
  renderOrder = null; // recompute sort on filter change
  render();
}
function toggleDesc(btn) {
  const parent = btn.closest('.resource-desc');
  if (!parent) return;
  // Find the visible .resource-desc-inner (rendered or raw)
  const inner = Array.from(parent.querySelectorAll('.resource-desc-inner')).find(el => el.style.display !== 'none');
  if (!inner) return;
  const expanded = inner.classList.toggle('expanded');
  btn.textContent = expanded ? 'less…' : 'more…';
}
// After cards are inserted into DOM, check which desc-inners are actually clipped
// and only show the "more…" button for those.
function checkAllDescOverflows() {
  document.querySelectorAll('.resource-desc-inner').forEach(inner => {
    // Only check the currently visible inner (skip hidden raw view)
    if (inner.style.display === 'none') return;
    const parent = inner.closest('.resource-desc');
    const btn = parent ? parent.querySelector('.desc-expand') : null;
    if (!btn) return;
    if (inner.scrollHeight > inner.clientHeight + 4) {
      btn.classList.remove('desc-expand--hidden');
    } else {
      btn.classList.add('desc-expand--hidden');
    }
    // Sync button text to the visible inner's expansion state
    btn.textContent = inner.classList.contains('expanded') ? 'less…' : 'more…';
  });
}

function toggleNipRaw(slug) {
  const rendered = document.getElementById('rendered-' + slug);
  const raw      = document.getElementById('raw-' + slug);
  const rawBtn   = document.getElementById('rawbtn-' + slug);
  if (!rendered || !raw) return;
  if (rendered.style.display !== 'none') {
    rendered.style.display = 'none';
    raw.style.display = '';
    if (rawBtn) rawBtn.textContent = '📝 Rendered';
  } else {
    raw.style.display = 'none';
    rendered.style.display = '';
    if (rawBtn) rawBtn.textContent = '📄 Raw';
  }
  checkAllDescOverflows();
}

async function deleteResource(slug, eventId) {
  if (!loggedInPubkey) return;
  if (!confirm(`Mark "${slug}" as deleted? This publishes a kind 30890 version with a 'deleted' tag so the community can curate removals.`)) return;
  try {
    const ev = {
      kind: 30890,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', slug],
        ['n', NAMESPACE],
        ['t', 'deleted'],
      ],
    };
    const signed = await window.nostr.signEvent(ev);
    await publishEvent(signed);
    // Inject the tombstone so the card disappears immediately without reload
    if (!allResourceEvents.some(e => e.id === signed.id)) {
      allResourceEvents.push(signed);
    }
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
      setProfile(loggedInPubkey, {
        name:    c.display_name || c.name || '',
        picture: c.picture || '',
        lud16:   c.lud16 || '',
        npub:    hexToNpub(loggedInPubkey),
      });
    } catch(e) {}
  }, 4000);
  // After fetching, re-render header AND stats bar (anchor pill may reference us).
  updateLoginUI();
  render();
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
        <h3 id="submitBoxTitle" style="margin:0;font-size:16px;padding-right:40px;">Submit a Nostr Resource</h3>
        <button type="button" class="modal-close-btn" onclick="closeSubmitModal()" title="Close" style="position:absolute;right:0;top:0;background:none;border:none;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px;color:#666;">&times;</button>
        <button type="button" id="helpToggleBtn" class="help-toggle" onclick="toggleHelpMode()" title="Toggle help hints" style="right:36px;">?</button>
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
          Publishes a kind 30890 event. Anyone can submit; curation determines what surfaces by default.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <label style="font-size:12px;">Title<br><input id="sfTitle" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;"></label>
          <label style="font-size:12px;">Slug (d-tag) <span style="color:#888;font-weight:normal;font-size:11px;">— same slug = propose edit · new slug = fork</span><br>
            <span style="display:flex;align-items:stretch;margin-top:2px;">
              <span style="padding:6px 8px;background:#f1f3f4;color:#80868b;border:1px solid #ccc;border-right:0;border-radius:4px 0 0 4px;font-family:monospace;user-select:none;" title="Namespace is fixed for this directory">${NAMESPACE}/</span>
              <input id="sfSlug" style="flex:1;padding:6px;box-sizing:border-box;font-family:monospace;border-radius:0 4px 4px 0;">
            </span>
          </label>
          <label class="resource-only" style="font-size:12px;">Git URL<br><input id="sfGit" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;"></label>
          <label class="resource-only" style="font-size:12px;">Web URL<br><input id="sfWeb" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;"></label>
          <div style="grid-column:1/-1;">
            <div style="font-size:12px;margin-bottom:3px;"><span id="sfDescLabel">Description</span>
              <span class="md-toolbar" style="margin-left:8px;">
                <button type="button" class="md-btn" title="Bold" onclick="mdWrap('sfDesc','**','**')"><b>B</b></button>
                <button type="button" class="md-btn" title="Italic" onclick="mdWrap('sfDesc','_','_')"><i>I</i></button>
                <button type="button" class="md-btn" title="Code" onclick="mdWrap('sfDesc','\`','\`')"><code>\`\`</code></button>
                <button type="button" class="md-btn" title="Link" onclick="mdLink('sfDesc')">🔗</button>
                <button type="button" class="md-btn" title="Bullet list" onclick="mdPrefix('sfDesc','- ')">≡</button>
              </span>
              <span style="font-size:11px;color:#aaa;margin-left:6px;">Formatting</span>
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
          <div class="resource-only" style="grid-column:1/-1;">
            <div class="tag-section-label">Platforms<span class="section-hint"> — click to toggle</span></div>
            <div id="sfPlatformsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfPlatformsAdd" placeholder="Add new platform..." oninput="filterTagButtons('sfPlatformsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfPlatformsWrap','sfPlatforms',this.value,false);this.value='';filterTagButtons('sfPlatformsWrap','')}"><button type="button" onclick="addNewValue('sfPlatformsWrap','sfPlatforms',document.getElementById('sfPlatformsAdd').value,false);document.getElementById('sfPlatformsAdd').value='';filterTagButtons('sfPlatformsWrap','')">+ Add</button></div>
          </div>
          <div class="resource-only" style="grid-column:1/-1;">
            <div class="tag-section-label">NIPs<span class="section-hint"> — click to toggle</span></div>
            <div class="help-only" style="font-size:11px;color:#888;margin-bottom:4px;">
              <a href="https://github.com/nostr-protocol/nips" target="_blank" rel="noopener" style="color:#888;">NIP repository →</a>
            </div>
            <div id="sfNipsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfNipsAdd" placeholder="NIP number (e.g. 23)..." oninput="filterTagButtons('sfNipsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfNipsWrap','sfNips',this.value,false);this.value='';filterTagButtons('sfNipsWrap','')}"><button type="button" onclick="addNewValue('sfNipsWrap','sfNips',document.getElementById('sfNipsAdd').value,false);document.getElementById('sfNipsAdd').value='';filterTagButtons('sfNipsWrap','')">+ Add</button></div>
          </div>
          <div class="resource-only" style="grid-column:1/-1;">
            <div class="tag-section-label">Programming languages<span class="section-hint"> — click to toggle</span></div>
            <div id="sfProgLangsWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfProgLangsAdd" placeholder="Add new language..." oninput="filterTagButtons('sfProgLangsWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfProgLangsWrap','sfProgLangs',this.value,false);this.value='';filterTagButtons('sfProgLangsWrap','')}"><button type="button" onclick="addNewValue('sfProgLangsWrap','sfProgLangs',document.getElementById('sfProgLangsAdd').value,false);document.getElementById('sfProgLangsAdd').value='';filterTagButtons('sfProgLangsWrap','')">+ Add</button></div>
          </div>
          <div class="resource-only" style="grid-column:1/-1;">
            <div class="tag-section-label">License<span class="section-hint"> — click one</span></div>
            <div id="sfLicenseWrap" class="tag-btn-grid"></div>
            <div class="add-new-wrap"><input type="text" id="sfLicenseAdd" placeholder="Add new license..." oninput="filterTagButtons('sfLicenseWrap',this.value)" onkeydown="if(event.key==='Enter'){addNewValue('sfLicenseWrap','sfLicense',this.value,true);this.value='';filterTagButtons('sfLicenseWrap','')}"><button type="button" onclick="addNewValue('sfLicenseWrap','sfLicense',document.getElementById('sfLicenseAdd').value,true);document.getElementById('sfLicenseAdd').value='';filterTagButtons('sfLicenseWrap','')">+ Add</button></div>
          </div>
          <div class="resource-only" style="grid-column:1/-1;font-size:12px;">
            <div style="margin-bottom:3px;">Instances <span style="color:#888;font-weight:normal;">(one per line: <code>https://url</code> or <code>Name | https://url | comment</code>)</span></div>
            <textarea id="sfInstances" rows="3" style="width:100%;padding:6px;margin-top:2px;font-family:monospace;font-size:11px;box-sizing:border-box;resize:vertical;" placeholder="https://relay.example.com&#10;My Instance | https://example.com | self-hosted"></textarea>
          </div>
          <div id="sfStatusSection" style="grid-column:1/-1;display:none;">
            <div class="tag-section-label">Status<span class="section-hint"> — click to toggle</span></div>
            <div id="sfStatusWrap" class="tag-btn-grid"></div>
            <input type="hidden" id="sfStatusHidden" value="">
          </div>
          <label style="grid-column:1/-1;font-size:12px;">Product author npub <span style="color:#888;font-weight:normal;">(optional — auto-added to zap split at weight 100)</span><br>
            <input id="sfAuthorNpub" style="width:100%;padding:6px;margin-top:2px;box-sizing:border-box;font-family:monospace;font-size:11px;" placeholder="npub1…" oninput="onAuthorNpubInput(this.value)">
          </label>
          <label style="grid-column:1/-1;font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="sfDiscontinued" style="cursor:pointer;">
            <span>🪦 Mark as discontinued (sorts behind active entries)</span>
          </label>
          <label style="grid-column:1/-1;font-size:12px;display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="sfDeleted" style="cursor:pointer;">
            <span>💀 Mark as deleted (hides entry via community curation)</span>
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
  // Sync discontinued checkbox ↔ tag button in the tags grid
  const discCb = document.getElementById('sfDiscontinued');
  if (discCb) {
    discCb.addEventListener('change', function() {
      const btn = document.querySelector('#sfTagsWrap .tag-btn[data-val="discontinued"]');
      if (btn) {
        const isActive = btn.classList.contains('active');
        if (this.checked !== isActive) toggleTagBtn(btn, 'sfTags', false);
      }
    });
  }
  // Sync deleted checkbox ↔ tag button in the tags grid
  const delCb = document.getElementById('sfDeleted');
  if (delCb) {
    delCb.addEventListener('change', function() {
      const btn = document.querySelector('#sfTagsWrap .tag-btn[data-val="deleted"]');
      if (btn) {
        const isActive = btn.classList.contains('active');
        if (this.checked !== isActive) toggleTagBtn(btn, 'sfTags', false);
      }
    });
  }
  // Ctrl+Enter anywhere in the modal submits the form
  overlay.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitResource(); }
  });
  _submitModal = overlay;
  return overlay;
}

function openSubmitModal() {
  // If the user reached the edit/submit form from inside the entry modal,
  // close that one first so the form has unobstructed focus.
  closeFocusedEntry();
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
  document.getElementById('submitBoxTitle').textContent = NAMESPACE === 'nips' ? 'Submit a NIP Entry' : 'Submit a Nostr Resource';
  const slugEl = document.getElementById('sfSlug');
  if (slugEl) slugEl.readOnly = false;
  ['sfTitle','sfSlug','sfGit','sfWeb','sfDesc','sfTags','sfPlatforms','sfNips','sfProgLangs','sfLicense','sfAuthorNpub'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const discEl = document.getElementById('sfDiscontinued');
  if (discEl) discEl.checked = false;
  const delEl = document.getElementById('sfDeleted');
  if (delEl) delEl.checked = false;
  const instEl = document.getElementById('sfInstances');
  if (instEl) instEl.value = '';
  document.getElementById('sfStatus').textContent = '';
  _editSplits = seedSplitWithSelf([]);
  renderSplitEditor(_editSplits);
  updateSplitSuggestions(null);
  // Clear button grids and description tabs
  const emptySets = { tags:{}, platforms:{}, nips:{}, progLangs:{}, licenses:{} };
  const corpusTags = [...new Set(allResources.flatMap(r => r.tags))].filter(t => t !== 'deleted' && t !== 'discontinued').sort();
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
  // NIP mode UI toggles
  document.querySelectorAll('.resource-only').forEach(el => {
    el.style.display = NAMESPACE === 'nips' ? 'none' : '';
  });
  const statusSec = document.getElementById('sfStatusSection');
  if (statusSec) statusSec.style.display = NAMESPACE === 'nips' ? '' : 'none';
  const descLabel = document.getElementById('sfDescLabel');
  if (descLabel) descLabel.textContent = NAMESPACE === 'nips' ? 'Summary' : 'Description';
  // Render status grid for NIPs
  const STATUS_WORDS = new Set(['draft','final','deprecated','mandatory','optional','recommended']);
  const corpusStatus = [...STATUS_WORDS];
  renderTagButtons('sfStatusWrap', 'sfStatusHidden', corpusStatus, [], {}, false);
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
          setProfile(hex, { name: c.display_name||c.name||'', picture: c.picture||'', lud16: c.lud16||'', npub: hexToNpub(hex) });
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
  document.getElementById('sfSlug').value      = slugSuffix(r.slug);
  document.getElementById('sfSlug').readOnly   = false;  // editable: same slug = edit/proposal, new slug = fork
  document.getElementById('sfTitle').value     = r.title;
  document.getElementById('sfGit').value       = r.git || '';
  document.getElementById('sfWeb').value       = r.web || '';
  document.getElementById('sfDesc').value      = r.description || '';
  document.getElementById('sfTags').value      = r.tags.join(', ');
  document.getElementById('sfPlatforms').value = r.platforms.join(', ');
  // Populate newly-added fields from parsed resource + raw event
  const srcEv = (slugVersions[slug] || []).find(v => v.id === r.eventId);
  const srcTags = srcEv?.tags || [];
  document.getElementById('sfNips').value      = srcTags.filter(t=>t[0]==='nip').map(t=>t[1]).join(', ');
  document.getElementById('sfProgLangs').value = srcTags.filter(t=>t[0]==='progLang').map(t=>t[1]).join(', ');
  document.getElementById('sfLicense').value   = srcTags.find(t=>t[0]==='license')?.[1] || '';
  // Instances: stringify each entry as "Name | url | comment" or just url.
  // Source order: parsed r.instances (kind:30890 'instance' tags, already
  // strings) → tags directly → legacy JSON content.instances (objects).
  let instLines = [];
  if (Array.isArray(r.instances) && r.instances.length) {
    instLines = r.instances.map(i => typeof i === 'string' ? i : [i.name, i.url, i.comment].filter(Boolean).join(' | '));
  } else {
    const tagInsts = srcTags.filter(t => t[0] === 'instance').map(t => t[1]);
    if (tagInsts.length) {
      instLines = tagInsts;
    } else {
      let srcContent = {}; try { srcContent = JSON.parse(srcEv?.content || '{}'); } catch(e) {}
      instLines = (srcContent.instances || []).map(i => {
        if (typeof i === 'string') return i;
        const parts = [i.url || ''];
        if (i.name && i.name !== i.url) parts.unshift(i.name);
        if (i.comment) parts.push(i.comment);
        return parts.length > 1 ? parts.join(' | ') : parts[0];
      });
    }
  }
  document.getElementById('sfInstances').value = instLines.join('\n');
  const discEl = document.getElementById('sfDiscontinued');
  if (discEl) discEl.checked = r.discontinued || false;
  const delEl = document.getElementById('sfDeleted');
  if (delEl) delEl.checked = r.deleted || false;
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
  const corpusTags = [...new Set(allResources.flatMap(r => r.tags))].filter(t => t !== 'deleted' && t !== 'discontinued').sort();
  const corpusPlats = [...new Set(allResources.flatMap(r => r.platforms))].sort();
  const corpusNips = [...new Set(allResources.flatMap(r => r.nips))].sort();
  const corpusLangs = [...new Set(allResources.flatMap(r => r.progLangs))].sort();
  const corpusLicenses = [...new Set(allResources.flatMap(r => r.license ? [r.license] : []))].sort();

  const suggestions = gatherSlugSuggestions(slug);
  renderTagButtons('sfTagsWrap', 'sfTags', corpusTags, r.tags.filter(t => t !== 'deleted'), suggestions.tags, false);
  renderTagButtons('sfPlatformsWrap', 'sfPlatforms', corpusPlats, r.platforms, suggestions.platforms, false);
  renderTagButtons('sfNipsWrap', 'sfNips', corpusNips, srcTags.filter(t=>t[0]==='nip').map(t=>'NIP-'+t[1]), suggestions.nips, false);
  renderTagButtons('sfProgLangsWrap', 'sfProgLangs', corpusLangs, srcTags.filter(t=>t[0]==='progLang').map(t=>t[1]), suggestions.progLangs, false);
  const currentLicense = srcTags.find(t=>t[0]==='license')?.[1] || '';
  renderTagButtons('sfLicenseWrap', 'sfLicense', corpusLicenses, currentLicense ? [currentLicense] : [], suggestions.licenses, true);

  // NIP mode UI toggles
  document.querySelectorAll('.resource-only').forEach(el => {
    el.style.display = NAMESPACE === 'nips' ? 'none' : '';
  });
  const statusSec = document.getElementById('sfStatusSection');
  if (statusSec) statusSec.style.display = NAMESPACE === 'nips' ? '' : 'none';
  const descLabel = document.getElementById('sfDescLabel');
  if (descLabel) descLabel.textContent = NAMESPACE === 'nips' ? 'Summary' : 'Description';
  // Render status grid for NIPs
  const STATUS_WORDS = new Set(['draft','final','deprecated','mandatory','optional','recommended']);
  const corpusStatus = [...STATUS_WORDS];
  const activeStatus = (r.status || []).filter(s => STATUS_WORDS.has(s));
  renderTagButtons('sfStatusWrap', 'sfStatusHidden', corpusStatus, activeStatus, {}, false);
  const statusHidden = document.getElementById('sfStatusHidden');
  if (statusHidden) statusHidden.value = activeStatus.join(', ');

  // Suggested instances as commented lines (only show ones not already present)
  const instEl = document.getElementById('sfInstances');
  if (instEl) {
    const suggestedInstances = Object.entries(suggestions.instances || {});
    if (suggestedInstances.length) {
      // Collect URLs already in the textarea to avoid duplicate suggestions
      const existingUrls = new Set(
        instEl.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
          const parts = l.split('|').map(p => p.trim());
          return parts.length > 1 ? parts[1] : parts[0];
        })
      );
      const missing = suggestedInstances.filter(([val]) => {
        const parts = val.split('|').map(p => p.trim());
        const url = parts.length > 1 ? parts[1] : parts[0];
        return !existingUrls.has(url);
      });
      if (missing.length) {
        const allInstAuthors = new Set();
        missing.forEach(([_, meta]) => meta.authors.forEach(a => allInstAuthors.add(a)));
        const instAuthorList = Array.from(allInstAuthors).slice(0,3).join(', ') + (allInstAuthors.size > 3 ? ` +${allInstAuthors.size-3} more` : '');
        const commentLines = [`# Missing instances from ${instAuthorList}:`];
        missing.forEach(([val]) => {
          commentLines.push(`# ${val}`);
        });
        const existing = instEl.value.trim();
        instEl.value = commentLines.join('\n') + (existing ? '\n\n' + existing : '');
      }
    }
  }

  // Description tabs for other authors
  renderDescTabs(slug, r.description || '');

  // Fetch own profile if needed so the split editor shows our name/avatar
  if (loggedInPubkey && !profileCache[loggedInPubkey]) {
    queryAll(RELAYS.slice(0,2), { kinds:[0], authors:[loggedInPubkey] }, ev => {
      try {
        const c = JSON.parse(ev.content);
        setProfile(loggedInPubkey, { name: c.display_name||c.name||'', picture: c.picture||'', lud16: c.lud16||'', npub: hexToNpub(loggedInPubkey) });
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
  closeFocusedEntry();
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
      ['d', slug], ['n', NAMESPACE],
      ...proposal.tags.filter(t => t[0]!=='d' && !(t[0]==='n' && t[1]===NAMESPACE)),
    ];
    const event = { kind:30890, created_at:Math.floor(Date.now()/1000), tags:newTags, content:proposal.content };
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
  let versions = (slugVersions[slug] || []);

  // For replaceable events, only the latest event per pubkey matters.
  // Deduplicate versions to the most recent event per author.
  if (versions.length) {
    const latestByPk = new Map();
    for (const ev of versions) {
      const existing = latestByPk.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) latestByPk.set(ev.pubkey, ev);
    }
    versions = Array.from(latestByPk.values());
  }

  // Exclude the logged-in user (their tags are already in the form) AND the
  // author of the currently-winning version for this slug (whose tags were
  // pre-loaded into the form when the editor opened). Without the second
  // exclusion, editing a NIP authored by the curator shows the curator's own
  // tags duplicated as "by Nip Curator" under "selected by others".
  const winnerPubkey = allResources.find(x => x.slug === slug)?.pubkeyHex;
  const excludePubkeys = new Set([loggedInPubkey, winnerPubkey].filter(Boolean));
  const suggestions = {
    tags: {}, platforms: {}, nips: {}, progLangs: {}, licenses: {},
    splits: {}, instances: {}, descriptions: {}
  };
  versions.forEach(ev => {
    if (excludePubkeys.has(ev.pubkey)) return;
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
      const corpusTags = [...new Set(allResources.flatMap(r => r.tags))].filter(t => t !== 'deleted' && t !== 'discontinued').sort();
      const corpusPlats = [...new Set(allResources.flatMap(r => r.platforms))].sort();
      const corpusNips = [...new Set(allResources.flatMap(r => r.nips))].sort();
      const corpusLangs = [...new Set(allResources.flatMap(r => r.progLangs))].sort();
      const corpusLicenses = [...new Set(allResources.flatMap(r => r.license ? [r.license] : []))].sort();
      renderTagButtons('sfTagsWrap', 'sfTags', corpusTags, r.tags.filter(t => t !== 'deleted'), suggestions.tags, false);
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
  // Sync discontinued checkbox with the tags grid
  if (hiddenInputId === 'sfTags' && val === 'discontinued') {
    const discCb = document.getElementById('sfDiscontinued');
    if (discCb) discCb.checked = el.classList.contains('active');
  }
  // Sync deleted checkbox with the tags grid
  if (hiddenInputId === 'sfTags' && val === 'deleted') {
    const delCb = document.getElementById('sfDeleted');
    if (delCb) delCb.checked = el.classList.contains('active');
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
        setProfile(pubkey, { name: c.display_name||c.name||'', picture: c.picture||'', npub: hexToNpub(pubkey), lud16: c.lud16||'' });
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
        setProfile(hex, { name: c.display_name||c.name||'', picture: c.picture||'', npub: hexToNpub(hex), lud16: c.lud16||'' });
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

// ─── Unified user / anchor chip ─────────────────────────────────────────────
// The header chip always shows the current trust anchor. Clicking opens a
// single dropdown that covers both "view as someone else's WoT" (anchor
// switching, with NIP-05 / npub entry) and "signed in as" (login/logout).
// The legacy #anchorChip / #loginBtn elements stay in the DOM but hidden so
// the existing Jekyll header template doesn't need to change.
//
// TODO multi-account: the dropdown currently has "+ Switch account" which
// just opens the login modal (and logs the previous account out first).
// To support fast switching we'd need to store ALL accounts in localStorage
// (currently nostr-auth.js only persists one) and let signEvent route to
// the active one. That requires changes inside nostr-auth.js (the prebuilt
// bundle) which we don't have a build pipeline for yet — deferred.

const KNOWN_PUBKEYS_LS_KEY = 'nostr-info-known-pubkeys-v1';
function loadKnownPubkeys() {
  try { return JSON.parse(localStorage.getItem(KNOWN_PUBKEYS_LS_KEY) || '[]'); } catch(_) { return []; }
}
function saveKnownPubkeys(arr) {
  try { localStorage.setItem(KNOWN_PUBKEYS_LS_KEY, JSON.stringify(arr)); } catch(_) {}
}
function rememberPubkey(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return;
  const arr = loadKnownPubkeys();
  if (!arr.includes(hex)) { arr.push(hex); saveKnownPubkeys(arr); }
}

// NIP-05: "name@domain" → hex pubkey via /.well-known/nostr.json?name=
async function resolveNip05(addr) {
  const m = String(addr || '').trim().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return null;
  try {
    const r = await fetch(`https://${m[2]}/.well-known/nostr.json?name=${encodeURIComponent(m[1])}`, { mode: 'cors' });
    if (!r.ok) return null;
    const data = await r.json();
    const hex = data?.names?.[m[1]];
    if (typeof hex === 'string' && /^[0-9a-f]{64}$/i.test(hex)) return hex.toLowerCase();
  } catch(_) {}
  return null;
}

function _profileBits(pubkey) {
  const p = profileCache[pubkey] || {};
  const npub = hexToNpub(pubkey);
  return {
    name:   p.name || (npub.slice(0, 14) + '…'),
    avatar: p.picture || '/images/nostrich.webp',
    npub,
  };
}

function updateAnchorUI() {
  // Legacy element kept for backwards-compat; the unified chip lives in
  // #loggedInAs now. Hide the old one so it doesn't show up in two places.
  const oldChip = document.getElementById('anchorChip');
  if (oldChip) oldChip.style.display = 'none';
}

let _userMenuOpen = false;

function updateLoginUI() {
  const host = document.getElementById('loggedInAs');
  if (!host) return;
  // Logged-out: just a compact green Login button. No anchor switcher —
  // anonymous visitors get the default curator's view silently; "view as"
  // and explicit anchor selection are dropdown actions once logged in
  // (and a planned login-screen "view-only" option).
  if (!loggedInPubkey) {
    host.innerHTML = `<button class="user-login-btn" type="button" onclick="launchLogin()">🔑 Login</button>`;
    if (allResources.length) render();
    return;
  }
  // Logged-in: avatar chip + dropdown. Chip name follows the current anchor
  // since switching trust anchor is the dominant action; the auth section
  // below the divider clarifies which account is actually signing.
  const pk = anchorPubkey || loggedInPubkey;
  const me = _profileBits(pk);
  host.innerHTML = `
    <button class="user-chip" type="button" tabindex="0" onclick="toggleUserMenu(event)" title="Account &amp; trust anchor">
      <img src="${esc(me.avatar)}" onerror="this.src='/images/nostrich.webp'">
      <span class="user-chip-name">${esc(me.name)}</span>
      <span class="user-chip-caret">▾</span>
    </button>
    <div class="user-menu" id="userMenu" hidden></div>
  `;
  if (_userMenuOpen) renderUserMenu();
  if (allResources.length) render();
}

function toggleUserMenu(e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById('userMenu');
  if (!dd) return;
  _userMenuOpen = dd.hasAttribute('hidden');
  if (_userMenuOpen) {
    renderUserMenu();
    dd.removeAttribute('hidden');
    setTimeout(() => document.addEventListener('click', function _c() {
      _userMenuOpen = false;
      dd.setAttribute('hidden', '');
      document.removeEventListener('click', _c);
    }), 0);
  } else {
    dd.setAttribute('hidden', '');
  }
}

function renderUserMenu() {
  const dd = document.getElementById('userMenu');
  if (!dd) return;

  // Anchor candidates (deduped). Only explicit/known pubkeys — no autodiscovery
  // of recent publishers. Order: current, default curator, self, remembered.
  const cands = [];
  const seen = new Set();
  const push = (pk) => { if (pk && !seen.has(pk)) { seen.add(pk); cands.push(pk); } };
  push(anchorPubkey);
  push(CURATOR);
  if (loggedInPubkey) push(loggedInPubkey);
  loadKnownPubkeys().forEach(push);

  const anchorRow = (pk) => {
    const b = _profileBits(pk);
    const active = pk === anchorPubkey ? ' user-menu-row--active' : '';
    const label =
      pk === CURATOR && pk === loggedInPubkey ? ' (you · default)' :
      pk === CURATOR ? ' (default)' :
      pk === loggedInPubkey ? ' (you)' : '';
    return `<button class="user-menu-row${active}" type="button" onclick="pickAnchor('${esc(pk)}')">
      <img src="${esc(b.avatar)}" onerror="this.src='/images/nostrich.webp'">
      <span class="user-menu-row-name">${esc(b.name)}${esc(label)}</span>
    </button>`;
  };

  const sessionType = window.nostr?._getSessionType?.() || (loggedInPubkey ? 'bunker' : null);
  const sessionLabel = sessionType === 'ext' ? '🧩 Browser extension'
    : sessionType === 'nsec' ? '🔑 Local key'
    : sessionType ? '🔗 Bunker / QR signer'
    : '';

  const youBlock = loggedInPubkey ? (() => {
    const b = _profileBits(loggedInPubkey);
    return `
      <div class="user-menu-section">
        <div class="user-menu-heading">🔑 Signed in</div>
        <div class="user-menu-row user-menu-row--active">
          <img src="${esc(b.avatar)}" onerror="this.src='/images/nostrich.webp'">
          <span class="user-menu-row-name">${esc(b.name)}</span>
          <span class="user-menu-row-meta">${esc(sessionLabel)}</span>
        </div>
        <button class="user-menu-action" type="button" onclick="doLogout()">↩ Sign out</button>
        <button class="user-menu-action" type="button" onclick="launchLogin()" title="Add a second account (current logout-first)">+ Switch account</button>
      </div>`;
  })() : `
      <div class="user-menu-section">
        <button class="user-menu-action user-menu-action--primary" type="button" onclick="launchLogin()">🔑 Log in</button>
      </div>`;

  dd.innerHTML = `
    <div class="user-menu-section">
      <div class="user-menu-heading">🔭 Viewing as</div>
      ${cands.map(anchorRow).join('')}
    </div>
    ${youBlock}
  `;
  // Stop the document-level close handler from triggering on dropdown clicks
  dd.onclick = e => e.stopPropagation();
}

function pickAnchor(pubkey) {
  _userMenuOpen = false;
  const dd = document.getElementById('userMenu'); if (dd) dd.setAttribute('hidden', '');
  setAnchor(pubkey);
}

async function pickAnchorFromInput() {
  const el = document.getElementById('anchorNpubInput');
  const val = el?.value?.trim();
  if (!val) return;
  let hex = null;
  if (/^[0-9a-f]{64}$/i.test(val)) hex = val.toLowerCase();
  else if (val.toLowerCase().startsWith('npub1')) hex = bech32ToHex(val);
  else if (val.includes('@')) {
    el.disabled = true; const old = el.placeholder; el.placeholder = 'Resolving…';
    hex = await resolveNip05(val);
    el.disabled = false; el.placeholder = old;
  }
  if (!hex) {
    el?.classList.add('invalid');
    setTimeout(() => el?.classList.remove('invalid'), 1500);
    return;
  }
  rememberPubkey(hex);
  pickAnchor(hex);
}

function doLogout() {
  _userMenuOpen = false;
  const dd = document.getElementById('userMenu'); if (dd) dd.setAttribute('hidden', '');
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
  // Defensive: if the user pasted a fully-qualified d-tag like "nostrPr/habla",
  // strip the namespace prefix before the regex eats the slash and concatenates
  // it into "nostrPrhabla" — the original double-prefix bug this UI defends against.
  let rawSlug = document.getElementById("sfSlug").value.trim().toLowerCase();
  const nsPrefix = (NAMESPACE + '/').toLowerCase();
  if (rawSlug.startsWith(nsPrefix)) rawSlug = rawSlug.slice(nsPrefix.length);
  const slug = rawSlug.replace(/[^a-z0-9.-]/g,"");
  const title = document.getElementById("sfTitle").value.trim();
  const git   = document.getElementById("sfGit").value.trim();
  const web   = document.getElementById("sfWeb").value.trim();
  const desc  = document.getElementById("sfDesc").value.trim();
  const tags  = document.getElementById("sfTags").value.split(",").map(s=>s.trim()).filter(Boolean);
  const plats = document.getElementById("sfPlatforms").value.split(",").map(s=>s.trim()).filter(Boolean);
  const nips  = document.getElementById("sfNips").value.split(",").map(s=>s.trim().replace(/^nip-?/i,'')).filter(Boolean);
  const progLangs = document.getElementById("sfProgLangs").value.split(",").map(s=>s.trim()).filter(Boolean);
  const license = document.getElementById("sfLicense").value.trim();
  // Per-entry tightening
  const lockFollows = document.getElementById("sfLockFollows")?.checked || false;
  const lockExperts = document.getElementById("sfLockExperts")?.checked || false;

  // Parse instances from textarea (one per line: url OR "Name | url | comment")
  const instances = document.getElementById("sfInstances").value.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const commentIdx = l.indexOf(' //');
      const line = commentIdx >= 0 ? l.slice(0, commentIdx).trim() : l;
      const parts = line.split('|').map(p => p.trim());
      if (parts.length === 1) return parts[0];
      return [parts[0], parts[1], ...(parts[2] ? [parts[2]] : [])].join(' | ');
    });
  const isDiscontinued = document.getElementById("sfDiscontinued")?.checked || false;
  const isDeleted = document.getElementById("sfDeleted")?.checked || false;

  // ── Validation ──
  if (!slug)  return set("Slug is required (used as the event d-tag).","#c5221f");
  if (!title) return set("Title is required.","#c5221f");
  if (NAMESPACE !== 'nips') {
    if (!git && !web) return set("At least one URL (Git or Web) is required.","#c5221f");
  }
  if (git && !/^https?:\/\//.test(git))  return set("Git URL must start with https://","#c5221f");
  if (web && !/^https?:\/\//.test(web))  return set("Web URL must start with https://","#c5221f");
  if (NAMESPACE !== 'nips' && !tags.length && !plats.length) return set("Please add at least one tag or platform (e.g. client, web).","#c5221f");

  const finalSlug = `${NAMESPACE}/${slug}`;
  const oldSlug = _editingSlug;

  // Build zap tags from editor state (new format)
  const activeSplits = _editSplits.filter(s => s.weight > 0);
  const splitTags = activeSplits.map(s => ['zap', s.pubkey, s.relay || 'wss://relay.primal.net', String(s.weight)]);

  // Passthrough: carry forward unrecognized tags from source event
  const HANDLED_TAG_KEYS = new Set(['d','n','t','platform','r','zap','zap-split','nip','progLang','license','title','summary','status','web','git','instance','follows','experts']);
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

  // ── Build kind:30890 event (unified for NIPs and resources) ──
  const rawStatus = document.getElementById('sfStatusHidden')?.value?.split(',').map(s=>s.trim()).filter(Boolean) || [];
  const statusTags = rawStatus.filter(t => ['draft','final','deprecated','mandatory','optional','recommended'].includes(t));
  const catTags    = tags.filter(t => !['draft','final','deprecated','mandatory','optional','recommended','discontinued','deleted'].includes(t));

  const eventTags = [
    ['d', finalSlug],
    ['n', NAMESPACE],
    ['title', title],
    ...(web ? [['web', web]] : []),
    ...(git ? [['git', git]] : []),
    ...instances.map(i => ['instance', i]),
    ...plats.map(p => ['platform', p]),
    ...nips.map(n => ['nip', n]),
    ...(license ? [['license', license]] : []),
    ...progLangs.map(l => ['progLang', l]),
    ...statusTags.map(t => ['status', t]),
    ...catTags.map(t => ['t', t]),
    ...(isDiscontinued ? [['t', 'discontinued']] : []),
    ...(isDeleted ? [['t', 'deleted']] : []),
    ...splitTags,
    ...(lockFollows ? [['follows', '0']] : []),
    ...(lockExperts ? [['experts', '0']] : []),
    ...passthroughTags,
  ];

  const event = {
    kind: 30890,
    created_at: Math.floor(Date.now() / 1000),
    tags: eventTags,
    content: desc,  // Djot/plaintext description (NOT JSON)
  };

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
    if (!allResourceEvents.some(e => e.id === signed.id)) {
      allResourceEvents.push(signed);
    }
    renderOrder = null;
    dedupAndRender();
    setTimeout(() => closeSubmitModal(), 1200);
  } catch(e) { set("Signed but could not reach any relay.", "#b06000"); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// Paint the header chip / login button immediately (before any awaits) so the
// header doesn't show the legacy login button for 5+ seconds while we resolve
// the saved signer session.
(function paintHeaderEarly() {
  const start = () => { try { updateLoginUI(); } catch(_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

window.addEventListener("load", async () => {
  logR("init:start");
  updateLoginUI();
  startLiveSubscription();
  document.getElementById("searchInput")?.addEventListener("input", e => {
    searchQuery = e.target.value; renderOrder = null; render();
  });

  // Listen for future login/logout events (manual login via modal)
  document.addEventListener("nlAuth", async e => {
    if (e.detail.type === "login" || e.detail.type === "signup") {
      try {
        // pubkey is always present on the login event (see nostr-auth-entry.js emitLogin).
        // No fallback to window.nostr.getPublicKey() — that triggers a NIP-07 popup
        // even when the user just logged in via bunker/nsec.
        loggedInPubkey = e.detail.pubkey;
        if (!loggedInPubkey) throw new Error('login event missing pubkey');
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
    // Only probe getPublicKey if there's an active saved session (nsec/bunker/ext).
    // This prevents NIP-07 extensions from showing unsolicited permission popups.
    if (window.nostr?._getSessionType?.()) {
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
      await setAnchor(loggedInPubkey);
    } else {
      await setAnchor(CURATOR);
    }
    // Re-render with correct WoT once follows are loaded
    logR("init:followsPromise:done", anchorPubkey?.slice(0,16)+'…');
    renderOrder = null;
    dedupAndRender();
  })();

  // Show empty state + submit card immediately (before any relay data)
  logR("init:render");
  render();
  // If the URL has #slug, show a placeholder modal right away so deep-links don't
  // appear broken while we wait for relay data.
  syncFocusToHash();
  // Kick off relay loading immediately (shows IDB cache right away)
  logR("init:call connectRelays");
  connectRelays();
});

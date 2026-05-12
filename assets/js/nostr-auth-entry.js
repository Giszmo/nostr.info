// Entry point for esbuild bundle
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { decode as nip19decode } from 'nostr-tools/nip19';
import { encrypt as nip04encrypt, decrypt as nip04decrypt } from 'nostr-tools/nip04';
import qrcode from 'qrcode-generator';

// Expose crypto helpers for NWC (NIP-47) in resources.js
window.__nwcCrypto = {
  encrypt: (skBytes, recipientPubkeyHex, plaintext) =>
    nip04encrypt(skBytes, recipientPubkeyHex, plaintext),
  decrypt: (skBytes, senderPubkeyHex, ciphertext) =>
    nip04decrypt(skBytes, senderPubkeyHex, ciphertext),
  finalizeEvent: (template, sk) => finalizeEvent(template, sk),
  getPublicKey: (sk) => getPublicKey(sk),
};

const RELAYS = ['wss://relay.primal.net', 'wss://relay.nsec.app', 'wss://nos.lol'];
const LS_KEY = 'nostrauth_session';

let signer   = null;
let extNostr = null;
let modal    = null;
let abortCtrl = null;
let _sessionType = null; // 'ext' | 'bunker' | 'nsec' | null

// Capture any pre-existing NIP-07 extension before we overwrite window.nostr
if (window.nostr && !window.nostr._nostrAuth) extNostr = window.nostr;

// _ready resolves when the silent session-restore attempt is done (success or fail).
// resources.js awaits window.nostr._ready before calling getPublicKey().
let resolveReady;
const _ready = new Promise(r => { resolveReady = r; });

window.nostr = {
  _nostrAuth: true,
  _ready,
  _getSessionType() { return _sessionType; },
  async getPublicKey() {
    if (signer) return signer.getPublicKey();
    throw new Error('Not logged in');
  },
  async signEvent(event) {
    if (!signer) throw new Error('Not logged in');
    if (signer._isLocal) return finalizeEvent(event, signer.secretKey);
    if (signer._isExt)   return extNostr.signEvent(event);
    return signer.signEvent(event);
  },
  logout() { logout(); },
};

document.addEventListener('nlLaunch',  () => showModal());
document.addEventListener('nlLogout',  () => logout());

// ── Persistence ──────────────────────────────────────────────────────────────
// Session types:
//   { type: 'ext' }                          — browser extension (no secrets)
//   { type: 'nsec', data: 'nsec1...' }       — local key
//   { type: 'bunker', sk: '<hex>', bp: {pubkey,relays,secret} } — bunker/QR
function saveSession(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(e) {}
}
function clearSession() {
  try { localStorage.removeItem(LS_KEY); } catch(e) {}
}

// ── Auth state ───────────────────────────────────────────────────────────────
function logout() {
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  signer = null;
  _sessionType = null;
  clearSession();
  hideModal();
  document.dispatchEvent(new CustomEvent('nlAuth', { detail: { type: 'logout' } }));
}

function emitLogin() {
  document.dispatchEvent(new CustomEvent('nlAuth', { detail: { type: 'login' } }));
}

// ── Silent session restore ────────────────────────────────────────────────────
(async function restoreSession() {
  try {
    // 1. Browser extension — preferred, no secrets to store
    if (extNostr) {
      try {
        await extNostr.getPublicKey();
        signer = { _isExt: true, getPublicKey: () => extNostr.getPublicKey() };
        _sessionType = 'ext';
        resolveReady(true); emitLogin(); return;
      } catch(e) {}
    }

    // 2. localStorage session
    let saved;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch(e) {}
    if (!saved) { resolveReady(false); return; }

    if (saved.type === 'nsec') {
      try {
        const decoded = nip19decode(saved.data);
        if (decoded.type !== 'nsec') throw new Error();
        const sk = decoded.data, pk = getPublicKey(sk);
        signer = { _isLocal: true, secretKey: sk, getPublicKey: () => Promise.resolve(pk) };
        _sessionType = 'nsec';
        resolveReady(true); emitLogin();
      } catch(e) { clearSession(); resolveReady(false); }

    } else if (saved.type === 'bunker') {
      try {
        const sk = hexToBytes(saved.sk);
        const s  = BunkerSigner.fromBunker(sk, saved.bp);
        await s.connect();
        await s.getPublicKey();
        signer = s;
        _sessionType = 'bunker';
        resolveReady(true); emitLogin();
      } catch(e) { clearSession(); resolveReady(false); }

    } else { resolveReady(false); }
  } catch(e) { resolveReady(false); }
})();

// hex string → Uint8Array
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return arr;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function showModal() {
  if (modal) { modal.style.display = 'flex'; return; }

  const d = document.createElement('div');
  d.id = 'na-modal';
  d.innerHTML = `
    <div id="na-backdrop">
      <div id="na-box">
        <div id="na-header">
          <h3>🔑 Login with Nostr</h3>
          <button id="na-close" title="Close">×</button>
        </div>
        <div id="na-body">
          <div class="na-section" id="na-ext-section" style="display:none">
            <button class="na-btn na-primary" id="na-ext-btn">🧩 Use Browser Extension</button>
          </div>
          <div class="na-section">
            <p class="na-label">📱 Mobile signer (Amber, etc.)</p>
            <div id="na-qr-wrap"></div>
            <p class="na-hint">Scan with your Nostr signer app</p>
          </div>
          <div class="na-section">
            <p class="na-label">🔗 Bunker URI</p>
            <input type="text" id="na-bunker-in" placeholder="bunker://..." />
            <button class="na-btn" id="na-bunker-btn">Connect</button>
          </div>
          <div class="na-section">
            <p class="na-label">🔑 Local key (nsec)</p>
            <p class="na-hint" style="margin:0 0 6px;">Stored in localStorage. Use only on a trusted device.</p>
            <input type="password" id="na-nsec-in" placeholder="nsec1..." />
            <button class="na-btn" id="na-nsec-btn">Login</button>
          </div>
        </div>
        <div id="na-footer"></div>
      </div>
    </div>
  `;
  document.body.appendChild(d);
  modal = d;

  const style = document.createElement('style');
  style.textContent = `
    #na-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);font-family:system-ui,-apple-system,sans-serif}
    #na-backdrop{width:100%;max-width:420px;margin:16px}
    #na-box{background:#1a1a1a;border:1px solid #333;border-radius:12px;color:#e0e0e0;overflow:hidden}
    #na-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #333}
    #na-header h3{margin:0;font-size:1.1rem}
    #na-close{background:none;border:none;color:#999;font-size:1.5rem;cursor:pointer}
    #na-close:hover{color:#fff}
    #na-body{padding:16px 20px}
    .na-section{margin-bottom:18px}
    .na-section:last-child{margin-bottom:0}
    .na-label{margin:0 0 6px;font-size:0.85rem;color:#aaa}
    .na-hint{margin:6px 0 0;font-size:0.75rem;color:#777}
    .na-btn{width:100%;padding:10px;border:none;border-radius:8px;background:#333;color:#e0e0e0;cursor:pointer;font-size:0.9rem;margin-top:6px}
    .na-btn:hover{background:#444}
    .na-primary{background:#8ec641;color:#0a0a0a;font-weight:600}
    .na-primary:hover{background:#7ab035}
    #na-qr-wrap{display:flex;justify-content:center;padding:8px;background:#fff;border-radius:8px;min-height:60px}
    #na-qr-wrap img{display:block;max-width:220px}
    #na-bunker-in,#na-nsec-in{width:100%;padding:10px;border:1px solid #444;border-radius:8px;background:#222;color:#e0e0e0;font-size:0.85rem;box-sizing:border-box;margin-top:6px}
    #na-footer{padding:10px 20px;border-top:1px solid #333;font-size:0.75rem;color:#666;text-align:center}
  `;
  document.head.appendChild(style);

  d.querySelector('#na-close').onclick = hideModal;
  d.onclick = (e) => { if (e.target === d) hideModal(); };

  if (extNostr) {
    d.querySelector('#na-ext-section').style.display = 'block';
    d.querySelector('#na-ext-btn').onclick = async () => {
      try {
        await extNostr.getPublicKey();
        signer = { _isExt: true, getPublicKey: () => extNostr.getPublicKey() };
        _sessionType = 'ext';
        hideModal(); emitLogin();
      } catch(e) { setFooter('Extension rejected: ' + e.message); }
    };
  }

  d.querySelector('#na-bunker-btn').onclick = async () => {
    const val = d.querySelector('#na-bunker-in').value.trim();
    if (!val) return;
    setFooter('Connecting to bunker…');
    try {
      const bp = await parseBunkerInput(val);
      if (!bp) throw new Error('Invalid bunker URI');
      const sk = generateSecretKey();
      const s  = BunkerSigner.fromBunker(sk, bp);
      await s.connect();
      signer = s;
      _sessionType = 'bunker';
      saveSession({ type: 'bunker', sk: bytesToHex(sk), bp: s.bp });
      hideModal(); emitLogin();
    } catch(e) { setFooter('Bunker error: ' + e.message); }
  };

  d.querySelector('#na-nsec-btn').onclick = () => {
    const val = d.querySelector('#na-nsec-in').value.trim();
    if (!val) return;
    try {
      const decoded = nip19decode(val);
      if (decoded.type !== 'nsec') throw new Error('Not an nsec key');
      const sk = decoded.data, pk = getPublicKey(sk);
      signer = { _isLocal: true, secretKey: sk, getPublicKey: () => Promise.resolve(pk) };
      _sessionType = 'nsec';
      saveSession({ type: 'nsec', data: val });
      hideModal(); emitLogin();
    } catch(e) { setFooter('Invalid nsec: ' + e.message); }
  };

    generateQR();
}

// Expose globally so inline HTML onclick="launchLogin()" survives minification
window.launchLogin = showModal;

function hideModal() { if (modal) modal.style.display = 'none'; }
function setFooter(txt) { const f = modal?.querySelector('#na-footer'); if (f) f.textContent = txt; }

async function generateQR() {
  const wrap = modal?.querySelector('#na-qr-wrap');
  if (!wrap) return;
  try {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2,'0')).join('');
    const uri = createNostrConnectURI({ clientPubkey: pk, relays: RELAYS, secret, name: 'nostr.info', url: location.origin });

    const qr = qrcode(0, 'M');
    qr.addData(uri); qr.make();
    wrap.innerHTML = `<img src="${qr.createDataURL(4,0)}" alt="nostrconnect QR" style="display:block;max-width:220px;" />`;

    abortCtrl = new AbortController();
    // Pass a 2-minute maxWait so the subscription stays open long enough for
    // Amber to scan the QR and publish the response.  nostr-tools' fromURI
    // uses the 4th argument for EITHER maxWait (number) OR abort (signal);
    // when a signal is passed maxWait becomes undefined and the EOSE timeout
    // falls back to the default ~4.4 s, which is too short.
    const s = await Promise.race([
      BunkerSigner.fromURI(sk, uri, {}, 120000),
      new Promise((_, reject) => {
        abortCtrl.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
      })
    ]);
    signer = s;
    _sessionType = 'bunker';
    // Save sk + bp so we can reconnect without re-handshake on reload
    saveSession({ type: 'bunker', sk: bytesToHex(sk), bp: s.bp });
    hideModal(); emitLogin();
  } catch(e) {
    if (e.name !== 'AbortError') { console.error('nostrconnect:', e); setFooter('Connection failed: ' + e.message); }
  }
}

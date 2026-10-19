// Booth 677 — the booth app, wallet, Strip Wall, strip pages and the scroll-into-the-booth hero.
(() => {
  'use strict';

  // ============================================================
  // Config — the only values to edit after deploying.
  // ============================================================
  const CONFIG = {
    // Which network the app uses. Try everything on testnet first, then switch to 'mainnet'.
    // `?net=testnet` in the URL also selects testnet without editing this.
    network: 'mainnet',
    networks: {
      testnet: { chainId: 968, name: 'BOT Chain Testnet', rpc: 'https://rpc.bohr.life', explorer: 'https://scan.bohr.life', contract: '' },
      // `contract` here is the single source for the app, the footer and the explorer link.
      mainnet: { chainId: 677, name: 'BOT Chain', rpc: 'https://rpc.botchain.ai', explorer: 'https://scan.botchain.ai', contract: '0xb64ABCa2Ca323Ef1D36c8FcA608fb0B1bF971E04' },
    },
    // Public-strip upload Worker (worker/), e.g. 'https://booth677-upload.<account>.workers.dev/upload'.
    uploadUrl: '',
    // Public strips store IPFS CIDs; images load through this gateway, then the fallback if it fails.
    ipfsGateway: 'https://gateway.pinata.cloud/ipfs/',
    ipfsFallback: 'https://ipfs.io/ipfs/',
    // Footer credits row. Leave a value empty to hide that link.
    credits: { x: '', github: 'https://github.com/lallinanoi99-dev/Booth677' },
  };

  const STRIP_TUPLE = 'tuple(address owner, bytes32 imageHash, string cid, uint8 frame, uint8 filter, uint8 shots, bool isPublic, uint32 hearts, uint64 at)';
  const ABI = [
    'function keep(bytes32 imageHash, string cid, uint8 frame, uint8 filter, uint8 shots, bool isPublic) returns (uint256 id)',
    'function heart(uint256 id)',
    `function getStrip(uint256 id) view returns (${STRIP_TUPLE})`,
    `function getPublic(uint256 from, uint256 count) view returns (uint256[] ids, ${STRIP_TUPLE}[] list)`,
    'function stripsOf(address owner) view returns (uint256[])',
    'function findByHash(bytes32 imageHash) view returns (bool found, uint256 id)',
    'function hearted(uint256, address) view returns (bool)',
    'function total() view returns (uint256)',
    'function publicCount() view returns (uint256)',
    'event Kept(uint256 indexed id, address indexed owner, bool isPublic)',
    'event Hearted(uint256 indexed id, address indexed by, uint32 hearts)',
    'error EmptyHash()', 'error CidRequired()', 'error CidNotAllowed()', 'error CidTooLong()', 'error BadFrame()',
    'error BadFilter()', 'error BadShots()', 'error AlreadyKept(uint256 id)', 'error StripNotFound()', 'error NotPublic()', 'error AlreadyHearted()',
  ];
  const REVERTS = {
    EmptyHash: 'The strip has no fingerprint. Develop it again.',
    CidRequired: 'The public upload is missing. Try again.',
    CidNotAllowed: 'Private keepsakes never include an upload.',
    CidTooLong: 'The upload ID was too long. Try again.',
    BadFrame: 'Unknown frame.',
    BadFilter: 'Unknown film look.',
    BadShots: 'A strip needs 1 to 4 photos.',
    AlreadyKept: 'This exact strip is already kept on BOT Chain.',
    StripNotFound: 'This strip isn’t in the booth.',
    NotPublic: 'Only public strips can get hearts.',
    AlreadyHearted: 'You already hearted this strip.',
  };

  const MAX_UPLOAD = 10 * 1024 * 1024;
  const CAPTION_MAX = 30;
  const WALL_HOME = 8;

  // ============================================================
  // Network + mode
  // ============================================================
  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch { return value === undefined ? null : false; }
  }

  const params = new URLSearchParams(location.search);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const netKey = params.get('net') === 'testnet' ? 'testnet' : CONFIG.network;
  const NET = { ...CONFIG.networks[netKey] };
  const MAINNET = { ...CONFIG.networks.mainnet };
  // On localhost, pick up an address deployed from deploy.html so it can be tried before editing CONFIG.
  if (isLocal) {
    NET.contract ||= storage('booth677.contract.' + NET.chainId) || '';
    MAINNET.contract ||= storage('booth677.contract.' + MAINNET.chainId) || '';
  }
  const PREVIEW = !NET.contract; // no contract yet: keeping and hearts are simulated in this browser
  const CHAIN_HEX = '0x' + NET.chainId.toString(16);
  const PREVIEW_WALLET = '0xB0074000000000000000000000000000000B0677';
  if (params.has('reset')) storage('booth677.preview', null);

  const state = { account: null, chainId: null, previewWallet: false, hearted: new Set(), connecting: false };

  // ============================================================
  // Small helpers
  // ============================================================
  const $ = (id) => document.getElementById(id);
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
  const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const extLink = (href, text, cls = '') => h('a', { href, target: '_blank', rel: 'noopener', class: cls }, text);
  const txUrl = (hash) => `${NET.explorer}/tx/${hash}`;
  const stripUrl = (id) => `${location.origin}${location.pathname}?strip=${id}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function fmtDate(sec) {
    return new Date(Number(sec) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  async function sha256(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (crypto?.subtle) return '0x' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return ethers.sha256(buf); // crypto.subtle is missing on plain-http LAN addresses
  }
  const toBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the image'))), type, q));
  function copy(text) {
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('Link copied'), () => toast(text));
  }
  function explain(e) {
    if (e?.code === 4001 || e?.code === 'ACTION_REJECTED' || e?.info?.error?.code === 4001) return { cancelled: true, msg: 'Cancelled in MetaMask — nothing was stamped.' };
    const name = e?.revert?.name;
    if (name && REVERTS[name]) return { msg: REVERTS[name], revert: e.revert };
    if (e?.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(e?.message || '')) return { msg: 'Not enough BOT for the network fee.' };
    return { msg: e?.shortMessage || e?.message || 'Something went wrong.' };
  }

  // ============================================================
  // Strip images: IPFS, preview data URLs, and doodle demo strips
  // ============================================================
  const demoCache = new Map();
  const doodleSet = (who) => [0, 1, 2, 3].map((p) => ({ src: Strip.doodle(p, 600, 600, who) }));
  function sampleOpts(frame, extra = {}) {
    return { frame, photos: doodleSet(extra.who || 0), look: 0, grain: false, leak: false, date: Strip.dateText(), caption: '', seed: 7 + frame, ...extra };
  }
  function demoUrl(spec) {
    if (!demoCache.has(spec)) {
      const [frame, look, who] = spec.split('-').map(Number);
      const c = Strip.render(sampleOpts(frame, { look, who, grain: look > 2, caption: ['best day ever', 'besties ♡', '', 'tokyo nights', 'cheese!!', ''][who % 6] }), 0.25);
      demoCache.set(spec, c.toDataURL('image/png'));
    }
    return demoCache.get(spec);
  }
  function imageUrl(strip) {
    const cid = strip.cid || '';
    if (cid.startsWith('demo:')) return demoUrl(cid.slice(5));
    if (cid.startsWith('data:')) return cid;
    return CONFIG.ipfsGateway + cid;
  }
  function stripImg(strip, alt) {
    const img = h('img', { src: imageUrl(strip), alt: alt || `Photo strip #${strip.id}`, loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      if (img.dataset.fallback || !img.src.startsWith(CONFIG.ipfsGateway)) return;
      img.dataset.fallback = '1';
      img.src = CONFIG.ipfsFallback + strip.cid;
    });
    return img;
  }

  // ============================================================
  // Store: the contract, or a localStorage stand-in in preview mode
  // ============================================================
  const norm = (s, id) => ({
    id: Number(id), owner: s[0], imageHash: s[1], cid: s[2], frame: Number(s[3]), filter: Number(s[4]),
    shots: Number(s[5]), isPublic: s[6], hearts: Number(s[7]), at: Number(s[8]),
  });

  const chainStore = (() => {
    let reader;
    const read = () => (reader ||= new ethers.Contract(NET.contract, ABI, new ethers.JsonRpcProvider(NET.rpc, NET.chainId, { staticNetwork: true })));
    const signer = async () => new ethers.Contract(NET.contract, ABI, await new ethers.BrowserProvider(window.ethereum).getSigner());
    return {
      async get(id) {
        try { return norm(await read().getStrip(id), id); } catch (e) { if (e?.revert?.name === 'StripNotFound') return null; throw e; }
      },
      async publicStrips(limit) {
        const n = Number(await read().publicCount());
        const out = [];
        for (let end = n; end > 0 && out.length < limit; end -= 100) {
          const from = Math.max(0, end - 100, n - limit);
          const [ids, list] = await read().getPublic(from, end - from);
          for (let i = list.length - 1; i >= 0; i--) out.push(norm(list[i], ids[i]));
          if (from <= n - limit) break;
        }
        return out;
      },
      async mine(addr) {
        const ids = [...(await read().stripsOf(addr))].reverse();
        return Promise.all(ids.map(async (id) => norm(await read().getStrip(id), id)));
      },
      async findByHash(hash) {
        const [found, id] = await read().findByHash(hash);
        return found ? Number(id) : null;
      },
      async hearted(ids, addr) {
        const flags = await Promise.all(ids.map((id) => read().hearted(id, addr).catch(() => false)));
        return ids.filter((_, i) => flags[i]);
      },
      async keep(args, onSent) {
        const c = await signer();
        await c.keep.staticCall(...args); // surface a readable revert before MetaMask opens
        const tx = await c.keep(...args);
        onSent(tx.hash);
        const receipt = await tx.wait();
        const ev = receipt.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).find((l) => l?.name === 'Kept');
        return { id: Number(ev.args.id), hash: tx.hash };
      },
      async heart(id) {
        const c = await signer();
        await c.heart.staticCall(id);
        const tx = await c.heart(id);
        await tx.wait();
        return tx.hash;
      },
    };
  })();

  const previewStore = (() => {
    const DEMO = [
      [0, 0, 0, 12], [1, 5, 1, 9], [4, 1, 2, 4], [3, 4, 3, 7], [2, 3, 4, 15], [5, 5, 5, 3], [0, 2, 1, 5], [1, 4, 3, 2],
    ];
    function load() {
      try {
        const s = JSON.parse(storage('booth677.preview') || 'null');
        if (s?.strips) return s;
      } catch { /* start over */ }
      const now = Math.floor(Date.now() / 1000);
      const strips = DEMO.map(([frame, filter, who, hearts], i) => ({
        owner: '0x' + (i + 1).toString(16).padStart(4, '0').repeat(10), imageHash: '0x' + String(i + 1).padStart(64, 'd'),
        cid: `demo:${frame}-${filter}-${who}`, frame, filter, shots: 4, isPublic: true, hearts, at: now - (DEMO.length - i) * 86400 * 1.7,
      }));
      return { strips, hearted: {} };
    }
    let db = load();
    const save = () => {
      if (storage('booth677.preview', JSON.stringify(db))) return;
      // out of space: drop the oldest preview images, keep the records
      db.strips.forEach((s) => { if (s.cid.startsWith('data:')) s.cid = `demo:${s.frame}-${s.filter}-0`; });
      storage('booth677.preview', JSON.stringify(db));
    };
    const withId = (s, i) => ({ ...s, id: i });
    const fakeHash = () => '0xpreview' + Math.random().toString(16).slice(2);
    return {
      async get(id) { return db.strips[id] ? withId(db.strips[id], id) : null; },
      async publicStrips(limit) { return db.strips.map(withId).filter((s) => s.isPublic).reverse().slice(0, limit); },
      async mine(addr) { return db.strips.map(withId).filter((s) => same(s.owner, addr)).reverse(); },
      async findByHash(hash) { const i = db.strips.findIndex((s) => s.imageHash === hash); return i < 0 ? null : i; },
      async hearted(ids, addr) { return ids.filter((id) => db.hearted[`${id}:${addr.toLowerCase()}`]); },
      async keep([imageHash, cid, frame, filter, shots, isPublic], onSent) {
        const existing = db.strips.findIndex((s) => s.imageHash === imageHash);
        if (existing >= 0) throw Object.assign(new Error('AlreadyKept'), { revert: { name: 'AlreadyKept', args: [BigInt(existing)] } });
        await sleep(500);
        const hash = fakeHash();
        onSent(hash);
        await sleep(1300);
        db.strips.push({ owner: state.account, imageHash, cid, frame, filter, shots, isPublic, hearts: 0, at: Math.floor(Date.now() / 1000) });
        save();
        return { id: db.strips.length - 1, hash };
      },
      async heart(id) {
        const key = `${id}:${state.account.toLowerCase()}`;
        if (db.hearted[key]) throw Object.assign(new Error('AlreadyHearted'), { revert: { name: 'AlreadyHearted' } });
        await sleep(700);
        db.hearted[key] = true;
        db.strips[id].hearts += 1;
        save();
        return fakeHash();
      },
    };
  })();

  const store = PREVIEW ? previewStore : chainStore;

  // ============================================================
  // Wallet
  // ============================================================
  const eth = () => window.ethereum;
  const wrongNetwork = () => !state.previewWallet && !!state.account && state.chainId !== NET.chainId && !PREVIEW;

  async function switchToBotChain() {
    try {
      await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      const unknownChain = e.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized chain/i.test(e.message || '');
      if (!unknownChain) throw e;
      await eth().request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: CHAIN_HEX, chainName: NET.name, nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, rpcUrls: [NET.rpc], blockExplorerUrls: [NET.explorer] }],
      });
    }
    state.chainId = Number(await eth().request({ method: 'eth_chainId' }));
  }

  async function connect() {
    if (!eth()) {
      if (PREVIEW) { state.previewWallet = true; setAccount(PREVIEW_WALLET); toast('Preview wallet connected'); return true; }
      window.open('https://metamask.io/download/', '_blank', 'noopener');
      return false;
    }
    state.connecting = true;
    renderWallet();
    try {
      const [account] = await eth().request({ method: 'eth_requestAccounts' });
      state.chainId = Number(await eth().request({ method: 'eth_chainId' }));
      if (state.chainId !== NET.chainId) await switchToBotChain().catch(() => {});
      setAccount(account);
      return true;
    } catch (e) {
      if (e.code !== 4001) toast(e.message || 'Could not connect');
      return false;
    } finally {
      state.connecting = false;
      renderWallet();
    }
  }

  async function switchNow() {
    try { await switchToBotChain(); } catch (e) { if (e.code !== 4001) toast(e.message || 'Could not switch network'); }
    onWalletChange();
  }

  function setAccount(account) {
    state.account = account || null;
    state.hearted = new Set();
    onWalletChange();
  }

  const walletListeners = new Set();
  function onWalletChange() {
    renderWallet();
    for (const fn of walletListeners) fn();
  }

  function walletButton({ big = false } = {}) {
    const cls = big ? 'btn green' : 'btn sm';
    if (!eth() && !PREVIEW) return h('a', { class: cls, href: 'https://metamask.io/download/', target: '_blank', rel: 'noopener' }, 'Install MetaMask');
    if (!state.account) return h('button', { class: cls, type: 'button', onclick: connect, disabled: state.connecting }, state.connecting ? 'Connecting…' : 'Connect wallet');
    if (wrongNetwork()) return h('button', { class: big ? 'btn red' : 'btn sm red', type: 'button', onclick: switchNow }, 'Switch to BOT Chain');
    return null;
  }

  function renderWallet() {
    const el = $('wallet');
    const btn = walletButton();
    el.replaceChildren(btn || h('span', { class: 'addr', title: state.account }, h('i'), short(state.account)));
  }

  function initWallet() {
    renderWallet();
    const e = eth();
    if (!e) return;
    e.request({ method: 'eth_accounts' }).then(async ([account]) => {
      if (!account) return;
      state.chainId = Number(await e.request({ method: 'eth_chainId' }));
      setAccount(account);
    }).catch(() => {});
    e.on?.('accountsChanged', ([account]) => setAccount(account));
    e.on?.('chainChanged', (id) => { state.chainId = Number(id); onWalletChange(); });
  }

  // Make sure there is a connected wallet on the right network. Returns true when ready.
  async function ensureWallet() {
    if (!state.account && !(await connect())) return false;
    if (wrongNetwork()) await switchNow();
    return !!state.account && !wrongNetwork();
  }

  // ============================================================
  // Sound: a tiny synthesized shutter (no audio file)
  // ============================================================
  let audio;
  function shutter() {
    if (booth.muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const len = Math.floor(audio.sampleRate * 0.12);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * (i < len * 0.3 || i > len * 0.55 ? 1 : 0.3);
      const src = audio.createBufferSource();
      src.buffer = buf;
      const hp = audio.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = audio.createGain();
      g.gain.setValueAtTime(0.6, t);
      src.connect(hp).connect(g).connect(audio.destination);
      src.start(t);
    } catch { /* sound is optional */ }
  }
  function beep() {
    if (booth.muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.13);
    } catch { /* sound is optional */ }
  }

  // ============================================================
  // The booth
  // ============================================================
  const STEPS = [['setup', 'Frame'], ['shoot', 'Shoot'], ['develop', 'Develop'], ['pickup', 'Pick up'], ['keep', 'Keep']];
  const booth = {
    step: 'setup',
    mode: storage('booth677.mode') === 'upload' ? 'upload' : 'camera',
    frame: 0,
    shots: [null, null, null, null], // camera: { src: canvas }
    uploads: [], // upload: { src: img|canvas, crop: { cx, cy, zoom } }
    fill: 'repeat',
    look: 0, grain: true, leak: false, date: true, caption: '',
    seed: Math.floor(Math.random() * 1e9),
    muted: storage('booth677.muted') === '1',
    canvas: null, png: null, pngUrl: null, hash: null,
    keep: null, // { visibility, consent, phase, error, txHash, id }
    uploadErrors: [],
  };
  const cam = { stream: null, video: null, error: null, running: false, count: null, paused: false, starting: false };

  const photosFor = () => (booth.mode === 'camera' ? booth.shots : [0, 1, 2, 3].map((i) => booth.uploads[i] || null));
  const shotCount = () => photosFor().filter(Boolean).length;
  const stripOpts = () => ({
    frame: booth.frame, photos: photosFor(), look: booth.look, grain: booth.grain, leak: booth.leak,
    date: booth.date ? Strip.dateText() : false, caption: booth.caption, fill: booth.fill, seed: booth.seed,
  });
  const slotRatio = () => { const s = Strip.FRAMES[booth.frame].slots[0]; return s.w / s.h; };

  function go(step) {
    if (step !== 'shoot') stopCamera();
    booth.step = step;
    renderApp();
    if (step === 'shoot' && booth.mode === 'camera') startCamera();
    const top = $('booth').getBoundingClientRect().top;
    if (top < -40 || top > 120) $('booth').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function resetStrip() {
    booth.canvas = null;
    booth.png = null;
    booth.hash = null;
    if (booth.pngUrl) URL.revokeObjectURL(booth.pngUrl);
    booth.pngUrl = null;
    booth.keep = null;
  }

  function startOver() {
    resetStrip();
    booth.shots = [null, null, null, null];
    booth.uploads = [];
    booth.caption = '';
    booth.seed = Math.floor(Math.random() * 1e9);
    go('setup');
  }

  // ---------- header ----------
  function appHead() {
    const idx = STEPS.findIndex(([k]) => k === booth.step);
    return h('div', { class: 'app-head' },
      h('div', { class: 'app-sign', 'aria-hidden': 'true' }, 'PHOTO · 677'),
      h('ol', { class: 'stepper', 'aria-label': 'Steps' },
        STEPS.map(([k, label], i) => h('li', { class: i === idx ? 'on' : i < idx ? 'done' : '', 'aria-current': i === idx ? 'step' : false }, `${i + 1} ${label}`))),
      h('div', { class: 'head-tools' },
        cam.stream ? h('span', { class: 'cam-dot', id: 'camDot' }, h('i'), 'camera on') : null,
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-pressed': String(!booth.muted), 'aria-label': booth.muted ? 'Shutter sound off' : 'Shutter sound on', title: 'Shutter sound',
          onclick: () => { booth.muted = !booth.muted; storage('booth677.muted', booth.muted ? '1' : '0'); renderApp(); },
        }, booth.muted ? '🔇' : '🔊')));
  }

  function renderApp() {
    const el = $('app');
    const views = { setup: viewSetup, shoot: booth.mode === 'camera' ? viewCamera : viewUpload, develop: viewDevelop, pickup: viewPickup, keep: viewKeep };
    el.replaceChildren(appHead(), views[booth.step]());
  }

  // ---------- carousel (booth + showcase) ----------
  const sampleCache = new Map();
  function frameSample(i) {
    if (!sampleCache.has(i)) {
      const c = Strip.render(sampleOpts(i, { look: 0, caption: 'best day ever', who: i }), 0.3);
      const img = new Image();
      img.src = c.toDataURL('image/png');
      img.alt = `${Strip.FRAMES[i].name} frame sample`;
      sampleCache.set(i, img);
    }
    return sampleCache.get(i).cloneNode();
  }
  function carousel({ index, onChange, label }) {
    const n = Strip.FRAMES.length;
    const set = (i) => onChange((i + n) % n);
    const el = h('div', { class: 'carousel', role: 'group', 'aria-roledescription': 'carousel', 'aria-label': label, tabindex: '0',
      onkeydown: (e) => { if (e.key === 'ArrowLeft') set(index - 1); if (e.key === 'ArrowRight') set(index + 1); } },
    h('div', { class: 'view' }, frameSample(index)),
    h('div', { class: 'name', 'aria-live': 'polite' }, Strip.FRAMES[index].name),
    h('div', { class: 'ctrl' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous frame', onclick: () => set(index - 1) }, '◀'),
      h('div', { class: 'dots' }, Strip.FRAMES.map((f, i) => h('button', { type: 'button', 'aria-label': f.name, 'aria-current': String(i === index), onclick: () => set(i) }))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next frame', onclick: () => set(index + 1) }, '▶')));
    return el;
  }

  // ---------- step 1+2: mode + frame ----------
  function viewSetup() {
    const pick = (mode) => { booth.mode = mode; storage('booth677.mode', mode); renderApp(); };
    return h('div', { class: 'stage' },
      h('div', { class: 'window' }, h('span', { class: 'label' }, 'Choose a frame'),
        carousel({ index: booth.frame, label: 'Frames', onChange: (i) => { booth.frame = i; renderApp(); $('app').querySelector('.carousel')?.focus(); } })),
      h('div', { class: 'console' },
        h('h2', {}, 'Welcome in!'),
        h('div', {},
          h('p', { class: 'q' }, 'Step 1 · Choose mode'),
          h('div', { class: 'pill', role: 'group', 'aria-label': 'Mode' },
            h('button', { type: 'button', 'aria-pressed': String(booth.mode === 'camera'), onclick: () => pick('camera') }, '📷 Take Photo'),
            h('button', { type: 'button', 'aria-pressed': String(booth.mode === 'upload'), onclick: () => pick('upload') }, '🖼 Upload'))),
        h('div', {},
          h('p', { class: 'q' }, 'Step 2 · Choose a frame'),
          h('p', { style: 'margin:0;font:700 24px var(--hand)' }, Strip.FRAMES[booth.frame].name),
          h('p', { class: 'note', style: 'margin:4px 0 0' }, Strip.FRAMES[booth.frame].blurb)),
        h('p', { class: 'note' }, booth.mode === 'camera'
          ? 'Four shots with a 3 · 2 · 1 countdown. The camera only turns on after you press Next.'
          : 'Choose 1–4 photos (JPG, PNG or HEIC, up to 10 MB each). They stay on your device.'),
        h('div', { class: 'row end' }, h('button', { class: 'btn round green', type: 'button', onclick: () => go('shoot') }, 'Next'))));
  }

  // ---------- step 3a: camera ----------
  function camMessage() {
    if (!window.isSecureContext) return 'The camera needs HTTPS (or localhost). Open the live site, or switch to Upload.';
    if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t use a camera here. Switch to Upload instead.';
    return null;
  }
  async function startCamera() {
    if (cam.stream || cam.starting) return;
    cam.error = camMessage();
    cam.paused = false;
    if (cam.error) { renderApp(); return; }
    cam.starting = true;
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      if (booth.step !== 'shoot' || booth.mode !== 'camera') { stopCamera(); return; }
      cam.video ||= h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Live camera preview (mirrored)' });
      cam.video.muted = true;
      cam.video.srcObject = cam.stream;
      await cam.video.play().catch(() => {});
    } catch (e) {
      cam.error = e.name === 'NotAllowedError' || e.name === 'SecurityError'
        ? 'Camera access was blocked. Allow the camera in your browser’s site settings — or switch to Upload.'
        : e.name === 'NotFoundError' || e.name === 'OverconstrainedError'
          ? 'No camera found on this device. Switch to Upload instead.'
          : e.name === 'NotReadableError' ? 'The camera is busy in another app. Close it and try again, or switch to Upload.'
            : `The camera didn’t start (${e.message || e.name}). Switch to Upload instead.`;
    } finally {
      cam.starting = false;
    }
    if (booth.step === 'shoot') renderApp();
  }
  function stopCamera() {
    cam.running = false;
    cam.count = null;
    if (cam.stream) for (const t of cam.stream.getTracks()) t.stop();
    cam.stream = null;
    if (cam.video) cam.video.srcObject = null;
    $('camDot')?.remove();
  }
  function capture() {
    const v = cam.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    // keep the photo mirrored like the preview; caption and date are drawn later, unmirrored
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    return { src: c };
  }
  async function shoot(indexes) {
    if (cam.running || !cam.stream) return;
    cam.running = true;
    renderApp();
    try {
      for (const i of indexes) {
        for (const n of [3, 2, 1]) {
          if (!cam.running) return;
          cam.count = n;
          const el = $('camCount');
          if (el) el.textContent = n;
          beep();
          await sleep(800);
        }
        if (!cam.running || !cam.video?.videoWidth) return;
        cam.count = null;
        if ($('camCount')) $('camCount').textContent = '';
        booth.shots[i] = capture();
        shutter();
        const f = $('camFlash');
        if (f) { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
        renderMiniStrip();
        await sleep(900);
      }
    } finally {
      cam.running = false;
      cam.count = null;
      if (booth.step === 'shoot') renderApp();
    }
  }
  function thumb(photo, ratio = 4 / 3, w = 160) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(w / ratio);
    const [sx, sy, sw, sh] = Strip.coverRect(photo.src, c.width, c.height, photo.crop);
    c.getContext('2d').drawImage(photo.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function miniStrip() {
    return h('div', { class: 'mini-strip', id: 'miniStrip', 'aria-label': 'Your shots' },
      booth.shots.map((s, i) => h('div', { class: 'shot' + (s ? ' filled' : '') },
        s ? thumb(s) : String(i + 1),
        s && !cam.running ? h('button', { class: 'retake', type: 'button', 'aria-label': `Retake shot ${i + 1}`, title: 'Retake', onclick: () => shoot([i]) }, '↺') : null)));
  }
  function renderMiniStrip() { $('miniStrip')?.replaceWith(miniStrip()); }
  function viewCamera() {
    const done = shotCount() === 4;
    const missing = booth.shots.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    const camBox = h('div', { class: 'cam' });
    if (cam.error) {
      camBox.append(h('div', { class: 'msg' }, h('div', {}, h('p', {}, cam.error),
        h('button', { class: 'btn', type: 'button', onclick: () => { booth.mode = 'upload'; storage('booth677.mode', 'upload'); cam.error = null; go('shoot'); } }, '🖼 Switch to Upload'))));
    } else if (cam.paused) {
      camBox.append(h('div', { class: 'msg' }, h('div', {}, h('p', {}, 'Camera paused while you were away.'), h('button', { class: 'btn green', type: 'button', onclick: startCamera }, 'Resume camera'))));
    } else if (!cam.stream) {
      camBox.append(h('div', { class: 'msg' }, cam.starting ? 'Asking for your camera…' : 'Starting camera…'));
    } else {
      camBox.append(cam.video, h('div', { class: 'count', id: 'camCount', 'aria-live': 'assertive' }, cam.count ?? ''), h('div', { class: 'flash', id: 'camFlash' }),
        h('span', { class: 'shotno' }, `${shotCount()}/4`));
    }
    return h('div', { class: 'stage' },
      h('div', { class: 'window' }, h('span', { class: 'label' }, 'Booth window'), camBox),
      h('div', { class: 'console' },
        h('h2', {}, done ? 'Looking good!' : 'Strike 4 poses'),
        h('p', { class: 'note', style: 'margin:0' }, 'The preview is mirrored like a real booth. Tap ↺ on a shot to retake just that one.'),
        miniStrip(),
        h('div', { class: 'row spread' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => go('setup'), disabled: cam.running }, '← Back'),
          done
            ? h('div', { class: 'row' },
              h('button', { class: 'btn', type: 'button', disabled: cam.running || !cam.stream, onclick: () => { booth.shots = [null, null, null, null]; shoot([0, 1, 2, 3]); } }, 'Retake all'),
              h('button', { class: 'btn round green', type: 'button', disabled: cam.running, onclick: () => go('develop') }, 'Next'))
            : h('button', { class: 'btn round green', type: 'button', disabled: cam.running || !cam.stream, onclick: () => shoot(missing) }, cam.running ? '…' : 'Start'))));
  }

  // ---------- step 3b: upload ----------
  let heicLib;
  async function loadHeic() {
    if (window.heic2any) return window.heic2any;
    heicLib ||= new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      s.onload = () => res(window.heic2any);
      s.onerror = () => { heicLib = null; rej(new Error('Could not load the HEIC converter')); };
      document.head.append(s);
    });
    return heicLib;
  }
  const isHeic = (f) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
  function loadImage(blob) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('unreadable')); };
      img.src = url;
    });
  }
  async function addFiles(files) {
    booth.uploadErrors = [];
    const room = 4 - booth.uploads.length;
    const list = [...files];
    if (list.length > room) booth.uploadErrors.push(room ? `Only ${room} more photo${room > 1 ? 's' : ''} fit — the rest were skipped.` : 'All 4 slots are full. Remove one first.');
    for (const f of list.slice(0, Math.max(0, room))) {
      const okType = /^image\/(jpeg|png)$/i.test(f.type) || isHeic(f) || /\.(jpe?g|png)$/i.test(f.name);
      if (!okType) { booth.uploadErrors.push(`${f.name}: please use JPG, PNG or HEIC.`); continue; }
      if (f.size > MAX_UPLOAD) { booth.uploadErrors.push(`${f.name}: that’s over 10 MB.`); continue; }
      try {
        let blob = f;
        if (isHeic(f)) {
          try { blob = await loadImage(f).then(() => f); } catch { // Safari decodes HEIC natively; others convert
            const conv = await (await loadHeic())({ blob: f, toType: 'image/jpeg', quality: 0.92 });
            blob = Array.isArray(conv) ? conv[0] : conv;
          }
        }
        const img = await loadImage(blob);
        booth.uploads.push({ src: img, crop: { cx: 0.5, cy: 0.5, zoom: 1 } });
      } catch {
        booth.uploadErrors.push(`${f.name}: couldn’t read that photo.`);
      }
      renderApp();
    }
    renderApp();
  }
  function moveUpload(from, to) {
    if (to < 0 || to >= booth.uploads.length) return;
    const [p] = booth.uploads.splice(from, 1);
    booth.uploads.splice(to, 0, p);
    renderApp();
  }
  function viewUpload() {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/heic,image/heif,.heic,.heif', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
    const drop = h('div', {
      class: 'drop', role: 'button', tabindex: '0', 'aria-label': 'Choose photos to upload',
      onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); },
    }, h('b', {}, 'Drop photos here'), 'or tap to choose · JPG, PNG, HEIC · ≤ 10 MB', input);
    let dragFrom = null;
    const ratio = slotRatio();
    const tiles = h('div', { class: 'tiles' }, [0, 1, 2, 3].map((i) => {
      const p = booth.uploads[i];
      const tile = h('div', { class: 'tile', draggable: p ? 'true' : false });
      if (p) {
        tile.addEventListener('dragstart', (e) => { dragFrom = i; tile.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
        tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
      }
      tile.addEventListener('dragover', (e) => { if (dragFrom != null && booth.uploads[i]) { e.preventDefault(); tile.classList.add('over'); } });
      tile.addEventListener('dragleave', () => tile.classList.remove('over'));
      tile.addEventListener('drop', (e) => { e.preventDefault(); tile.classList.remove('over'); if (dragFrom != null) moveUpload(dragFrom, i); dragFrom = null; });
      tile.append(
        h('div', { class: 'ph' }, p ? thumb(p, ratio, 220) : String(i + 1)),
        p ? h('div', { class: 'acts' },
          h('button', { type: 'button', 'aria-label': `Move photo ${i + 1} earlier`, disabled: i === 0, onclick: () => moveUpload(i, i - 1) }, '◀'),
          h('button', { type: 'button', 'aria-label': `Crop photo ${i + 1}`, onclick: () => openCrop(i) }, '✂'),
          h('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { booth.uploads.splice(i, 1); renderApp(); } }, '✕'),
          h('button', { type: 'button', 'aria-label': `Move photo ${i + 1} later`, disabled: i >= booth.uploads.length - 1, onclick: () => moveUpload(i, i + 1) }, '▶'))
          : h('div', { class: 'note', style: 'text-align:center;font-size:12px' }, 'empty'));
      return tile;
    }));
    const n = booth.uploads.length;
    return h('div', { class: 'stage' },
      h('div', { class: 'window' }, h('span', { class: 'label' }, 'Your photos'), drop, tiles),
      h('div', { class: 'console' },
        h('h2', {}, 'Upload 1–4 photos'),
        h('p', { class: 'note', style: 'margin:0' }, 'Drag tiles (or use ◀ ▶) to reorder. ✂ crops a photo to the frame’s slot. Nothing leaves your device.'),
        booth.uploadErrors.length ? h('div', { class: 'err', role: 'alert' }, booth.uploadErrors.map((e) => h('div', {}, e))) : null,
        n > 0 && n < 4 ? h('div', {},
          h('p', { class: 'q' }, `Only ${n} photo${n > 1 ? 's' : ''} — fill the other slots with`),
          h('div', { class: 'pill', role: 'group', 'aria-label': 'Fill empty slots' },
            h('button', { type: 'button', 'aria-pressed': String(booth.fill === 'repeat'), onclick: () => { booth.fill = 'repeat'; renderApp(); } }, 'Repeats'),
            h('button', { type: 'button', 'aria-pressed': String(booth.fill === 'blank'), onclick: () => { booth.fill = 'blank'; renderApp(); } }, 'Cute blanks'))) : null,
        h('div', { class: 'row spread' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => go('setup') }, '← Back'),
          h('button', { class: 'btn round green', type: 'button', disabled: n === 0, onclick: () => go('develop') }, 'Next'))));
  }

  // simple crop: drag to move, slider to zoom, always at the frame's slot ratio
  function openCrop(i) {
    const p = booth.uploads[i];
    const crop = { ...p.crop };
    const ratio = slotRatio();
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round(480 / ratio);
    const draw = () => {
      const [sx, sy, sw, sh] = Strip.coverRect(p.src, c.width, c.height, crop);
      const ctx = c.getContext('2d');
      ctx.drawImage(p.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      // keep cx/cy in sync with the clamped rectangle so dragging never "sticks" at an edge
      const [iw, ih] = Strip.sourceSize(p.src);
      crop.cx = (sx + sw / 2) / iw;
      crop.cy = (sy + sh / 2) / ih;
    };
    const box = h('div', { class: 'crop-box' }, c);
    let start = null;
    box.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy }; box.setPointerCapture(e.pointerId); box.classList.add('grabbing'); });
    box.addEventListener('pointermove', (e) => {
      if (!start) return;
      const [, , sw, sh] = Strip.coverRect(p.src, c.width, c.height, crop);
      const [iw, ih] = Strip.sourceSize(p.src);
      const k = sw / box.clientWidth;
      crop.cx = start.cx - ((e.clientX - start.x) * k) / iw;
      crop.cy = start.cy - ((e.clientY - start.y) * k * (sh / sw) * (c.width / c.height)) / ih;
      draw();
    });
    const end = () => { start = null; box.classList.remove('grabbing'); };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    const zoom = h('input', { type: 'range', min: '1', max: '3', step: '0.01', value: String(crop.zoom), 'aria-label': 'Zoom', oninput: (e) => { crop.zoom = Number(e.target.value); draw(); } });
    const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Crop photo', onclick: (e) => { if (e.target === modal) close(); } },
      h('div', { class: 'card' },
        h('h3', {}, `Crop photo ${i + 1}`),
        box,
        h('label', { class: 'q' }, 'Zoom', zoom),
        h('div', { class: 'row', style: 'display:flex;gap:10px;justify-content:flex-end' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'),
          h('button', { class: 'btn green', type: 'button', onclick: () => { p.crop = { ...crop }; close(); renderApp(); } }, 'Done'))));
    document.body.append(modal);
    document.addEventListener('keydown', onKey);
    draw();
    zoom.focus();
  }

  // ---------- step 4: develop ----------
  let previewTimer;
  function drawPreview(animate) {
    const holder = $('devPreview');
    if (!holder) return;
    const c = Strip.render(stripOpts(), 0.42);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'Live preview of your strip');
    holder.replaceChildren(c);
    if (animate && !reduceMotion()) { holder.classList.remove('developing'); void holder.offsetWidth; holder.classList.add('developing'); }
  }
  const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => drawPreview(false), 60); };
  function viewDevelop() {
    const setOpt = (k, v) => { booth[k] = v; resetStrip(); schedulePreview(); };
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Film look' }, Strip.LOOKS.map((l) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(booth.look === l.id), onclick: (e) => {
        booth.look = l.id; resetStrip();
        for (const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        schedulePreview();
      } }, h('i', { style: `background:${l.swatch}` }), l.name)));
    const toggle = (k, label) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: booth[k], onchange: (e) => setOpt(k, e.target.checked) }), label);
    const counter = h('div', { class: 'counter' }, `${booth.caption.length}/${CAPTION_MAX}`);
    const view = h('div', { class: 'stage' },
      h('div', { class: 'window' }, h('span', { class: 'label' }, 'Darkroom'), h('div', { class: 'preview', id: 'devPreview' })),
      h('div', { class: 'console' },
        h('h2', {}, 'Develop'),
        h('div', {}, h('p', { class: 'q' }, 'Film look'), chips),
        h('div', { class: 'toggles' }, toggle('grain', 'Film grain'), toggle('leak', 'Light leak'), toggle('date', `Date stamp ${Strip.dateText()}`)),
        h('div', {},
          h('label', { class: 'q', for: 'caption' }, 'Caption (optional)'),
          h('input', { id: 'caption', type: 'text', maxlength: String(CAPTION_MAX), value: booth.caption, placeholder: 'best day ever', autocomplete: 'off',
            oninput: (e) => { booth.caption = e.target.value.slice(0, CAPTION_MAX); counter.textContent = `${booth.caption.length}/${CAPTION_MAX}`; resetStrip(); schedulePreview(); } }),
          counter),
        h('div', { class: 'row spread' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => go('shoot') }, '← Back'),
          h('button', { class: 'btn round green', type: 'button', onclick: develop }, 'Print'))));
    requestAnimationFrame(() => drawPreview(true));
    return view;
  }
  async function develop() {
    const btn = $('app').querySelector('.btn.round');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '…';
      btn.parentNode.before(h('div', { class: 'status', role: 'status' }, h('span', { class: 'spin' }), 'Printing your full-size strip…'));
    }
    await sleep(40); // let the status paint before the heavy work
    try {
      if (!booth.png) {
        booth.canvas = Strip.render(stripOpts(), 1);
        booth.png = await toBlob(booth.canvas);
        booth.hash = await sha256(booth.png);
        booth.pngUrl = URL.createObjectURL(booth.png);
      }
      go('pickup');
    } catch (e) {
      toast(e.message || 'Could not print the strip');
      if (btn) { btn.disabled = false; btn.textContent = 'Print'; }
    }
  }

  // ---------- step 5: pick up ----------
  const fileName = () => `booth677-${Strip.dateText().replace(/[' ]/g, '')}-${booth.hash.slice(2, 8)}.png`;
  function displayCanvas() {
    const c = document.createElement('canvas');
    const scale = Math.min(1, 900 / booth.canvas.height);
    c.width = Math.round(booth.canvas.width * scale);
    c.height = Math.round(booth.canvas.height * scale);
    c.getContext('2d').drawImage(booth.canvas, 0, 0, c.width, c.height);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'Your finished photo strip');
    return c;
  }
  function viewPickup() {
    const out = h('div', { class: 'out' }, displayCanvas());
    requestAnimationFrame(() => out.classList.add('slide'));
    return h('div', { class: 'stage' },
      h('div', { class: 'window' }, h('span', { class: 'label' }, 'Pickup slot'),
        h('div', { class: 'pickup' }, h('div', { class: 'slot-label' }, '↓ PICK UP'), h('div', { class: 'slot' }), out)),
      h('div', { class: 'console' },
        h('h2', {}, 'Your strip is ready!'),
        h('p', { class: 'note', style: 'margin:0' }, 'Download it free — no wallet needed. Or keep it forever on BOT Chain.'),
        h('div', { class: 'row' },
          h('a', { class: 'btn green', href: booth.pngUrl, download: fileName() }, '⬇ Download PNG'),
          h('button', { class: 'btn', type: 'button', onclick: () => { booth.keep = null; go('keep'); } }, 'Keep forever on BOT Chain')),
        h('div', {}, h('p', { class: 'q' }, 'Fingerprint (SHA-256)'), h('div', { class: 'hash' }, booth.hash)),
        h('div', { class: 'row spread' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => go('develop') }, '← Back'),
          h('button', { class: 'btn ghost', type: 'button', onclick: startOver }, '↺ Start over'))));
  }

  // ---------- step 6: keep forever ----------
  async function previewThumb() {
    const c = document.createElement('canvas');
    const scale = Math.min(1, 520 / booth.canvas.height);
    c.width = Math.round(booth.canvas.width * scale);
    c.height = Math.round(booth.canvas.height * scale);
    c.getContext('2d').drawImage(booth.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  async function uploadStrip() {
    if (PREVIEW && !CONFIG.uploadUrl) return { cid: await previewThumb(), sha256: booth.hash };
    if (!CONFIG.uploadUrl) throw new Error('Public uploads aren’t set up on this site yet. Keep it private instead.');
    const form = new FormData();
    form.append('file', new File([booth.png], fileName(), { type: 'image/png' }));
    let res;
    try { res = await fetch(CONFIG.uploadUrl, { method: 'POST', body: form }); } catch { throw new Error('Network error — check your connection and retry.'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = { too_large: 'The strip is too large to upload.', too_many_pixels: 'The strip is too large to upload.', rate_limited: 'Too many uploads from here — try again in a little while.', bad_type: 'Only PNG strips can be uploaded.' }[body.error];
      throw new Error(why || 'The upload failed. Nothing was stamped — retry.');
    }
    if (!body.cid) throw new Error('The upload failed. Nothing was stamped — retry.');
    return body;
  }
  async function keepForever() {
    const k = booth.keep;
    const isPublic = k.visibility === 'public';
    if (isPublic && !k.consent) return;
    if (!(await ensureWallet())) return renderApp();
    k.error = null;
    try {
      const existing = await store.findByHash(booth.hash);
      if (existing != null) { k.phase = 'done'; k.id = existing; k.already = true; return renderApp(); }
      let cid = '';
      let hash = booth.hash;
      if (isPublic) {
        k.phase = 'uploading';
        renderApp();
        const up = k.cid ? { cid: k.cid, sha256: k.pinnedHash } : await uploadStrip();
        k.cid = up.cid;
        k.pinnedHash = up.sha256;
        cid = up.cid;
        if (up.sha256 && up.sha256 !== booth.hash) hash = up.sha256; // the fingerprint of the exact bytes on IPFS
      }
      k.phase = 'signing';
      renderApp();
      const shots = Math.max(1, Math.min(4, booth.mode === 'camera' ? 4 : booth.uploads.length));
      const result = await store.keep([hash, cid, booth.frame, booth.look, shots, isPublic], (txHash) => { k.phase = 'pending'; k.txHash = txHash; renderApp(); });
      Object.assign(k, { phase: 'done', id: result.id, txHash: result.hash });
      loadWallPreview();
    } catch (e) {
      const why = explain(e);
      if (e?.revert?.name === 'AlreadyKept') { Object.assign(k, { phase: 'done', id: Number(e.revert.args[0]), already: true }); return renderApp(); }
      const wasUploading = k.phase === 'uploading'; // upload errors carry their own friendly message
      k.phase = 'error';
      k.error = wasUploading ? e.message : why.msg;
    }
    renderApp();
  }
  function viewKeep() {
    booth.keep ||= { visibility: 'private', consent: false, phase: 'idle' };
    const k = booth.keep;
    const busy = ['uploading', 'signing', 'pending'].includes(k.phase);
    const done = k.phase === 'done';
    const setVis = (v) => { k.visibility = v; k.consent = false; k.cid = null; k.phase = 'idle'; k.error = null; renderApp(); };
    const status = () => {
      if (k.phase === 'uploading') return h('div', { class: 'status' }, h('span', { class: 'spin' }), 'Uploading your strip to IPFS…');
      if (k.phase === 'signing') return h('div', { class: 'status' }, h('span', { class: 'spin' }), 'Confirm in MetaMask…');
      if (k.phase === 'pending') return h('div', { class: 'status' }, h('span', { class: 'spin' }), h('span', {}, 'Developing on BOT Chain… ', PREVIEW ? null : extLink(txUrl(k.txHash), 'view tx ↗')));
      if (k.phase === 'error') return h('div', { class: 'status', role: 'alert' }, h('span', { class: 'err' }, k.error), );
      return null;
    };
    let body;
    if (done) {
      body = [
        h('h2', {}, k.already ? 'Already kept!' : 'Kept forever ✦'),
        h('p', { style: 'margin:0' }, k.already ? `This exact strip is already on BOT Chain as strip #${k.id}.` : `Your strip is stamped on BOT Chain as strip #${k.id}${k.visibility === 'public' ? ' and pinned to the Strip Wall.' : '. The photo stayed with you — keep the PNG to prove it’s the original.'}`),
        h('div', { class: 'row' },
          h('a', { class: 'btn green', href: `?strip=${k.id}` }, 'Open strip page'),
          h('button', { class: 'btn', type: 'button', onclick: () => copy(stripUrl(k.id)) }, 'Copy link'),
          k.txHash && !PREVIEW ? extLink(txUrl(k.txHash), 'View tx ↗', 'btn ghost') : null),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost', href: booth.pngUrl, download: fileName() }, '⬇ Download PNG'),
          h('button', { class: 'btn ghost', type: 'button', onclick: startOver }, '↺ Take another')),
      ];
    } else {
      const gate = walletButton({ big: true });
      body = [
        h('h2', {}, 'Keep it forever'),
        h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'How to keep it' },
          h('label', {}, h('input', { type: 'radio', name: 'vis', checked: k.visibility === 'private', disabled: busy, onchange: () => setVis('private') }),
            h('b', {}, 'Private keepsake (default)'), h('small', {}, 'Only the fingerprint (SHA-256) + frame/film info go on-chain. The photo stays on your device. Later, re-upload the PNG to prove it’s the original.')),
          h('label', {}, h('input', { type: 'radio', name: 'vis', checked: k.visibility === 'public', disabled: busy, onchange: () => setVis('public') }),
            h('b', {}, 'Public on the Strip Wall'), h('small', {}, 'Your strip is uploaded to IPFS and pinned on the wall for everyone to see. Permanent: no edits, no deleting.'))),
        k.visibility === 'public' ? h('label', { class: 'consent' },
          h('input', { type: 'checkbox', checked: k.consent, disabled: busy, onchange: (e) => { k.consent = e.target.checked; renderApp(); } }),
          h('span', {}, 'I understand this photo becomes ', h('b', {}, 'public and permanent'), ' on IPFS and BOT Chain, and everyone in it agreed. ', h('i', {}, 'Only post photos of people who said yes.'))) : null,
        PREVIEW ? h('p', { class: 'note', style: 'margin:0' }, 'Preview mode: no contract is configured yet, so keeping is simulated in this browser.') : null,
        status(),
        h('div', { class: 'row spread' },
          h('button', { class: 'btn ghost', type: 'button', disabled: busy, onclick: () => go('pickup') }, '← Back'),
          gate && !state.account
            ? h('div', { class: 'row' }, !eth() && !PREVIEW ? h('span', { class: 'note' }, 'Your download still works without a wallet.') : null, gate)
            : gate || h('button', { class: 'btn round green', type: 'button', disabled: busy || (k.visibility === 'public' && !k.consent), onclick: keepForever },
              k.phase === 'error' ? 'Retry' : 'Keep')),
      ];
    }
    const thumbC = displayCanvas();
    return h('div', { class: 'stage' },
      h('div', { class: 'window light' }, h('span', { class: 'label' }, k.visibility === 'public' ? 'Public strip' : 'Private keepsake'),
        h('div', { class: 'preview' }, thumbC),
        h('div', { class: 'hash', style: 'width:100%' }, h('b', {}, 'SHA-256 '), booth.hash)),
      h('div', { class: 'console' }, body));
  }

  // camera stops when you leave the booth or the tab
  function watchBooth() {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting && cam.stream) { stopCamera(); cam.paused = true; if (booth.step === 'shoot') renderApp(); }
    }, { threshold: 0.05 });
    io.observe($('booth'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && cam.stream) { stopCamera(); cam.paused = true; if (booth.step === 'shoot') renderApp(); }
    });
  }

  // ============================================================
  // Strip Wall (home preview + ?wall page)
  // ============================================================
  async function syncHearts(strips) {
    if (!state.account || !strips.length) return;
    const ids = await store.hearted(strips.map((s) => s.id), state.account).catch(() => []);
    for (const id of ids) state.hearted.add(id);
  }
  function heartButton(strip, onDone) {
    const mine = state.hearted.has(strip.id);
    const btn = h('button', { class: 'heart-btn', type: 'button', 'aria-pressed': String(mine), 'aria-label': `${mine ? 'You hearted' : 'Heart'} strip #${strip.id} (${strip.hearts} hearts)` }, `${mine ? '❤' : '♡'} ${strip.hearts}`);
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.hearted.has(strip.id)) return toast('You already hearted this one ❤');
      if (!(await ensureWallet())) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await store.heart(strip.id);
        state.hearted.add(strip.id);
        strip.hearts += 1;
        toast('Hearted ❤');
      } catch (err) {
        if (err?.revert?.name === 'AlreadyHearted') state.hearted.add(strip.id);
        else toast(explain(err).msg);
      }
      btn.replaceWith(heartButton(strip, onDone));
      onDone?.();
    });
    return btn;
  }
  function pinned(strip, i) {
    const tilt = ((strip.id * 37) % 9) - 4;
    const pins = ['var(--red)', 'var(--green)', 'var(--mustard)', 'var(--denim)'];
    return h('a', { class: 'pinned', href: `?strip=${strip.id}`, style: `--tilt:${tilt}deg;--pin:${pins[i % 4]}` },
      stripImg(strip),
      h('span', { class: 'meta' }, `#${strip.id}`, heartButton(strip)));
  }
  async function loadWallPreview() {
    const el = $('wallPreview');
    if (!el || $('home').hidden) return;
    el.replaceChildren(h('div', { class: 'empty' }, 'Pinning strips…'));
    try {
      const strips = await store.publicStrips(WALL_HOME);
      await syncHearts(strips);
      el.replaceChildren(...(strips.length ? strips.map(pinned) : [h('div', { class: 'empty' }, 'The wall is empty — be the first to pin a public strip!')]));
    } catch {
      el.replaceChildren(h('div', { class: 'empty' }, 'Couldn’t reach BOT Chain to load the wall. ', h('button', { class: 'btn sm', type: 'button', onclick: loadWallPreview }, 'Retry')));
    }
  }

  function pageShell(...children) {
    $('home').hidden = true;
    const page = $('page');
    page.hidden = false;
    page.replaceChildren(h('p', {}, h('a', { href: './', class: 'btn ghost sm' }, '← Back to the booth')), ...children);
    $('nav').classList.add('solid');
    return page;
  }

  function wallPage() {
    const view = { tab: params.get('tab') === 'mine' ? 'mine' : 'wall', sort: 'new', strips: null, mine: null, error: null };
    const body = h('div');
    const render = () => {
      const tabs = h('div', { class: 'pill', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', 'aria-pressed': String(view.tab === 'wall'), onclick: () => { view.tab = 'wall'; render(); } }, 'Strip Wall'),
        h('button', { type: 'button', role: 'tab', 'aria-pressed': String(view.tab === 'mine'), onclick: () => { view.tab = 'mine'; render(); loadMine(); } }, 'My strips'));
      let content;
      if (view.tab === 'wall') {
        const sort = h('div', { class: 'pill', role: 'group', 'aria-label': 'Sort' },
          h('button', { type: 'button', 'aria-pressed': String(view.sort === 'new'), onclick: () => { view.sort = 'new'; render(); } }, 'Newest'),
          h('button', { type: 'button', 'aria-pressed': String(view.sort === 'hearts'), onclick: () => { view.sort = 'hearts'; render(); } }, 'Most ❤'));
        const list = view.strips ? [...view.strips].sort((a, b) => (view.sort === 'hearts' ? b.hearts - a.hearts || b.id - a.id : b.id - a.id)) : null;
        content = [
          h('div', { class: 'bar' }, tabs, sort),
          h('div', { class: 'cork' }, view.error ? h('div', { class: 'empty' }, view.error)
            : !list ? h('div', { class: 'empty' }, 'Pinning strips…')
              : list.length ? list.map(pinned) : h('div', { class: 'empty' }, 'The wall is empty — be the first to pin a public strip!')),
        ];
      } else {
        let mine;
        if (!state.account) mine = h('div', { class: 'card' }, h('p', {}, 'Connect your wallet to see the strips you kept.'), walletButton({ big: true }));
        else if (!view.mine) mine = h('p', {}, 'Loading your strips…');
        else if (!view.mine.length) mine = h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'No strips kept from this wallet yet. ', h('a', { href: './#booth' }, 'Step into the booth →')));
        else mine = h('div', { class: 'mine' }, view.mine.map((s) => h('a', { class: 'card wob', href: `?strip=${s.id}` },
          s.isPublic ? stripImg(s) : h('div', { class: 'lockart' }, '🔒 private'),
          h('b', {}, `Strip #${s.id}`),
          h('span', { class: 'note' }, `${s.isPublic ? `Public · ${s.hearts} ❤` : 'Private keepsake'} · ${fmtDate(s.at)}`))));
        content = [h('div', { class: 'bar' }, tabs), proveBox(), h('div', { style: 'height:20px' }), mine];
      }
      body.replaceChildren(...content);
    };
    const loadMine = async () => {
      if (!state.account) return;
      view.mine = null;
      render();
      try { view.mine = await store.mine(state.account); } catch { view.mine = []; toast('Couldn’t load your strips'); }
      render();
    };
    pageShell(h('h1', {}, 'The Strip Wall'), h('p', { class: 'note' }, 'Every public strip kept in Booth 677, pinned forever on BOT Chain.'), body);
    render();
    store.publicStrips(300).then(async (s) => { await syncHearts(s); view.strips = s; render(); }).catch(() => { view.error = 'Couldn’t reach BOT Chain. Refresh to try again.'; render(); });
    walletListeners.add(() => { view.mine = null; render(); if (view.tab === 'mine') loadMine(); if (view.strips) syncHearts(view.strips).then(render); });
    if (view.tab === 'mine') loadMine();
  }

  // "Prove it's the original" — re-hash a PNG and look it up (optionally against one strip)
  function proveBox(strip) {
    const result = h('div', { 'aria-live': 'polite' });
    const input = h('input', { type: 'file', accept: 'image/png', hidden: true, onchange: (e) => check(e.target.files[0]) });
    const drop = h('div', {
      class: 'prove-drop', role: 'button', tabindex: '0', onclick: () => input.click(),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); check(e.dataTransfer.files[0]); },
    }, h('b', { style: 'font:700 22px var(--hand);display:block' }, strip ? 'Prove it’s the original' : 'Prove a strip is original'), 'Drop the PNG you downloaded (or tap to choose). It’s checked in your browser — nothing is uploaded.', input);
    async function check(file) {
      if (!file) return;
      result.replaceChildren(h('p', { class: 'note' }, 'Checking the fingerprint…'));
      try {
        const hash = await sha256(file);
        let match;
        if (strip) match = hash === strip.imageHash ? strip.id : null;
        else match = await store.findByHash(hash);
        result.replaceChildren(match != null
          ? h('div', { class: 'result match' }, `✓ It’s the original — this exact PNG was kept as strip #${match}.`, strip ? null : h('span', {}, ' ', h('a', { href: `?strip=${match}` }, 'Open it →')))
          : h('div', { class: 'result nomatch' }, 'This isn’t the original strip (even small edits change the fingerprint).'),
        h('p', { class: 'note', style: 'word-break:break-all' }, `Your file: ${hash}`));
      } catch {
        result.replaceChildren(h('div', { class: 'result nomatch' }, 'Couldn’t check that file. Try again.'));
      }
    }
    return h('div', { class: 'card', style: 'display:grid;gap:12px' }, drop, result);
  }

  async function stripPage(idText) {
    const id = /^\d+$/.test(idText) ? Number(idText) : null;
    pageShell(h('p', {}, 'Looking for strip…'));
    let strip = null;
    try { strip = id == null ? null : await store.get(id); } catch {
      pageShell(h('h1', {}, 'Hmm.'), h('p', {}, 'Couldn’t reach BOT Chain to load this strip. Refresh to try again.'));
      return;
    }
    if (!strip) {
      pageShell(h('h1', {}, 'Not here'), h('div', { class: 'card' }, h('p', { style: 'margin:0 0 12px' }, 'This strip isn’t in the booth.'), h('a', { class: 'btn green', href: './#booth' }, 'Make one')));
      return;
    }
    document.title = `Strip #${strip.id} · Booth 677`;
    const facts = () => h('dl', { class: 'facts' },
      h('dt', {}, 'Kept by'), h('dd', {}, PREVIEW ? short(strip.owner) : extLink(`${NET.explorer}/address/${strip.owner}`, short(strip.owner))),
      h('dt', {}, 'Kept on'), h('dd', {}, fmtDate(strip.at)),
      h('dt', {}, 'Frame'), h('dd', {}, Strip.FRAMES[strip.frame]?.name || '—'),
      h('dt', {}, 'Film'), h('dd', {}, Strip.LOOKS[strip.filter]?.name || '—'),
      h('dt', {}, 'Photos'), h('dd', {}, String(strip.shots)),
      h('dt', {}, 'Fingerprint'), h('dd', { class: 'mono' }, strip.imageHash),
      strip.isPublic && !strip.cid.startsWith('demo:') && !strip.cid.startsWith('data:') ? [h('dt', {}, 'IPFS'), h('dd', { class: 'mono' }, extLink(CONFIG.ipfsGateway + strip.cid, strip.cid))] : null);
    if (strip.isPublic) {
      await syncHearts([strip]);
      const heartSlot = h('div');
      const renderHeart = () => heartSlot.replaceChildren(heartButton(strip, renderHeart));
      renderHeart();
      walletListeners.add(() => syncHearts([strip]).then(renderHeart));
      pageShell(h('div', { class: 'strip-view' },
        h('div', { class: 'art' }, stripImg(strip, `Public photo strip #${strip.id}`)),
        h('div', { style: 'display:grid;gap:16px' },
          h('h1', {}, `Strip #${strip.id}`),
          h('p', { class: 'note', style: 'margin:0' }, 'A public strip on the Booth 677 wall — permanent on IPFS and BOT Chain.'),
          h('div', { class: 'row', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, heartSlot,
            h('button', { class: 'btn sm', type: 'button', onclick: () => copy(stripUrl(strip.id)) }, 'Copy link'),
            h('a', { class: 'btn sm', href: '?wall' }, 'See the wall')),
          h('div', { class: 'card' }, facts()),
          proveBox(strip))));
    } else {
      pageShell(h('div', { class: 'strip-view' },
        h('div', { class: 'card proof-card' },
          h('div', { class: 'lock', 'aria-hidden': 'true', html: '<svg viewBox="0 0 100 110"><rect x="14" y="46" width="72" height="58" rx="10" fill="#C9A24A" stroke="#1E1E1E" stroke-width="4"/><path d="M30 46V32a20 20 0 0 1 40 0v14" fill="none" stroke="#1E1E1E" stroke-width="8"/><circle cx="50" cy="72" r="8" fill="#1E1E1E"/><rect x="47" y="74" width="6" height="18" rx="2" fill="#1E1E1E"/></svg>' }),
          h('h1', {}, `Strip #${strip.id}`),
          h('p', {}, h('span', { class: 'pill-tag' }, 'private keepsake')),
          h('p', {}, 'The photo stayed with its owner. Only its fingerprint is on BOT Chain — proof this exact strip existed on ', h('b', {}, fmtDate(strip.at)), '.'),
          facts()),
        h('div', { style: 'display:grid;gap:16px' },
          proveBox(strip),
          h('button', { class: 'btn sm', type: 'button', onclick: () => copy(stripUrl(strip.id)) }, 'Copy proof link'))));
    }
  }

  // ============================================================
  // Home sections
  // ============================================================
  function initShowcase() {
    let i = 0;
    const el = $('frameShowcase');
    const render = () => {
      el.replaceChildren(
        carousel({ index: i, label: 'Frame showcase', onChange: (n) => { i = n; render(); el.querySelector('.carousel').focus(); } }),
        h('p', { class: 'blurb' }, Strip.FRAMES[i].blurb),
        h('p', { class: 'center', style: 'margin:14px 0 0' }, h('button', { class: 'btn green', type: 'button', onclick: () => { booth.frame = i; go('setup'); } }, `Use the ${Strip.FRAMES[i].name}`)));
    };
    render();
  }

  function initLooks() {
    const el = $('looksDemo');
    const photo = Strip.scene(900, 640);
    const demo = { look: 4, date: true, grain: true };
    const big = h('div', { class: 'big' });
    const prints = h('div', { class: 'prints', role: 'group', 'aria-label': 'Film looks' });
    const drawBig = () => {
      const c = Strip.print(photo, 900, 640, { look: demo.look, grain: demo.grain, date: demo.date ? Strip.dateText() : false });
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `Sample photo in ${Strip.LOOKS[demo.look].name}`);
      big.replaceChildren(c, h('span', { class: 'cap' }, Strip.LOOKS[demo.look].name));
      for (const b of prints.children) b.setAttribute('aria-pressed', String(Number(b.dataset.look) === demo.look));
    };
    Strip.LOOKS.forEach((l) => {
      prints.append(h('button', { class: 'print', type: 'button', 'data-look': l.id, 'aria-pressed': 'false', onclick: () => { demo.look = l.id; drawBig(); } },
        Strip.print(photo, 300, 214, { look: l.id }), h('span', {}, l.name)));
    });
    const toggle = (k, label) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: demo[k], onchange: (e) => { demo[k] = e.target.checked; drawBig(); } }), label);
    el.replaceChildren(big, h('div', {}, prints, h('div', { class: 'toggles' }, toggle('date', 'Date stamp'), toggle('grain', 'Film grain'))));
    drawBig();
  }

  function initFooter() {
    const addr = MAINNET.contract;
    $('footDate').innerHTML = Strip.segSVG(Strip.dateText(), { height: 22 });
    $('footAddr').textContent = addr ? short(addr) : 'contract coming soon';
    if (addr) $('footAddr').title = addr;
    $('footExplorer').href = addr ? `${MAINNET.explorer}/address/${addr}` : MAINNET.explorer;
    const c = CONFIG.credits;
    const handle = (c.x || '').replace(/^@/, '');
    $('credits').replaceChildren(...[
      handle ? extLink(`https://x.com/${handle}`, `📷 @${handle}`) : null,
      c.github ? extLink(c.github, '⭐ GitHub') : null,
      h('span', {}, `© Booth 677 ${new Date().getFullYear()}`),
    ].filter(Boolean));
    const strip = $('footStrip');
    if (reduceMotion() || !('IntersectionObserver' in window)) { strip.classList.add('out'); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { strip.classList.add('out'); io.disconnect(); } }, { threshold: 0.15 });
    io.observe($('footer'));
  }

  // 1 · Scroll into the booth
  function initHero() {
    const jump = () => window.scrollTo({ top: $('booth').getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    $('enterBtn').addEventListener('click', jump);
    const nav = $('nav');
    const onScroll = () => nav.classList.toggle('solid', window.scrollY > window.innerHeight * 0.6);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (reduceMotion() || !window.gsap || !window.ScrollTrigger) return; // the Enter button does it instantly
    gsap.registerPlugin(ScrollTrigger);
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: '#hero', start: 'top top', end: '+=170%', scrub: 0.6, pin: true, anticipatePin: 1 },
    });
    tl.to('#heroCopy', { opacity: 0, y: -40, duration: 0.2 }, 0)
      .to('.cloud.c1, .cloud.c3', { xPercent: -220, duration: 0.6 }, 0)
      .to('.cloud.c2, .cloud.c4', { xPercent: 220, duration: 0.6 }, 0)
      .to('#stage', { scale: 2.3, duration: 0.4, ease: 'power1.in' }, 0)
      .to('#curtainL', { scaleX: 0.22, svgOrigin: '116 400', duration: 0.28, ease: 'power2.out' }, 0.32)
      .to('#curtainR', { scaleX: 0.22, svgOrigin: '348 400', duration: 0.28, ease: 'power2.out' }, 0.32)
      .to('#stage', { scale: 10, duration: 0.42, ease: 'power2.in' }, 0.56)
      .to('#heroInside', { opacity: 1, duration: 0.14 }, 0.84)
      .to({}, { duration: 0.04 });
  }

  // ============================================================
  // Boot
  // ============================================================
  async function boot() {
    initWallet();
    initFooter();
    await Strip.ready();
    if (params.has('strip')) { stripPage(params.get('strip')); return; }
    if (params.has('wall')) { wallPage(); return; }
    renderApp();
    watchBooth();
    initShowcase();
    initLooks();
    initHero();
    loadWallPreview();
    walletListeners.add(() => { if (['keep'].includes(booth.step)) renderApp(); loadWallPreview(); });
    window.addEventListener('pagehide', stopCamera);
    if (location.hash === '#booth') requestAnimationFrame(() => $('booth').scrollIntoView());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

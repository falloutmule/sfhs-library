import { insertCapsulePrelude } from './capsule.js';

const MAX_SAVE_BYTES = 4 * 1024 * 1024;
const MAX_CAPSULE_CHARS = 180 * 1024 * 1024;
const MAX_KEYS = 10000;
const encoder = new TextEncoder();

export function validateSave(input) {
  if (input === undefined || input === null) return { localStorage: {}, bridge: null };
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Save must be an object.');
  const storage = input.localStorage ?? {};
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) throw new TypeError('localStorage save must be a key/value object.');
  const entries = Object.entries(storage);
  if (entries.length > MAX_KEYS || entries.some(([key, value]) => key.length > 8192 || typeof value !== 'string')) throw new TypeError('Save contains invalid storage keys or values.');
  const clean = { localStorage: Object.fromEntries(entries), bridge: input.bridge ?? null };
  let json;
  try { json = JSON.stringify(clean); } catch { throw new TypeError('Save must contain serializable JSON.'); }
  if (encoder.encode(json).length > MAX_SAVE_BYTES) throw new RangeError('Save exceeds the 4 MB managed-state limit.');
  const result = JSON.parse(json);
  if (result.bridge !== null && (typeof result.bridge !== 'object' || Array.isArray(result.bridge) || typeof result.bridge.schema !== 'string' || !Object.hasOwn(result.bridge, 'state'))) throw new TypeError('Bridge save needs a schema string and a state value.');
  return result;
}

export function capsulePolicy({ networkAllowed = false, networkOrigins = [] } = {}) {
  const origins = networkAllowed ? [...new Set(networkOrigins.map(value => {
    try { const url = new URL(value); return ['https:', 'wss:'].includes(url.protocol) && !url.username && !url.password ? url.origin : ''; } catch { return ''; }
  }).filter(Boolean))] : [];
  const remote = origins.length ? ' ' + origins.join(' ') : '';
  return `default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' data: blob:${remote}; style-src 'unsafe-inline' data: blob:${remote}; img-src data: blob:${remote}; media-src data: blob:${remote}; font-src data: blob:${remote}; connect-src data: blob:${remote}; manifest-src 'none'`;
}

// This function is serialized into the opaque iframe. All state and the private
// port live in its closure; guest code cannot choose a parent-side library ID.
function guestBootstrap(initialSave, token, capabilities) {
  'use strict';
  const channel = new MessageChannel();
  const port = channel.port1;
  const post = port.postMessage.bind(port);
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  const keys = Object.keys.bind(Object);
  const has = Function.call.bind(Object.prototype.hasOwnProperty);
  const define = Object.defineProperty.bind(Object);
  const ByteEncoder = TextEncoder;
  const limit = 4 * 1024 * 1024;
  const maxKeys = 10000;
  let revision = 0, saveBridge = null, bridgeReady = Promise.resolve(), pending = false;
  let exporting = Promise.resolve(), bridgeState = initialSave.bridge;
  let connected = false;
  const local = Object.assign(Object.create(null), initialSave.localStorage);
  const session = Object.create(null);
  const commandWaiters = new Map();
  let localFlushId = 0;
  function send(message) { post({ ...message, token }); }
  function report(type, message) { send({ type: 'status', status: { type, message: String(message).slice(0, 1000) } }); }
  function checkLimit(storage, name, value) {
    const copy = Object.assign(Object.create(null), storage);
    if (name !== undefined) copy[name] = value;
    if (keys(copy).length > maxKeys || new ByteEncoder().encode(stringify(copy)).length > limit) throw new DOMException('Managed storage quota exceeded.', 'QuotaExceededError');
    if (name !== undefined && name.length > 8192) throw new DOMException('Managed storage key is too large.', 'QuotaExceededError');
  }
  function storageAdapter(storage, persistent) {
    const api = {
      getItem(key) { key = String(key); return has(storage, key) ? storage[key] : null; },
      setItem(key, value) { key = String(key); value = String(value); checkLimit(storage, key, value); storage[key] = value; if (persistent) schedule(); },
      removeItem(key) { delete storage[String(key)]; if (persistent) schedule(); },
      clear() { for (const key of keys(storage)) delete storage[key]; if (persistent) schedule(); },
      key(index) { return keys(storage)[Number(index) >>> 0] ?? null; },
    };
    return new Proxy(Object.create(null), {
      get(target, name) {
        if (name === 'length') return keys(storage).length;
        if (name === Symbol.toStringTag) return 'Storage';
        if (has(api, name)) return api[name];
        return has(storage, name) ? storage[name] : undefined;
      },
      set(target, name, value) { if (typeof name === 'symbol') return false; api.setItem(name, value); return true; },
      deleteProperty(target, name) { api.removeItem(name); return true; },
      ownKeys() { return keys(storage); },
      getOwnPropertyDescriptor(target, name) { return has(storage, name) ? { value: storage[name], enumerable: true, writable: true, configurable: true } : undefined; },
      defineProperty(target, name, descriptor) { if (!has(descriptor, 'value')) return false; api.setItem(name, descriptor.value); return true; },
      has(target, name) { return name === 'length' || has(api, name) || has(storage, name); },
      preventExtensions() { return false; },
    });
  }
  const localAdapter = storageAdapter(local, true);
  define(window, 'localStorage', { value: localAdapter, configurable: false, writable: false });
  define(window, 'sessionStorage', { value: storageAdapter(session, false), configurable: false, writable: false });
  // Defense in depth only. The browser sandbox and CSP remain the security
  // boundary, and neither these shims nor static analysis are an offline proof.
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
    try { define(window, name, { value: undefined, configurable: false, writable: false }); } catch { /* capability may already be absent */ }
  }
  async function snapshot() {
    await bridgeReady;
    if (saveBridge) {
      const state = await saveBridge.exportState();
      bridgeState = { schema: saveBridge.schema, state };
    }
    const save = { localStorage: Object.fromEntries(keys(local).map(key => [key, local[key]])), bridge: bridgeState };
    const json = stringify(save);
    if (new ByteEncoder().encode(json).length > limit) throw new Error('Managed save exceeds 4 MB.');
    return parse(json);
  }
  function exportAndSend(requestId) {
    exporting = exporting.catch(() => {}).then(async () => {
      try { send({ type: 'save', revision: ++revision, requestId, save: await snapshot() }); }
      catch (error) { send({ type: 'save-error', requestId, message: String(error.message || error).slice(0, 1000) }); }
    });
    return exporting;
  }
  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; exportAndSend(null); });
  }
  async function registerSaveBridge(bridge) {
    if (saveBridge) throw new Error('A Save Bridge is already registered.');
    if (!bridge || typeof bridge.schema !== 'string' || bridge.schema.length > 200 || ['exportState', 'importState', 'validate'].some(name => typeof bridge[name] !== 'function')) throw new TypeError('Save Bridge requires schema, exportState, importState, and validate.');
    saveBridge = { schema: bridge.schema, exportState: bridge.exportState.bind(bridge), importState: bridge.importState.bind(bridge), validate: bridge.validate.bind(bridge) };
    bridgeReady = (async () => {
      if (bridgeState !== null) {
        if (bridgeState.schema !== saveBridge.schema) throw new Error('Saved bridge schema differs from the application schema.');
        await saveBridge.importState(parse(stringify(bridgeState.state)));
        if (await saveBridge.validate(parse(stringify(bridgeState.state))) !== true) throw new Error('Application Save Bridge did not validate the restored state.');
        report('bridge', 'Application Save Bridge imported and validated the saved state.');
      } else report('bridge', 'Application Save Bridge registered.');
    })();
    bridgeReady.catch(error => report('error', error.message));
    await bridgeReady;
    schedule();
  }
  define(window, 'SFHSLibrary', { configurable: false, writable: false, value: Object.freeze({
    version: 1,
    capabilities: Object.freeze(capabilities),
    registerSaveBridge,
    flush() {
      const id = 'guest-' + (++localFlushId);
      const result = new Promise((resolve, reject) => commandWaiters.set(id, { resolve, reject }));
      exportAndSend(id);
      return result;
    },
  }) });
  port.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.token !== token) return;
    if (message.type === 'connected') connected = true;
    if (message.type === 'flush' && typeof message.requestId === 'string') exportAndSend(message.requestId);
    if (message.type === 'ack' && typeof message.requestId === 'string') {
      const waiter = commandWaiters.get(message.requestId);
      if (waiter) { commandWaiters.delete(message.requestId); message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(); }
    }
  });
  port.start();
  window.addEventListener('error', event => report('error', event.message || 'Application script error.'));
  window.addEventListener('unhandledrejection', event => report('error', event.reason?.message || event.reason || 'Unhandled application promise rejection.'));
  document.addEventListener('securitypolicyviolation', event => report('warning', `Capsule policy blocked ${event.violatedDirective}: ${event.blockedURI}`));
  window.addEventListener('pagehide', () => exportAndSend(null));
  document.addEventListener('DOMContentLoaded', () => send({ type: 'ready' }), { once: true });
  // The opaque origin serializes as null, so targetOrigin cannot identify it.
  // Parent authenticates this one-time bootstrap by source + random token and
  // accepts only this transferred MessagePort for the session thereafter.
  parent.postMessage({ type: 'sfhs-runtime-port', token }, '*', [channel.port2]);
}

export async function launchCapsule({ container, capsule, save, onSave = async () => {}, onStatus = () => {}, networkAllowed = false, networkOrigins = [], capabilities = {} }) {
  if (!container || typeof container.appendChild !== 'function') throw new TypeError('A runtime container is required.');
  if (typeof capsule !== 'string' || !capsule.length || capsule.length > MAX_CAPSULE_CHARS) throw new TypeError('Executable capsule is empty or exceeds runtime limits.');
  let currentSave = validateSave(save);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  const iframe = document.createElement('iframe');
  iframe.title = 'Isolated application';
  iframe.className = 'runtime-frame';
  iframe.setAttribute('sandbox', 'allow-scripts' + (capabilities.pointerLock ? ' allow-pointer-lock' : '') + (capabilities.downloads ? ' allow-downloads' : ''));
  iframe.referrerPolicy = 'no-referrer';
  const policyFeatures = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'hid', 'bluetooth', 'midi', 'clipboard-read', 'clipboard-write', 'display-capture', 'xr-spatial-tracking'];
  const allows = policyFeatures.map(name => `${name} 'none'`);
  allows.push(capabilities.fullscreen ? 'fullscreen *' : "fullscreen 'none'");
  allows.push(capabilities.gamepad ? 'gamepad *' : "gamepad 'none'");
  iframe.setAttribute('allow', allows.join('; '));
  if (capabilities.fullscreen) iframe.allowFullscreen = true;
  let port = null, closed = false, readyDone = false, sequence = 0, lastRevision = 0, writes = Promise.resolve();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const waiters = new Map();
  const status = (type, message, extras = {}) => { try { onStatus({ type, message, ...extras }); } catch { /* UI callbacks do not control the broker */ } };
  const readyTimeout = setTimeout(() => rejectReady(new Error('Application did not initialize its isolated runtime within 12 seconds.')), 12000);
  const post = message => port?.postMessage({ ...message, token });
  const settle = (requestId, error) => {
    if (!requestId) return;
    post({ type: 'ack', requestId, error: error?.message });
    const waiter = waiters.get(requestId);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiters.delete(requestId);
      error ? waiter.reject(error) : waiter.resolve(validateSave(currentSave));
    }
  };
  function message(event) {
    const data = event.data;
    if (closed || !data || typeof data !== 'object' || data.token !== token) return;
    if (data.type === 'ready') {
      if (!readyDone) { readyDone = true; clearTimeout(readyTimeout); resolveReady(); status('ready', 'Application started in an opaque-origin sandbox.'); }
    } else if (data.type === 'status') {
      const payload = data.status;
      if (payload && ['warning', 'error', 'bridge'].includes(payload.type) && typeof payload.message === 'string') status(payload.type, payload.message.slice(0, 1000));
    } else if (data.type === 'save-error') {
      const error = new Error(typeof data.message === 'string' ? data.message.slice(0, 1000) : 'Application state could not be exported.');
      status('error', error.message);
      settle(data.requestId, error);
    } else if (data.type === 'save') {
      if (!Number.isSafeInteger(data.revision) || data.revision <= lastRevision) return;
      lastRevision = data.revision;
      const requestId = typeof data.requestId === 'string' && data.requestId.length < 100 ? data.requestId : null;
      let clean;
      try { clean = validateSave(data.save); } catch (error) { settle(requestId, error); status('error', error.message); return; }
      // Identity is lexical session state; neither the guest nor its saved data
      // can select another application, version, or IndexedDB record.
      writes = writes.catch(() => {}).then(async () => {
        if (closed) throw new Error('Runtime was closed before state could be saved.');
        await onSave(clean);
        currentSave = clean;
        status('saved', 'Managed application state saved locally.', { revision: data.revision });
        settle(requestId, null);
      }).catch(error => { status('error', error.message || 'Managed save write failed.'); settle(requestId, error); });
    }
  }
  function bootstrap(event) {
    if (closed || port || event.source !== iframe.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (!data || data.type !== 'sfhs-runtime-port' || data.token !== token || event.ports.length !== 1) return;
    port = event.ports[0];
    port.addEventListener('message', message);
    port.start();
    window.removeEventListener('message', bootstrap);
    post({ type: 'connected' });
  }
  window.addEventListener('message', bootstrap);
  const script = `(${guestBootstrap.toString()})(${JSON.stringify(currentSave).replace(/</g, '\\u003c')},${JSON.stringify(token)},${JSON.stringify({ fullscreen: Boolean(capabilities.fullscreen), pointerLock: Boolean(capabilities.pointerLock), downloads: Boolean(capabilities.downloads), gamepad: Boolean(capabilities.gamepad), network: Boolean(networkAllowed && networkOrigins.length) })});`;
  iframe.srcdoc = insertCapsulePrelude(capsule, { script, policy: capsulePolicy({ networkAllowed, networkOrigins }) });
  container.appendChild(iframe);
  const cleanup = () => {
    closed = true;
    clearTimeout(readyTimeout);
    window.removeEventListener('message', bootstrap);
    for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Runtime closed.')); }
    waiters.clear();
    port?.close();
    iframe.remove();
  };
  try { await ready; } catch (error) { cleanup(); throw error; }
  async function flush() {
    if (closed || !port) throw new Error('Runtime is closed.');
    const requestId = 'parent-' + (++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(requestId); reject(new Error('Application save export did not finish within 8 seconds.')); }, 8000);
      waiters.set(requestId, { resolve, reject, timer });
      post({ type: 'flush', requestId });
    });
  }
  return {
    iframe,
    flush,
    async close() {
      if (closed) return;
      try { await flush(); await writes; }
      finally { cleanup(); }
    },
  };
}

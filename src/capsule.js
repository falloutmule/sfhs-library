import { unzipSync } from 'fflate';
import { parse as parseHTML, serialize } from 'parse5';
import { init, parse as parseModules } from 'es-module-lexer';
import { parse as parseJavaScript } from 'acorn';

export const CAPSULE_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MIME = { html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain' };

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}

function dataURL(bytes, path) {
  return `data:${MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

function attr(node, key) { return node.attrs?.find(item => item.name === key)?.value; }
function setAttr(node, key, value) {
  const item = node.attrs.find(item => item.name === key);
  if (item) item.value = value;
  else node.attrs.push({ name: key, value });
}
function textOf(node) { return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textOf).join(''); }
function setText(node, text) { node.childNodes = [{ nodeName: '#text', value: text, parentNode: node }]; }
function walk(node, fn) {
  fn(node);
  for (const child of [...(node.childNodes || [])]) walk(child, fn);
  if (node.content) walk(node.content, fn);
}
function remove(node) {
  const list = node.parentNode?.childNodes;
  if (list) list.splice(list.indexOf(node), 1);
}
function makeNode(tag, attrs = {}, text = '') {
  const node = { nodeName: tag, tagName: tag, namespaceURI: 'http://www.w3.org/1999/xhtml', attrs: Object.entries(attrs).map(([name, value]) => ({ name, value })), childNodes: [] };
  if (text) setText(node, text);
  return node;
}

// A real HTML parser is deliberately used here. DOMParser can fetch resources even
// in an otherwise inert document; imported bytes never enter the launcher's DOM.
export function insertCapsulePrelude(html, { script = '', policy = '', meta = false } = {}) {
  const document = parseHTML(html);
  let head;
  walk(document, node => {
    if (node.tagName === 'head') head = node;
    if (node.tagName === 'base' || (node.tagName === 'meta' && /^(refresh|content-security-policy)$/i.test(attr(node, 'http-equiv') || ''))) remove(node);
  });
  const added = [];
  if (policy) added.push(makeNode('meta', { 'http-equiv': 'Content-Security-Policy', content: policy }));
  if (meta) added.push(makeNode('meta', { name: 'sfhs-library-capsule', content: String(CAPSULE_VERSION) }));
  if (script) added.push(makeNode('script', {}, script.replace(/<\/script/gi, '<\\/script')));
  for (const node of added) node.parentNode = head;
  head.childNodes.unshift(...added);
  return serialize(document);
}

function safeArchivePath(path) {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) throw new Error('ZIP contains an unsafe absolute or backslash path.');
  const parts = path.split('/');
  if (parts.some(p => p === '..' || p === '.')) throw new Error('ZIP contains a traversal path.');
  return parts.filter(Boolean).join('/');
}

function inspectZIP(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('ZIP has no valid directory.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Split ZIP archives are unsupported.');
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true), total = 0;
  if (!count || count > MAX_FILES) throw new Error(`ZIP must contain between 1 and ${MAX_FILES} entries.`);
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014b50) throw new Error('ZIP directory is malformed.');
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 24, true), nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true);
    const mode = view.getUint32(position + 38, true) >>> 16;
    if (flags & 1) throw new Error('Encrypted ZIP archives are unsupported.');
    if (![0, 8].includes(method)) throw new Error('ZIP compression method is unsupported.');
    if ((mode & 0xf000) === 0xa000) throw new Error('ZIP symbolic links are unsupported.');
    if (position + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('ZIP directory is truncated.');
    const rawName = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    const path = safeArchivePath(rawName);
    if (names.has(path)) throw new Error('ZIP contains duplicate paths.');
    names.add(path);
    total += size;
    if (size === 0xffffffff || total > MAX_EXPANDED_BYTES) throw new Error('ZIP expanded size exceeds the 64 MB safety limit.');
    position += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function unpack(bytes, filename, entryPath) {
  const zip = /\.zip$/i.test(filename) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (!zip) {
    if (!/\.(html?|xhtml)$/i.test(filename)) throw new Error('Choose an HTML file or static HTML ZIP package.');
    if (entryPath !== undefined && safeArchivePath(entryPath) !== 'index.html') throw new Error('A standalone HTML payload has no selectable package entry.');
    return { packaged: false, files: new Map([['index.html', bytes]]), entry: 'index.html' };
  }
  const names = inspectZIP(bytes);
  let expanded = 0, fileCount = 0;
  const unzipped = unzipSync(bytes, { filter(file) {
    const path = safeArchivePath(file.name);
    if (!names.has(path)) throw new Error('ZIP local file directory differs from its central directory.');
    expanded += file.originalSize;
    if (++fileCount > MAX_FILES || expanded > MAX_EXPANDED_BYTES) throw new Error('ZIP exceeds extraction safety limits.');
    return !file.name.endsWith('/');
  } });
  const files = new Map(Object.entries(unzipped).filter(([path]) => !path.startsWith('__MACOSX/') && !path.split('/').some(p => p.startsWith('.'))));
  const roots = new Set([...files.keys()].map(path => path.includes('/') ? path.slice(0, path.indexOf('/') + 1) : ''));
  if (roots.size === 1 && !roots.has('')) {
    const root = [...roots][0];
    for (const [path, content] of [...files]) { files.delete(path); files.set(path.slice(root.length), content); }
  }
  const htmlFiles = [...files.keys()].filter(path => /\.html?$/i.test(path));
  let entry;
  if (entryPath !== undefined) {
    if (typeof entryPath !== 'string' || !entryPath.trim()) throw new Error('The selected package entry must be a nonempty relative HTML path.');
    entry = safeArchivePath(entryPath);
    if (!files.has(entry) || !/\.html?$/i.test(entry)) throw new Error(`The selected HTML entry is not in this package: ${entry}`);
  } else {
    const indexes = htmlFiles.filter(path => /^index\.html?$/i.test(path));
    if (indexes.length > 1) throw new Error('ZIP contains ambiguous index HTML files. Select one exact entry path.');
    entry = indexes[0] || (htmlFiles.length === 1 ? htmlFiles[0] : null);
  }
  if (!entry) throw new Error('ZIP needs a root index.html, or exactly one HTML entry. Choose a built static browser distribution.');
  return { packaged: true, files, entry };
}

// Runs only inside the opaque guest. Known static resources are represented by
// archived data URLs. This adapter does not grant access to launcher resources.
function assetAdapter(assets, entry) {
  const base = 'https://sfhs.invalid/' + entry;
  const originalFetch = window.fetch.bind(window);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function resolve(value) {
    if (typeof value !== 'string' || /^(data:|blob:|#)/i.test(value)) return value;
    let url;
    try { url = new URL(value, base); } catch { return value; }
    if (url.origin !== 'https://sfhs.invalid') return value;
    let path;
    try { path = decodeURIComponent(url.pathname.slice(1)); } catch { return value; }
    return has(assets, path) ? assets[path] + url.hash : value;
  }
  window.fetch = function(input, options) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const mapped = resolve(raw);
    if (mapped !== raw) {
      const method = (options?.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) return Promise.reject(new TypeError('Local package assets are read-only.'));
      return originalFetch(mapped, { ...options, credentials: 'omit', method: 'GET' }).then(response => method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response);
    }
    // Relative paths not present in the acquired payload are never resolved
    // against the launcher's own origin.
    if (typeof raw === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//')) return Promise.reject(new TypeError('Resource is not present in this local package: ' + raw));
    return originalFetch(input, { ...options, credentials: 'omit' });
  };
  for (const [type, names] of [[HTMLImageElement, ['src']], [HTMLMediaElement, ['src']], [HTMLSourceElement, ['src']], [HTMLVideoElement, ['poster']], [HTMLScriptElement, ['src']], [HTMLLinkElement, ['href']]]) {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(type.prototype, name);
      if (descriptor?.set) Object.defineProperty(type.prototype, name, { ...descriptor, set(value) { descriptor.set.call(this, resolve(String(value))); } });
    }
  }
  const set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const key = String(name).toLowerCase();
    if (['src', 'poster'].includes(key) || (key === 'href' && this.tagName === 'LINK')) value = resolve(String(value));
    return set.call(this, name, value);
  };
  const NativeAudio = window.Audio;
  function PackageAudio(src) { const audio = new NativeAudio(); if (src !== undefined) audio.src = resolve(String(src)); return audio; }
  PackageAudio.prototype = NativeAudio.prototype;
  window.Audio = PackageAudio;
}

export async function analyzePayload({ bytes, filename = 'application.html', networkAllowed = false, entryPath }) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const originalHash = await sha256(bytes);
  const base = { originalHash, executableHash: null, capsule: '', title: filename.replace(/\.[^.]+$/, ''), profile: 'external-only', compatible: false, reasons: [], warnings: [], offline: 'unknown', saveSupport: 'unknown', fileCount: 0, networkOrigins: [], capsuleVersion: CAPSULE_VERSION };
  const reasons = new Set(), warnings = new Set(), networkOrigins = new Set();
  try {
    if (!bytes.length || bytes.length > MAX_PAYLOAD_BYTES) throw new Error('Payload must be nonempty and no larger than 32 MB.');
    const { files, entry, packaged } = unpack(bytes, filename, entryPath);
    base.fileCount = files.size;
    let html;
    try { html = decoder.decode(files.get(entry)); } catch { throw new Error('Entry HTML must use valid UTF-8 encoding.'); }
    if (!/<(?:!doctype\s+html|html|head|body|script|div|canvas|main|title)\b/i.test(html)) throw new Error('The selected entry does not appear to be HTML.');
    const document = parseHTML(html);
    let head, nativeBridge = false, localStorage = false;
    const sourceTexts = new Map();
    const codeUnits = [];
    for (const [path, content] of files) if (/\.(?:m?js|html?)$/i.test(path)) {
      let source;
      try { source = decoder.decode(content); } catch { reasons.add(`Text resource is not UTF-8: ${path}`); continue; }
      sourceTexts.set(path, source);
      if (/\.m?js$/i.test(path)) codeUnits.push({ source, path });
      else {
        walk(path === entry ? document : parseHTML(source), node => {
          if (node.tagName === 'script' && !attr(node, 'src') && ['', 'module', 'text/javascript', 'application/javascript'].includes((attr(node, 'type') || '').toLowerCase())) codeUnits.push({ source: textOf(node), path });
          // Event-handler bodies execute in the guest too. They are analyzed as
          // function bodies, not confused with comments or visible page prose.
          for (const attribute of node.attrs || []) if (/^on/i.test(attribute.name)) codeUnits.push({ source: attribute.value, path });
        });
      }
    }
    const literalFetches = [], literalConnections = [];
    const memberName = node => {
      if (!node) return '';
      if (node.type === 'Identifier') return node.name;
      if (node.type === 'ChainExpression') return memberName(node.expression);
      if (node.type === 'MemberExpression') {
        const property = node.computed ? node.property.type === 'Literal' ? String(node.property.value) : '' : node.property.name;
        return memberName(node.object) + '.' + property;
      }
      return '';
    };
    for (const { source, path } of codeUnits) {
      let ast;
      const options = { ecmaVersion: 'latest', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true };
      try { ast = parseJavaScript(source, { ...options, sourceType: 'script' }); }
      catch {
        try { ast = parseJavaScript(source, { ...options, sourceType: 'module' }); }
        catch { reasons.add(`Executable JavaScript could not be analyzed: ${path}`); continue; }
      }
      const pending = [ast];
      while (pending.length) {
        const node = pending.pop();
        if (node.type === 'Identifier' && node.name === 'localStorage') localStorage = true;
        if (node.type === 'MemberExpression' && /(?:^|\.)localStorage(?:\.|$)/.test(memberName(node))) localStorage = true;
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
          const name = memberName(node.callee);
          if (/(?:^|\.)SFHSLibrary\.registerSaveBridge$/.test(name)) nativeBridge = true;
          const unsupported = [
            [/(?:^|\.)indexedDB\.(?:open|deleteDatabase)$/, 'Direct IndexedDB is not virtualized'],
            [/(?:^|\.)serviceWorker\.register$/, 'Application service workers are not supported'],
            [/(?:^|\.)(?:SharedWorker|Worker)$/, 'Application workers are not supported'],
            [/(?:^|\.)storage\.getDirectory$/, 'Direct OPFS is not virtualized'],
            [/(?:^|\.)(?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker)$/, 'Desktop file-system pickers cannot be offered by this phone runtime'],
            [/(?:^|\.)XMLHttpRequest$/, 'XMLHttpRequest is not virtualized; use a self-contained build or supported fetch assets'],
            [/(?:^|\.)(?:RTCPeerConnection|webkitRTCPeerConnection|WebTransport)$/, 'Peer-to-peer and WebTransport networking are not supported'],
            [/(?:^|\.)document\.(?:write|writeln|open)$/, 'Document replacement is not supported in an isolated capsule'],
            [/(?:^|\.)(?:eval|Function)$/, 'Dynamic code evaluation is blocked by the capsule policy'],
          ];
          for (const [pattern, label] of unsupported) if (pattern.test(name)) reasons.add(`${label} (${path}).`);
          if (node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
            if (/(?:^|\.)fetch$/.test(name)) literalFetches.push(node.arguments[0].value);
            if (/(?:^|\.)(?:WebSocket|EventSource)$/.test(name)) literalConnections.push(node.arguments[0].value);
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const child of value) if (child && typeof child.type === 'string') pending.push(child);
          } else if (value && typeof value.type === 'string') pending.push(value);
        }
      }
    }
    function resolvePath(value, from) {
      const trimmed = value.trim();
      if (!trimmed || trimmed.startsWith('#') || /^data:/i.test(trimmed)) return { passthrough: trimmed };
      if (/^blob:/i.test(trimmed)) { reasons.add(`A saved blob URL cannot be restored: ${trimmed.slice(0, 100)}`); return { passthrough: trimmed }; }
      let url;
      try { url = new URL(trimmed, 'https://sfhs.invalid/' + from); } catch { reasons.add(`Malformed resource URL: ${trimmed.slice(0, 100)}`); return { passthrough: trimmed }; }
      if (url.origin !== 'https://sfhs.invalid') {
        if (/^https?:$/.test(url.protocol)) {
          networkOrigins.add(url.origin);
          if (url.protocol !== 'https:') reasons.add('Insecure HTTP resources cannot run from the HTTPS launcher.');
          return { passthrough: trimmed.startsWith('//') ? 'https:' + trimmed : trimmed };
        }
        reasons.add(`Unsupported resource protocol: ${url.protocol}`);
        return { passthrough: trimmed };
      }
      let path;
      try { path = decodeURIComponent(url.pathname.slice(1)); } catch { reasons.add('Malformed percent-encoded resource path.'); return { passthrough: trimmed }; }
      if (!files.has(path)) reasons.add(`Required resource is not in the payload: ${path}`);
      return { path, hash: url.hash };
    }
    const transformedCSS = new Map();
    function rewriteCSS(css, from, chain = []) {
      const rewriteURL = raw => {
        const resolved = resolvePath(raw, from);
        if (!resolved.path || !files.has(resolved.path)) return resolved.passthrough || raw;
        if (/\.css$/i.test(resolved.path)) {
          if (chain.includes(resolved.path)) { reasons.add('Circular CSS imports are unsupported.'); return ''; }
          if (!transformedCSS.has(resolved.path)) transformedCSS.set(resolved.path, rewriteCSS(decoder.decode(files.get(resolved.path)), resolved.path, [...chain, resolved.path]));
          return dataURL(encoder.encode(transformedCSS.get(resolved.path)), resolved.path) + resolved.hash;
        }
        return dataURL(files.get(resolved.path), resolved.path) + resolved.hash;
      };
      let output = css.replace(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s][^)]*?))\s*\)/gi, (_, a, b, c) => `url("${rewriteURL(a ?? b ?? c).replace(/"/g, '%22')}")`);
      output = output.replace(/(@import\s+)(["'])([^"']+)\2/gi, (_, prefix, quote, url) => `${prefix}${quote}${rewriteURL(url)}${quote}`);
      return output;
    }
    await init;
    const moduleMap = Object.create(null), transformedJS = new Map();
    function rewriteJS(source, path) {
      let imports;
      try { [imports] = parseModules(source); } catch { reasons.add(`JavaScript could not be analyzed: ${path}`); return source; }
      let output = source;
      for (const item of [...imports].reverse()) {
        if (item.d === -2) { reasons.add(`import.meta requires a URL-based runtime (${path}).`); continue; }
        if (item.d >= 0) { reasons.add(`Dynamic imports are not supported (${path}).`); continue; }
        if (!item.n) { reasons.add(`Unresolved module import (${path}).`); continue; }
        if (!/^([./]|https?:|data:)/.test(item.n)) { reasons.add(`Bare module specifier needs a prebundled build: ${item.n}`); continue; }
        const resolved = resolvePath(item.n, path);
        if (resolved.path && files.has(resolved.path)) {
          if (!/\.(?:m?js)$/i.test(resolved.path)) { reasons.add(`Only JavaScript module imports are supported: ${resolved.path}`); continue; }
          output = output.slice(0, item.s) + `sfhs:/${resolved.path}` + output.slice(item.e);
        }
      }
      return output;
    }
    for (const [path, source] of sourceTexts) if (/\.m?js$/i.test(path)) transformedJS.set(path, rewriteJS(source, path));
    for (const [path, source] of transformedJS) moduleMap[`sfhs:/${path}`] = dataURL(encoder.encode(source), path);
    const assets = Object.create(null);
    for (const [path, content] of files) {
      if (/\.html?$/i.test(path)) continue;
      let data = content;
      if (/\.css$/i.test(path)) {
        if (!transformedCSS.has(path)) transformedCSS.set(path, rewriteCSS(decoder.decode(content), path, [path]));
        data = encoder.encode(transformedCSS.get(path));
      } else if (transformedJS.has(path)) data = encoder.encode(transformedJS.get(path));
      assets[path] = dataURL(data, path);
    }
    const resourceAttributes = { script: ['src'], img: ['src'], audio: ['src'], video: ['src', 'poster'], source: ['src'], track: ['src'], input: ['src'], image: ['href', 'xlink:href'], use: ['href', 'xlink:href'] };
    walk(document, node => {
      const tag = node.tagName;
      if (!tag) return;
      if (tag === 'head') head = node;
      if (tag === 'title') base.title = textOf(node).trim().slice(0, 120) || base.title;
      if (tag === 'base') { reasons.add('Custom base URLs are unsupported; use a self-contained build.'); remove(node); return; }
      if (['iframe', 'frame', 'frameset', 'object', 'embed'].includes(tag)) reasons.add(`Nested ${tag} content is unsupported.`);
      if (tag === 'meta' && /^refresh$/i.test(attr(node, 'http-equiv') || '')) { reasons.add('Automatic page navigation is unsupported.'); remove(node); }
      if (tag === 'meta' && /^content-security-policy$/i.test(attr(node, 'http-equiv') || '')) { warnings.add('The executable capsule uses the launcher isolation policy; original policy is preserved in the original payload.'); remove(node); }
      if (attr(node, 'srcset')) reasons.add('Responsive srcset resources require a prebundled build.');
      if (attr(node, 'style')) setAttr(node, 'style', rewriteCSS(attr(node, 'style'), entry));
      if (tag === 'style') setText(node, rewriteCSS(textOf(node), entry));
      if (tag === 'script') {
        const type = (attr(node, 'type') || '').toLowerCase();
        if (type === 'importmap') reasons.add('Existing import maps require a prebundled build.');
        if (!attr(node, 'src') && ['', 'module', 'text/javascript', 'application/javascript'].includes(type)) setText(node, rewriteJS(textOf(node), entry));
      }
      const attrs = [...(resourceAttributes[tag] || [])];
      if (tag === 'link' && /(?:stylesheet|icon|preload|modulepreload|manifest)/i.test(attr(node, 'rel') || '')) attrs.push('href');
      if (tag === 'link' && /manifest/i.test(attr(node, 'rel') || '')) { warnings.add('Application web manifests are not registered inside the capsule.'); remove(node); return; }
      for (const name of attrs) {
        const value = attr(node, name);
        if (!value) continue;
        const resolved = resolvePath(value, entry);
        if (resolved.path && assets[resolved.path]) {
          setAttr(node, name, assets[resolved.path] + resolved.hash);
          node.attrs = node.attrs.filter(item => !['integrity', 'crossorigin'].includes(item.name));
        } else if (resolved.passthrough) setAttr(node, name, resolved.passthrough);
      }
    });
    // Literal fetches receive static existence checks in addition to the runtime
    // package resolver. Dynamic paths remain a documented compatibility limit.
    for (const value of literalFetches) resolvePath(value, entry);
    for (const value of literalConnections) {
      try { networkOrigins.add(new URL(value).origin); } catch { reasons.add('A network endpoint could not be resolved.'); }
    }
    if (networkOrigins.size) warnings.add('Local payload references network resources. Network access must be explicitly enabled; upstream CORS restrictions still apply.');
    warnings.add('Static analysis cannot prove complete compatibility. Test launch, meaningful use, saves, and restore.');
    if (localStorage || nativeBridge) warnings.add('Managed saves support localStorage and registered SFHS Save Bridge state. Other browser persistence is not virtualized.');
    const importMapNode = makeNode('script', { type: 'importmap' }, JSON.stringify({ imports: moduleMap }).replace(/</g, '\\u003c'));
    importMapNode.parentNode = head;
    head.childNodes.unshift(importMapNode);
    const adapter = `(${assetAdapter.toString()})(${JSON.stringify(assets).replace(/</g, '\\u003c')},${JSON.stringify(entry)});`;
    base.capsule = insertCapsulePrelude(serialize(document), { script: adapter, meta: true });
    if (base.capsule.length > 128 * 1024 * 1024) reasons.add('Executable capsule exceeds the 128 MB safety limit; use a smaller static distribution.');
    base.executableHash = await sha256(encoder.encode(base.capsule));
    base.compatible = reasons.size === 0;
    base.profile = !base.compatible ? 'external-only' : networkOrigins.size ? 'network-dependent' : nativeBridge ? 'native-sfhs' : packaged ? 'isolated-packaged' : 'isolated-single-file';
    base.offline = networkOrigins.size ? 'network' : 'candidate';
    base.saveSupport = localStorage || nativeBridge ? 'supported' : 'unknown';
    base.networkEnabled = Boolean(networkAllowed && networkOrigins.size);
    base.entry = entry;
  } catch (error) { reasons.add(error.message || 'Payload analysis failed.'); }
  base.reasons = [...reasons];
  base.warnings = [...warnings];
  base.networkOrigins = [...networkOrigins].sort();
  return base;
}

import { build } from 'esbuild';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const manifest = JSON.parse(await readFile('src/build-manifest.json', 'utf8'));
async function inputFiles(directory) {
  const entries=await readdir(directory,{withFileTypes:true});
  const output=[];
  for(const entry of entries){const name=`${directory}/${entry.name}`;output.push(...(entry.isDirectory()?await inputFiles(name):[name]));}
  return output;
}
const inputHash=createHash('sha256');
for(const name of [...await inputFiles('src'),...await inputFiles('public'),'package-lock.json','tools/build.mjs'].sort())inputHash.update(name+'\0').update(await readFile(name)).update('\0');
const sourceHash=inputHash.digest('hex');
const buildId=`${manifest.buildId}-${sourceHash.slice(0,10)}`;
const bundle = await build({ entryPoints: [manifest.entry], bundle: true, write: false, format: 'iife', target: ['chrome110','firefox115','safari16.4'], minify: true, legalComments: 'inline', define: { __BUILD_ID__: JSON.stringify(buildId) } });
const css = await readFile('src/styles.css', 'utf8');
const source = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = (await readFile('src/shell.html', 'utf8')).replace('<!--APP_CSS-->', css).replace('<!--APP_JS-->', source).replaceAll('<!--BUILD_ID-->', buildId);
const csp = "default-src 'none'; script-src 'unsafe-inline' data: blob: https: 'wasm-unsafe-eval'; style-src 'unsafe-inline' data: blob: https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: blob: https:; connect-src 'self' https: wss: data: blob:; frame-src data: blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const notices = [];
for (const name of ['acorn','es-module-lexer','fflate','parse5','entities']) {
  const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  notices.push(`${name} ${pkg.version}\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`);
}
const noticeText = notices.join('\n\n' + '='.repeat(72) + '\n\n');
html = html.replace('</body>', `<script type="application/json" id="third-party-notices">${JSON.stringify(noticeText).replace(/</g,'\\u003c')}</script>\n</body>`);
html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
const artifactHash = createHash('sha256').update(html).digest('hex');
const sw = `const CACHE='sfhs-${artifactHash.slice(0,16)}';
const FILES=['./','./index.html','./manifest.webmanifest','./icon.svg','./catalog.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sfhs-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;const url=new URL(e.request.url);if(!FILES.some(p=>new URL(p,self.registration.scope).pathname===url.pathname))return;e.respondWith(caches.open(CACHE).then(async c=>{const cached=await c.match(e.request,{ignoreSearch:true});return cached||fetch(e.request)}))});\n`;
const outputs = new Map([['index.html', html],['sw.js',sw],['build-info.json',JSON.stringify({buildId,sourceHash,artifactSha256:artifactHash},null,2)+'\n'],['THIRD-PARTY-NOTICES.txt',noticeText],['manifest.webmanifest', await readFile('public/manifest.webmanifest')],['icon.svg',await readFile('public/icon.svg')],['catalog.json',await readFile('public/catalog.json')]]);
const check = process.argv.includes('--check');
for (const [name, content] of outputs) {
  if (check) {
    const actual = await readFile(name);
    if (!actual.equals(Buffer.from(content))) throw new Error(`${name} does not match canonical source. Run npm run build.`);
  } else await writeFile(name, content);
}
console.log(`${check ? 'PASS build parity' : 'Built'} ${buildId} | ${(Buffer.byteLength(html)/1024).toFixed(1)} KiB | sha256 ${artifactHash}`);

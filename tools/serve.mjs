import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 4178);
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.zip':'application/zip' };
http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname+'index.html' : pathname));
    if (!file.startsWith(root+sep) || pathname.includes('/.') || pathname.includes('node_modules')) throw new Error('Not found');
    const bytes = await readFile(file);
    response.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port,'127.0.0.1',()=>console.log(`SFHS Library http://127.0.0.1:${port}`));

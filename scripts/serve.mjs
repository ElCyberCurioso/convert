#!/usr/bin/env node
// Servidor estático local que imita GitHub Pages: sirve el repo bajo una
// subruta (/transmuta/ por defecto) y sin cabeceras especiales.
//
//   npm run serve                 -> http://localhost:8080/transmuta/
//   PORT=3000 BASE=/ npm run serve

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const base = (process.env.BASE || '/transmuta/').replace(/\/?$/, '/');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.md': 'text/markdown; charset=utf-8',
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path === '/' && base !== '/') { res.writeHead(302, { Location: base }); res.end(); return; }
  if (!path.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
  path = path.slice(base.length);
  let file = normalize(join(root, path));
  if (!file.startsWith(root) || /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(file.slice(root.length))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const st = statSync(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log(`Transmuta en http://localhost:${port}${base}`));

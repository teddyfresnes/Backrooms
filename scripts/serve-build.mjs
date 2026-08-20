import { ensureDeliveryAssets } from './unpack-assets.mjs';
ensureDeliveryAssets();
import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
if (!existsSync(path.join(root, 'index.html'))) {
  console.error('Build absent. Extraire le ZIP complet, ou lancer npm ci puis npm run build.');
  process.exit(1);
}
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + pathname);
    if ((file !== root && !file.startsWith(root + path.sep)) || pathname.includes('\0')) {
      response.writeHead(403).end();
      return;
    }
    if (pathname.endsWith('/')) file = path.join(file, 'index.html');
    let info;
    try {
      if (!existsSync(file)) {
        const publicFile = path.resolve(root, '../public', path.relative(root, file));
        if (existsSync(publicFile)) file = publicFile;
      }
      info = await stat(file);
    } catch {
      if (path.extname(pathname)) { response.writeHead(404).end('Fichier absent'); return; }
      file = path.join(root, 'index.html');
      info = await stat(file);
    }
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch { response.writeHead(400).end('Requete invalide'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Le port ${port} est deja utilise. Fermer l'autre lancement ou definir PORT.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Backrooms v123 : ${url}\nGarder cette fenetre ouverte. Ctrl+C pour arreter.`);
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const child = spawn(command[0], command[1], { stdio: 'ignore', detached: true });
    child.on('error', () => console.log('Ouvrir manuellement cette adresse dans le navigateur.'));
    child.unref();
  }
});

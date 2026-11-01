// gateway : point d'entrée unique de QuickShop.
// - sert l'interface web (public/)
// - route /api/* vers le bon microservice (pattern "API Gateway")
// - agrège l'état de tous les microservices pour l'écran Architecture
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');

const PORT = Number(process.env.PORT) || 8080;
const STARTED_AT = new Date();

const SERVICES = {
  catalog: { name: 'catalog-service', url: process.env.CATALOG_URL || 'http://catalog-service:8001' },
  orders: { name: 'order-service', url: process.env.ORDERS_URL || 'http://order-service:8002' },
};

// Préfixe public -> microservice. Le préfixe /api est retiré avant de transmettre.
const ROUTES = [
  ['/api/products', 'catalog'],
  ['/api/categories', 'catalog'],
  ['/api/orders', 'orders'],
  ['/api/workers', 'orders'],
];

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function proxy(req, res, key, requestId) {
  const service = SERVICES[key];
  const target = new URL(service.url);
  const client = target.protocol === 'https:' ? https : http;
  const basePath = target.pathname.replace(/\/$/, '');
  const started = Date.now();

  const headers = { ...req.headers, host: target.host, 'x-request-id': requestId, 'x-forwarded-for': req.socket.remoteAddress };
  const upstream = client.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: basePath + req.url.replace(/^\/api/, ''), headers, timeout: 10000 },
    upRes => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
      upRes.on('end', () => log(`${req.method} ${req.url} -> ${service.name} ${upRes.statusCode} (${Date.now() - started} ms) id=${requestId}`));
    },
  );
  upstream.on('timeout', () => upstream.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  upstream.on('error', err => {
    log(`${req.method} ${req.url} -> ${service.name} ERREUR ${err.code || err.message} id=${requestId}`);
    if (!res.headersSent) {
      sendJSON(res, 503, { error: 'Service Unavailable', message: `${service.name} est indisponible (${err.code || err.message})`, service: service.name });
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

function getJSON(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.get(target, { timeout: timeoutMs }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('réponse invalide'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function serviceStatus(key) {
  const service = SERVICES[key];
  const started = Date.now();
  try {
    const info = await getJSON(service.url.replace(/\/$/, '') + '/info', 3000);
    return { key, name: service.name, url: service.url, status: 'UP', latencyMs: Date.now() - started, info };
  } catch (err) {
    return { key, name: service.name, url: service.url, status: 'DOWN', latencyMs: Date.now() - started, error: err.code || err.message };
  }
}

async function systemStatus() {
  const services = await Promise.all(Object.keys(SERVICES).map(serviceStatus));
  let workers = [];
  if (services.find(s => s.key === 'orders').status === 'UP') {
    try {
      workers = await getJSON(SERVICES.orders.url.replace(/\/$/, '') + '/workers', 3000);
    } catch {
      workers = [];
    }
  }
  return {
    gateway: {
      name: 'gateway',
      version: pkg.version,
      language: `Node.js ${process.version.slice(1)}`,
      hostname: os.hostname(),
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      routes: Object.fromEntries(ROUTES.map(([prefix, key]) => [prefix, SERVICES[key].name])),
    },
    services,
    workers: workers.map(w => ({ ...w, ageSeconds: Math.round((Date.now() - new Date(w.lastSeen).getTime()) / 1000) })),
    checkedAt: new Date().toISOString(),
  };
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, content) => {
    if (err) return sendJSON(res, 404, { error: 'Not Found', message: `Fichier introuvable : ${urlPath}` });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const pathname = req.url.split('?')[0];
  try {
    if (pathname === '/health') return sendJSON(res, 200, { status: 'UP' });
    if (pathname === '/api/system/status') return sendJSON(res, 200, await systemStatus());
    const route = ROUTES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
    if (route) return proxy(req, res, route[1], requestId);
    if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'Not Found', message: `Aucun microservice pour ${pathname}` });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    log(`Erreur gateway : ${err.stack || err}`);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Internal Server Error', message: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    log(`gateway v${pkg.version} démarrée sur le port ${PORT}`);
    for (const [prefix, key] of ROUTES) log(`  route ${prefix}/* -> ${SERVICES[key].name} (${SERVICES[key].url})`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      log(`${signal} reçu, arrêt de la gateway`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

module.exports = { server, ROUTES, SERVICES };

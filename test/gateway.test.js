const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let catalog;
let gatewayUrl;
let server;

before(async () => {
  // Faux catalog-service : renvoie le chemin reçu pour vérifier le routage
  catalog = http.createServer((req, res) => {
    if (req.url === '/info') return res.end(JSON.stringify({ service: 'catalog-service' }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url, requestId: req.headers['x-request-id'] }));
  });
  await new Promise(r => catalog.listen(0, r));
  process.env.CATALOG_URL = `http://127.0.0.1:${catalog.address().port}`;
  process.env.ORDERS_URL = 'http://127.0.0.1:1'; // service volontairement injoignable
  ({ server } = require('../src/server'));
  await new Promise(r => server.listen(0, r));
  gatewayUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  catalog.close();
});

test('route /api/products vers catalog-service en retirant /api', async () => {
  const body = await (await fetch(`${gatewayUrl}/api/products?category=Audio`)).json();
  assert.equal(body.path, '/products?category=Audio');
  assert.ok(body.requestId, 'un X-Request-Id doit être propagé');
});

test('un microservice injoignable donne 503 sans faire tomber la gateway', async () => {
  const res = await fetch(`${gatewayUrl}/api/orders`);
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /order-service est indisponible/);
  assert.equal((await fetch(`${gatewayUrl}/health`)).status, 200);
});

test('/api/system/status indique UP et DOWN par microservice', async () => {
  const status = await (await fetch(`${gatewayUrl}/api/system/status`)).json();
  const byName = Object.fromEntries(status.services.map(s => [s.name, s.status]));
  assert.deepEqual(byName, { 'catalog-service': 'UP', 'order-service': 'DOWN' });
});

test('sert l\'interface web et refuse une route API inconnue', async () => {
  const page = await fetch(`${gatewayUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /QuickShop/);
  assert.equal((await fetch(`${gatewayUrl}/api/inconnu`)).status, 404);
});

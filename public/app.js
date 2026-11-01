// QuickShop — interface web servie par la gateway. Tous les appels passent par /api (la gateway route).
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const state = { products: [], categories: [], category: null, q: '', cart: loadCart(), timer: null, lastRender: '' };

// ---------- Utilitaires ----------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body?.message || `Erreur ${res.status}`);
  return body;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return `il y a ${Math.floor(s / 3600)} h`;
}

function duration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${seconds % 60} s` : `${seconds} s`;
}

function errorBox(service, message) {
  return `<div class="error-box"><strong>${esc(service)} ne répond pas</strong><p>${esc(message)}</p>
    <p class="muted">Les autres écrans restent utilisables : c'est l'intérêt des microservices.</p></div>`;
}

function stockBadge(p) {
  if (p.stock === 0) return '<span class="badge danger">Rupture</span>';
  if (p.lowStock) return `<span class="badge warn">Plus que ${p.stock}</span>`;
  return `<span class="badge ok">En stock (${p.stock})</span>`;
}

// ---------- Panier ----------
function loadCart() {
  try {
    return JSON.parse(localStorage.getItem('quickshop-cart')) || {};
  } catch {
    return {};
  }
}

function saveCart() {
  try {
    localStorage.setItem('quickshop-cart', JSON.stringify(state.cart));
  } catch {
    /* stockage indisponible : panier en mémoire */
  }
  const count = Object.values(state.cart).reduce((a, b) => a + b, 0);
  $('#cartCount').textContent = count;
}

function addToCart(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const inCart = state.cart[id] || 0;
  if (inCart >= p.stock) return toast(`Stock maximum atteint pour « ${p.name} »`, 'error');
  state.cart[id] = inCart + 1;
  saveCart();
  toast(`${p.emoji} ${p.name} ajouté au panier`);
}

function openCart(open) {
  document.body.classList.toggle('cart-open', open);
  if (open) renderCart();
}

function renderCart() {
  const lines = Object.entries(state.cart)
    .map(([id, qty]) => ({ p: state.products.find(x => x.id === Number(id)), qty }))
    .filter(l => l.p);
  const body = $('#cartBody');
  if (!lines.length) {
    body.innerHTML = '<div class="empty">Votre panier est vide.<br><a href="#/shop" class="link">Parcourir la boutique</a></div>';
    return;
  }
  const total = lines.reduce((sum, l) => sum + l.p.price * l.qty, 0);
  body.innerHTML = `
    <ul class="cart-lines">
      ${lines.map(({ p, qty }) => `
        <li>
          <span class="cl-emoji">${p.emoji}</span>
          <div class="cl-info"><strong>${esc(p.name)}</strong><span>${eur.format(p.price)}</span></div>
          <div class="qty">
            <button type="button" data-dec="${p.id}">−</button><span>${qty}</span><button type="button" data-inc="${p.id}">+</button>
          </div>
        </li>`).join('')}
    </ul>
    <div class="cart-total"><span>Total</span><strong>${eur.format(total)}</strong></div>
    <form id="checkout" class="checkout">
      <label>Nom complet<input name="name" required placeholder="Ex. Sarah Martin" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required placeholder="sarah@exemple.com" autocomplete="email"></label>
      <button class="btn primary block" type="submit">Commander · ${eur.format(total)}</button>
      <p class="muted small">order-service réservera le stock auprès de catalog-service, puis notification-worker enverra la confirmation.</p>
    </form>`;
}

async function checkout(form) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const items = Object.entries(state.cart).map(([id, quantity]) => ({ productId: Number(id), quantity }));
    const order = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({ customerName: form.name.value, customerEmail: form.email.value, items }),
    });
    state.cart = {};
    saveCart();
    openCart(false);
    toast(`Commande ${order.number} confirmée (${eur.format(order.total)})`);
    location.hash = '#/orders';
  } catch (err) {
    toast(err.message, 'error');
    button.disabled = false;
    try {
      state.products = await api('/products');
      renderCart();
    } catch {
      /* catalogue indisponible */
    }
  }
}

// ---------- Boutique ----------
async function renderShop() {
  view.innerHTML = `
    <section class="hero">
      <div>
        <h1>La boutique tech, propulsée par des microservices</h1>
        <p>Chaque écran de cette application parle à un microservice différent, déployé et mis à l'échelle indépendamment.</p>
      </div>
      <a class="btn ghost-light" href="#/architecture">Voir l'architecture →</a>
    </section>
    <div class="toolbar">
      <input class="search" id="q" placeholder="Rechercher un produit..." value="${esc(state.q)}">
      <div class="chips" id="chips"></div>
    </div>
    <div class="grid" id="grid"><div class="loading">Chargement du catalogue...</div></div>`;
  $('#q').addEventListener('input', e => {
    state.q = e.target.value;
    renderGrid();
  });
  try {
    [state.products, state.categories] = await Promise.all([api('/products'), api('/categories')]);
  } catch (err) {
    $('#grid').innerHTML = errorBox('catalog-service', err.message);
    return;
  }
  renderChips();
  renderGrid();
}

function renderChips() {
  const all = [{ name: null, label: 'Tous', count: state.products.length }, ...state.categories.map(c => ({ name: c.name, label: c.name, count: c.count }))];
  $('#chips').innerHTML = all
    .map(c => `<button type="button" class="chip ${state.category === c.name ? 'active' : ''}" data-cat="${esc(c.name ?? '')}">${esc(c.label)} <span>${c.count}</span></button>`)
    .join('');
}

function renderGrid() {
  const q = state.q.trim().toLowerCase();
  const list = state.products.filter(
    p => (!state.category || p.category === state.category) && (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
  );
  $('#grid').innerHTML = list.length
    ? list
        .map(
          p => `
      <article class="product">
        <div class="p-emoji">${p.emoji}</div>
        <div class="p-body">
          <span class="p-cat">${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <div class="p-foot"><strong class="price">${eur.format(p.price)}</strong>${stockBadge(p)}</div>
          <button type="button" class="btn primary block" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Indisponible' : 'Ajouter au panier'}</button>
        </div>
      </article>`,
        )
        .join('')
    : '<div class="empty">Aucun produit ne correspond.</div>';
}

// ---------- Commandes ----------
async function renderOrders() {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Commandes</h1><p class="muted">Servies par <b>order-service</b> (Go). Les confirmations sont envoyées par <b>notification-worker</b>, sans URL.</p></div>
      <span class="live"><span class="pulse"></span> Actualisation automatique</span>
    </div>
    <div id="orders"><div class="loading">Chargement...</div></div>`;
  state.lastRender = '';
  await refreshOrders();
  state.timer = setInterval(refreshOrders, 3000);
}

async function refreshOrders() {
  const box = $('#orders');
  if (!box) return;
  let orders;
  try {
    orders = await api('/orders');
  } catch (err) {
    box.innerHTML = errorBox('order-service', err.message);
    state.lastRender = '';
    return;
  }
  const html = orders.length
    ? orders.map(orderCard).join('')
    : '<div class="empty">Aucune commande pour l\'instant.<br><a class="link" href="#/shop">Passer une commande</a></div>';
  if (html !== state.lastRender) {
    box.innerHTML = html;
    state.lastRender = html;
  }
}

function orderCard(o) {
  const cancelled = o.status === 'CANCELLED';
  const n = o.notification;
  return `
    <article class="order ${cancelled ? 'cancelled' : ''}">
      <header>
        <div><strong class="order-number">${esc(o.number)}</strong><span class="muted"> · ${new Date(o.createdAt).toLocaleString('fr-FR')}</span></div>
        <span class="badge ${cancelled ? 'danger' : 'ok'}">${cancelled ? 'Annulée' : 'Confirmée'}</span>
      </header>
      <div class="order-body">
        <div>
          <div class="customer">${esc(o.customerName)} <span class="muted">&lt;${esc(o.customerEmail)}&gt;</span></div>
          <ul class="items">${o.items.map(i => `<li>${i.emoji} ${esc(i.name)} × ${i.quantity}<span>${eur.format(i.subtotal)}</span></li>`).join('')}</ul>
        </div>
        <div class="order-side">
          <div class="order-total">${eur.format(o.total)}</div>
          ${cancelled ? '' : `<button type="button" class="btn danger-ghost small" data-cancel="${o.id}">Annuler</button>`}
        </div>
      </div>
      <footer class="notif ${n ? 'sent' : 'pending'}">
        ${n
          ? `📧 Email envoyé par <b>notification-worker</b> (${esc(n.worker)}) ${ago(n.sentAt)}<q>${esc(n.message)}</q>`
          : '<span class="pulse"></span> En attente de notification-worker...'}
      </footer>
    </article>`;
}

// ---------- Inventaire ----------
async function renderInventory() {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Inventaire</h1><p class="muted">Stock géré par <b>catalog-service</b> (Python). Les stocks bas sont signalés par notification-worker dans ses logs.</p></div>
    </div>
    <div class="card" id="inventory"><div class="loading">Chargement...</div></div>`;
  await refreshInventory();
}

async function refreshInventory() {
  try {
    state.products = await api('/products');
  } catch (err) {
    $('#inventory').innerHTML = errorBox('catalog-service', err.message);
    return;
  }
  const max = Math.max(...state.products.map(p => p.stock), 1);
  $('#inventory').innerHTML = `
    <table class="table">
      <thead><tr><th>Produit</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Vendus</th><th>État</th><th></th></tr></thead>
      <tbody>
        ${state.products
          .map(
            p => `
          <tr>
            <td><span class="t-emoji">${p.emoji}</span> ${esc(p.name)}</td>
            <td>${esc(p.category)}</td>
            <td>${eur.format(p.price)}</td>
            <td><div class="stockbar"><div style="width:${Math.round((p.stock / max) * 100)}%" class="${p.stock === 0 ? 'danger' : p.lowStock ? 'warn' : ''}"></div></div><b>${p.stock}</b></td>
            <td>${p.sold}</td>
            <td>${stockBadge(p)}</td>
            <td class="actions"><button type="button" class="btn small" data-restock="${p.id}">+10</button><button type="button" class="btn small ghost" data-empty="${p.id}">Épuiser</button></td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

async function setStock(id, stock) {
  try {
    const p = await api(`/products/${id}/stock`, { method: 'PUT', body: JSON.stringify({ stock }) });
    toast(`${p.emoji} ${p.name} : stock = ${p.stock}`);
    await refreshInventory();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Architecture ----------
async function renderArchitecture() {
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Architecture microservices</h1><p class="muted">État en direct de chaque composant, vu par la gateway.</p></div>
      <span class="live"><span class="pulse"></span> Actualisation toutes les 4 s</span>
    </div>
    <div id="arch"><div class="loading">Interrogation des microservices...</div></div>`;
  state.lastRender = '';
  await refreshArchitecture();
  state.timer = setInterval(refreshArchitecture, 4000);
}

function node({ title, role, roleClass, language, status, lines }) {
  const cls = status === 'UP' || status === 'ACTIF' ? 'up' : status === '—' ? '' : 'down';
  return `
    <div class="node ${cls}">
      <div class="node-head"><span class="dot"></span><strong>${esc(title)}</strong><span class="role ${roleClass}">${esc(role)}</span></div>
      <div class="node-lang">${esc(language)}</div>
      <dl>${lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="node-status">${esc(status)}</div>
    </div>`;
}

async function refreshArchitecture() {
  const box = $('#arch');
  if (!box) return;
  let s;
  try {
    const res = await fetch('/api/system/status');
    s = await res.json();
  } catch (err) {
    box.innerHTML = errorBox('gateway', err.message);
    return;
  }
  const svc = Object.fromEntries(s.services.map(x => [x.key, x]));
  const cat = svc.catalog;
  const ord = svc.orders;
  const worker = s.workers[0];
  const workerActive = worker && worker.ageSeconds <= 20;

  const catalogLines = cat.status === 'UP'
    ? [['Hôte', cat.info.hostname], ['Latence', `${cat.latencyMs} ms`], ['Uptime', duration(cat.info.uptimeSeconds)], ['Produits', cat.info.products], ['Unités en stock', cat.info.unitsInStock], ['Stocks bas', cat.info.lowStockProducts]]
    : [['URL interne', cat.url], ['Erreur', cat.error]];
  const orderLines = ord.status === 'UP'
    ? [['Hôte', ord.info.hostname], ['Latence', `${ord.latencyMs} ms`], ['Uptime', duration(ord.info.uptimeSeconds)], ['Commandes', ord.info.stats.orders], ['Chiffre d\'affaires', eur.format(ord.info.stats.revenue)], ['Notifications en attente', ord.info.stats.pendingNotifications]]
    : [['URL interne', ord.url], ['Erreur', ord.error]];
  const workerLines = worker
    ? [['Hôte', worker.hostname], ['Dernier signal', ago(worker.lastSeen)], ['Emails envoyés', worker.processed], ['Alertes stock bas', worker.lowStockCount]]
    : [['Signal', ord.status === 'UP' ? 'aucun pour l\'instant' : 'inconnu (order-service DOWN)']];

  const html = `
    <div class="arch">
      <div class="tier"><div class="client">🌐 Navigateur</div></div>
      <div class="link-v"><span>HTTPS · seule entrée publique</span></div>
      <div class="tier">${node({
        title: 'gateway', role: 'Public', roleClass: 'public', language: s.gateway.language, status: 'UP',
        lines: [['Hôte', s.gateway.hostname], ['Uptime', duration(s.gateway.uptimeSeconds)], ['Routes', Object.keys(s.gateway.routes).length]],
      })}</div>
      <div class="link-v"><span>HTTP interne (DNS)</span></div>
      <div class="tier two">
        ${node({ title: 'catalog-service', role: 'Interne', roleClass: 'internal', language: cat.info?.language || 'Python · FastAPI', status: cat.status, lines: catalogLines })}
        ${node({ title: 'order-service', role: 'Interne', roleClass: 'internal', language: ord.info?.language || 'Go', status: ord.status, lines: orderLines })}
      </div>
      <div class="link-v up"><span>appels sortants du worker (aucune entrée)</span></div>
      <div class="tier">${node({
        title: 'notification-worker', role: 'Worker · sans URL', roleClass: 'worker', language: 'Python', status: worker ? (workerActive ? 'ACTIF' : 'SILENCIEUX') : '—', lines: workerLines,
      })}</div>
    </div>
    <div class="card routes">
      <h2>Table de routage de la gateway</h2>
      <table class="table">
        <thead><tr><th>Chemin public</th><th>Microservice</th><th>URL interne</th></tr></thead>
        <tbody>${Object.entries(s.gateway.routes).map(([prefix, name]) => `<tr><td><code>${esc(prefix)}/*</code></td><td>${esc(name)}</td><td><code>${esc(s.services.find(x => x.name === name)?.url)}</code></td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  if (html !== state.lastRender) {
    box.innerHTML = html;
    state.lastRender = html;
  }
}

// ---------- Routeur & événements ----------
const pages = { shop: renderShop, orders: renderOrders, inventory: renderInventory, architecture: renderArchitecture };

function route() {
  clearInterval(state.timer);
  const page = (location.hash.replace('#/', '') || 'shop').split('?')[0];
  const render = pages[page] || renderShop;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.page === (pages[page] ? page : 'shop')));
  render();
}

document.addEventListener('click', e => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.add) addToCart(Number(t.dataset.add));
  else if (t.dataset.cat !== undefined && t.classList.contains('chip')) {
    state.category = t.dataset.cat || null;
    renderChips();
    renderGrid();
  } else if (t.dataset.inc || t.dataset.dec) {
    const id = Number(t.dataset.inc || t.dataset.dec);
    const p = state.products.find(x => x.id === id);
    const next = (state.cart[id] || 0) + (t.dataset.inc ? 1 : -1);
    if (t.dataset.inc && p && next > p.stock) return toast('Stock maximum atteint', 'error');
    if (next <= 0) delete state.cart[id];
    else state.cart[id] = next;
    saveCart();
    renderCart();
  } else if (t.dataset.cancel) {
    api(`/orders/${t.dataset.cancel}/cancel`, { method: 'POST' })
      .then(o => {
        toast(`Commande ${o.number} annulée, stock remis au catalogue`);
        refreshOrders();
      })
      .catch(err => toast(err.message, 'error'));
  } else if (t.dataset.restock) {
    const p = state.products.find(x => x.id === Number(t.dataset.restock));
    if (p) setStock(p.id, p.stock + 10);
  } else if (t.dataset.empty) {
    setStock(Number(t.dataset.empty), 0);
  } else if (t.id === 'cartBtn') openCart(true);
  else if (t.id === 'closeCart') openCart(false);
  else if (t.closest('.drawer') && t.matches('a')) openCart(false);
});

document.addEventListener('submit', e => {
  if (e.target.id === 'checkout') {
    e.preventDefault();
    checkout(e.target);
  }
});

$('#overlay').addEventListener('click', () => openCart(false));
document.addEventListener('keydown', e => e.key === 'Escape' && openCart(false));
window.addEventListener('hashchange', route);

saveCart();
route();
// Le panier a besoin des produits même si on arrive sur une autre page
api('/products').then(p => (state.products = p)).catch(() => {});

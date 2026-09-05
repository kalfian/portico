"use strict";
/* ============================================================
   Home Server Topology & Port Manager — Fase 2d served frontend
   Backed by the REST API (Express + SQLite). No localStorage for
   topology data; server session is the source of truth for auth.
   ============================================================ */

/* respect the OS "reduce motion" setting — gates JS-driven animation */
const REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= API LAYER =================
   Every mutation goes through here. Errors carry { code, message } from the
   server's { error: { code, message } } envelope so the UI can surface them. */
async function apiFetch(path, opts = {}) {
  const init = Object.assign({ credentials: 'same-origin' }, opts);
  if (opts.body !== undefined) {
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  }
  const res = await fetch(path, init);
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
  if (!res.ok) {
    const info = (data && data.error) || {};
    const err = new Error(info.message || ('Request failed (' + res.status + ')'));
    err.code = info.code || 'error';
    err.status = res.status;
    throw err;
  }
  return data;
}
const enc = encodeURIComponent;
const api = {
  status: () => apiFetch('/api/auth/status'),
  setup: (password) => apiFetch('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  login: (password) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) => apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  topology: () => apiFetch('/api/topology'),
  exportAll: () => apiFetch('/api/export'),
  importAll: (payload) => apiFetch('/api/import', { method: 'POST', body: JSON.stringify(payload) }),
  createNode: (b) => apiFetch('/api/nodes', { method: 'POST', body: JSON.stringify(b) }),
  updateNode: (id, b) => apiFetch('/api/nodes/' + enc(id), { method: 'PUT', body: JSON.stringify(b) }),
  deleteNode: (id) => apiFetch('/api/nodes/' + enc(id), { method: 'DELETE' }),
  createPort: (nodeId, b) => apiFetch('/api/nodes/' + enc(nodeId) + '/ports', { method: 'POST', body: JSON.stringify(b) }),
  updatePort: (id, b) => apiFetch('/api/ports/' + enc(id), { method: 'PUT', body: JSON.stringify(b) }),
  deletePort: (id) => apiFetch('/api/ports/' + enc(id), { method: 'DELETE' }),
  createNetwork: (b) => apiFetch('/api/networks', { method: 'POST', body: JSON.stringify(b) }),
  updateNetwork: (id, b) => apiFetch('/api/networks/' + enc(id), { method: 'PUT', body: JSON.stringify(b) }),
  deleteNetwork: (id) => apiFetch('/api/networks/' + enc(id), { method: 'DELETE' }),
  createLink: (b) => apiFetch('/api/links', { method: 'POST', body: JSON.stringify(b) }),
  updateLink: (id, b) => apiFetch('/api/links/' + enc(id), { method: 'PUT', body: JSON.stringify(b) }),
  deleteLink: (id) => apiFetch('/api/links/' + enc(id), { method: 'DELETE' }),
  listTokens: () => apiFetch('/api/tokens'),
  createToken: (name, scope) => apiFetch('/api/tokens', { method: 'POST', body: JSON.stringify({ name, scope }) }),
  revokeToken: (id) => apiFetch('/api/tokens/' + enc(id), { method: 'DELETE' }),
  // health check (probe): sets node.status + last_seen, never port.status
  probeAll: (nodeIds) => apiFetch('/api/probe', { method: 'POST', body: JSON.stringify(nodeIds && nodeIds.length ? { nodeIds } : {}) }),
  probeNode: (id) => apiFetch('/api/nodes/' + enc(id) + '/probe', { method: 'POST', body: JSON.stringify({}) }),
  // import from source: parse (dry-run) → apply (additive, de-duped)
  importParse: (source, text) => apiFetch('/api/import/parse', { method: 'POST', body: JSON.stringify({ source, text }) }),
  importApply: (payload) => apiFetch('/api/import/apply', { method: 'POST', body: JSON.stringify(payload) }),
};

/* ================= AUTH (server session) =================
   Read-only by default; a logged-in session (cookie) enables editing. The
   server is authoritative — client guards are just UX. */
let authState = { isSetup: false, isAuthenticated: false, authMethod: null, scope: null };
const canEdit = () => !!authState.isAuthenticated;
async function refreshAuthStatus() {
  try { authState = await api.status(); } catch (e) { /* keep defaults on failure */ }
  return authState;
}
async function lockEdit() {
  try { await api.logout(); } catch (e) { /* ignore */ }
  await refreshAuthStatus();
  applyLockState();
  toast('Locked — read-only', 'ok');
}
function applyLockState() {
  document.body.classList.toggle('locked', !canEdit());
  updateAuthBadge();
  if (typeof network !== 'undefined' && network) network.setOptions({ interaction: { dragNodes: canEdit() } });
  if (typeof renderDetail === 'function') renderDetail();   // re-render edit/delete affordances
}
function updateAuthBadge() {
  const btn = document.getElementById('btnAuth'); if (!btn) return;
  const on = canEdit();
  btn.classList.toggle('is-unlocked', on);
  btn.querySelector('.auth-badge__label').textContent = on ? 'Editing' : 'Read-only';
  btn.setAttribute('title', on ? 'Unlocked — click to lock (read-only)' : 'Read-only — click to log in and edit');
  btn.setAttribute('aria-label', on ? 'Lock editing' : 'Log in to edit');
  btn.querySelector('.auth-badge__icon').innerHTML = on
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
}
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

/* ---- node type metadata (label + palette, single source) ---- */
const TYPES = {
  physical:       { label: 'Physical',   color: '#7c8aa0', level: 0 },
  proxmox_host:   { label: 'Proxmox',    color: '#f0883e', level: 0 },
  docker_host:    { label: 'Docker host',color: '#2496ed', level: 0 },
  network_device: { label: 'Network',    color: '#a78bfa', level: 0 },
  iot:            { label: 'IoT',        color: '#4ade80', level: 0 },
  vm:             { label: 'VM',         color: '#4f9dff', level: 1 },
  lxc:            { label: 'LXC',        color: '#2dd4bf', level: 1 },
  container:      { label: 'Container',  color: '#7cc4fb', level: 1 },
};
const TYPE_ORDER = ['physical','proxmox_host','vm','lxc','docker_host','container','network_device','iot'];

/* ---- id helper (client-side sample seed only; server assigns ids on create) ---- */
const uid = (p='id') => p + '-' + Math.random().toString(36).slice(2, 9);
const nodeById = (id) => state.nodes.find(n => n.id === id);

/* ---- exposure enum metadata (single source) ---- */
const EXPOSURE = {
  internal: { label: 'internal', cls: 'tag--internal', tip: 'Not published — reachable only on this host' },
  lan:      { label: 'lan',      cls: 'tag--lan',      tip: 'Reachable on the local network / LAN' },
  public:   { label: 'public',   cls: 'tag--exposed',  tip: 'Reachable from the internet' },
};
const EXP_ORDER = ['internal', 'lan', 'public'];

/* ---- typed relationship links (non-containment) ---- */
const LINK_TYPES = {
  proxy:  { label: 'Proxy',  color: '#f0883e', dash: [6, 4] },
  mount:  { label: 'Mount',  color: '#a78bfa', dash: [2, 4] },
  dns:    { label: 'DNS',    color: '#2dd4bf', dash: [9, 4] },
  custom: { label: 'Custom', color: '#8aa0b8', dash: [4, 4] },
};
const LINK_ORDER = ['proxy', 'mount', 'dns', 'custom'];
/* palette offered when creating a network */
const NET_COLORS = ['#22d3ee', '#a3e635', '#f59e0b', '#f472b6', '#60a5fa', '#c084fc', '#34d399', '#fb7185'];
const nwById = (id) => state.networks.find(x => x.id === id);

/* ---- IPv4 math (free-IP finder + network membership) ---- */
function ipToInt(ip) {
  const m = (ip || '').trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return null;
  return (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
}
function intToIp(n) { n = n >>> 0; return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
function parseCidr(cidr) {
  const m = (cidr || '').trim().match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) return null;
  const base = ipToInt(m[1]); const prefix = parseInt(m[2]);
  if (base == null || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (base & mask) >>> 0, prefix, mask };
}
function ipInCidr(ip, c) { const v = ipToInt(ip); return v != null && c && ((v & c.mask) >>> 0) === c.base; }

/* ---- built-in device icons (inner SVG on a 0..24 box; wrapped + tinted per node) ---- */
const BUILTIN_ICONS = {
  server:     { label: 'Server',   svg: `<rect x='3' y='4' width='18' height='7' rx='1.5'/><rect x='3' y='13' width='18' height='7' rx='1.5'/><line x1='7' y1='7.5' x2='7.01' y2='7.5'/><line x1='7' y1='16.5' x2='7.01' y2='16.5'/>` },
  hypervisor: { label: 'Hypervisor', svg: `<path d='M12 2 2 7l10 5 10-5-10-5Z'/><path d='M2 12l10 5 10-5'/><path d='M2 17l10 5 10-5'/>` },
  vm:         { label: 'VM',       svg: `<rect x='2' y='3' width='20' height='14' rx='2'/><line x1='8' y1='21' x2='16' y2='21'/><line x1='12' y1='17' x2='12' y2='21'/>` },
  container:  { label: 'Container', svg: `<path d='M21 8 12 3 3 8v8l9 5 9-5V8Z'/><path d='M3 8l9 5 9-5'/><line x1='12' y1='13' x2='12' y2='21'/>` },
  router:     { label: 'Router',   svg: `<rect x='2' y='13' width='20' height='8' rx='2'/><line x1='6' y1='17' x2='6.01' y2='17'/><line x1='10' y1='17' x2='10.01' y2='17'/><path d='M8 9a6 6 0 0 1 8 0'/><path d='M5.5 6.5a10 10 0 0 1 13 0'/>` },
  wifi:       { label: 'Wi-Fi AP', svg: `<path d='M5 12.5a10 10 0 0 1 14 0'/><path d='M8.5 16a5 5 0 0 1 7 0'/><line x1='12' y1='19.5' x2='12.01' y2='19.5'/>` },
  storage:    { label: 'Storage',  svg: `<ellipse cx='12' cy='5' rx='8' ry='3'/><path d='M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5'/><path d='M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'/>` },
  chip:       { label: 'IoT / chip', svg: `<rect x='6' y='6' width='12' height='12' rx='2'/><rect x='9' y='9' width='6' height='6'/><path d='M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2'/>` },
  host:       { label: 'Generic',  svg: `<rect x='6' y='2' width='12' height='20' rx='2'/><line x1='9' y1='6' x2='15' y2='6'/><line x1='9' y1='10' x2='15' y2='10'/><circle cx='12' cy='16' r='1.5'/>` },
};
const BUILTIN_ORDER = ['server', 'hypervisor', 'vm', 'container', 'router', 'wifi', 'storage', 'chip', 'host'];
const TYPE_ICON = { physical: 'server', proxmox_host: 'hypervisor', docker_host: 'container', vm: 'vm', lxc: 'container', container: 'container', network_device: 'router', iot: 'chip' };
const defaultIconForType = (type) => TYPE_ICON[type] || 'host';
/* built-in icon → high-contrast dark glyph on transparent (sits on the node's light chip). */
function builtinDataUri(key) {
  const ic = BUILTIN_ICONS[key] || BUILTIN_ICONS.host;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><g transform='translate(12 12)' fill='none' stroke='#1f2b3a' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'>${ic.svg}</g></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---- selfh.st icons — served through the backend caching proxy (air-gap friendly) ---- */
const selfhstUrl = (slug) => '/api/icons/' + encodeURIComponent(String(slug).trim().toLowerCase());
/* curated homelab quick-picks (slug → label) */
const SELFHST_QUICK = [
  ['proxmox', 'Proxmox'], ['docker', 'Docker'], ['jellyfin', 'Jellyfin'], ['traefik', 'Traefik'],
  ['adguard-home', 'AdGuard Home'], ['truenas-scale', 'TrueNAS'], ['mikrotik', 'MikroTik'], ['home-assistant', 'Home Assistant'],
  ['esphome', 'ESPHome'], ['portainer', 'Portainer'], ['nginx-proxy-manager', 'NPM'], ['ubiquiti-unifi', 'UniFi'],
  ['pi-hole', 'Pi-hole'], ['grafana', 'Grafana'], ['nextcloud', 'Nextcloud'], ['linuxserver-io', 'Linux'],
];
/* node type → sensible default selfh.st slug (prefill when switching to App mode) */
const TYPE_SELFHST = { proxmox_host: 'proxmox', docker_host: 'docker', vm: 'linux', lxc: 'linux', container: 'docker', network_device: 'mikrotik', iot: 'esphome', physical: 'linux' };
const defaultSlugForType = (type) => TYPE_SELFHST[type] || 'linux';
/* lazy index for search autocomplete (via the /api/icons proxy; degrades gracefully offline) */
let _selfhstIndex = null, _selfhstLoading = null;
function loadSelfhstIndex() {
  if (_selfhstIndex) return Promise.resolve(_selfhstIndex);
  if (_selfhstLoading) return _selfhstLoading;
  _selfhstLoading = fetch('/api/icons', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(list => { _selfhstIndex = (list || []).map(x => ({ name: x.Name, slug: x.Reference })).filter(x => x.slug); return _selfhstIndex; })
    .catch(() => { _selfhstIndex = []; return _selfhstIndex; });   // offline → search falls back to free-text slug
  return _selfhstLoading;
}

/* resolve a node's image src. Custom icon (selfhst/url/upload/builtin) wins; otherwise
   fall back to the built-in icon for the node's type so every node shows something. */
function nodeImageSrc(n) {
  if (n.iconType === 'selfhst' && n.iconValue) return selfhstUrl(n.iconValue);
  if ((n.iconType === 'url' || n.iconType === 'upload') && n.iconValue) return n.iconValue;
  if (n.iconType === 'builtin') return builtinDataUri(n.iconValue || defaultIconForType(n.type));
  return builtinDataUri(defaultIconForType(n.type));
}
/* read an uploaded image → downscale to maxDim via canvas → data URL */
function downscaleImage(file, maxDim, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      let out;
      try { out = cv.toDataURL('image/png'); if (out.length > 200000) out = cv.toDataURL('image/jpeg', 0.82); }
      catch (e) { out = null; }   // tainted canvas (cross-origin) etc.
      cb(out);
    };
    img.onerror = () => cb(null);
    img.src = reader.result;
  };
  reader.onerror = () => cb(null);
  reader.readAsDataURL(file);
}

/* default scheme: https for 443/8443 or when a public domain is set, else http */
function inferScheme(p) {
  if (p.domain) return 'https';
  if (p.portNumber === 443 || p.portNumber === 8443) return 'https';
  return 'http';
}
/* migrate a port record to the current schema (idempotent) — used by the client sample seed */
function normalizePort(p) {
  if (p.exposure === undefined) {
    if (p.exposed === true) p.exposure = p.domain ? 'public' : 'lan';
    else p.exposure = 'internal';
  }
  if (!EXP_ORDER.includes(p.exposure)) p.exposure = 'internal';
  if (typeof p.domain !== 'string') p.domain = '';
  if (p.domain && p.exposure !== 'public') p.exposure = 'public';
  delete p.exposed;
  if (p.hostPort === undefined) p.hostPort = null;
  if (p.targetNodeId === undefined) p.targetNodeId = null;
  if (!['http', 'https'].includes(p.scheme)) p.scheme = inferScheme(p);
  return p;
}
function normalizeState(d) {
  if (!Array.isArray(d.networks)) d.networks = [];
  if (!Array.isArray(d.links)) d.links = [];
  (d.nodes || []).forEach(n => {
    if (!Array.isArray(n.tags)) n.tags = [];
    if (n.networkId === undefined) n.networkId = null;
    if (!['selfhst', 'builtin', 'url', 'upload'].includes(n.iconType)) n.iconType = '';
    if (typeof n.iconValue !== 'string') n.iconValue = '';
  });
  (d.ports || []).forEach(normalizePort);
  d.networks.forEach(nw => { if (nw.vlanId === undefined) nw.vlanId = null; if (!nw.color) nw.color = NET_COLORS[0]; });
  d.links.forEach(lk => { if (!LINK_TYPES[lk.type]) lk.type = 'custom'; if (typeof lk.label !== 'string') lk.label = ''; });
  return d;
}

/* ================= SAMPLE SEED (client-side; used by "Reset to sample data" via /api/import) ================= */
function seedData() {
  const dialga   = 'n-dialga', vm1 = 'n-vm1', lxc1 = 'n-lxc1';
  const dhost    = 'n-dhost',  c1  = 'n-c1',  c2   = 'n-c2';
  const mikrotik = 'n-mtk', ap = 'n-ap', iot = 'n-iot';
  const nodes = [
    { id: mikrotik, name: 'mikrotik', type: 'network_device', parentId: null, ipAddress: '10.20.30.1', macAddress: '48:8F:5A:11:22:33', os: 'RouterOS 7.14', role: 'Gateway / DHCP / firewall', status: 'up', tags: ['network', 'core', 'gateway'], notes: 'Core router. VLANs: 30 servers, 40 iot.', posX: 0, posY: -260 },
    { id: ap,       name: 'access-point', type: 'network_device', parentId: mikrotik, ipAddress: '10.20.30.2', macAddress: '48:8F:5A:44:55:66', os: 'RouterOS (cAP)', role: 'Wi-Fi AP', status: 'up', tags: ['network', 'wifi'], notes: '', posX: -300, posY: -110 },
    { id: iot,      name: 'esp-hub', type: 'iot', parentId: ap, ipAddress: '10.20.40.50', macAddress: 'A4:CF:12:AA:BB:CC', os: 'ESPHome', role: 'Sensor bridge (MQTT)', status: 'unknown', tags: ['iot', 'sensors', 'mqtt'], notes: 'Temp/humidity + relays. On IoT VLAN.', posX: -300, posY: 60 },
    { id: dialga,   name: 'dialga', type: 'proxmox_host', parentId: mikrotik, ipAddress: '10.20.30.10', macAddress: 'AC:1F:6B:00:11:22', os: 'Proxmox VE 8.2', role: 'Hypervisor', status: 'up', tags: ['hypervisor', 'core', 'proxmox'], notes: 'Primary Proxmox host. 64GB RAM, ZFS mirror.', posX: 60, posY: -90 },
    { id: vm1,      name: 'vm-truenas', type: 'vm', parentId: dialga, ipAddress: '10.20.30.21', macAddress: '52:54:00:AA:00:21', os: 'TrueNAS SCALE', role: 'NAS / storage', status: 'up', tags: ['storage', 'nas', 'backup'], notes: 'Passthrough HBA. SMB + NFS shares.', posX: -40, posY: 90 },
    { id: lxc1,     name: 'lxc-adguard', type: 'lxc', parentId: dialga, ipAddress: '10.20.30.22', macAddress: '52:54:00:AA:00:22', os: 'Debian 12 (LXC)', role: 'DNS sinkhole', status: 'up', tags: ['dns', 'adblock'], notes: 'AdGuard Home, unprivileged container.', posX: 160, posY: 90 },
    { id: dhost,    name: 'docker-host', type: 'docker_host', parentId: mikrotik, ipAddress: '10.20.30.30', macAddress: 'DC:A6:32:00:33:44', os: 'Ubuntu 24.04 LTS', role: 'Container host (Docker)', status: 'up', tags: ['docker', 'public', 'apps'], notes: 'Compose stacks. Traefik fronts web apps.', posX: 360, posY: -90 },
    { id: c1,       name: 'traefik', type: 'container', parentId: dhost, ipAddress: '172.18.0.2', macAddress: '', os: 'Docker image', role: 'Reverse proxy', status: 'up', tags: ['public', 'proxy', 'tls'], notes: 'Publishes 80/443, dashboard on 8080.', posX: 300, posY: 90 },
    { id: c2,       name: 'jellyfin', type: 'container', parentId: dhost, ipAddress: '172.18.0.3', macAddress: '', os: 'Docker image', role: 'Media server', status: 'up', tags: ['media', 'public'], notes: 'Behind Traefik. iGPU transcode.', posX: 460, posY: 90 },
  ];
  const iconMap = { [mikrotik]: 'mikrotik', [ap]: 'ubiquiti-unifi', [iot]: 'esphome', [dialga]: 'proxmox', [vm1]: 'truenas-scale', [lxc1]: 'adguard-home', [dhost]: 'docker', [c1]: 'traefik', [c2]: 'jellyfin' };
  nodes.forEach(n => { n.iconType = 'selfhst'; n.iconValue = iconMap[n.id] || defaultSlugForType(n.type); });
  const P = (nodeId, portNumber, protocol, serviceName, description, exposed, status='in_use', domain='') =>
    ({ id: uid('p'), nodeId, portNumber, protocol, serviceName, description, exposed, status, domain });
  const ports = [
    P(mikrotik, 22, 'tcp', 'ssh', 'Admin SSH', false),
    P(mikrotik, 8291, 'tcp', 'winbox', 'Winbox management', false),
    P(mikrotik, 53, 'udp', 'dns', 'Local resolver', false),
    P(mikrotik, 443, 'tcp', 'webfig', 'Web admin', false, 'reserved'),
    P(ap, 22, 'tcp', 'ssh', 'Admin SSH', false),
    P(iot, 6053, 'tcp', 'esphome-api', 'Native API', false),
    P(iot, 1883, 'tcp', 'mqtt', 'Broker publish', false),
    P(dialga, 22, 'tcp', 'ssh', 'Host SSH', false),
    P(dialga, 8006, 'tcp', 'proxmox-web', 'PVE web UI', true, 'in_use', 'pve.example.com'),
    P(dialga, 3128, 'tcp', 'spice-proxy', 'Console proxy', false),
    P(vm1, 22, 'tcp', 'ssh', 'Shell', false),
    P(vm1, 443, 'tcp', 'truenas-ui', 'Web UI', false),
    P(vm1, 445, 'tcp', 'smb', 'File shares', false),
    P(vm1, 2049, 'tcp', 'nfs', 'NFS export', false),
    P(lxc1, 22, 'tcp', 'ssh', 'Shell', false),
    P(lxc1, 53, 'udp', 'dns', 'DNS sinkhole', false),
    P(lxc1, 3000, 'tcp', 'adguard-ui', 'Admin UI', true, 'in_use', 'dns.example.com'),
    P(dhost, 22, 'tcp', 'ssh', 'Host SSH', false),
    P(dhost, 80, 'tcp', 'http', 'Traefik entrypoint', true),
    P(dhost, 443, 'tcp', 'https', 'Traefik entrypoint', true),
    P(dhost, 8080, 'tcp', 'traefik-dash', 'Traefik dashboard', true, 'in_use', 'traefik.example.com'),
    P(c1, 80, 'tcp', 'web', 'HTTP in', true),
    P(c1, 443, 'tcp', 'websecure', 'HTTPS in', true),
    P(c2, 8096, 'tcp', 'jellyfin-http', 'Web player', true, 'in_use', 'jelly.example.com'),
    P(c2, 8920, 'tcp', 'jellyfin-https', 'Web player (TLS)', false, 'reserved'),
  ];
  const setMap = (nodeId, portNumber, extra) => { const pp = ports.find(x => x.nodeId === nodeId && x.portNumber === portNumber); if (pp) Object.assign(pp, extra); };
  setMap(dhost, 80, { hostPort: 80, targetNodeId: c1, scheme: 'http' });
  setMap(dhost, 443, { hostPort: 443, targetNodeId: c1, scheme: 'https' });
  const networks = [
    { id: 'nw-srv', name: 'servers', cidr: '10.20.30.0/24', vlanId: 30, color: '#22d3ee' },
    { id: 'nw-iot', name: 'iot',     cidr: '10.20.40.0/24', vlanId: 40, color: '#a3e635' },
    { id: 'nw-dkr', name: 'docker',  cidr: '172.18.0.0/16', vlanId: null, color: '#f59e0b' },
  ];
  nodes.forEach(n => { const nw = networks.find(w => ipInCidr(n.ipAddress, parseCidr(w.cidr))); n.networkId = nw ? nw.id : null; });
  const links = [
    { id: 'lk-proxy', fromNodeId: c1, toNodeId: c2, type: 'proxy', label: ':8096' },
    { id: 'lk-mount', fromNodeId: c2, toNodeId: vm1, type: 'mount', label: '/media' },
    { id: 'lk-dns1', fromNodeId: dhost, toNodeId: lxc1, type: 'dns', label: '' },
    { id: 'lk-dns2', fromNodeId: dialga, toNodeId: lxc1, type: 'dns', label: '' },
  ];
  return normalizeState({ nodes, ports, networks, links });
}

/* ================= STATE ================= */
let state = { nodes: [], ports: [], networks: [], links: [] };
let selectedId = null;
let portFilter = { proto: 'all', q: '' };
let freeRange = { from: 8000, to: 9000, proto: 'tcp' };

/* view + node-table UI prefs (persisted like the other localStorage prefs) */
let currentView = (localStorage.getItem('hst-view') === 'table') ? 'table' : 'graph';
let tableQ = '';
let tableSort = (() => {
  try { const s = JSON.parse(localStorage.getItem('hst-table-sort') || ''); if (s && s.key) return { key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' }; } catch (e) {}
  return { key: 'name', dir: 'asc' };
})();

/* replace-in-place helpers for surgical local state updates after a mutation */
function replaceNode(n) { const i = state.nodes.findIndex(x => x.id === n.id); if (i >= 0) state.nodes[i] = n; else state.nodes.push(n); }
function replacePort(p) { const i = state.ports.findIndex(x => x.id === p.id); if (i >= 0) state.ports[i] = p; else state.ports.push(p); }
function replaceNetwork(w) { const i = state.networks.findIndex(x => x.id === w.id); if (i >= 0) state.networks[i] = w; else state.networks.push(w); }
function replaceLink(l) { const i = state.links.findIndex(x => x.id === l.id); if (i >= 0) state.links[i] = l; else state.links.push(l); }

/* refetch the whole topology (used after cascading server mutations: node/network delete, import, reset) */
async function reloadState() {
  const topo = await api.topology();
  state = { nodes: topo.nodes || [], ports: topo.ports || [], networks: topo.networks || [], links: topo.links || [] };
}

/* debounced position persistence for node drags */
const _posSaveTimers = {};
function saveNodePosition(id) {
  clearTimeout(_posSaveTimers[id]);
  _posSaveTimers[id] = setTimeout(() => {
    const n = nodeById(id); if (!n) return;
    api.updateNode(id, { posX: n.posX, posY: n.posY }).catch(e => toast('Could not save position: ' + e.message, 'err'));
  }, 500);
}

/* ================= GRAPH ================= */
let network, nodesDS, edgesDS;
let colorBy = 'type';                                   // 'type' | 'network'
const edgeToggles = { containment: true, proxy: true, mount: true, dns: true, custom: true };
let focusSet = null;                                     // node ids emphasised in selection focus-mode

/* node colour depends on the active "colour by" mode */
function nodeColor(n) {
  if (colorBy === 'network') { const nw = n.networkId ? nwById(n.networkId) : null; return nw ? nw.color : '#5a6472'; }
  return (TYPES[n.type] || { color: '#7c8aa0' }).color;
}
/* selected node + its direct neighbours (containment parent/children + link endpoints) */
function relatedIds(id) {
  const s = new Set([id]);
  const n = nodeById(id);
  if (n && n.parentId) s.add(n.parentId);
  state.nodes.forEach(x => { if (x.parentId === id) s.add(x.id); });
  state.links.forEach(l => { if (l.fromNodeId === id) s.add(l.toNodeId); if (l.toNodeId === id) s.add(l.fromNodeId); });
  return s;
}
const isDimmed = (id) => focusSet && selectedId && !focusSet.has(id);

function nodeVis(n) {
  const t = TYPES[n.type] || { color: '#7c8aa0', level: 0 };
  const dim = n.status === 'down';
  const isHost = (t.level || 0) === 0;
  const col = nodeColor(n);
  const border = col;
  const bg = mix(col, '#0b0e14', dim ? 0.88 : 0.82);
  const ip = (n.ipAddress || '').trim();
  const inUse = portsFor(n.id).filter(p => p.status === 'in_use').sort((a, b) => a.portNumber - b.portNumber);
  const portsLine = inUse.length
    ? inUse.slice(0, 4).map(p => ':' + p.portNumber).join(' ') + (inUse.length > 4 ? ' +' + (inUse.length - 4) : '')
    : '';
  const lines = [n.name];
  if (ip) lines.push('`' + ip + '`');
  if (portsLine) lines.push('`' + portsLine + '`');
  const label = lines.join('\n');
  const base = {
    id: n.id,
    label,
    x: n.posX, y: n.posY,
    borderWidth: isHost ? 1.6 : 1.2,
    borderWidthSelected: 3,
    font: {
      color: dim ? '#8892a3' : '#eef2f7',
      face: 'Inter, sans-serif',
      size: isHost ? 15 : 14,
      multi: 'md',
      bold: { color: dim ? '#8892a3' : '#f2f5f9' },
      mono: { size: 11, color: dim ? '#78849a' : mix(col, '#ffffff', 0.42), face: 'SFMono-Regular, monospace', vadjust: 1 },
    },
    shadow: { enabled: true, color: dim ? 'rgba(0,0,0,.4)' : rgba(col, isHost ? 0.32 : 0.24), size: isHost ? 20 : 12, x: 0, y: isHost ? 7 : 4 },
    opacity: isDimmed(n.id) ? 0.2 : (dim ? 0.85 : 1),
  };
  const src = nodeImageSrc(n);
  if (src) {
    const ring = dim ? mix(border, '#0b0e14', 0.5) : border;
    return Object.assign(base, {
      shape: 'circularImage',
      image: src,
      brokenImage: builtinDataUri(defaultIconForType(n.type)),
      size: isHost ? 27 : 23,
      color: { background: '#eef2f7', border: ring, highlight: { background: '#f8fafc', border: ring }, hover: { background: '#f8fafc', border: ring } },
      shapeProperties: { useBorderWithImage: true, interpolation: true },
      imagePadding: { top: 7, right: 7, bottom: 7, left: 7 },
    });
  }
  return Object.assign(base, {
    shape: 'box',
    color: {
      background: bg,
      border: dim ? mix(border, '#0b0e14', 0.5) : border,
      highlight: { background: mix(col, '#0b0e14', 0.66), border: border },
      hover: { background: mix(col, '#0b0e14', 0.72), border: border },
    },
    margin: { top: isHost ? 11 : 9, bottom: isHost ? 11 : 9, left: 15, right: 15 },
    shapeProperties: { borderRadius: 9 },
  });
}
function edgeVis(n) {
  const child = TYPES[n.type] || { color: '#39424f' };
  const parent = state.nodes.find(x => x.id === n.parentId);
  const isNet = parent && parent.type === 'network_device';
  const col = mix(child.color, '#0b0e14', 0.46);
  const incident = !(focusSet && selectedId) || n.parentId === selectedId || n.id === selectedId;
  return {
    id: 'e-' + n.id, from: n.parentId, to: n.id,
    arrows: { to: { enabled: true, scaleFactor: 0.45, type: 'arrow' } },
    color: { color: col, highlight: child.color, hover: mix(child.color, '#0b0e14', 0.2), opacity: incident ? 0.9 : 0.08 },
    dashes: isNet ? [4, 4] : false,
    smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.62 },
    width: 1.3, selectionWidth: 1.4, hoverWidth: 0.6,
  };
}
function linkVis(lk) {
  const t = LINK_TYPES[lk.type] || LINK_TYPES.custom;
  const incident = !(focusSet && selectedId) || lk.fromNodeId === selectedId || lk.toNodeId === selectedId;
  return {
    id: 'l-' + lk.id, from: lk.fromNodeId, to: lk.toNodeId,
    arrows: { to: { enabled: true, scaleFactor: 0.6, type: 'arrow' } },
    dashes: t.dash,
    color: { color: t.color, highlight: t.color, hover: t.color, opacity: incident ? 0.85 : 0.08 },
    width: 1.6, selectionWidth: 2, hoverWidth: 0.4,
    label: lk.label || '',
    font: { color: t.color, size: 10, face: 'SFMono-Regular, monospace', strokeWidth: 4, strokeColor: '#0b0e14', align: 'middle' },
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.25 },
  };
}
function buildEdges() {
  const edges = [];
  if (edgeToggles.containment) state.nodes.filter(n => n.parentId).forEach(n => edges.push(edgeVis(n)));
  state.links.forEach(lk => { if (edgeToggles[lk.type] !== false && nodeById(lk.fromNodeId) && nodeById(lk.toNodeId)) edges.push(linkVis(lk)); });
  return edges;
}
function refreshEdges() { if (edgesDS) { edgesDS.clear(); edgesDS.add(buildEdges()); } startFlow(); }

function buildGraph() {
  nodesDS = new vis.DataSet(state.nodes.map(nodeVis));
  edgesDS = new vis.DataSet(buildEdges());
  const container = document.getElementById('graph');
  network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
    autoResize: true,
    layout: { improvedLayout: true },
    physics: false,
    interaction: { hover: true, dragNodes: canEdit(), dragView: true, zoomView: false, tooltipDelay: 120, navigationButtons: false, keyboard: false },
    nodes: { chosen: true },
  });
  setupSmoothZoom(container);
  network.on('afterDrawing', (ctx) => drawFlow(ctx));
  network.on('click', (params) => {
    if (params.nodes.length) select(params.nodes[0]);
    else { selectedId = null; focusSet = null; network.unselectAll(); syncGraph(); closeSidebar(); renderDetail(); markTableSelection(); }
  });
  network.on('dragEnd', (params) => {
    if (!canEdit()) return;   // read-only: don't persist positions (dragNodes is also disabled)
    if (!params.nodes.length) return;
    params.nodes.forEach(id => {
      const pos = network.getPositions([id])[id];
      const n = state.nodes.find(x => x.id === id);
      if (n && pos) { n.posX = Math.round(pos.x); n.posY = Math.round(pos.y); saveNodePosition(id); }
    });
  });
  const graphEl = document.getElementById('graph');
  if (!REDUCE) {
    network.on('hoverNode', (p) => {
      const n = state.nodes.find(x => x.id === p.node); if (!n) return;
      const t = TYPES[n.type] || { color: '#7c8aa0', level: 0 }; const isHost = (t.level || 0) === 0;
      nodesDS.update({ id: p.node, shadow: { enabled: true, color: rgba(nodeColor(n), .5), size: isHost ? 28 : 18, x: 0, y: isHost ? 11 : 7 } });
      graphEl.style.cursor = 'pointer';
    });
    network.on('blurNode', (p) => { refreshGraphNode(p.node); graphEl.style.cursor = 'default'; });
  } else {
    network.on('hoverNode', () => { graphEl.style.cursor = 'pointer'; });
    network.on('blurNode', () => { graphEl.style.cursor = 'default'; });
  }
  setTimeout(() => { network.fit({ animation: false }); startFlow(); }, 60);
  document.addEventListener('visibilitychange', () => {
    tabHidden = document.hidden;
    if (tabHidden) { cancelAnimationFrame(flowRAF); flowRAF = 0; } else startFlow();
  });
}

/* ================= ANIMATED EDGE FLOW + SELECTION PULSE ================= */
let flowRAF = 0, flowLastDraw = 0, tabHidden = false;
const FLOW_FRAME_MS = 33;
const FLOW_PERIOD = 2600;
function hasVisibleEdges() {
  if (edgeToggles.containment && state.nodes.some(n => n.parentId)) return true;
  return state.links.some(l => edgeToggles[l.type] !== false && nodeById(l.fromNodeId) && nodeById(l.toNodeId));
}
function startFlow() {
  if (REDUCE || tabHidden || flowRAF) return;
  if (!hasVisibleEdges() && !selectedId) return;
  flowRAF = requestAnimationFrame(flowLoop);
}
function flowLoop(ts) {
  flowRAF = 0;
  if (REDUCE || tabHidden) return;
  if (!hasVisibleEdges() && !selectedId) return;
  if (ts - flowLastDraw >= FLOW_FRAME_MS) { flowLastDraw = ts; network.redraw(); }
  flowRAF = requestAnimationFrame(flowLoop);
}
function drawFlow(ctx) {
  if (REDUCE || !network) return;
  const now = performance.now();
  const pos = network.getPositions();
  const phase = (now / FLOW_PERIOD) % 1;
  ctx.save();
  const drawEdge = (aId, bId, color, isLink) => {
    const a = pos[aId], b = pos[bId]; if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 24) return;
    const hot = selectedId && (aId === selectedId || bId === selectedId);
    const speed = hot ? 1.9 : 1;
    const count = isLink ? 2 : 1;
    const t0 = 0.16, t1 = 0.84;
    for (let k = 0; k < count; k++) {
      const tt = ((phase * speed) + k / count) % 1;
      const t = t0 + (t1 - t0) * tt;
      const x = a.x + dx * t, y = a.y + dy * t;
      const fade = Math.sin(tt * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y, hot ? 3.4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = (hot ? 0.95 : 0.6) * (0.4 + 0.6 * fade);
      ctx.shadowColor = color; ctx.shadowBlur = hot ? 10 : 5;
      ctx.fill();
    }
  };
  if (edgeToggles.containment) state.nodes.forEach(n => { if (n.parentId && !isDimmed(n.id) && !isDimmed(n.parentId)) drawEdge(n.parentId, n.id, '#6b7686', false); });
  state.links.forEach(l => {
    if (edgeToggles[l.type] === false) return;
    if (focusSet && selectedId && l.fromNodeId !== selectedId && l.toNodeId !== selectedId) return;
    drawEdge(l.fromNodeId, l.toNodeId, (LINK_TYPES[l.type] || LINK_TYPES.custom).color, true);
  });
  if (selectedId && pos[selectedId]) {
    const p = pos[selectedId];
    const b = (Math.sin(now / 620) + 1) / 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 30 + b * 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#2dd4bf';
    ctx.globalAlpha = 0.35 * (1 - b);
    ctx.lineWidth = 2; ctx.shadowColor = '#2dd4bf'; ctx.shadowBlur = 12;
    ctx.stroke();
  }
  ctx.restore();
}

/* ================= SMOOTH, CURSOR-CENTRED, EASED ZOOM ================= */
const ZOOM_SENSITIVITY = 0.003;
const ZOOM_LERP        = 0.22;
const ZOOM_MIN = 0.18, ZOOM_MAX = 3.2;
let zoomTarget = null, zoomAnchorDOM = null, zoomRAF = 0;
function setupSmoothZoom(container) {
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cur = network.getScale();
    const base = (zoomTarget == null) ? cur : zoomTarget;
    let next = base * Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
    zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    zoomAnchorDOM = { x: e.offsetX, y: e.offsetY };
    if (REDUCE) { applyZoom(zoomTarget, zoomAnchorDOM); zoomTarget = null; return; }
    if (!zoomRAF) zoomRAF = requestAnimationFrame(zoomLoop);
  }, { passive: false });
}
function applyZoom(scale, domPt) {
  const before = network.DOMtoCanvas(domPt);
  network.moveTo({ scale, animation: false });
  const after = network.DOMtoCanvas(domPt);
  const c = network.getViewPosition();
  network.moveTo({ position: { x: c.x + (before.x - after.x), y: c.y + (before.y - after.y) }, scale, animation: false });
}
function zoomLoop() {
  zoomRAF = 0;
  if (zoomTarget == null) return;
  const cur = network.getScale();
  const next = cur + (zoomTarget - cur) * ZOOM_LERP;
  if (Math.abs(zoomTarget - next) < 0.001) { applyZoom(zoomTarget, zoomAnchorDOM); zoomTarget = null; return; }
  applyZoom(next, zoomAnchorDOM);
  zoomRAF = requestAnimationFrame(zoomLoop);
}
function smoothZoomBy(factor) {
  const rect = document.getElementById('graph').getBoundingClientRect();
  const anchor = { x: rect.width / 2, y: rect.height / 2 };
  const base = (zoomTarget == null) ? network.getScale() : zoomTarget;
  zoomTarget = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, base * factor));
  zoomAnchorDOM = anchor;
  if (REDUCE) { applyZoom(zoomTarget, anchor); zoomTarget = null; return; }
  if (!zoomRAF) zoomRAF = requestAnimationFrame(zoomLoop);
}

function syncGraph() {
  nodesDS.clear(); nodesDS.add(state.nodes.map(nodeVis));
  edgesDS.clear(); edgesDS.add(buildEdges());
  if (selectedId && state.nodes.some(n => n.id === selectedId)) network.selectNodes([selectedId]);
}

function refreshGraphNode(id) {
  const n = state.nodes.find(x => x.id === id);
  if (n && nodesDS) nodesDS.update(nodeVis(n));
}

/* auto-arrange: run hierarchical once, capture positions, persist to server, revert to manual */
function autoArrange() {
  if (!requireEdit()) return;
  network.setOptions({ layout: { hierarchical: { enabled: true, direction: 'UD', sortMethod: 'directed', levelSeparation: 150, nodeSpacing: 150, treeSpacing: 180 } } });
  network.once('afterDrawing', async () => {
    const pos = network.getPositions();
    const updates = [];
    state.nodes.forEach(n => {
      if (pos[n.id]) { n.posX = Math.round(pos[n.id].x); n.posY = Math.round(pos[n.id].y); updates.push(api.updateNode(n.id, { posX: n.posX, posY: n.posY })); }
    });
    network.setOptions({ layout: { hierarchical: { enabled: false } } });
    syncGraph();
    setTimeout(() => network.fit({ animation: { duration: 350 } }), 30);
    try { await Promise.all(updates); toast('Layout arranged', 'ok'); }
    catch (e) { toast('Some positions failed to save: ' + e.message, 'err'); }
  });
}

/* small color mixer */
function mix(a, b, t) {
  const pa = hx(a), pb = hx(b);
  const r = Math.round(pa[0] + (pb[0]-pa[0])*t);
  const g = Math.round(pa[1] + (pb[1]-pa[1])*t);
  const bl = Math.round(pa[2] + (pb[2]-pa[2])*t);
  return `rgb(${r},${g},${bl})`;
}
function hx(h){ h=h.replace('#',''); if(h.length===3)h=h.split('').map(c=>c+c).join(''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
function rgba(hex, a){ const [r,g,b]=hx(hex); return `rgba(${r},${g},${b},${a})`; }

/* ================= SELECTION + DETAIL ================= */
function select(id) {
  selectedId = id;
  focusSet = relatedIds(id);
  syncGraph();
  openSidebar();
  if (network && !REDUCE && currentView !== 'table') {
    network.focus(id, { scale: network.getScale(), animation: { duration: 420, easingFunction: 'easeInOutCubic' } });
  }
  renderDetail();
  markTableSelection();
  startFlow();
}
function clearFocus() { if (focusSet) { focusSet = null; syncGraph(); } }

const mainEl = document.querySelector('.main');
function openSidebar() { mainEl.classList.add('sidebar-open'); updateReopen(); reflowGraph(); }
function closeSidebar() { mainEl.classList.remove('sidebar-open'); updateReopen(); reflowGraph(); }
function updateReopen() {
  const btn = document.getElementById('panelReopen');
  const open = mainEl.classList.contains('sidebar-open');
  const n = state.nodes.find(x => x.id === selectedId);
  btn.classList.toggle('show', !open && !!n);
  if (n) document.getElementById('panelReopenName').textContent = n.name;
}
function reflowGraph() {
  if (!network) return;
  const dur = REDUCE ? 0 : 340, t0 = performance.now();
  const step = (t) => { network.setSize('100%', '100%'); network.redraw(); if (t - t0 < dur) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---- canvas chrome: live stat strip + empty state ---- */
function renderStats() {
  const nodes = state.nodes;
  const hosts = nodes.filter(n => ['physical', 'proxmox_host', 'docker_host'].includes(n.type)).length;
  const containers = nodes.filter(n => n.type === 'container').length;
  const pub = state.ports.filter(p => p.exposure === 'public').length;
  const lan = state.ports.filter(p => p.exposure === 'lan').length;
  const cell = (v, l, cls = '') => `<div class="stat ${cls}"><span class="stat__v">${v}</span><span class="stat__l">${l}</span></div>`;
  const expCell = `<button class="stat stat--exposed stat--action" id="statExposed" title="${pub} public · ${lan} on LAN — view exposure surface" aria-label="View exposure: ${pub} public, ${lan} on LAN"><span class="stat__v">${pub}</span><span class="stat__l">public${lan ? ` · ${lan} lan` : ''}</span></button>`;
  document.getElementById('statStrip').innerHTML =
    cell(nodes.length, 'nodes') + cell(hosts, 'hosts') + cell(containers, 'containers') + expCell;
}
function renderWarnings() {
  const btn = document.getElementById('btnWarnings');
  const count = _conflicts.length;
  btn.classList.toggle('has', count > 0);
  btn.querySelector('.warn-count').textContent = count;
  if (!count) { btn.title = 'No conflicts detected'; btn.setAttribute('aria-label', 'Conflicts: none'); return; }
  const by = { ip: 0, mac: 0, hostPort: 0 };
  _conflicts.forEach(c => { by[c.kind] = (by[c.kind] || 0) + 1; });
  const parts = KIND_ORDER.filter(k => by[k]).map(k => `${by[k]} ${CONFLICT_KINDS[k].short}`);
  const summary = `${count} conflict${count > 1 ? 's' : ''} — ${parts.join(' · ')} (click to review)`;
  btn.title = summary;
  btn.setAttribute('aria-label', summary);
}
function toggleCanvasEmpty() { document.getElementById('canvasEmpty').style.display = state.nodes.length ? 'none' : 'flex'; }
function refreshChrome() { refreshConflicts(); renderLayers(); renderStats(); renderWarnings(); toggleCanvasEmpty(); refreshTable(); startFlow(); }

/* ================= NODE TABLE VIEW ================= */
/* exposure ranking: highest wins (public > lan > internal); 0 = no ports */
const EXP_RANK = { internal: 1, lan: 2, public: 3 };
const STATUS_RANK = { up: 0, unknown: 1, down: 2 };
function nodePortStats(id) {
  let inUse = 0, total = 0, expRank = 0;
  for (const p of state.ports) {
    if (p.nodeId !== id) continue;
    total++;
    if (p.status === 'in_use') inUse++;
    const r = EXP_RANK[p.exposure] || 0;
    if (r > expRank) expRank = r;
  }
  return { inUse, total, expRank };
}
function setView(v, opts = {}) {
  v = v === 'table' ? 'table' : 'graph';
  currentView = v;
  if (!opts.silent) localStorage.setItem('hst-view', v);
  const isTable = v === 'table';
  document.querySelectorAll('#viewToggle [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  const graphWrap = document.querySelector('.graph-wrap');
  const tableView = document.getElementById('tableView');
  if (graphWrap) graphWrap.hidden = isTable;
  if (tableView) tableView.hidden = !isTable;
  document.body.classList.toggle('view-table', isTable);
  if (isTable) renderTable();
  else if (network) { reflowGraph(); }   // graph was 0-sized while hidden — re-measure + redraw
}
/* comparator for the active sort column */
function nodeSortValue(n, key) {
  switch (key) {
    case 'name': return (n.name || '').toLowerCase();
    case 'type': { const i = TYPE_ORDER.indexOf(n.type); return i < 0 ? 99 : i; }
    case 'ip': { const v = ipToInt(n.ipAddress); return v == null ? Infinity : v; }
    case 'network': { const nw = n.networkId ? nwById(n.networkId) : null; return nw ? nw.name.toLowerCase() : '￿'; }
    case 'ports': return nodePortStats(n.id).inUse;
    case 'exposure': return nodePortStats(n.id).expRank;
    case 'status': return STATUS_RANK[n.status] ?? 1;
    default: return 0;
  }
}
function filteredSortedNodes() {
  const q = tableQ.trim().toLowerCase();
  let rows = state.nodes;
  if (q) {
    rows = rows.filter(n => {
      const nw = n.networkId ? nwById(n.networkId) : null;
      const hay = [n.name, n.ipAddress, n.macAddress, n.os, n.role, (TYPES[n.type] || {}).label, nw ? nw.name : '', (n.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  const { key, dir } = tableSort;
  const sign = dir === 'desc' ? -1 : 1;
  rows = rows.slice().sort((a, b) => {
    const va = nodeSortValue(a, key), vb = nodeSortValue(b, key);
    let c;
    if (typeof va === 'string' || typeof vb === 'string') c = String(va).localeCompare(String(vb));
    else c = va < vb ? -1 : va > vb ? 1 : 0;
    if (c === 0 && key !== 'name') c = (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    return c * sign;
  });
  return rows;
}
function tableRowHtml(n) {
  const t = TYPES[n.type] || { label: n.type, color: '#7c8aa0' };
  const nw = n.networkId ? nwById(n.networkId) : null;
  const st = nodePortStats(n.id);
  const ip = (n.ipAddress || '').trim();
  const sc = ['up', 'down', 'unknown'].includes(n.status) ? n.status : 'unknown';
  const src = nodeImageSrc(n);
  const hasConf = nodeConflicts(n.id).length > 0;
  const expTag = st.expRank
    ? (() => { const key = st.expRank === 3 ? 'public' : st.expRank === 2 ? 'lan' : 'internal'; const e = EXPOSURE[key]; return `<span class="tag ${e.cls}" title="${esc(e.tip)}">${e.label}</span>`; })()
    : '<span class="muted">—</span>';
  const cls = [hasConf ? 'row-warn' : '', selectedId === n.id ? 'is-selected' : ''].filter(Boolean).join(' ');
  return `<tr data-id="${n.id}" tabindex="0" role="button" aria-label="Open ${esc(n.name)}"${cls ? ` class="${cls}"` : ''}>
    <td><div class="ncell-name">
      ${src ? `<span class="tv-avatar"><img src="${esc(src)}" alt="" onerror="this.closest('.tv-avatar').style.display='none'"></span>` : ''}
      <span class="tv-name">${esc(n.name)}</span>
      ${hasConf ? `<span class="tv-warn" title="This node has a conflict">${WARN_ICON}</span>` : ''}
    </div></td>
    <td><span class="tv-type" style="color:${t.color}"><span class="cmd__dot" style="background:${t.color}"></span>${esc(t.label)}</span></td>
    <td>${ip ? `<span class="tv-mono">${esc(ip)}</span>` : '<span class="muted">—</span>'}</td>
    <td>${nw ? `<span class="tv-net"><span class="cmd__dot" style="background:${nw.color}"></span>${esc(nw.name)}</span>` : '<span class="muted">—</span>'}</td>
    <td class="tnum">${st.inUse}<span class="muted">/${st.total}</span></td>
    <td>${expTag}</td>
    <td><span class="badge badge--${sc}"><span class="dot"></span>${esc(n.status)}</span>${(() => { const r = relativeShort(n.lastSeen); return r ? `<span class="tv-seen" title="Last seen ${esc(absTime(n.lastSeen))}">${esc(r)}</span>` : ''; })()}</td>
  </tr>`;
}
function renderTableRows() {
  const body = document.getElementById('tableBody');
  const emptyEl = document.getElementById('tableEmpty');
  const countEl = document.getElementById('tableCount');
  if (!body) return;
  const rows = filteredSortedNodes();
  const total = state.nodes.length;
  body.innerHTML = rows.map(tableRowHtml).join('');
  const tableEl = document.querySelector('#tableView table.ntable');
  if (tableEl) tableEl.style.display = rows.length ? '' : 'none';
  // empty states
  if (emptyEl) {
    if (!total) {
      emptyEl.hidden = false;
      emptyEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="9" y1="9.5" x2="9" y2="20"/></svg>
        <h3>No nodes yet</h3><p>Add your first machine to start mapping the topology.</p>
        ${canEdit() ? `<button class="btn btn--primary btn--sm" onclick="openNodeModal()">Add node</button>` : ''}`;
    } else if (!rows.length) {
      emptyEl.hidden = false;
      emptyEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        <h3>No matches</h3><p>No nodes match “${esc(tableQ.trim())}”.</p>`;
    } else {
      emptyEl.hidden = true;
    }
  }
  if (countEl) countEl.textContent = (rows.length === total) ? `${total} node${total !== 1 ? 's' : ''}` : `${rows.length} of ${total}`;
}
function updateSortIndicators() {
  document.querySelectorAll('#tableView thead th[data-sort]').forEach(th => {
    if (th.dataset.sort === tableSort.key) th.setAttribute('aria-sort', tableSort.dir === 'desc' ? 'descending' : 'ascending');
    else th.removeAttribute('aria-sort');
  });
}
function renderTable() { updateSortIndicators(); renderTableRows(); }
/* keep the table synced with mutations without clobbering the filter input focus */
function refreshTable() { if (currentView === 'table') renderTable(); }
/* highlight the selected row without a full rebuild (used on select/deselect) */
function markTableSelection() {
  const body = document.getElementById('tableBody');
  if (!body) return;
  body.querySelectorAll('tr').forEach(tr => {
    const on = tr.dataset.id === selectedId;
    tr.classList.toggle('is-selected', on);
    if (on && currentView === 'table') tr.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' });
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---- relative "last seen" helpers (probe freshness) ---- */
function _ageMs(iso) { if (!iso) return null; const t = new Date(iso).getTime(); return Number.isFinite(t) ? Date.now() - t : null; }
function relativeTime(iso) {   // long form for the detail panel
  const d = _ageMs(iso); if (d == null) return null;
  const s = Math.max(0, Math.round(d / 1000)); if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  const dy = Math.round(h / 24); if (dy < 30) return dy + 'd ago';
  const mo = Math.round(dy / 30); if (mo < 12) return mo + 'mo ago';
  return Math.round(mo / 12) + 'y ago';
}
function relativeShort(iso) {  // compact form for the table status column
  const d = _ageMs(iso); if (d == null) return null;
  const s = Math.max(0, Math.round(d / 1000)); if (s < 60) return 'now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm';
  const h = Math.round(m / 60); if (h < 24) return h + 'h';
  const dy = Math.round(h / 24); if (dy < 30) return dy + 'd';
  const mo = Math.round(dy / 30); if (mo < 12) return mo + 'mo';
  return Math.round(mo / 12) + 'y';
}
function absTime(iso) { const t = iso ? new Date(iso) : null; return (t && Number.isFinite(t.getTime())) ? t.toLocaleString() : ''; }
function freshnessClass(iso) { const d = _ageMs(iso); if (d == null) return 'seen-dot--old'; if (d < 10 * 60 * 1000) return 'seen-dot--fresh'; if (d < 24 * 60 * 60 * 1000) return 'seen-dot--stale'; return 'seen-dot--old'; }

/* ---- inline button spinner (async in-progress state) ---- */
function withSpinner(btn, label) {
  if (!btn) return;
  if (btn._orig == null) btn._orig = btn.innerHTML;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + (label ? `<span class="lbl">${esc(label)}</span>` : '');
}
function clearSpinner(btn) {
  if (!btn) return;
  if (btn._orig != null) { btn.innerHTML = btn._orig; btn._orig = null; }
  btn.disabled = false; btn.removeAttribute('aria-busy');
}

function renderDetail() {
  const el = document.getElementById('detail');
  const n = state.nodes.find(x => x.id === selectedId);
  if (!n) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg></div>
        <h3>No node selected</h3>
        <p>Pick a node in the topology to see its details and port map.${canEdit() ? ' Or add your first node.' : ''}</p>
        ${canEdit() ? `<button class="btn btn--primary" onclick="openNodeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add node</button>` : `<button class="btn" onclick="openAuthModal('login')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> Log in to edit</button>`}
      </div>`;
    return;
  }
  const t = TYPES[n.type] || { label: n.type, color: '#7c8aa0' };
  const parent = state.nodes.find(x => x.id === n.parentId);
  const kids = state.nodes.filter(x => x.parentId === n.id);
  const statusMap = { up: 'up', down: 'down', unknown: 'unknown' };
  const sc = statusMap[n.status] || 'unknown';
  const ip = (n.ipAddress || '').trim();
  const confs = nodeConflicts(n.id);
  const iconThumb = nodeImageSrc(n);

  el.innerHTML = `
    <div class="node-head" style="--tc:${t.color}">
      <div class="node-head__top">
        <div>
          <span class="node-type-chip" style="color:${t.color}"><span class="dot"></span>${esc(t.label)}</span>
        </div>
        <div class="node-head__actions">
          ${canEdit() ? `<button class="btn btn--ghost btn--icon" title="Check this node's health" onclick="runProbeNode('${n.id}', this)" aria-label="Check health of ${esc(n.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg></button>
          <button class="btn btn--ghost btn--icon" title="Edit node" onclick="openNodeModal('${n.id}')" aria-label="Edit node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
          <button class="btn btn--ghost btn--icon btn--danger" title="Delete node" onclick="confirmDeleteNode('${n.id}')" aria-label="Delete node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg></button>` : ''}
        </div>
      </div>
      <div class="node-head__id">
        ${iconThumb ? `<div class="node-avatar" style="--tc:${t.color}"><img src="${esc(iconThumb)}" alt="${esc(n.name)} icon" onerror="this.closest('.node-avatar').style.display='none'"></div>` : ''}
        <h2>${esc(n.name)}</h2>
      </div>
      <div class="node-head__meta">
        <span class="badge badge--${sc}"><span class="dot"></span>${esc(n.status)}</span>
        ${n.role ? `<span class="badge">${esc(n.role)}</span>` : ''}
        ${confs.length ? `<button class="badge badge--warn" onclick="openConflictsModal()" title="${esc(confs.map(conflictLabel).join(' · '))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${confs.length} conflict${confs.length > 1 ? 's' : ''}</button>` : ''}
      </div>
      ${(() => { const nw = n.networkId ? nwById(n.networkId) : null; return nw ? `<div class="node-tags"><button class="net-chip" onclick="openNetworksModal()" title="${esc(nw.cidr)}"><span class="net-chip__dot" style="background:${nw.color}"></span>${esc(nw.name)}${nw.vlanId != null ? ` · vlan ${nw.vlanId}` : ''}</button></div>` : ''; })()}
      ${(n.tags && n.tags.length) ? `<div class="node-tags">${n.tags.map(tg => `<span class="ntag">${esc(tg)}</span>`).join('')}</div>` : ''}
      ${ip ? `<div class="ip-hero">
        <span class="ip-hero__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg></span>
        <div class="ip-hero__body">
          <span class="ip-hero__label">IP address</span>
          <button class="ip-hero__val copy" data-copy="${esc(ip)}" title="Copy IP">${esc(ip)}</button>
        </div>
        <svg class="ip-hero__copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
      </div>` : ''}
      ${(() => { const gu = nodeUrl(n); return gu ? `<a class="node-goto" href="${esc(gu)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(gu)} in a new tab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>
        <span>Go to</span><span class="node-goto__host">${esc(gu.replace(/^https?:\/\//, ''))}</span>
        <svg class="arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
      </a>` : ''; })()}
      <dl class="dl">
        <dt>MAC</dt><dd class="mono ${n.macAddress?'':'muted'}">${n.macAddress ? `<button class="copy mono" data-copy="${esc(n.macAddress)}" title="Copy">${esc(n.macAddress)}</button>` : '—'}</dd>
        <dt>OS</dt><dd class="${n.os?'':'muted'}">${esc(n.os) || '—'}</dd>
        <dt>Parent</dt><dd>${parent ? `<button class="copy" data-goto="${parent.id}">${esc(parent.name)}</button>` : '<span class="muted">— root</span>'}</dd>
        ${kids.length ? `<dt>Children</dt><dd>${kids.map(k=>`<button class="copy" data-goto="${k.id}">${esc(k.name)}</button>`).join(', ')}</dd>` : ''}
        <dt>Last seen</dt><dd class="${relativeTime(n.lastSeen) ? '' : 'muted'}">${(() => { const rel = relativeTime(n.lastSeen); return rel ? `<span class="seen-dot ${freshnessClass(n.lastSeen)}"></span>${esc(rel)}<span class="seen-abs"> · ${esc(absTime(n.lastSeen))}</span>` : 'never probed'; })()}</dd>
      </dl>
      ${n.notes ? `<div class="notes">${esc(n.notes)}</div>` : ''}
    </div>
    ${renderPortsSection(n)}`;

  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    navigator.clipboard?.writeText(b.dataset.copy).then(() => {
      toast('Copied ' + b.dataset.copy, 'ok');
      b.classList.remove('copied'); void b.offsetWidth; b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 420);
    });
  }));
  el.querySelectorAll('.node-head [data-goto]').forEach(b => b.addEventListener('click', () => gotoNode(b.dataset.goto)));
  wirePortsSection(n);

  el.classList.add('is-entering');
  setTimeout(() => el.classList.remove('is-entering'), 420);
}

/* ---- ports subsection ---- */
function portsFor(nodeId) {
  return state.ports.filter(p => p.nodeId === nodeId)
    .sort((a,b) => a.portNumber - b.portNumber || a.protocol.localeCompare(b.protocol));
}
function portUrl(n, p) {
  if (p.status !== 'in_use') return null;
  const scheme = p.scheme || inferScheme(p);
  if (p.domain) return scheme + '://' + p.domain;
  const ip = (n.ipAddress || '').trim();
  return ip ? scheme + '://' + ip + ':' + p.portNumber : null;
}
function nodeUrl(n) {
  const pub = portsFor(n.id).find(p => p.domain);
  if (pub) return (pub.scheme || 'https') + '://' + pub.domain;
  const ip = (n.ipAddress || '').trim();
  return ip ? 'http://' + ip : null;
}

/* ================= CONFLICT DETECTION ================= */
function publishHostId(p) {
  const n = nodeById(p.nodeId); if (!n) return p.nodeId;
  const hostTypes = ['physical', 'proxmox_host', 'docker_host', 'network_device'];
  return hostTypes.includes(n.type) ? n.id : (n.parentId || n.id);
}
function computeConflicts() {
  const out = [];
  const groupBy = (items, keyFn) => {
    const m = new Map();
    items.forEach(it => { const k = keyFn(it); if (k == null || k === '') return; (m.get(k) || m.set(k, []).get(k)).push(it); });
    return m;
  };
  groupBy(state.nodes, n => (n.ipAddress || '').trim())
    .forEach((ns, ip) => { if (ns.length > 1) out.push({ kind: 'ip', value: ip, nodeIds: ns.map(n => n.id) }); });
  groupBy(state.nodes, n => (n.macAddress || '').trim().toUpperCase())
    .forEach((ns, mac) => { if (ns.length > 1) out.push({ kind: 'mac', value: mac, nodeIds: ns.map(n => n.id) }); });
  groupBy(state.ports.filter(p => p.hostPort != null), p => publishHostId(p) + '|' + p.hostPort)
    .forEach((ps) => { if (ps.length > 1) out.push({ kind: 'hostPort', value: ps[0].hostPort, hostId: publishHostId(ps[0]), portIds: ps.map(p => p.id), nodeIds: [...new Set(ps.map(p => p.nodeId))] }); });
  return out;
}
let _conflicts = [];
function refreshConflicts() { _conflicts = computeConflicts(); return _conflicts; }
function nodeConflicts(nodeId) { return _conflicts.filter(c => c.nodeIds && c.nodeIds.includes(nodeId)); }
function portHostConflict(p) { return p.hostPort != null && _conflicts.some(c => c.kind === 'hostPort' && c.portIds && c.portIds.includes(p.id)); }
function renderPortsSection(n) {
  const all = portsFor(n.id);
  let rows = all;
  if (portFilter.proto !== 'all') rows = rows.filter(p => p.protocol === portFilter.proto);
  if (portFilter.q.trim()) {
    const q = portFilter.q.trim().toLowerCase();
    rows = rows.filter(p => p.serviceName.toLowerCase().includes(q) || String(p.portNumber).includes(q) || (p.description||'').toLowerCase().includes(q));
  }

  const tbody = rows.length ? rows.map(p => {
    const url = portUrl(n, p);
    const scheme = p.scheme || inferScheme(p);
    const exp = EXPOSURE[p.exposure] || EXPOSURE.internal;
    const tgt = p.targetNodeId ? nodeById(p.targetNodeId) : null;
    const hasMap = p.hostPort != null || p.targetNodeId;
    const mapping = hasMap ? `<span class="port-map">${p.hostPort != null ? `<span class="pm-host">host :${p.hostPort}</span>` : ''}${tgt ? `<span class="pm-arrow">→</span><button class="link-node" data-goto="${tgt.id}" title="Go to ${esc(tgt.name)}">${esc(tgt.name)}</button>` : (p.targetNodeId ? '<span class="pm-arrow">→</span><span class="muted">(removed)</span>' : '')}</span>` : '';
    const conflicted = portHostConflict(p);
    return `
    <tr data-portid="${p.id}"${conflicted ? ' class="row-warn"' : ''}>
      <td><span class="port-num">${p.portNumber}</span><span class="proto">${esc(p.protocol)}</span></td>
      <td class="svc">${esc(p.serviceName) || '<span style="color:var(--fg-dim)">unnamed</span>'}${p.description ? `<small>${esc(p.description)}</small>` : ''}${mapping}${p.domain ? `<a class="port-domain" href="${scheme}://${esc(p.domain)}" target="_blank" rel="noopener noreferrer" title="Open ${scheme}://${esc(p.domain)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>${esc(p.domain)}</a>` : ''}</td>
      <td>
        <span class="tag ${p.status === 'reserved' ? 'tag--reserved' : 'tag--use'}">${p.status === 'reserved' ? 'reserved' : 'in use'}</span>
        <span class="tag ${exp.cls}" title="${esc(exp.tip)}${p.domain ? ' — ' + esc(p.domain) : ''}">${exp.label}</span>
        ${conflicted ? `<span class="tag tag--warn" title="Host port :${p.hostPort} is published more than once on this host — conflict">conflict</span>` : ''}
      </td>
      <td style="width:1%"><div class="row-actions">
        ${url ? `<a class="btn btn--ghost btn--icon btn--sm p-open" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(url)}" aria-label="Open ${esc(p.serviceName || ('port ' + p.portNumber))} in a new tab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>` : ''}
        ${canEdit() ? `<button class="btn btn--ghost btn--icon btn--sm" title="Edit port" onclick="openPortModal('${n.id}','${p.id}')" aria-label="Edit port ${p.portNumber}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button class="btn btn--ghost btn--icon btn--sm btn--danger" title="Delete port" onclick="deletePort('${p.id}')" aria-label="Delete port ${p.portNumber}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg></button>` : ''}
      </div></td>
    </tr>`;
  }).join('') : '';

  const table = all.length ? (rows.length ? `
    <div class="ptable-wrap"><table class="ptable">
      <thead><tr><th>Port</th><th>Service</th><th>State</th><th></th></tr></thead>
      <tbody>${tbody}</tbody>
    </table></div>` : `<div class="ports-empty"><p>No ports match this filter.</p></div>`)
    : `<div class="ports-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-3 3 6 2-3h7"/></svg>
        <p>No ports recorded for this node yet.</p>
        ${canEdit() ? `<button class="btn btn--primary btn--sm" onclick="openPortModal('${n.id}')">Add first port</button>` : ''}
      </div>`;

  return `
  <section class="ports">
    <div class="section-head">
      <h3>Ports</h3>
      <span class="count">${all.length}</span>
      <div class="spacer"></div>
      ${canEdit() ? `<button class="btn btn--sm" onclick="openPortModal('${n.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Port</button>` : ''}
    </div>
    <div class="filter-row">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        <input class="input" id="portSearch" type="search" placeholder="Search service, port, note…" value="${esc(portFilter.q)}" aria-label="Search ports" />
      </div>
      <div class="seg" role="group" aria-label="Filter by protocol">
        <button data-proto="all" aria-pressed="${portFilter.proto==='all'}">All</button>
        <button data-proto="tcp" aria-pressed="${portFilter.proto==='tcp'}">TCP</button>
        <button data-proto="udp" aria-pressed="${portFilter.proto==='udp'}">UDP</button>
      </div>
    </div>
    ${table}
    ${renderFreeHelper(n)}
  </section>`;
}

function renderFreeHelper(n) {
  const { from, to, proto } = freeRange;
  return `
  <div class="free">
    <div class="free__head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <h4>Free port finder</h4>
    </div>
    <p class="free__note">Both in-use and <span class="tag tag--reserved" style="font-size:9px;padding:1px 5px">reserved</span> ports count as used.</p>
    <div class="free__controls">
      <div class="field"><label for="freeFrom">From</label><input class="input" id="freeFrom" type="number" min="1" max="65535" value="${from}"></div>
      <div class="field"><label for="freeTo">To</label><input class="input" id="freeTo" type="number" min="1" max="65535" value="${to}"></div>
      <div class="field"><label for="freeProto">Proto</label>
        <select class="input" id="freeProto">
          <option value="tcp" ${proto==='tcp'?'selected':''}>TCP</option>
          <option value="udp" ${proto==='udp'?'selected':''}>UDP</option>
        </select>
      </div>
    </div>
    <div class="free__summary" id="freeSummary">${computeFree(n, from, to, proto)}</div>
  </div>`;
}

function computeFree(n, from, to, proto) {
  from = Math.max(1, Math.min(65535, parseInt(from) || 1));
  to   = Math.max(1, Math.min(65535, parseInt(to) || 1));
  if (from > to) [from, to] = [to, from];
  const total = to - from + 1;
  const used = new Set(portsFor(n.id).filter(p => p.protocol === proto && p.portNumber >= from && p.portNumber <= to).map(p => p.portNumber));
  const usedList = [...used].sort((a,b)=>a-b);
  const freeCount = total - used.size;
  const ranges = [];
  let start = null, prev = null;
  for (let i = from; i <= to; i++) {
    if (!used.has(i)) { if (start === null) start = i; prev = i; }
    else if (start !== null) { ranges.push([start, prev]); start = null; }
  }
  if (start !== null) ranges.push([start, prev]);
  const MAX = 14;
  const chips = ranges.slice(0, MAX).map(([a,b]) => `<span class="chip">${a === b ? a : a + '–' + b}</span>`).join('');
  const more = ranges.length > MAX ? `<span class="chip chip--more">+${ranges.length - MAX} more ranges</span>` : '';
  return `
    <div class="free__stat">
      <span><b>${freeCount}</b> free</span>
      <span class="used"><b>${used.size}</b> used</span>
      <span style="color:var(--fg-muted)">of ${total} in range</span>
    </div>
    ${ranges.length ? `<div class="chips">${chips}${more}</div>` : `<span style="color:var(--fg-muted);font-size:13px">No free ${proto.toUpperCase()} ports in this range.</span>`}
    ${usedList.length ? `<div style="margin-top:10px;font-size:12px;color:var(--fg-muted)">Used ${proto.toUpperCase()}: ${usedList.join(', ')}</div>` : ''}`;
}

function wirePortsSection(n) {
  const el = document.getElementById('detail');
  const search = el.querySelector('#portSearch');
  if (search) {
    search.addEventListener('input', (e) => {
      portFilter.q = e.target.value;
      const pos = search.selectionStart;
      refreshPortsOnly(n);
      const s2 = document.getElementById('portSearch');
      if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
    });
  }
  el.querySelectorAll('.seg [data-proto]').forEach(b => b.addEventListener('click', () => {
    portFilter.proto = b.dataset.proto; refreshPortsOnly(n);
  }));
  el.querySelectorAll('.ports [data-goto]').forEach(b => b.addEventListener('click', () => gotoNode(b.dataset.goto)));
  const bindFree = () => {
    const f = document.getElementById('freeFrom'), tt = document.getElementById('freeTo'), pr = document.getElementById('freeProto');
    if (!f) return;
    const upd = () => {
      freeRange = { from: f.value, to: tt.value, proto: pr.value };
      document.getElementById('freeSummary').innerHTML = computeFree(n, f.value, tt.value, pr.value);
    };
    f.addEventListener('input', upd); tt.addEventListener('input', upd); pr.addEventListener('change', upd);
  };
  bindFree();
}
function refreshPortsOnly(n) {
  const el = document.getElementById('detail');
  const old = el.querySelector('.ports');
  if (!old) { renderDetail(); return; }
  const wrap = document.createElement('div');
  wrap.innerHTML = renderPortsSection(n);
  old.replaceWith(wrap.firstElementChild);
  wirePortsSection(n);
}

/* ================= MODALS ================= */
const overlay = document.getElementById('overlay');
const modalRoot = document.getElementById('modal');
let lastFocus = null;

let closeTimer;
function openModal(html) {
  lastFocus = document.activeElement;
  clearTimeout(closeTimer);
  overlay.classList.remove('closing');
  modalRoot.innerHTML = html;
  overlay.classList.add('open');
  const first = modalRoot.querySelector('input,select,textarea,button');
  if (first) setTimeout(() => first.focus(), 40);
}
let authForce = false;   // true = create-password screen (non-dismissible)
function closeModal() {
  if (authForce) return;
  if (!overlay.classList.contains('open')) return;
  const done = () => { overlay.classList.remove('open', 'closing'); modalRoot.innerHTML = ''; if (lastFocus) lastFocus.focus(); };
  if (REDUCE) { done(); return; }
  overlay.classList.add('closing');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(done, 155);
}

/* ---- Auth modal: create | login | change (server-backed) ---- */
function openAuthModal(mode) {
  authForce = (mode === 'create');
  const pwField = (id, label, ac) => `<div class="form-field"><label for="${id}">${label}</label><div class="pw-wrap"><input class="input" id="${id}" type="password" autocomplete="${ac}"><button type="button" class="pw-toggle" data-tog="${id}" aria-label="Show password">${EYE_ICON}</button></div></div>`;
  let body, title, cta;
  if (mode === 'create') {
    title = 'Create a password'; cta = 'Create password';
    body = `<p class="auth-note">Protect edits with a password. The app opens <strong>read-only</strong>; log in to make changes. Minimum 6 characters.</p>
      ${pwField('ap1', 'Password', 'new-password')}${pwField('ap2', 'Confirm password', 'new-password')}
      <div class="form-error" id="apErr"></div>
      <p class="auth-note auth-note--dim">This password is stored (hashed) on the server. If you forget it, reset it from the server's data store.</p>`;
  } else if (mode === 'change') {
    title = 'Change password'; cta = 'Update password';
    body = `${pwField('ap0', 'Current password', 'current-password')}${pwField('ap1', 'New password', 'new-password')}${pwField('ap2', 'Confirm new password', 'new-password')}<div class="form-error" id="apErr"></div>`;
  } else {
    title = 'Log in to edit'; cta = 'Log in';
    body = `<p class="auth-note">Enter your password to enable editing.</p>${pwField('ap0', 'Password', 'current-password')}<div class="form-error" id="apErr"></div>`;
  }
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">${title}</h3>
      ${mode === 'create' ? '' : `<button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button>`}
    </div>
    <form id="authForm" class="modal__body" novalidate>${body}</form>
    <div class="modal__foot">
      ${mode === 'create' ? '' : '<button class="btn" onclick="closeModal()">Cancel</button>'}
      <button class="btn btn--primary" id="authSave">${cta}</button>
    </div>`);
  const err = document.getElementById('apErr');
  const saveBtn = document.getElementById('authSave');
  const showErr = (m) => { err.textContent = m; err.style.display = 'block'; };
  const fail = (m) => { showErr(m); saveBtn.disabled = false; };
  modalRoot.querySelectorAll('.pw-toggle').forEach(b => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.tog); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.classList.toggle('on', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); inp.focus();
  }));
  const submit = async () => {
    err.style.display = 'none';
    saveBtn.disabled = true;
    try {
      if (mode === 'create') {
        const p1 = document.getElementById('ap1').value, p2 = document.getElementById('ap2').value;
        if (p1.length < 6) return fail('Password must be at least 6 characters.');
        if (p1 !== p2) return fail('Passwords do not match.');
        await api.setup(p1);
        await refreshAuthStatus();
        authForce = false; applyLockState(); closeModal(); toast('Password set — editing unlocked', 'ok');
      } else if (mode === 'change') {
        const cur = document.getElementById('ap0').value, p1 = document.getElementById('ap1').value, p2 = document.getElementById('ap2').value;
        if (p1.length < 6) return fail('New password must be at least 6 characters.');
        if (p1 !== p2) return fail('New passwords do not match.');
        await api.changePassword(cur, p1);
        closeModal(); toast('Password changed', 'ok');
      } else {
        const pw = document.getElementById('ap0').value;
        await api.login(pw);
        await refreshAuthStatus();
        applyLockState(); closeModal(); toast('Logged in — you can edit now', 'ok');
      }
    } catch (e) {
      fail(e.message);
    }
  };
  saveBtn.addEventListener('click', submit);
  document.getElementById('authForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}
function requireEdit() { if (canEdit()) return true; openAuthModal('login'); return false; }
overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (overlay.classList.contains('open')) { closeModal(); return; }
  if (menuOverlay.classList.contains('open')) { menuOverlay.classList.remove('open'); return; }
  if (mainEl.classList.contains('sidebar-open')) closeSidebar();
});

/* ---- Node modal (add + edit) ---- */
function openNodeModal(id = null) {
  if (!requireEdit()) return;
  const editing = id ? state.nodes.find(n => n.id === id) : null;
  const n = editing || { name:'', type:'physical', parentId:'', ipAddress:'', macAddress:'', os:'', role:'', status:'up', notes:'', networkId:null, iconType:'', iconValue:'' };
  const typeOpts = TYPE_ORDER.map(k => `<option value="${k}" ${n.type===k?'selected':''}>${TYPES[k].label}</option>`).join('');
  const banned = editing ? descendantIds(id).add(id) : new Set();
  const parentOpts = ['<option value="">— none (root)</option>']
    .concat(state.nodes.filter(x => !banned.has(x.id)).map(x => `<option value="${x.id}" ${n.parentId===x.id?'selected':''}>${esc(x.name)} · ${TYPES[x.type].label}</option>`)).join('');
  const netOpts = ['<option value="">— none</option>']
    .concat(state.networks.map(w => `<option value="${w.id}" ${n.networkId===w.id?'selected':''}>${esc(w.name)}${w.vlanId!=null?` · vlan ${w.vlanId}`:''} · ${esc(w.cidr)}</option>`)).join('');

  openModal(`
    <div class="modal__head">
      <h3 id="modalTitle">${editing ? 'Edit node' : 'Add node'}</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
    </div>
    <form id="nodeForm" class="modal__body" novalidate>
      <div class="form-grid">
        <div class="form-field full" id="ff-name">
          <label for="f-name">Name <span class="req">*</span></label>
          <input class="input" id="f-name" value="${esc(n.name)}" placeholder="e.g. dialga, docker-host" autocomplete="off" required>
          <div class="form-error">Name is required.</div>
        </div>
        <div class="form-field">
          <label for="f-type">Type</label>
          <select class="input" id="f-type">${typeOpts}</select>
        </div>
        <div class="form-field">
          <label for="f-status">Status</label>
          <select class="input" id="f-status">
            <option value="up" ${n.status==='up'?'selected':''}>Up</option>
            <option value="down" ${n.status==='down'?'selected':''}>Down</option>
            <option value="unknown" ${n.status==='unknown'?'selected':''}>Unknown</option>
          </select>
        </div>
        <div class="form-field full">
          <label for="f-parent">Parent node</label>
          <select class="input" id="f-parent">${parentOpts}</select>
          <div class="hint">Sets the containment edge (host → guest / container).</div>
        </div>
        <div class="form-field full">
          <label for="f-network">Network</label>
          <select class="input" id="f-network">${netOpts}</select>
          <div class="hint">VLAN / subnet this node lives on. <button type="button" class="linklike" id="f-network-add">＋ new network</button></div>
        </div>
        <div class="form-field">
          <label for="f-ip">IP address</label>
          <input class="input" id="f-ip" value="${esc(n.ipAddress)}" placeholder="10.20.30.10" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="f-mac">MAC</label>
          <input class="input" id="f-mac" value="${esc(n.macAddress)}" placeholder="AC:1F:6B:00:11:22" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="f-os">OS</label>
          <input class="input" id="f-os" value="${esc(n.os)}" placeholder="Proxmox VE 8.2" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="f-role">Role</label>
          <input class="input" id="f-role" value="${esc(n.role)}" placeholder="Hypervisor" autocomplete="off">
        </div>
        <div class="form-field full">
          <label for="f-tags">Tags</label>
          <input class="input" id="f-tags" value="${esc((n.tags || []).join(', '))}" placeholder="media, public, storage" autocomplete="off">
          <div class="hint">Comma-separated labels — handy for grouping / filtering later.</div>
        </div>
        <div class="form-field full">
          <label>Icon</label>
          <div class="seg seg--sm" id="iconMode" role="group" aria-label="Icon source">
            <button type="button" data-im="" aria-pressed="${n.iconType === ''}">None</button>
            <button type="button" data-im="selfhst" aria-pressed="${n.iconType === 'selfhst'}">App</button>
            <button type="button" data-im="builtin" aria-pressed="${n.iconType === 'builtin'}">Icon</button>
            <button type="button" data-im="url" aria-pressed="${n.iconType === 'url'}">URL</button>
            <button type="button" data-im="upload" aria-pressed="${n.iconType === 'upload'}">Upload</button>
          </div>
          <div class="icon-row">
            <div class="icon-preview icon-preview--light" id="iconPreview"></div>
            <div class="icon-panes">
              <div class="icon-pane" id="pane-selfhst">
                <label for="fi-slug" class="sr-only">Search selfh.st app icons</label>
                <input class="input" id="fi-slug" placeholder="Search app… (jellyfin, proxmox)" value="${n.iconType === 'selfhst' ? esc(n.iconValue) : ''}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="fi-suggest">
                <div class="icon-suggest" id="fi-suggest" role="listbox"></div>
                <div class="quickpick" id="fi-quick">${SELFHST_QUICK.map(([slug, label]) => `<button type="button" class="quickpick__item" data-slug="${slug}" title="${esc(label)}" aria-label="${esc(label)}"><img src="${selfhstUrl(slug)}" alt="" loading="lazy"><span>${esc(label)}</span></button>`).join('')}</div>
                <div class="hint">Icons from <span class="mono">selfh.st/icons</span>, cached on your server.</div>
              </div>
              <div class="icon-pane" id="pane-builtin">
                <div class="icon-grid" id="iconGrid">${BUILTIN_ORDER.map(k => `<button type="button" class="icon-opt" data-icon="${k}" title="${BUILTIN_ICONS[k].label}" aria-label="${BUILTIN_ICONS[k].label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BUILTIN_ICONS[k].svg}</svg></button>`).join('')}</div>
              </div>
              <div class="icon-pane" id="pane-url">
                <input class="input" id="fi-url" placeholder="https://…/icon.png" value="${n.iconType === 'url' ? esc(n.iconValue) : ''}" autocomplete="off" inputmode="url">
                <div class="hint">Public image URL. A broken link falls back to the type icon.</div>
              </div>
              <div class="icon-pane" id="pane-upload">
                <input type="file" id="fi-file" accept="image/*" class="sr-only">
                <label for="fi-file" class="btn btn--sm">Choose image…</label>
                <span class="hint">Downscaled to 128px, stored on the server (max 4MB source).</span>
              </div>
            </div>
          </div>
        </div>
        <div class="form-field full">
          <label for="f-notes">Notes</label>
          <textarea class="input" id="f-notes" placeholder="Anything worth remembering…">${esc(n.notes)}</textarea>
        </div>
      </div>
    </form>
    <div class="modal__foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn--primary" id="nodeSave">${editing ? 'Save changes' : 'Add node'}</button>
    </div>`);

  let iconType = n.iconType, iconValue = n.iconValue;
  const iconGrid = document.getElementById('iconGrid');
  const iconPreview = document.getElementById('iconPreview');
  const iconPanes = { selfhst: document.getElementById('pane-selfhst'), builtin: document.getElementById('pane-builtin'), url: document.getElementById('pane-url'), upload: document.getElementById('pane-upload') };
  const iconShowPane = () => {
    Object.entries(iconPanes).forEach(([k, el]) => { if (el) el.style.display = (k === iconType) ? '' : 'none'; });
    document.querySelectorAll('#iconMode [data-im]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.im === iconType)));
  };
  const iconUpdatePreview = () => {
    let src = null;
    const dtype = document.getElementById('f-type').value;
    if (iconType === 'selfhst' && iconValue) src = selfhstUrl(iconValue);
    else if (iconType === 'builtin') src = builtinDataUri(iconValue || defaultIconForType(dtype));
    else if ((iconType === 'url' || iconType === 'upload') && iconValue) src = iconValue;
    iconPreview.innerHTML = src ? `<img src="${esc(src)}" alt="Icon preview">` : '<span class="icon-preview__none">no icon</span>';
    const im = iconPreview.querySelector('img'); if (im) im.onerror = () => { iconPreview.innerHTML = '<span class="icon-preview__none">broken</span>'; };
    if (iconGrid) iconGrid.querySelectorAll('.icon-opt').forEach(b => b.classList.toggle('sel', iconType === 'builtin' && b.dataset.icon === (iconValue || defaultIconForType(dtype))));
    document.querySelectorAll('#fi-quick .quickpick__item').forEach(b => b.classList.toggle('sel', iconType === 'selfhst' && b.dataset.slug === iconValue));
  };
  document.querySelectorAll('#iconMode [data-im]').forEach(b => b.addEventListener('click', () => {
    iconType = b.dataset.im;
    if (iconType === '') iconValue = '';
    else if (iconType === 'selfhst') { iconValue = (document.getElementById('fi-slug').value.trim() || iconValue || defaultSlugForType(document.getElementById('f-type').value)); document.getElementById('fi-slug').value = iconValue; loadSelfhstIndex(); }
    else if (iconType === 'builtin' && !iconValue) iconValue = defaultIconForType(document.getElementById('f-type').value);
    else if (iconType === 'url') iconValue = document.getElementById('fi-url').value.trim();
    iconShowPane(); iconUpdatePreview();
  }));
  if (iconGrid) iconGrid.querySelectorAll('.icon-opt').forEach(b => b.addEventListener('click', () => { iconType = 'builtin'; iconValue = b.dataset.icon; iconShowPane(); iconUpdatePreview(); }));
  document.querySelectorAll('#fi-quick .quickpick__item').forEach(b => b.addEventListener('click', () => {
    iconType = 'selfhst'; iconValue = b.dataset.slug;
    document.getElementById('fi-slug').value = iconValue; document.getElementById('fi-suggest').classList.remove('open');
    iconShowPane(); iconUpdatePreview();
  }));
  const slugInput = document.getElementById('fi-slug');
  const suggestBox = document.getElementById('fi-suggest');
  const renderSuggest = (q) => {
    q = q.trim().toLowerCase();
    if (!q || !_selfhstIndex || !_selfhstIndex.length) { suggestBox.classList.remove('open'); suggestBox.innerHTML = ''; slugInput.setAttribute('aria-expanded', 'false'); return; }
    const hits = _selfhstIndex.filter(x => x.slug.includes(q) || (x.name || '').toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { suggestBox.classList.remove('open'); slugInput.setAttribute('aria-expanded', 'false'); return; }
    suggestBox.innerHTML = hits.map(h => `<button type="button" class="isuggest" role="option" data-slug="${esc(h.slug)}"><img src="${selfhstUrl(h.slug)}" alt="" loading="lazy"><span>${esc(h.name || h.slug)}</span><span class="isuggest__slug">${esc(h.slug)}</span></button>`).join('');
    suggestBox.classList.add('open'); slugInput.setAttribute('aria-expanded', 'true');
    suggestBox.querySelectorAll('.isuggest').forEach(b => b.addEventListener('mousedown', (e) => { e.preventDefault(); iconType = 'selfhst'; iconValue = b.dataset.slug; slugInput.value = iconValue; suggestBox.classList.remove('open'); slugInput.setAttribute('aria-expanded', 'false'); iconUpdatePreview(); }));
  };
  slugInput.addEventListener('focus', () => loadSelfhstIndex().then(() => renderSuggest(slugInput.value)));
  slugInput.addEventListener('input', () => { iconType = 'selfhst'; iconValue = slugInput.value.trim(); renderSuggest(slugInput.value); iconUpdatePreview(); });
  slugInput.addEventListener('blur', () => setTimeout(() => suggestBox.classList.remove('open'), 150));
  document.getElementById('fi-url').addEventListener('input', (e) => { if (iconType === 'url') { iconValue = e.target.value.trim(); iconUpdatePreview(); } });
  document.getElementById('fi-file').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast('Image too large (>4MB)', 'err'); e.target.value = ''; return; }
    downscaleImage(file, 128, (dataUrl) => {
      if (!dataUrl) { toast('Could not read that image', 'err'); return; }
      if (dataUrl.length > 300000) { toast('Icon still too big after downscale', 'err'); return; }
      iconType = 'upload'; iconValue = dataUrl; iconShowPane(); iconUpdatePreview();
    });
  });
  document.getElementById('f-type').addEventListener('change', iconUpdatePreview);
  iconShowPane(); iconUpdatePreview();

  const form = document.getElementById('nodeForm');
  const submit = async () => {
    if (!canEdit()) return;
    const name = document.getElementById('f-name').value.trim();
    const ff = document.getElementById('ff-name');
    if (!name) { ff.classList.add('invalid'); document.getElementById('f-name').focus(); return; }
    ff.classList.remove('invalid');
    const data = {
      name,
      type: document.getElementById('f-type').value,
      parentId: document.getElementById('f-parent').value || null,
      ipAddress: document.getElementById('f-ip').value.trim(),
      macAddress: document.getElementById('f-mac').value.trim(),
      os: document.getElementById('f-os').value.trim(),
      role: document.getElementById('f-role').value.trim(),
      status: document.getElementById('f-status').value,
      networkId: document.getElementById('f-network').value || null,
      iconType: iconType,
      iconValue: iconType === 'url' ? document.getElementById('fi-url').value.trim()
        : iconType === 'selfhst' ? document.getElementById('fi-slug').value.trim().toLowerCase()
        : (iconType ? iconValue : ''),
      tags: document.getElementById('f-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      notes: document.getElementById('f-notes').value.trim(),
    };
    const saveBtn = document.getElementById('nodeSave');
    saveBtn.disabled = true;
    try {
      if (editing) {
        const updated = await api.updateNode(id, data);
        replaceNode(updated);
      } else {
        const parent = data.parentId ? nodeById(data.parentId) : null;
        data.posX = parent ? Math.round((parent.posX || 0) + (Math.random()*120 - 60)) : Math.round(Math.random()*200 - 100);
        data.posY = parent ? (parent.posY || 0) + 150 : 0;
        const created = await api.createNode(data);
        state.nodes.push(created);
        selectedId = created.id;
      }
      syncGraph(); renderDetail(); refreshChrome(); openSidebar();
      if (!editing && network && !REDUCE) network.focus(selectedId, { scale: network.getScale(), animation: { duration: 400, easingFunction: 'easeInOutCubic' } });
      closeModal();
      toast(editing ? 'Node updated' : 'Node added', 'ok');
    } catch (e) {
      saveBtn.disabled = false;
      toast(e.message, 'err');
    }
  };
  document.getElementById('nodeSave').addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  document.getElementById('f-network-add').addEventListener('click', () => {
    openNetworkFormModal(null, (newId) => {
      openNodeModal(editing ? id : null);
      const sel = document.getElementById('f-network'); if (sel) sel.value = newId;
    });
  });
}

function descendantIds(id) {
  const out = new Set();
  const walk = (pid) => state.nodes.filter(n => n.parentId === pid).forEach(c => { if (!out.has(c.id)) { out.add(c.id); walk(c.id); } });
  walk(id); return out;
}

/* ---- Port modal (add + edit) ---- */
function openPortModal(nodeId = selectedId, portId = null) {
  if (!requireEdit()) return;
  if (!nodeId) { toast('Select a node first', 'err'); return; }
  const node = state.nodes.find(n => n.id === nodeId);
  const editing = portId ? state.ports.find(p => p.id === portId) : null;
  const p = editing || { portNumber:'', protocol:'tcp', serviceName:'', description:'', domain:'', exposure:'internal', scheme:'http', hostPort:null, targetNodeId:null, status:'in_use' };
  const fwdOpts = ['<option value="">— none</option>']
    .concat(state.nodes.filter(x => x.id !== nodeId).map(x => `<option value="${x.id}" ${p.targetNodeId === x.id ? 'selected' : ''}>${esc(x.name)} · ${TYPES[x.type].label}</option>`)).join('');

  openModal(`
    <div class="modal__head">
      <h3 id="modalTitle">${editing ? 'Edit port' : 'Add port'} <span style="color:var(--fg-muted);font-weight:500">· ${esc(node.name)}</span></h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
    </div>
    <form id="portForm" class="modal__body" novalidate>
      <div class="form-grid">
        <div class="form-field" id="ff-port">
          <label for="f-port">Port <span class="req">*</span></label>
          <input class="input" id="f-port" type="number" min="1" max="65535" value="${p.portNumber}" placeholder="8080" required>
          <div class="form-error">Enter 1–65535.</div>
        </div>
        <div class="form-field">
          <label for="f-proto">Protocol</label>
          <select class="input" id="f-proto">
            <option value="tcp" ${p.protocol==='tcp'?'selected':''}>TCP</option>
            <option value="udp" ${p.protocol==='udp'?'selected':''}>UDP</option>
          </select>
        </div>
        <div class="form-field full">
          <label for="f-svc">Service</label>
          <input class="input" id="f-svc" value="${esc(p.serviceName)}" placeholder="http, ssh, jellyfin…" autocomplete="off">
        </div>
        <div class="form-field full">
          <label for="f-desc">Description</label>
          <input class="input" id="f-desc" value="${esc(p.description)}" placeholder="What listens here" autocomplete="off">
        </div>
        <div class="form-field full">
          <label for="f-domain">Public domain</label>
          <input class="input" id="f-domain" value="${esc(p.domain || '')}" placeholder="service.example.com" autocomplete="off" inputmode="url">
          <div class="hint">Optional — e.g. a Cloudflare Tunnel hostname mapped to this ip:port. Marks the port as internet-reachable.</div>
        </div>
        <div class="form-field">
          <label for="f-exposure">Exposure</label>
          <select class="input" id="f-exposure">
            <option value="internal" ${p.exposure==='internal'?'selected':''}>Internal · host only</option>
            <option value="lan" ${p.exposure==='lan'?'selected':''}>LAN · local network</option>
            <option value="public" ${p.exposure==='public'?'selected':''}>Public · internet</option>
          </select>
        </div>
        <div class="form-field">
          <label for="f-scheme">Scheme</label>
          <select class="input" id="f-scheme">
            <option value="http" ${(p.scheme||inferScheme(p))==='http'?'selected':''}>http</option>
            <option value="https" ${(p.scheme||inferScheme(p))==='https'?'selected':''}>https</option>
          </select>
        </div>
        <div class="form-field">
          <label for="f-pstatus">State</label>
          <select class="input" id="f-pstatus">
            <option value="in_use" ${p.status==='in_use'?'selected':''}>In use</option>
            <option value="reserved" ${p.status==='reserved'?'selected':''}>Reserved</option>
          </select>
        </div>
        <div class="form-field">
          <label for="f-hostport">Published host port</label>
          <input class="input" id="f-hostport" type="number" min="1" max="65535" value="${p.hostPort ?? ''}" placeholder="e.g. 8080" autocomplete="off">
          <div class="hint">Host port this maps to (Docker publish).</div>
        </div>
        <div class="form-field full">
          <label for="f-target">Forwards to</label>
          <select class="input" id="f-target">${fwdOpts}</select>
          <div class="hint">Node this routes to — reverse-proxy / container behind it.</div>
        </div>
      </div>
      <div class="form-error" id="dupErr" style="margin-top:8px">That port + protocol already exists on this node.</div>
    </form>
    <div class="modal__foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn--primary" id="portSave">${editing ? 'Save changes' : 'Add port'}</button>
    </div>`);

  const submit = async () => {
    if (!canEdit()) return;
    const numEl = document.getElementById('f-port');
    const num = parseInt(numEl.value);
    const ffp = document.getElementById('ff-port');
    if (!num || num < 1 || num > 65535) { ffp.classList.add('invalid'); numEl.focus(); return; }
    ffp.classList.remove('invalid');
    const proto = document.getElementById('f-proto').value;
    document.getElementById('dupErr').style.display = 'none';
    // client-side pre-check for instant feedback; the server is authoritative (409 handled below)
    const clash = state.ports.some(x => x.nodeId === nodeId && x.portNumber === num && x.protocol === proto && x.id !== (editing?.id));
    if (clash) { document.getElementById('dupErr').style.display = 'block'; return; }
    const domain = document.getElementById('f-domain').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    let exposure = document.getElementById('f-exposure').value;
    if (domain && exposure !== 'public') exposure = 'public';
    const hostPortRaw = document.getElementById('f-hostport').value.trim();
    const hostPort = hostPortRaw ? (Math.max(1, Math.min(65535, parseInt(hostPortRaw) || 0)) || null) : null;
    const data = {
      portNumber: num, protocol: proto,
      serviceName: document.getElementById('f-svc').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      domain,
      exposure,
      scheme: document.getElementById('f-scheme').value,
      hostPort,
      targetNodeId: document.getElementById('f-target').value || null,
      status: document.getElementById('f-pstatus').value,
    };
    const saveBtn = document.getElementById('portSave');
    saveBtn.disabled = true;
    try {
      if (editing) { const up = await api.updatePort(editing.id, data); replacePort(up); }
      else { const cp = await api.createPort(nodeId, data); state.ports.push(cp); }
      renderDetail(); refreshGraphNode(nodeId); refreshChrome();
      closeModal();
      toast(editing ? 'Port updated' : 'Port added', 'ok');
    } catch (e) {
      saveBtn.disabled = false;
      if (e.code === 'port_conflict') document.getElementById('dupErr').style.display = 'block';
      toast(e.message, 'err');
    }
  };
  document.getElementById('portSave').addEventListener('click', submit);
  document.getElementById('portForm').addEventListener('submit', (e)=>{ e.preventDefault(); submit(); });
  const domEl = document.getElementById('f-domain');
  domEl.addEventListener('input', () => {
    if (domEl.value.trim()) { document.getElementById('f-exposure').value = 'public'; document.getElementById('f-scheme').value = 'https'; }
  });
}

window.deletePort = async function(portId) {
  if (!canEdit()) return;
  const p = state.ports.find(x => x.id === portId);
  if (!p) return;
  try {
    await api.deletePort(portId);
    state.ports = state.ports.filter(x => x.id !== portId);
    renderDetail(); refreshGraphNode(p.nodeId); refreshChrome();
    toast('Port ' + p.portNumber + '/' + p.protocol + ' removed', 'ok');
  } catch (e) { toast(e.message, 'err'); }
};

/* ---- delete node (server reparents children + cascades ports) ---- */
function confirmDeleteNode(id) {
  if (!requireEdit()) return;
  const n = state.nodes.find(x => x.id === id);
  if (!n) return;
  const kids = state.nodes.filter(x => x.parentId === id);
  const portCount = state.ports.filter(p => p.nodeId === id).length;
  const grandparent = n.parentId ? state.nodes.find(x => x.id === n.parentId) : null;
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Delete node</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
    </div>
    <div class="modal__body">
      <p class="confirm-text">Delete <strong>${esc(n.name)}</strong> and its <strong>${portCount}</strong> port${portCount===1?'':'s'}? This can't be undone.</p>
      ${kids.length ? `<div class="warn-box">${kids.length} child node${kids.length===1?'':'s'} (${kids.map(k=>esc(k.name)).join(', ')}) will be ${grandparent ? `re-parented to <strong>${esc(grandparent.name)}</strong>` : 'promoted to root'}.</div>` : ''}
    </div>
    <div class="modal__foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn--danger" id="delConfirm">Delete node</button>
    </div>`);
  document.getElementById('delConfirm').addEventListener('click', async () => {
    const btn = document.getElementById('delConfirm');
    btn.disabled = true;
    try {
      await api.deleteNode(id);
      const wasSelected = selectedId === id;
      if (wasSelected) selectedId = null;
      await reloadState();
      syncGraph(); renderDetail(); refreshChrome();
      if (wasSelected) closeSidebar(); else updateReopen();
      closeModal();
      toast('Node deleted', 'ok');
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  });
}

/* ================= DATA MENU ================= */
const menuOverlay = document.getElementById('menuOverlay');
document.getElementById('btnMenu').addEventListener('click', () => menuOverlay.classList.add('open'));
menuOverlay.addEventListener('mousedown', (e) => { if (e.target === menuOverlay || e.target.hasAttribute('data-close-menu') || e.target.closest('[data-close-menu]')) menuOverlay.classList.remove('open'); });

document.getElementById('btnExport').addEventListener('click', async () => {
  try {
    const data = await api.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'home-server-topology.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('Exported JSON', 'ok');
  } catch (e) { toast('Export failed: ' + e.message, 'err'); }
});
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change', (e) => {
  if (!canEdit()) { toast('Log in to import', 'err'); e.target.value = ''; return; }
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.nodes)) throw new Error('missing nodes array');
      const result = await api.importAll(d);
      state = { nodes: result.nodes || [], ports: result.ports || [], networks: result.networks || [], links: result.links || [] };
      selectedId = null;
      syncGraph(); renderDetail(); refreshChrome(); closeSidebar();
      menuOverlay.classList.remove('open');
      setTimeout(() => network.fit({ animation: !REDUCE }), 40);
      toast('Imported ' + state.nodes.length + ' nodes', 'ok');
    } catch (err) { toast('Import failed: ' + (err.message || 'invalid JSON'), 'err'); }
  };
  reader.readAsText(file); e.target.value = '';
});
document.getElementById('btnReset').addEventListener('click', () => {
  menuOverlay.classList.remove('open');
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Reset to sample data</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
    </div>
    <div class="modal__body"><p class="confirm-text">This replaces everything on the server with the illustrative sample topology. Your current data will be lost unless you exported it.</p></div>
    <div class="modal__foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn--danger" id="resetConfirm">Reset everything</button>
    </div>`);
  document.getElementById('resetConfirm').addEventListener('click', async () => {
    if (!canEdit()) return;
    const btn = document.getElementById('resetConfirm');
    btn.disabled = true;
    try {
      const result = await api.importAll(seedData());
      state = { nodes: result.nodes || [], ports: result.ports || [], networks: result.networks || [], links: result.links || [] };
      selectedId = null;
      syncGraph(); renderDetail(); refreshChrome(); closeSidebar();
      localStorage.removeItem('hst-banner');
      document.getElementById('sampleBanner').style.display = '';
      setTimeout(() => network.fit({ animation: true }), 40);
      closeModal(); toast('Reset to sample data', 'ok');
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  });
});

/* ================= API TOKEN MANAGER (Fase 2d) =================
   Session-only. Lists / creates / revokes bearer tokens for LLM / automation
   access. The plaintext token is shown ONCE, at creation. */
function openTokensModal() {
  if (!requireEdit()) return;
  menuOverlay.classList.remove('open');
  renderTokensModal(null);
}
function tokenRow(t) {
  const scopeCls = t.revoked ? 'tok-scope--revoked' : (t.scope === 'read_write' ? 'tok-scope--rw' : 'tok-scope--read');
  const scopeLbl = t.revoked ? 'revoked' : t.scope;
  const fmt = (v) => v ? new Date(v).toLocaleDateString() : '';
  const used = t.lastUsedAt ? ('last used ' + fmt(t.lastUsedAt)) : 'never used';
  return `<div class="tok-row ${t.revoked ? 'is-revoked' : ''}">
    <div class="tok-row__body">
      <div class="tok-row__title">${esc(t.name)} <span class="tok-scope ${scopeCls}">${esc(scopeLbl)}</span></div>
      <div class="tok-row__sub"><span class="tok-row__prefix">${esc(t.prefix)}…</span> · created ${esc(fmt(t.createdAt))} · ${esc(used)}</div>
    </div>
    ${t.revoked ? '' : `<div class="tok-row__actions"><button class="btn btn--ghost btn--icon btn--sm btn--danger" data-revoke="${t.id}" title="Revoke token" aria-label="Revoke ${esc(t.name)}">${TRASH_ICON}</button></div>`}
  </div>`;
}
async function renderTokensModal(revealed) {
  let tokens = [];
  try { tokens = await api.listTokens(); }
  catch (e) { toast(e.message, 'err'); return; }
  const list = tokens.length
    ? `<div class="tok-list">${tokens.map(tokenRow).join('')}</div>`
    : `<div class="tok-empty"><p>No API tokens yet. Create one to let an LLM or script read (or update) your topology.</p></div>`;
  const revealHtml = revealed ? `
    <div class="tok-reveal">
      <p class="tok-reveal__warn">${WARN_ICON}Copy this token now — it won't be shown again.</p>
      <div class="tok-reveal__row">
        <code class="tok-reveal__val" id="tokPlain">${esc(revealed.token)}</code>
        <button class="btn btn--primary btn--sm" id="tokCopy" data-token="${esc(revealed.token)}">Copy</button>
      </div>
    </div>` : '';
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">API tokens</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button></div>
    <div class="modal__body">
      <p class="confirm-text" style="margin-top:0">Bearer tokens for LLMs / automation. <span class="mono">read</span> = GET only · <span class="mono">read_write</span> = full access. Send as <span class="mono">Authorization: Bearer &lt;token&gt;</span>.</p>
      ${revealHtml}
      ${list}
      <div class="tok-create">
        <div class="form-grid">
          <div class="form-field full" id="ff-tokname"><label for="tok-name">Name <span class="req">*</span></label>
            <input class="input" id="tok-name" placeholder="e.g. claude-readonly" autocomplete="off"><div class="form-error">Name is required.</div></div>
          <div class="form-field full"><label for="tok-scope">Scope</label>
            <select class="input" id="tok-scope"><option value="read">read · GET only</option><option value="read_write">read_write · full access</option></select></div>
        </div>
        <button class="btn btn--primary" id="tokCreate" style="margin-top:var(--sp-2)">${PLUS_ICON} Create token</button>
      </div>
    </div>
    <div class="modal__foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  const copyBtn = document.getElementById('tokCopy');
  if (copyBtn) copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(copyBtn.dataset.token).then(() => toast('Token copied', 'ok')); });
  modalRoot.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.revokeToken(b.dataset.revoke); toast('Token revoked', 'ok'); renderTokensModal(null); }
    catch (e) { b.disabled = false; toast(e.message, 'err'); }
  }));
  const create = async () => {
    const nameEl = document.getElementById('tok-name');
    const name = nameEl.value.trim();
    const ff = document.getElementById('ff-tokname');
    if (!name) { ff.classList.add('invalid'); nameEl.focus(); return; }
    ff.classList.remove('invalid');
    const scope = document.getElementById('tok-scope').value;
    const btn = document.getElementById('tokCreate');
    btn.disabled = true;
    try { const res = await api.createToken(name, scope); toast('Token created', 'ok'); renderTokensModal(res); }
    catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  };
  document.getElementById('tokCreate').addEventListener('click', create);
}

/* ================= LEGEND ================= */
function renderLayers() {
  document.querySelectorAll('#colorBySeg [data-cb]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cb === colorBy)));
  const grid = document.getElementById('legendGrid');
  if (colorBy === 'network') {
    const items = state.networks.map(nw => `<div class="legend__item"><span class="legend__dot" style="background:${nw.color}"></span>${esc(nw.name)}${nw.vlanId != null ? ` <span class="legend__vlan">v${nw.vlanId}</span>` : ''}</div>`);
    if (state.nodes.some(n => !n.networkId)) items.push('<div class="legend__item" style="opacity:.65"><span class="legend__dot" style="background:#5a6472"></span>unassigned</div>');
    grid.innerHTML = items.join('') || '<div class="legend__item" style="opacity:.6">No networks yet</div>';
  } else {
    const used = new Set(state.nodes.map(n => n.type));
    grid.innerHTML = TYPE_ORDER.map(k => `<div class="legend__item" style="${used.has(k) ? '' : 'opacity:.4'}"><span class="legend__dot" style="background:${TYPES[k].color}"></span>${TYPES[k].label}</div>`).join('');
  }
  const contCount = state.nodes.filter(n => n.parentId).length;
  const etoggle = (key, label, color, dashed, count) => `<button class="etoggle ${edgeToggles[key] !== false ? 'on' : ''}" data-edge="${key}" aria-pressed="${edgeToggles[key] !== false}"><span class="etoggle__line ${dashed ? 'dashed' : ''}" style="--ec:${color}"></span><span class="etoggle__lbl">${label}</span><span class="etoggle__n">${count}</span></button>`;
  let eh = etoggle('containment', 'Containment', '#5b6675', false, contCount);
  LINK_ORDER.forEach(k => { const c = state.links.filter(l => l.type === k).length; if (c) eh += etoggle(k, LINK_TYPES[k].label, LINK_TYPES[k].color, true, c); });
  document.getElementById('edgeToggleList').innerHTML = eh;
}

/* ================= TOAST ================= */
function toast(msg, kind='ok') {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast toast--' + kind;
  const icon = kind === 'ok'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  el.innerHTML = icon + '<span>' + esc(msg) + '</span>';
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 320); }, 2200);
}

/* ================= NAV HELPERS ================= */
function gotoNode(id, opts = {}) {
  const n = nodeById(id); if (!n) return;
  if (opts.filterReset) portFilter = { proto: 'all', q: '' };
  select(id);
  if (opts.portId) requestAnimationFrame(() => requestAnimationFrame(() => highlightPort(opts.portId)));
}
function highlightPort(portId) {
  const row = document.querySelector(`#detail tr[data-portid="${portId}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' });
  row.classList.remove('row-flash'); void row.offsetWidth; row.classList.add('row-flash');
  setTimeout(() => row.classList.remove('row-flash'), 1600);
}
function conflictLabel(c) {
  if (c.kind === 'ip') return 'Duplicate IP · ' + c.value;
  if (c.kind === 'mac') return 'Duplicate MAC · ' + c.value;
  if (c.kind === 'hostPort') return 'Host port :' + c.value + ' published ' + c.portIds.length + '×';
  return 'Conflict';
}
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const IP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>';
const MAC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>';
const PORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h11"/><path d="m10 8 4 4-4 4"/><rect x="17" y="4" width="4" height="16" rx="1"/></svg>';

/* conflict category metadata: title + icon + why-it-matters (single source for badge + modal) */
const CONFLICT_KINDS = {
  ip:       { title: 'Duplicate IP',        short: 'IP',   icon: IP_ICON,   why: 'Two or more nodes claim the same IP address. Only one can answer on the network — the others go unreachable or respond intermittently.' },
  mac:      { title: 'Duplicate MAC',       short: 'MAC',  icon: MAC_ICON,  why: 'The same MAC appears on more than one node. A switch expects each MAC on a single port; duplicates cause flapping and dropped frames (often a cloned VM or a copy-paste slip).' },
  hostPort: { title: 'Duplicate host port', short: 'port', icon: PORT_ICON, why: 'The same published host port is bound more than once on one host. Only the first binding wins; the rest fail to start with “address already in use”.' },
};
const KIND_ORDER = ['ip', 'mac', 'hostPort'];

/* ================= EXPOSURE SURFACE ================= */
function openExposureModal() {
  const rows = state.ports.filter(p => p.exposure === 'lan' || p.exposure === 'public')
    .map(p => ({ p, n: nodeById(p.nodeId) })).filter(x => x.n)
    .sort((a, b) => (a.p.exposure === b.p.exposure ? 0 : a.p.exposure === 'public' ? -1 : 1));
  const body = rows.length ? `
    <table class="ltable">
      <thead><tr><th>Node</th><th>Address</th><th>Level</th></tr></thead>
      <tbody>${rows.map(({ p, n }) => {
        const exp = EXPOSURE[p.exposure];
        const scheme = p.scheme || inferScheme(p);
        const addr = p.domain
          ? `<a class="port-domain" href="${scheme}://${esc(p.domain)}" target="_blank" rel="noopener noreferrer">${esc(p.domain)}</a>`
          : (portUrl(n, p) ? esc(portUrl(n, p)) : (p.hostPort != null ? `host :${p.hostPort}` : `:${p.portNumber}`));
        return `<tr data-goto="${n.id}" data-portid="${p.id}" tabindex="0" role="button" aria-label="Go to ${esc(n.name)}">
          <td><span class="cmd__dot" style="background:${(TYPES[n.type] || {}).color}"></span>${esc(n.name)}</td>
          <td class="mono lcell">${addr} <span class="muted">:${p.portNumber}${p.serviceName ? ' ' + esc(p.serviceName) : ''}</span></td>
          <td><span class="tag ${exp.cls}">${exp.label}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<div class="ports-empty" style="margin:var(--sp-5)"><p>Nothing is reachable beyond its host — clean surface.</p></div>`;
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Exposure surface</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button>
    </div>
    <div class="modal__body" style="padding:0"><div class="ltable-wrap">${body}</div></div>
    <div class="modal__foot"><span class="muted" style="font-size:12px;margin-right:auto">${rows.length} port${rows.length !== 1 ? 's' : ''} reachable beyond host</span><button class="btn" onclick="closeModal()">Close</button></div>`);
  modalRoot.querySelectorAll('tr[data-goto]').forEach(tr => {
    const go = () => { closeModal(); gotoNode(tr.dataset.goto, { filterReset: true, portId: tr.dataset.portid }); };
    tr.addEventListener('click', (e) => { if (!e.target.closest('a')) go(); });
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

/* ================= CONFLICTS ================= */
/* value line for a single conflict, per kind (mono, host named for port clashes) */
function conflictValueHtml(c) {
  if (c.kind === 'hostPort') {
    const host = nodeById(c.hostId);
    return `<span class="conflict__val">:${esc(c.value)}${host ? ` on <b>${esc(host.name)}</b>` : ''}</span>`;
  }
  return `<span class="conflict__val">${esc(c.value)}</span>`;
}
function openConflictsModal() {
  refreshConflicts();
  let body;
  if (!_conflicts.length) {
    body = `<div class="ports-empty" style="margin:0"><p>No conflicts — no duplicate IP or MAC, and no clashing published host ports.</p></div>`;
  } else {
    body = `<p class="confirm-text" style="margin-top:0">These overlaps cause real connectivity or start-up failures. Click any node to jump to it and fix the clash.</p>`;
    body += KIND_ORDER.filter(k => _conflicts.some(c => c.kind === k)).map(k => {
      const meta = CONFLICT_KINDS[k];
      const items = _conflicts.filter(c => c.kind === k);
      const cards = items.map(c => {
        const names = (c.nodeIds || []).map(id => nodeById(id)).filter(Boolean);
        const chips = names.map(nn => `<button class="conflict__node" data-goto="${nn.id}"><span class="cmd__dot" style="background:${(TYPES[nn.type] || {}).color}"></span>${esc(nn.name)}</button>`).join('');
        return `<div class="conflict">
          <div class="conflict__head">${conflictValueHtml(c)}</div>
          <div class="conflict__nodes">${chips}</div>
        </div>`;
      }).join('');
      return `<section class="cfl-group">
        <div class="cfl-group__head">${meta.icon}<h4>${meta.title}</h4><span class="cfl-group__count">${items.length}</span></div>
        <p class="cfl-group__why">${meta.why}</p>
        ${cards}
      </section>`;
    }).join('');
  }
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Conflicts${_conflicts.length ? ` <span class="badge badge--warn" style="vertical-align:middle">${_conflicts.length}</span>` : ''}</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button>
    </div>
    <div class="modal__body">${body}</div>
    <div class="modal__foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  modalRoot.querySelectorAll('.conflict__node[data-goto]').forEach(b => b.addEventListener('click', () => { closeModal(); gotoNode(b.dataset.goto); }));
}

/* ================= NETWORKS MANAGER + FREE-IP FINDER ================= */
let freeIpSel = null;
function computeFreeIps(nw) {
  const c = parseCidr(nw.cidr);
  if (!c) return { error: 'Invalid CIDR' };
  const size = Math.pow(2, 32 - c.prefix);
  let first, last, total;
  if (c.prefix <= 30) { first = c.base + 1; last = c.base + size - 2; total = size - 2; }
  else { first = c.base; last = c.base + size - 1; total = size; }
  const usedSet = new Set(state.nodes.map(n => ipToInt(n.ipAddress)).filter(v => v != null && v >= first && v <= last));
  const usedList = [...usedSet].sort((a, b) => a - b).map(intToIp);
  const freeCount = total - usedSet.size;
  let ranges = null;
  if (total <= 1024) {
    ranges = []; let start = null, prev = null;
    for (let i = first; i <= last; i++) {
      if (!usedSet.has(i)) { if (start === null) start = i; prev = i; }
      else if (start !== null) { ranges.push([start, prev]); start = null; }
    }
    if (start !== null) ranges.push([start, prev]);
  }
  return { total, freeCount, usedCount: usedSet.size, usedList, ranges };
}
function renderFreeIpSummary(nwId) {
  const nw = nwById(nwId);
  if (!nw) return '<div class="muted" style="font-size:13px">Select a network.</div>';
  const r = computeFreeIps(nw);
  if (r.error) return `<div style="color:var(--down);font-size:13px">Can't parse “${esc(nw.cidr)}” — expected IPv4 CIDR like 10.20.30.0/24.</div>`;
  let list;
  if (r.ranges) {
    const MAX = 16;
    const chips = r.ranges.slice(0, MAX).map(([a, b]) => `<span class="chip">${a === b ? intToIp(a) : intToIp(a) + ' – ' + intToIp(b)}</span>`).join('');
    const more = r.ranges.length > MAX ? `<span class="chip chip--more">+${r.ranges.length - MAX} more</span>` : '';
    list = r.ranges.length ? `<div class="chips">${chips}${more}</div>` : `<span class="muted" style="font-size:13px">No free IPs in this range.</span>`;
  } else {
    list = `<div class="muted" style="font-size:12px;margin-top:6px">${r.total.toLocaleString()} hosts — too large to enumerate. ${r.usedCount} used${r.usedList.length ? ': ' + r.usedList.slice(0, 24).join(', ') + (r.usedList.length > 24 ? '…' : '') : ''}.</div>`;
  }
  return `
    <div class="free__stat">
      <span><b>${r.freeCount.toLocaleString()}</b> free</span>
      <span class="used"><b>${r.usedCount}</b> used</span>
      <span style="color:var(--fg-muted)">of ${r.total.toLocaleString()} hosts</span>
    </div>${list}`;
}
function openNetworksModal() {
  const list = state.networks.length ? state.networks.map(w => {
    const inUse = state.nodes.filter(n => n.networkId === w.id).length;
    return `<div class="mrow">
      <span class="mrow__swatch" style="background:${w.color}"></span>
      <div class="mrow__body">
        <div class="mrow__title">${esc(w.name)} ${w.vlanId != null ? `<span class="badge" style="font-size:10px;padding:1px 6px">VLAN ${w.vlanId}</span>` : ''}</div>
        <div class="mrow__sub mono">${esc(w.cidr)} · ${inUse} node${inUse !== 1 ? 's' : ''}</div>
      </div>
      ${canEdit() ? `<div class="mrow__actions">
        <button class="btn btn--ghost btn--icon btn--sm" data-edit-net="${w.id}" aria-label="Edit ${esc(w.name)}">${EDIT_ICON}</button>
        <button class="btn btn--ghost btn--icon btn--sm btn--danger" data-del-net="${w.id}" aria-label="Delete ${esc(w.name)}">${TRASH_ICON}</button>
      </div>` : ''}
    </div>`;
  }).join('') : `<div class="ports-empty" style="margin:0"><p>No networks yet${canEdit() ? ' — add one to group nodes by subnet/VLAN' : ''}.</p></div>`;
  const sel = (freeIpSel && nwById(freeIpSel)) ? freeIpSel : (state.networks[0] && state.networks[0].id) || '';
  const netSelOpts = state.networks.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)} · ${esc(w.cidr)}</option>`).join('');
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Networks</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button></div>
    <div class="modal__body">
      <div class="mlist">${list}</div>
      ${canEdit() ? `<button class="btn btn--sm" id="netAdd" style="margin-top:var(--sp-3)">${PLUS_ICON} Add network</button>` : ''}
      ${state.networks.length ? `
      <div class="free" style="margin-top:var(--sp-5)">
        <div class="free__head">${IP_ICON}<h4>Free-IP finder</h4></div>
        <div class="form-field" style="margin-bottom:var(--sp-3)">
          <label for="freeIpNet">Network</label>
          <select class="input" id="freeIpNet">${netSelOpts}</select>
        </div>
        <div class="free__summary" id="freeIpSummary">${renderFreeIpSummary(sel)}</div>
      </div>` : ''}
    </div>
    <div class="modal__foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  modalRoot.querySelectorAll('[data-edit-net]').forEach(b => b.addEventListener('click', () => openNetworkFormModal(b.dataset.editNet)));
  modalRoot.querySelectorAll('[data-del-net]').forEach(b => b.addEventListener('click', () => confirmDeleteNetwork(b.dataset.delNet)));
  const na = document.getElementById('netAdd'); if (na) na.addEventListener('click', () => openNetworkFormModal(null));
  const fis = document.getElementById('freeIpNet');
  if (fis) fis.addEventListener('change', () => { freeIpSel = fis.value; document.getElementById('freeIpSummary').innerHTML = renderFreeIpSummary(fis.value); });
}
function openNetworkFormModal(id, onSaved) {
  if (!requireEdit()) return;
  const editing = id ? nwById(id) : null;
  const w = editing || { name: '', cidr: '', vlanId: null, color: NET_COLORS[state.networks.length % NET_COLORS.length] };
  const swatches = NET_COLORS.map(c => `<button type="button" class="swatch ${w.color === c ? 'sel' : ''}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('');
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">${editing ? 'Edit network' : 'Add network'}</h3>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button></div>
    <form id="netForm" class="modal__body" novalidate>
      <div class="form-grid">
        <div class="form-field full" id="ff-netname"><label for="fn-name">Name <span class="req">*</span></label>
          <input class="input" id="fn-name" value="${esc(w.name)}" placeholder="servers" autocomplete="off"><div class="form-error">Name is required.</div></div>
        <div class="form-field" id="ff-cidr"><label for="fn-cidr">CIDR <span class="req">*</span></label>
          <input class="input" id="fn-cidr" value="${esc(w.cidr)}" placeholder="10.20.30.0/24" autocomplete="off"><div class="form-error">Invalid IPv4 CIDR.</div></div>
        <div class="form-field"><label for="fn-vlan">VLAN ID</label>
          <input class="input" id="fn-vlan" type="number" min="1" max="4094" value="${w.vlanId ?? ''}" placeholder="30" autocomplete="off"></div>
        <div class="form-field full"><label>Colour</label><div class="swatches" id="fn-swatches">${swatches}</div><input type="hidden" id="fn-color" value="${w.color}"></div>
      </div>
    </form>
    <div class="modal__foot"><button class="btn" onclick="openNetworksModal()">Cancel</button><button class="btn btn--primary" id="netSave">${editing ? 'Save changes' : 'Add network'}</button></div>`);
  modalRoot.querySelectorAll('.swatch').forEach(s => s.addEventListener('click', () => {
    modalRoot.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel')); s.classList.add('sel');
    document.getElementById('fn-color').value = s.dataset.color;
  }));
  const submit = async () => {
    if (!canEdit()) return;
    const name = document.getElementById('fn-name').value.trim();
    const cidr = document.getElementById('fn-cidr').value.trim();
    const ffn = document.getElementById('ff-netname'), ffc = document.getElementById('ff-cidr');
    let bad = false;
    if (!name) { ffn.classList.add('invalid'); bad = true; } else ffn.classList.remove('invalid');
    if (!parseCidr(cidr)) { ffc.classList.add('invalid'); bad = true; } else ffc.classList.remove('invalid');
    if (bad) return;
    const vlanRaw = document.getElementById('fn-vlan').value.trim();
    const data = { name, cidr, vlanId: vlanRaw ? parseInt(vlanRaw) : null, color: document.getElementById('fn-color').value };
    const btn = document.getElementById('netSave');
    btn.disabled = true;
    try {
      let saved;
      if (editing) { saved = await api.updateNetwork(editing.id, data); replaceNetwork(saved); }
      else { saved = await api.createNetwork(data); state.networks.push(saved); }
      syncGraph(); refreshChrome(); if (selectedId) renderDetail();
      if (onSaved) onSaved(saved.id); else openNetworksModal();
      toast(editing ? 'Network updated' : 'Network added', 'ok');
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  };
  document.getElementById('netSave').addEventListener('click', submit);
  document.getElementById('netForm').addEventListener('submit', e => { e.preventDefault(); submit(); });
}
function confirmDeleteNetwork(id) {
  if (!canEdit()) return;
  const w = nwById(id); if (!w) return;
  const assigned = state.nodes.filter(n => n.networkId === id).length;
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Delete network</h3><button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button></div>
    <div class="modal__body"><p class="confirm-text">Delete network <strong>${esc(w.name)}</strong> (<span class="mono">${esc(w.cidr)}</span>)?</p>
      ${assigned ? `<div class="warn-box">${assigned} node${assigned !== 1 ? 's' : ''} will be set to no network.</div>` : ''}</div>
    <div class="modal__foot"><button class="btn" onclick="openNetworksModal()">Cancel</button><button class="btn btn--danger" id="delNetOk">Delete network</button></div>`);
  document.getElementById('delNetOk').addEventListener('click', async () => {
    const btn = document.getElementById('delNetOk');
    btn.disabled = true;
    try {
      await api.deleteNetwork(id);
      if (freeIpSel === id) freeIpSel = null;
      await reloadState();
      syncGraph(); refreshChrome(); if (selectedId) renderDetail();
      openNetworksModal(); toast('Network deleted', 'ok');
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  });
}

/* ================= LINKS MANAGER ================= */
function openLinksModal() {
  const list = state.links.length ? state.links.map(lk => {
    const t = LINK_TYPES[lk.type] || LINK_TYPES.custom;
    const f = nodeById(lk.fromNodeId), tn = nodeById(lk.toNodeId);
    return `<div class="mrow">
      <span class="mrow__swatch" style="background:${t.color}"></span>
      <div class="mrow__body">
        <div class="mrow__title">${esc(f ? f.name : '—')} <span class="mrow__arrow">→</span> ${esc(tn ? tn.name : '(removed)')} ${lk.label ? `<span class="badge" style="font-size:10px;padding:1px 6px">${esc(lk.label)}</span>` : ''}</div>
        <div class="mrow__sub" style="color:${t.color}">${t.label}</div>
      </div>
      ${canEdit() ? `<div class="mrow__actions">
        <button class="btn btn--ghost btn--icon btn--sm" data-edit-link="${lk.id}" aria-label="Edit link">${EDIT_ICON}</button>
        <button class="btn btn--ghost btn--icon btn--sm btn--danger" data-del-link="${lk.id}" aria-label="Delete link">${TRASH_ICON}</button>
      </div>` : ''}
    </div>`;
  }).join('') : `<div class="ports-empty" style="margin:0"><p>No relationship links yet${canEdit() ? ' — map proxy / mount / dns dependencies between nodes' : ''}.</p></div>`;
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">Relationship links</h3><button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button></div>
    <div class="modal__body"><div class="mlist">${list}</div>
      ${canEdit() ? `<button class="btn btn--sm" id="linkAdd" style="margin-top:var(--sp-3)">${PLUS_ICON} Add link</button>` : ''}</div>
    <div class="modal__foot"><button class="btn" onclick="closeModal()">Close</button></div>`);
  modalRoot.querySelectorAll('[data-edit-link]').forEach(b => b.addEventListener('click', () => openLinkFormModal(b.dataset.editLink)));
  modalRoot.querySelectorAll('[data-del-link]').forEach(b => b.addEventListener('click', async () => {
    if (!canEdit()) return;
    b.disabled = true;
    try {
      await api.deleteLink(b.dataset.delLink);
      state.links = state.links.filter(x => x.id !== b.dataset.delLink);
      refreshEdges(); refreshChrome(); if (selectedId) renderDetail();
      openLinksModal(); toast('Link deleted', 'ok');
    } catch (e) { b.disabled = false; toast(e.message, 'err'); }
  }));
  const la = document.getElementById('linkAdd'); if (la) la.addEventListener('click', () => openLinkFormModal(null));
}
function openLinkFormModal(id) {
  if (!requireEdit()) return;
  if (state.nodes.length < 2) { toast('Add at least 2 nodes first', 'err'); return; }
  const editing = id ? state.links.find(l => l.id === id) : null;
  const lk = editing || { fromNodeId: (selectedId || state.nodes[0].id), toNodeId: '', type: 'proxy', label: '' };
  const fromOpts = state.nodes.map(nn => `<option value="${nn.id}" ${nn.id === lk.fromNodeId ? 'selected' : ''}>${esc(nn.name)} · ${TYPES[nn.type].label}</option>`).join('');
  const toOpts = ['<option value="">— choose —</option>'].concat(state.nodes.map(nn => `<option value="${nn.id}" ${nn.id === lk.toNodeId ? 'selected' : ''}>${esc(nn.name)} · ${TYPES[nn.type].label}</option>`)).join('');
  const typeOpts = LINK_ORDER.map(k => `<option value="${k}" ${lk.type === k ? 'selected' : ''}>${LINK_TYPES[k].label}</option>`).join('');
  openModal(`
    <div class="modal__head"><h3 id="modalTitle">${editing ? 'Edit link' : 'Add link'}</h3><button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button></div>
    <form id="linkForm" class="modal__body" novalidate>
      <div class="form-grid">
        <div class="form-field full"><label for="fl-from">From node</label><select class="input" id="fl-from">${fromOpts}</select></div>
        <div class="form-field full" id="ff-lto"><label for="fl-to">To node</label><select class="input" id="fl-to">${toOpts}</select><div class="form-error">Pick a target different from the source.</div></div>
        <div class="form-field"><label for="fl-type">Type</label><select class="input" id="fl-type">${typeOpts}</select></div>
        <div class="form-field"><label for="fl-label">Label</label><input class="input" id="fl-label" value="${esc(lk.label)}" placeholder="optional" autocomplete="off"></div>
      </div>
    </form>
    <div class="modal__foot"><button class="btn" onclick="openLinksModal()">Cancel</button><button class="btn btn--primary" id="linkSave">${editing ? 'Save changes' : 'Add link'}</button></div>`);
  const submit = async () => {
    if (!canEdit()) return;
    const from = document.getElementById('fl-from').value;
    const to = document.getElementById('fl-to').value;
    const ff = document.getElementById('ff-lto');
    if (!to || to === from) { ff.classList.add('invalid'); return; } ff.classList.remove('invalid');
    const data = { fromNodeId: from, toNodeId: to, type: document.getElementById('fl-type').value, label: document.getElementById('fl-label').value.trim() };
    const btn = document.getElementById('linkSave');
    btn.disabled = true;
    try {
      if (editing) { const up = await api.updateLink(editing.id, data); replaceLink(up); }
      else { const cl = await api.createLink(data); state.links.push(cl); }
      refreshEdges(); refreshChrome(); if (selectedId) renderDetail();
      openLinksModal(); toast(editing ? 'Link updated' : 'Link added', 'ok');
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  };
  document.getElementById('linkSave').addEventListener('click', submit);
  document.getElementById('linkForm').addEventListener('submit', e => { e.preventDefault(); submit(); });
}

/* ================= GLOBAL SEARCH / COMMAND PALETTE ================= */
const cmd = document.getElementById('cmd');
const cmdInput = document.getElementById('cmdInput');
const cmdResults = document.getElementById('cmdResults');
let cmdItems = [];
let cmdActive = -1;

function runSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return { nodes: [], ports: [] };
  const nodes = state.nodes.filter(n => [n.name, n.ipAddress, n.macAddress, n.os, (n.tags || []).join(' ')].join(' ').toLowerCase().includes(q)).slice(0, 6);
  const ports = state.ports.filter(p => [String(p.portNumber), p.serviceName, p.domain].join(' ').toLowerCase().includes(q)).slice(0, 8);
  return { nodes, ports };
}
function renderCmd(q) {
  cmdItems = [];
  if (!q.trim()) { closeCmd(); return; }
  const { nodes, ports } = runSearch(q);
  let html = '';
  if (nodes.length) {
    html += `<div class="cmd__group">Nodes</div>`;
    nodes.forEach(n => {
      const i = cmdItems.length; cmdItems.push({ type: 'node', id: n.id });
      const t = TYPES[n.type] || { color: '#7c8aa0', label: n.type };
      html += `<button class="cmd__item" role="option" data-i="${i}"><span class="cmd__dot" style="background:${t.color}"></span><span class="cmd__main">${esc(n.name)}</span><span class="cmd__meta">${esc(n.ipAddress || t.label)}</span></button>`;
    });
  }
  if (ports.length) {
    html += `<div class="cmd__group">Ports</div>`;
    ports.forEach(p => {
      const host = nodeById(p.nodeId);
      const i = cmdItems.length; cmdItems.push({ type: 'port', id: p.id, nodeId: p.nodeId });
      html += `<button class="cmd__item" role="option" data-i="${i}"><span class="cmd__port">:${p.portNumber}</span><span class="cmd__main">${esc(p.serviceName || 'port')}${p.domain ? ' · ' + esc(p.domain) : ''}</span><span class="cmd__meta">${esc(host ? host.name : '')}</span></button>`;
    });
  }
  if (!cmdItems.length) html = `<div class="cmd__empty">No matches for “${esc(q)}”</div>`;
  cmdResults.innerHTML = html;
  cmd.classList.add('open'); cmdInput.setAttribute('aria-expanded', 'true');
  cmdActive = -1; if (cmdItems.length) setActive(0);
  cmdResults.querySelectorAll('.cmd__item').forEach(b => {
    b.addEventListener('mousedown', (e) => { e.preventDefault(); chooseCmd(parseInt(b.dataset.i)); });
    b.addEventListener('mousemove', () => setActive(parseInt(b.dataset.i)));
  });
}
function setActive(i) {
  const items = cmdResults.querySelectorAll('.cmd__item');
  if (!items.length) { cmdActive = -1; return; }
  cmdActive = (i + items.length) % items.length;
  items.forEach((el, idx) => el.classList.toggle('active', idx === cmdActive));
  const a = items[cmdActive]; if (a) { a.scrollIntoView({ block: 'nearest' }); cmdInput.setAttribute('aria-activedescendant', ''); }
}
function chooseCmd(i) {
  const it = cmdItems[i]; if (!it) return;
  closeCmd(); cmdInput.value = ''; cmdInput.blur();
  if (it.type === 'node') gotoNode(it.id);
  else gotoNode(it.nodeId, { filterReset: true, portId: it.id });
}
function closeCmd() { cmd.classList.remove('open'); cmdInput.setAttribute('aria-expanded', 'false'); }

cmdInput.addEventListener('input', () => renderCmd(cmdInput.value));
cmdInput.addEventListener('focus', () => { if (cmdInput.value.trim()) renderCmd(cmdInput.value); });
cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(cmdActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(cmdActive - 1); }
  else if (e.key === 'Enter') { if (cmdActive >= 0) { e.preventDefault(); chooseCmd(cmdActive); } }
  else if (e.key === 'Escape') { e.stopPropagation(); if (cmd.classList.contains('open')) closeCmd(); else { cmdInput.value = ''; cmdInput.blur(); } }
});
document.addEventListener('click', (e) => { if (!cmd.contains(e.target)) closeCmd(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !overlay.classList.contains('open')) {
    e.preventDefault(); cmdInput.focus();
  }
});

/* mobile: expandable search bar */
const topbarEl = document.querySelector('.topbar');
document.getElementById('btnSearch').addEventListener('click', () => {
  const open = topbarEl.classList.toggle('search-open');
  document.getElementById('btnSearch').setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => cmdInput.focus(), 30); else { closeCmd(); cmdInput.value = ''; }
});
cmdInput.addEventListener('blur', () => { setTimeout(() => { if (!cmd.classList.contains('open')) topbarEl.classList.remove('search-open'); }, 150); });

/* exposure stat + warnings badge */
document.getElementById('statStrip').addEventListener('click', (e) => { if (e.target.closest('#statExposed')) openExposureModal(); });
document.getElementById('btnWarnings').addEventListener('click', () => openConflictsModal());

/* auth badge + change-password + tokens */
document.getElementById('btnAuth').addEventListener('click', () => { if (canEdit()) lockEdit(); else openAuthModal('login'); });
document.getElementById('btnChangePw').addEventListener('click', () => { menuOverlay.classList.remove('open'); openAuthModal('change'); });
document.getElementById('btnTokens').addEventListener('click', openTokensModal);

/* ================= LAYERS PANEL ================= */
const layersEl = document.getElementById('layers');
layersEl.addEventListener('click', (e) => {
  const cb = e.target.closest('[data-cb]');
  if (cb) { colorBy = cb.dataset.cb; syncGraph(); renderLayers(); return; }
  const et = e.target.closest('[data-edge]');
  if (et) { const k = et.dataset.edge; edgeToggles[k] = !(edgeToggles[k] !== false); refreshEdges(); renderLayers(); return; }
  if (e.target.closest('#layersToggle')) {
    const collapsed = layersEl.classList.toggle('collapsed');
    document.getElementById('layersToggle').setAttribute('aria-expanded', String(!collapsed));
    return;
  }
  if (e.target.closest('#btnNetworks')) { openNetworksModal(); return; }
  if (e.target.closest('#btnLinks')) { openLinksModal(); return; }
});
if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
  layersEl.classList.add('collapsed');
  document.getElementById('layersToggle').setAttribute('aria-expanded', 'false');
}

/* ================= VIEW TOGGLE + NODE TABLE WIRING ================= */
document.getElementById('viewToggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  setView(b.dataset.view);
});
(() => {
  const filter = document.getElementById('tableFilter');
  if (filter) {
    filter.value = tableQ;
    filter.addEventListener('input', (e) => { tableQ = e.target.value; renderTableRows(); });
  }
  document.querySelectorAll('#tableView thead th[data-sort] .th-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.closest('th').dataset.sort;
      if (tableSort.key === key) tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
      else tableSort = { key, dir: 'asc' };
      try { localStorage.setItem('hst-table-sort', JSON.stringify(tableSort)); } catch (e) {}
      renderTable();
    });
  });
  const body = document.getElementById('tableBody');
  if (body) {
    const activate = (tr) => { const id = tr.dataset.id; if (id) select(id); };
    body.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) activate(tr); });
    body.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(tr); }
    });
  }
})();

/* ================= WIRE TOOLBAR + CANVAS CONTROLS ================= */
document.getElementById('btnProbe').addEventListener('click', (e) => runProbeAll(e.currentTarget));
document.getElementById('btnImportSource').addEventListener('click', openImportModal);
document.getElementById('btnAddNode').addEventListener('click', () => openNodeModal());
document.getElementById('btnArrange').addEventListener('click', autoArrange);
document.getElementById('btnFit').addEventListener('click', () => network.fit({ animation: REDUCE ? false : { duration: 420, easingFunction: 'easeInOutCubic' } }));
document.getElementById('btnZoomIn').addEventListener('click', () => smoothZoomBy(1.35));
document.getElementById('btnZoomOut').addEventListener('click', () => smoothZoomBy(1 / 1.35));
document.getElementById('panelCollapse').addEventListener('click', () => closeSidebar());
document.getElementById('panelReopen').addEventListener('click', () => {
  if (!selectedId) return;
  openSidebar();
  if (network && !REDUCE) network.focus(selectedId, { scale: network.getScale(), animation: { duration: 320, easingFunction: 'easeInOutCubic' } });
});
const banner = document.getElementById('sampleBanner');
if (localStorage.getItem('hst-banner') === 'dismissed') banner.style.display = 'none';
document.getElementById('dismissBanner').addEventListener('click', () => { banner.style.display = 'none'; localStorage.setItem('hst-banner', 'dismissed'); });

/* expose handlers used in inline onclick */
window.openNodeModal = openNodeModal;
window.openPortModal = openPortModal;
window.confirmDeleteNode = confirmDeleteNode;
window.closeModal = closeModal;
window.openConflictsModal = openConflictsModal;
window.openExposureModal = openExposureModal;
window.openAuthModal = openAuthModal;
window.openNetworksModal = openNetworksModal;
window.openLinksModal = openLinksModal;

/* ================= HEALTH CHECK (probe) ================= */
/* Probe-all: TCP-connects every node's ports, refreshes status + last_seen. */
async function runProbeAll(btn) {
  if (!requireEdit()) return;
  withSpinner(btn, 'Checking…');
  try {
    const s = await api.probeAll();
    await reloadState();
    syncGraph(); refreshChrome(); renderDetail();
    toast(`${s.up} up · ${s.down} down · ${s.unknown} unknown`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    clearSpinner(btn);
  }
}
/* Per-node probe (from the detail sidebar). renderDetail rebuilds the button on
   success, so we only restore it on failure. */
async function runProbeNode(id, btn) {
  if (!requireEdit()) return;
  withSpinner(btn);
  try {
    const s = await api.probeNode(id);
    await reloadState();
    syncGraph(); refreshChrome(); renderDetail();
    const r = s.results && s.results[0];
    if (r) {
      const detail = r.status === 'unknown' ? 'nothing probeable (no IP or TCP ports)' : `${r.openPorts}/${r.probeablePorts} port${r.probeablePorts !== 1 ? 's' : ''} open`;
      toast(`${r.name} · ${r.status} — ${detail}`, 'ok');
    } else {
      toast('Probe complete', 'ok');
    }
  } catch (e) {
    clearSpinner(btn);
    toast(e.message, 'err');
  }
}
window.runProbeNode = runProbeNode;

/* ================= IMPORT FROM SOURCE (parse → preview → apply) ================= */
const IMPORT_SOURCES = {
  docker_ps: { label: 'Docker',  hint: 'Output from a Docker host — running containers become nodes, published ports become ports.', cmd: "docker ps   ·   or   docker ps --format '{{json .}}'", kind: 'nodes' },
  ss:        { label: 'ss',      hint: 'Listening sockets from a Linux host — each becomes a port on the node you pick below.',       cmd: 'ss -tlnp   ·   or   ss -tulpn', kind: 'ports' },
  proxmox:   { label: 'Proxmox', hint: 'VM + container inventory from a Proxmox host — each becomes a node.',                          cmd: 'qm list   ·   and   pct list', kind: 'nodes' },
  nmap:      { label: 'nmap',    hint: 'nmap XML scan (paste or load a file) — discovered hosts become nodes, open ports become ports.', cmd: 'nmap -oX - <target>', kind: 'nodes' },
};
const IMPORT_ORDER = ['docker_ps', 'ss', 'proxmox', 'nmap'];
let importWiz = null;

function openImportModal() {
  if (!requireEdit()) return;
  menuOverlay.classList.remove('open');
  importWiz = { step: 1, source: 'docker_ps', text: '', nodeId: (selectedId || ''), parentId: '', networkId: '', parsed: null };
  openModal(`
    <div class="modal__head">
      <h3 id="modalTitle">Import from source</h3>
      <div class="import-steps" id="importSteps" aria-hidden="true"></div>
      <button class="btn btn--ghost btn--icon" onclick="closeModal()" aria-label="Close">${CLOSE_ICON}</button>
    </div>
    <div class="modal__body" id="importBody"></div>
    <div class="modal__foot" id="importFoot"></div>`);
  renderImportStep();
  setTimeout(() => { const t = document.getElementById('importText'); if (t) t.focus(); }, 60);
}
function captureImportStep1() {
  const t = document.getElementById('importText'); if (t) importWiz.text = t.value;
  const nd = document.getElementById('importNode'); if (nd) importWiz.nodeId = nd.value;
  const pr = document.getElementById('importParent'); if (pr) importWiz.parentId = pr.value;
  const nt = document.getElementById('importNet'); if (nt) importWiz.networkId = nt.value;
}
function renderImportStep() {
  const steps = document.getElementById('importSteps');
  if (steps) steps.innerHTML = `
    <span class="import-steps__item ${importWiz.step === 1 ? 'is-active' : 'is-done'}"><span class="import-steps__num">${importWiz.step > 1 ? '✓' : '1'}</span>Source</span>
    <span class="import-steps__sep"></span>
    <span class="import-steps__item ${importWiz.step === 2 ? 'is-active' : ''}"><span class="import-steps__num">2</span>Preview</span>`;
  const body = document.getElementById('importBody');
  const foot = document.getElementById('importFoot');
  if (importWiz.step === 1) renderImportStep1(body, foot);
  else renderImportStep2(body, foot);
}
function renderImportStep1(body, foot) {
  const s = IMPORT_SOURCES[importWiz.source];
  const isSs = importWiz.source === 'ss';
  const nodeOpts = state.nodes.map(nn => `<option value="${nn.id}" ${importWiz.nodeId === nn.id ? 'selected' : ''}>${esc(nn.name)} · ${TYPES[nn.type].label}</option>`).join('');
  const parentOpts = ['<option value="">— none (root)</option>'].concat(state.nodes.map(nn => `<option value="${nn.id}" ${importWiz.parentId === nn.id ? 'selected' : ''}>${esc(nn.name)} · ${TYPES[nn.type].label}</option>`)).join('');
  const netOpts = ['<option value="">— none</option>'].concat(state.networks.map(w => `<option value="${w.id}" ${importWiz.networkId === w.id ? 'selected' : ''}>${esc(w.name)}${w.vlanId != null ? ` · vlan ${w.vlanId}` : ''} · ${esc(w.cidr)}</option>`)).join('');
  body.innerHTML = `
    <div class="form-field full">
      <label id="importSrcLabel">Source</label>
      <div class="seg" id="importSrc" role="group" aria-labelledby="importSrcLabel">
        ${IMPORT_ORDER.map(k => `<button type="button" data-src="${k}" aria-pressed="${importWiz.source === k}">${IMPORT_SOURCES[k].label}</button>`).join('')}
      </div>
      <div class="hint">${esc(s.hint)}</div>
      <div class="import-cmd"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg><span>${esc(s.cmd)}</span></div>
    </div>
    <div class="form-field full">
      <label for="importText">Paste output <span class="req">*</span></label>
      <textarea class="input import-text" id="importText" placeholder="Paste the raw command output here…" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="importFileHint">${esc(importWiz.text)}</textarea>
      <div class="import-file">
        <input type="file" id="importFile" accept=".txt,.xml,.json,text/*,application/xml" class="sr-only">
        <label for="importFile" class="btn btn--sm">Load file…</label>
        <span class="hint" id="importFileHint">${isSs ? 'Reads a text dump into the box.' : (importWiz.source === 'nmap' ? 'nmap -oX XML, or any text dump.' : 'Reads a text / XML / JSON file into the box.')}</span>
      </div>
    </div>
    ${isSs ? `
    <div class="form-field full">
      <label for="importNode">Attach ports to node <span class="req">*</span></label>
      ${state.nodes.length ? `<select class="input" id="importNode">${nodeOpts}</select>` : `<div class="warn-box">Add a node first — <span class="mono">ss</span> ports need a node to attach to.</div>`}
      <div class="hint"><span class="mono">ss</span> lists sockets without a host — pick which node these ports belong to.</div>
    </div>` : `
    <div class="form-grid">
      <div class="form-field"><label for="importParent">Parent node</label><select class="input" id="importParent">${parentOpts}</select><div class="hint">Optional default parent for new nodes.</div></div>
      <div class="form-field"><label for="importNet">Network</label><select class="input" id="importNet">${netOpts}</select><div class="hint">Optional default network.</div></div>
    </div>`}`;
  foot.innerHTML = `
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn--primary" id="importParse">Preview import</button>`;
  body.querySelectorAll('#importSrc [data-src]').forEach(b => b.addEventListener('click', () => {
    captureImportStep1();
    importWiz.source = b.dataset.src;
    renderImportStep();
  }));
  const ta = document.getElementById('importText');
  if (ta) ta.addEventListener('input', () => { importWiz.text = ta.value; });
  const ff = document.getElementById('importFile');
  if (ff) ff.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('File too large (>2MB)', 'err'); e.target.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => { importWiz.text = String(rd.result || ''); const t = document.getElementById('importText'); if (t) t.value = importWiz.text; toast('Loaded ' + file.name, 'ok'); };
    rd.onerror = () => toast('Could not read that file', 'err');
    rd.readAsText(file); e.target.value = '';
  });
  document.getElementById('importParse').addEventListener('click', doImportParse);
}
async function doImportParse() {
  captureImportStep1();
  const text = (importWiz.text || '').trim();
  if (!text) { toast('Paste some output first', 'err'); const t = document.getElementById('importText'); if (t) t.focus(); return; }
  if (importWiz.source === 'ss' && !importWiz.nodeId) { toast('Pick a node to attach ss ports to', 'err'); return; }
  const btn = document.getElementById('importParse');
  withSpinner(btn, 'Parsing…');
  try {
    importWiz.parsed = await api.importParse(importWiz.source, importWiz.text);
    importWiz.step = 2;
    renderImportStep();
  } catch (e) {
    clearSpinner(btn);
    toast(e.message, 'err');
  }
}
function renderImportStep2(body, foot) {
  const p = importWiz.parsed || { nodes: [], ports: [], warnings: [] };
  const nodes = p.nodes || [], ports = p.ports || [], warnings = p.warnings || [];
  const empty = !nodes.length && !ports.length;
  const refName = (ref) => { const nn = nodes.find(x => String(x.ref) === String(ref)); return nn ? nn.name : null; };
  const tgtName = (pt) => {
    if (pt.nodeRef != null && refName(pt.nodeRef)) return refName(pt.nodeRef);
    if (importWiz.nodeId) { const nn = nodeById(importWiz.nodeId); if (nn) return nn.name; }
    return null;
  };
  const warnHtml = warnings.length ? `
    <div class="import-warn">
      <div class="import-warn__head">${WARN_ICON}<span>${warnings.length} warning${warnings.length !== 1 ? 's' : ''}</span></div>
      <ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
    </div>` : '';
  const nodesHtml = nodes.length ? `
    <div class="import-group">
      <div class="import-group__head"><h4>Nodes</h4><span class="import-group__count">${nodes.length}</span></div>
      <div class="ilist">${nodes.map(n => {
        const t = TYPES[n.type] || { color: '#7c8aa0', label: n.type };
        const sc = ['up', 'down', 'unknown'].includes(n.status) ? n.status : 'unknown';
        return `<div class="irow"><span class="cmd__dot" style="background:${t.color}"></span><span class="irow__name">${esc(n.name)}</span>${n.ipAddress ? `<span class="irow__meta">${esc(n.ipAddress)}</span>` : ''}<span class="badge badge--${sc}"><span class="dot"></span>${esc(n.status || 'unknown')}</span></div>`;
      }).join('')}</div>
    </div>` : '';
  const portsHtml = ports.length ? `
    <div class="import-group">
      <div class="import-group__head"><h4>Ports</h4><span class="import-group__count">${ports.length}</span></div>
      <div class="ilist">${ports.map(pt => {
        const exp = EXPOSURE[pt.exposure] || EXPOSURE.internal;
        const tgt = tgtName(pt);
        return `<div class="irow"><span class="irow__port">${esc(pt.portNumber)}/${esc(pt.protocol || 'tcp')}</span><span class="irow__name">${esc(pt.serviceName || 'unnamed')}${pt.hostPort != null ? ` <span class="irow__meta">host :${esc(pt.hostPort)}</span>` : ''}</span>${tgt ? `<span class="irow__tgt">→ ${esc(tgt)}</span>` : '<span class="irow__tgt irow__tgt--none">no target</span>'}<span class="tag ${exp.cls}">${exp.label}</span></div>`;
      }).join('')}</div>
    </div>` : '';
  body.innerHTML = empty
    ? `<div class="ports-empty" style="margin:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg><p>Nothing to import — the parser found no nodes or ports in that output.</p></div>${warnHtml}`
    : `<div class="import-preview">${warnHtml}${nodesHtml}${portsHtml}</div>`;
  foot.innerHTML = `
    <button class="btn" id="importBack">Back</button>
    <button class="btn btn--primary" id="importApply" ${empty ? 'disabled' : ''}>Apply import</button>`;
  document.getElementById('importBack').addEventListener('click', () => { importWiz.step = 1; renderImportStep(); });
  const ap = document.getElementById('importApply');
  if (ap && !empty) ap.addEventListener('click', doImportApply);
}
async function doImportApply() {
  const p = importWiz.parsed; if (!p) return;
  const payload = { nodes: p.nodes || [], ports: p.ports || [] };
  if (importWiz.source === 'ss') { if (importWiz.nodeId) payload.nodeId = importWiz.nodeId; }
  else {
    if (importWiz.parentId) payload.parentId = importWiz.parentId;
    if (importWiz.networkId) payload.networkId = importWiz.networkId;
    if (importWiz.nodeId) payload.nodeId = importWiz.nodeId;   // fallback target for any host-less ports
  }
  const btn = document.getElementById('importApply');
  withSpinner(btn, 'Applying…');
  try {
    const r = await api.importApply(payload);
    await reloadState();
    syncGraph(); refreshChrome(); renderDetail(); updateReopen();
    closeModal();
    setTimeout(() => { if (network) network.fit({ animation: !REDUCE }); }, 40);
    const cn = r.created.nodes, cp = r.created.ports, sn = r.skipped.nodes, sp = r.skipped.ports;
    const skip = (sn || sp) ? ` · skipped ${sn} node${sn !== 1 ? 's' : ''}, ${sp} port${sp !== 1 ? 's' : ''}` : '';
    toast(`Created ${cn} node${cn !== 1 ? 's' : ''}, ${cp} port${cp !== 1 ? 's' : ''}${skip}`, 'ok');
  } catch (e) {
    clearSpinner(btn);
    toast(e.message, 'err');
  }
}

/* ================= BOOT ================= */
async function boot() {
  await refreshAuthStatus();
  try {
    const topo = await api.topology();
    state = { nodes: topo.nodes || [], ports: topo.ports || [], networks: topo.networks || [], links: topo.links || [] };
  } catch (e) {
    toast('Failed to load topology: ' + e.message, 'err');
  }
  buildGraph();
  refreshChrome();
  updateReopen();
  applyLockState();                          // sets body.locked, badge, dragNodes, renders detail
  setView(currentView, { silent: true });    // restore last-used view (graph | table) without re-persisting
  if (!authState.isSetup) openAuthModal('create');   // first run → must set a password (non-dismissible)
}
boot();

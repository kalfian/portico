'use strict';

// Canonical, manually maintained inventory used only for a fresh database.
// Keep this deliberately small: discovered/contradicted legacy sample hosts
// must not appear in the default UI.
const store = require('./store');

function buildSeed() {
  const mtk = 'n-mtk';
  const world = 'n-world';
  const nas = 'n-nas';
  const lxcRoles = {
    101: 'Tailscale subnet router',
    102: 'Portico',
    103: 'AdGuard Home',
    104: 'Caddy',
    105: 'Hermes/9Router',
    106: 'Development workloads / pp host',
    107: 'MySQL database',
  };
  const nodes = [
    { id: mtk, name: 'MikroTik', type: 'network_device', parentId: null, ipAddress: '10.20.30.1', os: 'RouterOS', role: 'Gateway / DHCP / firewall', status: 'up', source: 'manual', tags: ['network', 'manual'], notes: 'Canonical manually maintained router.', posX: 0, posY: -220, networkId: 'nw-srv' },
    { id: world, name: 'world', type: 'proxmox_host', parentId: mtk, ipAddress: '10.20.30.100', os: 'Proxmox VE', role: 'Proxmox host', status: 'up', source: 'manual', externalId: 'world', tags: ['proxmox', 'manual'], notes: 'Canonical Proxmox world host.', posX: 0, posY: 0, networkId: 'nw-srv' },
    ...Object.entries(lxcRoles).map(([vmid, role], i) => ({
      id: `n-world-lxc-${vmid}`, name: `LXC ${vmid}`, type: 'lxc', parentId: world,
      // Guest addresses and service metadata are manually synced from Proxmox
      // descriptions; keep the topology explicit and LLM-friendly.
      ipAddress: `10.20.30.${vmid - 0}`, os: 'LXC', role, status: 'up', source: 'manual', externalId: `world:lxc:${vmid}`,
      tags: ['proxmox', 'lxc', role.toLowerCase()], notes: vmid === '105'
        ? 'ai-workspaces: Hermes Dashboard :9119 and 9Router :20128.'
        : vmid === '106'
          ? 'developments: pp.kalfian.com targets :1111.'
          : vmid === '107'
            ? 'database-mysql: MySQL :3306 (LAN only).'
            : `Canonical Proxmox LXC ${vmid}.`, posX: -240 + i * 120, posY: 220, networkId: 'nw-srv',
    })),
    { id: nas, name: 'NAS', type: 'physical', parentId: mtk, ipAddress: '10.20.30.11', role: 'NAS / storage', status: 'up', source: 'manual', tags: ['storage', 'manual'], notes: 'Canonical manually maintained NAS host.', posX: 300, posY: 0, networkId: 'nw-srv' },
  ];
  const P = (nodeId, portNumber, serviceName, description, domain, target) => ({
    id: `p-${nodeId}-${portNumber}`, nodeId, portNumber, protocol: 'tcp', serviceName, description,
    status: 'in_use', domain, exposure: 'public', scheme: 'http', hostPort: null, targetNodeId: target || null,
    cloudflareRouteId: domain ? `cf-${serviceName === 'couchdb' ? 'cdb' : serviceName}` : null,
    source: domain ? 'cloudflare' : 'manual', notes: domain ? 'Verified Cloudflare route.' : '',
  });
  const lxc102 = 'n-world-lxc-102';
  const lxc103 = 'n-world-lxc-103';
  const lxc105 = 'n-world-lxc-105';
  const lxc106 = 'n-world-lxc-106';
  const lxc107 = 'n-world-lxc-107';
  const ports = [
    { id: 'p-mtk-22', nodeId: mtk, portNumber: 22, protocol: 'tcp', serviceName: 'ssh', description: 'Management SSH', status: 'in_use', domain: '', exposure: 'internal', scheme: 'http', source: 'manual' },
    { id: 'p-lxc-102-80', nodeId: lxc102, portNumber: 80, protocol: 'tcp', serviceName: 'portico-http', description: 'Portico web application', status: 'in_use', domain: '', exposure: 'lan', scheme: 'http', source: 'proxmox-description' },
    { id: 'p-lxc-103-3000', nodeId: lxc103, portNumber: 3000, protocol: 'tcp', serviceName: 'adguard-web', description: 'AdGuard Home admin UI', status: 'in_use', domain: '', exposure: 'lan', scheme: 'http', source: 'proxmox-description' },
    { id: 'p-lxc-103-53', nodeId: lxc103, portNumber: 53, protocol: 'tcp/udp', serviceName: 'dns', description: 'AdGuard Home DNS', status: 'in_use', domain: '', exposure: 'lan', scheme: '', source: 'proxmox-description' },
    { id: 'p-lxc-105-9119', nodeId: lxc105, portNumber: 9119, protocol: 'tcp', serviceName: 'hermes-dashboard', description: 'Hermes Dashboard', status: 'in_use', domain: '', exposure: 'lan', scheme: 'http', source: 'proxmox-description' },
    { id: 'p-lxc-105-20128', nodeId: lxc105, portNumber: 20128, protocol: 'tcp', serviceName: '9router-dashboard', description: '9Router dashboard', status: 'in_use', domain: '', exposure: 'lan', scheme: 'http', source: 'proxmox-description' },
    { id: 'p-lxc-107-3306', nodeId: lxc107, portNumber: 3306, protocol: 'tcp', serviceName: 'mysql', description: 'MySQL database', status: 'in_use', domain: '', exposure: 'lan', scheme: '', source: 'proxmox-description' },
    P(nas, 8080, 'vw', 'Verified Cloudflare route target', 'vw.kalfian.com'),
    P(nas, 3010, 'affine', 'Verified Cloudflare route target', 'affine.kalfian.com'),
    P(nas, 5984, 'couchdb', 'Verified Cloudflare route target', 'cdb.kalfian.com'),
    P(lxc106, 1111, 'pp', 'Verified Cloudflare route target', 'pp.kalfian.com'),
  ];
  const cloudflareRoutes = [
    { id: 'cf-vw', hostname: 'vw.kalfian.com', target: 'http://10.20.30.11:8080', targetHost: '10.20.30.11', targetPort: 8080, exposure: 'public', source: 'cloudflare', notes: 'Verified route.' },
    { id: 'cf-affine', hostname: 'affine.kalfian.com', target: 'http://10.20.30.11:3010', targetHost: '10.20.30.11', targetPort: 3010, exposure: 'public', source: 'cloudflare', notes: 'Verified route.' },
    { id: 'cf-cdb', hostname: 'cdb.kalfian.com', target: 'http://10.20.30.11:5984', targetHost: '10.20.30.11', targetPort: 5984, exposure: 'public', source: 'cloudflare', notes: 'Verified route.' },
    { id: 'cf-pp', hostname: 'pp.kalfian.com', target: 'http://10.20.30.106:1111', targetHost: '10.20.30.106', targetPort: 1111, exposure: 'public', source: 'cloudflare', notes: 'Verified route.' },
  ];
  // Keep physical/network adjacency distinct from parent/child hierarchy.
  const links = nodes.filter(n => n.id !== mtk).map(n => ({
    id: `lk-mtk-${n.id}`, fromNodeId: mtk, toNodeId: n.id, type: 'network', label: 'servers LAN',
  }));
  for (const n of nodes.filter(n => n.type === 'lxc' || n.type === 'vm')) {
    links.push({ id: `lk-world-${n.id}`, fromNodeId: world, toNodeId: n.id, type: 'virtualization', label: 'virtualization' });
  }
  return {
    contract: 'portico.topology.v1',
    nodes, ports,
    networks: [{ id: 'nw-srv', name: 'servers', cidr: '10.20.30.0/24', vlanId: 30, color: '#22d3ee' }],
    links, cloudflareRoutes,
  };
}

function seedIfEmpty() {
  if (!store.isEmpty()) return false;
  store.importAll(buildSeed());
  console.log('[seed] inserted canonical inventory (10 nodes, 5 ports, 4 Cloudflare routes)');
  return true;
}

module.exports = { seedIfEmpty, buildSeed };
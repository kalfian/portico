'use strict';

// Idempotent seed: only runs when the DB has no nodes. Replicates the prototype's
// seedData() sample topology exactly (dialga/Proxmox + guests, docker-host + containers,
// mikrotik/AP/IoT, the ports incl. hostPort/targetNode mappings, the 3 networks, the
// seed links, and the selfh.st icon slugs). Ports are passed with the legacy `exposed`
// flag + domain so store.importAll's normalizer derives exposure/scheme identically to
// the prototype's normalizePort.

const store = require('./store');

// stable ids (match the prototype's local aliases)
const mikrotik = 'n-mtk', ap = 'n-ap', iot = 'n-iot';
const dialga = 'n-dialga', vm1 = 'n-vm1', lxc1 = 'n-lxc1';
const dhost = 'n-dhost', c1 = 'n-c1', c2 = 'n-c2';

function buildSeed() {
  const nodes = [
    { id: mikrotik, name: 'mikrotik', type: 'network_device', parentId: null, ipAddress: '10.20.30.1', macAddress: '48:8F:5A:11:22:33', os: 'RouterOS 7.14', role: 'Gateway / DHCP / firewall', status: 'up', tags: ['network', 'core', 'gateway'], notes: 'Core router. VLANs: 30 servers, 40 iot.', posX: 0, posY: -260, iconType: 'selfhst', iconValue: 'mikrotik', networkId: 'nw-srv' },
    { id: ap, name: 'access-point', type: 'network_device', parentId: mikrotik, ipAddress: '10.20.30.2', macAddress: '48:8F:5A:44:55:66', os: 'RouterOS (cAP)', role: 'Wi-Fi AP', status: 'up', tags: ['network', 'wifi'], notes: '', posX: -300, posY: -110, iconType: 'selfhst', iconValue: 'ubiquiti-unifi', networkId: 'nw-srv' },
    { id: iot, name: 'esp-hub', type: 'iot', parentId: ap, ipAddress: '10.20.40.50', macAddress: 'A4:CF:12:AA:BB:CC', os: 'ESPHome', role: 'Sensor bridge (MQTT)', status: 'unknown', tags: ['iot', 'sensors', 'mqtt'], notes: 'Temp/humidity + relays. On IoT VLAN.', posX: -300, posY: 60, iconType: 'selfhst', iconValue: 'esphome', networkId: 'nw-iot' },
    { id: dialga, name: 'dialga', type: 'proxmox_host', parentId: mikrotik, ipAddress: '10.20.30.10', macAddress: 'AC:1F:6B:00:11:22', os: 'Proxmox VE 8.2', role: 'Hypervisor', status: 'up', tags: ['hypervisor', 'core', 'proxmox'], notes: 'Primary Proxmox host. 64GB RAM, ZFS mirror.', posX: 60, posY: -90, iconType: 'selfhst', iconValue: 'proxmox', networkId: 'nw-srv' },
    { id: vm1, name: 'vm-truenas', type: 'vm', parentId: dialga, ipAddress: '10.20.30.21', macAddress: '52:54:00:AA:00:21', os: 'TrueNAS SCALE', role: 'NAS / storage', status: 'up', tags: ['storage', 'nas', 'backup'], notes: 'Passthrough HBA. SMB + NFS shares.', posX: -40, posY: 90, iconType: 'selfhst', iconValue: 'truenas-scale', networkId: 'nw-srv' },
    { id: lxc1, name: 'lxc-adguard', type: 'lxc', parentId: dialga, ipAddress: '10.20.30.22', macAddress: '52:54:00:AA:00:22', os: 'Debian 12 (LXC)', role: 'DNS sinkhole', status: 'up', tags: ['dns', 'adblock'], notes: 'AdGuard Home, unprivileged container.', posX: 160, posY: 90, iconType: 'selfhst', iconValue: 'adguard-home', networkId: 'nw-srv' },
    { id: dhost, name: 'docker-host', type: 'docker_host', parentId: mikrotik, ipAddress: '10.20.30.30', macAddress: 'DC:A6:32:00:33:44', os: 'Ubuntu 24.04 LTS', role: 'Container host (Docker)', status: 'up', tags: ['docker', 'public', 'apps'], notes: 'Compose stacks. Traefik fronts web apps.', posX: 360, posY: -90, iconType: 'selfhst', iconValue: 'docker', networkId: 'nw-srv' },
    { id: c1, name: 'traefik', type: 'container', parentId: dhost, ipAddress: '172.18.0.2', macAddress: '', os: 'Docker image', role: 'Reverse proxy', status: 'up', tags: ['public', 'proxy', 'tls'], notes: 'Publishes 80/443, dashboard on 8080.', posX: 300, posY: 90, iconType: 'selfhst', iconValue: 'traefik', networkId: 'nw-dkr' },
    { id: c2, name: 'jellyfin', type: 'container', parentId: dhost, ipAddress: '172.18.0.3', macAddress: '', os: 'Docker image', role: 'Media server', status: 'up', tags: ['media', 'public'], notes: 'Behind Traefik. iGPU transcode.', posX: 460, posY: 90, iconType: 'selfhst', iconValue: 'jellyfin', networkId: 'nw-dkr' },
  ];

  // P(nodeId, portNumber, protocol, serviceName, description, exposed, status, domain)
  const P = (nodeId, portNumber, protocol, serviceName, description, exposed, status = 'in_use', domain = '') =>
    ({ nodeId, portNumber, protocol, serviceName, description, exposed, status, domain });

  const ports = [
    // mikrotik
    P(mikrotik, 22, 'tcp', 'ssh', 'Admin SSH', false),
    P(mikrotik, 8291, 'tcp', 'winbox', 'Winbox management', false),
    P(mikrotik, 53, 'udp', 'dns', 'Local resolver', false),
    P(mikrotik, 443, 'tcp', 'webfig', 'Web admin', false, 'reserved'),
    // access-point
    P(ap, 22, 'tcp', 'ssh', 'Admin SSH', false),
    // iot
    P(iot, 6053, 'tcp', 'esphome-api', 'Native API', false),
    P(iot, 1883, 'tcp', 'mqtt', 'Broker publish', false),
    // dialga (proxmox host)
    P(dialga, 22, 'tcp', 'ssh', 'Host SSH', false),
    P(dialga, 8006, 'tcp', 'proxmox-web', 'PVE web UI', true, 'in_use', 'pve.example.com'),
    P(dialga, 3128, 'tcp', 'spice-proxy', 'Console proxy', false),
    // vm-truenas
    P(vm1, 22, 'tcp', 'ssh', 'Shell', false),
    P(vm1, 443, 'tcp', 'truenas-ui', 'Web UI', false),
    P(vm1, 445, 'tcp', 'smb', 'File shares', false),
    P(vm1, 2049, 'tcp', 'nfs', 'NFS export', false),
    // lxc-adguard
    P(lxc1, 22, 'tcp', 'ssh', 'Shell', false),
    P(lxc1, 53, 'udp', 'dns', 'DNS sinkhole', false),
    P(lxc1, 3000, 'tcp', 'adguard-ui', 'Admin UI', true, 'in_use', 'dns.example.com'),
    // docker-host (exposed mappings)
    P(dhost, 22, 'tcp', 'ssh', 'Host SSH', false),
    P(dhost, 80, 'tcp', 'http', 'Traefik entrypoint', true),
    P(dhost, 443, 'tcp', 'https', 'Traefik entrypoint', true),
    P(dhost, 8080, 'tcp', 'traefik-dash', 'Traefik dashboard', true, 'in_use', 'traefik.example.com'),
    // traefik container
    P(c1, 80, 'tcp', 'web', 'HTTP in', true),
    P(c1, 443, 'tcp', 'websecure', 'HTTPS in', true),
    // jellyfin container
    P(c2, 8096, 'tcp', 'jellyfin-http', 'Web player', true, 'in_use', 'jelly.example.com'),
    P(c2, 8920, 'tcp', 'jellyfin-https', 'Web player (TLS)', false, 'reserved'),
  ];

  // Docker-style host-port publishing + forward-to mappings (prototype setMap()).
  const setMap = (nodeId, portNumber, extra) => {
    const pp = ports.find((x) => x.nodeId === nodeId && x.portNumber === portNumber);
    if (pp) Object.assign(pp, extra);
  };
  setMap(dhost, 80, { hostPort: 80, targetNodeId: c1, scheme: 'http' });
  setMap(dhost, 443, { hostPort: 443, targetNodeId: c1, scheme: 'https' });

  const networks = [
    { id: 'nw-srv', name: 'servers', cidr: '10.20.30.0/24', vlanId: 30, color: '#22d3ee' },
    { id: 'nw-iot', name: 'iot', cidr: '10.20.40.0/24', vlanId: 40, color: '#a3e635' },
    { id: 'nw-dkr', name: 'docker', cidr: '172.18.0.0/16', vlanId: null, color: '#f59e0b' },
  ];

  const links = [
    { id: 'lk-proxy', fromNodeId: c1, toNodeId: c2, type: 'proxy', label: ':8096' },
    { id: 'lk-mount', fromNodeId: c2, toNodeId: vm1, type: 'mount', label: '/media' },
    { id: 'lk-dns1', fromNodeId: dhost, toNodeId: lxc1, type: 'dns', label: '' },
    { id: 'lk-dns2', fromNodeId: dialga, toNodeId: lxc1, type: 'dns', label: '' },
  ];

  return { nodes, ports, networks, links };
}

// Runs on boot; no-op unless the nodes table is empty.
function seedIfEmpty() {
  if (!store.isEmpty()) return false;
  store.importAll(buildSeed());
  console.log('[seed] inserted sample topology (9 nodes, 25 ports, 3 networks, 4 links)');
  return true;
}

module.exports = { seedIfEmpty, buildSeed };

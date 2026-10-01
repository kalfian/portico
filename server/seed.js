'use strict';

// Illustrative demo inventory used only for a fresh database. All addresses and
// hostnames are reserved for documentation and must not be treated as live data.
const store = require('./store');

function buildSeed() {
  const gateway = 'n-demo-gateway';
  const proxmox = 'n-demo-proxmox';
  const appVm = 'n-demo-app-vm';
  const proxyLxc = 'n-demo-proxy-lxc';
  const docker = 'n-demo-docker-host';
  const web = 'n-demo-web-container';
  const storage = 'n-demo-storage';
  const sensor = 'n-demo-sensor';

  const networks = [
    { id: 'nw-demo-management', name: 'Demo management', cidr: '192.0.2.0/24', vlanId: 10, color: '#22d3ee' },
    { id: 'nw-demo-services', name: 'Demo services', cidr: '198.51.100.0/24', vlanId: 20, color: '#f59e0b' },
    { id: 'nw-demo-iot', name: 'Demo IoT', cidr: '203.0.113.0/24', vlanId: 30, color: '#84cc16' },
  ];

  const nodes = [
    {
      id: gateway, name: 'Atlas Demo Gateway', type: 'network_device', parentId: null,
      ipAddress: '192.0.2.1', os: 'DemoOS', role: 'Fictional gateway and VLAN router', status: 'up',
      networkId: 'nw-demo-management', source: 'demo', externalId: 'demo:gateway',
      tags: ['demo', 'network'], notes: 'Illustrative device using RFC 5737 TEST-NET-1.', posX: -480, posY: 20,
    },
    {
      id: proxmox, name: 'Orion Demo Hypervisor', type: 'proxmox_host', parentId: gateway,
      ipAddress: '192.0.2.10', os: 'Proxmox VE (demo)', role: 'Fictional virtualization host', status: 'up',
      networkId: 'nw-demo-management', source: 'demo', externalId: 'demo:proxmox:orion',
      tags: ['demo', 'virtualization'], notes: 'Illustrative host; not discovered from a live cluster.', posX: -200, posY: -170,
    },
    {
      id: appVm, name: 'Nova Demo VM', type: 'vm', parentId: proxmox,
      ipAddress: '198.51.100.20', os: 'Linux (demo)', role: 'Application VM', status: 'up',
      networkId: 'nw-demo-services', source: 'demo', externalId: 'demo:proxmox:vm:200',
      tags: ['demo', 'application'], notes: 'Illustrative VM on TEST-NET-2.', posX: 80, posY: -260,
    },
    {
      id: proxyLxc, name: 'Beacon Demo Proxy', type: 'lxc', parentId: proxmox,
      ipAddress: '198.51.100.21', os: 'Linux container (demo)', role: 'Reverse proxy and TLS entrypoint', status: 'up',
      networkId: 'nw-demo-services', source: 'demo', externalId: 'demo:proxmox:lxc:201',
      tags: ['demo', 'proxy'], notes: 'Illustrative LXC on TEST-NET-2.', posX: 80, posY: -70,
    },
    {
      id: docker, name: 'Kepler Demo Docker Host', type: 'docker_host', parentId: appVm,
      ipAddress: '198.51.100.30', os: 'Linux (demo)', role: 'Container runtime', status: 'up',
      networkId: 'nw-demo-services', source: 'demo', externalId: 'demo:docker:kepler',
      tags: ['demo', 'docker'], notes: 'Illustrative Docker host nested in the demo VM.', posX: 360, posY: -260,
    },
    {
      id: web, name: 'Comet Demo Web', type: 'container', parentId: docker,
      ipAddress: '198.51.100.31', os: 'Demo container image', role: 'Example web application', status: 'up',
      networkId: 'nw-demo-services', source: 'demo', externalId: 'demo:docker:comet-web',
      tags: ['demo', 'web'], notes: 'Illustrative application target; no live service is implied.', posX: 650, posY: -260,
    },
    {
      id: storage, name: 'Archive Demo Server', type: 'physical', parentId: gateway,
      ipAddress: '192.0.2.20', os: 'StorageOS (demo)', role: 'Fictional shared storage', status: 'unknown',
      networkId: 'nw-demo-management', source: 'demo', externalId: 'demo:physical:archive',
      tags: ['demo', 'storage'], notes: 'Illustrative physical server on TEST-NET-1.', posX: -200, posY: 100,
    },
    {
      id: sensor, name: 'Aurora Demo Sensor', type: 'iot', parentId: gateway,
      ipAddress: '203.0.113.40', os: 'Sensor firmware (demo)', role: 'Fictional environment sensor', status: 'down',
      networkId: 'nw-demo-iot', source: 'demo', externalId: 'demo:iot:aurora',
      tags: ['demo', 'iot'], notes: 'Illustrative offline device on TEST-NET-3.', posX: -200, posY: 300,
    },
  ];

  const ports = [
    {
      id: 'p-demo-gateway-22-tcp', nodeId: gateway, portNumber: 22, protocol: 'tcp', serviceName: 'ssh',
      description: 'Demo management shell', status: 'up', exposure: 'internal', exposureMode: 'lan', scheme: 'http', source: 'demo',
    },
    {
      id: 'p-demo-gateway-53-udp', nodeId: gateway, portNumber: 53, protocol: 'udp', serviceName: 'dns',
      description: 'Demo VLAN resolver', status: 'active', exposure: 'lan', exposureMode: 'lan', scheme: 'http', source: 'demo',
    },
    {
      id: 'p-demo-proxmox-8006-tcp', nodeId: proxmox, portNumber: 8006, protocol: 'tcp', serviceName: 'proxmox-ui',
      description: 'Demo hypervisor console', status: 'in_use', exposure: 'lan', exposureMode: 'lan', scheme: 'https', source: 'demo',
    },
    {
      id: 'p-demo-vm-5432-tcp', nodeId: appVm, portNumber: 5432, protocol: 'tcp', serviceName: 'postgresql',
      description: 'Demo application database', status: 'in_use', exposure: 'internal', exposureMode: 'lan', scheme: 'http', source: 'demo',
    },
    {
      id: 'p-demo-proxy-443-tcp', nodeId: proxyLxc, portNumber: 443, protocol: 'tcp', serviceName: 'demo-web-entrypoint',
      description: 'Illustrative Cloudflare route forwarded to the demo web container', status: 'active',
      domain: 'portal.portico-demo.example', exposure: 'public', exposureMode: 'cloudflare', scheme: 'https',
      targetNodeId: web, cloudflareRouteId: 'cf-demo-portal', source: 'demo',
    },
    {
      id: 'p-demo-container-8080-tcp', nodeId: web, portNumber: 8080, protocol: 'tcp', serviceName: 'demo-web',
      description: 'Demo container port published on its Docker host', status: 'in_use', exposure: 'lan',
      exposureMode: 'lan', scheme: 'http', hostPort: 18080, source: 'demo',
    },
    {
      id: 'p-demo-container-9090-tcp', nodeId: web, portNumber: 9090, protocol: 'tcp', serviceName: 'future-metrics',
      description: 'Reserved example capacity', status: 'reserved', exposure: 'internal', exposureMode: 'lan', scheme: 'http', source: 'demo',
    },
    {
      id: 'p-demo-storage-2049-tcp', nodeId: storage, portNumber: 2049, protocol: 'tcp', serviceName: 'nfs',
      description: 'Demo storage export', status: 'up', exposure: 'lan', exposureMode: 'lan', scheme: 'http', source: 'demo',
    },
    {
      id: 'p-demo-sensor-1883-tcp', nodeId: sensor, portNumber: 1883, protocol: 'tcp', serviceName: 'mqtt',
      description: 'Offline demo telemetry endpoint', status: 'down', exposure: 'internal', exposureMode: 'lan', scheme: 'http', source: 'demo',
    },
  ];

  const cloudflareRoutes = [{
    id: 'cf-demo-portal', hostname: 'portal.portico-demo.example',
    target: 'https://198.51.100.21:443', targetHost: '198.51.100.21', targetPort: 443,
    exposure: 'public', source: 'demo', notes: 'Illustrative association only; this route is not live or externally checked.',
  }];

  const links = [
    { id: 'lk-demo-vlan-trunk', fromNodeId: gateway, toNodeId: proxmox, type: 'network', label: 'demo VLAN trunk' },
    { id: 'lk-demo-proxy-web', fromNodeId: proxyLxc, toNodeId: web, type: 'proxy', label: 'HTTPS to :8080' },
    { id: 'lk-demo-web-storage', fromNodeId: web, toNodeId: storage, type: 'mount', label: 'demo assets' },
    { id: 'lk-demo-docker-dns', fromNodeId: docker, toNodeId: gateway, type: 'dns', label: 'demo resolver' },
  ];

  return { contract: 'portico.topology.v1', nodes, ports, networks, links, cloudflareRoutes };
}

function seedIfEmpty() {
  if (!store.isEmpty()) return false;
  const seed = buildSeed();
  store.importAll(seed);
  console.log(`[seed] inserted fictional demo inventory (${seed.nodes.length} nodes, ${seed.ports.length} ports, ${seed.cloudflareRoutes.length} Cloudflare route)`);
  return true;
}

module.exports = { seedIfEmpty, buildSeed };

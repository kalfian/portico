'use strict';

const store = require('./store');

function buildSeed() {
  const internet = 'n-internet', mikrotik = 'n-mikrotik';
  const device1 = 'n-device-1', device2 = 'n-device-2';
  const nodes = [
    { id: internet, name: 'Internet', type: 'network_device', parentIds: [], ipAddress: '', status: 'up', role: 'WAN', tags: ['internet', 'wan'], notes: 'External network entry point.', posX: 0, posY: -300, iconType: 'builtin', iconValue: 'wifi', networkId: null },
    { id: mikrotik, name: 'Mikrotik Router', type: 'network_device', parentIds: [internet], ipAddress: '10.20.30.1', status: 'up', role: 'Gateway / DHCP / firewall', tags: ['router', 'core'], notes: 'Primary router for the home-server network.', posX: 0, posY: -120, iconType: 'selfhst', iconValue: 'mikrotik', networkId: 'nw-lan' },
    { id: device1, name: 'Device 1', type: 'physical', parentIds: [mikrotik], ipAddress: '10.20.30.2', status: 'up', role: 'LAN device', tags: ['device'], notes: '', posX: -250, posY: 70, iconType: 'builtin', iconValue: 'host', networkId: 'nw-lan' },
    { id: device2, name: 'Device 2', type: 'physical', parentIds: [mikrotik], ipAddress: '10.20.30.3', status: 'up', role: 'LAN device', tags: ['device'], notes: 'Hosts Device 3 and Device 4 service endpoints.', posX: 210, posY: 70, iconType: 'builtin', iconValue: 'host', networkId: 'nw-lan' },
  ];
  const ports = [
    { id: 'p-device-3', nodeId: device2, portNumber: 8080, protocol: 'tcp', serviceName: 'Device 3', description: 'Application endpoint on Device 2', status: 'in_use', exposure: 'lan', scheme: 'http', externalUrl: 'http://10.20.30.3:8080', posX: 390, posY: 40 },
    { id: 'p-device-4', nodeId: device2, portNumber: 9100, protocol: 'tcp', serviceName: 'Device 4', description: 'Metrics endpoint on Device 2', status: 'in_use', exposure: 'internal', scheme: 'http', externalUrl: 'http://10.20.30.3:9100', posX: 390, posY: 115 },
  ];
  return { nodes, ports, networks: [{ id: 'nw-lan', name: 'home-lan', cidr: '10.20.30.0/24', vlanId: 30, color: '#2dd4bf' }], links: [] };
}

function seedIfEmpty() {
  if (!store.isEmpty()) return false;
  store.importAll(buildSeed());
  console.log('[seed] inserted sample topology (4 nodes, 2 ports, 1 network)');
  return true;
}

module.exports = { seedIfEmpty, buildSeed };

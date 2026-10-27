import { describe, expect, it } from 'vitest';
import { isLoopbackOnly, lanInfo, listLanCandidates, pickLanAddress } from '../server/network.mjs';

function iface(family, address, internal = false) {
  return [{ family, address, internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` }];
}

describe('LAN address discovery', () => {
  it('skips loopback, internal and IPv6 entries', () => {
    const interfaces = {
      'Loopback Pseudo-Interface 1': iface('IPv4', '127.0.0.1', true),
      'Wi-Fi': [
        ...iface('IPv6', 'fe80::1'),
        ...iface('IPv4', '192.168.1.20'),
      ],
    };
    expect(listLanCandidates(interfaces).map((c) => c.address)).toEqual(['192.168.1.20']);
  });

  it('keeps physical Wi-Fi ahead of a private Hyper-V adapter', () => {
    const interfaces = {
      'vEthernet (Default Switch)': iface('IPv4', '172.28.16.1'),
      'Wi-Fi': iface('IPv4', '192.168.0.14'),
    };
    const candidates = listLanCandidates(interfaces);
    expect(candidates[0].address).toBe('192.168.0.14');
    expect(candidates[0].virtual).toBe(false);
    expect(candidates[1].virtual).toBe(true);
  });

  it('still offers a public physical address when no private one exists', () => {
    const interfaces = {
      Ethernet: iface('IPv4', '203.0.113.9'),
      'vEthernet (WSL)': iface('IPv4', '172.20.0.1'),
    };
    expect(pickLanAddress(interfaces)?.address).toBe('203.0.113.9');
    expect(pickLanAddress({})).toBeNull();
  });

  it('builds a phone URL from the best address and reports bind scope', () => {
    const interfaces = {
      'Wi-Fi': iface('IPv4', '192.168.100.7'),
      Ethernet: iface('IPv4', '10.0.0.5'),
    };
    const lan = lanInfo(5199, '0.0.0.0', interfaces);
    expect(lan.url).toBe('http://192.168.100.7:5199');
    expect(lan.reachable).toBe(true);
    expect(lan.candidates).toHaveLength(2);

    const loopback = lanInfo(5199, '127.0.0.1', interfaces);
    expect(loopback.reachable).toBe(false);
    expect(loopback.url).toBeNull();
    expect(loopback.address).toBe('192.168.100.7');
  });

  it('recognises loopback bind spellings', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) expect(isLoopbackOnly(host)).toBe(true);
    for (const host of ['0.0.0.0', '::', '192.168.1.2']) expect(isLoopbackOnly(host)).toBe(false);
  });
});

import os from 'node:os';

// Adapter virtual sering terdaftar lebih dulu (Hyper-V, WSL, VPN) tapi tidak
// terjangkau dari ponsel, jadi skornya diturunkan drastis, bukan dibuang.
const VIRTUAL_HINT = /(vethernet|vmware|virtualbox|hyper-v|loopback|docker|veth|br-|utun|tun\d|tap\d|tailscale|zerotier|hamachi|npcap|bluetooth)/i;
const WIRELESS_HINT = /(wi-?fi|wlan|wireless|wlp|wl\d|airport)/i;
const WIRED_HINT = /(ethernet|eth\d|en\d|eno|enp|ens|lan)/i;

export function isLoopbackOnly(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** 192.168 > 10 > 172.16-31 > alamat lain; hanya rentang privat yang dianggap LAN. */
function privateTier(address) {
  if (address.startsWith('192.168.')) return 3;
  if (address.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
  return 0;
}

/** IPv4 non-loopback yang diurutkan dari yang paling mungkin terjangkau ponsel. */
export function listLanCandidates(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      const virtual = VIRTUAL_HINT.test(name);
      const tier = privateTier(entry.address);
      let score = tier * 10;
      if (WIRELESS_HINT.test(name)) score += 5;
      else if (WIRED_HINT.test(name)) score += 3;
      // Penalti harus mengalahkan kombinasi skor privat tertinggi, supaya adapter
      // fisik apa pun (bahkan IP publik) tetap didahulukan dari adapter virtual.
      if (virtual) score -= 200;
      if (tier === 0) score -= 20;
      found.push({ name, address: entry.address, virtual, private: tier > 0, score });
    }
  }
  return found.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

export function pickLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = listLanCandidates(interfaces);
  return (
    candidates.find((candidate) => candidate.private && !candidate.virtual) ??
    candidates.find((candidate) => !candidate.virtual) ??
    candidates[0] ??
    null
  );
}

export function lanInfo(port, host = '0.0.0.0', interfaces = os.networkInterfaces()) {
  const touchable = !isLoopbackOnly(host);
  const best = pickLanAddress(interfaces);
  return {
    port,
    bind: host,
    reachable: touchable,
    address: best?.address ?? null,
    url: touchable && best ? `http://${best.address}:${port}` : null,
    candidates: listLanCandidates(interfaces).map(({ name, address, virtual }) => ({ name, address, virtual })),
  };
}

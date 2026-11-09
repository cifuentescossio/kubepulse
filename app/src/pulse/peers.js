// Owner: C · Pulso. Shares a new chaos with the other replicas.
//
// The pod that receives POST /chaos (without X-KubePulse-Forwarded) forwards the same
// { room, start, until } to every other pod behind the headless Service `app-peers`, with
// X-KubePulse-Forwarded: 1 so they don't forward it again. Best effort: 1 s per peer, errors
// only go to the log, and the caller never waits for it. Without that DNS name (local runs)
// the pod just keeps the chaos to itself.
const dns = require('node:dns');
const os = require('node:os');

const PEERS_HOST = 'app-peers.team-kubepulse.svc.cluster.local';
const PEERS_PORT = 8080; // containerPort `http` in deploy/deployment.yaml
const FORWARDED_HEADER = 'X-KubePulse-Forwarded';
const TIMEOUT_MS = 1000;
const PEER_CACHE_MS = 5000;
const NO_DNS = new Set(['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ECONNREFUSED', 'ETIMEOUT', 'EREFUSED']);

function localAddresses() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4') out.add(a.address);
  }
  return out;
}

function defaultResolve(host) {
  const resolver = new dns.promises.Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  return resolver.resolve4(host);
}

function createPeerBroadcaster({
  host = PEERS_HOST,
  port = PEERS_PORT,
  timeoutMs = TIMEOUT_MS,
  resolve = defaultResolve,
  selfAddresses = localAddresses,
  fetchImpl = (...args) => fetch(...args),
  log = (msg) => console.warn(msg),
} = {}) {
  let dnsMissingLogged = false;
  let cache = { at: 0, ips: null };

  // Only pods behind app-peers may send X-KubePulse-Forwarded: the public URL reaches the same
  // router, so the header alone proves nothing. Lookups are cached for a few seconds.
  async function isPeer(remoteAddress) {
    const ip = String(remoteAddress || '').replace(/^::ffff:/, '');
    if (!ip) return false;
    const t = Date.now();
    const stale = !cache.ips || t - cache.at > PEER_CACHE_MS;
    // An unknown IP may be a pod that just started: re-resolve, but at most once a second.
    if (stale || (!cache.ips.has(ip) && t - cache.at > 1000)) {
      try {
        cache = { at: t, ips: new Set(await resolve(host)) };
      } catch {
        cache = { at: t, ips: new Set() };
      }
    }
    return cache.ips.has(ip);
  }

  // Resolves with one { ip, status | error } per peer; never rejects.
  async function broadcast(chaos) {
    let ips;
    try {
      ips = await resolve(host);
    } catch (err) {
      if (!NO_DNS.has(err.code)) log(`pulse: peer lookup for ${host} failed: ${err.message}`);
      else if (!dnsMissingLogged) {
        dnsMissingLogged = true;
        log(`pulse: no peers at ${host} (${err.code}); chaos stays on this pod`);
      }
      return [];
    }
    const self = selfAddresses();
    const body = JSON.stringify({ room: chaos.room, start: chaos.start, until: chaos.until });
    const targets = [...new Set(ips)].filter((ip) => !self.has(ip));
    return Promise.all(
      targets.map(async (ip) => {
        try {
          const res = await fetchImpl(`http://${ip}:${port}/chaos`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', [FORWARDED_HEADER]: '1' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) log(`pulse: peer ${ip} answered ${res.status} to forwarded chaos`);
          return { ip, status: res.status };
        } catch (err) {
          log(`pulse: forwarding chaos to ${ip} failed: ${err.message}`);
          return { ip, error: err.message };
        }
      }),
    );
  }

  return { broadcast, isPeer };
}

module.exports = { createPeerBroadcaster, FORWARDED_HEADER, PEERS_HOST, PEERS_PORT };

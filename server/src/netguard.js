// Guards for the few places the server fetches a URL someone typed in (calendar links) or that a
// browser handed us (push endpoints), so they can't be pointed at your home network.
import dns from 'node:dns/promises';
import net from 'node:net';

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateAddress(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
}

/** Throws unless the URL is https and its host resolves only to public addresses. */
export async function assertPublicHttps(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Only https:// links are allowed.');
  if (url.username || url.password) throw new Error('Links with a username or password aren’t allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true, verbatim: true })).map(a => a.address);
  if (!addrs.length || addrs.some(privateAddress)) throw new Error('That link points to a private or local address.');
  return url;
}

/**
 * GET a public https URL. The address is checked when the connection is made (not just looked up
 * beforehand), so a name that switches to a private address mid-request ("DNS rebinding") can't
 * slip through. Follows up to 5 redirects, each checked the same way, and stops reading past maxBytes.
 * Returns { ok, status, headers, text() } like fetch.
 */
export async function safeFetch(raw, { headers = {}, timeoutMs = 20000, maxBytes = 15 * 1024 * 1024 } = {}) {
  const https = await import('node:https');
  const lookup = (host, opts, cb) => {
    dns.lookup(host, { all: true, verbatim: true }).then(addrs => {
      const bad = !addrs.length || addrs.some(a => privateAddress(a.address));
      if (bad) return cb(Object.assign(new Error('That link points to a private or local address.'), { code: 'EPRIVATE' }));
      if (opts?.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
    }, cb);
  };
  let url = String(raw);
  for (let hop = 0; hop < 6; hop++) {
    const u = await assertPublicHttps(url);
    const res = await new Promise((resolve, reject) => {
      const req = https.request(u, { method: 'GET', headers: { 'user-agent': 'Heartwood', ...headers }, lookup, timeout: timeoutMs }, r => {
        const chunks = []; let size = 0;
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return resolve({ status: r.statusCode, location: r.headers.location }); }
        r.on('data', c => {
          size += c.length;
          if (size > maxBytes) { req.destroy(Object.assign(new Error('That calendar is too large to read.'), { code: 'ETOOBIG' })); return; }
          chunks.push(c);
        });
        r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        r.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('The link took too long to answer.')));
      req.on('error', reject);
      req.end();
    });
    if (res.location) { url = new URL(res.location, url).toString(); continue; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, headers: { get: k => res.headers[String(k).toLowerCase()] ?? null }, text: async () => res.body.toString('utf8') };
  }
  throw new Error('Too many redirects.');
}

// Browser push services. A subscription endpoint must be one of these.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];
export function isPushEndpoint(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && PUSH_HOSTS.some(r => r.test(u.hostname));
  } catch { return false; }
}

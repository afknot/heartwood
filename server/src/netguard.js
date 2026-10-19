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

/** fetch() that re-checks every redirect hop (max 5). */
export async function safeFetch(raw, opts = {}) {
  let url = String(raw);
  for (let i = 0; i < 6; i++) {
    await assertPublicHttps(url);
    const res = await fetch(url, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    return res;
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

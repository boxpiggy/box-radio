import dns from 'node:dns/promises';
import { mapStations } from './station.mjs';

export const USER_AGENT = 'BoxRadio/0.1.0';
const DISCOVERY_HOST = 'all.api.radio-browser.info';
const FALLBACK_HOST = 'de1.api.radio-browser.info';
const NODE_TIMEOUT_MS = 8_000;

export class DirectoryError extends Error {
  constructor(message = '电台目录暂时连不上，请稍后重试') {
    super(message);
    this.name = 'DirectoryError';
  }
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

async function discoverHosts(resolve4 = dns.resolve4.bind(dns), reverse = dns.reverse.bind(dns)) {
  /** @type {string[]} */
  const names = [];
  try {
    const ips = await resolve4(DISCOVERY_HOST);
    for (const ip of ips) {
      try {
        const hosts = await reverse(ip);
        for (const h of hosts) {
          if (h && !names.includes(h)) names.push(h);
        }
      } catch {
        // reverse 失败的 IP 跳过
      }
    }
  } catch (err) {
    console.warn('[box.radio] dns resolve failed', err?.message || err);
  }
  if (names.length === 0) {
    console.warn('[box.radio] dns empty, fallback', FALLBACK_HOST);
    return [FALLBACK_HOST];
  }
  return shuffle(names);
}

/**
 * @param {{ fetchApi?: typeof fetch, resolve4?: Function, reverse?: Function }} [opts]
 */
export function createRadioBrowser(opts = {}) {
  const fetchApi = opts.fetchApi || fetch;
  let hostsPromise = null;

  const hosts = () => {
    if (!hostsPromise) {
      hostsPromise = discoverHosts(opts.resolve4, opts.reverse);
    }
    return hostsPromise;
  };

  /**
   * @param {string} path
   */
  const json = async (path) => {
    const list = await hosts();
    let lastErr = null;
    for (const host of list) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), NODE_TIMEOUT_MS);
      try {
        const res = await fetchApi(`https://${host}${path}`, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
          },
          signal: ac.signal,
        });
        if (res.status >= 500) {
          lastErr = new Error(`http ${res.status}`);
          continue;
        }
        if (res.status === 404) return null;
        if (!res.ok) throw new DirectoryError();
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (err instanceof DirectoryError) throw err;
        continue;
      } finally {
        clearTimeout(timer);
      }
    }
    console.warn('[box.radio] all nodes failed', lastErr?.message || lastErr);
    throw new DirectoryError();
  };

  return {
    async discover() {
      const raw = await json(
        '/json/stations/search?countrycode=CN&hidebroken=true&order=votes&reverse=true&limit=50',
      );
      return mapStations(raw);
    },
    async search(q) {
      const name = encodeURIComponent(q);
      const raw = await json(
        `/json/stations/search?name=${name}&hidebroken=true&order=votes&reverse=true&limit=50`,
      );
      return mapStations(raw);
    },
    async click(id) {
      const raw = await json(`/json/url/${encodeURIComponent(id)}`);
      const row = Array.isArray(raw) ? raw[0] : raw;
      if (!row || typeof row !== 'object') return { url: '', name: '', id };
      const url = String(row.url_resolved || row.url || '').trim();
      const name = String(row.name || '').trim();
      return { url, name, id: String(row.stationuuid || id) };
    },
  };
}

import dns from 'node:dns/promises';
import { mapStations } from './station.mjs';
import { filterRegion, findRegion } from './regions.mjs';
import { expandSearchTerms } from './aliases.mjs';

export const USER_AGENT = 'BoxRadio/0.1.0';
const DISCOVERY_HOST = 'all.api.radio-browser.info';
const FALLBACK_HOST = 'de1.api.radio-browser.info';
const STATIC_HOSTS = [
  'de1.api.radio-browser.info',
  'de2.api.radio-browser.info',
  'fi1.api.radio-browser.info',
];
const NODE_TIMEOUT_MS = 12_000;
const HTTPS_TIMEOUT_MS = 4_000;
const CATALOG_TIMEOUT_MS = 20_000;
const CN_LIMIT = 400;
const HOT_LIMIT = 100;
const REGION_LIMIT = 80;

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
  const run = async () => {
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
    return [...STATIC_HOSTS];
  }
  return shuffle(names);
  };
  return Promise.race([
    run(),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve([FALLBACK_HOST]), 5_000);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

/**
 * @param {{ fetchApi?: typeof fetch, resolve4?: Function, reverse?: Function }} [opts]
 */
export function createRadioBrowser(opts = {}) {
  const fetchApi = opts.fetchApi || fetch;
  let hostsPromise = null;
  let cnPromise = null;

  const hosts = () => {
    if (!hostsPromise) {
      hostsPromise = discoverHosts(opts.resolve4, opts.reverse);
    }
    return hostsPromise;
  };

  const loadCn = () => {
    if (!cnPromise) {
      cnPromise = json(
        `/json/stations/search?countrycode=CN&hidebroken=true&order=votes&reverse=true&limit=${CN_LIMIT}`,
        CATALOG_TIMEOUT_MS,
      ).then((raw) => mapStations(raw));
      cnPromise = cnPromise.catch((err) => {
        cnPromise = null;
        throw err;
      });
    }
    return cnPromise;
  };

  /**
   * @param {string} path
   * @param {number} [timeoutMs]
   */
  const json = async (path, timeoutMs = NODE_TIMEOUT_MS) => {
    const seen = new Set();
    const list = [];
    for (const host of [...(await hosts()), ...STATIC_HOSTS]) {
      if (!host || seen.has(host)) continue;
      seen.add(host);
      list.push(host);
    }
    let lastErr = null;
    for (const host of list) {
      for (const proto of ['https', 'http']) {
        const ac = new AbortController();
        const wait = proto === 'https' ? Math.min(HTTPS_TIMEOUT_MS, timeoutMs) : timeoutMs;
        const timer = setTimeout(() => ac.abort(), wait);
        try {
          const res = await fetchApi(`${proto}://${host}${path}`, {
            headers: {
              'User-Agent': USER_AGENT,
              Accept: 'application/json',
            },
            signal: ac.signal,
          });
          if (res.status >= 500) {
            lastErr = new Error(`${proto} ${res.status}`);
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
    }
    console.warn('[box.radio] all nodes failed', lastErr?.message || lastErr);
    throw new DirectoryError();
  };

  return {
    async discover() {
      const raw = await json(
        `/json/stations/search?countrycode=CN&hidebroken=true&order=votes&reverse=true&limit=${HOT_LIMIT}`,
      );
      return mapStations(raw);
    },
    async search(q) {
      const terms = expandSearchTerms(q);
      const seen = new Set();
      /** @type {any[]} */
      const out = [];
      for (const term of terms) {
        const raw = await json(
          `/json/stations/search?name=${encodeURIComponent(term)}&hidebroken=true&order=votes&reverse=true&limit=50`,
        );
        for (const s of mapStations(raw)) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          out.push(s);
        }
      }
      out.sort((a, b) => (b.votes || 0) - (a.votes || 0));
      return out.slice(0, 50);
    },
    async byRegion(id) {
      const region = findRegion(id);
      /** @type {any[]} */
      let pool = await loadCn();
      const extras = [
        ...new Set([...(region.countrycodes || []), ...(region.extraCountrycodes || [])]),
      ].filter((cc) => cc && cc !== 'CN');
      for (const cc of extras) {
        const raw = await json(
          `/json/stations/search?countrycode=${encodeURIComponent(cc)}&hidebroken=true&order=votes&reverse=true&limit=200`,
        );
        pool = pool.concat(mapStations(raw));
      }
      return filterRegion(pool, region, REGION_LIMIT);
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

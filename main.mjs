import { fetchCover } from './cover.mjs';
import { createLivePump } from './pump.mjs';
import { createRadioBrowser, DirectoryError } from './radioBrowser.mjs';
import { mimeForCodec } from './station.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @type {null | ReturnType<typeof createLivePump>} */
let pump = null;

function destroyPump() {
  if (pump) {
    pump.destroy();
    pump = null;
  }
}

function isHlsUrl(url) {
  return /\.m3u8(\?|#|$)/i.test(url);
}

function codecFromUrl(url) {
  if (/\.aac(\?|#|$)/i.test(url) || /aacp?/i.test(url)) return 'AAC';
  return 'MP3';
}

export function activate(enso) {
  const api = createRadioBrowser();
  /** @type {Map<string, import('./station.mjs').normalizeStation extends Function ? any : never>} */
  const cache = new Map();

  const remember = (stations) => {
    for (const s of stations) cache.set(s.id, s);
  };

  const asDirectory = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DirectoryError) return { ok: false, error: err.message };
      console.warn('[box.radio]', err);
      return { ok: false, error: '电台目录暂时连不上，请稍后重试' };
    }
  };

  const asPlay = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn('[box.radio]', err);
      return { ok: false, error: '无法播放此电台' };
    }
  };

  enso.renderer.handle('discover', () =>
    asDirectory(async () => {
      const stations = await api.discover();
      remember(stations);
      return { ok: true, stations };
    }),
  );

  enso.renderer.handle('search', (args) =>
    asDirectory(async () => {
      const q = String(args?.q ?? '').trim();
      if (!q) {
        const stations = await api.discover();
        remember(stations);
        return { ok: true, stations };
      }
      if (q.length > 80) return { ok: false, error: '没有找到电台' };
      const stations = await api.search(q);
      remember(stations);
      return { ok: true, stations };
    }),
  );

  enso.renderer.handle('open', (args) =>
    asPlay(async () => {
      const id = String(args?.id ?? '').trim();
      if (!UUID_RE.test(id)) return { ok: false, error: '无法播放此电台' };
      const cached = cache.get(id);
      if (cached && !cached.playable) return { ok: false, reason: 'unsupported' };

      destroyPump();
      const clicked = await api.click(id);
      if (!clicked.url) return { ok: false, error: '无法播放此电台' };
      if (isHlsUrl(clicked.url) || (cached && cached.hls)) {
        return { ok: false, reason: 'unsupported' };
      }

      const codec = cached?.codec && cached.codec !== 'OTHER' ? cached.codec : codecFromUrl(clicked.url);
      const mime = mimeForCodec(codec);
      const next = createLivePump({ id, url: clicked.url, mime });
      pump = next;
      const ok = await next.waitOpen();
      if (!ok || pump !== next) {
        next.destroy();
        if (pump === next) pump = null;
        return { ok: false, error: '无法播放此电台' };
      }
      return { ok: true, id, name: clicked.name || cached?.name || '', mime };
    }),
  );

  enso.renderer.handle('chunk', (args) => {
    const id = String(args?.id ?? '').trim();
    if (!pump || pump.id !== id) return { ok: false, reason: 'stale' };
    const piece = pump.take();
    if (!piece.empty) {
      return {
        ok: true,
        empty: false,
        eof: false,
        b64: piece.buf.toString('base64'),
      };
    }
    return { ok: true, empty: true, eof: piece.eof, error: piece.error };
  });

  enso.renderer.handle('stop', () => {
    destroyPump();
    return { ok: true };
  });

  enso.renderer.handle('cover', async (args) => {
    try {
      return await fetchCover(String(args?.url ?? ''));
    } catch {
      return { ok: false };
    }
  });
}

export function deactivate() {
  destroyPump();
}

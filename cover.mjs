const MAX_DOWNLOAD = 256 * 1024;
/** data URL 经 JSON 返回必须 < 64KB */
const MAX_RAW = 40 * 1024;
const ALLOWED = /^(image\/jpeg|image\/jpg|image\/png|image\/gif|image\/webp|image\/x-icon|image\/vnd\.microsoft\.icon)(;.*)?$/i;

export async function fetchCover(url, { fetchApi = fetch, timeoutMs = 8_000 } = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchApi(url, {
      headers: { 'User-Agent': 'BoxRadio/0.1.0', Accept: 'image/*' },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) return { ok: false };
    const ctype = String(res.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (ctype && !ALLOWED.test(ctype)) return { ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_DOWNLOAD || buf.length > MAX_RAW) return { ok: false };
    const mime = ctype && ALLOWED.test(ctype) ? ctype.split(';')[0] : 'image/png';
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

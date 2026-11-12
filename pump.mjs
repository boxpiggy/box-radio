import { ByteChunker, IcyStripper } from './icy.mjs';

export const USER_AGENT = 'BoxRadio/0.1.0';
/** 小于 48KB：base64 + JSON 包装必须 < 64KB */
export const CHUNK_BYTES = 40 * 1024;
/** 首包小一些，64kbps 约 0.5s 即可起播 */
export const FIRST_CHUNK_BYTES = 4 * 1024;
const MAX_CHUNKS = 32;
const OPEN_WAIT_MS = 12_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createLivePump({ id, url, mime, fetchApi = fetch }) {
  const ac = new AbortController();
  /** @type {Buffer[]} */
  const queue = [];
  let eof = false;
  let error = '';
  let gotAudio = false;

  const run = async () => {
    try {
      const res = await fetchApi(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Icy-MetaData': '0',
        },
        redirect: 'follow',
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        error = '无法播放此电台';
        eof = true;
        return;
      }
      const ctype = String(res.headers.get('content-type') || '').toLowerCase();
      if (
        !/audio\/mpeg|audio\/mp3|audio\/aac|audio\/aacp|application\/octet-stream/.test(ctype)
      ) {
        console.warn('[box.radio] unexpected content-type', ctype);
      }
      const metaint = Number(res.headers.get('icy-metaint') || 0);
      const stripper = new IcyStripper(metaint);
      const chunker = new ByteChunker(CHUNK_BYTES, FIRST_CHUNK_BYTES);
      const enqueue = (buf) => {
        queue.push(buf);
        while (queue.length > MAX_CHUNKS) queue.shift();
      };
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ac.signal.aborted) break;
        if (!value?.length) continue;
        stripper.push(value, (audio) => {
          if (audio.length) gotAudio = true;
          chunker.push(audio, enqueue);
        });
      }
      if (!ac.signal.aborted) chunker.flush(enqueue);
    } catch (err) {
      if (!ac.signal.aborted) {
        error = '无法播放此电台';
        console.warn('[box.radio] pump', err?.message || err);
      }
    } finally {
      eof = true;
    }
  };

  const running = run();

  return {
    id,
    mime,
    take() {
      const buf = queue.shift();
      if (buf) return { empty: false, eof: false, buf };
      if (eof) return { empty: true, eof: true, error: error || undefined };
      return { empty: true, eof: false };
    },
    async waitOpen() {
      const start = Date.now();
      while (!queue.length && !eof && Date.now() - start < OPEN_WAIT_MS) {
        await sleep(40);
      }
      if (!queue.length) {
        ac.abort();
        await running.catch(() => {});
        return false;
      }
      return true;
    },
    destroy() {
      ac.abort();
      queue.length = 0;
      eof = true;
    },
  };
}

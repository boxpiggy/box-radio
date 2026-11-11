import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRadioBrowser, DirectoryError } from './radioBrowser.mjs';

test('discover uses a live node and maps stations', async () => {
  const calls = [];
  const api = createRadioBrowser({
    resolve4: async () => ['1.2.3.4'],
    reverse: async () => ['n1.api.radio-browser.info'],
    fetchApi: async (url) => {
      calls.push(String(url));
      return {
        status: 200,
        ok: true,
        json: async () => [
          {
            stationuuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: '中国之声',
            countrycode: 'CN',
            codec: 'MP3',
            hls: 0,
            lastcheckok: 1,
            bitrate: 64,
          },
        ],
      };
    },
  });
  const list = await api.discover();
  assert.equal(list.length, 1);
  assert.equal(list[0].playable, true);
  assert.match(calls[0], /n1\.api\.radio-browser\.info\/json\/stations\/search/);
});

test('click reads url from the click endpoint', async () => {
  const api = createRadioBrowser({
    resolve4: async () => ['1.2.3.4'],
    reverse: async () => ['n1.api.radio-browser.info'],
    fetchApi: async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        stationuuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: '中国之声',
        url: 'https://example.com/live.mp3',
      }),
    }),
  });
  const clicked = await api.click('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.equal(clicked.url, 'https://example.com/live.mp3');
  assert.equal(clicked.name, '中国之声');
});

test('all nodes down become DirectoryError', async () => {
  const api = createRadioBrowser({
    resolve4: async () => ['1.2.3.4'],
    reverse: async () => ['n1.api.radio-browser.info'],
    fetchApi: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(() => api.discover(), DirectoryError);
});

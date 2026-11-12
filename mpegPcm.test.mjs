import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodedToInt16, splitPcm } from './mpegPcm.mjs';

test('decodedToInt16 interleaves stereo PCM', () => {
  const packed = decodedToInt16({
    samplesDecoded: 2,
    sampleRate: 48000,
    channelData: [new Float32Array([0, 1]), new Float32Array([0, -1])],
  });
  assert.equal(packed.sr, 48000);
  assert.equal(packed.ch, 2);
  assert.equal(packed.buf.readInt16LE(0), 0);
  assert.equal(packed.buf.readInt16LE(2), 0);
  assert.equal(packed.buf.readInt16LE(4), 32767);
  assert.equal(packed.buf.readInt16LE(6), -32767);
});

test('splitPcm respects slice size', () => {
  const parts = splitPcm(Buffer.alloc(100), 40);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].length, 40);
  assert.equal(parts[2].length, 20);
});

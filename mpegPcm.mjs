import { MPEGDecoder } from 'mpg123-decoder';

export const PCM_SLICE = 36 * 1024;

export async function createMpegDecoder() {
  const decoder = new MPEGDecoder({ enableGapless: true });
  await decoder.ready;
  return decoder;
}

export function decodedToInt16(decoded) {
  const n = decoded.samplesDecoded | 0;
  if (!n) return null;
  const ch = decoded.channelData.length || 1;
  const buf = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let s = decoded.channelData[c][i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      buf.writeInt16LE((s * 32767) | 0, (i * ch + c) * 2);
    }
  }
  return { sr: decoded.sampleRate, ch, buf };
}

export function splitPcm(buf, slice = PCM_SLICE) {
  const out = [];
  for (let o = 0; o < buf.length; o += slice) {
    out.push(Buffer.from(buf.subarray(o, Math.min(o + slice, buf.length))));
  }
  return out;
}

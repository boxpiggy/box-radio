/** Icecast 间隔元数据剥除：只丢掉 meta 块，不解析标题。 */
export class IcyStripper {
  /**
   * @param {number} metaint
   */
  constructor(metaint) {
    const n = Number(metaint);
    this.metaint = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    this.mode = this.metaint ? 'audio' : 'pass';
    this.need = this.metaint || 0;
  }

  /**
   * @param {Uint8Array} buf
   * @param {(audio: Uint8Array) => void} onAudio
   */
  push(buf, onAudio) {
    if (!buf?.length) return;
    if (this.mode === 'pass') {
      onAudio(buf);
      return;
    }
    let offset = 0;
    while (offset < buf.length) {
      if (this.mode === 'audio') {
        const take = Math.min(this.need, buf.length - offset);
        if (take > 0) onAudio(buf.subarray(offset, offset + take));
        offset += take;
        this.need -= take;
        if (this.need === 0) {
          this.mode = 'len';
          this.need = 1;
        }
      } else if (this.mode === 'len') {
        const metaBytes = buf[offset] * 16;
        offset += 1;
        if (metaBytes === 0) {
          this.mode = 'audio';
          this.need = this.metaint;
        } else {
          this.mode = 'meta';
          this.need = metaBytes;
        }
      } else {
        const take = Math.min(this.need, buf.length - offset);
        offset += take;
        this.need -= take;
        if (this.need === 0) {
          this.mode = 'audio';
          this.need = this.metaint;
        }
      }
    }
  }
}

export class ByteChunker {
  /** @param {number} size */
  constructor(size) {
    this.size = size;
    this.buf = Buffer.alloc(0);
  }

  /**
   * @param {Uint8Array} piece
   * @param {(chunk: Buffer) => void} onChunk
   */
  push(piece, onChunk) {
    this.buf = this.buf.length
      ? Buffer.concat([this.buf, Buffer.from(piece)])
      : Buffer.from(piece);
    while (this.buf.length >= this.size) {
      onChunk(Buffer.from(this.buf.subarray(0, this.size)));
      this.buf = Buffer.from(this.buf.subarray(this.size));
    }
  }

  /** @param {(chunk: Buffer) => void} onChunk */
  flush(onChunk) {
    if (this.buf.length) onChunk(this.buf);
    this.buf = Buffer.alloc(0);
  }
}

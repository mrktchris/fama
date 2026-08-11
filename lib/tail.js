'use strict';

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

const MAX_READ_BYTES_PER_POLL = 1024 * 1024;
const MAX_PARTIAL_LINE_CHARS = 5 * 1024 * 1024;

/**
 * Incremental, byte-offset file tailer. Never re-reads from the start,
 * only reads bytes appended since the last poll. Keeps a trailing partial
 * line in a buffer until it's complete (jsonl lines can be written to disk
 * mid-write while Claude Code is still streaming a turn).
 */
class FileTailer {
  constructor(filePath, onRecords) {
    this.filePath = filePath;
    this.onRecords = onRecords;
    this.offset = 0;
    this.buffer = '';
    this.discardUntilNewline = false;
    // StringDecoder, not buf.toString('utf8'): a poll boundary can land in the
    // middle of a multi-byte UTF-8 character (an emoji, an accented letter),
    // and decoding each raw chunk independently would corrupt it into a
    // replacement character. StringDecoder holds back an incomplete trailing
    // byte sequence across calls instead of guessing. Found by external
    // review, real if rare in practice.
    this._decoder = new StringDecoder('utf8');
  }

  poll() {
    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch (err) {
      return; // file briefly missing/renaming, try again next poll
    }

    if (stat.size < this.offset) {
      // File was truncated or rotated out from under us. Restart clean
      // rather than throwing, a lost line here is better than a crash.
      this.offset = 0;
      this.buffer = '';
      this.discardUntilNewline = false;
      this._decoder = new StringDecoder('utf8');
    }

    if (stat.size === this.offset) return; // nothing new

    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      // A transcript may receive a very large tool result or image in one
      // append. Read it incrementally instead of allocating the entire delta
      // on the HTTP/SSE event loop in a single 250ms poll.
      const length = Math.min(stat.size - this.offset, MAX_READ_BYTES_PER_POLL);
      const buf = Buffer.alloc(length);
      // readSync's return value is the actual bytes read, which can be less
      // than requested (a short read is legal, not just theoretical). Offset
      // used to jump straight to stat.size regardless, silently skipping
      // whatever a short read missed. Now it only advances by what was
      // actually read, the rest gets picked up on the next poll.
      const bytesRead = fs.readSync(fd, buf, 0, length, this.offset);
      this.offset += bytesRead;
      let decoded = this._decoder.write(buf.subarray(0, bytesRead));
      if (this.discardUntilNewline) {
        const newline = decoded.indexOf('\n');
        if (newline === -1) return;
        decoded = decoded.slice(newline + 1);
        this.discardUntilNewline = false;
      }
      this.buffer += decoded;
    } catch (err) {
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // last entry may be a partial line, hold it back

    // A corrupt or hostile JSONL writer can otherwise grow one never-ending
    // line forever. Drop that record and resume after its eventual newline;
    // valid thumbnail-bearing records remain comfortably below this ceiling.
    if (!lines.length && this.buffer.length > MAX_PARTIAL_LINE_CHARS) {
      this.buffer = '';
      this.discardUntilNewline = true;
      return;
    }

    const records = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch (err) {
        // Partial or corrupt line, skip it. Shouldn't happen since we split
        // on completed newlines, but jsonl in the wild is jsonl in the wild.
      }
    }
    if (records.length) this.onRecords(records, this.filePath);
  }
}

module.exports = { FileTailer };

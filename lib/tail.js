'use strict';

const fs = require('fs');

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
    }

    if (stat.size === this.offset) return; // nothing new

    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      this.buffer += buf.toString('utf8');
    } catch (err) {
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop(); // last entry may be a partial line, hold it back

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

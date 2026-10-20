'use strict';
const path = require('node:path');
const { inflateRaw } = require('node:zlib');
const { promisify } = require('node:util');
const inflate = promisify(inflateRaw);
const MAX_CENTRAL_BYTES = 2 * 1024 * 1024, MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 4096;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function imageExtension(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  return null;
}
function candidate(name) {
  const key = name.replaceAll('\\', '/').toLowerCase(), parts = key.split('/');
  return !/[:\x00-\x1f]/.test(key) && !parts.some(part => !part || part === '.' || part === '..')
    && ['.png', '.jpg', '.jpeg'].includes(path.extname(key)) && /thumbnail|thumb|preview|metadata/.test(key);
}
async function extract3mfThumbnail(reader) {
  if (!reader || !Number.isSafeInteger(reader.size) || reader.size < 22 || typeof reader.readAt !== 'function') return null;
  const tailStart = Math.max(0, reader.size - 65557), tail = await reader.readAt(tailStart, reader.size - tailStart);
  let end = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) { end = offset; break; }
  }
  if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) return null;
  const count = tail.readUInt16LE(end + 10), centralSize = tail.readUInt32LE(end + 12), centralStart = tail.readUInt32LE(end + 16);
  if (!count || count > MAX_ENTRIES || count !== tail.readUInt16LE(end + 8) || centralSize > MAX_CENTRAL_BYTES
      || centralStart === 0xffffffff || centralStart + centralSize > tailStart + end || centralSize < 46) return null;
  const central = await reader.readAt(centralStart, centralSize), entries = []; let offset = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLength = central.readUInt16LE(offset + 28), extraLength = central.readUInt16LE(offset + 30), commentLength = central.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || next > central.length || central.readUInt16LE(offset + 34)) return null;
    const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength), name = nameBytes.toString('utf8');
    if (candidate(name)) entries.push({ nameBytes, name, flags: central.readUInt16LE(offset + 8), method: central.readUInt16LE(offset + 10), crc: central.readUInt32LE(offset + 16),
      compressed: central.readUInt32LE(offset + 20), size: central.readUInt32LE(offset + 24), start: central.readUInt32LE(offset + 42) });
    offset = next;
  }
  if (offset !== central.length) return null;
  entries.sort((a, b) => Number(!/thumbnail/i.test(a.name)) - Number(!/thumbnail/i.test(b.name)));
  for (const entry of entries.slice(0, 3)) {
    if (entry.flags & 65 || ![0, 8].includes(entry.method) || !entry.compressed || entry.compressed > MAX_IMAGE_BYTES
        || !entry.size || entry.size > MAX_IMAGE_BYTES || entry.start + 30 > centralStart) continue;
    const header = await reader.readAt(entry.start, 30);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) !== entry.flags || header.readUInt16LE(8) !== entry.method) continue;
    const localCrc = header.readUInt32LE(14), localCompressed = header.readUInt32LE(18), localSize = header.readUInt32LE(22);
    if (entry.flags & 8 ? (localCrc && localCrc !== entry.crc) || (localCompressed && localCompressed !== entry.compressed) || (localSize && localSize !== entry.size)
      : localCrc !== entry.crc || localCompressed !== entry.compressed || localSize !== entry.size) continue;
    const nameLength = header.readUInt16LE(26), dataStart = entry.start + 30 + nameLength + header.readUInt16LE(28);
    if (nameLength !== entry.nameBytes.length || dataStart + entry.compressed > centralStart) continue;
    const localName = await reader.readAt(entry.start + 30, nameLength);
    if (!localName.equals(entry.nameBytes)) continue;
    const compressed = await reader.readAt(dataStart, entry.compressed);
    let bytes;
    try { bytes = entry.method === 0 ? compressed : await inflate(compressed, { maxOutputLength: entry.size }); } catch (_) { continue; }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) continue;
    const extension = imageExtension(bytes);
    if (extension) return { buffer: bytes, extension, source: '3mf_thumbnail' };
  }
  return null;
}
module.exports = { extract3mfThumbnail, imageExtension, MAX_IMAGE_BYTES };

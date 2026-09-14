'use strict';

const zlib = require('zlib');

const DIGITS = {
  '2': ['11110', '00001', '00001', '11110', '10000', '10000', '11111'],
  '4': ['10010', '10010', '10010', '11111', '00010', '00010', '00010'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
};

let crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, value) => {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
      return crc >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function buildProbePng() {
  const scale = 8;
  const padding = 3;
  const text = '4827';
  const pixelWidth = padding * 2 + text.length * 5 + (text.length - 1);
  const pixelHeight = padding * 2 + 7;
  const width = pixelWidth * scale;
  const height = pixelHeight * scale;
  const rows = [];

  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    const py = Math.floor(y / scale) - padding;
    for (let x = 0; x < width; x += 1) {
      const px = Math.floor(x / scale) - padding;
      const digitIndex = Math.floor(px / 6);
      const withinDigit = px - digitIndex * 6;
      const on = py >= 0 && py < 7
        && digitIndex >= 0 && digitIndex < text.length
        && withinDigit >= 0 && withinDigit < 5
        && DIGITS[text[digitIndex]][py][withinDigit] === '1';
      if (on) {
        const offset = 1 + x * 3;
        row[offset] = 12;
        row[offset + 1] = 18;
        row[offset + 2] = 32;
      }
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PROBE_IMAGE_DATA_URL = `data:image/png;base64,${buildProbePng().toString('base64')}`;

function isImageInputRejection(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || '').toLowerCase();
  return [400, 404, 415, 422].includes(status)
    && /(image|vision|multimodal|image_url|content type|unsupported)/.test(message);
}

async function probeVision({ model, complete }) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await complete({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '只回复图片中的四位数字，不要添加其他内容。' },
          { type: 'image_url', image_url: { url: PROBE_IMAGE_DATA_URL } },
        ],
      }],
      max_completion_tokens: 12,
    });
    const answer = String(response?.choices?.[0]?.message?.content || '').replace(/\s/g, '');
    if (answer.includes('4827')) return { status: 'vision', checkedAt };
    return { status: 'text_only', checkedAt, reasonCode: 'VISION_ANSWER_INCORRECT' };
  } catch (error) {
    if (isImageInputRejection(error)) {
      return { status: 'text_only', checkedAt, reasonCode: 'IMAGE_INPUT_REJECTED' };
    }
    return {
      status: 'error',
      checkedAt,
      reasonCode: error?.name === 'AbortError' ? 'VISION_PROBE_TIMEOUT' : 'VISION_PROBE_FAILED',
    };
  }
}

module.exports = { PROBE_IMAGE_DATA_URL, isImageInputRejection, probeVision };

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Draws: dark rounded background, blue accent bar, white "F" glyph.
function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const bg = [15, 17, 21, 255];
  const accent = [79, 140, 255, 255];
  const white = [238, 241, 246, 255];

  function insideRounded(x, y) {
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx >= r || ry >= r) return true;
    const dx = r - rx;
    const dy = r - ry;
    return dx * dx + dy * dy <= r * r;
  }

  // "F" glyph metrics (proportional to size)
  const stemX0 = Math.round(size * 0.34);
  const stemX1 = Math.round(size * 0.47);
  const topY0 = Math.round(size * 0.26);
  const topY1 = Math.round(size * 0.37);
  const midY0 = Math.round(size * 0.46);
  const midY1 = Math.round(size * 0.56);
  const topX1 = Math.round(size * 0.70);
  const midX1 = Math.round(size * 0.64);

  // Accent diagonal band in the lower-right corner
  function inAccent(x, y) {
    const t = (x + y) / (2 * size);
    return t > 0.72;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!insideRounded(x, y)) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }
      let px = inAccent(x, y) ? accent : bg;
      const inStem = x >= stemX0 && x < stemX1 && y >= topY0 && y < midY1;
      const inTop = x >= stemX0 && x < topX1 && y >= topY0 && y < topY1;
      const inMid = x >= stemX0 && x < midX1 && y >= midY0 && y < midY1;
      if (inStem || inTop || inMid) px = white;
      rgba[i] = px[0];
      rgba[i + 1] = px[1];
      rgba[i + 2] = px[2];
      rgba[i + 3] = px[3];
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
[16, 48, 128].forEach((size) => {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log('wrote', file, fs.statSync(file).size, 'bytes');
});

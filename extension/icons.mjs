/**
 * Placeholder icons, generated at build time.
 *
 * The extension cannot load without icons, and a fresh clone should still build, so this
 * writes tiny honest PNGs (a dark rounded square with a light "J") rather than refusing
 * to build or shipping a binary asset nobody can review. Replace them with real artwork
 * under `extension/public/icons` and the build will prefer those.
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

/** Minimal PNG writer: RGBA scanlines, no interlace, CRC checked. Good enough for icons. */
function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[(width * 4 + 1) * y] = 0;
    pixels(y).copy(raw, (width * 4 + 1) * y + 1);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc);
    return Buffer.concat([length, body, sum]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A 5x7 "J" in a three-tone palette: edges, face, glyph.
const GLYPH = ["01110", "00100", "00100", "00100", "00100", "10100", "01000"];
const DARK = [24, 24, 27, 255];
const LIGHT = [250, 250, 249, 255];
const ACCENT = [37, 99, 235, 255];

/**
 * Homer Icon Generator.
 *
 * Generates crisp, modern monochrome icons:
 * Pure deep-black (#09090b) rounded squircle with a precision optical "H" monogram
 * rendered in pure crisp white (#ffffff). High-contrast, elegant, and readable at all sizes.
 */

export function generateIcon(target, size) {
  const radius = size * 0.22;
  const pixels = (y) => {
    const row = Buffer.alloc(size * 4);
    for (let x = 0; x < size; x += 1) {
      // Distance from center for rounded squircle mask
      const dx = Math.max(0, Math.abs(x - (size - 1) / 2) - ((size - 1) / 2 - radius));
      const dy = Math.max(0, Math.abs(y - (size - 1) / 2) - ((size - 1) / 2 - radius));
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        // Transparent outside squircle
        row.set([0, 0, 0, 0], x * 4);
        continue;
      }

      // Normalized coordinates (0..1)
      const nx = x / (size - 1);
      const ny = y / (size - 1);

      // Deep solid obsidian background (#09090b)
      let r = 9;
      let g = 9;
      let b = 11;
      let a = 255;

      // Subtle border edge highlight (1px inset)
      if (dist > radius - 1) {
        a = Math.round(Math.max(0, Math.min(1, radius - dist)) * 255);
      }

      // Precision geometry for modern capital "H"
      // Height spans 26% to 74% (ny: 0.26 to 0.74)
      // Left vertical stem: nx from 0.27 to 0.39 (center 0.33)
      // Right vertical stem: nx from 0.61 to 0.73 (center 0.67)
      // Crossbar: ny from 0.44 to 0.56, nx from 0.33 to 0.67
      const inYRange = ny >= 0.26 && ny <= 0.74;
      const inLeftStem = inYRange && nx >= 0.27 && nx <= 0.39;
      const inRightStem = inYRange && nx >= 0.61 && nx <= 0.73;
      const inCrossbar = ny >= 0.44 && ny <= 0.56 && nx >= 0.33 && nx <= 0.67;

      if (inLeftStem || inRightStem || inCrossbar) {
        // Pure crisp white glyph
        r = 255;
        g = 255;
        b = 255;
      }

      row.set([r, g, b, a], x * 4);
    }
    return row;
  };
  writeFileSync(target, png(size, size, pixels));
  console.log(`[homer-build] generated icon ${target} (${size}x${size})`);
}

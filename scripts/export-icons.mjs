// Reuse the existing macOS artwork for Windows and the in-app window icon.
import { readFile, writeFile } from 'node:fs/promises';
const source = await readFile(new URL('../resources/icon.icns', import.meta.url));
const images = new Map();
for (let p = 8; p < source.length;) {
  const size = source.readUInt32BE(p + 4);
  const data = source.subarray(p + 8, p + size);
  if (data.subarray(1, 4).toString() === 'PNG') {
    const width = data.readUInt32BE(16);
    if (width <= 256) images.set(width, data);
  }
  p += size;
}
const entries = [...images].sort(([a], [b]) => a - b);
if (!images.has(256)) throw new Error('Expected a 256px PNG in icon.icns');
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(([width, data], index) => {
  const p = 6 + index * 16;
  header[p] = header[p + 1] = width === 256 ? 0 : width;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(data.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += data.length;
});
await writeFile(new URL('../resources/icon.ico', import.meta.url), Buffer.concat([header, ...entries.map(([, data]) => data)]));
await writeFile(new URL('../resources/icon.png', import.meta.url), images.get(256));

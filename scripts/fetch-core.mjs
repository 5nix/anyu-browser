#!/usr/bin/env node
// Downloads the pinned upstream proxy core for a platform/arch into vendor/proxy-core/<platform>-<arch>/cave-core[.exe].
// Usage: node scripts/fetch-core.mjs [platform] [arch]   (defaults: this machine)
// The checksum must match resources/proxy-core/SHA256SUMS, or the build fails.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1.19.34';
const ASSET = {
  'darwin-arm64': 'mihomo-darwin-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-compatible',
  'linux-x64': 'mihomo-linux-amd64-compatible',
  'linux-arm64': 'mihomo-linux-arm64',
  'win32-x64': 'mihomo-windows-amd64-compatible',
  'win32-arm64': 'mihomo-windows-arm64',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const key = `${platform}-${arch}`;
if (!ASSET[key]) throw new Error(`no core build pinned for ${key}`);
const file = `${ASSET[key]}-${VERSION}.${platform === 'win32' ? 'zip' : 'gz'}`;

const sums = Object.fromEntries(
  (await readFile(join(root, 'resources/proxy-core/SHA256SUMS'), 'utf8')).trim().split(/\r?\n/).map((l) => l.split(/\s+/).reverse()),
);
const sha256 = sums[file];
if (!sha256) throw new Error(`${file} missing from SHA256SUMS`);

const outDir = join(root, 'vendor', 'proxy-core', key);
const out = join(outDir, platform === 'win32' ? 'cave-core.exe' : 'cave-core');
const stamp = join(outDir, '.sha256');
if (existsSync(out) && existsSync(stamp) && (await readFile(stamp, 'utf8')) === sha256) {
  console.log(`core ${VERSION} (${key}) already present`);
  process.exit(0);
}

const url = `https://github.com/MetaCubeX/mihomo/releases/download/${VERSION}/${file}`;
console.log(`fetching ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const archive = Buffer.from(await res.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== sha256) throw new Error(`checksum mismatch for ${file}: ${actual}`);

await mkdir(outDir, { recursive: true });
await writeFile(out, file.endsWith('.gz') ? gunzipSync(archive) : onlyExe(archive));
await chmod(out, 0o755);
await writeFile(stamp, sha256);
console.log(`core ${VERSION} -> ${out}`);

/** The Windows release is a zip holding one executable; read it through the central directory. */
function onlyExe(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = zip.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const local = zip.readUInt32LE(p + 42);
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    if (!name.endsWith('.exe')) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    return method === 0 ? data : inflateRawSync(data);
  }
  throw new Error('no executable in zip');
}

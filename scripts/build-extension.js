// Packages the browser extension in extension/ for the stores:
//
//   dist-extension/elevate-extension-edge.zip     Microsoft Edge Add-ons (and Chrome)
//   dist-extension/elevate-extension-firefox.zip  Firefox Add-ons
//
// The only difference is the manifest: Firefox needs browser_specific_settings
// (its add-on id), which Edge and Chrome warn about, so the Edge copy drops it.
//
// Usage: node scripts/build-extension.js

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const out = path.join(root, 'dist-extension');

/** A plain ZIP file (deflate), enough for store uploads. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date: 1980-01-01, so builds are identical
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function collect(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) =>
      e.isDirectory() ? collect(path.join(dir, e.name), `${prefix}${e.name}/`) : [{ name: `${prefix}${e.name}`, data: fs.readFileSync(path.join(dir, e.name)) }],
    );
}

const files = collect(src);
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const { browser_specific_settings: _firefoxOnly, ...edgeManifest } = manifest;
const withManifest = (m) => files.map((f) => (f.name === 'manifest.json' ? { name: f.name, data: Buffer.from(`${JSON.stringify(m, null, 2)}\n`) } : f));

fs.mkdirSync(out, { recursive: true });
for (const [name, m] of [
  ['elevate-extension-edge.zip', edgeManifest],
  ['elevate-extension-firefox.zip', manifest],
]) {
  const buf = zip(withManifest(m));
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`wrote dist-extension/${name} (${files.length} files, ${Math.round(buf.length / 1024)} KB, version ${m.version})`);
}

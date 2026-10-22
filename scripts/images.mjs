// One-time image pipeline: turns the original media downloaded from the Wix
// site (_capture/details/media) into right-sized, compressed files under
// site/assets/img. The outputs are committed, so this only needs re-running if
// a source image changes. Requires the `sharp` dev dependency.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, process.env.MEDIA_DIR || '_capture/details/media');
const OUT = path.join(ROOT, 'site/assets/img');

const src = (f) => path.join(SRC, f);
await fs.mkdir(OUT, { recursive: true });

async function save(pipeline, name) {
  const file = path.join(OUT, name);
  await pipeline.toFile(file);
  const { size } = await fs.stat(file);
  const meta = await sharp(file).metadata();
  console.log(`${name.padEnd(34)} ${String(meta.width).padStart(5)}x${String(meta.height).padEnd(5)} ${(size / 1024).toFixed(1)} KB`);
}

// Content screenshots shown inside the black "device" frames. `crop` mirrors
// the crop Wix applied before scaling; `widths` are the srcset candidates.
const shots = [
  { name: 'dispatch-desktop', file: '1526cd_532c44fab0e14a76bc948e6270bed2d5~mv2.png', crop: { left: 0, top: 4, width: 1291, height: 822 }, widths: [496, 706, 1291] },
  { name: 'mobile-client', file: '1526cd_07e3110384f14063b08eb16692c46de4~mv2.jpg', widths: [336, 411, 822] },
  { name: 'client-vertical', file: '1526cd_52a0d7922ae741ea888e4e87ca2a1fdb~mv2.png', widths: [265, 380, 530] },
  { name: 'sms-responses', file: '1526cd_5fc3b827b01e4ca89e5b437b36515ec3~mv2.png', crop: { left: 0, top: 225, width: 800, height: 371 }, widths: [565, 800] },
];
for (const s of shots) {
  for (const w of s.widths) {
    let p = sharp(src(s.file));
    if (s.crop) p = p.extract(s.crop);
    await save(p.resize({ width: w, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }), `${s.name}-${w}.webp`);
  }
}

// Soft gradient backgrounds behind the dark sections. They are heavily
// blurred, so modest resolutions are indistinguishable from the originals.
const backgrounds = [
  { name: 'bg-glow-a', file: '84770f_ff1e47135ac74cf4a604c7add4cfe4cd~mv2.jpg' },
  { name: 'bg-glow-b', file: '84770f_d33ed5a047724ede9b2f8527834e0dfb~mv2.jpg' },
];
for (const b of backgrounds) {
  for (const w of [960, 1920]) {
    await save(sharp(src(b.file)).resize({ width: w }).webp({ quality: 78, effort: 6, smartSubsample: true }), `${b.name}-${w}.webp`);
  }
}

// Logo mark (pin + route) used in the header and footer.
await save(sharp(src('1526cd_091f4e169a104878876cabaf90f3b615~mv2.png')).resize({ width: 160 }).webp({ quality: 90, alphaQuality: 100, effort: 6 }), 'logo-mark.webp');
await save(sharp(src('1526cd_091f4e169a104878876cabaf90f3b615~mv2.png')).resize({ width: 160 }).png({ compressionLevel: 9, palette: true }), 'logo-mark.png');

// Social icons (black Twitter / LinkedIn glyphs).
await save(sharp(src('c7d035ba85f6486680c2facedecdcf4d.png')).resize(52, 52).png({ compressionLevel: 9, palette: true }), 'icon-twitter.png');
await save(sharp(src('6ea5b4a88f0b4f91945b40499aa0af00.png')).resize(52, 52).png({ compressionLevel: 9, palette: true }), 'icon-linkedin.png');

// Social sharing preview image.
await save(sharp(src('1526cd_5cfc9b72e4dd410bab249968add83a5f~mv2.png')).png({ compressionLevel: 9, palette: true }), 'og-image.png');

// Favicons, from the same source Wix used for its favicon links.
const fav = src('1526cd_040504a9e9c94f5ab5bfea88240970de~mv2.png');
const SITE = path.join(ROOT, 'site');
const square = (size) => sharp(fav).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
await square(192).png({ compressionLevel: 9 }).toFile(path.join(SITE, 'favicon-192.png'));
await square(32).png({ compressionLevel: 9 }).toFile(path.join(SITE, 'favicon-32.png'));
await sharp(fav).resize(180, 180, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toFile(path.join(SITE, 'apple-touch-icon.png'));
// favicon.ico: a single 32x32 PNG-encoded icon (supported by all browsers).
const png32 = await square(32).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
await fs.writeFile(path.join(SITE, 'favicon.ico'), Buffer.concat([ico, png32]));
console.log('favicons written');

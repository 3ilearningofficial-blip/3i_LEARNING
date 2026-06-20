/**
 * Generates PWA / home-screen icons from the adaptive icon asset.
 * Crops the inner logo (drops the outer dark frame) so home-screen icons fill cleanly.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "assets/images/adaptive-icon.png");
const publicDir = join(root, "public");

const BRAND = { r: 10, g: 22, b: 40, alpha: 1 };

const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "favicon.png", size: 48 },
];

if (!existsSync(src)) {
  console.error("Missing source icon:", src);
  process.exit(1);
}

const meta = await sharp(src).metadata();
const canvas = meta.width || 1024;
const inner = Math.round(canvas * 0.66);
const margin = Math.floor((canvas - inner) / 2);

const logo = sharp(src).extract({
  left: margin,
  top: margin,
  width: inner,
  height: inner,
});

for (const { name, size } of sizes) {
  const out = join(publicDir, name);
  await logo
    .clone()
    .resize(size, size, { fit: "cover", position: "centre" })
    .flatten({ background: BRAND })
    .png()
    .toFile(out);
  console.log("Wrote", out);
}

const maskableOut = join(publicDir, "icon-512-maskable.png");
const maskableSize = 512;
const safeZone = Math.round(maskableSize * 0.8);
await logo
  .clone()
  .resize(safeZone, safeZone, { fit: "contain", background: BRAND })
  .extend({
    top: Math.floor((maskableSize - safeZone) / 2),
    bottom: Math.ceil((maskableSize - safeZone) / 2),
    left: Math.floor((maskableSize - safeZone) / 2),
    right: Math.ceil((maskableSize - safeZone) / 2),
    background: BRAND,
  })
  .png()
  .toFile(maskableOut);
console.log("Wrote", maskableOut);

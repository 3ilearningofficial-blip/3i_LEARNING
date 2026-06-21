/**
 * Generates PWA / home-screen icons from the white-square master icon.png.
 * Run: npm run icons:generate
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "assets/images/icon.png");
const publicDir = join(root, "public");

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "favicon.png", size: 48 },
];

if (!existsSync(src)) {
  console.error("Missing source icon:", src, "\nRun: node scripts/extract-icon-master.mjs");
  process.exit(1);
}

const master = sharp(src);

for (const { name, size } of sizes) {
  const out = join(publicDir, name);
  await master
    .clone()
    .resize(size, size, { fit: "contain", background: WHITE })
    .flatten({ background: WHITE })
    .png()
    .toFile(out);
  console.log("Wrote", out);
}

const maskableOut = join(publicDir, "icon-512-maskable.png");
const maskableSize = 512;
const safeZone = Math.round(maskableSize * 0.8);
await master
  .clone()
  .resize(safeZone, safeZone, { fit: "contain", background: WHITE })
  .extend({
    top: Math.floor((maskableSize - safeZone) / 2),
    bottom: Math.ceil((maskableSize - safeZone) / 2),
    left: Math.floor((maskableSize - safeZone) / 2),
    right: Math.ceil((maskableSize - safeZone) / 2),
    background: WHITE,
  })
  .png()
  .toFile(maskableOut);
console.log("Wrote", maskableOut);

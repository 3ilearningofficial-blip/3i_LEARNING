/**
 * Generates PWA / home-screen icons from the adaptive icon asset.
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

for (const { name, size } of sizes) {
  const out = join(publicDir, name);
  await sharp(src)
    .resize(size, size, { fit: "contain", background: { r: 10, g: 22, b: 40, alpha: 1 } })
    .png()
    .toFile(out);
  console.log("Wrote", out);
}

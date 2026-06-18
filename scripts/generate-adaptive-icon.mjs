/**
 * Generates Android adaptive icon with safe-zone padding.
 * Run: node scripts/generate-adaptive-icon.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "assets/images/icon.png");
const out = join(root, "assets/images/adaptive-icon.png");

if (!existsSync(src)) {
  console.error("Missing", src);
  process.exit(1);
}

const size = 1024;
const inner = Math.round(size * 0.66);

await sharp(src)
  .resize(inner, inner, { fit: "contain", background: { r: 10, g: 22, b: 40, alpha: 1 } })
  .extend({
    top: Math.floor((size - inner) / 2),
    bottom: Math.ceil((size - inner) / 2),
    left: Math.floor((size - inner) / 2),
    right: Math.ceil((size - inner) / 2),
    background: { r: 10, g: 22, b: 40, alpha: 1 },
  })
  .png()
  .toFile(out);

console.log("Wrote", out);

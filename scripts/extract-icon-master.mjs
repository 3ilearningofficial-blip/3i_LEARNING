/**
 * One-time / maintenance: extract white-square master icon.png from adaptive-icon.png.
 * Run: node scripts/extract-icon-master.mjs
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const adaptive = join(root, "assets/images/adaptive-icon.png");
const iconOut = join(root, "assets/images/icon.png");
const splashOut = join(root, "assets/images/splash-icon.png");

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const BRAND = { r: 10, g: 22, b: 40, alpha: 1 };

if (!existsSync(adaptive)) {
  console.error("Missing", adaptive);
  process.exit(1);
}

const meta = await sharp(adaptive).metadata();
const canvas = meta.width || 1024;
const inner = Math.round(canvas * 0.66);
const margin = Math.floor((canvas - inner) / 2);

const whiteSquare = sharp(adaptive).extract({
  left: margin,
  top: margin,
  width: inner,
  height: inner,
});

await whiteSquare
  .clone()
  .resize(1024, 1024, { fit: "fill" })
  .flatten({ background: WHITE })
  .png()
  .toFile(iconOut);
console.log("Wrote", iconOut);

const splashSize = 1024;
const logoOnSplash = Math.round(splashSize * 0.55);
await whiteSquare
  .clone()
  .resize(logoOnSplash, logoOnSplash, { fit: "contain", background: BRAND })
  .extend({
    top: Math.floor((splashSize - logoOnSplash) / 2),
    bottom: Math.ceil((splashSize - logoOnSplash) / 2),
    left: Math.floor((splashSize - logoOnSplash) / 2),
    right: Math.ceil((splashSize - logoOnSplash) / 2),
    background: BRAND,
  })
  .png()
  .toFile(splashOut);
console.log("Wrote", splashOut);

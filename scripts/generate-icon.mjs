// 用 comnyang-logo.svg 生成 1024x1024 的 icon.png（供 tauri icon 生成全套图标）
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'src', 'comnyang-logo.svg');
const outPath = path.join(root, 'src-tauri', 'icons', 'icon.png');

// SVG 是 30x30 像素画，放大 34 倍到 1024x1024。
// 用 nearest 重采样保持像素画的锐利边缘。
const svg = fs.readFileSync(svgPath);

await sharp(svg, { density: 300 })
  .resize(1024, 1024, { kernel: 'nearest' })
  .png()
  .toFile(outPath);

console.log('Generated icon.png (1024x1024) at:', outPath);
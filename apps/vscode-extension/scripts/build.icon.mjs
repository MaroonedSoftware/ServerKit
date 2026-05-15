import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../images/icon.svg');
const dest = resolve(__dirname, '../images/icon.png');

await sharp(src).resize(128, 128).png().toFile(dest);
console.log(`Wrote ${dest}`);

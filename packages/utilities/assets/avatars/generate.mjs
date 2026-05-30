// Regenerates the avatar showcase PNGs embedded in ../../README.md.
//
//   pnpm --filter @maroonedsoftware/utilities build   # refresh dist/
//   npm install --no-save @resvg/resvg-js             # one-off rasterizer
//   node assets/avatars/generate.mjs                  # rewrite the .png files
//
// Rerun whenever a generator's default look changes so the README stays honest.
//
// The generators emit SVG, but the README references PNG: some markdown renderers
// (and some GitHub views) refuse to display SVG referenced via an `<img>` tag,
// leaving the example grid blank. We therefore generate each SVG in memory and
// only write the rasterized PNG to disk.
//
// Rasterization uses @resvg/resvg-js, which is intentionally NOT a dependency of
// this package (the avatar code itself is dependency-free). Install it on demand
// with `npm install --no-save @resvg/resvg-js`; if it isn't present this script
// writes nothing and tells you what to install.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist/index.js');
const { generateFaceAvatarSvg, generateIdenticonSvg, generateGeometricSvg, generateGradientSwirlSvg, generateSmileyAvatarSvg, generateCityscapeSvg } = await import(dist);

const seeds = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Linus Torvalds', 'Margaret Hamilton'];

// name -> svg string. One entry per cell in the README example grid.
const svgs = {};
seeds.forEach((s, i) => (svgs[`face-${i}`] = generateFaceAvatarSvg(s, { size: 96 })));
seeds.forEach((s, i) => (svgs[`smiley-${i}`] = generateSmileyAvatarSvg(s, { size: 96 })));
seeds.forEach((s, i) => (svgs[`identicon-${i}`] = generateIdenticonSvg(s, { size: 96 })));
seeds.forEach((s, i) => (svgs[`geometric-${i}`] = generateGeometricSvg(s, { size: 96 })));
seeds.forEach((s, i) => (svgs[`gradient-${i}`] = generateGradientSwirlSvg(s, { size: 96, gradientType: i % 2 ? 'radial' : 'linear' })));
seeds.forEach((s, i) => (svgs[`cityscape-${i}`] = generateCityscapeSvg(s, { size: 96, timeOfDay: ['day', 'dusk', 'night'][i % 3] })));

// Rasterize each in-memory SVG to PNG at 2x (192px) for retina crispness; the
// README displays them at 72px.
let Resvg;
try {
  ({ Resvg } = await import('@resvg/resvg-js'));
} catch {
  console.error('\n@resvg/resvg-js not installed — nothing written.');
  console.error('Install it and rerun:');
  console.error('  npm install --no-save @resvg/resvg-js && node assets/avatars/generate.mjs\n');
  process.exit(1);
}

for (const [name, svg] of Object.entries(svgs)) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 192 } }).render().asPng();
  writeFileSync(resolve(here, `${name}.png`), png);
}
console.log(`wrote ${Object.keys(svgs).length} avatar PNGs in ${here}`);

// Deterministic cityscape avatar: a seeded skyline of buildings with lit windows
// against a gradient sky, topped by a sun or moon. Reads as a city/street view.
// Like the other styles it is figurative but fully abstract — no real place.
//
// Two layouts are supported via `view`:
//   - `flat`        a head-on skyline with street-level detail (default)
//   - `perspective` a two-point-perspective street corner
//
// Buildings are drawn as stylised silhouettes of famous landmarks (Empire State,
// Chrysler, Flatiron, Shanghai Tower, American Radiator Building). They are
// homages, not faithful reproductions — recognisable massing and crowns at
// avatar scale, nothing more.

import { AvatarSizeOptions, digest, gradientId, hsl, hueFromHash, wrapSvg } from './shared.js';

/** Sky/lighting mood for the cityscape style. */
export type CityscapeTimeOfDay = 'day' | 'dusk' | 'night';

/** Skyline layout for the cityscape style. */
export type CityscapeView = 'flat' | 'perspective';

/** Lunar phase for the night sky's moon. */
export type CityscapeMoonPhase = 'new' | 'waxingCrescent' | 'firstQuarter' | 'waxingGibbous' | 'full' | 'waningGibbous' | 'lastQuarter' | 'waningCrescent';

/** Softness of the sun/moon: edge blur plus halo size. */
export type CityscapeCelestialGlow = 'sharp' | 'soft' | 'hazy';

/**
 * Architectural style for the buildings, modelled on famous landmarks. `mixed`
 * (default) features each landmark at most once per skyline, filling the rest
 * with ordinary `plain` boxes — so a skyline reads as a few icons among regular
 * towers rather than a row of clones.
 *
 * - `setback`  Art Deco wedding-cake setbacks rising to a slender tower and mast (Empire State).
 * - `artdeco`  Slim shaft under a terraced, sunburst-arched steel crown and needle spire (Chrysler).
 * - `flatiron` Slim Beaux-Arts tower with a rounded prow, projecting cornice, and flagpole.
 * - `modern`   Tapered, twisting glass supertall with a smooth asymmetric crown (Shanghai Tower).
 * - `gothic`   Black Gothic tower with a gold-tipped stepped crown (American Radiator Building).
 * - `plain`    An ordinary rectangular tower; the filler used between landmarks in `mixed`.
 */
export type CityscapeBuildingStyle = 'mixed' | 'setback' | 'artdeco' | 'flatiron' | 'modern' | 'gothic' | 'plain';

// Internal alias used once 'mixed' has been resolved to a concrete style.
type ActiveStyle = Exclude<CityscapeBuildingStyle, 'mixed'>;

/** How a landmark's windows are drawn (shared by flat facades and perspective faces). */
type WindowMode = 'deco' | 'glass' | 'gothic' | 'classical';

/** Per-landmark metadata used by both views. */
const LANDMARKS: Record<ActiveStyle, { windowMode: WindowMode; heightMin: number; heightMax: number }> = {
  setback: { windowMode: 'deco', heightMin: 0.74, heightMax: 0.92 },
  artdeco: { windowMode: 'deco', heightMin: 0.72, heightMax: 0.9 },
  flatiron: { windowMode: 'classical', heightMin: 0.46, heightMax: 0.62 },
  modern: { windowMode: 'glass', heightMin: 0.8, heightMax: 0.98 },
  gothic: { windowMode: 'gothic', heightMin: 0.64, heightMax: 0.82 },
  plain: { windowMode: 'classical', heightMin: 0.5, heightMax: 0.88 },
};

// The landmarks that `mixed` features at most once each (excludes the plain box).
const FEATURED_STYLES: ActiveStyle[] = ['setback', 'artdeco', 'flatiron', 'modern', 'gothic'];

/** Options for {@link generateCityscapeSvg}. */
export interface CityscapeAvatarOptions extends AvatarSizeOptions {
  /** Sky/lighting mood. Default: seeded by a hash byte. */
  timeOfDay?: CityscapeTimeOfDay;
  /** Skyline layout. Default `flat`. */
  view?: CityscapeView;
  /** Number of foreground buildings (flat) / buildings per side (perspective). Default `6`. */
  buildingCount?: number;
  /** Pin the sky's top hue (0–360); the rest of the palette shifts with it. Default: per-mood. */
  hue?: number;
  /** Draw the sun/moon. Default `true`. */
  celestialBody?: boolean;
  /** Softness of the sun/moon glow (edge blur + halo size). Default `soft`. */
  celestialGlow?: CityscapeCelestialGlow;
  /** Draw drifting clouds. Default `true`. */
  clouds?: boolean;
  /** Draw stars (night only). Default: on at night, off otherwise. */
  stars?: boolean;
  /** Lunar phase at night. Default: seeded (any phase but `new`). */
  moonPhase?: CityscapeMoonPhase;
  /** Building landmark style. Default `mixed` (each building is seeded independently). */
  buildingStyle?: CityscapeBuildingStyle;
}

/** Fractional phase (0 = new, 0.5 = full) for each named lunar phase. */
const MOON_PHASE_FRACTION: Record<CityscapeMoonPhase, number> = {
  new: 0,
  waxingCrescent: 0.16,
  firstQuarter: 0.25,
  waxingGibbous: 0.37,
  full: 0.5,
  waningGibbous: 0.63,
  lastQuarter: 0.75,
  waningCrescent: 0.84,
};

// Phases used when seeding (every phase except `new`, which is all but invisible).
const SEEDED_MOON_PHASES: CityscapeMoonPhase[] = ['waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent'];

/** Per-mood palette and window-lighting tuning. */
interface CityscapePreset {
  /** Hue at the top of the sky gradient (0–360). */
  skyTopHue: number;
  skyTopSat: number;
  skyTopLight: number;
  /** Hue at the horizon. */
  skyBotHue: number;
  skyBotSat: number;
  skyBotLight: number;
  /** Building hue, expressed relative to {@link skyTopHue}. */
  buildingHueOffset: number;
  buildingSat: number;
  /** Building fill lightness range, front row darkest at the low end. */
  buildingLightMin: number;
  buildingLightMax: number;
  /** Lit / unlit window colors. */
  windowLit: string;
  windowDim: string;
  /** Probability (0–1) that a given window is lit. */
  litProbability: number;
  /** Warm glow used for streetlamps and ground-floor shopfronts; `null` in daylight. */
  glow: string | null;
  /** Sun/moon fill and whether it sits high in the sky (vs. near the horizon). */
  celestialColor: string;
  celestialHigh: boolean;
  /** When true the celestial body is the moon (phased); otherwise the sun. */
  moon: boolean;
  /** Cloud fill color and opacity. */
  cloudColor: string;
  cloudOpacity: number;
  /** Whether stars are drawn by default for this mood. */
  stars: boolean;
}

const PRESETS: Record<CityscapeTimeOfDay, CityscapePreset> = {
  day: {
    skyTopHue: 210,
    skyTopSat: 74,
    skyTopLight: 70,
    skyBotHue: 200,
    skyBotSat: 64,
    skyBotLight: 87,
    buildingHueOffset: 6,
    buildingSat: 16,
    buildingLightMin: 56,
    buildingLightMax: 78,
    // Reflective, sky-tinted glass with darker mullions for daytime contrast.
    windowLit: 'hsl(198 70% 90%)',
    windowDim: 'hsl(208 26% 48%)',
    litProbability: 0.34,
    glow: null,
    celestialColor: 'hsl(48 95% 64%)',
    celestialHigh: true,
    moon: false,
    cloudColor: 'hsl(0 0% 100%)',
    cloudOpacity: 0.92,
    stars: false,
  },
  dusk: {
    skyTopHue: 262,
    skyTopSat: 46,
    skyTopLight: 44,
    skyBotHue: 24,
    skyBotSat: 88,
    skyBotLight: 66,
    buildingHueOffset: 0,
    buildingSat: 28,
    buildingLightMin: 20,
    buildingLightMax: 34,
    windowLit: 'hsl(45 96% 68%)',
    windowDim: 'hsl(265 20% 24%)',
    litProbability: 0.55,
    glow: 'hsl(40 96% 66%)',
    celestialColor: 'hsl(28 96% 60%)',
    celestialHigh: false,
    moon: false,
    cloudColor: 'hsl(18 78% 74%)',
    cloudOpacity: 0.6,
    stars: false,
  },
  night: {
    skyTopHue: 232,
    skyTopSat: 60,
    skyTopLight: 13,
    skyBotHue: 224,
    skyBotSat: 52,
    skyBotLight: 27,
    buildingHueOffset: 0,
    buildingSat: 22,
    buildingLightMin: 13,
    buildingLightMax: 24,
    windowLit: 'hsl(50 92% 72%)',
    windowDim: 'hsl(230 18% 14%)',
    litProbability: 0.5,
    glow: 'hsl(45 95% 70%)',
    celestialColor: 'hsl(54 28% 90%)',
    celestialHigh: true,
    moon: true,
    cloudColor: 'hsl(230 28% 38%)',
    cloudOpacity: 0.55,
    stars: true,
  },
};

/**
 * Path for the illuminated portion of a phased moon, centered at (cx, cy) with
 * radius r. `phase` runs 0 (new) → 0.5 (full) → 1 (new again); the bright limb
 * is on the right while waxing and the left while waning. The terminator is a
 * half-ellipse whose width tracks the illuminated fraction, giving clean
 * crescent / quarter / gibbous / full silhouettes.
 */
const moonLitPath = (cx: number, cy: number, r: number, phase: number): string => {
  const cos = Math.cos(2 * Math.PI * phase); // +1 new … −1 full
  const rx = r * Math.abs(cos);
  const limbSweep = phase < 0.5 ? 1 : 0; // bright limb: right (waxing) / left (waning)
  const termSweep = cos > 0 ? (phase < 0.5 ? 0 : 1) : phase < 0.5 ? 1 : 0;
  const top = `${cx.toFixed(2)} ${(cy - r).toFixed(2)}`;
  const bottom = `${cx.toFixed(2)} ${(cy + r).toFixed(2)}`;
  return `M ${top} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${limbSweep} ${bottom} A ${rx.toFixed(2)} ${r.toFixed(2)} 0 0 ${termSweep} ${top} Z`;
};

/**
 * Edge-blur and halo tuning per glow softness. `blur` is the Gaussian
 * `stdDeviation` (viewBox units); `haloScale` multiplies the disc radius for the
 * radial halo; `inner`/`mid` are the halo gradient's opacity stops.
 */
const CELESTIAL_GLOW: Record<CityscapeCelestialGlow, { blur: number; haloScale: number; inner: number; mid: number }> = {
  sharp: { blur: 0.15, haloScale: 1.7, inner: 0.55, mid: 0.18 },
  soft: { blur: 0.6, haloScale: 2.6, inner: 0.8, mid: 0.38 },
  hazy: { blur: 1.6, haloScale: 4, inner: 0.95, mid: 0.52 },
};

/** Linear interpolation. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** One-decimal string for compact SVG coordinates. */
const f = (n: number): string => n.toFixed(1);

/**
 * Deterministic cityscape avatar for `seed`. Returns a standalone SVG string;
 * the same seed and options always yield the same SVG. Sky-gradient element ids
 * are seed-derived, so multiple cityscape avatars can be inlined on one page
 * without colliding.
 *
 * @param seed - Stable identifier to seed the avatar.
 * @param options - Optional mood/layout/size/skyline overrides.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateCityscapeSvg('acme-inc');
 * generateCityscapeSvg('acme-inc', { timeOfDay: 'night', buildingStyle: 'artdeco' });
 * generateCityscapeSvg('acme-inc', { view: 'perspective', timeOfDay: 'dusk' });
 * ```
 */
export const generateCityscapeSvg = (seed: string, options: CityscapeAvatarOptions = {}): string => {
  const h = digest(seed);
  const size = options.size ?? 100;
  const cornerRadius = options.cornerRadius ?? 12;
  const buildingCount = Math.max(3, options.buildingCount ?? 6);
  const showCelestial = options.celestialBody ?? true;
  const view = options.view ?? 'flat';
  const timeOfDay = options.timeOfDay ?? (['day', 'dusk', 'night'] as const)[h[0]! % 3]!;
  const preset = PRESETS[timeOfDay];
  const showClouds = options.clouds ?? true;
  const showStars = options.stars ?? preset.stars;
  const glow = CELESTIAL_GLOW[options.celestialGlow ?? 'soft'];
  const moonPhase = options.moonPhase ? MOON_PHASE_FRACTION[options.moonPhase] : MOON_PHASE_FRACTION[SEEDED_MOON_PHASES[h[5]! % SEEDED_MOON_PHASES.length]!];
  const id = gradientId(h);

  // Deterministic, well-mixed pseudo-random stream in [0, 1) from the digest.
  // Cheap xorshift so a tall building's many windows don't visibly repeat.
  const rnd = (n: number): number => {
    let x = ((h[n % 32]! + 1) * ((n + 1) * 0x9e3779b1)) | 0;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    return ((x >>> 0) % 100000) / 100000;
  };

  // Assign a style to each of `n` buildings. A forced style fills every slot
  // (the user opted in, duplicates and all). In `mixed`, each featured landmark
  // appears at most once — a seeded subset is scattered across the row and the
  // remaining slots get the repeatable `plain` box, so no landmark is cloned.
  const forcedStyle = options.buildingStyle ?? 'mixed';
  const shuffle = <T>(arr: T[], salt: number): T[] => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rnd(i * 13 + salt) * (i + 1)) | 0;
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const assignStyles = (n: number): ActiveStyle[] => {
    if (forcedStyle !== 'mixed') return Array.from({ length: n }, () => forcedStyle);
    const result: ActiveStyle[] = Array.from({ length: n }, () => 'plain');
    const landmarks = shuffle(FEATURED_STYLES, 311);
    const slots = shuffle(Array.from({ length: n }, (_, i) => i), 401);
    const nFeature = Math.min(landmarks.length, Math.max(1, Math.round(n * 0.55)));
    for (let k = 0; k < nFeature; k++) result[slots[k]!] = landmarks[k]!;
    return result;
  };

  // Sky hue can be re-pinned via `hue`; the whole palette rides along with it.
  const hueShift = options.hue !== undefined ? options.hue - preset.skyTopHue : 0;
  const skyTop = hsl((preset.skyTopHue + hueShift + 360) % 360, preset.skyTopSat, preset.skyTopLight);
  const skyBot = hsl((preset.skyBotHue + hueShift + 360) % 360, preset.skyBotSat, preset.skyBotLight);
  const buildingHue = (preset.skyTopHue + preset.buildingHueOffset + hueShift + 360) % 360;
  const darken = (light: number, by: number): string => hsl(buildingHue, preset.buildingSat, Math.max(8, light - by));
  const lighten = (light: number, by: number): string => hsl(buildingHue, Math.max(4, preset.buildingSat - 4), Math.min(94, light + by));
  const isDay = timeOfDay === 'day';

  // Gold accent for the Radiator crown and metallic steel for the Chrysler crown.
  const GOLD = 'hsl(44 80% 56%)';
  const GOLD_DIM = 'hsl(44 70% 42%)';
  const steel = isDay ? 'hsl(205 12% 70%)' : 'hsl(208 14% 40%)';

  // At night and dusk each lit window gets its own brightness and shade so the
  // facade reads as individual rooms rather than a uniform backlit panel.
  // `rndVal` is a [0, 1) value seeded independently from the lit/dim decision;
  // a second, decorrelated jitter derived from it varies the shade of yellow.
  // At daytime every pane is the same sky-reflective tone (no variation).
  const litWindowColor = (rndVal: number): string => {
    if (isDay) return preset.windowLit;
    const [minL, maxL] = timeOfDay === 'night' ? [10, 100] : [20, 95];
    const L = Math.round(minL + rndVal * (maxL - minL));
    // Decorrelated hue jitter: warm amber (~36) → pale yellow (~58), kept above
    // the orange-red range so even a dim, saturated window never reads as red.
    const hueJitter = (rndVal * 137.13) % 1;
    const H = Math.round(36 + hueJitter * 22);
    const S = Math.round(92 - rndVal * 22);
    return `hsl(${H} ${S}% ${L}%)`;
  };

  // Sky gradient, plus a soft radial halo and a small blur filter that let the
  // sun/moon bleed into the sky instead of sitting on it as a hard disc. All ids
  // share the seed-derived prefix so inlined avatars never collide.
  const skyDef = `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${skyTop}"/><stop offset="100%" stop-color="${skyBot}"/></linearGradient>`;
  const celestialDefs = showCelestial
    ? `<radialGradient id="${id}h"><stop offset="0%" stop-color="${preset.celestialColor}" stop-opacity="${glow.inner}"/><stop offset="35%" stop-color="${preset.celestialColor}" stop-opacity="${glow.mid}"/><stop offset="100%" stop-color="${preset.celestialColor}" stop-opacity="0"/></radialGradient><filter id="${id}b" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="${glow.blur}"/></filter>`
    : '';
  const defs = `<defs>${skyDef}${celestialDefs}</defs>`;

  // Sun (full disc) or phased moon. A soft radial halo fades into the sky and a
  // gentle blur softens the edge. The `celestialGlow` option scales both.
  const celestial = (cx: number, cy: number, r: number): string => {
    if (!showCelestial) return '';
    const halo = (rr: number, op: number): string => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr)}" fill="url(#${id}h)" opacity="${op.toFixed(2)}"/>`;
    if (preset.moon) {
      const illum = (1 - Math.cos(2 * Math.PI * moonPhase)) / 2;
      const moonGlow = illum > 0.03 ? halo(r * glow.haloScale * 0.9, illum) : '';
      return `${moonGlow}<path d="${moonLitPath(cx, cy, r, moonPhase)}" fill="${preset.celestialColor}" filter="url(#${id}b)"/>`;
    }
    return `${halo(r * glow.haloScale, 1)}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${preset.celestialColor}" filter="url(#${id}b)"/>`;
  };

  // A puffy cloud built from overlapping ellipses, centered at (cx, cy).
  const cloud = (cx: number, cy: number, w: number, n: number): string => {
    let lobes = `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w)}" ry="${f(w * 0.42)}"/>`;
    for (let k = 0; k < 3; k++) {
      const lx = cx + (rnd(n * 7 + k * 3 + 1) - 0.5) * w * 1.3;
      const ly = cy - rnd(n * 7 + k * 3 + 2) * w * 0.32;
      lobes += `<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(w * (0.42 + rnd(n * 7 + k * 3 + 3) * 0.3))}"/>`;
    }
    return `<g fill="${preset.cloudColor}" opacity="${preset.cloudOpacity}">${lobes}</g>`;
  };

  // 0–3 clouds drifting across the upper sky band [yTop, yBot].
  const clouds = (yTop: number, yBot: number): string => {
    if (!showClouds) return '';
    const count = 1 + (h[6]! % 3);
    let s = '';
    for (let i = 0; i < count; i++) {
      const cx = 14 + rnd(i * 23 + 31) * 72;
      const cy = yTop + rnd(i * 23 + 32) * (yBot - yTop);
      s += cloud(cx, cy, 8 + rnd(i * 23 + 33) * 7, i + 1);
    }
    return s;
  };

  // Scattered, faintly twinkling stars across the sky band [yTop, yBot].
  const stars = (yTop: number, yBot: number): string => {
    if (!showStars) return '';
    let s = '';
    for (let i = 0; i < 46; i++) {
      const sx = rnd(i * 9 + 200) * 100;
      const sy = yTop + rnd(i * 9 + 201) * (yBot - yTop);
      const r = 0.25 + rnd(i * 9 + 202) * 0.6;
      s += `<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(r)}" fill="hsl(210 40% 96%)" opacity="${(0.4 + rnd(i * 9 + 203) * 0.6).toFixed(2)}"/>`;
    }
    return s;
  };

  // A generic lit/unlit window grid filling [x, x+w] × [top, bottom], centered.
  // `litFill` overrides the lit color (used for the Radiator's gold windows).
  const windowGrid = (seedN: number, x: number, w: number, top: number, bottom: number, cellW: number, cellH: number, winW: number, winH: number, rx: number, litFill?: (b: number) => string): string => {
    const availH = bottom - top;
    if (availH < winH || w < winW) return '';
    const cols = Math.max(1, Math.floor(w / cellW));
    const rows = Math.max(1, Math.floor(availH / cellH));
    const sx = x + (w - (cols * cellW - (cellW - winW))) / 2;
    const sy = top + (availH - (rows * cellH - (cellH - winH))) / 2;
    let s = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rnd(seedN * 131 + r * 17 + c * 7 + 23) < preset.litProbability;
        const fill = lit ? (litFill ?? litWindowColor)(rnd(seedN * 179 + r * 13 + c * 11 + 37)) : preset.windowDim;
        s += `<rect x="${f(sx + c * cellW)}" y="${f(sy + r * cellH)}" width="${winW}" height="${winH}" rx="${rx}" fill="${fill}"/>`;
      }
    }
    return s;
  };

  const rect = (x: number, y: number, w: number, hh: number, fill: string): string => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(hh)}" fill="${fill}"/>`;
  const redLight = (cx: number, cy: number): string => (preset.glow ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="0.9" fill="hsl(2 85% 60%)"/>` : '');

  const body = view === 'perspective' ? renderPerspective() : renderFlat();
  return wrapSvg(size, cornerRadius, `url(#${id})`, body, defs);

  // --- Flat head-on skyline ------------------------------------------------

  function renderFlat(): string {
    const BASE = 96; // sidewalk top; the street strip lives below this.
    const slot = 100 / buildingCount;
    let s = '';

    // Sky backdrop: stars behind, then the sun/moon, then clouds drifting in front.
    s += stars(2, 66);
    const cx = 16 + (hueFromHash(h) / 360) * 68;
    const cy = preset.celestialHigh ? 20 + rnd(3) * 10 : 52 + rnd(3) * 8;
    s += celestial(cx, cy, preset.celestialHigh ? 8 : 11);
    s += clouds(5, 42);

    // Distant back row: blended toward the sky for atmospheric haze, then a
    // translucent haze band so the foreground reads as nearer.
    const backLight = Math.min(94, preset.skyBotLight - 4);
    for (let i = 0; i < buildingCount; i++) {
      const bw = slot * 0.9;
      const bx = i * slot + slot * 0.55 - bw / 2;
      const height = 22 + rnd(i * 5 + 100) * 26;
      s += rect(bx, BASE - height, bw, height, hsl(buildingHue, Math.max(5, preset.buildingSat - 10), backLight)).replace('/>', ' opacity="0.7"/>');
    }
    s += `<rect x="0" y="${f(BASE - 16)}" width="100" height="16" fill="${skyBot}" opacity="0.25"/>`;

    // Foreground row: each building is a seeded landmark or a plain box, with no
    // landmark repeated across the skyline.
    const styles = assignStyles(buildingCount);
    for (let i = 0; i < buildingCount; i++) {
      const bw = slot + 0.6;
      const bx = i * slot - 0.3;
      const light = preset.buildingLightMin + rnd(i * 7 + 2) * (preset.buildingLightMax - preset.buildingLightMin);
      s += landmark(styles[i]!, i, bx, bw, BASE, light);
      s += shopfronts(i, bx, bw, BASE);
    }

    // Street strip + curb under everything at street level.
    s += `<rect x="0" y="${f(BASE)}" width="100" height="${f(100 - BASE)}" fill="${darken(preset.buildingLightMin, 2)}"/>`;
    s += `<rect x="0" y="${f(BASE - 0.8)}" width="100" height="0.8" fill="${darken(preset.buildingLightMin, 8)}"/>`;

    // A few streetlamps in front, glowing after dark.
    for (const lx of [10, 38, 66, 92]) {
      const top = BASE - 11;
      if (preset.glow) s += `<circle cx="${lx}" cy="${f(top)}" r="3.4" fill="${preset.glow}" opacity="0.4"/>`;
      s += `<rect x="${f(lx - 0.4)}" y="${f(top)}" width="0.8" height="11" fill="${darken(preset.buildingLightMin, 6)}"/>`;
      s += `<circle cx="${lx}" cy="${f(top)}" r="1.3" fill="${preset.glow ?? darken(preset.buildingLightMax, 0)}"/>`;
    }
    return s;
  }

  // Dispatch a flat-view landmark silhouette (body + windows + crown).
  function landmark(style: ActiveStyle, i: number, bx: number, bw: number, base: number, light: number): string {
    const spec = LANDMARKS[style];
    const avail = base - 13;
    const H = avail * lerp(spec.heightMin, spec.heightMax, rnd(i * 3 + 1));
    const cx = bx + bw / 2;
    switch (style) {
      case 'setback':
        return setback(i, cx, bw, base, H, light);
      case 'artdeco':
        return artdeco(i, cx, bw, base, H, light);
      case 'flatiron':
        return flatiron(i, cx, bw, base, H, light);
      case 'modern':
        return modern(i, cx, bw, base, H);
      case 'gothic':
        return gothic(i, cx, bw, base, H);
      case 'plain':
        return plain(i, cx, bw, base, H, light);
    }
  }

  // An ordinary rectangular tower: the repeatable filler between landmarks.
  function plain(i: number, cx: number, bw: number, base: number, H: number, light: number): string {
    const fill = hsl(buildingHue, preset.buildingSat, light);
    const top = base - H;
    let s = rect(cx - bw / 2, top, bw, H, fill);
    s += windowGrid(i * 5 + 1, cx - bw / 2 + 1.5, bw - 3, top + 2.5, base - 1.5, 4.3, 4.3, 2.6, 2.6, 0.4);
    const pick = rnd(i * 29 + 7);
    if (H > 56 && preset.glow && rnd(i * 11 + 4) > 0.6) {
      // Antenna mast with a warning light on tall towers, at night/dusk.
      s += `<rect x="${f(cx - 0.4)}" y="${f(top - 8)}" width="0.8" height="8" fill="${darken(light, 14)}"/>`;
      s += redLight(cx, top - 8);
    } else if (pick < 0.34) {
      // Flat roof.
    } else if (pick < 0.64) {
      // Stepped setback with a few windows.
      const ew = bw * 0.5;
      const eh = Math.min(top - 2, 4 + rnd(i * 13) * 6);
      if (eh > 1) {
        s += rect(cx - ew / 2, top - eh, ew, eh, fill);
        s += windowGrid(i * 5 + 3, cx - ew / 2 + 1, ew - 2, top - eh + 1.5, top - 0.5, 4.0, 3.8, 2.4, 2.4, 0.3);
      }
    } else {
      // Rooftop water tank on legs.
      const tw = Math.min(7, bw * 0.42), tx = cx - bw * 0.22, ty = top - 5;
      const leg = darken(light, 16);
      s += `<rect x="${f(tx)}" y="${f(ty)}" width="0.7" height="5" fill="${leg}"/><rect x="${f(tx + tw - 0.7)}" y="${f(ty)}" width="0.7" height="5" fill="${leg}"/>`;
      s += rect(tx, ty - 5, tw, 5.5, darken(light, 8));
    }
    return s;
  }

  // setback (Empire State): full-width base, two setbacks, a slender tower, and a mast.
  function setback(i: number, cx: number, bw: number, base: number, H: number, light: number): string {
    const fill = hsl(buildingHue, preset.buildingSat, light);
    const tiers = [
      { w: bw, y0: base, y1: base - H * 0.34 },
      { w: bw * 0.8, y0: base - H * 0.34, y1: base - H * 0.58 },
      { w: bw * 0.58, y0: base - H * 0.58, y1: base - H * 0.79 },
      { w: bw * 0.32, y0: base - H * 0.79, y1: base - H * 0.93 },
    ];
    let s = '';
    tiers.forEach((t, k) => {
      s += rect(cx - t.w / 2, t.y1, t.w, t.y0 - t.y1, k === 3 ? lighten(light, 4) : fill);
      s += windowGrid(i * 5 + k, cx - t.w / 2 + 1, t.w - 2, t.y1 + 1, t.y0 - 0.5, 2.9, 3.4, 1.7, 2.3, 0.2);
    });
    // Observation-deck band atop the tower, then the mooring mast + antenna.
    const towerTop = base - H * 0.93;
    s += rect(cx - bw * 0.2, towerTop - 1.6, bw * 0.4, 1.6, darken(light, 10));
    s += `<rect x="${f(cx - 0.5)}" y="${f(base - H)}" width="1" height="${f(towerTop - 1.6 - (base - H))}" fill="${lighten(light, 8)}"/>`;
    s += `<circle cx="${f(cx)}" cy="${f(base - H)}" r="1.1" fill="${lighten(light, 12)}"/>`;
    s += redLight(cx, base - H - 1.6);
    return s;
  }

  // artdeco (Chrysler): slim shaft beneath a terraced steel crown of sunburst arches + needle.
  function artdeco(i: number, cx: number, bw: number, base: number, H: number, light: number): string {
    const fill = hsl(buildingHue, preset.buildingSat, light);
    const shaftW = bw * 0.6;
    const yBase = base - H * 0.2;
    const yShaft = base - H * 0.58;
    let s = rect(cx - bw / 2, yBase, bw, base - yBase, fill);
    s += rect(cx - shaftW / 2, yShaft, shaftW, yBase - yShaft, fill);
    s += windowGrid(i * 5 + 1, cx - bw / 2 + 1, bw - 2, yBase + 1, base - 1, 3.0, 3.4, 1.7, 2.3, 0.2);
    s += windowGrid(i * 5 + 2, cx - shaftW / 2 + 1, shaftW - 2, yShaft + 1, yBase - 0.5, 2.8, 3.4, 1.6, 2.3, 0.2);

    // Terraced crown: nested arches narrowing toward a needle, with triangular windows.
    const tiers = 6;
    const crownTop = base - H * 0.9;
    for (let k = 0; k < tiers; k++) {
      const tW = shaftW * (1 - k * 0.15);
      const y0 = lerp(yShaft, crownTop, k / tiers);
      const y1 = lerp(yShaft, crownTop, (k + 1) / tiers);
      const arch = tW * 0.5;
      const lx = cx - tW / 2, rx2 = cx + tW / 2, springY = y1 + arch;
      s += `<path d="M ${f(lx)} ${f(y0)} V ${f(springY)} A ${f(tW / 2)} ${f(arch)} 0 0 1 ${f(rx2)} ${f(springY)} V ${f(y0)} Z" fill="${steel}"/>`;
      // Triangular sunburst windows along the arch.
      const nt = Math.max(2, Math.floor(tW / 2.4));
      for (let t = 0; t < nt; t++) {
        const tx = lerp(lx + 1, rx2 - 1, nt === 1 ? 0.5 : t / (nt - 1));
        const lit = rnd(i * 31 + k * 5 + t) < preset.litProbability + 0.15;
        s += `<polygon points="${f(tx)},${f(springY - 0.3)} ${f(tx - 0.7)},${f(springY + 1.4)} ${f(tx + 0.7)},${f(springY + 1.4)}" fill="${lit ? GOLD : darken(light, 6)}"/>`;
      }
    }
    // Needle spire.
    s += `<rect x="${f(cx - 0.4)}" y="${f(base - H)}" width="0.8" height="${f(crownTop - (base - H))}" fill="${steel}"/>`;
    s += redLight(cx, base - H);
    return s;
  }

  // Flatiron: a slim Beaux-Arts tower with a rounded prow, cornice, and flagpole.
  function flatiron(i: number, cx: number, bw: number, base: number, H: number, light: number): string {
    const fill = hsl(buildingHue, preset.buildingSat, light);
    const w = Math.min(bw * 0.64, bw - 2.5);
    const lx = cx - w / 2, rx2 = cx + w / 2, top = base - H;
    const r = w * 0.46;
    // Body with a rounded top (the prow).
    let s = `<path d="M ${f(lx)} ${f(base)} V ${f(top + r)} Q ${f(lx)} ${f(top)} ${f(lx + r)} ${f(top)} H ${f(rx2 - r)} Q ${f(rx2)} ${f(top)} ${f(rx2)} ${f(top + r)} V ${f(base)} Z" fill="${fill}"/>`;
    // Projecting stone cornice and a base band (tripartite facade).
    const stone = lighten(light, 12);
    s += rect(lx - 0.7, top + r + 0.6, w + 1.4, 1.3, stone);
    s += rect(lx, base - 5.5, w, 1.0, stone);
    // Classical punched windows in the shaft.
    s += windowGrid(i * 5 + 1, lx + 1, w - 2, top + r + 3, base - 6, 3.2, 3.6, 1.9, 2.5, 0.3);
    // Flagpole.
    s += `<rect x="${f(cx - 0.3)}" y="${f(top - 5)}" width="0.6" height="5" fill="${darken(light, 12)}"/>`;
    return s;
  }

  // modern (Shanghai Tower): a tapered, twisting glass supertall with a smooth crown.
  function modern(i: number, cx: number, bw: number, base: number, H: number): string {
    const baseW = bw * 0.86, topW = baseW * 0.56, top = base - H;
    const blx = cx - baseW / 2, brx = cx + baseW / 2, tlx = cx - topW / 2, trx = cx + topW / 2;
    const bow = baseW * 0.12;
    const glassL = isDay ? 60 : 30;
    const glass = `hsl(196 32% ${glassL}%)`;
    // Tapered body, curved (twisting) left edge, asymmetric rounded top.
    let s = `<path d="M ${f(blx)} ${f(base)} C ${f(blx - bow)} ${f(lerp(base, top, 0.4))} ${f(tlx - bow * 0.5)} ${f(lerp(base, top, 0.82))} ${f(tlx)} ${f(top + 3)} Q ${f(cx)} ${f(top - 2)} ${f(trx)} ${f(top + 5)} C ${f(brx + bow * 0.4)} ${f(lerp(base, top, 0.82))} ${f(brx + bow * 0.3)} ${f(lerp(base, top, 0.4))} ${f(brx)} ${f(base)} Z" fill="${glass}"/>`;
    // Glass floor striations, each clipped to the taper width at its height.
    const floors = Math.floor(H / 3.4);
    for (let r = 1; r < floors; r++) {
      const fy = base - r * 3.4;
      const fwHalf = (lerp(baseW, topW, (base - fy) / H) * 0.9) / 2;
      s += `<rect x="${f(cx - fwHalf)}" y="${f(fy)}" width="${f(fwHalf * 2)}" height="0.7" fill="${`hsl(196 30% ${glassL + 14}%)`}" opacity="0.5"/>`;
    }
    // A few lit windows for occupancy at dusk/night.
    if (preset.glow) {
      for (let r = 2; r < floors - 1; r += 2) {
        if (rnd(i * 17 + r) > 0.55) {
          const fy = base - r * 3.4;
          const fwHalf = (lerp(baseW, topW, (base - fy) / H) * 0.78) / 2;
          const wx = cx - fwHalf + rnd(i * 17 + r + 1) * (fwHalf * 1.6);
          s += `<rect x="${f(wx)}" y="${f(fy - 1.6)}" width="1.6" height="1.6" rx="0.3" fill="${litWindowColor(rnd(i * 19 + r))}"/>`;
        }
      }
    }
    // Soft vertical highlight (mullion line) suggesting the twist.
    s += `<rect x="${f(cx - 0.4)}" y="${f(top + 4)}" width="0.8" height="${f(base - top - 5)}" fill="${`hsl(196 30% ${glassL + 18}%)`}" opacity="0.4"/>`;
    return s;
  }

  // gothic (American Radiator Building): a black Gothic tower with a gold-tipped crown.
  function gothic(i: number, cx: number, bw: number, base: number, H: number): string {
    const dark = hsl(buildingHue, 16, isDay ? 24 : 12);
    const darker = hsl(buildingHue, 16, isDay ? 17 : 8);
    const top = base - H;
    const yBody = base - H * 0.72;
    let s = rect(cx - bw / 2, yBody, bw, base - yBody, dark);
    // Gothic vertical piers with recessed gold window columns.
    const cols = Math.max(3, Math.round(bw / 3.4));
    const colW = bw / cols;
    for (let c = 0; c < cols; c++) {
      const colX = cx - bw / 2 + c * colW;
      s += rect(colX, yBody, 0.7, base - yBody, darker); // pier
      const winX = colX + 1.0;
      const rows = Math.floor((base - yBody - 2) / 3.2);
      for (let r = 0; r < rows; r++) {
        const lit = rnd(i * 23 + c * 5 + r) < preset.litProbability * 0.7;
        s += `<rect x="${f(winX)}" y="${f(yBody + 1.5 + r * 3.2)}" width="${f(Math.max(0.8, colW - 1.6))}" height="2.0" rx="0.2" fill="${lit ? GOLD : darker}"/>`;
      }
    }
    // Two Gothic setbacks with gold copings.
    const s1w = bw * 0.7, s1y = base - H * 0.85;
    const s2w = bw * 0.46, s2y = base - H * 0.94;
    s += rect(cx - s1w / 2, s1y, s1w, yBody - s1y, dark) + rect(cx - s1w / 2, s1y, s1w, 0.8, GOLD_DIM);
    s += rect(cx - s2w / 2, s2y, s2w, s1y - s2y, dark) + rect(cx - s2w / 2, s2y, s2w, 0.8, GOLD_DIM);
    // Stepped gold pinnacle crown.
    const stepW = [s2w * 0.7, s2w * 0.44, s2w * 0.22];
    let stepY = s2y;
    for (let k = 0; k < 3; k++) {
      const sh = (s2y - top) / 3;
      s += rect(cx - stepW[k]! / 2, stepY - sh, stepW[k]!, sh, k === 2 ? GOLD : GOLD_DIM);
      stepY -= sh;
    }
    s += `<polygon points="${f(cx)},${f(top - 3)} ${f(cx - 1.2)},${f(top)} ${f(cx + 1.2)},${f(top)}" fill="${GOLD}"/>`;
    return s;
  }

  // Ground-floor shopfronts: wide, warm-lit bays at the base of a building.
  function shopfronts(i: number, bx: number, bw: number, base: number): string {
    const bays = Math.max(1, Math.round(bw / 7));
    const gap = 0.8;
    const bayW = (bw - gap * (bays + 1)) / bays;
    const top = base - 5;
    let s = '';
    for (let b = 0; b < bays; b++) {
      const sx = bx + gap + b * (bayW + gap);
      const lit = preset.glow && rnd(i * 41 + b * 5 + 9) > 0.35;
      const fill = lit ? preset.glow! : preset.windowDim;
      s += `<rect x="${f(sx)}" y="${f(top)}" width="${f(bayW)}" height="4.4" rx="0.4" fill="${fill}" opacity="${lit ? '0.92' : '1'}"/>`;
    }
    return s;
  }

  // --- Two-point-perspective city block ------------------------------------

  function renderPerspective(): string {
    // Every building shares a left and a right vanishing point on a common
    // horizon. Vertical edges stay vertical; the two visible side faces recede
    // to opposite VPs. Famous-building cues here are limited to crowns/spires —
    // the head-on silhouettes belong to the flat view.
    const HZ = 38 + rnd(2) * 8;
    const VPL = { x: -30 - rnd(3) * 12, y: HZ };
    const VPR = { x: 130 + rnd(5) * 12, y: HZ };

    type P = { x: number; y: number };
    const lpt = (a: P, b: P, t: number): P => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    const cross = (a: P, b: P, c: P, d: P): P => {
      const d1x = b.x - a.x, d1y = b.y - a.y, d2x = d.x - c.x, d2y = d.y - c.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-6) return a;
      const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
      return { x: a.x + d1x * t, y: a.y + d1y * t };
    };
    const poly = (pts: P[], fill: string): string => `<polygon points="${pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}" fill="${fill}"/>`;

    let s = '';
    s += stars(2, HZ - 2);
    const asphalt = darken(preset.buildingLightMin, 5);
    const curbCol = darken(preset.buildingLightMin, 9);
    const sidewalkCol = hsl(buildingHue, Math.max(4, preset.buildingSat - 8), Math.min(90, preset.buildingLightMin + (isDay ? 32 : 16)));

    s += `<rect x="0" y="${f(HZ)}" width="100" height="${f(100 - HZ)}" fill="${asphalt}"/>`;
    s += `<rect x="0" y="${f(HZ - 5)}" width="100" height="10" fill="${skyBot}" opacity="0.25"/>`;

    const Hc = { x: 50, y: 86 };
    const curb = { x: 50, y: 90 };
    const mid = { x: 50, y: 95 };
    const tMax = 0.85;

    for (const VP of [VPL, VPR]) {
      s += poly([Hc, lpt(Hc, VP, tMax), lpt(curb, VP, tMax), curb], sidewalkCol);
      s += `<line x1="${f(curb.x)}" y1="${f(curb.y)}" x2="${f(VP.x)}" y2="${f(VP.y)}" stroke="${curbCol}" stroke-width="0.8"/>`;
      const m = lpt(mid, VP, tMax);
      s += `<line x1="${f(mid.x)}" y1="${f(mid.y)}" x2="${f(m.x)}" y2="${f(m.y)}" stroke="${preset.glow ?? 'hsl(0 0% 82%)'}" stroke-width="0.9" stroke-dasharray="3 4" opacity="0.55" stroke-linecap="round"/>`;
    }

    s += celestial(28 + rnd(9) * 44, HZ - 14 - rnd(10) * 6, 8);
    s += clouds(4, HZ - 6);

    const perSide = Math.max(2, Math.round(buildingCount / 2));
    const wings: Array<{ F: P; scale: number; salt: number; style: ActiveStyle }> = [];
    // Assign styles up front so the hero + wings carry no duplicate landmarks.
    const styles = assignStyles(perSide * 2 + 1);
    let styleIdx = 0;
    for (let side = 0; side < 2; side++) {
      const VP = side === 0 ? VPL : VPR;
      for (let k = 1; k <= perSide; k++) {
        const t = 0.18 + (k - 1) * 0.17;
        wings.push({ F: lpt(Hc, VP, t), scale: 1 - t * 0.7, salt: side * 50 + k, style: styles[styleIdx++]! });
      }
    }
    const heroStyle = styles[styleIdx]!;
    wings.sort((a, b) => a.scale - b.scale);
    for (const w of wings) {
      const bh = (32 + rnd(w.salt * 3 + 4) * 18) * w.scale;
      const light = preset.buildingLightMin + rnd(w.salt * 13 + 7) * (preset.buildingLightMax - preset.buildingLightMin);
      s += drawBox(w.F, bh, (0.15 + rnd(w.salt * 9 + 5) * 0.08) * w.scale, (0.15 + rnd(w.salt * 11 + 6) * 0.08) * w.scale, light, w.style, w.scale);
    }
    s += drawBox(Hc, 50 + rnd(3) * 16, 0.2, 0.2, preset.buildingLightMin + rnd(9) * (preset.buildingLightMax - preset.buildingLightMin), heroStyle, 1);
    return s;

    // One two-point prism for the vertical span [baseY, topY], near vertical edge
    // at x = nearX. Footprint depth fractions may differ top vs. bottom, which
    // tapers the faces (used by the modern tower). The roof only shows when the
    // top sits below the horizon — above eye level you don't see a rooftop.
    function tierBox(nearX: number, baseY: number, topY: number, sLb: number, sRb: number, sLt: number, sRt: number, leftFill: string, rightFill: string, roofFill: string): string {
      const Fb = { x: nearX, y: baseY }, Ft = { x: nearX, y: topY };
      const Lb = lpt(Fb, VPL, sLb), Lt = lpt(Ft, VPL, sLt);
      const Rb = lpt(Fb, VPR, sRb), Rt = lpt(Ft, VPR, sRt);
      let r = '';
      if (topY > HZ) r = poly([Ft, Lt, cross(Lt, VPR, Rt, VPL), Rt], roofFill);
      return r + poly([Fb, Lb, Lt, Ft], leftFill) + poly([Fb, Rb, Rt, Ft], rightFill);
    }

    // Windows on both visible faces of a (possibly tapered) prism span.
    function facesWindows(nearX: number, baseY: number, topY: number, sLb: number, sRb: number, sLt: number, sRt: number, salt: number, mode: WindowMode): string {
      const Fb = { x: nearX, y: baseY }, Ft = { x: nearX, y: topY };
      return faceWindows(Fb, lpt(Fb, VPL, sLb), Ft, lpt(Ft, VPL, sLt), salt, mode) + faceWindows(Fb, lpt(Fb, VPR, sRb), Ft, lpt(Ft, VPR, sRt), salt + 1, mode);
    }

    // A thin vertical mast/needle on the near edge, with an optional red light.
    function mast(nearX: number, topY: number, hh: number, scale: number, fill: string, warn: boolean): string {
      return `<rect x="${f(nearX - 0.4 * scale)}" y="${f(topY - hh)}" width="${f(0.8 * scale)}" height="${f(hh)}" fill="${fill}"/>${warn ? redLight(nearX, topY - hh) : ''}`;
    }

    // Draw a building in two-point perspective with landmark-appropriate massing.
    function drawBox(F: P, bh: number, sL: number, sR: number, light: number, style: ActiveStyle, scale: number): string {
      const nearX = F.x, baseY = F.y, topY = F.y - bh;
      const leftF = darken(light, 13), rightF = hsl(buildingHue, preset.buildingSat, light);
      const roofF = hsl(buildingHue, Math.max(5, preset.buildingSat - 4), Math.min(94, light + 16));
      const salt = Math.round(nearX * 7 + bh);

      if (style === 'setback') {
        // Telescoping wedding-cake tiers + mooring mast.
        const segs = [{ s: 1, hf: 0.4 }, { s: 0.66, hf: 0.34 }, { s: 0.4, hf: 0.26 }];
        let y = baseY, o = '';
        segs.forEach((seg, k) => {
          const yTop = y - bh * seg.hf;
          o += tierBox(nearX, y, yTop, sL * seg.s, sR * seg.s, sL * seg.s, sR * seg.s, leftF, rightF, roofF);
          if (k < 2) o += facesWindows(nearX, y, yTop, sL * seg.s, sR * seg.s, sL * seg.s, sR * seg.s, salt + k, 'deco');
          y = yTop;
        });
        return o + mast(nearX, y, 9 * scale, scale, lighten(light, 8), true);
      }

      if (style === 'modern') {
        // Tapered glass tower: footprint shrinks toward the top.
        const gL = isDay ? 60 : 30;
        const body = `hsl(196 32% ${gL}%)`, side = `hsl(196 30% ${Math.max(8, gL - 14)}%)`, roof = `hsl(196 28% ${Math.min(92, gL + 10)}%)`;
        const sLt = sL * 0.5, sRt = sR * 0.5;
        let o = tierBox(nearX, baseY, topY, sL, sR, sLt, sRt, side, body, roof);
        o += facesWindows(nearX, baseY, topY, sL, sR, sLt, sRt, salt, 'glass');
        return o + (bh > 32 * scale ? mast(nearX, topY, 4 * scale, scale, `hsl(196 28% ${Math.min(94, gL + 18)}%)`, false) : '');
      }

      if (style === 'gothic') {
        // Black tower with gold windows and a stepped gold pinnacle crown.
        const dark = hsl(buildingHue, 16, isDay ? 22 : 11), darkL = hsl(buildingHue, 16, isDay ? 16 : 8);
        let o = tierBox(nearX, baseY, topY, sL, sR, sL, sR, darkL, dark, dark);
        o += facesWindows(nearX, baseY, topY, sL, sR, sL, sR, salt, 'gothic');
        let y = topY;
        for (const sf of [0.62, 0.4]) {
          const sh = bh * 0.07;
          o += tierBox(nearX, y, y - sh, sL * sf, sR * sf, sL * sf, sR * sf, GOLD_DIM, GOLD, GOLD);
          y -= sh;
        }
        return o + `<polygon points="${f(nearX - 1.6 * scale)},${f(y)} ${f(nearX + 1.6 * scale)},${f(y)} ${f(nearX)},${f(y - 6 * scale)}" fill="${GOLD}"/>`;
      }

      if (style === 'artdeco') {
        // Slim shaft beneath a terraced steel crown and needle spire.
        const shaftTop = baseY - bh * 0.64;
        let o = tierBox(nearX, baseY, shaftTop, sL, sR, sL, sR, leftF, rightF, roofF);
        o += facesWindows(nearX, baseY, shaftTop, sL, sR, sL, sR, salt, 'deco');
        const n = 4, seg = (shaftTop - topY) / n;
        let y = shaftTop;
        for (let k = 0; k < n; k++) {
          const sf = 1 - (k + 1) * 0.19;
          o += tierBox(nearX, y, y - seg, sL * sf, sR * sf, sL * sf, sR * sf, darken(light, 6), steel, steel);
          y -= seg;
        }
        return o + mast(nearX, topY, 12 * scale, scale, steel, true);
      }

      if (style === 'flatiron') {
        // Plain shaft with a projecting cornice band and a flagpole.
        let o = tierBox(nearX, baseY, topY, sL, sR, sL, sR, leftF, rightF, roofF);
        o += facesWindows(nearX, baseY, topY, sL, sR, sL, sR, salt, 'classical');
        const ch = bh * 0.05;
        o += tierBox(nearX, topY + ch, topY, sL * 1.14, sR * 1.14, sL * 1.14, sR * 1.14, lighten(light, 8), lighten(light, 12), lighten(light, 14));
        return o + `<rect x="${f(nearX - 0.3 * scale)}" y="${f(topY - 5 * scale)}" width="${f(0.6 * scale)}" height="${f(5 * scale)}" fill="${darken(light, 12)}"/>`;
      }

      // plain: ordinary box, occasional antenna on tall ones.
      let o = tierBox(nearX, baseY, topY, sL, sR, sL, sR, leftF, rightF, roofF);
      o += facesWindows(nearX, baseY, topY, sL, sR, sL, sR, salt, 'classical');
      return o + (bh > 36 * scale && preset.glow ? mast(nearX, topY, 6 * scale, scale, darken(light, 14), true) : '');
    }

    // Bilinear-mapped window grid across a perspective face, styled per window mode.
    function faceWindows(bf: P, bb: P, tf: P, tb: P, salt: number, mode: WindowMode): string {
      const at = (u: number, v: number): P => ({
        x: (1 - v) * ((1 - u) * bf.x + u * bb.x) + v * ((1 - u) * tf.x + u * tb.x),
        y: (1 - v) * ((1 - u) * bf.y + u * bb.y) + v * ((1 - u) * tf.y + u * tb.y),
      });
      const faceW = Math.hypot(bb.x - bf.x, bb.y - bf.y);
      const faceH = Math.hypot(tf.x - bf.x, tf.y - bf.y);
      const spec =
        mode === 'deco'
          ? { cols: Math.max(1, Math.min(3, Math.round(faceW / 5))), rows: Math.max(2, Math.min(10, Math.round(faceH / 3.6))), u0: 0.22, u1: 0.78, v0: 0.06, v1: 0.94, gold: false }
          : mode === 'gothic'
            ? { cols: Math.max(1, Math.min(3, Math.round(faceW / 5))), rows: Math.max(2, Math.min(9, Math.round(faceH / 4))), u0: 0.2, u1: 0.8, v0: 0.08, v1: 0.92, gold: true }
            : mode === 'glass'
              ? { cols: Math.max(2, Math.min(5, Math.round(faceW / 3.4))), rows: Math.max(2, Math.min(11, Math.round(faceH / 3.4))), u0: 0.1, u1: 0.9, v0: 0.06, v1: 0.94, gold: false }
              : { cols: Math.max(2, Math.min(4, Math.round(faceW / 4))), rows: Math.max(2, Math.min(9, Math.round(faceH / 4.2))), u0: 0.16, u1: 0.84, v0: 0.14, v1: 0.86, gold: false };

      const { cols, rows, u0, u1, v0, v1, gold } = spec;
      let out = '';
      // Deco fins between window columns.
      if (mode === 'deco' && cols > 1) {
        for (let c = 1; c < cols; c++) {
          const fu = lerp(u0, u1, c / cols);
          out += poly([at(fu - 0.01, 0.02), at(fu + 0.01, 0.02), at(fu + 0.01, 0.98), at(fu - 0.01, 0.98)], darken(preset.buildingLightMin, 4));
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = rnd(salt * 137 + r * 19 + c * 7 + 11) < preset.litProbability * (gold ? 0.7 : 1);
          const cu = lerp(u0, u1, (c + 0.5) / cols);
          const cv = lerp(v0, v1, (r + 0.5) / rows);
          const hw = ((u1 - u0) / cols) * (mode === 'glass' ? 0.42 : 0.36);
          const hv = ((v1 - v0) / rows) * (mode === 'deco' || mode === 'gothic' ? 0.42 : 0.36);
          const fill = lit ? (gold ? GOLD : litWindowColor(rnd(salt * 173 + r * 13 + c * 11 + 41))) : preset.windowDim;
          out += poly([at(cu - hw, cv - hv), at(cu + hw, cv - hv), at(cu + hw, cv + hv), at(cu - hw, cv + hv)], fill);
        }
      }
      return out;
    }
  }
};

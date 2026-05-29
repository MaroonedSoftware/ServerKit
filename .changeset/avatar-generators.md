---
'@maroonedsoftware/utilities': minor
---

Add deterministic, dependency-free SVG avatar generators. New `generateAvatar(seed, { style })` dispatcher plus individual `generateFaceAvatarSvg`, `generateIdenticonSvg`, `generateGeometricSvg`, `generateGradientSwirlSvg`, and `generateSmileyAvatarSvg` exports, and a `toDataUri` helper. Every color, palette, size, and geometry constant is an optional override; omitting options reproduces the default look.

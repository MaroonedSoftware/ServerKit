---
'@maroonedsoftware/utilities': minor
---

Add a `cityscape` avatar style: a deterministic, dependency-free city-skyline generator. Sky moods (`day`/`dusk`/`night`) with a sun or a phased moon, drifting clouds, night stars, and a soft "fuzzy" celestial glow (`celestialGlow`). Buildings render as famous-landmark silhouettes (`setback`, `artdeco`, `flatiron`, `modern`, `gothic`) plus a `plain` filler; in the default `mixed` mode each landmark appears at most once per skyline. Supports both a head-on `flat` layout and a two-point-`perspective` street corner, with per-window brightness/shade variation at night. Exposed via `generateCityscapeSvg` and the `cityscape` style on `generateAvatar`.

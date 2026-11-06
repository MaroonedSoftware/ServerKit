---
'@maroonedsoftware/johnny5': patch
---

Emit type declarations with `tsc --emitDeclarationOnly` instead of `tsup`, matching every other package. Declarations are no longer bundled, so `dist/` now holds one `.d.ts` per source file, while the `exports` paths are unchanged.

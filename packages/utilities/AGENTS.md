# AGENTS.md — @maroonedsoftware/utilities

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Dependency-free helpers used across ServerKit: format validators (UUID, email, E.164 phone), base32
codec, `JSON.parse`/`stringify` bigint bridges, small array/string functions, and a set of
deterministic SVG avatar generators. The optional `./extensions` subpath installs some of the same
helpers as `Array.prototype` / `String.prototype` methods.

Reach for it when you need one of the specific helpers below. Do **not** treat it as a lodash
substitute — it is a small, deliberately unopinionated set, and adding a general-purpose utility
here means shipping it to every package that depends on this one.

## Install

```bash
pnpm add @maroonedsoftware/utilities
```

Zero runtime dependencies, internal or external. Node's `node:crypto` and `Buffer` are the only
externals used (by the avatar generators and `toDataUri`), so the package is Node-only.

## Position in the graph

- **Depends on:** nothing internal, nothing external.
- **Depended on by:** `authentication`, `cache`, `koa`, `kysely`, `scim`.
- **Subpath exports:**
  - `.` — everything below. Pure functions, no side effects.
  - `./extensions` — **side-effect-only**. Importing it patches `Array.prototype` and
    `String.prototype`. It is a subpath rather than part of the root barrel precisely so that
    importing a validator does not silently mutate global prototypes.

## API surface

### Root — validators

| Export          | Kind     | Shape                        | Notes                                                                                                 |
| --------------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `isUuid`        | function | `(value: string) => boolean` | Versions 0–8, 8-4-4-4-12 hex. Accepts the nil UUID and RFC 4122 variants `8/9/a/b`. Case-insensitive. |
| `isEmail`       | function | `(email: string) => boolean` | Regex-based. Not an RFC 5322 parser.                                                                  |
| `isEmailDomain` | function | `(email: string) => boolean` | Requires a leading `@`: `@example.com` is true, `example.com` is false.                               |
| `isPhoneE164`   | function | `(phone: string) => boolean` | E.164 shape only — no country or carrier validation.                                                  |

### Root — encoding and JSON

| Export           | Kind     | Shape                                                  | Notes                                                                                         |
| ---------------- | -------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `base32Encode`   | function | `(arr: Uint8Array, padding: boolean = true) => string` | Padding on by default.                                                                        |
| `base32Decode`   | function | `(str: string) => Uint8Array`                          | Inverse of the above.                                                                         |
| `bigIntReplacer` | function | `(_: string, value: unknown) => unknown`               | Pass as the `JSON.stringify` replacer to survive `bigint` values.                             |
| `bigIntReviver`  | function | `(_: string, value: unknown) => unknown`               | Pass as the `JSON.parse` reviver. `@maroonedsoftware/koa` uses it in `defaultParserMappings`. |

### Root — collections and strings

| Export                          | Kind     | Shape                                                               | Notes                                                                   |
| ------------------------------- | -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `unique`                        | function | `<T>(array: T[], selector?: keyof T \| ((t: T) => unknown)) => T[]` | Without a selector, dedupes by identity.                                |
| `binarySearch`                  | function | `<T>(array: Array<T>, value: T) => boolean`                         | **Requires a sorted array.** Returns a boolean, not an index.           |
| `joinNonEmpty`                  | function | `(separator: string \| undefined, ...values: string[]) => string`   | Skips empty/whitespace values instead of emitting doubled separators.   |
| `nullToUndefined`               | function | `<T = object>(obj: object) => T`                                    | Converts `null` properties to `undefined`. Use at datastore boundaries. |
| `hasValue`                      | function | `(value: string \| null \| undefined) => boolean`                   | True when the trimmed string is non-empty. Null-safe.                   |
| `isNullOrUndefinedOrWhitespace` | function | `(value: string \| null \| undefined) => boolean`                   | Inverse of `hasValue`. Null-safe.                                       |

### Root — avatars

All generators are deterministic: the same `seed` always yields the same SVG string.

| Export                                                                                                                                     | Kind      | Shape                                                                           | Notes                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `generateAvatar`                                                                                                                           | function  | `(seed: string, spec: AvatarSpec = {}) => string`                               | Dispatches on `spec.style`; defaults to `'face'`.                                                                                    |
| `AvatarStyle`                                                                                                                              | type      | `'face' \| 'identicon' \| 'geometric' \| 'gradient' \| 'smiley' \| 'cityscape'` | —                                                                                                                                    |
| `AvatarSpec`                                                                                                                               | type      | Discriminated union of `{ style } & <Style>Options`                             | Style-specific options are checked against the style.                                                                                |
| `generateFaceAvatarSvg`                                                                                                                    | function  | `(seed: string, options?: FaceAvatarOptions) => string`                         | —                                                                                                                                    |
| `generateIdenticonSvg`                                                                                                                     | function  | `(seed: string, options?: IdenticonOptions) => string`                          | —                                                                                                                                    |
| `generateGeometricSvg`                                                                                                                     | function  | `(seed: string, options?: GeometricAvatarOptions) => string`                    | —                                                                                                                                    |
| `generateGradientSwirlSvg`                                                                                                                 | function  | `(seed: string, options?: GradientSwirlOptions) => string`                      | —                                                                                                                                    |
| `generateSmileyAvatarSvg`                                                                                                                  | function  | `(seed: string, options?: SmileyAvatarOptions) => string`                       | —                                                                                                                                    |
| `generateCityscapeSvg`                                                                                                                     | function  | `(seed: string, options?: CityscapeAvatarOptions) => string`                    | Richest option set: `CityscapeTimeOfDay`, `CityscapeView`, `CityscapeMoonPhase`, `CityscapeCelestialGlow`, `CityscapeBuildingStyle`. |
| `toDataUri`                                                                                                                                | function  | `(svg: string) => string`                                                       | `data:image/svg+xml;base64,…`. Uses `Buffer`.                                                                                        |
| `AvatarSizeOptions`, `AvatarPaletteOptions`                                                                                                | types     | Option mixins                                                                   | —                                                                                                                                    |
| `FaceAvatarOptions`, `IdenticonOptions`, `GeometricAvatarOptions`, `GradientSwirlOptions`, `SmileyAvatarOptions`, `CityscapeAvatarOptions` | types     | Per-style options                                                               | —                                                                                                                                    |
| `DEFAULT_LINE_COLOR`, `DEFAULT_MOUTH_COLOR`, `DEFAULT_TONGUE_COLOR`, `DEFAULT_TOPPER_COLORS`                                               | constants | Palette defaults                                                                | —                                                                                                                                    |

**Not exported:** the drawing helpers in `src/avatar/shared.ts` (`digest`, `hueFromHash`, `hsl`,
`gradientId`, `star`, `wrapSvg`, `derivePalette`, `AvatarPalette`) are internal to the folder even
though they carry an `export` keyword. Do not deep-import them.

### `./extensions` — prototype methods

Importing `@maroonedsoftware/utilities/extensions` runs for its side effects and returns nothing.

| Prototype          | Method                                                      | Notes                                                                                                                          |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Array.prototype`  | `binarySearch(value)`                                       | Sorted arrays only.                                                                                                            |
| `Array.prototype`  | `arrayEquals(other, comparer?)`                             | Same length + same element at each index. `===` unless a comparer is given. Named to avoid a future `Array.prototype.compare`. |
| `Array.prototype`  | `cast<U extends T>()`                                       | Unchecked type cast, no copy.                                                                                                  |
| `Array.prototype`  | `deleteProperties(...properties)`                           | Returns shallow copies; originals untouched.                                                                                   |
| `Array.prototype`  | `intersect(other, comparer?)`                               | —                                                                                                                              |
| `Array.prototype`  | `takeWhile(predicate)`                                      | —                                                                                                                              |
| `Array.prototype`  | `takeWhileAggregate(...)`                                   | Take-while with a running accumulator.                                                                                         |
| `Array.prototype`  | `uniqueBy(selector)`                                        | Overloaded: a key of `T`, or a projection function.                                                                            |
| `String.prototype` | `hasValue()`                                                | **Throws on `null`/`undefined`** — use the free function for nullables.                                                        |
| `String.prototype` | `isNullOrUndefinedOrWhitespace()`                           | Same caveat.                                                                                                                   |
| `String.prototype` | `mask(unmaskedStart = 2, unmaskedEnd = 2, character = '*')` | Negative windows clamp to 0.                                                                                                   |
| `String.prototype` | `maskEmail(trim = true, character = '*')`                   | Keeps two leading local chars, the `@`, and the TLD.                                                                           |
| `String.prototype` | `maskExceptLastFour(character = '*')`                       | —                                                                                                                              |

## Canonical usage

```typescript
import { isUuid, joinNonEmpty, bigIntReviver, generateAvatar, toDataUri } from '@maroonedsoftware/utilities';

if (!isUuid(id)) throw httpError(400).withDetails({ id: 'not a uuid' });

const label = joinNonEmpty(' ', firstName, middleName, lastName);

const parsed = JSON.parse(raw, bigIntReviver);

const avatarUri = toDataUri(generateAvatar(user.id, { style: 'identicon', size: 128 }));
```

Prototype extensions are opted into once, at the application entry point:

```typescript
// src/main.ts — before anything that uses the methods
import '@maroonedsoftware/utilities/extensions';
```

## Rules for generated code

- Import `./extensions` exactly once, from the application entry point, and never from library
  code. A library that imports it forces prototype patching on every consumer.
- `binarySearch` needs a sorted array. If you cannot prove the array is sorted at that call site,
  use `Array.prototype.includes`.
- Use the free functions `hasValue` / `isNullOrUndefinedOrWhitespace` for values that might be
  `null` or `undefined`. The prototype versions throw on a null receiver.
- Pair `bigIntReplacer` and `bigIntReviver`. Serialising with the replacer and parsing without the
  reviver gives you strings where you expected bigints, with no error.
- Avatars are seed-deterministic. Seed with a stable identifier (a user id), not with a display
  name or an email that can change.
- Treat `isEmail` and `isPhoneE164` as shape checks for fast rejection, not as proof of
  deliverability. Verification is `@maroonedsoftware/authentication`'s job.
- Do not add a general-purpose helper here just because it has no home. It ships to every dependent.

## Gotchas

- **`./extensions` is side-effect-only and order-sensitive.** It must be imported before any module
  that calls the methods. With `noUncheckedSideEffectImports` on, TypeScript will not let you
  import it "for types" — it is a real runtime import.
- **Extension installs are skipped, not overwritten, if the method already exists.** `installArrayMethod`
  and `installStringMethod` check `hasOwnProperty` and, on a collision, log a one-time
  `console.warn` and leave the existing implementation in place. So a polyfill or another library
  that got there first wins, and your code silently runs against different semantics. If behaviour
  looks wrong, check stderr for `already exists; skipping extension install`.
- **`cast<U>()` is unchecked.** It is a type-level assertion with no runtime validation, so a wrong
  cast surfaces far from the call site.
- **`nullToUndefined` is shallow-ish and untyped at runtime.** The `<T = object>` parameter is an
  assertion, not a validation; it does not verify that the result matches `T`.
- **This package is Node-only** despite having no dependencies. The avatar generators use
  `node:crypto`, and `toDataUri` uses `Buffer`.
- **`isUuid` accepts version nibbles 0–8**, which is wider than "a v4 UUID". If you need v4
  specifically, check the nibble yourself.

## Working inside this package

```
src/
  index.ts             Root barrel (validators, encoding, collections, avatars)
  extensions.ts        Subpath entry — imports the two .extensions files for side effects
  array.extensions.ts  declare global + installArrayMethod calls
  string.extensions.ts declare global + installStringMethod calls
  internal/install.ts  installArrayMethod / installStringMethod with collision warning
  checks/              uuid.ts, email.ts, phone.ts
  base32.ts  bigint.ts  unique.ts  binarysearch.ts  join.non.empty.ts
  null.to.undefined.ts  string.predicates.ts
  avatar/
    index.ts           Curated public surface of the folder
    shared.ts          Internal drawing helpers and palette defaults
    face.ts  identicon.ts  geometric.ts  gradient.ts  smiley.ts  cityscape.ts
    generate.avatar.ts data.uri.ts
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Zero dependencies.** Not a style preference — several downstream packages depend on this one
  being free.
- Nothing reachable from the root barrel may have a side effect. Prototype patching stays behind
  `./extensions`.
- `src/avatar/index.ts` is a hand-curated barrel, not `export *` over the folder. Adding a file
  there does not make it public; adding it to that barrel does.
- Avatar output must stay deterministic for a given seed and options. Changing a generator's
  drawing changes every existing user's avatar — that is a breaking change, not a tweak.
- A new subpath export needs an `exports` entry in `package.json` and a matching tsup entry in the
  `build` script.

User-visible changes need a changeset in `.changeset/`.

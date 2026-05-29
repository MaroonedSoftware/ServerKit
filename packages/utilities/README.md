# @maroonedsoftware/utilities

A collection of common utility functions.

## Installation

```bash
pnpm add @maroonedsoftware/utilities
```

## Usage

```typescript
import {
  isUuid,
  isEmail,
  isEmailDomain,
  isPhoneE164,
  base32Encode,
  base32Decode,
  unique,
  binarySearch,
  bigIntReplacer,
  bigIntReviver,
  nullToUndefined,
  joinNonEmpty,
  hasValue,
  isNullOrUndefinedOrWhitespace,
  generateAvatar,
  generateFaceAvatarSvg,
  generateIdenticonSvg,
  generateGeometricSvg,
  generateGradientSwirlSvg,
  generateSmileyAvatarSvg,
  toDataUri,
} from '@maroonedsoftware/utilities';

// Importing the main entry does NOT touch global prototypes. To install the
// Array/String prototype extensions (`.unique`, `.mask`, etc.), opt in once:
import '@maroonedsoftware/utilities/extensions';
```

## API Reference

### Validation Functions

#### `isUuid(value: string): boolean`

Validates whether a string is a valid UUID (Universally Unique Identifier). Supports UUID versions 0-5 in the standard 8-4-4-4-12 hexadecimal format.

```typescript
isUuid('550e8400-e29b-41d4-a716-446655440000'); // true
isUuid('not-a-uuid'); // false
```

#### `isEmail(email: string): boolean`

Validates whether a string is a valid email address using the HTML5 email validation specification pattern.

```typescript
isEmail('user@example.com'); // true
isEmail('invalid-email'); // false
```

#### `isEmailDomain(email: string): boolean`

Validates whether a string is a valid email domain pattern. The string must start with `@` followed by a valid domain.

```typescript
isEmailDomain('@example.com'); // true
isEmailDomain('example.com'); // false (missing @)
```

#### `isPhoneE164(phone: string): boolean`

Validates whether a string is a valid phone number in [E.164 format](https://en.wikipedia.org/wiki/E.164): a leading `+`, a non-zero country code digit, and 1–13 additional digits (15 digits total maximum).

```typescript
isPhoneE164('+12025550123'); // true
isPhoneE164('+447911123456'); // true
isPhoneE164('12025550123'); // false (missing +)
isPhoneE164('+1 202 555 0123'); // false (spaces not allowed)
```

### Base32 Encoding (RFC 4648)

#### `base32Encode(arr: Uint8Array, padding?: boolean): string`

Converts a `Uint8Array` to a base32 string following RFC 4648.

```typescript
const data = new TextEncoder().encode('Hello');
base32Encode(data); // "JBSWY3DP"
base32Encode(data, false); // "JBSWY3DP" (without padding)
```

**Parameters:**

- `arr` - The `Uint8Array` to encode.
- `padding` - Whether to include padding characters (`=`). Defaults to `true`.

#### `base32Decode(str: string): Uint8Array`

Converts a base32 string to a `Uint8Array` following RFC 4648.

```typescript
const decoded = base32Decode('JBSWY3DP');
new TextDecoder().decode(decoded); // "Hello"
```

**Features:**

- Automatically removes spaces (for readability tolerance)
- Case-insensitive
- Handles optional padding

### Array Utilities

#### `unique<T>(array: T[], selector?: keyof T | ((t: T) => unknown)): T[]`

Returns an array of unique items, deduplicated by the selector. When multiple items produce the same key, the first occurrence is kept.

```typescript
// By property key
unique(
  [
    { id: 1, n: 'a' },
    { id: 1, n: 'b' },
  ],
  'id',
);
// => [{ id: 1, n: 'a' }]

// By function
unique([{ tag: 'x' }, { tag: 'y' }, { tag: 'x' }], t => t.tag);
// => [{ tag: 'x' }, { tag: 'y' }]

// No selector (identity; primitives by value, objects by reference)
unique([1, 2, 1, 3]);
// => [1, 2, 3]
```

**Parameters:**

- `array` - The array to deduplicate.
- `selector` - Optional. A property key of `T` or a function `(t: T) => unknown`. When omitted, uses the item itself (identity).

### BigInt JSON Serialization

#### `bigIntReplacer(_: string, value: unknown): unknown`

A `JSON.stringify` replacer that serializes `bigint` values as strings with a trailing `n` (e.g. `123n` → `"123n"`), since JSON does not natively support `bigint`. Pair with `bigIntReviver` to round-trip values through JSON.

```typescript
JSON.stringify({ id: 9007199254740993n }, bigIntReplacer);
// '{"id":"9007199254740993n"}'
```

#### `bigIntReviver(_: string, value: unknown): unknown`

A `JSON.parse` reviver that deserializes strings matching `/^-?\d+n$/` back to native `bigint` (e.g. `"123n"` → `123n`). Pair with `bigIntReplacer` to round-trip values through JSON.

```typescript
JSON.parse('{"id":"9007199254740993n"}', bigIntReviver);
// { id: 9007199254740993n }
```

### Array Search

#### `binarySearch<T>(array: T[], value: T): boolean`

Performs a binary search on a **sorted** array and returns `true` if the value is found, `false` otherwise. Uses recursive halving with `<` / `>` comparison, so `T` must be a type that supports those operators (numbers, strings, etc.).

```typescript
binarySearch([1, 2, 3, 4, 5], 3); // true
binarySearch([1, 2, 3, 4, 5], 6); // false
binarySearch(['apple', 'banana', 'cherry'], 'banana'); // true
```

> The array must be sorted in ascending order. Passing an unsorted array produces undefined results.

### Object Utilities

#### `nullToUndefined<T>(obj: object): T`

Performs a shallow replacement of all `null` values in an object with `undefined`. Non-null values and nested objects are passed through unchanged.

```typescript
nullToUndefined({ a: null, b: 1, c: null });
// { a: undefined, b: 1, c: undefined }
```

#### `joinNonEmpty(separator: string | undefined, ...values: string[]): string`

Joins `values` with `separator`, dropping any entry that is an empty string, `undefined`, or `null` before joining. Passing `undefined` as the separator falls back to `Array.prototype.join`'s default (`','`).

```typescript
joinNonEmpty(', ', 'a', '', 'b'); // 'a, b'
joinNonEmpty(' ', 'first', undefined, 'last'); // 'first last'
joinNonEmpty('-', 'only'); // 'only'
```

### String Predicates

#### `hasValue(value: string | null | undefined): boolean`

Returns true when `value` has at least one non-whitespace character. Safe to call on `null` / `undefined` — prefer this over the `String.prototype.hasValue` method when the input might not be a string.

```typescript
hasValue(null); // false
hasValue(undefined); // false
hasValue('   '); // false
hasValue('hi'); // true
```

#### `isNullOrUndefinedOrWhitespace(value: string | null | undefined): boolean`

Inverse of `hasValue`. Returns true when `value` is `null`, `undefined`, empty, or whitespace-only.

```typescript
isNullOrUndefinedOrWhitespace(null); // true
isNullOrUndefinedOrWhitespace('   '); // true
isNullOrUndefinedOrWhitespace('hi'); // false
```

### Avatar Generation

Deterministic, dependency-free SVG avatars seeded off the SHA-256 of a string — the same seed always yields the same SVG. Every generator draws on a fixed `0 0 100 100` viewBox, so `size` only changes the rendered `width`/`height` (the image scales). Every hardcoded color, palette, dimension, and geometry constant is exposed as an optional override; omitting all options reproduces the default look.

Five styles are available, each with its own typed options:

- **`face`** — a raceless cartoon "blob" face (abstract head color, never a skin tone). Good for people.
- **`identicon`** — a horizontally-mirrored geometric glyph. Good for organizations.
- **`geometric`** — abstract translucent triangles/squares/circles over a tinted background.
- **`gradient`** — a seeded two-stop gradient with soft swirl overlays.
- **`smiley`** — a minimal smiley face (lighter weight than `face`).

#### `generateAvatar(seed: string, spec?: AvatarSpec): string`

Unified dispatcher. `spec.style` selects the style (default `'face'`); the remaining fields are that style's options. Returns a standalone `<svg>` string.

```typescript
generateAvatar('user-123'); // face (default)
generateAvatar('acme-inc', { style: 'identicon', grid: 7 }); // 7×7 identicon
generateAvatar('proj-42', { style: 'gradient', gradientType: 'radial', hue: 280 });
generateAvatar('team-7', { style: 'geometric', shapeCount: 6, palette: ['#1d4ed8', '#9333ea'] });
```

Each generator is also exported individually:

- `generateFaceAvatarSvg(seed, options?: FaceAvatarOptions)` — `lineColor`, `mouthColor`, `tongueColor`, `topperColors`, plus size/palette options.
- `generateIdenticonSvg(seed, options?: IdenticonOptions)` — `margin`, `cell`, `grid`, `hue`, foreground/background saturation & lightness.
- `generateGeometricSvg(seed, options?: GeometricAvatarOptions)` — `hue`, `hueSpread`, `saturation`, `lightness`, `backgroundLightness`, `shapeCount`, `palette`.
- `generateGradientSwirlSvg(seed, options?: GradientSwirlOptions)` — `hue`, `hueSpread`, `saturation`, `lightness`, `gradientType`.
- `generateSmileyAvatarSvg(seed, options?: SmileyAvatarOptions)` — `lineColor`, plus size/palette options.

All styles share `AvatarSizeOptions` (`size`, `cornerRadius`); the face-based styles also accept `AvatarPaletteOptions` (`hue`, plus saturation/lightness/accent knobs). The defaults `DEFAULT_LINE_COLOR`, `DEFAULT_MOUTH_COLOR`, `DEFAULT_TONGUE_COLOR`, and `DEFAULT_TOPPER_COLORS` are exported so you can extend rather than replace them.

#### `toDataUri(svg: string): string`

Encodes an SVG string as a `data:image/svg+xml;base64,…` URI, suitable for inlining directly into an `src`/`href` attribute.

```typescript
const uri = toDataUri(generateAvatar('user-123'));
// <img src={uri} />
```

## Prototype Extensions

The package ships an opt-in side-effect module that augments the global `Array` and `String` prototypes with the methods documented below. The main entry (`@maroonedsoftware/utilities`) does **not** touch global prototypes — you have to import the extensions module explicitly:

```typescript
import '@maroonedsoftware/utilities/extensions';
```

Methods are installed with `Object.defineProperty` as non-enumerable, writable, configurable descriptors, so they will not show up in `for…in` loops or `Object.keys`. Each install is guarded with `Object.prototype.hasOwnProperty.call(prototype, name)`, so the module is safe to import multiple times and will not overwrite a method that already exists on the prototype. When a name is already taken (e.g. by a future Node release or another library), the install is skipped and a single `console.warn` per colliding name is emitted so the divergence is discoverable.

The two most generically-named methods are intentionally namespaced — `arrayEquals` (not `equals` or `compare`) and `uniqueBy` (not `unique`) — to reduce the chance of a future TC39 `Array.prototype` addition silently shadowing them.

Free-function alternatives for the string predicates are exported from the main entry — use them when you need to operate on `string | null | undefined` without throwing:

```typescript
import { hasValue, isNullOrUndefinedOrWhitespace } from '@maroonedsoftware/utilities';

hasValue(maybeUndefined); // safe on null/undefined
```

### Array extensions

#### `Array<T>.binarySearch(value: T): boolean`

Binary search over a **sorted** array. Returns `true` when `value` is found. Uses `<` / `>` comparison, so `T` must be a type those operators are defined on (numbers, strings, etc.). Passing an unsorted array produces undefined results.

```typescript
[1, 3, 5, 7, 9].binarySearch(5); // true
[1, 3, 5, 7, 9].binarySearch(4); // false
```

#### `Array<T>.cast<U extends T>(): U[]`

Unchecked narrowing cast — returns the same array reference retyped to `U[]`. No copy, no runtime check. Use only when you know the invariant holds (e.g. after a `filter` that TypeScript can't express).

```typescript
const mixed: Array<number | string> = [1, 2, 3];
const nums = mixed.cast<number>(); // typed as number[], same reference
```

#### `Array<T>.arrayEquals(other: T[], comparer?: (a: T, b: T) => boolean): boolean`

Returns true when both arrays have the same length and every index matches. Named to avoid colliding with a future `Array.prototype.compare`, which would conventionally return a sort-style `number`, not a boolean.

- **Without** a comparer: elements are compared with strict equality (`===`). Shallow — nested objects are compared by reference.
- **With** a comparer: defers element equality to the supplied function. Length is still checked first and short-circuits before the comparer runs.

```typescript
[1, 2, 3].arrayEquals([1, 2, 3]); // true
[1, 2, 3].arrayEquals([1, 2]); // false
[{ a: 1 }].arrayEquals([{ a: 1 }]); // false (different references)

[{ id: 1 }, { id: 2 }].arrayEquals([{ id: 1 }, { id: 2 }], (x, y) => x.id === y.id);
// => true
```

#### `Array<T>.deleteProperties<K extends keyof T>(...properties: K[]): Array<Omit<T, K>>`

Returns a new array of shallow copies of the elements with the named properties removed. The original array and its elements are left untouched.

```typescript
const rows = [
  { id: 1, secret: 'a' },
  { id: 2, secret: 'b' },
];
const safe = rows.deleteProperties('secret');
// safe => [{ id: 1 }, { id: 2 }]  (new array of new objects)
// rows still has the secret fields
```

#### `Array<T>.intersect(other: T[], comparer?: (a: T, b: T) => boolean): T[]`

Returns the intersection with `other`, preserving the order and duplicates of the receiver (`this`).

- **Without** a comparer: keeps every element of `this` whose value is also in `other`, using `Set` membership of `other` (reference equality for objects, value equality for primitives). Duplicates in `this` are preserved.
- **With** a comparer: runs a quadratic `find` per element and pushes the matching value from `other` (not from `this`). Falsy matches (`0`, `''`, `false`, `null`) are preserved.

```typescript
[1, 2, 3].intersect([2, 3, 4]);
// => [2, 3]

[1, 1, 2, 3].intersect([1, 3]);
// => [1, 1, 3]   (duplicates from `this` kept)

[{ id: 1 }, { id: 2 }].intersect([{ id: 2 }, { id: 3 }], (a, b) => a.id === b.id);
// => [{ id: 2 }]   (the object from `other`)
```

#### `Array<T>.takeWhile(predicate: (value: T, index: number, array: T[]) => boolean): T[]`

Returns the leading prefix of elements for which `predicate` returns true, stopping at (and excluding) the first element that returns false. Unlike `filter`, it does not continue past a failure.

```typescript
[2, 4, 6, 7, 8, 10].takeWhile(n => n % 2 === 0);
// => [2, 4, 6]
```

#### `Array<T>.takeWhileAggregate<TAccumulate, TDest>(seed: TAccumulate, step: (accumulator: TAccumulate, element: T) => { newAccumulator: TAccumulate; output: TDest; proceed: boolean }): TDest[]`

A blend of `map` and `reduce` with an early-exit. Walks the array, threading `accumulator` through `step` and collecting each `output`. Stops as soon as `step` returns `proceed: false` — the element that triggered the stop **is** included in the result.

```typescript
// Running totals while the total stays below 10:
[1, 2, 3, 4, 5, 6].takeWhileAggregate(0, (acc, n) => {
  const next = acc + n;
  return { newAccumulator: next, output: next, proceed: next < 10 };
});
// => [1, 3, 6, 10]
```

#### `Array<T>.uniqueBy(selector: keyof T | ((t: T) => unknown)): T[]`

Returns a new array with duplicates removed, deduplicated by `selector`. When multiple items produce the same key, the **first** occurrence wins. The selector function can return any value — including computed or composed keys, not just a property of the element.

Keys are compared with `Map` equality (`===`): primitives by value, objects by reference. Returning a freshly-allocated object per element therefore treats every element as unique and yields no deduplication — pre-stringify or pre-compose a primitive key in that case.

```typescript
[
  { id: 1, n: 'a' },
  { id: 2, n: 'b' },
  { id: 1, n: 'c' },
].uniqueBy('id');
// => [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]

[{ tag: 'x' }, { tag: 'y' }, { tag: 'x' }].uniqueBy(t => t.tag);
// => [{ tag: 'x' }, { tag: 'y' }]

[{ email: 'A@x.com' }, { email: 'a@x.com' }].uniqueBy(t => t.email.toLowerCase());
// => [{ email: 'A@x.com' }]   (computed key)
```

### String extensions

#### `String.hasValue(): boolean`

Inverse of `isNullOrUndefinedOrWhitespace` — returns true when the trimmed string has at least one non-whitespace character.

```typescript
''.hasValue(); // false
'  '.hasValue(); // false
'  hi '.hasValue(); // true
```

#### `String.isNullOrUndefinedOrWhitespace(): boolean`

Returns true when the string is empty or contains only whitespace. Named for parity with .NET's `String.IsNullOrWhiteSpace`.

```typescript
''.isNullOrUndefinedOrWhitespace(); // true
'   '.isNullOrUndefinedOrWhitespace(); // true
'\t\n'.isNullOrUndefinedOrWhitespace(); // true
'hi'.isNullOrUndefinedOrWhitespace(); // false
```

#### `String.mask(unmaskedStart?: number, unmaskedEnd?: number, character?: string): string`

Returns a copy with the middle replaced by `character`, keeping `unmaskedStart` leading and `unmaskedEnd` trailing characters visible. Defaults to `2, 2, '*'`. Negative window sizes are clamped to `0`. When the windows already cover the whole length, the original string is returned unchanged.

```typescript
'password123'.mask(); // 'pa*******23'
'1234567890'.mask(4, 2); // '1234****90'
'abcdef'.mask(1, 1, '#'); // 'a####f'
'abcd'.mask(); // 'abcd'  (windows cover the whole string)
```

#### `String.maskEmail(trim?: boolean, character?: string): string`

Masks an email address while preserving enough structure to remain recognisable: keeps the first two characters of the local part, the `@`, the first two characters of the domain, the last character of the domain before the dot, and the TLD. When `trim` is true (the default), collapses runs of two or more mask characters down to a single one.

```typescript
'user@example.com'.maskEmail(); // 'us*@ex*e.com'
'user@example.com'.maskEmail(false); // 'us**@ex****e.com'
'user@example.com'.maskEmail(true, '#'); // 'us#@ex#e.com'
```

#### `String.maskExceptLastFour(character?: string): string`

Convenience alias for `mask(0, 4, character)` — masks everything except the trailing four characters. Useful for card numbers, account IDs, and similar identifiers.

```typescript
'4111111111111234'.maskExceptLastFour(); // '************1234'
'4111111111111234'.maskExceptLastFour('#'); // '############1234'
'1234'.maskExceptLastFour(); // '1234'  (already ≤ 4 chars)
```

## License

MIT

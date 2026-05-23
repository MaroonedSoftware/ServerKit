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
isPhoneE164('12025550123');  // false (missing +)
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
unique([{ id: 1, n: 'a' }, { id: 1, n: 'b' }], 'id');
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
joinNonEmpty(', ', 'a', '', 'b');               // 'a, b'
joinNonEmpty(' ', 'first', undefined, 'last');  // 'first last'
joinNonEmpty('-', 'only');                      // 'only'
```

### String Predicates

#### `hasValue(value: string | null | undefined): boolean`

Returns true when `value` has at least one non-whitespace character. Safe to call on `null` / `undefined` — prefer this over the `String.prototype.hasValue` method when the input might not be a string.

```typescript
hasValue(null);       // false
hasValue(undefined);  // false
hasValue('   ');      // false
hasValue('hi');       // true
```

#### `isNullOrUndefinedOrWhitespace(value: string | null | undefined): boolean`

Inverse of `hasValue`. Returns true when `value` is `null`, `undefined`, empty, or whitespace-only.

```typescript
isNullOrUndefinedOrWhitespace(null);   // true
isNullOrUndefinedOrWhitespace('   ');  // true
isNullOrUndefinedOrWhitespace('hi');   // false
```

## Prototype Extensions

The package ships an opt-in side-effect module that augments the global `Array` and `String` prototypes with the methods documented below. The main entry (`@maroonedsoftware/utilities`) does **not** touch global prototypes — you have to import the extensions module explicitly:

```typescript
import '@maroonedsoftware/utilities/extensions';
```

Methods are installed with `Object.defineProperty` as non-enumerable, writable, configurable descriptors, so they will not show up in `for…in` loops or `Object.keys`. Each install is guarded with `Object.prototype.hasOwnProperty.call(prototype, name)`, so the module is safe to import multiple times and will not overwrite a method that already exists on the prototype.

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

#### `Array<T>.compare(other: T[], comparer?: (a: T, b: T) => boolean): boolean`

Returns true when both arrays have the same length and every index matches.

- **Without** a comparer: elements are compared with strict equality (`===`). Shallow — nested objects are compared by reference.
- **With** a comparer: defers element equality to the supplied function. Length is still checked first and short-circuits before the comparer runs.

```typescript
[1, 2, 3].compare([1, 2, 3]);   // true
[1, 2, 3].compare([1, 2]);      // false
[{ a: 1 }].compare([{ a: 1 }]); // false (different references)

[{ id: 1 }, { id: 2 }].compare([{ id: 1 }, { id: 2 }], (x, y) => x.id === y.id);
// => true
```

#### `Array<T>.deleteProperties<K extends keyof T>(...properties: K[]): Array<Omit<T, K>>`

Returns a new array of shallow copies of the elements with the named properties removed. The original array and its elements are left untouched.

```typescript
const rows = [{ id: 1, secret: 'a' }, { id: 2, secret: 'b' }];
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

#### `Array<T>.unique<K extends keyof T>(selector: K | ((t: T) => T[K])): T[]`

Returns a new array with duplicates removed, deduplicated by `selector`. When multiple items produce the same key, the **first** occurrence wins.

```typescript
[{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'c' }].unique('id');
// => [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]

[{ tag: 'x' }, { tag: 'y' }, { tag: 'x' }].unique(t => t.tag);
// => [{ tag: 'x' }, { tag: 'y' }]
```

### String extensions

#### `String.hasValue(): boolean`

Inverse of `isNullOrUndefinedOrWhitespace` — returns true when the trimmed string has at least one non-whitespace character.

```typescript
''.hasValue();      // false
'  '.hasValue();    // false
'  hi '.hasValue(); // true
```

#### `String.isNullOrUndefinedOrWhitespace(): boolean`

Returns true when the string is empty or contains only whitespace. Named for parity with .NET's `String.IsNullOrWhiteSpace`.

```typescript
''.isNullOrUndefinedOrWhitespace();      // true
'   '.isNullOrUndefinedOrWhitespace();   // true
'\t\n'.isNullOrUndefinedOrWhitespace();  // true
'hi'.isNullOrUndefinedOrWhitespace();    // false
```

#### `String.mask(unmaskedStart?: number, unmaskedEnd?: number, character?: string): string`

Returns a copy with the middle replaced by `character`, keeping `unmaskedStart` leading and `unmaskedEnd` trailing characters visible. Defaults to `2, 2, '*'`. Negative window sizes are clamped to `0`. When the windows already cover the whole length, the original string is returned unchanged.

```typescript
'password123'.mask();           // 'pa*******23'
'1234567890'.mask(4, 2);        // '1234****90'
'abcdef'.mask(1, 1, '#');       // 'a####f'
'abcd'.mask();                  // 'abcd'  (windows cover the whole string)
```

#### `String.maskEmail(trim?: boolean, character?: string): string`

Masks an email address while preserving enough structure to remain recognisable: keeps the first two characters of the local part, the `@`, the first two characters of the domain, the last character of the domain before the dot, and the TLD. When `trim` is true (the default), collapses runs of two or more mask characters down to a single one.

```typescript
'user@example.com'.maskEmail();          // 'us*@ex*e.com'
'user@example.com'.maskEmail(false);     // 'us**@ex****e.com'
'user@example.com'.maskEmail(true, '#'); // 'us#@ex#e.com'
```

#### `String.maskExceptLastFour(character?: string): string`

Convenience alias for `mask(0, 4, character)` — masks everything except the trailing four characters. Useful for card numbers, account IDs, and similar identifiers.

```typescript
'4111111111111234'.maskExceptLastFour();    // '************1234'
'4111111111111234'.maskExceptLastFour('#'); // '############1234'
'1234'.maskExceptLastFour();                // '1234'  (already ≤ 4 chars)
```

## License

MIT

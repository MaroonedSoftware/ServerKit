# @maroonedsoftware/utilities

A collection of common utility functions.

## Installation

```bash
pnpm add @maroonedsoftware/utilities
```

## Usage

```typescript
import { isUuid, isEmail, isEmailDomain, isPhoneE164, base32Encode, base32Decode, unique, binarySearch, bigIntReplacer, bigIntReviver, nullToUndefined } from '@maroonedsoftware/utilities';
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

## License

MIT

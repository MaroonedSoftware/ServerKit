# @maroonedsoftware/utilities

A collection of common utility functions.

## Installation

```bash
pnpm add @maroonedsoftware/utilities
```

## Usage

```typescript
import { isUuid, isEmail, isEmailDomain, base32Encode, base32Decode } from '@maroonedsoftware/utilities';
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

## License

MIT

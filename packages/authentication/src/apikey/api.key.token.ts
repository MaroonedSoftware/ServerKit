import { createHash } from 'node:crypto';

/**
 * Alphabet for the random body and the checksum. Base62 keeps a token to a
 * single double-click-selectable word: no `_` (which separates the segments),
 * no `-` or `+` (which break URL and shell handling), no padding.
 */
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Width of the trailing CRC32 checksum, in base62 characters. */
export const API_KEY_CHECKSUM_LENGTH = 6;

/** Characters of the token shown in a UI and stored as {@link import('./types.js').ApiKey.hint}. */
export const API_KEY_HINT_LENGTH = 8;

/** Segment separator. Absent from {@link BASE62_ALPHABET}, so splitting is unambiguous. */
const SEPARATOR = '_';

/** Lazily built CRC32 lookup table (polynomial 0xEDB88320, the zlib/PNG one). */
let crcTable: Uint32Array | undefined;

const getCrcTable = (): Uint32Array => {
  if (crcTable) return crcTable;

  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTable = table;
  return table;
};

/**
 * CRC32 of a string's UTF-8 bytes (polynomial `0xEDB88320`).
 *
 * Implemented here rather than taken from `node:zlib`: `zlib.crc32` landed in
 * Node 22.2, and this package's `engines` says `>=22`. A checksum is not a
 * reason to raise the floor.
 *
 * CRC32 is an error-detecting code, not a MAC. It is here to catch a truncated
 * or mistyped token before it costs a database round trip, and to let secret
 * scanners recognise a leaked key — never to prove authenticity.
 *
 * @param input - The string to checksum.
 * @returns The CRC32 as an unsigned 32-bit integer.
 */
export const crc32 = (input: string): number => {
  const table = getCrcTable();
  const bytes = Buffer.from(input, 'utf8');

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Number of base62 characters needed to represent `byteLength` bytes.
 *
 * `bits / log2(62)`, rounded up — 43 characters for the 32-byte body.
 */
const base62Width = (byteLength: number): number => Math.ceil((byteLength * 8) / Math.log2(62));

/**
 * Encode bytes as base62, treating the buffer as one big-endian integer and
 * left-padding to a fixed width.
 *
 * The padding is the point. Encoding by magnitude alone makes the output length
 * a function of the *value*, so a body that happened to start with zero bytes
 * would come out visibly shorter and leak information about the secret. Every
 * body of a given byte length therefore encodes to the same number of
 * characters, and tokens are uniform.
 *
 * @param bytes - The bytes to encode.
 * @returns The base62 representation, left-padded with `'0'`.
 */
export const encodeBase62 = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '';

  const digits: number[] = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const value = digits[i]! * 256 + carry;
      digits[i] = value % 62;
      carry = Math.floor(value / 62);
    }
    while (carry > 0) {
      digits.push(carry % 62);
      carry = Math.floor(carry / 62);
    }
  }

  let out = '';
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE62_ALPHABET[digits[i]!];
  }

  // `Math.max` guards the width formula: pad, never truncate.
  return out.padStart(Math.max(base62Width(bytes.length), out.length), '0');
};

/** Encode a non-negative integer as exactly `width` base62 characters, zero-padded. */
const encodeBase62Fixed = (value: number, width: number): string => {
  let out = '';
  let remaining = value;

  for (let i = 0; i < width; i++) {
    out = `${BASE62_ALPHABET[remaining % 62]}${out}`;
    remaining = Math.floor(remaining / 62);
  }

  return out;
};

/** Whether every character of `value` is in the base62 alphabet. `''` is not. */
const isBase62 = (value: string): boolean => value.length > 0 && /^[0-9A-Za-z]+$/.test(value);

/** The parts of an API key token, as accepted by {@link formatApiKeyToken}. */
export interface ApiKeyTokenParts {
  /** Vendor prefix, e.g. `'sk'`. Base62 only. */
  prefix: string;
  /** Optional class segment, e.g. `'live'`. Base62 only. */
  type?: string;
  /** The random body, already base62-encoded. */
  body: string;
}

/**
 * Assemble a token as `{prefix}_{type}_{body}{checksum}`, or
 * `{prefix}_{body}{checksum}` when no `type` is given.
 *
 * The checksum covers everything before it, so a token that has been truncated,
 * had a character transposed, or lost its type segment fails
 * {@link parseApiKeyToken} without a storage lookup.
 *
 * @param parts - Prefix, optional type, and the encoded body.
 * @returns The complete token string.
 * @throws {@link RangeError} when `prefix` or `type` is not base62 — a
 *   misconfiguration, since both come from the application, never a request.
 */
export const formatApiKeyToken = ({ prefix, type, body }: ApiKeyTokenParts): string => {
  if (!isBase62(prefix)) {
    throw new RangeError(`API key prefix must be base62 (0-9A-Za-z), received: ${JSON.stringify(prefix)}`);
  }
  if (type !== undefined && !isBase62(type)) {
    throw new RangeError(`API key type must be base62 (0-9A-Za-z), received: ${JSON.stringify(type)}`);
  }

  const withoutChecksum = type === undefined ? `${prefix}${SEPARATOR}${body}` : `${prefix}${SEPARATOR}${type}${SEPARATOR}${body}`;

  return `${withoutChecksum}${encodeBase62Fixed(crc32(withoutChecksum), API_KEY_CHECKSUM_LENGTH)}`;
};

/** A token that parsed cleanly and whose checksum matched. */
export interface ParsedApiKeyToken {
  /** The class segment, when the token carried one. */
  type?: string;
  /** The random body, still base62-encoded. */
  body: string;
}

/**
 * Parse and checksum-verify a token.
 *
 * Structural only: a token that parses is well-formed, not valid. Whether it
 * names a live key is
 * {@link import('./api.key.service.js').ApiKeyService.validate}'s question.
 *
 * @param token  - The presented credential.
 * @param prefix - The expected vendor prefix. A token carrying any other prefix
 *   is rejected, which is what lets the handler decline another service's
 *   bearer token without touching storage.
 * @returns The parsed parts, or `undefined` when the prefix, shape, alphabet, or
 *   checksum does not hold.
 */
export const parseApiKeyToken = (token: string, prefix: string): ParsedApiKeyToken | undefined => {
  if (!token.startsWith(`${prefix}${SEPARATOR}`)) return undefined;

  const segments = token.split(SEPARATOR);
  // `{prefix}_{body+checksum}` or `{prefix}_{type}_{body+checksum}`.
  if (segments.length !== 2 && segments.length !== 3) return undefined;

  const tail = segments[segments.length - 1]!;
  const type = segments.length === 3 ? segments[1]! : undefined;

  if (type !== undefined && !isBase62(type)) return undefined;
  if (!isBase62(tail)) return undefined;
  if (tail.length <= API_KEY_CHECKSUM_LENGTH) return undefined;

  const body = tail.slice(0, -API_KEY_CHECKSUM_LENGTH);
  const checksum = tail.slice(-API_KEY_CHECKSUM_LENGTH);
  const withoutChecksum = token.slice(0, -API_KEY_CHECKSUM_LENGTH);

  if (checksum !== encodeBase62Fixed(crc32(withoutChecksum), API_KEY_CHECKSUM_LENGTH)) return undefined;

  return type === undefined ? { body } : { type, body };
};

/**
 * Hash a token for storage and lookup: SHA-256 of the whole token string, hex.
 *
 * Not a password hash, deliberately. Argon2id exists to slow guessing of
 * low-entropy secrets; an API key body is 32 random bytes, which cannot be
 * guessed, and running a memory-hard KDF on every API request is a
 * denial-of-service vector. A single SHA-256 also makes the stored value a
 * lookup key, so validation is one indexed read rather than a scan-and-verify
 * over every active hash.
 *
 * @param token - The complete token, checksum included.
 * @returns Lowercase hex SHA-256 digest.
 */
export const hashApiKeyToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * The leading characters of a token, for display in a key list.
 *
 * Shows the prefix and type but far too little of the body to be brute-forced
 * back into a credential — the same thing GitHub and Stripe show.
 *
 * @param token - The complete token.
 * @returns At most {@link API_KEY_HINT_LENGTH} leading characters.
 */
export const apiKeyHint = (token: string): string => token.slice(0, API_KEY_HINT_LENGTH);

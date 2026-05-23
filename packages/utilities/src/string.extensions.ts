import { hasValue, isNullOrUndefinedOrWhitespace } from './string.predicates.js';

declare global {
  interface String {
    /**
     * Inverse of {@link String.isNullOrUndefinedOrWhitespace} — returns true when the
     * trimmed string has at least one non-whitespace character.
     */
    hasValue(): boolean;

    /**
     * Returns true if the string contains only whitespace (or is empty). Provided for parity with
     * `String.IsNullOrWhiteSpace` in .NET. Calling on `null`/`undefined` throws — use the free
     * function `isNullOrUndefinedOrWhitespace` for nullable values.
     */
    isNullOrUndefinedOrWhitespace(): boolean;

    /**
     * Returns a copy of the string with the middle replaced by a repeated mask character,
     * keeping `unmaskedStart` leading and `unmaskedEnd` trailing characters visible. Returns the
     * string unchanged when the unmasked windows already cover the whole length.
     * @param unmaskedStart Number of leading characters to leave visible. Negative values are clamped to 0. Default 2.
     * @param unmaskedEnd Number of trailing characters to leave visible. Negative values are clamped to 0. Default 2.
     * @param character Mask character. Default `'*'`.
     */
    mask(unmaskedStart?: number, unmaskedEnd?: number, character?: string): string;

    /**
     * Masks an email address while preserving readable structure: keeps the first two characters
     * of the local part, the `@`, and the TLD; everything else is replaced with `character`.
     * @param trim When true, collapses runs of two or more mask characters down to one. Default true.
     * @param character Mask character. Default `'*'`.
     */
    maskEmail(trim?: boolean, character?: string): string;

    /**
     * Masks all but the last four characters. Equivalent to `mask(0, 4, character)`.
     * @param character Mask character. Default `'*'`.
     */
    maskExceptLastFour(character?: string): string;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const define = (name: PropertyKey, value: (...args: any[]) => unknown): void => {
  if (Object.prototype.hasOwnProperty.call(String.prototype, name)) return;
  Object.defineProperty(String.prototype, name, { value, enumerable: false, writable: true, configurable: true });
};

define('hasValue', function (this: string): boolean {
  return hasValue(this);
});

define('isNullOrUndefinedOrWhitespace', function (this: string): boolean {
  return isNullOrUndefinedOrWhitespace(this);
});

define('mask', function (this: string, unmaskedStart: number = 2, unmaskedEnd: number = 2, character: string = '*'): string {
  const start = Math.max(unmaskedStart, 0);
  const end = Math.max(unmaskedEnd, 0);
  const minLength = this.length - start - end;
  const repeat = Math.max(minLength, 0);

  return minLength > 0 ? this.slice(0, start) + character.repeat(repeat) + this.slice(this.length - end) : this.toString();
});

define('maskEmail', function (this: string, trim: boolean = true, character: string = '*'): string {
  const at = this.indexOf('@');
  let dot = this.lastIndexOf('.');
  const idx = at >= 0 ? this.length - at : 0;
  dot = dot >= 0 ? this.length - dot + 1 : 0;
  let masked = this.mask(2, idx, character);
  if (dot > 0) masked = masked.mask(at + 3, dot, character);

  if (trim) {
    return masked.replaceAll(new RegExp(`(\\${character}){2,}`, 'g'), character);
  }
  return masked;
});

define('maskExceptLastFour', function (this: string, character: string = '*'): string {
  return this.mask(0, 4, character);
});

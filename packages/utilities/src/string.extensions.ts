declare global {
  interface String {
    /**
     * Inverse of {@link String.isNullOrUndefinedOrWhitespace} — returns true when the
     * trimmed string has at least one non-whitespace character.
     */
    hasValue(): boolean;

    /**
     * Returns true if the string is `undefined`, `null`, or contains only whitespace.
     * Provided for parity with `String.IsNullOrWhiteSpace` in .NET.
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

if (!String.prototype.hasValue) {
  String.prototype.hasValue = function (this: string): boolean {
    return this !== undefined && this !== null && this.trim().length > 0;
  };
}

if (!String.prototype.isNullOrUndefinedOrWhitespace) {
  String.prototype.isNullOrUndefinedOrWhitespace = function (this: string): boolean {
    return this === undefined || this === null || this.trim().length === 0;
  };
}

if (!String.prototype.mask) {
  String.prototype.mask = function (this: string, unmaskedStart: number = 2, unmaskedEnd: number = 2, character: string = '*') {
    unmaskedStart = Math.max(unmaskedStart, 0);
    unmaskedEnd = Math.max(unmaskedEnd, 0);
    const minLength = this.length - unmaskedStart - unmaskedEnd;
    const repeat = Math.max(minLength, 0);

    return minLength > 0 ? this.slice(0, unmaskedStart) + character.repeat(repeat) + this.slice(this.length - unmaskedEnd) : this;
  };
}

if (!String.prototype.maskEmail) {
  String.prototype.maskEmail = function (this: string, trim: boolean = true, character: string = '*') {
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
  };
}

if (!String.prototype.maskExceptLastFour) {
  String.prototype.maskExceptLastFour = function (this: string, character: string = '*') {
    return this.mask(0, 4, character);
  };
}

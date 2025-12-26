/**
 * Regular expression pattern for validating complete email addresses.
 * Follows HTML5 email validation specification.
 */
const EmailRegex =
  /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Regular expression pattern for validating email domain patterns (starting with @).
 */
const EmailDomainRegex = /^@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validates whether a string is a valid email address.
 * Uses the HTML5 email validation specification pattern.
 *
 * @param email - The string to validate as an email address.
 * @returns `true` if the string is a valid email address, `false` otherwise.
 *
 * @example
 * ```typescript
 * isEmail("user@example.com"); // true
 * isEmail("invalid-email"); // false
 * ```
 */
export const isEmail = (email: string): boolean => {
  return EmailRegex.test(email);
};

/**
 * Validates whether a string is a valid email domain pattern.
 * The string must start with `@` followed by a valid domain.
 *
 * @param email - The string to validate as an email domain pattern.
 * @returns `true` if the string is a valid email domain pattern, `false` otherwise.
 *
 * @example
 * ```typescript
 * isEmailDomain("@example.com"); // true
 * isEmailDomain("example.com"); // false (missing @)
 * ```
 */
export const isEmailDomain = (email: string): boolean => {
  return EmailDomainRegex.test(email);
};

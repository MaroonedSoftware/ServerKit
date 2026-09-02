/** Allowed origin(s): `'*'`, a single origin string, or a list of strings and RegExps to match. */
export type CorsOrigin = string | (string | RegExp)[];

/**
 * Normalises a {@link CorsOrigin} option to the matcher list {@link createOriginMatcher} takes.
 * `undefined` means "any origin" (`['*']`); a bare string is one allowed origin, never iterated
 * character-by-character.
 *
 * @param origin - The configured origin option.
 * @returns The matcher list.
 */
export const normalizeCorsOrigins = (origin: CorsOrigin | undefined): (string | RegExp)[] => {
  if (origin === undefined) return ['*'];
  return typeof origin === 'string' ? [origin] : origin;
};

/**
 * Builds the origin resolver both CORS adapters share: given the request's `Origin`, return it
 * verbatim when a matcher accepts it (`'*'` accepts anything, a string must match exactly, a
 * RegExp must test true) and `''` otherwise, which every CORS library treats as "no match".
 * Reflecting the origin rather than returning `'*'` is what lets RegExp allow-lists work.
 *
 * @param matchers - The normalised matcher list from {@link normalizeCorsOrigins}.
 * @returns A resolver from request origin to the value to reflect, or `''` to deny.
 */
export const createOriginMatcher = (matchers: (string | RegExp)[]): ((requestOrigin: string) => string) => {
  return requestOrigin => {
    for (const matcher of matchers) {
      if (matcher === '*') {
        return requestOrigin;
      }

      if (typeof matcher === 'string') {
        if (matcher === requestOrigin) {
          return requestOrigin;
        }
        continue;
      }

      if (matcher.test(requestOrigin)) {
        return requestOrigin;
      }
    }

    // return the zero value to prevent matches
    return '';
  };
};

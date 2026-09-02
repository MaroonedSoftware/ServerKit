/**
 * Precompiles an anonymous-path allow-list into a matcher. Strings match a request path
 * exactly (case-sensitive, no query string, trailing slash significant) and are kept in a Set
 * for O(1) lookup; RegExps are the escape hatch for prefixes (`/^\/public\//`) and are scanned
 * linearly. Both adapters' authentication middleware use this to skip scheme-handler resolution
 * on genuinely public routes.
 *
 * @param paths - Exact paths and patterns to treat as anonymous; defaults to none.
 * @returns A predicate over the request path.
 */
export const createAnonymousPathMatcher = (paths: (string | RegExp)[] = []): ((path: string) => boolean) => {
  const exactPaths = new Set<string>();
  const patterns: RegExp[] = [];
  for (const path of paths) {
    if (typeof path === 'string') {
      exactPaths.add(path);
    } else {
      patterns.push(path);
    }
  }
  return path => exactPaths.has(path) || patterns.some(pattern => pattern.test(path));
};

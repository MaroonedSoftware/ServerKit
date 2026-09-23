import type { OAuthErrorCode } from './oauth.types.js';

/** Hosts a native app listens on for its redirect ([RFC 8252 §7.3](https://datatracker.ietf.org/doc/html/rfc8252#section-7.3)). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const parse = (uri: string): URL | undefined => {
  try {
    return new URL(uri);
  } catch {
    return undefined;
  }
};

const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

/** `true` for an `http:` redirect URI on `localhost`, `127.0.0.1`, or `[::1]`. */
export const isLoopbackRedirectUri = (uri: string): boolean => {
  const url = parse(uri);
  return url !== undefined && isLoopback(url);
};

/**
 * Whether a presented `redirect_uri` is one the client registered.
 *
 * The match is exact, string for string, with one exception: a loopback URI
 * matches a registered loopback URI with the same host, path, and query on any
 * port, because a native app picks its port when it runs (RFC 8252 §7.3). A
 * presented URI that is neither `https:` nor loopback never matches, whatever
 * was registered.
 */
export const redirectUriMatches = (registered: readonly string[], presented: string): boolean => {
  const url = parse(presented);
  if (!url || url.hash !== '' || url.username !== '' || url.password !== '') return false;

  if (isLoopback(url)) {
    return registered.some(candidate => {
      const expected = parse(candidate);
      return (
        expected !== undefined &&
        isLoopback(expected) &&
        expected.hostname === url.hostname &&
        expected.pathname === url.pathname &&
        expected.search === url.search
      );
    });
  }

  if (url.protocol !== 'https:') return false;
  return registered.includes(presented);
};

/**
 * Check a redirect URI a client wants to register. Answers the OAuth error code
 * to refuse it with, or `undefined` when it is acceptable.
 *
 * Accepted: an absolute `https:` URI, or an `http:` loopback URI, with no
 * fragment and no userinfo. Custom schemes are refused.
 */
export const validateRegisteredRedirectUri = (uri: string): OAuthErrorCode | undefined => {
  const url = parse(uri);
  if (!url) return 'invalid_redirect_uri';
  if (uri.includes('#') || url.username !== '' || url.password !== '') return 'invalid_redirect_uri';
  if (url.protocol === 'https:' || isLoopback(url)) return undefined;
  return 'invalid_redirect_uri';
};

/**
 * What a consent screen should say about where the user is being sent.
 *
 * `host` is the presented redirect URI's host (with its port, if any), the
 * destination the user must recognise. `loopbackOnly` is `true` when every URI
 * the client registered is loopback: the code can only land on the user's own
 * machine, which is expected for a CLI and suspicious for anything claiming to
 * be a web app, so the screen should say so.
 */
export const describeRedirect = (redirectUri: string, registered: readonly string[]): { host: string; loopbackOnly: boolean } => {
  const url = parse(redirectUri);
  return {
    host: url?.host ?? '',
    loopbackOnly: registered.length > 0 && registered.every(isLoopbackRedirectUri),
  };
};

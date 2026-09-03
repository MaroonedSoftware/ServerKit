import type { FastifyRequest } from 'fastify';

/**
 * Internal request accessors. Not exported from the package: they exist so the plugins and hooks
 * agree on how a header is read, not as a public API. Handlers should use `request.url`,
 * `request.headers`, and Fastify's own helpers directly.
 */

/**
 * The request path without its query string. Fastify exposes only the full `url` and the matched
 * route pattern, so this is what path-based rules (anonymous paths, the logger name) match
 * against.
 *
 * @param request - The request.
 * @returns The pathname, `'/'` when the URL is missing.
 */
export const requestPath = (request: FastifyRequest): string => {
  const url = request.url ?? '/';
  const end = url.indexOf('?');
  return end === -1 ? url : url.slice(0, end);
};

/**
 * The request's media type with parameters stripped.
 *
 * @param request - The request.
 * @returns e.g. `'application/json'`, or `''` when there is no `Content-Type`.
 */
export const requestMediaType = (request: FastifyRequest): string => {
  const header = request.headers['content-type'];
  if (header === undefined) return '';
  const end = header.indexOf(';');
  return (end === -1 ? header : header.slice(0, end)).trim();
};

/**
 * The declared body length: the `Content-Length` header parsed as an integer, or `0` when absent.
 * A chunked body without `Content-Length` reports `0`, and the body gate treats that as
 * "no body" — the same rule the Koa adapter applies.
 *
 * @param request - The request.
 * @returns The declared length in bytes.
 */
export const requestBodyLength = (request: FastifyRequest): number => {
  const header = request.headers['content-length'];
  return header === undefined ? 0 : ~~header;
};

/**
 * Case-insensitive request header accessor returning `''` when absent and the first value when
 * the header was repeated.
 *
 * @param request - The request.
 * @param name - Header name, any case.
 * @returns The header value or `''`.
 */
export const requestHeader = (request: FastifyRequest, name: string): string => {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

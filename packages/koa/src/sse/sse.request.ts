/**
 * Request-side parsing for Server-Sent Events: reading the resume point a reconnecting client
 * sends. Zero-dependency (no schema library), so it is usable from any handler.
 */

/**
 * Return the first string value of a Koa query field, which may be a bare string or a list
 * when the parameter is repeated.
 *
 * @param value - The raw query field, of unknown shape.
 * @returns The first string value, or `undefined` when there isn't one.
 */
export function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * Resolve the resume point for a reconnecting SSE client.
 *
 * The `Last-Event-ID` header wins when it is a positive integer, since the browser sets it
 * automatically on reconnect. A `?lastEventId=` query value is the fallback, for clients (and
 * tests) that cannot set the header. Anything unusable resolves to `0`, meaning "start fresh".
 *
 * @param header - The raw `Last-Event-ID` request header (empty string when absent).
 * @param queryLastEventId - The raw `lastEventId` query field, of unknown shape.
 * @returns The id to resume after; `0` for a fresh client.
 */
export function resolveLastEventId(header: string, queryLastEventId: unknown): number {
  const headerId = Number(header);
  if (Number.isInteger(headerId) && headerId > 0) return headerId;
  const raw = firstQueryValue(queryLastEventId);
  const queryId = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(queryId) && queryId >= 0 ? queryId : 0;
}

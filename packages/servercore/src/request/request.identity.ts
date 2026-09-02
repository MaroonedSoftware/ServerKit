import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Request header carrying the correlation ID that ties a request to the work it fans out to. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';
/** Request header carrying the ID of this one request. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** The identifiers every ServerKit request context carries. */
export interface RequestIdentity {
  /** From `X-Correlation-Id`, or generated. Travels across services and jobs. */
  correlationId: string;
  /** From `X-Request-Id`, or generated. Unique to this request. */
  requestId: string;
}

/** First value of a header that Node may present as a string, a list, or nothing. */
const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Resolves the correlation and request IDs for a request: each is taken from its header when
 * present (the first value if the header was repeated) and generated with `crypto.randomUUID()`
 * otherwise. Every adapter's context middleware calls this and echoes both IDs on the response.
 *
 * @param headers - The incoming request headers.
 * @returns The resolved identifiers.
 */
export const resolveRequestIdentity = (headers: IncomingHttpHeaders): RequestIdentity => ({
  correlationId: firstHeaderValue(headers[CORRELATION_ID_HEADER]) ?? crypto.randomUUID(),
  requestId: firstHeaderValue(headers[REQUEST_ID_HEADER]) ?? crypto.randomUUID(),
});

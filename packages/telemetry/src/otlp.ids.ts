import { createHash } from 'node:crypto';

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

const hexOf = (id: string, length: number): string => createHash('sha256').update(id).digest('hex').slice(0, length);

/**
 * An OTLP trace id (32 lowercase hex characters) for an app's own trace id.
 *
 * An id already in that form is kept as it is. Anything else is hashed, so the same app id always
 * maps to the same trace id, and spans exported in different batches still land in one trace.
 *
 * @param id - The app's trace id.
 */
export const otlpTraceId = (id: string): string => (TRACE_ID.test(id) ? id : hexOf(id, 32));

/**
 * An OTLP span id (16 lowercase hex characters) for an app's own span id. Same rules as {@link otlpTraceId}.
 *
 * @param id - The app's span id.
 */
export const otlpSpanId = (id: string): string => (SPAN_ID.test(id) ? id : hexOf(id, 16));

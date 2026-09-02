import type { FastifyReply } from 'fastify';
import { openSseStream, type SseStream, type SseStreamOptions } from '@maroonedsoftware/servercore';

/**
 * Open a Server-Sent Events stream on a Fastify reply: hijacks the reply so Fastify stops
 * managing the response, then hands the raw socket to `openSseStream` from
 * `@maroonedsoftware/servercore` for headers, heartbeat, backpressure, and teardown.
 *
 * After calling this, do not `send` or set a status on `reply`; the stream owns the socket. Pass
 * `builder.lifecycleSignal` as `options.signal` so shutdown drains the stream instead of waiting
 * out the grace period, and register cleanup with `stream.onClose`.
 *
 * @param reply - The reply to take over.
 * @param options - Heartbeat, backpressure, and header tuning; see {@link SseStreamOptions}.
 * @returns The open stream.
 *
 * @example
 * ```typescript
 * router.get('/feed', async (_request, reply) => {
 *   const stream = openSseReply(reply, { signal: builder.lifecycleSignal });
 *   const timer = setInterval(() => stream.event({ data: { at: DateTime.now().toISO() } }), 1000);
 *   stream.onClose(() => clearInterval(timer));
 * });
 * ```
 */
export const openSseReply = (reply: FastifyReply, options: SseStreamOptions = {}): SseStream => {
  return openSseStream({ res: reply.raw, hijack: () => void reply.hijack() }, options);
};

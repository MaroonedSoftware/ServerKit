import { frameComment, frameEvent, type SseFrame } from './sse.frame.js';

/**
 * A Server-Sent Events stream over a raw Node response.
 *
 * SSE is a streaming (non-JSON) body, so the stream takes over the raw socket and writes
 * frames directly rather than handing the framework a stream body: Koa pipes stream bodies
 * with `stream.pipeline`, which logs `ERR_STREAM_PREMATURE_CLOSE` on every client disconnect,
 * and Fastify's serialisation would never see a hijacked reply. Owning the socket lets us
 * swallow that expected teardown. The takeover itself is framework-specific and comes in
 * through {@link SseContext}: Koa's `respond = false`, Fastify's `reply.hijack()`.
 *
 * Transport only — it knows nothing about what is being streamed. See
 * `@maroonedsoftware/servercore/serverfeed` for the realtime-bus feed built on top of it.
 */

/** Default heartbeat comment interval — keeps the socket and any intermediary proxy warm. */
export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

/**
 * Default ceiling for a client's unflushed send buffer.
 *
 * A single failed write only means the socket's highWaterMark (~16KB) was crossed; Node keeps
 * buffering and drains on its own, so transient slowness is fine. Only a client that falls
 * this far behind is dropped — it reconnects and resumes from `Last-Event-ID` rather than
 * ballooning server memory.
 */
export const DEFAULT_SSE_MAX_BUFFERED_BYTES = 1_000_000;

/** The raw response an SSE stream writes to once it has taken over the socket. */
export interface SseResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  setTimeout(ms: number): unknown;
  on(event: string, listener: () => void): unknown;
  /** Bytes buffered but not yet flushed to the socket (Node's `Writable.writableLength`). */
  readonly writableLength?: number;
}

/**
 * The subset of a request context an SSE stream touches. Kept as a small structural type so
 * handlers are unit-testable with a fake ctx (a fake `res` sink) without standing up the whole
 * server, and so any framework can supply one.
 *
 * A Koa context satisfies it as-is: `status` is set to 200 and `respond` to `false`, which is
 * Koa's socket-takeover switch. A Fastify adapter passes `{ res: reply.raw, hijack: () =>
 * reply.hijack() }` instead. The Koa fields are optional so either shape fits.
 */
export interface SseContext {
  /** Set to `200` before the headers are written; Koa reads it, other frameworks may ignore it. */
  status?: number;
  /** Koa's socket-takeover flag; set to `false` by {@link openSseStream}. */
  respond?: boolean;
  /** The raw response the stream writes to once it has taken over. */
  res: SseResponse;
  /** Framework hook that hands the raw response over (Fastify's `reply.hijack()`); called once, before any write. */
  hijack?: () => void;
}

/** Tuning for {@link openSseStream}. */
export interface SseStreamOptions {
  /** Heartbeat comment interval in ms; `0` disables. Default {@link DEFAULT_SSE_HEARTBEAT_MS}. */
  heartbeatMs?: number;
  /**
   * Drop a client whose unflushed buffer grows past this many bytes.
   * Default {@link DEFAULT_SSE_MAX_BUFFERED_BYTES}.
   */
  maxBufferedBytes?: number;
  /** Extra response headers, merged over (and able to override) the SSE defaults. */
  headers?: Record<string, string>;
  /**
   * Closes the stream when aborted. Pass the server's lifecycle signal
   * (`ServerKitServerBuilder.lifecycleSignal`) so shutdown drains open streams instead of
   * waiting out the socket grace period — an SSE stream never ends on its own, so without this
   * every connected client holds `server.close()` open until it is force-closed. A stream opened
   * with an already-aborted signal closes immediately rather than taking over the socket for a
   * server that is going away.
   */
  signal?: AbortSignal;
}

/** An open SSE stream. Writes are no-ops once the stream has closed. */
export interface SseStream {
  /** Write a pre-formatted frame verbatim. */
  write(chunk: string): void;
  /** Format and write one event frame. */
  event(frame: SseFrame): void;
  /** Write a comment line (ignored by clients). */
  comment(text: string): void;
  /**
   * Register cleanup to run when the stream closes, for any reason. A listener registered
   * after the stream has already closed runs immediately, so a teardown racing the initial
   * writes can't leak a subscription or timer.
   */
  onClose(listener: () => void): void;
  /** Close the stream and run the cleanup listeners. Idempotent. */
  close(): void;
  /** True once the stream has closed. */
  readonly closed: boolean;
}

/**
 * Open an SSE stream on a request context: set the streaming headers, take over the raw socket,
 * start a heartbeat, and wire teardown to the socket's lifecycle.
 *
 * Backpressure is tolerated while the socket drains; only a client that falls past
 * `maxBufferedBytes` is dropped, so it reconnects and resumes rather than bloating memory.
 * Socket `error` and `close` both tear the stream down (destroying the socket on error), and a
 * disconnect is never surfaced as an error — it is the expected way one of these ends. Passing
 * `options.signal` adds one more way in: the stream closes when the signal aborts, which is how
 * server shutdown drains streams that would otherwise hold the socket open (see the option docs).
 *
 * @param ctx - The (structural) request context; its `res` is taken over for the stream.
 * @param options - Heartbeat, backpressure, and header tuning; see {@link SseStreamOptions}.
 * @returns The open stream; register teardown for your own resources with `onClose`.
 *
 * @example
 * ```typescript
 * router.get('/feed', async ctx => {
 *   const stream = openSseStream(ctx as unknown as SseContext);
 *   const timer = setInterval(() => stream.event({ data: { at: DateTime.now().toISO() } }), 1000);
 *   stream.onClose(() => clearInterval(timer));
 * });
 * ```
 */
export function openSseStream(ctx: SseContext, options: SseStreamOptions = {}): SseStream {
  const { heartbeatMs = DEFAULT_SSE_HEARTBEAT_MS, maxBufferedBytes = DEFAULT_SSE_MAX_BUFFERED_BYTES, headers, signal } = options;

  // `no-transform` and `X-Accel-Buffering: no` defeat proxy buffering; clearing the socket
  // timeout stops a quiet stream being torn down between heartbeats.
  ctx.status = 200;
  ctx.respond = false;
  ctx.hijack?.();
  ctx.res.setTimeout(0);
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...headers,
  });

  const closeListeners: Array<() => void> = [];
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;

  const teardown = (destroy: boolean): void => {
    if (closed) return;
    closed = true;
    if (ping !== undefined) clearInterval(ping);
    // The lifecycle signal outlives any single request, so drop this listener on the way out —
    // otherwise every stream the server ever opened stays reachable from it.
    signal?.removeEventListener('abort', onAbort);
    for (const listener of closeListeners) {
      try {
        listener();
      } catch {
        // One failing cleanup must not skip the others, or abort the socket teardown below.
      }
    }
    if (destroy) ctx.res.destroy();
    else ctx.res.end();
  };

  // Declared after `teardown` but only ever invoked later, so the closure is safely initialized.
  const onAbort = (): void => teardown(false);

  // A disconnect (closed socket, or a write to a client that's gone) is expected — never
  // surface it as an error.
  ctx.res.on('error', () => teardown(true));
  ctx.res.on('close', () => teardown(false));

  // Shutdown may already have begun by the time this request opened its stream; close it out
  // rather than taking over a socket on a server that is draining.
  if (signal?.aborted) teardown(false);
  else signal?.addEventListener('abort', onAbort, { once: true });

  const write = (chunk: string): void => {
    if (closed) return;
    if (!ctx.res.write(chunk) && (ctx.res.writableLength ?? 0) > maxBufferedBytes) teardown(true);
  };

  // Guarded on `closed`: an already-aborted signal tore the stream down above, and a heartbeat
  // started now would never be cleared.
  if (heartbeatMs > 0 && !closed) ping = setInterval(() => write(frameComment('ping')), heartbeatMs);

  return {
    write,
    event: frame => write(frameEvent(frame)),
    comment: text => write(frameComment(text)),
    onClose: listener => {
      if (closed) listener();
      else closeListeners.push(listener);
    },
    close: () => teardown(false),
    get closed() {
      return closed;
    },
  };
}

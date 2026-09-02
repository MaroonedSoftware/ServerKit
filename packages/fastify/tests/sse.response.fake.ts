import type { SseContext, SseResponse } from '@maroonedsoftware/servercore';

/**
 * A fake raw response recording writes and lifecycle calls, with a controllable backpressure
 * signal. Shared by the SSE transport tests and the server feed tests so neither has to stand
 * up a real server to exercise socket takeover.
 */
export function fakeRes() {
  const listeners: Record<string, Array<() => void>> = {};
  const res = {
    written: [] as string[],
    headers: undefined as Record<string, string> | undefined,
    statusWritten: 0,
    ended: false,
    destroyed: false,
    timeoutSet: undefined as number | undefined,
    writableLength: 0,
    /** When true, `write` reports backpressure by returning false. */
    blocked: false,
    writeHead(status: number, headers: Record<string, string>) {
      res.statusWritten = status;
      res.headers = headers;
    },
    write(chunk: string) {
      res.written.push(chunk);
      return !res.blocked;
    },
    end() {
      res.ended = true;
    },
    destroy() {
      res.destroyed = true;
    },
    setTimeout(ms: number) {
      res.timeoutSet = ms;
    },
    on(event: string, listener: () => void) {
      (listeners[event] ??= []).push(listener);
    },
    /** Fire the listeners registered for a socket event, standing in for Node. */
    emit(event: string) {
      (listeners[event] ?? []).forEach(l => l());
    },
  };
  return res;
}

export type FakeRes = ReturnType<typeof fakeRes>;

/** Wrap a {@link fakeRes} in the minimal SSE context shape. */
export function fakeSseCtx(res: FakeRes): SseContext {
  return { status: 0, respond: undefined, res: res as unknown as SseResponse };
}

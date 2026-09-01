import { describe, it, expect } from 'vitest';
import { sendJson } from '../src/send.json.js';
import type { ServerKitContext } from '../src/serverkit.context.js';

describe('sendJson', () => {
  // Only status/type/body are touched — a plain object records the assignments.
  const makeCtx = (): { status?: number; type?: string; body?: unknown } => ({});

  it('sets the body to the serialized string with application/json and status 200', () => {
    const ctx = makeCtx();

    sendJson(ctx as unknown as ServerKitContext, '{"ok":true}');

    expect(ctx.status).toBe(200);
    expect(ctx.type).toBe('application/json');
    expect(ctx.body).toBe('{"ok":true}');
  });

  it('honours an explicit status', () => {
    const ctx = makeCtx();

    sendJson(ctx as unknown as ServerKitContext, '{"id":1}', 201);

    expect(ctx.status).toBe(201);
    expect(ctx.body).toBe('{"id":1}');
  });

  it('sets the type before the body so Koa does not infer text/plain', () => {
    // Order matters: Koa's body setter assigns a content type only when none was set
    // explicitly, and a string body infers text/plain. Record assignment order.
    const order: string[] = [];
    const ctx = {} as Record<string, unknown>;
    for (const key of ['status', 'type', 'body']) {
      Object.defineProperty(ctx, key, {
        set: () => void order.push(key),
        get: () => undefined,
      });
    }

    sendJson(ctx as unknown as ServerKitContext, '{}');

    expect(order.indexOf('type')).toBeLessThan(order.indexOf('body'));
  });
});

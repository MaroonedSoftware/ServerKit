import { describe, it, expect } from 'vitest';
import { serverFeedRouter } from '../src/serverfeed/server.feed.stream.js';
import * as subpath from '../src/serverfeed.js';

describe('serverFeedRouter', () => {
  it('mounts the SSE route at the default path', () => {
    const router = serverFeedRouter();
    const paths = (router as unknown as { stack: Array<{ path: string }> }).stack.map(l => l.path);
    expect(paths).toContain('/server/feed');
  });

  it('honors a custom path', () => {
    const router = serverFeedRouter({ path: '/ops/events' });
    const paths = (router as unknown as { stack: Array<{ path: string }> }).stack.map(l => l.path);
    expect(paths).toContain('/ops/events');
  });
});

describe('@maroonedsoftware/koa/serverfeed', () => {
  it('re-exports the shared handler and filter alongside the router', () => {
    expect(subpath.serverFeedRouter).toBeTypeOf('function');
    expect(subpath.handleServerFeed).toBeTypeOf('function');
    expect(subpath.serverFeedFilterFromQuery).toBeTypeOf('function');
  });
});

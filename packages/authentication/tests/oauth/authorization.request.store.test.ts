import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Duration } from 'luxon';
import { AuthorizationRequestStore, AuthorizationRequestStoreOptions } from '../../src/oauth/authorization.request.store.js';
import type { AuthorizationRequest } from '../../src/oauth/oauth.types.js';
import { makeCache } from './oauth.fakes.js';

const REQUEST: AuthorizationRequest = {
  clientId: 'dyn_claude',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  responseType: 'code',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  codeChallengeMethod: 'S256',
  scope: ['mcp'],
  resource: 'https://station.example.com/api/mcp',
};

let cache: ReturnType<typeof makeCache>;
let store: AuthorizationRequestStore;

beforeEach(() => {
  cache = makeCache();
  store = new AuthorizationRequestStore(cache, new AuthorizationRequestStoreOptions());
});

describe('AuthorizationRequestStore', () => {
  it('stashes for the configured time and hands the request back once', async () => {
    const id = await store.stash(REQUEST, 'user-1');

    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((vi.mocked(cache.set).mock.calls[0]?.[2] as Duration).as('minutes')).toBe(10);
    await expect(store.take(id, 'user-1')).resolves.toEqual(REQUEST);
    await expect(store.take(id, 'user-1')).resolves.toBeUndefined();
  });

  it('answers undefined to another subject and leaves the request for its own', async () => {
    const id = await store.stash(REQUEST, 'user-1');

    await expect(store.take(id, 'user-2')).resolves.toBeUndefined();
    await expect(store.take(id, 'user-1')).resolves.toEqual(REQUEST);
  });

  it('answers undefined for an unknown id', async () => {
    await expect(store.take('nope', 'user-1')).resolves.toBeUndefined();
  });

  it('lets only one of two concurrent takes win', async () => {
    const id = await store.stash(REQUEST, 'user-1');

    const results = await Promise.all([store.take(id, 'user-1'), store.take(id, 'user-1')]);

    expect(results.filter(result => result !== undefined)).toHaveLength(1);
  });

  it('honours a configured lifetime', async () => {
    const short = new AuthorizationRequestStore(cache, new AuthorizationRequestStoreOptions(Duration.fromObject({ minutes: 2 })));
    await short.stash(REQUEST, 'user-1');
    expect((vi.mocked(cache.set).mock.calls[0]?.[2] as Duration).as('minutes')).toBe(2);
  });
});

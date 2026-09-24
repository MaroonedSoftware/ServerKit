import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordClient, DISCORD_API_BASE } from '../src/client/discord.client.js';
import { DiscordError } from '../src/discord.error.js';
import type { DiscordConfig } from '../src/discord.config.js';
import { makeLogger } from './helpers.js';

const cfg = { botToken: 'bot-token', publicKey: 'pub', applicationId: 'app1', signatureMaxAgeSeconds: undefined };

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>;
const lastCall = () => fetchMock().mock.calls[0] as [string, RequestInit];

describe('DiscordClient', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('createMessage POSTs to the channel messages route with bot auth', async () => {
    fetchMock().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    const client = new DiscordClient(cfg, makeLogger());

    const res = await client.createMessage('C1', { content: 'hi' });

    const [url, init] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/channels/C1/messages`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bot bot-token');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hi' });
    expect(res).toEqual({ id: 'm1' });
  });

  it('createFollowupMessage POSTs to the webhook route WITHOUT bot auth', async () => {
    fetchMock().mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new DiscordClient(cfg, makeLogger());

    await client.createFollowupMessage('tok123', { content: 'done' });

    const [url, init] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/webhooks/app1/tok123`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('editOriginalInteractionResponse PATCHes the @original message', async () => {
    fetchMock().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new DiscordClient(cfg, makeLogger());

    await client.editOriginalInteractionResponse('tok123', { content: 'edited' });

    const [url, init] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/webhooks/app1/tok123/messages/@original`);
    expect(init.method).toBe('PATCH');
  });

  it('deleteOriginalInteractionResponse DELETEs the @original message', async () => {
    fetchMock().mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new DiscordClient(cfg, makeLogger());

    const res = await client.deleteOriginalInteractionResponse('tok123');

    const [url, init] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/webhooks/app1/tok123/messages/@original`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(res).toBeUndefined();
  });

  it('bulkOverwriteGlobalCommands PUTs the commands array', async () => {
    fetchMock().mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const client = new DiscordClient(cfg, makeLogger());

    await client.bulkOverwriteGlobalCommands([{ name: 'deploy', description: 'Deploy' }]);

    const [url, init] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/applications/app1/commands`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual([{ name: 'deploy', description: 'Deploy' }]);
  });

  it('bulkOverwriteGuildCommands targets the guild route', async () => {
    fetchMock().mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const client = new DiscordClient(cfg, makeLogger());

    await client.bulkOverwriteGuildCommands('G1', []);

    const [url] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/applications/app1/guilds/G1/commands`);
  });

  it('throws DiscordError on a non-2xx response', async () => {
    fetchMock().mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const client = new DiscordClient(cfg, makeLogger());
    await expect(client.createMessage('C1', { content: 'hi' })).rejects.toBeInstanceOf(DiscordError);
  });

  it('createInteractionResponse POSTs to the callback route WITHOUT bot auth', async () => {
    fetchMock().mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new DiscordClient(cfg, makeLogger());

    await client.createInteractionResponse('i1', 'tok123', { type: 4, data: { content: 'ack' } });

    const [url, init] = lastCall();
    expect(url).toBe(`${DISCORD_API_BASE}/interactions/i1/tok123/callback`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('does not leak the interaction token in the logged/error internalDetails', async () => {
    fetchMock().mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const logger = makeLogger();
    const client = new DiscordClient(cfg, logger);

    const err = await client.createFollowupMessage('super-secret-token', { content: 'x' }).catch((e: DiscordError) => e);

    expect(err).toBeInstanceOf(DiscordError);
    const details = (err as DiscordError).internalDetails as { url: string };
    expect(details.url).not.toContain('super-secret-token');
    expect(details.url).toBe(`${DISCORD_API_BASE}/webhooks/app1/***`);
    expect((err as DiscordError).message).not.toContain('super-secret-token');
    // The warn log must not carry the raw token either.
    const warnArgs = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.stringify(warnArgs)).not.toContain('super-secret-token');
  });

  it('passes an AbortSignal (timeout) on outbound requests', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new DiscordClient(cfg, makeLogger());

    await client.createMessage('C1', { content: 'hi' });

    const [, init] = lastCall();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('carries retry_after from the body on a rate-limited call', async () => {
    fetchMock().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'You are being rate limited.', retry_after: 1.5, global: false }), { status: 429 }),
    );
    const client = new DiscordClient(cfg, makeLogger());

    const err = (await client.createMessage('C1', { content: 'hi' }).catch((e: unknown) => e)) as DiscordError;

    expect(err.internalDetails).toMatchObject({ status: 429, retryAfter: 1.5 });
  });

  it('falls back to the Retry-After header when the body has no retry_after', async () => {
    fetchMock().mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }));
    const client = new DiscordClient(cfg, makeLogger());

    const err = (await client.createMessage('C1', { content: 'hi' }).catch((e: unknown) => e)) as DiscordError;

    expect(err.internalDetails).toMatchObject({ status: 429, retryAfter: 3 });
  });

  it('carries no retryAfter on an error that is not a 429', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{"retry_after":9}', { status: 500 }));
    const client = new DiscordClient(cfg, makeLogger());

    const err = (await client.createMessage('C1', { content: 'hi' }).catch((e: unknown) => e)) as DiscordError;

    expect(err.internalDetails).not.toHaveProperty('retryAfter');
  });

  it('throws a DiscordError with both tokens redacted when the call never reaches Discord', async () => {
    fetchMock().mockRejectedValueOnce(
      new Error(`connect ECONNREFUSED fetching ${DISCORD_API_BASE}/webhooks/app1/super-secret-token with Bot bot-token`),
    );
    const logger = makeLogger();
    const client = new DiscordClient(cfg, logger);

    const err = (await client.createFollowupMessage('super-secret-token', { content: 'x' }).catch((e: unknown) => e)) as DiscordError;

    expect(err).toBeInstanceOf(DiscordError);
    expect(err.cause).toBeUndefined();
    const everything = JSON.stringify([err.message, err.internalDetails, (logger.warn as ReturnType<typeof vi.fn>).mock.calls]);
    expect(everything).not.toContain('super-secret-token');
    expect(everything).not.toContain('bot-token');
    expect(String(err.internalDetails?.reason)).toContain('/webhooks/app1/***');
    expect(String(err.internalDetails?.reason)).toContain('ECONNREFUSED');
  });

  it('redacts the bot token from an error body', async () => {
    fetchMock().mockResolvedValueOnce(new Response('<html>proxy refused Bot bot-token</html>', { status: 502 }));
    const client = new DiscordClient(cfg, makeLogger());

    const err = (await client.getCurrentUser().catch((e: unknown) => e)) as DiscordError;

    expect(String(err.internalDetails?.body)).not.toContain('bot-token');
  });

  it('honours a per-call timeoutMs over the configured one', async () => {
    // `AbortSignal.timeout` runs on the platform's own timers, so what is asserted is the deadline asked for.
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }));
      const client = new DiscordClient({ ...cfg, requestTimeoutMs: 1_000 } as DiscordConfig, makeLogger());

      await client.request('GET', '/users/@me', { timeoutMs: 42 });

      expect(timeout).toHaveBeenCalledWith(42);
    } finally {
      timeout.mockRestore();
    }
  });

  it('prefixes the configured base URL', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new DiscordClient({ ...cfg, apiBaseUrl: 'https://discord.example/api/v10' } as DiscordConfig, makeLogger());

    await client.getCurrentUser();

    expect(lastCall()[0]).toBe('https://discord.example/api/v10/users/@me');
  });

  describe('a fetch of the caller’s own', () => {
    it('is used for every call instead of the global one', async () => {
      const own = vi.fn(async () => new Response(JSON.stringify({ id: 'u1' }), { status: 200 }));
      const client = new DiscordClient({ ...cfg, fetch: own } as DiscordConfig, makeLogger());

      await expect(client.getCurrentUser()).resolves.toEqual({ id: 'u1' });

      expect(own).toHaveBeenCalledWith(
        `${DISCORD_API_BASE}/users/@me`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ authorization: 'Bot bot-token' }),
          signal: expect.any(AbortSignal),
        }),
      );
      expect(fetchMock()).not.toHaveBeenCalled();
    });
  });

  describe('helpers', () => {
    it('getGatewayBot GETs /gateway/bot with bot auth', async () => {
      const bot = {
        url: 'wss://gateway.discord.gg',
        shards: 1,
        session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 },
      };
      fetchMock().mockResolvedValueOnce(new Response(JSON.stringify(bot), { status: 200 }));
      const client = new DiscordClient(cfg, makeLogger());

      await expect(client.getGatewayBot()).resolves.toEqual(bot);

      const [url, init] = lastCall();
      expect(url).toBe(`${DISCORD_API_BASE}/gateway/bot`);
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).authorization).toBe('Bot bot-token');
    });

    it('getChannelMessages passes after and limit as a query', async () => {
      fetchMock().mockResolvedValueOnce(new Response('[{"id":"m2"}]', { status: 200 }));
      const client = new DiscordClient(cfg, makeLogger());

      await expect(client.getChannelMessages('C1', { after: 'm1', limit: 10 })).resolves.toEqual([{ id: 'm2' }]);

      expect(lastCall()[0]).toBe(`${DISCORD_API_BASE}/channels/C1/messages?after=m1&limit=10`);
    });

    it('getChannelMessages sends no query when given none', async () => {
      fetchMock().mockResolvedValueOnce(new Response('[]', { status: 200 }));
      const client = new DiscordClient(cfg, makeLogger());

      await client.getChannelMessages('C1');

      expect(lastCall()[0]).toBe(`${DISCORD_API_BASE}/channels/C1/messages`);
    });

    it('deferInteraction sends callback type 5 by default and 6 for an update', async () => {
      fetchMock().mockResolvedValue(new Response(null, { status: 204 }));
      const client = new DiscordClient(cfg, makeLogger());

      await client.deferInteraction({ id: 'i1', token: 'tok' });
      await client.deferInteraction({ id: 'i1', token: 'tok' }, 'update');

      const calls = fetchMock().mock.calls as [string, RequestInit][];
      expect(calls[0]![0]).toBe(`${DISCORD_API_BASE}/interactions/i1/tok/callback`);
      expect(JSON.parse(calls[0]![1].body as string)).toEqual({ type: 5 });
      expect(JSON.parse(calls[1]![1].body as string)).toEqual({ type: 6 });
    });
  });
});

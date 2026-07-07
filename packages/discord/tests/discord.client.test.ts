import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordClient, DISCORD_API_BASE } from '../src/client/discord.client.js';
import { DiscordError } from '../src/discord.error.js';
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
});

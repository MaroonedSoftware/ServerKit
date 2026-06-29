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
});

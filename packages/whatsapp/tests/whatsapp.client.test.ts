import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppClient, WHATSAPP_GRAPH_API_HOST } from '../src/client/whatsapp.client.js';
import { WhatsAppError } from '../src/whatsapp.error.js';
import { makeLogger } from './helpers.js';

const cfg = { accessToken: 'tok', phoneNumberId: 'PN1', appSecret: 'sec', verifyToken: 'vt' };

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>;
const lastCall = () => fetchMock().mock.calls[0] as [string, RequestInit];

describe('WhatsAppClient', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sendText POSTs a text message to the messages endpoint with bearer auth', async () => {
    fetchMock().mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }));
    const client = new WhatsAppClient(cfg, makeLogger());

    const res = await client.sendText('15551234567', 'hello');

    const [url, init] = lastCall();
    expect(url).toBe(`${WHATSAPP_GRAPH_API_HOST}/v21.0/PN1/messages`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toMatchObject({ messaging_product: 'whatsapp', to: '15551234567', type: 'text', text: { body: 'hello', preview_url: false } });
    expect(res).toEqual({ messages: [{ id: 'wamid.1' }] });
  });

  it('respects a configured graphApiVersion', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new WhatsAppClient({ ...cfg, graphApiVersion: 'v19.0' }, makeLogger());

    await client.sendText('15551234567', 'hi');

    const [url] = lastCall();
    expect(url).toBe(`${WHATSAPP_GRAPH_API_HOST}/v19.0/PN1/messages`);
  });

  it('markAsRead posts a read status for the message id', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new WhatsAppClient(cfg, makeLogger());

    await client.markAsRead('wamid.abc');

    const [, init] = lastCall();
    expect(JSON.parse(init.body as string)).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.abc' });
  });

  it('sendInteractive posts an interactive message', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new WhatsAppClient(cfg, makeLogger());

    await client.sendInteractive('15551234567', { type: 'button', body: { text: 'Pick one' } });

    const [, init] = lastCall();
    expect(JSON.parse(init.body as string)).toMatchObject({ type: 'interactive', interactive: { type: 'button' } });
  });

  it('throws WhatsAppError on a non-2xx response', async () => {
    fetchMock().mockResolvedValueOnce(new Response('boom', { status: 400 }));
    const client = new WhatsAppClient(cfg, makeLogger());
    await expect(client.sendText('15551234567', 'hi')).rejects.toBeInstanceOf(WhatsAppError);
  });
});

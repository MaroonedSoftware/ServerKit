import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramClient } from '../src/client/telegram.client.js';
import { TelegramConfig, TELEGRAM_DEFAULT_API_BASE_URL } from '../src/telegram.config.js';
import { TelegramError } from '../src/telegram.error.js';
import { makeLogger } from './helpers.js';

const cfg = { botToken: '12345:ABC' };

const fetchMock = () => globalThis.fetch as ReturnType<typeof vi.fn>;
const lastCall = () => fetchMock().mock.calls[0] as [string, RequestInit];
const okResponse = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });

describe('TelegramClient', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sendMessage POSTs to /bot<token>/sendMessage and returns result', async () => {
    fetchMock().mockResolvedValueOnce(okResponse({ message_id: 99 }));
    const client = new TelegramClient(cfg, makeLogger());

    const res = await client.sendMessage({ chat_id: 42, text: 'hi' });

    const [url, init] = lastCall();
    expect(url).toBe(`${TELEGRAM_DEFAULT_API_BASE_URL}/bot12345:ABC/sendMessage`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: 42, text: 'hi' });
    expect(res).toEqual({ message_id: 99 });
  });

  it('answerCallbackQuery targets the right method', async () => {
    fetchMock().mockResolvedValueOnce(okResponse(true));
    const client = new TelegramClient(cfg, makeLogger());

    await client.answerCallbackQuery({ callback_query_id: 'q1', text: 'Done' });

    const [url] = lastCall();
    expect(url).toBe(`${TELEGRAM_DEFAULT_API_BASE_URL}/bot12345:ABC/answerCallbackQuery`);
  });

  it('respects a configured apiBaseUrl', async () => {
    fetchMock().mockResolvedValueOnce(okResponse(true));
    const client = new TelegramClient({ ...cfg, apiBaseUrl: 'http://localhost:8081' } as TelegramConfig, makeLogger());

    await client.deleteWebhook();

    const [url] = lastCall();
    expect(url).toBe('http://localhost:8081/bot12345:ABC/deleteWebhook');
  });

  it('throws TelegramError on an ok:false envelope (even with HTTP 200)', async () => {
    fetchMock().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }), { status: 200 }));
    const client = new TelegramClient(cfg, makeLogger());
    await expect(client.sendMessage({ chat_id: 1, text: 'x' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('throws TelegramError on a non-2xx status', async () => {
    fetchMock().mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));
    const client = new TelegramClient(cfg, makeLogger());
    await expect(client.sendMessage({ chat_id: 1, text: 'x' })).rejects.toBeInstanceOf(TelegramError);
  });
});

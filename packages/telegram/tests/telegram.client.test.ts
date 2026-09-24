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
    fetchMock().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }), { status: 200 }),
    );
    const client = new TelegramClient(cfg, makeLogger());
    await expect(client.sendMessage({ chat_id: 1, text: 'x' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('throws TelegramError on a non-2xx status', async () => {
    fetchMock().mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));
    const client = new TelegramClient(cfg, makeLogger());
    await expect(client.sendMessage({ chat_id: 1, text: 'x' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('carries retry_after on a rate-limited call', async () => {
    fetchMock().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }), {
        status: 429,
      }),
    );
    const client = new TelegramClient(cfg, makeLogger());

    const error = (await client.sendMessage({ chat_id: 1, text: 'x' }).catch((e: unknown) => e)) as TelegramError;

    expect(error.internalDetails).toMatchObject({ method: 'sendMessage', status: 429, errorCode: 429, retryAfter: 7 });
  });

  it('throws a TelegramError with the token redacted when the call never reaches Telegram', async () => {
    fetchMock().mockRejectedValueOnce(new Error(`connect ECONNREFUSED fetching ${TELEGRAM_DEFAULT_API_BASE_URL}/bot12345:ABC/sendMessage`));
    const logger = makeLogger();
    const client = new TelegramClient(cfg, logger);

    const error = (await client.sendMessage({ chat_id: 1, text: 'x' }).catch((e: unknown) => e)) as TelegramError;

    expect(error).toBeInstanceOf(TelegramError);
    expect(JSON.stringify(error.internalDetails)).not.toContain('12345:ABC');
    expect(JSON.stringify(error.internalDetails)).toContain('/bot<token>/sendMessage');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify((logger.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('12345:ABC');
  });

  it('redacts the token from a body that is not JSON', async () => {
    fetchMock().mockResolvedValueOnce(new Response('<html>bad gateway for /bot12345:ABC/getMe</html>', { status: 502 }));
    const client = new TelegramClient(cfg, makeLogger());

    const error = (await client.getMe().catch((e: unknown) => e)) as TelegramError;

    expect(String(error.internalDetails?.description)).not.toContain('12345:ABC');
  });

  describe('a fetch of the caller’s own', () => {
    it('is used for every call instead of the global one', async () => {
      const own = vi.fn(async () => okResponse({ id: 1, username: 'bot' }));
      const client = new TelegramClient({ ...cfg, fetch: own } as TelegramConfig, makeLogger());

      await expect(client.getMe()).resolves.toEqual({ id: 1, username: 'bot' });

      expect(own).toHaveBeenCalledWith(
        `${TELEGRAM_DEFAULT_API_BASE_URL}/bot12345:ABC/getMe`,
        expect.objectContaining({ method: 'POST', body: '{}', signal: expect.any(AbortSignal) }),
      );
      expect(fetchMock()).not.toHaveBeenCalled();
    });
  });

  describe('getUpdates', () => {
    it('long-polls with the offset and wait it is given, and answers the updates', async () => {
      fetchMock().mockResolvedValueOnce(okResponse([{ update_id: 5 }]));
      const client = new TelegramClient(cfg, makeLogger());

      const updates = await client.getUpdates({ offset: 5, timeout: 25, allowed_updates: ['message'] });

      const [url, init] = lastCall();
      expect(url).toBe(`${TELEGRAM_DEFAULT_API_BASE_URL}/bot12345:ABC/getUpdates`);
      expect(JSON.parse(init.body as string)).toEqual({ offset: 5, timeout: 25, allowed_updates: ['message'] });
      expect(updates).toEqual([{ update_id: 5 }]);
    });

    it('allows the long poll its wait on top of the request timeout, so a quiet poll is not cut off', async () => {
      // `AbortSignal.timeout` runs on the platform's own timers, which fake timers do not drive, so
      // what is asserted is the deadline it is asked for.
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      try {
        fetchMock().mockResolvedValueOnce(okResponse([]));
        const client = new TelegramClient({ ...cfg, requestTimeoutMs: 1_000 } as TelegramConfig, makeLogger());

        await client.getUpdates({ timeout: 25 });

        expect(timeout).toHaveBeenCalledWith(26_000);
      } finally {
        timeout.mockRestore();
      }
    });

    it('answers an empty list when Telegram answers something other than an array', async () => {
      fetchMock().mockResolvedValueOnce(okResponse(null));
      const client = new TelegramClient(cfg, makeLogger());

      await expect(client.getUpdates()).resolves.toEqual([]);
    });
  });
});

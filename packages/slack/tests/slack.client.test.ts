import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const webClientCtor = vi.fn();
const postMessage = vi.fn();
const update = vi.fn();
const del = vi.fn();
const open = vi.fn();
const connectionsOpen = vi.fn();

vi.mock('@slack/web-api', () => {
  function WebClient(this: unknown, token: string, options: unknown) {
    webClientCtor(token, options);
    return {
      chat: { postMessage, update, delete: del },
      views: { open },
      apps: { connections: { open: connectionsOpen } },
    };
  }
  return { WebClient };
});

import { SlackClient } from '../src/client/slack.client.js';
import { adaptLogger } from '../src/client/slack.logger.adapter.js';
import { SlackError } from '../src/slack.error.js';
import type { SlackConfig } from '../src/slack.config.js';
import { makeLogger } from './helpers.js';

const cfg = { botToken: 'xoxb-test', signingSecret: 'sig', signatureMaxAgeSeconds: undefined, incomingWebhookUrl: undefined };

describe('SlackClient', () => {
  beforeEach(() => {
    webClientCtor.mockReset();
    postMessage.mockReset();
    update.mockReset();
    del.mockReset();
    open.mockReset();
  });

  it('constructs WebClient with the configured bot token and an adapted logger', () => {
    const logger = makeLogger();
    new SlackClient(cfg, logger);
    expect(webClientCtor).toHaveBeenCalledOnce();
    const [token, opts] = webClientCtor.mock.calls[0]!;
    expect(token).toBe('xoxb-test');
    expect((opts as { logger: unknown }).logger).toBeDefined();
    expect(opts).not.toHaveProperty('fetch');
    expect(opts).not.toHaveProperty('slackApiUrl');
  });

  it('hands WebClient the caller’s fetch and base URL', () => {
    const own = vi.fn();
    new SlackClient({ ...cfg, fetch: own, apiBaseUrl: 'https://slack.example/api/' } as SlackConfig, makeLogger());
    const [, opts] = webClientCtor.mock.calls[0]!;
    expect(opts).toMatchObject({ fetch: own, slackApiUrl: 'https://slack.example/api/' });
  });

  it('leaves the SDK’s retry policy alone unless asked', () => {
    new SlackClient(cfg, makeLogger());
    const [, opts] = webClientCtor.mock.calls[0]!;
    expect(opts).not.toHaveProperty('retryConfig');
    expect(opts).not.toHaveProperty('rejectRateLimitedCalls');
  });

  it('hands WebClient the caller’s retries and rate-limit rule, to both clients', async () => {
    connectionsOpen.mockResolvedValueOnce({ ok: true, url: 'wss://wss-primary.slack.com/link' });
    const client = new SlackClient({ ...cfg, appToken: 'xapp-test', retries: 0, rejectRateLimitedCalls: true } as SlackConfig, makeLogger());
    await client.openSocketModeUrl();
    expect(webClientCtor).toHaveBeenCalledTimes(2);
    for (const [, opts] of webClientCtor.mock.calls) {
      expect(opts).toMatchObject({ retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
    }
  });

  it('postMessage delegates to chat.postMessage', async () => {
    const logger = makeLogger();
    const client = new SlackClient(cfg, logger);
    postMessage.mockResolvedValueOnce({ ok: true });
    const res = await client.postMessage({ channel: '#x', text: 'hi' });
    expect(postMessage).toHaveBeenCalledWith({ channel: '#x', text: 'hi' });
    expect(res).toEqual({ ok: true });
  });

  it('updateMessage / deleteMessage / openView delegate to the SDK', async () => {
    const logger = makeLogger();
    const client = new SlackClient(cfg, logger);
    update.mockResolvedValueOnce({ ok: true });
    del.mockResolvedValueOnce({ ok: true });
    open.mockResolvedValueOnce({ ok: true });
    await client.updateMessage({ channel: 'C', ts: '1', text: 't' });
    await client.deleteMessage({ channel: 'C', ts: '1' });
    await client.openView({ trigger_id: 'tid', view: { type: 'modal', title: { type: 'plain_text', text: 't' }, blocks: [] } });
    expect(update).toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });
});

describe('SlackClient.postWebhook', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    webClientCtor.mockReset();
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs JSON to the configured incomingWebhookUrl', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const client = new SlackClient({ ...cfg, incomingWebhookUrl: 'https://hooks.slack.com/x' }, makeLogger());

    await client.postWebhook({ text: 'hi' });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.com/x');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: 'hi' });
  });

  it('uses the explicit URL argument when provided (e.g. response_url)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const client = new SlackClient({ ...cfg, incomingWebhookUrl: 'https://hooks.slack.com/default' }, makeLogger());

    await client.postWebhook({ text: 'follow-up' }, 'https://hooks.slack.com/response/123');

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://hooks.slack.com/response/123');
  });

  it('throws SlackError when neither config nor argument provides a URL', async () => {
    const client = new SlackClient(cfg, makeLogger());
    await expect(client.postWebhook({ text: 'hi' })).rejects.toBeInstanceOf(SlackError);
  });

  it('throws SlackError on non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const client = new SlackClient({ ...cfg, incomingWebhookUrl: 'https://hooks.slack.com/x' }, makeLogger());
    await expect(client.postWebhook({ text: 'hi' })).rejects.toBeInstanceOf(SlackError);
  });

  it('does not leak the response_url secret in the logged/error internalDetails', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const logger = makeLogger();
    const client = new SlackClient(cfg, logger);
    const responseUrl = 'https://hooks.slack.com/actions/T00000000/1234567890/AbCdEfSecretToken?foo=bar';

    const err = await client.postWebhook({ text: 'hi' }, responseUrl).catch((e: SlackError) => e);

    expect(err).toBeInstanceOf(SlackError);
    const details = (err as SlackError).internalDetails as { url: string };
    expect(details.url).not.toContain('AbCdEfSecretToken');
    expect(details.url).not.toContain('foo=bar');
    expect(details.url).toBe('https://hooks.slack.com/actions/T00000000/1234567890/***');
    const warnArgs = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.stringify(warnArgs)).not.toContain('AbCdEfSecretToken');
  });

  it('passes an AbortSignal (timeout) on the outbound webhook POST', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const client = new SlackClient({ ...cfg, incomingWebhookUrl: 'https://hooks.slack.com/x' }, makeLogger());

    await client.postWebhook({ text: 'hi' });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('SlackClient.postWebhook with a fetch of the caller’s own', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('is used instead of the global one', async () => {
    const own = vi.fn(async () => new Response('ok', { status: 200 }));
    const client = new SlackClient({ ...cfg, fetch: own, incomingWebhookUrl: 'https://hooks.slack.com/x' } as SlackConfig, makeLogger());

    await client.postWebhook({ text: 'hi' });

    expect(own).toHaveBeenCalledWith('https://hooks.slack.com/x', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws a SlackError with the URL secret redacted when the POST never reaches Slack', async () => {
    const responseUrl = 'https://hooks.slack.com/actions/T0/123/AbCdEfSecretToken';
    const own = vi.fn(async () => {
      throw new Error(`fetch failed for ${responseUrl}: ECONNREFUSED`);
    });
    const logger = makeLogger();
    const client = new SlackClient({ ...cfg, fetch: own } as SlackConfig, logger);

    const err = (await client.postWebhook({ text: 'hi' }, responseUrl).catch((e: unknown) => e)) as SlackError;

    expect(err).toBeInstanceOf(SlackError);
    expect(err.cause).toBeUndefined();
    expect(JSON.stringify(err.internalDetails)).not.toContain('AbCdEfSecretToken');
    expect(String(err.internalDetails?.reason)).toContain('ECONNREFUSED');
    expect(JSON.stringify((logger.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('AbCdEfSecretToken');
  });
});

describe('SlackClient.openSocketModeUrl', () => {
  beforeEach(() => {
    webClientCtor.mockReset();
    connectionsOpen.mockReset();
  });

  it('opens a connection with the app token and answers the URL', async () => {
    connectionsOpen.mockResolvedValueOnce({ ok: true, url: 'wss://wss.slack.com/link/?ticket=abc' });
    const own = vi.fn();
    const client = new SlackClient({ ...cfg, appToken: 'xapp-1', fetch: own } as SlackConfig, makeLogger());

    await expect(client.openSocketModeUrl()).resolves.toBe('wss://wss.slack.com/link/?ticket=abc');

    expect(webClientCtor).toHaveBeenCalledTimes(2);
    const [token, opts] = webClientCtor.mock.calls[1]!;
    expect(token).toBe('xapp-1');
    expect(opts).toMatchObject({ fetch: own });
  });

  it('builds the app-token client once, however often it is called', async () => {
    connectionsOpen.mockResolvedValue({ ok: true, url: 'wss://x' });
    const client = new SlackClient({ ...cfg, appToken: 'xapp-1' } as SlackConfig, makeLogger());

    await client.openSocketModeUrl();
    await client.openSocketModeUrl();

    expect(webClientCtor).toHaveBeenCalledTimes(2);
  });

  it('throws a SlackError when no app token is configured', async () => {
    const client = new SlackClient(cfg, makeLogger());
    await expect(client.openSocketModeUrl()).rejects.toBeInstanceOf(SlackError);
    expect(connectionsOpen).not.toHaveBeenCalled();
  });

  it('throws a SlackError carrying Slack’s error code when the call fails', async () => {
    connectionsOpen.mockRejectedValueOnce(
      Object.assign(new Error('An API error occurred: invalid_auth'), { data: { ok: false, error: 'invalid_auth' } }),
    );
    const client = new SlackClient({ ...cfg, appToken: 'xapp-1' } as SlackConfig, makeLogger());

    const err = (await client.openSocketModeUrl().catch((e: unknown) => e)) as SlackError;

    expect(err).toBeInstanceOf(SlackError);
    expect(err.internalDetails).toMatchObject({ error: 'invalid_auth' });
  });

  it('throws a SlackError when Slack answers ok:false or no URL', async () => {
    connectionsOpen.mockResolvedValueOnce({ ok: false, error: 'not_allowed_token_type' });
    const client = new SlackClient({ ...cfg, appToken: 'xapp-1' } as SlackConfig, makeLogger());

    const err = (await client.openSocketModeUrl().catch((e: unknown) => e)) as SlackError;

    expect(err).toBeInstanceOf(SlackError);
    expect(err.internalDetails).toMatchObject({ error: 'not_allowed_token_type' });
  });
});

describe('adaptLogger', () => {
  it('forwards level methods to the underlying ServerKit logger', () => {
    const logger = makeLogger();
    const slackLogger = adaptLogger(logger);
    slackLogger.debug('a', 'b');
    slackLogger.info('hello');
    slackLogger.warn();
    slackLogger.error({ err: 1 });
    expect(logger.debug).toHaveBeenCalledWith('a', 'b');
    expect(logger.info).toHaveBeenCalledWith('hello');
    expect(logger.warn).toHaveBeenCalledWith('');
    expect(logger.error).toHaveBeenCalledWith({ err: 1 });
  });

  it('round-trips setLevel / getLevel', () => {
    const logger = makeLogger();
    const slackLogger = adaptLogger(logger);
    slackLogger.setLevel('debug' as never);
    expect(slackLogger.getLevel()).toBe('debug');
  });

  it('setName is a no-op that does not throw', () => {
    const logger = makeLogger();
    const slackLogger = adaptLogger(logger);
    expect(() => slackLogger.setName('renamed')).not.toThrow();
  });
});

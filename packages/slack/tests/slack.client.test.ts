import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const webClientCtor = vi.fn();
const postMessage = vi.fn();
const update = vi.fn();
const del = vi.fn();
const open = vi.fn();

vi.mock('@slack/web-api', () => {
  function WebClient(this: unknown, token: string, options: unknown) {
    webClientCtor(token, options);
    return {
      chat: { postMessage, update, delete: del },
      views: { open },
    };
  }
  return { WebClient };
});

import { SlackClient } from '../src/client/slack.client.js';
import { adaptLogger } from '../src/client/slack.logger.adapter.js';
import { SlackError } from '../src/slack.error.js';
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

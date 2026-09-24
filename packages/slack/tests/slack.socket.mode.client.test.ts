import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SocketModeClient, type SocketModeHandlers } from '../src/client/slack.socket.mode.client.js';
import { SlackError } from '../src/slack.error.js';
import type { SocketLike } from '../src/slack.socket.js';
import { makeLogger } from './helpers.js';

/** A socket the test drives by hand: `receive` plays a frame from Slack, `drop` closes it from Slack's side. */
class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  closed?: { code?: number; reason?: string };
  private messageListener?: (text: string) => void;
  private closeListener?: (code?: number, reason?: string) => void;

  constructor(readonly url: string) {}

  send(text: string): void {
    this.sent.push(text);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.closeListener?.(code, reason);
  }
  onMessage(listener: (text: string) => void): void {
    this.messageListener = listener;
  }
  onClose(listener: (code?: number, reason?: string) => void): void {
    this.closeListener = listener;
  }

  receive(frame: unknown): void {
    this.messageListener?.(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }
  drop(code = 1006): void {
    this.closeListener?.(code, 'gone');
  }
}

/** Lets pending promise callbacks (the handler dispatch, an `open`) run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const setup = (handlers: SocketModeHandlers = {}, onError?: (error: SlackError) => void) => {
  const sockets: FakeSocket[] = [];
  let n = 0;
  const openUrl = vi.fn(async () => `wss://slack.test/link/${++n}`);
  const connect = vi.fn((url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });
  const logger = makeLogger();
  const client = new SocketModeClient({ openUrl, connect, handlers, logger, onError });
  return { client, sockets, openUrl, connect, logger };
};

const envelope = (type: string, payload: unknown, id = 'env-1') => ({ envelope_id: id, type, payload, accepts_response_payload: false });

describe('SocketModeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a fresh URL and connects to it on start, and becomes ready on hello', async () => {
    const { client, sockets, openUrl } = setup();

    await client.start();

    expect(openUrl).toHaveBeenCalledOnce();
    expect(sockets[0]!.url).toBe('wss://slack.test/link/1');
    expect(client.isReady).toBe(false);

    sockets[0]!.receive({ type: 'hello', num_connections: 1 });

    expect(client.isReady).toBe(true);
  });

  it('acks an envelope before its handler runs', async () => {
    const order: string[] = [];
    const { client, sockets } = setup({
      onSlashCommand: () => {
        order.push(`handler after ${sockets[0]!.sent.length} ack(s)`);
      },
    });
    await client.start();

    sockets[0]!.receive(envelope('slash_commands', { command: '/deploy', response_url: 'https://hooks.slack.com/x' }, 'env-9'));
    order.push('receive returned');
    await flush();

    expect(sockets[0]!.sent).toEqual([JSON.stringify({ envelope_id: 'env-9' })]);
    expect(order).toEqual(['receive returned', 'handler after 1 ack(s)']);
  });

  it('acks even when the handler never settles', async () => {
    const { client, sockets } = setup({ onEventsApi: () => new Promise(() => {}) });
    await client.start();

    sockets[0]!.receive(envelope('events_api', { type: 'event_callback' }));

    expect(sockets[0]!.sent).toHaveLength(1);
  });

  it('routes each payload type to its handler with the envelope metadata', async () => {
    const onEventsApi = vi.fn();
    const onSlashCommand = vi.fn();
    const onInteractive = vi.fn();
    const { client, sockets } = setup({ onEventsApi, onSlashCommand, onInteractive });
    await client.start();

    const event = { type: 'event_callback', event: { type: 'app_mention' }, event_id: 'Ev1', team_id: 'T1' };
    sockets[0]!.receive({ ...envelope('events_api', event, 'e1'), retry_attempt: 2, retry_reason: 'timeout' });
    sockets[0]!.receive(envelope('slash_commands', { command: '/deploy', response_url: 'https://hooks.slack.com/c' }, 'e2'));
    sockets[0]!.receive(envelope('interactive', { type: 'block_actions', response_url: 'https://hooks.slack.com/i' }, 'e3'));
    await flush();

    expect(onEventsApi).toHaveBeenCalledWith(event, { envelopeId: 'e1', retryAttempt: 2, retryReason: 'timeout' });
    expect(onSlashCommand).toHaveBeenCalledWith({ command: '/deploy', response_url: 'https://hooks.slack.com/c' }, { envelopeId: 'e2' });
    expect(onInteractive).toHaveBeenCalledWith({ type: 'block_actions', response_url: 'https://hooks.slack.com/i' }, { envelopeId: 'e3' });
    expect(sockets[0]!.sent.map(s => JSON.parse(s).envelope_id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('still acks an envelope that has no handler', async () => {
    const { client, sockets } = setup();
    await client.start();

    sockets[0]!.receive(envelope('interactive', { type: 'shortcut' }));

    expect(sockets[0]!.sent).toHaveLength(1);
  });

  it('keeps going after a handler throws or rejects', async () => {
    const onSlashCommand = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockRejectedValueOnce(new Error('async boom'))
      .mockResolvedValueOnce(undefined);
    const { client, sockets, logger } = setup({ onSlashCommand });
    await client.start();

    sockets[0]!.receive(envelope('slash_commands', {}, 'a'));
    sockets[0]!.receive(envelope('slash_commands', {}, 'b'));
    sockets[0]!.receive(envelope('slash_commands', {}, 'c'));
    await flush();

    expect(onSlashCommand).toHaveBeenCalledTimes(3);
    expect(sockets[0]!.sent).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('ignores a frame that is not JSON', async () => {
    const { client, sockets, logger } = setup();
    await client.start();

    sockets[0]!.receive('not json');

    expect(sockets[0]!.sent).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('moves to a fresh URL on refresh_requested, opening the new socket before closing the old one', async () => {
    const { client, sockets, openUrl } = setup();
    await client.start();
    sockets[0]!.receive({ type: 'hello' });

    sockets[0]!.receive({ type: 'disconnect', reason: 'refresh_requested' });
    await flush();

    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toBe('wss://slack.test/link/2');
    expect(sockets[0]!.closed).toEqual({ code: 1000, reason: 'replaced' });
    expect(sockets[1]!.closed).toBeUndefined();
    expect(client.isReady).toBe(false);

    // The old socket's own close does not trigger another reconnect.
    await vi.runAllTimersAsync();
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it('reconnects on a warning disconnect as well', async () => {
    const { client, sockets } = setup();
    await client.start();

    sockets[0]!.receive({ type: 'disconnect', reason: 'warning' });
    await flush();

    expect(sockets).toHaveLength(2);
  });

  it('stops for good and reports through onError when Slack disables the link', async () => {
    const onError = vi.fn();
    const { client, sockets, openUrl } = setup({}, onError);
    await client.start();

    sockets[0]!.receive({ type: 'disconnect', reason: 'link_disabled' });
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(SlackError);
    expect(sockets[0]!.closed?.code).toBe(1000);
    expect(openUrl).toHaveBeenCalledOnce();
  });

  it('reconnects with doubling backoff after an unexpected close', async () => {
    const { client, sockets, openUrl } = setup();
    await client.start();

    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(openUrl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(openUrl).toHaveBeenCalledTimes(2);

    sockets[1]!.drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(openUrl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(openUrl).toHaveBeenCalledTimes(3);

    // hello resets the backoff.
    sockets[2]!.receive({ type: 'hello' });
    sockets[2]!.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(openUrl).toHaveBeenCalledTimes(4);
  });

  it('keeps backing off when a reconnect itself fails', async () => {
    const { client, sockets, openUrl } = setup();
    await client.start();
    openUrl.mockRejectedValueOnce(new Error('network down'));

    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(openUrl).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(openUrl).toHaveBeenCalledTimes(3);
    expect(sockets).toHaveLength(2);
  });

  it('never reconnects after stop, even when the close arrives later', async () => {
    const { client, sockets, openUrl } = setup();
    await client.start();

    client.stop();
    sockets[0]!.drop();
    await vi.runAllTimersAsync();

    expect(sockets[0]!.closed?.code).toBe(1000);
    expect(openUrl).toHaveBeenCalledOnce();
    expect(client.isReady).toBe(false);
  });

  it('cancels a pending reconnect on stop', async () => {
    const { client, sockets, openUrl } = setup();
    await client.start();

    sockets[0]!.drop();
    client.stop();
    await vi.runAllTimersAsync();

    expect(openUrl).toHaveBeenCalledOnce();
  });

  it('rejects start when the first URL cannot be opened, and can start again', async () => {
    const { client, openUrl } = setup();
    openUrl.mockRejectedValueOnce(new SlackError('no appToken'));

    await expect(client.start()).rejects.toBeInstanceOf(SlackError);
    await expect(client.start()).resolves.toBeUndefined();
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it('accepts a connect that answers with a promise', async () => {
    const socket = new FakeSocket('wss://x');
    const client = new SocketModeClient({
      openUrl: async () => 'wss://x',
      connect: async () => socket,
      handlers: {},
      logger: makeLogger(),
    });

    await client.start();
    socket.receive({ type: 'hello' });

    expect(client.isReady).toBe(true);
  });
});

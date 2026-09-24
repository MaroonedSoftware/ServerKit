import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayClient, GatewayOpcode } from '../src/gateway/discord.gateway.client.js';
import { Intents } from '../src/gateway/discord.gateway.intents.js';
import { DiscordError } from '../src/discord.error.js';
import type { SocketLike } from '../src/discord.socket.js';
import { makeLogger } from './helpers.js';

/** A socket the test drives by hand: `receive` plays a frame from Discord, `drop` closes it from Discord's side. */
class FakeSocket implements SocketLike {
  readonly sent: Array<{ op: number; d: unknown }> = [];
  closed?: { code?: number; reason?: string };
  private messageListener?: (text: string) => void;
  private closeListener?: (code?: number, reason?: string) => void;

  constructor(readonly url: string) {}

  send(text: string): void {
    this.sent.push(JSON.parse(text) as { op: number; d: unknown });
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
    this.messageListener?.(JSON.stringify(frame));
  }
  drop(code: number): void {
    this.closeListener?.(code, 'gone');
  }
  ops(): number[] {
    return this.sent.map(f => f.op);
  }
}

const INTERVAL = 40_000;
const TOKEN = 'bot-secret-token';

const setup = (overrides: { random?: () => number } = {}) => {
  const sockets: FakeSocket[] = [];
  const gatewayUrl = vi.fn(async () => 'wss://gateway.discord.gg');
  const connect = vi.fn((url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });
  const onDispatch = vi.fn();
  const onError = vi.fn();
  const logger = makeLogger();
  const client = new GatewayClient({
    token: TOKEN,
    intents: Intents.GUILDS | Intents.GUILD_MESSAGES,
    gatewayUrl,
    connect,
    onDispatch,
    onError,
    logger,
    random: overrides.random ?? (() => 0.5),
  });
  const last = () => sockets[sockets.length - 1]!;
  return { client, sockets, last, gatewayUrl, connect, onDispatch, onError, logger };
};

const hello = { op: GatewayOpcode.HELLO, d: { heartbeat_interval: INTERVAL } };
const ready = (s = 1) => ({
  op: GatewayOpcode.DISPATCH,
  s,
  t: 'READY',
  d: { session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.gg', user: { id: 'bot-1', username: 'station' } },
});

/** Starts a client and brings it to READY with sequence 1. */
const connected = async (overrides: { random?: () => number } = {}) => {
  const ctx = setup(overrides);
  await ctx.client.start();
  ctx.last().receive(hello);
  ctx.last().receive(ready());
  return ctx;
};

describe('GatewayClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects with the version and encoding query, then identifies on Hello', async () => {
    const { client, sockets } = setup();
    await client.start();

    expect(sockets[0]!.url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    expect(sockets[0]!.sent).toEqual([]);

    sockets[0]!.receive(hello);

    expect(sockets[0]!.sent).toEqual([
      {
        op: GatewayOpcode.IDENTIFY,
        d: { token: TOKEN, intents: (1 << 0) | (1 << 9), properties: expect.objectContaining({ browser: 'serverkit' }) },
      },
    ]);
  });

  it('captures READY, becomes ready, and hands every dispatch to onDispatch', async () => {
    const { client, last, onDispatch } = await connected();
    last().receive({ op: GatewayOpcode.DISPATCH, s: 2, t: 'MESSAGE_CREATE', d: { content: 'hi' } });
    await vi.advanceTimersByTimeAsync(0);

    expect(client.isReady).toBe(true);
    expect(client.user).toEqual({ id: 'bot-1', username: 'station' });
    expect(onDispatch).toHaveBeenCalledWith('READY', expect.objectContaining({ session_id: 'sess-1' }));
    expect(onDispatch).toHaveBeenCalledWith('MESSAGE_CREATE', { content: 'hi' });
  });

  it('keeps going after a dispatch handler throws', async () => {
    const { last, onDispatch, logger } = await connected();
    onDispatch.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    last().receive({ op: GatewayOpcode.DISPATCH, s: 2, t: 'MESSAGE_CREATE', d: {} });
    last().receive({ op: GatewayOpcode.DISPATCH, s: 3, t: 'MESSAGE_CREATE', d: {} });
    await vi.advanceTimersByTimeAsync(0);

    // READY, then both messages: the first handler call threw and the second still ran.
    expect(onDispatch).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalled();
  });

  it('jitters the first heartbeat, then beats on the interval with the last sequence', async () => {
    const { last } = await connected({ random: () => 0.25 });
    const heartbeats = () => last().sent.filter(f => f.op === GatewayOpcode.HEARTBEAT);

    await vi.advanceTimersByTimeAsync(INTERVAL * 0.25 - 1);
    expect(heartbeats()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeats()).toEqual([{ op: GatewayOpcode.HEARTBEAT, d: 1 }]);

    last().receive({ op: GatewayOpcode.HEARTBEAT_ACK });
    last().receive({ op: GatewayOpcode.DISPATCH, s: 7, t: 'TYPING_START', d: {} });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(heartbeats()).toEqual([
      { op: GatewayOpcode.HEARTBEAT, d: 1 },
      { op: GatewayOpcode.HEARTBEAT, d: 7 },
    ]);
  });

  it('answers a heartbeat request from Discord at once', async () => {
    const { last } = await connected();

    last().receive({ op: GatewayOpcode.HEARTBEAT });

    expect(last().ops()).toContain(GatewayOpcode.HEARTBEAT);
  });

  it('treats a missed ACK as a zombie: closes resumably and resumes on resume_gateway_url', async () => {
    const { sockets, last, gatewayUrl } = await connected();

    await vi.advanceTimersByTimeAsync(INTERVAL / 2); // first beat, never acked
    await vi.advanceTimersByTimeAsync(INTERVAL); // second beat finds it un-acked
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets[0]!.closed?.code).toBe(4000);
    expect(sockets).toHaveLength(2);
    expect(last().url).toBe('wss://resume.discord.gg/?v=10&encoding=json');
    expect(gatewayUrl).toHaveBeenCalledOnce();

    last().receive(hello);
    expect(last().sent[0]).toEqual({ op: GatewayOpcode.RESUME, d: { token: TOKEN, session_id: 'sess-1', seq: 1 } });
  });

  it('resumes on Reconnect (op 7)', async () => {
    const { sockets, last } = await connected();

    last().receive({ op: GatewayOpcode.RECONNECT });
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets[0]!.closed?.code).toBe(4000);
    expect(last().url).toBe('wss://resume.discord.gg/?v=10&encoding=json');
    last().receive(hello);
    expect(last().sent[0]!.op).toBe(GatewayOpcode.RESUME);
  });

  it('resumes on a resumable Invalid Session (op 9, d: true)', async () => {
    const { sockets, last } = await connected();

    last().receive({ op: GatewayOpcode.INVALID_SESSION, d: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(sockets).toHaveLength(2);
    last().receive(hello);
    expect(last().sent[0]!.op).toBe(GatewayOpcode.RESUME);
  });

  it('identifies afresh, after 1–5 seconds, on a non-resumable Invalid Session (op 9, d: false)', async () => {
    const { sockets, last, gatewayUrl } = await connected({ random: () => 0.5 });

    last().receive({ op: GatewayOpcode.INVALID_SESSION, d: false });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(sockets).toHaveLength(2);
    expect(gatewayUrl).toHaveBeenCalledTimes(2);
    expect(last().url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    last().receive(hello);
    expect(last().sent[0]!.op).toBe(GatewayOpcode.IDENTIFY);
  });

  it('stops and reports a disallowed-intents close (4014) without reconnecting', async () => {
    const { client, sockets, last, onError } = await connected();

    last().drop(4014);
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledOnce();
    const error = onError.mock.calls[0]![0] as DiscordError;
    expect(error).toBeInstanceOf(DiscordError);
    expect(error.message).toContain('disallowed intents');
    expect(error.internalDetails).toMatchObject({ code: 4014 });
    expect(sockets).toHaveLength(1);
    expect(client.isReady).toBe(false);
  });

  it.each([4004, 4010, 4011, 4012, 4013])('treats close code %i as fatal', async code => {
    const { sockets, last, onError } = await connected();

    last().drop(code);
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
  });

  it('resumes with backoff after a non-fatal close', async () => {
    const { sockets, last } = await connected();

    last().drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(sockets).toHaveLength(2);
    last().receive(hello);
    expect(last().sent[0]!.op).toBe(GatewayOpcode.RESUME);

    // A second close without READY/RESUMED in between waits longer.
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
  });

  it('identifies afresh after a close that ends the session (4009)', async () => {
    const { last } = await connected();

    last().drop(4009);
    await vi.advanceTimersByTimeAsync(1_000);
    last().receive(hello);

    expect(last().url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
    expect(last().sent[0]!.op).toBe(GatewayOpcode.IDENTIFY);
  });

  it('stops for good: closes with 1000, stops heartbeating, and never reconnects', async () => {
    const { client, sockets, last } = await connected();
    const sentBefore = last().sent.length;

    client.stop();
    sockets[0]!.drop(1006);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(sockets[0]!.closed?.code).toBe(1000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent).toHaveLength(sentBefore);
    expect(client.isReady).toBe(false);
  });

  it('rejects start when the first connection fails', async () => {
    const { client, gatewayUrl } = setup();
    gatewayUrl.mockRejectedValueOnce(new Error('403'));

    await expect(client.start()).rejects.toThrow('403');
    await expect(client.start()).resolves.toBeUndefined();
  });

  it('never logs the token', async () => {
    const { last, logger } = await connected();
    last().drop(4004);
    await vi.runAllTimersAsync();

    const everything = JSON.stringify(Object.values(logger).map(fn => (fn as ReturnType<typeof vi.fn>).mock.calls));
    expect(everything).not.toContain(TOKEN);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter, normalizeCommandName } from '../src/comms.router.js';
import { makeLogger, makeRecordingReply, event } from './helpers.js';

describe('normalizeCommandName', () => {
  it('strips a leading slash and lowercases', () => {
    expect(normalizeCommandName('/Deploy')).toBe('deploy');
    expect(normalizeCommandName('HELP')).toBe('help');
  });
});

describe('ChannelRouter.dispatch', () => {
  it('routes a command by normalized name', async () => {
    const router = new ChannelRouter(makeLogger());
    const handler = vi.fn();
    router.command('/Deploy', handler);

    const { reply } = makeRecordingReply();
    await router.dispatch(event({ kind: 'command', command: { name: 'deploy', args: 'staging' } }), reply);

    expect(handler).toHaveBeenCalledOnce();
    const [ev, passedReply] = handler.mock.calls[0]!;
    expect(ev.command.args).toBe('staging');
    expect(passedReply).toBe(reply);
  });

  it('routes an action by id', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.action('deploy:confirm', handler);

    await router.dispatch(event({ kind: 'action', action: { id: 'deploy:confirm', value: 'go' } }), makeRecordingReply().reply);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('routes a message to the single message handler', async () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.message(handler);

    await router.dispatch(event({ kind: 'message', text: 'hello' }), makeRecordingReply().reply);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('uses the fallback when a command has no specific handler', async () => {
    const router = new ChannelRouter();
    const fallback = vi.fn();
    router.fallback(fallback);

    await router.dispatch(event({ kind: 'command', command: { name: 'unknown', args: '' } }), makeRecordingReply().reply);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('logs at debug and does nothing when nothing matches', async () => {
    const logger = makeLogger();
    const router = new ChannelRouter(logger);
    await router.dispatch(event({ kind: 'message', text: 'hi' }), makeRecordingReply().reply);
    expect(logger.debug).toHaveBeenCalled();
  });

  it('supports method chaining', () => {
    const router = new ChannelRouter();
    expect(router.command('a', vi.fn()).action('b', vi.fn()).message(vi.fn())).toBe(router);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { SlackEventHandlerMap, SlackCommandHandlerMap, SlackInteractionHandlerMap, SlackDispatcher } from '../src/slack.dispatcher.js';
import type { Logger } from '@maroonedsoftware/logger';

const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

const makeDispatcher = () => {
  const events = new SlackEventHandlerMap();
  const commands = new SlackCommandHandlerMap();
  const interactions = new SlackInteractionHandlerMap();
  const logger = makeLogger();
  return { dispatcher: new SlackDispatcher(events, commands, interactions, logger), events, commands, interactions, logger };
};

describe('SlackDispatcher.dispatchEvent', () => {
  it('returns the challenge for url_verification', async () => {
    const { dispatcher } = makeDispatcher();
    const result = await dispatcher.dispatchEvent({ type: 'url_verification', challenge: 'abc123' });
    expect(result).toEqual({ challenge: 'abc123' });
  });

  it('routes event_callback to the registered handler', async () => {
    const { dispatcher, events } = makeDispatcher();
    const handler = { handle: vi.fn() };
    events.set('app_mention', handler);

    const envelope = {
      type: 'event_callback' as const,
      team_id: 'T1',
      api_app_id: 'A1',
      event_id: 'Ev1',
      event_time: 123,
      event: { type: 'app_mention', user: 'U1', text: 'hi' },
    };
    const result = await dispatcher.dispatchEvent(envelope);

    expect(result).toBeUndefined();
    expect(handler.handle).toHaveBeenCalledOnce();
    const [event, ctx] = handler.handle.mock.calls[0]!;
    expect(event.type).toBe('app_mention');
    expect(ctx).toMatchObject({ teamId: 'T1', eventId: 'Ev1', eventTime: 123 });
    expect(ctx.envelope).toBe(envelope);
  });

  it('logs and returns undefined for unregistered event types', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchEvent({
      type: 'event_callback',
      team_id: 'T1',
      api_app_id: 'A1',
      event_id: 'Ev1',
      event_time: 123,
      event: { type: 'reaction_added' },
    });
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('logs and returns undefined for unknown top-level types', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchEvent({ type: 'something_new' });
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe('SlackDispatcher.dispatchCommand', () => {
  const basePayload = {
    token: 't',
    team_id: 'T1',
    team_domain: 'd',
    channel_id: 'C',
    channel_name: 'general',
    user_id: 'U',
    user_name: 'alice',
    command: '/deploy',
    text: 'staging',
    response_url: 'https://hooks',
    trigger_id: 'tid',
  };

  it('forwards a registered command handler response', async () => {
    const { dispatcher, commands } = makeDispatcher();
    commands.set('/deploy', { handle: vi.fn().mockResolvedValue({ text: 'ok' }) });
    const result = await dispatcher.dispatchCommand(basePayload);
    expect(result).toEqual({ text: 'ok' });
  });

  it('returns undefined for an unregistered command', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchCommand(basePayload);
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('returns undefined when the handler returns void', async () => {
    const { dispatcher, commands } = makeDispatcher();
    commands.set('/deploy', { handle: vi.fn().mockResolvedValue(undefined) });
    expect(await dispatcher.dispatchCommand(basePayload)).toBeUndefined();
  });
});

describe('SlackDispatcher.dispatchInteraction', () => {
  it('routes block_actions by first action_id', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    const handler = { handle: vi.fn().mockResolvedValue(undefined) };
    interactions.set('block_actions:approve', handler);
    await dispatcher.dispatchInteraction({ type: 'block_actions', actions: [{ action_id: 'approve', value: 'go' }] });
    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('routes view_submission and forwards a response_action error payload', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    interactions.set('view_submission:ticket', { handle: vi.fn().mockResolvedValue({ response_action: 'errors', errors: { name: 'Required' } }) });
    const result = await dispatcher.dispatchInteraction({ type: 'view_submission', view: { id: 'V1', callback_id: 'ticket' } });
    expect(result).toEqual({ response_action: 'errors', errors: { name: 'Required' } });
  });

  it('routes shortcut by callback_id', async () => {
    const { dispatcher, interactions } = makeDispatcher();
    const handler = { handle: vi.fn() };
    interactions.set('shortcut:open_dialog', handler);
    await dispatcher.dispatchInteraction({ type: 'shortcut', callback_id: 'open_dialog' });
    expect(handler.handle).toHaveBeenCalledOnce();
  });

  it('returns undefined when no routing key can be derived', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchInteraction({ type: 'block_actions' });
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('returns undefined when no handler is registered for the key', async () => {
    const { dispatcher, logger } = makeDispatcher();
    const result = await dispatcher.dispatchInteraction({ type: 'shortcut', callback_id: 'unknown' });
    expect(result).toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });
});

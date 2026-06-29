import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { IncomingEvent } from './comms.event.js';
import type { Reply } from './comms.reply.js';
import { TemplateRegistry } from './comms.template.js';

/** A channel-agnostic handler invoked with the normalized event and a bound {@link Reply}. */
export type CommsHandler = (event: IncomingEvent, reply: Reply) => Promise<void> | void;

/** Normalizes a command name to its registry key: no leading slash, lowercased. */
export const normalizeCommandName = (name: string): string => name.replace(/^\//, '').toLowerCase();

/**
 * The channel-agnostic router. Register `command` / `action` / `message`
 * handlers (and an optional `fallback`) once; each channel's `./comms` adapter
 * normalizes its inbound payload into an {@link IncomingEvent} and calls
 * {@link dispatch}, which routes to the matching handler.
 *
 * Holds a {@link TemplateRegistry} (`router.templates`) the adapters read when a
 * handler calls `reply.sendTemplate(...)`.
 *
 * @example
 * ```ts
 * const router = new ChannelRouter();
 * router.command('deploy', async (event, reply) => reply.send({ text: `Deploying ${event.command!.args}` }));
 * router.action('deploy:confirm', async (event, reply) => reply.send({ text: 'Confirmed' }));
 * ```
 */
@Injectable()
export class ChannelRouter {
  /** Outbound template registry shared with the channel adapters. */
  readonly templates = new TemplateRegistry();

  private readonly commands = new Map<string, CommsHandler>();
  private readonly actions = new Map<string, CommsHandler>();
  private messageHandler?: CommsHandler;
  private fallbackHandler?: CommsHandler;

  constructor(private readonly logger?: Logger) {}

  /** Register a handler for a command (with or without a leading slash; name is normalized). */
  command(name: string, handler: CommsHandler): this {
    this.commands.set(normalizeCommandName(name), handler);
    return this;
  }

  /** Register a handler for a button/component action id. */
  action(id: string, handler: CommsHandler): this {
    this.actions.set(id, handler);
    return this;
  }

  /** Register the single catch-all message handler (free-text, non-command messages). */
  message(handler: CommsHandler): this {
    this.messageHandler = handler;
    return this;
  }

  /** Register a fallback handler invoked when nothing else matches. */
  fallback(handler: CommsHandler): this {
    this.fallbackHandler = handler;
    return this;
  }

  /**
   * Route a normalized event to its handler: `command` → by name, `action` → by
   * id, `message` → the message handler. Falls back to the registered fallback
   * (or logs at debug and returns) when nothing matches.
   */
  async dispatch(event: IncomingEvent, reply: Reply): Promise<void> {
    const handler = this.resolve(event);
    if (!handler) {
      this.logger?.debug('No comms handler for event', { channel: event.channel, kind: event.kind });
      return;
    }
    await handler(event, reply);
  }

  private resolve(event: IncomingEvent): CommsHandler | undefined {
    if (event.kind === 'command' && event.command) {
      return this.commands.get(normalizeCommandName(event.command.name)) ?? this.fallbackHandler;
    }
    if (event.kind === 'action' && event.action) {
      return this.actions.get(event.action.id) ?? this.fallbackHandler;
    }
    if (event.kind === 'message') {
      return this.messageHandler ?? this.fallbackHandler;
    }
    return this.fallbackHandler;
  }
}

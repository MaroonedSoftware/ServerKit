/**
 * `@maroonedsoftware/discord/comms` — adapter binding the Discord package to the
 * channel-agnostic `@maroonedsoftware/comms` router. Importing this subpath pulls
 * in `@maroonedsoftware/comms` (an optional peer); the discord core does not.
 */
import { CommsError, type ChannelRouter, type IncomingEvent, type Notifier, type OutgoingMessage, type Reply, type TemplateRegistry } from '@maroonedsoftware/comms';
import { DiscordClient } from './client/discord.client.js';
import { InteractionType, InteractionCallbackType, type DiscordInteraction, type DiscordInteractionResponse } from './discord.interaction.handler.js';

type DiscordData = Record<string, unknown>;

/** Renders a portable message to a Discord message `data` body (`content` + component rows). */
const render = (message: OutgoingMessage): DiscordData => {
  const data: DiscordData = { content: message.text };
  if (message.buttons?.length) {
    const rows: unknown[] = [];
    for (let i = 0; i < message.buttons.length; i += 5) {
      rows.push({
        type: 1,
        components: message.buttons.slice(i, i + 5).map(b => ({ type: 2, style: 1, custom_id: b.id, label: b.label })),
      });
    }
    data.components = rows;
  }
  return data;
};

const resolveData = (templates: TemplateRegistry, name: string, data: unknown): DiscordData => {
  const resolved = templates.render(name, 'discord', data);
  if (!resolved) throw new CommsError(`No comms template registered for "${name}"`).withInternalDetails({ channel: 'discord', name });
  return resolved.kind === 'native' ? (resolved.payload as DiscordData) : render(resolved.message);
};

/**
 * Builds a {@link Notifier} for **proactive** Discord sends (outside an
 * interaction) — `send(channelId, message)` posts via `createMessage`. Inside an
 * interaction, {@link dispatchDiscord} builds a stateful reply instead (first
 * send → interaction callback, later → followups).
 */
export const createDiscordNotifier = (client: DiscordClient, templates: TemplateRegistry): Notifier => ({
  channel: 'discord',
  send: async (to, message) => void (await client.createMessage(to, render(message))),
  sendTemplate: async (to, name, data) => void (await client.createMessage(to, resolveData(templates, name, data))),
  sendNative: async (to, payload) => void (await client.createMessage(to, payload as DiscordData)),
});

/**
 * Reply bound to one interaction: the first `send`/`sendTemplate`/`sendNative`
 * becomes the interaction callback returned by {@link dispatchDiscord}; later
 * sends post followups via `createFollowupMessage`. `getCallback()` exposes the
 * captured first response.
 */
const interactionReply = (client: DiscordClient, templates: TemplateRegistry, interaction: DiscordInteraction): Reply & { getCallback(): DiscordInteractionResponse | undefined } => {
  let callback: DiscordInteractionResponse | undefined;
  const deliver = async (data: DiscordData) => {
    if (callback === undefined) callback = { type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data };
    else await client.createFollowupMessage(interaction.token, data);
  };
  return {
    channel: 'discord',
    send: message => deliver(render(message)),
    sendTemplate: (name, data) => deliver(resolveData(templates, name, data)),
    sendNative: payload => deliver(payload as DiscordData),
    getCallback: () => callback,
  };
};

const invokingUser = (interaction: DiscordInteraction): { id: string; username?: string } => {
  const u = interaction.member?.user ?? interaction.user;
  return { id: u?.id ?? '', username: u?.username };
};

/**
 * Dispatches a parsed Discord interaction to the {@link ChannelRouter}.
 *
 * - `PING` → `{ type: PONG }`.
 * - `APPLICATION_COMMAND` → a `command` event (string option values joined into `args`).
 * - `MESSAGE_COMPONENT` → an `action` event keyed by `custom_id`.
 *
 * Returns the interaction callback the route serializes (the handler's first
 * reply), or `undefined` if nothing matched or the handler did not reply — on
 * Discord a matched handler is expected to reply.
 */
export const dispatchDiscord = async (router: ChannelRouter, client: DiscordClient, interaction: DiscordInteraction): Promise<DiscordInteractionResponse | undefined> => {
  if (interaction.type === InteractionType.PING) return { type: InteractionCallbackType.PONG };

  const conversationId = interaction.channel_id ?? interaction.guild_id ?? '';
  let event: IncomingEvent | undefined;

  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name) {
    const options = (interaction.data.options as Array<{ value?: unknown }> | undefined) ?? [];
    const args = options
      .filter(o => o.value !== undefined)
      .map(o => String(o.value))
      .join(' ');
    event = { channel: 'discord', kind: 'command', user: invokingUser(interaction), conversation: { id: conversationId }, command: { name: interaction.data.name, args }, raw: interaction };
  } else if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id) {
    const value = (interaction.data.values as string[] | undefined)?.[0];
    event = { channel: 'discord', kind: 'action', user: invokingUser(interaction), conversation: { id: conversationId }, action: { id: interaction.data.custom_id, value }, raw: interaction };
  }

  if (!event) return undefined;

  const reply = interactionReply(client, router.templates, interaction);
  await router.dispatch(event, reply);
  return reply.getCallback();
};

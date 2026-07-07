import { describe, it, expect } from 'vitest';
import { interactionRouteKey, discordInteractionIdempotencyKey, InteractionType, type DiscordInteraction } from '../src/discord.interaction.handler.js';

const base = { id: 'i1', token: 'tok', application_id: 'app1' };

describe('discordInteractionIdempotencyKey', () => {
  it('derives discord:interaction:{id} from the interaction id', () => {
    expect(discordInteractionIdempotencyKey({ ...base, type: InteractionType.APPLICATION_COMMAND })).toBe('discord:interaction:i1');
  });

  it('keys purely on interaction.id (independent of type or data)', () => {
    expect(discordInteractionIdempotencyKey({ id: 'snowflake-42' })).toBe('discord:interaction:snowflake-42');
  });
});

describe('interactionRouteKey', () => {
  it('routes APPLICATION_COMMAND by data.name', () => {
    const interaction: DiscordInteraction = { ...base, type: InteractionType.APPLICATION_COMMAND, data: { name: 'deploy' } };
    expect(interactionRouteKey(interaction)).toBe('command:deploy');
  });

  it('routes MESSAGE_COMPONENT by data.custom_id', () => {
    const interaction: DiscordInteraction = { ...base, type: InteractionType.MESSAGE_COMPONENT, data: { custom_id: 'approve' } };
    expect(interactionRouteKey(interaction)).toBe('component:approve');
  });

  it('routes APPLICATION_COMMAND_AUTOCOMPLETE by data.name', () => {
    const interaction: DiscordInteraction = { ...base, type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE, data: { name: 'search' } };
    expect(interactionRouteKey(interaction)).toBe('autocomplete:search');
  });

  it('routes MODAL_SUBMIT by data.custom_id', () => {
    const interaction: DiscordInteraction = { ...base, type: InteractionType.MODAL_SUBMIT, data: { custom_id: 'create_ticket' } };
    expect(interactionRouteKey(interaction)).toBe('modal:create_ticket');
  });

  it('returns undefined for PING (handled by the dispatcher, never routed)', () => {
    expect(interactionRouteKey({ ...base, type: InteractionType.PING })).toBeUndefined();
  });

  it('returns undefined when a command is missing its name', () => {
    expect(interactionRouteKey({ ...base, type: InteractionType.APPLICATION_COMMAND, data: {} })).toBeUndefined();
  });

  it('returns undefined when a component is missing its custom_id', () => {
    expect(interactionRouteKey({ ...base, type: InteractionType.MESSAGE_COMPONENT, data: {} })).toBeUndefined();
  });

  it('returns undefined for an unknown interaction type', () => {
    expect(interactionRouteKey({ ...base, type: 99 })).toBeUndefined();
  });
});

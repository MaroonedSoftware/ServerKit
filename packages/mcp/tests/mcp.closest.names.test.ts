import { describe, it, expect } from 'vitest';
import { closestMcpNames, unknownMcpToolMessage, MCP_CLOSEST_NAMES_LIMIT } from '../src/mcp.closest.names.js';

const names = ['list_channels', 'read_channel', 'send_message', 'search_messages', 'get_user', 'create_ticket'];

describe('closestMcpNames', () => {
  it('ranks a name a few edits away first', () => {
    expect(closestMcpNames('read_chanel', names)[0]).toBe('read_channel');
  });

  it('finds names sharing an underscore-separated word', () => {
    expect(closestMcpNames('read_channels', names)).toEqual(['read_channel', 'list_channels']);
  });

  it('ranks by distance less two per shared word, then alphabetically', () => {
    expect(closestMcpNames('send_messages', names)).toEqual(['send_message', 'search_messages']);
  });

  it('ignores case', () => {
    expect(closestMcpNames('GET_USER', names)).toEqual(['get_user']);
  });

  it('returns nothing when no name is near', () => {
    expect(closestMcpNames('weather', names)).toEqual([]);
  });

  it(`returns at most ${MCP_CLOSEST_NAMES_LIMIT} names by default`, () => {
    const many = ['user_a', 'user_b', 'user_c', 'user_d', 'user_e'];
    expect(closestMcpNames('user', many)).toHaveLength(MCP_CLOSEST_NAMES_LIMIT);
    expect(closestMcpNames('user', many, 1)).toEqual(['user_a']);
  });

  it('allows two edits on a short name', () => {
    expect(closestMcpNames('hlp', ['help', 'ping'])).toEqual(['help']);
  });
});

describe('unknownMcpToolMessage', () => {
  it('names the tool and the closest ones', () => {
    expect(unknownMcpToolMessage('list_channel', names)).toBe(
      'No tool named "list_channel". The closest: list_channels, read_channel. Call one of those instead.',
    );
  });

  it('points at the tool list when nothing is near', () => {
    expect(unknownMcpToolMessage('weather', names)).toBe('No tool named "weather". List the tools to see which ones there are.');
  });
});

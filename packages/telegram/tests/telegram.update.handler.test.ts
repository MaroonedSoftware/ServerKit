import { describe, it, expect } from 'vitest';
import { parseCommand, updateType, type TelegramMessage, type TelegramUpdate } from '../src/telegram.update.handler.js';

const msg = (text: string): TelegramMessage => ({ message_id: 1, chat: { id: 10, type: 'private' }, date: 1, text });

describe('parseCommand', () => {
  it('parses a bare command', () => {
    expect(parseCommand(msg('/start'))).toMatchObject({ name: '/start', args: '' });
  });

  it('parses a command with arguments', () => {
    expect(parseCommand(msg('/deploy staging now'))).toMatchObject({ name: '/deploy', args: 'staging now' });
  });

  it('strips an @botname suffix and lowercases the name', () => {
    expect(parseCommand(msg('/Start@MyBot foo'))).toMatchObject({ name: '/start', args: 'foo' });
  });

  it('parses a command from a caption when there is no text', () => {
    const message: TelegramMessage = { message_id: 1, chat: { id: 10, type: 'private' }, date: 1, caption: '/photo caption args' };
    expect(parseCommand(message)).toMatchObject({ name: '/photo', args: 'caption args' });
  });

  it('returns undefined for non-command text', () => {
    expect(parseCommand(msg('hello there'))).toBeUndefined();
  });

  it('returns undefined for a lone slash', () => {
    expect(parseCommand(msg('/'))).toBeUndefined();
  });

  it('returns undefined when there is no text or caption', () => {
    expect(parseCommand({ message_id: 1, chat: { id: 10, type: 'private' }, date: 1 })).toBeUndefined();
  });
});

describe('updateType', () => {
  it('identifies a message update', () => {
    expect(updateType({ update_id: 1, message: msg('hi') })).toBe('message');
  });

  it('identifies a callback_query update', () => {
    expect(updateType({ update_id: 1, callback_query: { id: 'q', from: { id: 1 }, data: 'x' } })).toBe('callback_query');
  });

  it('identifies an edited_message update', () => {
    expect(updateType({ update_id: 1, edited_message: msg('edited') })).toBe('edited_message');
  });

  it('returns undefined for an update with no recognised content', () => {
    expect(updateType({ update_id: 1 } as TelegramUpdate)).toBeUndefined();
  });
});

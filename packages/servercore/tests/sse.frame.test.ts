import { describe, it, expect } from 'vitest';
import { frameComment, frameEvent } from '../src/sse/sse.frame.js';

describe('frameEvent', () => {
  it('emits id, event, and JSON data lines in wire order', () => {
    expect(frameEvent({ id: 7, event: 'feed', data: { message: 'hi' } })).toBe('id: 7\nevent: feed\ndata: {"message":"hi"}\n\n');
  });

  it('omits every field that was not supplied', () => {
    expect(frameEvent({ data: { a: 1 } })).toBe('data: {"a":1}\n\n');
    expect(frameEvent({})).toBe('\n');
  });

  it('includes a retry line when given', () => {
    expect(frameEvent({ retry: 5000, data: 'x' })).toBe('retry: 5000\ndata: x\n\n');
  });

  it('sends a string payload verbatim, splitting it across data lines', () => {
    expect(frameEvent({ data: 'one\ntwo' })).toBe('data: one\ndata: two\n\n');
  });
});

describe('frameComment', () => {
  it('formats a comment line', () => {
    expect(frameComment('ping')).toBe(': ping\n\n');
  });
});

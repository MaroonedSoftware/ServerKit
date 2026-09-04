import { describe, it, expect } from 'vitest';
import { stripRawAuthorizationHeader } from '../src/authentication/raw.authorization.header.js';

describe('stripRawAuthorizationHeader', () => {
  it('removes the name and its value, leaving the rest in order', () => {
    const rawHeaders = ['Host', 'example.com', 'Authorization', 'Bearer secret', 'Accept', '*/*'];

    stripRawAuthorizationHeader(rawHeaders);

    expect(rawHeaders).toEqual(['Host', 'example.com', 'Accept', '*/*']);
  });

  it('matches the header name case-insensitively, as Node preserves the sent casing', () => {
    const rawHeaders = ['authorization', 'Bearer secret'];

    stripRawAuthorizationHeader(rawHeaders);

    expect(rawHeaders).toEqual([]);
  });

  it('removes every occurrence when the header is duplicated', () => {
    const rawHeaders = ['Authorization', 'Bearer one', 'Host', 'example.com', 'authorization', 'Bearer two'];

    stripRawAuthorizationHeader(rawHeaders);

    expect(rawHeaders).toEqual(['Host', 'example.com']);
  });

  it('removes adjacent occurrences, so a splice does not skip the pair shifted into place', () => {
    const rawHeaders = ['Authorization', 'Bearer one', 'Authorization', 'Bearer two', 'Host', 'example.com'];

    stripRawAuthorizationHeader(rawHeaders);

    expect(rawHeaders).toEqual(['Host', 'example.com']);
  });

  it('leaves a header whose value is "authorization" alone', () => {
    // Only even indices are names. A value that happens to read like the header
    // name must not be mistaken for one.
    const rawHeaders = ['X-Requested-Header', 'authorization', 'Host', 'example.com'];

    stripRawAuthorizationHeader(rawHeaders);

    expect(rawHeaders).toEqual(['X-Requested-Header', 'authorization', 'Host', 'example.com']);
  });

  it('leaves an array with no Authorization untouched', () => {
    const rawHeaders = ['Host', 'example.com'];

    stripRawAuthorizationHeader(rawHeaders);

    expect(rawHeaders).toEqual(['Host', 'example.com']);
  });

  it('handles an empty array', () => {
    const rawHeaders: string[] = [];

    expect(() => stripRawAuthorizationHeader(rawHeaders)).not.toThrow();
    expect(rawHeaders).toEqual([]);
  });

  it('mutates in place, so a reference taken beforehand sees the removal', () => {
    const rawHeaders = ['Authorization', 'Bearer secret', 'Host', 'example.com'];
    const alias = rawHeaders;

    stripRawAuthorizationHeader(rawHeaders);

    expect(alias).toEqual(['Host', 'example.com']);
  });

  it('does not hang or throw on a malformed odd-length array', () => {
    // Node's parser never produces one, but the loop must still terminate.
    const rawHeaders = ['Host', 'example.com', 'Authorization'];

    expect(() => stripRawAuthorizationHeader(rawHeaders)).not.toThrow();
    expect(rawHeaders).toEqual(['Host', 'example.com', 'Authorization']);
  });
});

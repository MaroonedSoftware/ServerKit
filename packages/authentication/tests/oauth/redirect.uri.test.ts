import { describe, expect, it } from 'vitest';
import { describeRedirect, isLoopbackRedirectUri, redirectUriMatches, validateRegisteredRedirectUri } from '../../src/oauth/redirect.uri.js';

describe('redirectUriMatches', () => {
  it.each([
    ['an exact https match', ['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback', true],
    [
      'one of several registered',
      ['https://a.example/cb', 'https://claude.com/api/mcp/auth_callback'],
      'https://claude.com/api/mcp/auth_callback',
      true,
    ],
    ['a different path', ['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/other', false],
    ['a trailing slash', ['https://claude.ai/cb'], 'https://claude.ai/cb/', false],
    ['a different host case', ['https://claude.ai/cb'], 'https://CLAUDE.ai/cb', false],
    ['an added query', ['https://claude.ai/cb'], 'https://claude.ai/cb?x=1', false],
    ['a fragment', ['https://claude.ai/cb#x'], 'https://claude.ai/cb#x', false],
    ['http on a non-loopback host, even when registered', ['http://app.example/cb'], 'http://app.example/cb', false],
    ['a custom scheme, even when registered', ['myapp:/cb'], 'myapp:/cb', false],
    ['loopback localhost on another port', ['http://localhost/callback'], 'http://localhost:53682/callback', true],
    ['loopback 127.0.0.1 on another port', ['http://127.0.0.1/callback'], 'http://127.0.0.1:9000/callback', true],
    ['loopback [::1] on another port', ['http://[::1]:1/callback'], 'http://[::1]:8080/callback', true],
    ['loopback with a different path', ['http://localhost/callback'], 'http://localhost:53682/other', false],
    ['loopback with a different host', ['http://localhost/callback'], 'http://127.0.0.1:53682/callback', false],
    ['loopback with a different query', ['http://localhost/callback?a=1'], 'http://localhost:9/callback?a=2', false],
    ['loopback over https registered as http', ['http://localhost/callback'], 'https://localhost:9/callback', false],
    ['a malformed URI', ['https://claude.ai/cb'], 'not a uri', false],
    ['userinfo', ['https://user@claude.ai/cb'], 'https://user@claude.ai/cb', false],
  ])('%s', (_label, registered, presented, expected) => {
    expect(redirectUriMatches(registered, presented)).toBe(expected);
  });
});

describe('validateRegisteredRedirectUri', () => {
  it.each(['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback', 'http://127.0.0.1:8080/cb', 'http://[::1]/cb'])(
    'accepts %s',
    uri => {
      expect(validateRegisteredRedirectUri(uri)).toBeUndefined();
    },
  );

  it.each(['http://app.example/cb', 'myapp://cb', 'https://claude.ai/cb#frag', 'https://claude.ai/cb#', 'https://u:p@claude.ai/cb', '/relative', ''])(
    'refuses %s',
    uri => {
      expect(validateRegisteredRedirectUri(uri)).toBe('invalid_redirect_uri');
    },
  );
});

describe('isLoopbackRedirectUri', () => {
  it('recognises the three loopback hosts over http only', () => {
    expect(isLoopbackRedirectUri('http://localhost/cb')).toBe(true);
    expect(isLoopbackRedirectUri('http://127.0.0.1:1/cb')).toBe(true);
    expect(isLoopbackRedirectUri('http://[::1]/cb')).toBe(true);
    expect(isLoopbackRedirectUri('https://localhost/cb')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.2/cb')).toBe(false);
    expect(isLoopbackRedirectUri('garbage')).toBe(false);
  });
});

describe('describeRedirect', () => {
  it('names the destination host and says when every registered URI is loopback', () => {
    expect(describeRedirect('http://localhost:53682/callback', ['http://localhost/callback', 'http://127.0.0.1/callback'])).toEqual({
      host: 'localhost:53682',
      loopbackOnly: true,
    });
  });

  it('is not loopback-only when any registered URI is remote', () => {
    expect(describeRedirect('https://claude.ai/cb', ['https://claude.ai/cb', 'http://localhost/cb'])).toEqual({
      host: 'claude.ai',
      loopbackOnly: false,
    });
  });
});

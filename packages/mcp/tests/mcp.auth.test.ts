import { describe, it, expect } from 'vitest';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyEnvelope } from '@maroonedsoftware/policies';
import { verifyMcpBearer, MCP_AUTHORIZATION_HEADER, type McpAuthFailureReason } from '../src/mcp.auth.js';
import { McpAuthPolicy, MCP_AUTH_POLICY, type McpAuthPolicyContext } from '../src/mcp.auth.policy.js';
import { IsMcpError } from '../src/mcp.error.js';

const TOKEN = 'sk-secret-token';

describe('verifyMcpBearer', () => {
  it('returns the token when the Authorization header matches', () => {
    expect(verifyMcpBearer({ authorization: `Bearer ${TOKEN}`, expectedToken: TOKEN })).toEqual({ token: TOKEN });
  });

  it('accepts a case-insensitive scheme', () => {
    expect(verifyMcpBearer({ authorization: `bearer ${TOKEN}`, expectedToken: TOKEN })).toEqual({ token: TOKEN });
  });

  const expectReason = (fn: () => unknown, reason: McpAuthFailureReason) => {
    try {
      fn();
    } catch (error) {
      expect(IsMcpError(error)).toBe(true);
      if (IsMcpError(error)) expect(error.internalDetails?.reason).toBe(reason);
      return;
    }
    throw new Error('expected verifyMcpBearer to throw');
  };

  it('rejects a missing header with reason missing_token', () => {
    expectReason(() => verifyMcpBearer({ authorization: undefined, expectedToken: TOKEN }), 'missing_token');
  });

  it('rejects a header without the Bearer scheme with reason missing_token', () => {
    expectReason(() => verifyMcpBearer({ authorization: TOKEN, expectedToken: TOKEN }), 'missing_token');
  });

  it('rejects a wrong token with reason invalid_token', () => {
    expectReason(() => verifyMcpBearer({ authorization: 'Bearer nope', expectedToken: TOKEN }), 'invalid_token');
  });

  it('rejects a token of a different length without throwing on the constant-time compare', () => {
    expectReason(() => verifyMcpBearer({ authorization: 'Bearer x', expectedToken: TOKEN }), 'invalid_token');
  });
});

describe('McpAuthPolicy', () => {
  const envelope = {} as PolicyEnvelope; // bearer auth never reads envelope.now
  const evaluate = (authorization: string | undefined, bearerToken?: string) => {
    const context: McpAuthPolicyContext = {
      getHeader: (name) => (name === MCP_AUTHORIZATION_HEADER && authorization ? authorization : ''),
      options: { bearerToken },
    };
    return new McpAuthPolicy().evaluate(context, envelope);
  };

  it('is registered under the expected name', () => {
    expect(MCP_AUTH_POLICY).toBe('mcp.auth.valid');
  });

  it('allows a request carrying the configured token', async () => {
    expect(isPolicyResultAllowed(await evaluate(`Bearer ${TOKEN}`, TOKEN))).toBe(true);
  });

  it('allows any request when no token is configured (open endpoint)', async () => {
    expect(isPolicyResultAllowed(await evaluate(undefined, undefined))).toBe(true);
  });

  it('denies a missing token with a WWW-Authenticate challenge', async () => {
    const result = await evaluate(undefined, TOKEN);
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(result.reason).toBe('missing_token' satisfies McpAuthFailureReason);
      expect(result.headers?.['WWW-Authenticate']).toContain('Bearer');
    }
  });

  it('denies an invalid token and keeps it out of the diagnostics', async () => {
    const result = await evaluate('Bearer wrong-token', TOKEN);
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(result.reason).toBe('invalid_token' satisfies McpAuthFailureReason);
      expect(JSON.stringify(result)).not.toContain('wrong-token');
    }
  });
});

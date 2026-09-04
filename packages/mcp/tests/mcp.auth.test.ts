import { describe, it, expect, vi } from 'vitest';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyEnvelope } from '@maroonedsoftware/policies';
import {
  isBlankBearerToken,
  verifyMcpBearer,
  MCP_AUTHORIZATION_HEADER,
  type McpAuthFailureReason,
  type McpAuthInfo,
  type McpAuthOptions,
} from '../src/mcp.auth.js';
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

  it('refuses a blank expected token as a misconfiguration, not an auth failure', () => {
    try {
      verifyMcpBearer({ authorization: `Bearer ${TOKEN}`, expectedToken: '' });
    } catch (error) {
      expect(IsMcpError(error)).toBe(true);
      if (IsMcpError(error)) {
        expect(error.internalDetails?.kind).toBe('misconfiguration');
        // Not a reason code: a blank config is not a client-correctable 401.
        expect(error.internalDetails?.reason).toBeUndefined();
      }
      return;
    }
    throw new Error('expected verifyMcpBearer to throw');
  });
});

describe('isBlankBearerToken', () => {
  it('separates "no token configured" from "token configured and empty"', () => {
    expect(isBlankBearerToken(undefined)).toBe(false);
    expect(isBlankBearerToken('')).toBe(true);
    expect(isBlankBearerToken('   ')).toBe(true);
    expect(isBlankBearerToken(TOKEN)).toBe(false);
  });

  it('leaves a usable token usable after the guards, rather than narrowing it away', () => {
    // Typed, not just executed. Were this a `bearerToken is string` predicate,
    // ruling out blank and then undefined would narrow `configured` to `never`
    // and this assignment would be the only thing to notice.
    const usableToken = (configured: string | undefined): string => {
      if (isBlankBearerToken(configured)) throw new Error('blank');
      if (configured === undefined) throw new Error('unset');
      // Assigning *into* the narrowed type is the assertion that bites. Returning
      // it would not: `never` is assignable to `string`, so a bad narrowing sails
      // through. A plain string is assignable to `never` only if it isn't `never`.
      const stillAString: typeof configured = TOKEN;
      return configured === stillAString ? configured : configured;
    };

    expect(usableToken(TOKEN)).toBe(TOKEN);
    expect(() => usableToken('')).toThrow('blank');
    expect(() => usableToken(undefined)).toThrow('unset');
  });
});

describe('McpAuthPolicy', () => {
  const envelope = {} as PolicyEnvelope; // bearer auth never reads envelope.now
  const evaluateWith = (authorization: string | undefined, options: McpAuthOptions, onResolved?: (auth: McpAuthInfo) => void) => {
    const context: McpAuthPolicyContext = {
      getHeader: name => (name === MCP_AUTHORIZATION_HEADER && authorization ? authorization : ''),
      options,
      onResolved,
    };
    return new McpAuthPolicy().evaluate(context, envelope);
  };
  const evaluate = (authorization: string | undefined, bearerToken?: string) => evaluateWith(authorization, { bearerToken });
  /** The one configuration that runs unauthenticated: no token, opted in explicitly. */
  const openOptions: McpAuthOptions = { allowUnauthenticated: true };

  it('is registered under the expected name', () => {
    expect(MCP_AUTH_POLICY).toBe('mcp.auth.valid');
  });

  it('allows a request carrying the configured token', async () => {
    expect(isPolicyResultAllowed(await evaluate(`Bearer ${TOKEN}`, TOKEN))).toBe(true);
  });

  it('allows any request when unauthenticated mode is opted into explicitly', async () => {
    expect(isPolicyResultAllowed(await evaluateWith(undefined, openOptions))).toBe(true);
  });

  it('throws rather than serving every caller when no token is configured and nothing opted in', async () => {
    await expect(evaluate(undefined, undefined)).rejects.toThrow('allowUnauthenticated');
  });

  it('enforces a configured token even when allowUnauthenticated is also set', async () => {
    await expect(evaluateWith(undefined, { bearerToken: TOKEN, allowUnauthenticated: true })).resolves.toMatchObject({ allowed: false });
    expect(isPolicyResultAllowed(await evaluateWith(`Bearer ${TOKEN}`, { bearerToken: TOKEN, allowUnauthenticated: true }))).toBe(true);
  });

  it('throws rather than opening the endpoint when the configured token is blank', async () => {
    await expect(evaluate(`Bearer ${TOKEN}`, '')).rejects.toThrow('blank');
  });

  it('treats a whitespace-only configured token the same way', async () => {
    await expect(evaluate(undefined, '   ')).rejects.toThrow('blank');
  });

  it('refuses a blank token even with allowUnauthenticated set, since the two contradict', async () => {
    await expect(evaluateWith(undefined, { bearerToken: '', allowUnauthenticated: true })).rejects.toThrow('blank');
  });

  it('denies a missing token with a WWW-Authenticate challenge', async () => {
    const result = await evaluate(undefined, TOKEN);
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(result.reason).toBe('missing_token' satisfies McpAuthFailureReason);
      expect(result.headers?.['WWW-Authenticate']).toContain('Bearer');
    }
  });

  it('hands the resolved identity to onResolved when the token is valid', async () => {
    const onResolved = vi.fn();
    await evaluateWith(`Bearer ${TOKEN}`, { bearerToken: TOKEN }, onResolved);
    expect(onResolved).toHaveBeenCalledWith({ token: TOKEN });
  });

  it('does not call onResolved when it denies', async () => {
    const onResolved = vi.fn();
    await evaluateWith('Bearer wrong-token', { bearerToken: TOKEN }, onResolved);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('does not call onResolved in unauthenticated mode, which authenticates nobody', async () => {
    const onResolved = vi.fn();
    await evaluateWith(undefined, openOptions, onResolved);
    expect(onResolved).not.toHaveBeenCalled();
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

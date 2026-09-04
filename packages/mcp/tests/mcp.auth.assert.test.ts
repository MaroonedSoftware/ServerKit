import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'injectkit';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { assertMcpAuth } from '../src/mcp.auth.assert.js';
import { McpAuthPolicy, type McpAuthPolicyContext } from '../src/mcp.auth.policy.js';
import { McpConfig } from '../src/mcp.config.js';
import { MCP_AUTHORIZATION_HEADER } from '../src/mcp.auth.js';

const TOKEN = 'sk-secret-token';

// Mirrors `BasePolicyService.assert`: evaluate the real McpAuthPolicy and throw
// on denial, so the verifier and the onResolved callback run end to end.
const makePolicyService = (): PolicyService => {
  const check = vi.fn((_name: string, context: McpAuthPolicyContext) => new McpAuthPolicy().evaluate(context, { now: undefined as never }));
  const assert = vi.fn(async (name: string, context: McpAuthPolicyContext, statusCode = 403) => {
    const result = await check(name, context);
    if (isPolicyResultDenied(result)) {
      throw httpError(statusCode).withHeaders(result.headers ?? {});
    }
  });
  return { check, assert } as unknown as PolicyService;
};

const makeContainer = (bearerToken?: string, allowUnauthenticated?: boolean) => {
  const config: McpConfig = { serverName: 'test', version: '0.0.0', bearerToken, allowUnauthenticated };
  const policyService = makePolicyService();
  return { get: vi.fn((token: unknown) => (token === McpConfig ? config : policyService)) } as unknown as Container;
};

const getHeader = (authorization?: string) => (name: string) => (name === MCP_AUTHORIZATION_HEADER && authorization ? authorization : '');

describe('assertMcpAuth', () => {
  it('returns the identity the policy resolved from a valid token', async () => {
    await expect(assertMcpAuth(makeContainer(TOKEN), getHeader(`Bearer ${TOKEN}`))).resolves.toEqual({ token: TOKEN });
  });

  it('throws 401 with the challenge header when the token is missing', async () => {
    await expect(assertMcpAuth(makeContainer(TOKEN), getHeader(undefined))).rejects.toMatchObject({
      statusCode: 401,
      headers: { 'WWW-Authenticate': 'Bearer error="missing_token"' },
    });
  });

  it('throws 401 when the token is wrong', async () => {
    await expect(assertMcpAuth(makeContainer(TOKEN), getHeader('Bearer nope'))).rejects.toThrow(HttpError);
  });

  it('resolves to undefined in unauthenticated mode, since no token configured authenticates nobody', async () => {
    await expect(assertMcpAuth(makeContainer(undefined, true), getHeader(undefined))).resolves.toBeUndefined();
  });

  it('rejects when no token is configured and unauthenticated mode was not opted into', async () => {
    await expect(assertMcpAuth(makeContainer(undefined), getHeader(undefined))).rejects.toThrow('allowUnauthenticated');
  });

  it('rejects rather than falling through to open mode when the configured token is blank', async () => {
    await expect(assertMcpAuth(makeContainer(''), getHeader(`Bearer ${TOKEN}`))).rejects.toThrow('blank');
  });
});

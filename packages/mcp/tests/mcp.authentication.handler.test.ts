import { describe, it, expect, vi } from 'vitest';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { McpAuthenticationHandler, MCP_DEFAULT_SUBJECT } from '../src/mcp.authentication.handler.js';
import { MCP_DEFAULT_REQUEST_TIMEOUT_MS, type McpConfig } from '../src/mcp.config.js';
import { IsMcpError } from '../src/mcp.error.js';
import { makeLogger } from './helpers.js';

const TOKEN = 'sk-secret-token';

const makeHandler = (config: Partial<McpConfig> = {}) => {
  const logger = makeLogger();
  const handler = new McpAuthenticationHandler({ serverName: 'test', version: '0.0.0', ...config }, logger);
  return { handler, logger };
};

describe('McpAuthenticationHandler', () => {
  describe('declining', () => {
    it('declines a scheme other than bearer', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      await expect(handler.authenticate('basic', TOKEN)).resolves.toBe(invalidAuthenticationSession);
    });

    it('declines a token that does not match', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      await expect(handler.authenticate('bearer', 'wrong-token')).resolves.toBe(invalidAuthenticationSession);
    });

    it('logs a mismatch at debug, not warn, since a chain reaches it on every request', async () => {
      const { handler, logger } = makeHandler({ bearerToken: TOKEN });

      await handler.authenticate('bearer', 'wrong-token');

      expect(logger.debug).toHaveBeenCalledOnce();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('keeps the presented token out of the logs', async () => {
      const { handler, logger } = makeHandler({ bearerToken: TOKEN });

      await handler.authenticate('bearer', 'wrong-token');

      expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('wrong-token');
    });

    it('authenticates nobody when running unauthenticated by explicit request', async () => {
      const { handler } = makeHandler({ allowUnauthenticated: true });

      // Presenting a token to an endpoint that has none configured proves nothing,
      // so the handler must not mint a session off it.
      await expect(handler.authenticate('bearer', TOKEN)).resolves.toBe(invalidAuthenticationSession);
    });
  });

  describe('misconfiguration', () => {
    it('throws when the configured token is blank', async () => {
      const { handler } = makeHandler({ bearerToken: '' });

      await expect(handler.authenticate('bearer', TOKEN)).rejects.toSatisfy(
        error => IsMcpError(error) && error.internalDetails?.field === 'bearerToken' && error.internalDetails?.kind === 'misconfiguration',
      );
    });

    it('throws when the configured token is whitespace', async () => {
      const { handler } = makeHandler({ bearerToken: '  ' });

      await expect(handler.authenticate('bearer', TOKEN)).rejects.toSatisfy(IsMcpError);
    });

    it('throws when no token is configured and allowUnauthenticated was not set', async () => {
      const { handler } = makeHandler();

      await expect(handler.authenticate('bearer', TOKEN)).rejects.toSatisfy(
        error => IsMcpError(error) && error.internalDetails?.field === 'allowUnauthenticated',
      );
    });

    it('refuses a blank token even when allowUnauthenticated is set', async () => {
      // The two settings contradict each other; the safe reading wins.
      const { handler } = makeHandler({ bearerToken: '', allowUnauthenticated: true });

      await expect(handler.authenticate('bearer', TOKEN)).rejects.toSatisfy(IsMcpError);
    });

    it('declines a non-bearer scheme before looking at the configuration', async () => {
      const { handler } = makeHandler();

      await expect(handler.authenticate('basic', TOKEN)).resolves.toBe(invalidAuthenticationSession);
    });
  });

  describe('the session it mints', () => {
    it('authenticates a matching token', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      const session = await handler.authenticate('bearer', TOKEN);

      expect(session).not.toBe(invalidAuthenticationSession);
    });

    it('uses the default subject when the config does not name one', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      await expect(handler.authenticate('bearer', TOKEN)).resolves.toMatchObject({ subject: MCP_DEFAULT_SUBJECT });
    });

    it('uses the configured subject when set', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN, subject: 'claude.desktop' });

      await expect(handler.authenticate('bearer', TOKEN)).resolves.toMatchObject({ subject: 'claude.desktop' });
    });

    it('carries no factors, since none of the factor methods describes a shared secret', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      await expect(handler.authenticate('bearer', TOKEN)).resolves.toMatchObject({ factors: [] });
    });

    it('marks itself with claims.mcp so a policy override can recognise it', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      await expect(handler.authenticate('bearer', TOKEN)).resolves.toMatchObject({ claims: { mcp: true } });
    });

    it('never uses the bearer token as the session token', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      const session = await handler.authenticate('bearer', TOKEN);

      expect(session.sessionToken).not.toBe(TOKEN);
      expect(JSON.stringify(session)).not.toContain(TOKEN);
    });

    it('mints a distinct session token per request, so nothing reads it as a stored key', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      const first = await handler.authenticate('bearer', TOKEN);
      const second = await handler.authenticate('bearer', TOKEN);

      expect(first.sessionToken).not.toBe(second.sessionToken);
    });

    it('carries valid timestamps expiring after the request timeout', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN, requestTimeoutMs: 5_000 });

      const session = await handler.authenticate('bearer', TOKEN);

      expect(session.issuedAt.isValid).toBe(true);
      expect(session.lastAccessedAt.isValid).toBe(true);
      expect(session.expiresAt.isValid).toBe(true);
      expect(session.expiresAt.diff(session.issuedAt).as('milliseconds')).toBe(5_000);
    });

    it('falls back to the default request timeout for the lifetime', async () => {
      const { handler } = makeHandler({ bearerToken: TOKEN });

      const session = await handler.authenticate('bearer', TOKEN);

      expect(session.expiresAt.diff(session.issuedAt).as('milliseconds')).toBe(MCP_DEFAULT_REQUEST_TIMEOUT_MS);
    });
  });
});

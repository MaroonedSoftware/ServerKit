import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationSchemeHandler, AuthenticationHandlerMap } from '../src/authentication.scheme.handler.js';
import { invalidAuthenticationSession } from '../src/types.js';
import type { AuthenticationSession } from '../src/types.js';
import type { AuthenticationHandler } from '../src/authentication.handler.js';
import type { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';

const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

const makeValidSession = (): AuthenticationSession => ({
  subject: 'user-1',
  sessionToken: 'session-token-123',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [{ method: 'password', methodId: 'factor-1', kind: 'knowledge', issuedAt: DateTime.now(), authenticatedAt: DateTime.now() }],
  claims: { sub: 'user-1' },
});

describe('AuthenticationSchemeHandler', () => {
  let handlers: AuthenticationHandlerMap;
  let logger: Logger;
  let handler: AuthenticationSchemeHandler;

  beforeEach(() => {
    handlers = new AuthenticationHandlerMap();
    logger = makeLogger();
    handler = new AuthenticationSchemeHandler(handlers, logger);
  });

  describe('handle', () => {
    it('returns invalidAuthenticationSession when no header is provided', async () => {
      const result = await handler.handle(undefined);
      expect(result).toBe(invalidAuthenticationSession);
    });

    it('returns invalidAuthenticationSession and warns when header has no value', async () => {
      const result = await handler.handle('Bearer');
      expect(result).toBe(invalidAuthenticationSession);
      expect(logger.warn).toHaveBeenCalledWith('Invalid authorization header');
    });

    it('returns invalidAuthenticationSession and warns when header has only whitespace value', async () => {
      // "Bearer " splits into ["Bearer", ""] — value is empty string (falsy)
      const result = await handler.handle('Bearer ');
      expect(result).toBe(invalidAuthenticationSession);
      expect(logger.warn).toHaveBeenCalledWith('Invalid authorization header');
    });

    it('returns invalidAuthenticationSession and warns when scheme has no registered handler', async () => {
      const result = await handler.handle('Bearer sometoken');
      expect(result).toBe(invalidAuthenticationSession);
      expect(logger.warn).toHaveBeenCalledWith('No authentication handler found for scheme', { scheme: 'bearer' });
    });

    it('calls the registered handler and returns its result', async () => {
      const validSession = makeValidSession();
      const bearerHandler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(validSession),
      };
      handlers.set('bearer', bearerHandler);

      const result = await handler.handle('Bearer mytoken');

      expect(bearerHandler.authenticate).toHaveBeenCalledWith('bearer', 'mytoken');
      expect(result).toBe(validSession);
    });

    it('works with a custom scheme', async () => {
      const validSession = makeValidSession();
      const apiKeyHandler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(validSession),
      };
      handlers.set('apikey', apiKeyHandler);

      const result = await handler.handle('ApiKey secretkey');

      expect(apiKeyHandler.authenticate).toHaveBeenCalledWith('apikey', 'secretkey');
      expect(result).toBe(validSession);
    });

    it('does not call unrelated handlers', async () => {
      const bearerHandler: AuthenticationHandler = { authenticate: vi.fn() };
      const basicHandler: AuthenticationHandler = { authenticate: vi.fn() };
      handlers.set('bearer', bearerHandler);
      handlers.set('basic', basicHandler);

      await handler.handle('Bearer atoken');

      expect(bearerHandler.authenticate).toHaveBeenCalledOnce();
      expect(basicHandler.authenticate).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by the scheme handler', async () => {
      const error = new Error('auth failed');
      const failingHandler: AuthenticationHandler = {
        authenticate: vi.fn().mockRejectedValue(error),
      };
      handlers.set('bearer', failingHandler);

      await expect(handler.handle('Bearer token')).rejects.toThrow('auth failed');
    });
  });
});

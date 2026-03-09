import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationSchemeHandler, AuthenticationHandlerMap } from '../src/authentication.scheme.handler.js';
import { invalidAuthenticationContext } from '../src/authentication.context.js';
import type { AuthenticationContext } from '../src/authentication.context.js';
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

const makeValidContext = (): AuthenticationContext => ({
  authenticationId: 'auth-123',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [{ method: 'password', type: 'password', lastAuthenticated: DateTime.now(), kind: 'knowledge' }],
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
    it('returns invalidAuthenticationContext when no header is provided', async () => {
      const result = await handler.handle(undefined);
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('returns invalidAuthenticationContext and warns when header has no value', async () => {
      const result = await handler.handle('Bearer');
      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('Invalid authorization header');
    });

    it('returns invalidAuthenticationContext and warns when header has only whitespace value', async () => {
      // "Bearer " splits into ["Bearer", ""] — value is empty string (falsy)
      const result = await handler.handle('Bearer ');
      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('Invalid authorization header');
    });

    it('returns invalidAuthenticationContext and warns when scheme has no registered handler', async () => {
      const result = await handler.handle('Bearer sometoken');
      expect(result).toBe(invalidAuthenticationContext);
      expect(logger.warn).toHaveBeenCalledWith('No authentication handler found for scheme', { scheme: 'Bearer' });
    });

    it('calls the registered handler and returns its result', async () => {
      const validContext = makeValidContext();
      const bearerHandler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(validContext),
      };
      handlers.set('Bearer', bearerHandler);

      const result = await handler.handle('Bearer mytoken');

      expect(bearerHandler.authenticate).toHaveBeenCalledWith('Bearer', 'mytoken');
      expect(result).toBe(validContext);
    });

    it('works with a custom scheme', async () => {
      const validContext = makeValidContext();
      const apiKeyHandler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(validContext),
      };
      handlers.set('ApiKey', apiKeyHandler);

      const result = await handler.handle('ApiKey secretkey');

      expect(apiKeyHandler.authenticate).toHaveBeenCalledWith('ApiKey', 'secretkey');
      expect(result).toBe(validContext);
    });

    it('does not call unrelated handlers', async () => {
      const bearerHandler: AuthenticationHandler = { authenticate: vi.fn() };
      const basicHandler: AuthenticationHandler = { authenticate: vi.fn() };
      handlers.set('Bearer', bearerHandler);
      handlers.set('Basic', basicHandler);

      await handler.handle('Bearer atoken');

      expect(bearerHandler.authenticate).toHaveBeenCalledOnce();
      expect(basicHandler.authenticate).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by the scheme handler', async () => {
      const error = new Error('auth failed');
      const failingHandler: AuthenticationHandler = {
        authenticate: vi.fn().mockRejectedValue(error),
      };
      handlers.set('Bearer', failingHandler);

      await expect(handler.handle('Bearer token')).rejects.toThrow('auth failed');
    });
  });
});

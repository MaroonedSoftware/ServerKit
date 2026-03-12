import { describe, it, expect, vi } from 'vitest';
import type { AuthenticationHandler, AuthorizationScheme } from '../src/authentication.handler.js';
import type { AuthenticationContext } from '../src/authentication.context.js';
import { invalidAuthenticationContext } from '../src/authentication.context.js';
import { DateTime } from 'luxon';

const makeValidContext = (): AuthenticationContext => ({
  authenticationId: 'auth-123',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [],
  claims: { sub: 'user-1' },
  roles: ['user'],
});

describe('AuthenticationHandler', () => {
  describe('interface contract', () => {
    it('should be implementable as a class', async () => {
      class ConcreteHandler implements AuthenticationHandler {
        async authenticate(_scheme: AuthorizationScheme, value: string): Promise<AuthenticationContext> {
          return value === 'valid' ? makeValidContext() : invalidAuthenticationContext;
        }
      }

      const handler = new ConcreteHandler();
      expect(handler).toBeDefined();
      expect(typeof handler.authenticate).toBe('function');
    });

    it('authenticate should return a Promise', () => {
      const handler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(invalidAuthenticationContext),
      };

      const result = handler.authenticate('bearer', 'token');
      expect(result).toBeInstanceOf(Promise);
    });

    it('authenticate should resolve with a valid context on success', async () => {
      const validContext = makeValidContext();
      const handler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(validContext),
      };

      const result = await handler.authenticate('bearer', 'valid-token');
      expect(result).toBe(validContext);
    });

    it('authenticate should resolve with invalidAuthenticationContext on failure', async () => {
      const handler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(invalidAuthenticationContext),
      };

      const result = await handler.authenticate('bearer', 'bad-token');
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('authenticate should be called with the scheme and credential value', async () => {
      const handler: AuthenticationHandler = {
        authenticate: vi.fn().mockResolvedValue(invalidAuthenticationContext),
      };

      await handler.authenticate('bearer', 'my-token');
      expect(handler.authenticate).toHaveBeenCalledWith('bearer', 'my-token');
    });

    it('should be implementable as a plain object literal', async () => {
      const handler: AuthenticationHandler = {
        async authenticate(scheme, value) {
          if (scheme === 'bearer' && value === 'secret') {
            return makeValidContext();
          }
          return invalidAuthenticationContext;
        },
      };

      const result = await handler.authenticate('bearer', 'secret');
      expect(result.authenticationId).toBe('auth-123');
    });

    it('should propagate errors thrown by authenticate', async () => {
      const handler: AuthenticationHandler = {
        authenticate: vi.fn().mockRejectedValue(new Error('auth service unavailable')),
      };

      await expect(handler.authenticate('bearer', 'token')).rejects.toThrow('auth service unavailable');
    });
  });

  describe('AuthorizationScheme', () => {
    it('accepts the bearer scheme', () => {
      const scheme: AuthorizationScheme = 'bearer';
      expect(scheme).toBe('bearer');
    });

    it('accepts the basic scheme', () => {
      const scheme: AuthorizationScheme = 'basic';
      expect(scheme).toBe('basic');
    });

    it('accepts arbitrary custom scheme strings', () => {
      const apiKey: AuthorizationScheme = 'apikey';
      const digest: AuthorizationScheme = 'digest';
      const custom: AuthorizationScheme = 'x-custom-scheme';

      expect(apiKey).toBe('apikey');
      expect(digest).toBe('digest');
      expect(custom).toBe('x-custom-scheme');
    });
  });
});

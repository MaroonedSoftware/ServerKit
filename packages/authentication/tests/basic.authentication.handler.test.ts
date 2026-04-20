import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BasicAuthenticationHandler } from '../src/basic/basic.authentication.handler.js';
import { invalidAuthenticationContext } from '../src/authentication.context.js';
import type { AuthenticationContext } from '../src/authentication.context.js';
import type { BasicAuthenticationIssuer } from '../src/basic/basic.authentication.issuer.js';
import { DateTime } from 'luxon';

const makeValidContext = (): AuthenticationContext => ({
  actorId: 'auth-123',
  actorType: 'user',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [],
  claims: { sub: 'user-1' },
  roles: [],
});

const encodeBasic = (username: string, password: string) => Buffer.from(`${username}:${password}`).toString('base64');

describe('BasicAuthenticationHandler', () => {
  let issuer: BasicAuthenticationIssuer;
  let handler: BasicAuthenticationHandler;

  beforeEach(() => {
    issuer = { verify: vi.fn() } as unknown as BasicAuthenticationIssuer;
    handler = new BasicAuthenticationHandler(issuer);
  });

  describe('authenticate', () => {
    it('returns invalidAuthenticationContext when scheme is not basic', async () => {
      const result = await handler.authenticate('bearer', encodeBasic('user', 'pass'));
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('does not call issuer.verify when scheme is not basic', async () => {
      await handler.authenticate('bearer', encodeBasic('user', 'pass'));
      expect(issuer.verify).not.toHaveBeenCalled();
    });

    it('returns invalidAuthenticationContext when scheme is BASIC (case-sensitive)', async () => {
      const result = await handler.authenticate('BASIC', encodeBasic('user', 'pass'));
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('returns invalidAuthenticationContext when credential has no colon separator', async () => {
      const value = Buffer.from('usernameonly').toString('base64');
      const result = await handler.authenticate('basic', value);
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('returns invalidAuthenticationContext when username is empty', async () => {
      const value = Buffer.from(':password').toString('base64');
      const result = await handler.authenticate('basic', value);
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('returns invalidAuthenticationContext when password is empty', async () => {
      const value = Buffer.from('username:').toString('base64');
      const result = await handler.authenticate('basic', value);
      expect(result).toBe(invalidAuthenticationContext);
    });

    it('calls issuer.verify with the decoded username and password', async () => {
      const validContext = makeValidContext();
      vi.mocked(issuer.verify).mockResolvedValue(validContext);

      await handler.authenticate('basic', encodeBasic('alice', 'secret'));

      expect(issuer.verify).toHaveBeenCalledWith('alice', 'secret');
    });

    it('returns the AuthenticationContext resolved by issuer.verify', async () => {
      const validContext = makeValidContext();
      vi.mocked(issuer.verify).mockResolvedValue(validContext);

      const result = await handler.authenticate('basic', encodeBasic('alice', 'secret'));

      expect(result).toBe(validContext);
    });

    it('calls issuer.verify only once per authenticate call', async () => {
      const validContext = makeValidContext();
      vi.mocked(issuer.verify).mockResolvedValue(validContext);

      await handler.authenticate('basic', encodeBasic('alice', 'secret'));

      expect(issuer.verify).toHaveBeenCalledTimes(1);
    });
  });
});

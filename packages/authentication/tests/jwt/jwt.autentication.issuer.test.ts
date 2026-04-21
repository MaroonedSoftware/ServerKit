import { describe, it, expect, vi } from 'vitest';
import { JwtAuthenticationIssuer } from '../../src/jwt/jwt.autentication.issuer.js';
import { JwtAuthenticationIssuerMap } from '../../src/jwt/jwt.authentication.handler.js';
import type { AuthenticationContext } from '../../src/authentication.context.js';
import { invalidAuthenticationContext } from '../../src/authentication.context.js';
import { DateTime } from 'luxon';
import type { JwtPayload } from 'jsonwebtoken';

const makeValidContext = (): AuthenticationContext => ({
  actorId: 'auth-123',
  actorType: 'user',
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [],
  claims: { sub: 'user-1' },
  roles: ['user'],
});

class PassthroughIssuer extends JwtAuthenticationIssuer {
  async parse(_payload: JwtPayload): Promise<AuthenticationContext> {
    return makeValidContext();
  }
}

class RejectingIssuer extends JwtAuthenticationIssuer {
  async parse(_payload: JwtPayload): Promise<AuthenticationContext> {
    throw new Error('Token validation failed');
  }
}

class PayloadCapturingIssuer extends JwtAuthenticationIssuer {
  capturedPayload: JwtPayload | null = null;

  async parse(payload: JwtPayload): Promise<AuthenticationContext> {
    this.capturedPayload = payload;
    return makeValidContext();
  }
}

describe('JwtAuthenticationIssuer', () => {
  describe('abstract class behaviour', () => {
    it('should be extendable', () => {
      const issuer = new PassthroughIssuer();
      expect(issuer).toBeInstanceOf(JwtAuthenticationIssuer);
    });

    it('should expose a parse method on the concrete subclass', () => {
      const issuer = new PassthroughIssuer();
      expect(typeof issuer.parse).toBe('function');
    });
  });

  describe('parse', () => {
    it('should return a Promise', () => {
      const issuer = new PassthroughIssuer();
      const result = issuer.parse({ sub: 'user-1', iss: 'https://auth.example.com' });
      expect(result).toBeInstanceOf(Promise);
    });

    it('should resolve to an AuthenticationContext', async () => {
      const issuer = new PassthroughIssuer();
      const result = await issuer.parse({ sub: 'user-1', iss: 'https://auth.example.com' });

      expect(result).toBeDefined();
      expect(result.actorId).toBe('auth-123');
    });

    it('should receive the full decoded JWT payload', async () => {
      const issuer = new PayloadCapturingIssuer();
      const payload: JwtPayload = {
        iss: 'https://auth.example.com',
        sub: 'user-42',
        aud: 'my-app',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'token-id-abc',
        customClaim: 'value',
      };

      await issuer.parse(payload);

      expect(issuer.capturedPayload).toEqual(payload);
    });

    it('should propagate errors thrown during parsing', async () => {
      const issuer = new RejectingIssuer();
      await expect(issuer.parse({ sub: 'user-1' })).rejects.toThrow('Token validation failed');
    });

    it('should work with a mock implementation via vi.fn()', async () => {
      const issuer = new PassthroughIssuer();
      const validContext = makeValidContext();
      vi.spyOn(issuer, 'parse').mockResolvedValue(validContext);

      const result = await issuer.parse({ sub: 'user-1' });
      expect(result).toBe(validContext);
    });

    it('concrete subclass can return invalidAuthenticationContext', async () => {
      class AlwaysInvalidIssuer extends JwtAuthenticationIssuer {
        async parse(_payload: JwtPayload): Promise<AuthenticationContext> {
          return invalidAuthenticationContext;
        }
      }

      const issuer = new AlwaysInvalidIssuer();
      const result = await issuer.parse({ sub: 'user-1' });
      expect(result).toBe(invalidAuthenticationContext);
    });
  });
});

describe('JwtAuthenticationIssuerMap', () => {
  it('should be a Map', () => {
    const map = new JwtAuthenticationIssuerMap();
    expect(map).toBeInstanceOf(Map);
  });

  it('should start empty', () => {
    const map = new JwtAuthenticationIssuerMap();
    expect(map.size).toBe(0);
  });

  it('should store and retrieve an issuer by key', () => {
    const map = new JwtAuthenticationIssuerMap();
    const issuer = new PassthroughIssuer();

    map.set('https://auth.example.com', issuer);

    expect(map.get('https://auth.example.com')).toBe(issuer);
  });

  it('should return undefined for an unregistered issuer key', () => {
    const map = new JwtAuthenticationIssuerMap();
    expect(map.get('https://unknown.example.com')).toBeUndefined();
  });

  it('should support multiple issuers', () => {
    const map = new JwtAuthenticationIssuerMap();
    const issuerA = new PassthroughIssuer();
    const issuerB = new PassthroughIssuer();

    map.set('https://issuer-a.example.com', issuerA);
    map.set('https://issuer-b.example.com', issuerB);

    expect(map.size).toBe(2);
    expect(map.get('https://issuer-a.example.com')).toBe(issuerA);
    expect(map.get('https://issuer-b.example.com')).toBe(issuerB);
  });

  it('should support deletion of an issuer', () => {
    const map = new JwtAuthenticationIssuerMap();
    const issuer = new PassthroughIssuer();
    map.set('https://auth.example.com', issuer);

    map.delete('https://auth.example.com');

    expect(map.has('https://auth.example.com')).toBe(false);
    expect(map.size).toBe(0);
  });
});

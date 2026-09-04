import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { Injectable, InjectKitRegistry } from 'injectkit';
import { AuthenticationHandlerChain, ChainedAuthenticationHandler } from '../src/chained.authentication.handler.js';
import { AuthenticationHandlerMap } from '../src/authentication.scheme.handler.js';
import { invalidAuthenticationSession, type AuthenticationSession } from '../src/types.js';
import type { AuthenticationHandler, AuthorizationScheme } from '../src/authentication.handler.js';

const makeSession = (subject: string): AuthenticationSession => ({
  subject,
  sessionToken: `token-${subject}`,
  issuedAt: DateTime.now(),
  lastAccessedAt: DateTime.now(),
  expiresAt: DateTime.now().plus({ hours: 1 }),
  factors: [],
  claims: {},
});

/** A handler that always answers with `session`, spying on what it was called with. */
const makeHandler = (session: AuthenticationSession) => ({ authenticate: vi.fn(async () => session) });

/** Builds the chain by hand — the DI path is covered separately, below. */
const makeChain = (...handlers: AuthenticationHandler[]) => {
  const chain = new AuthenticationHandlerChain();
  chain.push(...handlers);
  return new ChainedAuthenticationHandler(chain);
};

describe('ChainedAuthenticationHandler', () => {
  describe('authenticate', () => {
    it('returns the first session that is not the sentinel', async () => {
      const session = makeSession('alice');
      const declining = makeHandler(invalidAuthenticationSession);
      const authenticating = makeHandler(session);

      const result = await makeChain(declining, authenticating).authenticate('bearer', 'credential');

      expect(result).toBe(session);
    });

    it('does not call handlers after the one that authenticated', async () => {
      const first = makeHandler(makeSession('alice'));
      const second = makeHandler(makeSession('bob'));

      await makeChain(first, second).authenticate('bearer', 'credential');

      expect(first.authenticate).toHaveBeenCalledOnce();
      expect(second.authenticate).not.toHaveBeenCalled();
    });

    it('forwards the scheme and value verbatim to every handler it tries', async () => {
      const declining = makeHandler(invalidAuthenticationSession);
      const authenticating = makeHandler(makeSession('alice'));

      await makeChain(declining, authenticating).authenticate('bearer', 'Digest realm="x", nonce="y"');

      expect(declining.authenticate).toHaveBeenCalledWith('bearer', 'Digest realm="x", nonce="y"');
      expect(authenticating.authenticate).toHaveBeenCalledWith('bearer', 'Digest realm="x", nonce="y"');
    });

    it('returns the sentinel when every handler declines', async () => {
      const first = makeHandler(invalidAuthenticationSession);
      const second = makeHandler(invalidAuthenticationSession);

      const result = await makeChain(first, second).authenticate('bearer', 'credential');

      expect(result).toBe(invalidAuthenticationSession);
      expect(second.authenticate).toHaveBeenCalledOnce();
    });

    it('returns the sentinel when the chain is empty', async () => {
      const result = await makeChain().authenticate('bearer', 'credential');

      expect(result).toBe(invalidAuthenticationSession);
    });

    it('propagates a thrown error without trying the handlers after it', async () => {
      const throwing: AuthenticationHandler = {
        authenticate: vi.fn(async () => {
          throw new Error('bearerToken is configured but blank');
        }),
      };
      const later = makeHandler(makeSession('alice'));

      await expect(makeChain(throwing, later).authenticate('bearer', 'credential')).rejects.toThrow('bearerToken is configured but blank');
      expect(later.authenticate).not.toHaveBeenCalled();
    });
  });

  describe('DI wiring', () => {
    // The `useArray` registration is the documented way to build the chain, and
    // this is its only use in the repo — so pin that it resolves in order and
    // lands in the scheme map.
    @Injectable()
    class FirstHandler implements AuthenticationHandler {
      async authenticate(_scheme: AuthorizationScheme, _value: string) {
        return invalidAuthenticationSession;
      }
    }

    @Injectable()
    class SecondHandler implements AuthenticationHandler {
      async authenticate(_scheme: AuthorizationScheme, _value: string) {
        return makeSession('bob');
      }
    }

    const build = () => {
      const registry = new InjectKitRegistry();
      registry.register(FirstHandler).useClass(FirstHandler).asSingleton();
      registry.register(SecondHandler).useClass(SecondHandler).asSingleton();
      registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain).push(FirstHandler).push(SecondHandler);
      registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
      registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
      return registry.build();
    };

    it('resolves the chain members in registration order', () => {
      const chain = build().get(AuthenticationHandlerChain);

      expect(chain).toHaveLength(2);
      expect(chain[0]).toBeInstanceOf(FirstHandler);
      expect(chain[1]).toBeInstanceOf(SecondHandler);
    });

    it('resolves through AuthenticationHandlerMap under the bearer scheme', async () => {
      const handler = build().get(AuthenticationHandlerMap).get('bearer');

      expect(handler).toBeInstanceOf(ChainedAuthenticationHandler);
      await expect(handler?.authenticate('bearer', 'credential')).resolves.toMatchObject({ subject: 'bob' });
    });
  });
});

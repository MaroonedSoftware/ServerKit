import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import type { AuthenticationSessionFactor } from '../types.js';
import { OAuthError } from './oauth.error.js';
import type { AuthorizationRequest } from './oauth.types.js';
import { verifyPkceS256 } from './pkce.s256.js';

/** The shortest a consumed-code marker lives, so a replay inside a slow round trip is still caught. */
const MIN_CONSUMED_TTL = Duration.fromObject({ seconds: 60 });

/** A code is 32 random bytes, base64url. Anything else is not one of ours. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * What the user granted: who they are and the session they granted it from.
 * The token endpoint mints the client's session from exactly this.
 */
export interface AuthorizationConsent {
  subject: string;
  claims: Record<string, unknown>;
  factors: AuthenticationSessionFactor[];
  /**
   * The scope the user granted, when it is not simply what the client asked for.
   * RFC 6749 §3.3 lets the authorization server issue a scope other than the one
   * requested "based on ... the resource owner's instructions", which is what a
   * consent page offering choices produces. Each value must be one the server
   * supports. It replaces the requested scope everywhere downstream: the grant,
   * the session's `oauth` claim, and the token response's `scope`. Omit it to
   * grant the request as asked.
   */
  scope?: string[];
}

/** A redeemed code: the request it answered and the consent behind it. */
export interface IssuedAuthorizationCode {
  request: AuthorizationRequest;
  consent: AuthorizationConsent;
  issuedAt: DateTime;
}

/** What the token request presents to redeem a code. */
export interface AuthorizationCodeVerification {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  /** The token request's `resource`, when it sent one. It must be the code's. */
  resource?: string;
}

/** Settings for {@link AuthorizationCodeService}. */
@Injectable()
export class AuthorizationCodeServiceOptions {
  constructor(
    /** How long a code may wait for redemption. Keep it short; clients redeem at once. */
    public readonly codeTtl: Duration = Duration.fromObject({ seconds: 60 }),
  ) {}
}

type StoredFactor = Omit<AuthenticationSessionFactor, 'issuedAt' | 'authenticatedAt'> & { issuedAt: number; authenticatedAt: number };

type StoredCode = {
  request: AuthorizationRequest;
  consent: { subject: string; claims: Record<string, unknown>; factors: StoredFactor[] };
  issuedAt: number;
  expiresAt: number;
};

const invalidGrant = (description: string) => new OAuthError('invalid_grant', description);

/**
 * Issues and redeems authorization codes: single use, short-lived, and bound to
 * the client, the exact `redirect_uri`, the PKCE challenge, and the resource of
 * the request they answer.
 */
@Injectable()
export class AuthorizationCodeService {
  constructor(
    private readonly cache: CacheProvider,
    private readonly options: AuthorizationCodeServiceOptions,
  ) {}

  /** Issue a code for an approved request, answering the code to redirect with. */
  async issue(request: AuthorizationRequest, consent: AuthorizationConsent): Promise<string> {
    const code = crypto.randomBytes(32).toString('base64url');
    const issuedAt = DateTime.utc();
    const stored: StoredCode = {
      request,
      consent: {
        subject: consent.subject,
        claims: consent.claims,
        factors: consent.factors.map(factor => ({
          method: factor.method,
          methodId: factor.methodId,
          kind: factor.kind,
          issuedAt: factor.issuedAt.toUnixInteger(),
          authenticatedAt: factor.authenticatedAt.toUnixInteger(),
        })),
      },
      issuedAt: issuedAt.toUnixInteger(),
      expiresAt: issuedAt.plus(this.options.codeTtl).toUnixInteger(),
    };
    await this.cache.set(this.codeKey(code), JSON.stringify(stored), this.options.codeTtl);
    return code;
  }

  /**
   * Redeem a code, once.
   *
   * The code is claimed before it is read, so two concurrent redemptions cannot
   * both succeed, and it is spent whatever happens next: a redemption that fails
   * a check still consumes it (RFC 6749 §4.1.2). Tokens already issued from a
   * code that is later replayed are **not** revoked; the code service never sees
   * them.
   *
   * @throws OAuthError `invalid_grant` when the code is unknown, expired, already
   *   used, or does not match the client, `redirect_uri`, verifier, or resource.
   */
  async redeem(code: string, verification: AuthorizationCodeVerification): Promise<IssuedAuthorizationCode> {
    if (typeof code !== 'string' || !CODE_SHAPE.test(code)) {
      throw invalidGrant('the authorization code is invalid');
    }

    const consumedTtl = this.options.codeTtl.toMillis() > MIN_CONSUMED_TTL.toMillis() ? this.options.codeTtl : MIN_CONSUMED_TTL;
    const claimed = await this.cache.add(this.consumedKey(code), '1', { ttl: consumedTtl });
    if (!claimed) {
      throw invalidGrant('the authorization code has already been used').withInternalDetails({ code: 'replayed' });
    }

    const raw = await this.cache.get(this.codeKey(code));
    // Gone whatever the outcome: it holds the consenting user's session.
    await this.cache.delete(this.codeKey(code));
    if (raw === null) {
      throw invalidGrant('the authorization code is invalid or has expired');
    }

    const stored = JSON.parse(raw) as StoredCode;
    if (stored.expiresAt <= DateTime.utc().toUnixInteger()) {
      throw invalidGrant('the authorization code has expired');
    }
    if (stored.request.clientId !== verification.clientId) {
      throw invalidGrant('the authorization code was issued to another client');
    }
    if (stored.request.redirectUri !== verification.redirectUri) {
      throw invalidGrant('redirect_uri does not match the authorization request');
    }
    if (!verifyPkceS256(verification.codeVerifier ?? '', stored.request.codeChallenge)) {
      throw invalidGrant('code_verifier does not match the code challenge');
    }
    if (verification.resource !== undefined && verification.resource !== stored.request.resource) {
      throw invalidGrant('resource does not match the authorization request');
    }

    return {
      request: stored.request,
      consent: {
        subject: stored.consent.subject,
        claims: stored.consent.claims,
        factors: stored.consent.factors.map(factor => ({
          ...factor,
          issuedAt: DateTime.fromSeconds(factor.issuedAt, { zone: 'utc' }),
          authenticatedAt: DateTime.fromSeconds(factor.authenticatedAt, { zone: 'utc' }),
        })),
      },
      issuedAt: DateTime.fromSeconds(stored.issuedAt, { zone: 'utc' }),
    };
  }

  private codeKey(code: string) {
    return `oauth_code_${code}`;
  }

  private consumedKey(code: string) {
    return `oauth_code_consumed_${code}`;
  }
}

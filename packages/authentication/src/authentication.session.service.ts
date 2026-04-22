import { Injectable } from 'injectkit';
import { unauthorizedError } from '@maroonedsoftware/errors';
import { DateTime, Duration } from 'luxon';
import { deepmergeCustom } from 'deepmerge-ts';
import { AuthenticationSession, AuthenticationSessionFactor } from './authentication.context.js';
import { CacheProvider } from '@maroonedsoftware/cache';
import { JwtProvider } from './providers/jwt.provider.js';

/**
 * Configuration options for {@link AuthenticationSessionService}.
 */
@Injectable()
export class AuthenticationSessionServiceOptions {
  constructor(
    /** The `iss` claim value to embed in issued JWTs (e.g. `"https://auth.example.com"`). */
    public readonly issuer: string,
    /** The `aud` claim value(s) to embed in issued JWTs. */
    public readonly audience: string | string[],
    /** Default session and token lifetime when no per-call expiration is provided. */
    public readonly expiresIn: Duration,
  ) {}
}

/**
 * Manages server-side authentication sessions backed by a {@link CacheProvider}.
 *
 * A session is the canonical record of an authenticated actor. JWTs are
 * short-lived signed references to a session; revoking the session invalidates
 * all tokens derived from it regardless of their individual expiry claims.
 *
 * @example
 * ```typescript
 * const session = await sessionService.createSession(userId, { plan: 'pro' }, passwordFactor);
 * const token   = await sessionService.generateAuthToken(session.token);
 * ```
 */
@Injectable()
export class AuthenticationSessionService {
  constructor(
    private readonly options: AuthenticationSessionServiceOptions,
    private readonly cache: CacheProvider,
    private readonly jwtProvider: JwtProvider,
  ) {}

  private getSessionKey(id: string) {
    return `auth_session_${id}`;
  }

  private getSubjectKey(id: string) {
    return `auth_session_subject_${id}`;
  }

  /**
   * Create a new session and store it in cache.
   *
   * @param subject    - The subject identifier (typically a user id).
   * @param claims     - Arbitrary key/value pairs to embed in tokens issued from this session.
   * @param factors    - One or more authentication factors that have been satisfied.
   * @param expiration - Session lifetime; defaults to {@link AuthenticationSessionServiceOptions.expiresIn}.
   * @returns The newly created {@link AuthenticationSession}.
   */
  async createSession(
    subject: string,
    claims: Record<string, unknown>,
    factors: AuthenticationSessionFactor | AuthenticationSessionFactor[],
    expiration?: Duration,
  ) {
    const sessionToken = crypto.randomUUID();
    const now = DateTime.utc();
    expiration ??= this.options.expiresIn;

    const session: AuthenticationSession = {
      token: sessionToken,
      subject,
      issuedAt: now.toUnixInteger(),
      expiresAt: now.plus(expiration).toUnixInteger(),
      lastAccessedAt: now.toUnixInteger(),
      factors: Array.isArray(factors) ? factors : [factors],
      claims,
    };

    await this.cache.set(this.getSessionKey(sessionToken), JSON.stringify(session), expiration);

    await this.ensureSubjectSession(subject, sessionToken, expiration);

    return session;
  }

  /**
   * Update an existing session's claims and/or factors and extend its expiry.
   *
   * Claims are deep-merged into the existing session claims (arrays are de-duplicated).
   * For factors, an existing entry with the same `methodId` has its `authenticatedAt`
   * updated; a new `methodId` is appended.
   *
   * @param sessionToken - The opaque session token from {@link AuthenticationSession.token}.
   * @param subject      - Must match the session's recorded subject; throws 401 otherwise.
   * @param expiration   - Additional time to extend the session by; defaults to {@link AuthenticationSessionServiceOptions.expiresIn}.
   * @param claims       - Additional claims to deep-merge into the session.
   * @param factor       - Factor to upsert into the session's factor list.
   * @returns The updated {@link AuthenticationSession}.
   * @throws 401 when the session does not exist or the subject does not match.
   */
  async updateSession(
    sessionToken: string,
    subject: string,
    expiration?: Duration,
    claims?: Record<string, unknown>,
    factor?: AuthenticationSessionFactor,
  ) {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (session.subject !== subject) {
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `Session subject ${session.subject} does not match ${subject}`,
      });
    }

    const deepmerge = deepmergeCustom({
      mergeArrays: values => {
        try {
          const set = new Set(values.flat());
          return Array.from(set);
        } catch {
          return values.flat();
        }
      },
    });

    if (claims) {
      session.claims = deepmerge(session.claims, claims);
    }

    if (factor) {
      const found = session.factors.find(x => x.methodId === factor.methodId);
      if (found) {
        found.authenticatedAt = factor.authenticatedAt;
      } else {
        session.factors.push(factor);
      }
    }

    expiration ??= this.options.expiresIn;

    session.expiresAt = DateTime.fromSeconds(session.expiresAt).plus(expiration).toUnixInteger();
    session.lastAccessedAt = DateTime.utc().toUnixInteger();

    await this.cache.update(this.getSessionKey(sessionToken), JSON.stringify(session), expiration);
    await this.ensureSubjectSession(session.subject, sessionToken, expiration);

    return session;
  }

  /**
   * Create a new session or update an existing one, depending on whether a valid
   * `sessionToken` is provided and resolves to a cached session.
   *
   * @param sessionToken - Optional existing session token. If provided and the session
   *   still exists in cache, the session is updated; otherwise a new session is created.
   * @param subject      - Subject identifier for the session.
   * @param claims       - Claims to set or merge.
   * @param factor       - Factor to record on the session.
   * @param expiration   - Session lifetime override.
   * @returns The created or updated {@link AuthenticationSession}.
   */
  async createOrUpdateSession(
    sessionToken: string | undefined,
    subject: string,
    claims: Record<string, unknown>,
    factor: AuthenticationSessionFactor,
    expiration?: Duration,
  ) {
    if (sessionToken) {
      const session = await this.getSession(sessionToken);

      if (session) {
        return await this.updateSession(sessionToken, subject, expiration, claims, factor);
      }
    }

    return await this.createSession(subject, claims, factor, expiration);
  }

  /**
   * Validate a JWT and retrieve the session it references.
   *
   * Decodes and verifies the JWT, then looks up the embedded `sessionToken` in
   * cache and cross-checks that the session subject matches the JWT subject.
   *
   * @param jwt                 - The signed JWT string to validate.
   * @param ignoreJwtExpiration - When `true`, an expired JWT is still decoded
   *   (useful for refresh flows where the session itself controls expiry).
   * @returns An object containing the {@link AuthenticationSession} and the decoded JWT payload.
   * @throws 401 when the JWT is invalid, the session is not found, or the subjects don't match.
   */
  async lookupSessionFromJwt(jwt: string, ignoreJwtExpiration?: boolean) {
    const jwtPayload = this.jwtProvider.decode(jwt, this.options.issuer, ignoreJwtExpiration);
    if (!jwtPayload) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    const session = await this.getSession(jwtPayload.sessionToken ?? '');

    if (!session) {
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `unable to find session ${jwtPayload.sessionToken}`,
      });
    }

    if (session.subject !== jwtPayload.subject) {
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `session ${jwtPayload.sessionToken} not valid for ${jwtPayload.subject}`,
      });
    }

    return { session, jwtPayload };
  }

  /**
   * Delete a session from cache, effectively revoking all tokens issued from it.
   * Does nothing if the session does not exist.
   *
   * @param sessionToken - The opaque session token to delete.
   */
  async deleteSession(sessionToken: string) {
    const session = await this.getSession(sessionToken);

    if (session) {
      await this.cache.delete(this.getSessionKey(sessionToken));
      await this.removeSubjectSession(session.subject, sessionToken);
    }
  }

  /**
   * Retrieve a session from cache by its token.
   *
   * @param sessionToken - The opaque session token.
   * @returns The {@link AuthenticationSession}, or `undefined` if not found.
   */
  async getSession(sessionToken: string) {
    const response = await this.cache.get(this.getSessionKey(sessionToken));

    if (response) {
      return JSON.parse(response) as AuthenticationSession;
    }
  }

  /**
   * Retrieve all active sessions for a given subject.
   * Sessions that have expired and been evicted from cache are silently omitted.
   *
   * @param subject - The subject identifier to look up.
   * @returns An array of active {@link AuthenticationSession} objects.
   */
  async getSessionsForSubject(subject: string) {
    const tokens = await this.getSubjectSessions(subject);
    const tasks = tokens.map(x => this.getSession(x));
    const sessions = await Promise.all(tasks);
    return sessions.filter(x => x !== undefined) as AuthenticationSession[];
  }

  private async getSubjectSessions(subject: string) {
    const response = await this.cache.get(this.getSubjectKey(subject));

    if (response) {
      return JSON.parse(response) as Array<string>;
    }

    return [];
  }

  private async ensureSubjectSession(subject: string, sessionToken: string, expiration: Duration) {
    const subjectSessions = await this.getSubjectSessions(subject);
    if (!subjectSessions.includes(sessionToken)) {
      subjectSessions.push(sessionToken);
      await this.cache.set(this.getSubjectKey(subject), JSON.stringify(subjectSessions), expiration);
    }
  }

  private async removeSubjectSession(subject: string, sessionToken: string) {
    const subjectSessions = await this.getSubjectSessions(subject);
    const idx = subjectSessions.indexOf(sessionToken);
    if (idx > -1) {
      subjectSessions.splice(idx, 1);
      await this.cache.update(this.getSubjectKey(subject), JSON.stringify(subjectSessions));
    }
  }

  /**
   * Issue a signed JWT for an existing session.
   *
   * The JWT embeds the session's claims, factors, and `sessionToken` so the
   * server can look up the full session on subsequent requests.
   *
   * @param sessionToken - The opaque session token to generate a JWT for.
   * @returns An {@link AuthenticationToken} (Bearer token response).
   * @throws 401 when no session exists for the given token.
   */
  async generateAuthToken(sessionToken: string) {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    const { claims, subject, factors } = session;

    const { token, decoded } = this.jwtProvider.create(
      {
        ...claims,
        sessionToken,
        factors,
      },
      subject,
      this.options.issuer,
      this.options.audience,
      this.options.expiresIn,
    );

    const future = DateTime.utc().plus(decoded.exp ?? 0);

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: future.toUnixInteger(),
      scope: decoded.scope ? decoded.scope.join(' ') : '',
    };
  }
}

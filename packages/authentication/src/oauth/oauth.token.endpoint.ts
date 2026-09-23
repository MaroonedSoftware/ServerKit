import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';
import { AuditRecorder } from '../audit/audit.recorder.js';
import { AuthenticationSessionService } from '../authentication.session.service.js';
import type { AuthenticationToken } from '../types.js';
import { AuthorizationCodeService } from './authorization.code.service.js';
import { OAuthAuthorizationServerOptions } from './oauth.authorization.server.options.js';
import { OAuthClientResolver } from './oauth.client.resolver.js';
import { IsOAuthError, OAuthError } from './oauth.error.js';
import { OAuthGrantRepository } from './oauth.grant.repository.js';
import { getOAuthSessionClaim, type OAuthSessionClaim } from './oauth.session.claim.js';
import type { OAuthClient, TokenResponse } from './oauth.types.js';

/** The request headers the token endpoint reads. */
export interface OAuthTokenRequestHeaders {
  authorization?: string;
}

const toResponse = (tokens: AuthenticationToken, scope: string[]): TokenResponse => ({
  access_token: tokens.accessToken,
  token_type: 'Bearer',
  expires_in: tokens.expiresIn,
  ...(tokens.refreshToken === undefined ? {} : { refresh_token: tokens.refreshToken }),
  scope: scope.join(' '),
});

/**
 * The token endpoint's logic ([RFC 6749 §3.2](https://datatracker.ietf.org/doc/html/rfc6749#section-3.2)):
 * the `authorization_code` and `refresh_token` grants.
 *
 * A code exchange mints an ordinary {@link AuthenticationSessionService} session
 * for the consenting user, carrying their claims and factors plus
 * `claims.oauth` ({@link OAuthSessionClaim}), with the requested resource as its
 * audience; so its tokens are refused everywhere but that resource. A refresh
 * rotates that session's refresh token, bound to the client it was issued to
 * and, with a grant repository, to a grant that is not revoked.
 *
 * The consumer owns the route: parse the form or JSON body into strings, pass
 * the `Authorization` header, answer `Cache-Control: no-store`, and render an
 * {@link OAuthError} as its RFC body. Every refusal is an `OAuthError`.
 */
@Injectable()
export class OAuthTokenEndpoint {
  constructor(
    private readonly sessions: AuthenticationSessionService,
    private readonly clients: OAuthClientResolver,
    private readonly codes: AuthorizationCodeService,
    private readonly options: OAuthAuthorizationServerOptions,
    /** Optional: without it no grant is recorded or checked. */
    private readonly grants?: OAuthGrantRepository,
    private readonly audit: AuditRecorder = new AuditRecorder(),
  ) {}

  /**
   * Answer a token request.
   *
   * @param body - The request body's parameters, form or JSON, untrusted.
   * @param headers - The request's `Authorization` header, for `client_secret_basic`.
   * @throws OAuthError for every protocol failure: `invalid_request`,
   *   `invalid_client` (401), `invalid_grant`, `invalid_target`, or `unsupported_grant_type`.
   */
  async exchange(body: Record<string, unknown>, headers: OAuthTokenRequestHeaders = {}): Promise<TokenResponse> {
    let grantType: string | undefined;
    let clientId: string | undefined;
    try {
      grantType = this.field(body, 'grant_type');
      clientId = this.field(body, 'client_id');
      switch (grantType) {
        case 'authorization_code':
          return await this.exchangeCode(body, headers);
        case 'refresh_token':
          return await this.refresh(body, headers);
        case undefined:
          throw new OAuthError('invalid_request', 'grant_type is required');
        default:
          throw new OAuthError('unsupported_grant_type', 'only authorization_code and refresh_token are supported');
      }
    } catch (error) {
      if (IsOAuthError(error)) {
        await this.audit.record({
          type: 'oauth.token.rejected',
          category: 'login',
          outcome: 'failure',
          data: {
            reason: error.code,
            ...(grantType === undefined ? {} : { grantType }),
            ...(clientId === undefined ? {} : { clientId }),
          },
        });
      }
      throw error;
    }
  }

  private async exchangeCode(body: Record<string, unknown>, headers: OAuthTokenRequestHeaders): Promise<TokenResponse> {
    const client = await this.authenticate(body, headers);
    const code = this.required(body, 'code');
    const redirectUri = this.required(body, 'redirect_uri');
    const codeVerifier = this.required(body, 'code_verifier');
    const resource = this.field(body, 'resource');

    const issued = await this.codes.redeem(code, {
      clientId: client.clientId,
      redirectUri,
      codeVerifier,
      ...(resource === undefined ? {} : { resource }),
    });
    const { request, consent } = issued;

    const grant = this.grants
      ? await this.grants.upsert({ clientId: client.clientId, subject: consent.subject, resource: request.resource, scope: request.scope })
      : undefined;

    const oauth: OAuthSessionClaim = {
      clientId: client.clientId,
      ...(client.clientName === undefined ? {} : { clientName: client.clientName }),
      resource: request.resource,
      scope: request.scope,
      ...(grant === undefined ? {} : { grantId: grant.id }),
    };

    const session = await this.sessions.createSession(
      consent.subject,
      { ...consent.claims, oauth },
      consent.factors,
      this.options.sessionExpiration,
      undefined,
      request.resource,
    );
    const tokens = await this.sessions.issueTokenForSession(session.sessionToken);

    const now = DateTime.utc();
    await this.clients.recordUse(client, now);
    if (grant) await this.grants?.recordUse(grant.id, now);

    await this.audit.record({
      type: 'oauth.token.issued',
      category: 'login',
      outcome: 'success',
      actorId: consent.subject,
      data: {
        clientId: client.clientId,
        resource: request.resource,
        sessionToken: session.sessionToken,
        ...(grant === undefined ? {} : { grantId: grant.id }),
      },
    });

    return toResponse(tokens, request.scope);
  }

  private async refresh(body: Record<string, unknown>, headers: OAuthTokenRequestHeaders): Promise<TokenResponse> {
    const client = await this.authenticate(body, headers);
    const refreshToken = this.required(body, 'refresh_token');
    const resource = this.field(body, 'resource');
    if (resource !== undefined && !this.options.resources.includes(resource)) {
      throw new OAuthError('invalid_target', 'resource is not served by this authorization server');
    }

    let claim: OAuthSessionClaim | undefined;
    let subject: string | undefined;
    let tokens: AuthenticationToken;
    try {
      // Only this server's resources: a refresh token minted for anything else,
      // such as the consumer's own console, is refused here unspent.
      tokens = await this.sessions.refreshSession(refreshToken, resource === undefined ? [...this.options.resources] : [resource], async session => {
        const oauth = getOAuthSessionClaim(session);
        if (!oauth || oauth.clientId !== client.clientId) {
          throw new OAuthError('invalid_grant', 'the refresh token was not issued to this client');
        }
        if (this.grants && oauth.grantId !== undefined) {
          const grant = await this.grants.find(oauth.grantId);
          if (!grant || grant.revokedAt !== undefined) {
            throw new OAuthError('invalid_grant', 'the grant has been revoked');
          }
        }
        claim = oauth;
        subject = session.subject;
      });
    } catch (error) {
      if (IsOAuthError(error)) throw error;
      if (IsHttpError(error) && error.statusCode >= 400 && error.statusCode < 500) {
        throw new OAuthError('invalid_grant', 'the refresh token is invalid, expired, or revoked').withCause(error);
      }
      throw error;
    }

    const granted = claim as OAuthSessionClaim;
    const now = DateTime.utc();
    await this.clients.recordUse(client, now);
    if (granted.grantId !== undefined) await this.grants?.recordUse(granted.grantId, now);

    await this.audit.record({
      type: 'oauth.token.refreshed',
      category: 'login',
      outcome: 'success',
      ...(subject === undefined ? {} : { actorId: subject }),
      data: { clientId: client.clientId, resource: granted.resource, ...(granted.grantId === undefined ? {} : { grantId: granted.grantId }) },
    });

    return toResponse(tokens, granted.scope);
  }

  private async authenticate(body: Record<string, unknown>, headers: OAuthTokenRequestHeaders): Promise<OAuthClient> {
    const clientId = this.field(body, 'client_id');
    const clientSecret = this.field(body, 'client_secret');
    return await this.clients.authenticate({
      ...(clientId === undefined ? {} : { clientId }),
      ...(clientSecret === undefined ? {} : { clientSecret }),
      ...(headers.authorization === undefined ? {} : { authorization: headers.authorization }),
    });
  }

  /** A string parameter, `undefined` when absent or blank. A repeated or non-string one is refused. */
  private field(body: Record<string, unknown>, name: string): string | undefined {
    const value = body[name];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string') {
      throw new OAuthError('invalid_request', `${name} must be a single string`);
    }
    return value;
  }

  private required(body: Record<string, unknown>, name: string): string {
    const value = this.field(body, name);
    if (value === undefined) throw new OAuthError('invalid_request', `${name} is required`);
    return value;
  }
}

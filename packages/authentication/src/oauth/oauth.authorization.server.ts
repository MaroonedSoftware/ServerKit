import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AuditRecorder } from '../audit/audit.recorder.js';
import { AuthorizationCodeService, type AuthorizationConsent } from './authorization.code.service.js';
import { buildAuthorizationRedirect } from './authorization.redirect.js';
import { parseAuthorizationRequest, type AuthorizationRequestQuery } from './authorization.request.js';
import { AuthorizationRequestStore } from './authorization.request.store.js';
import { buildAuthorizationServerMetadata, type AuthorizationServerMetadata } from './authorization.server.metadata.js';
import { DynamicClientRegistrationService, type DynamicClientRegistrationResponse } from './dynamic.client.registration.service.js';
import { OAuthAuthorizationServerOptions } from './oauth.authorization.server.options.js';
import { OAuthClientResolver } from './oauth.client.resolver.js';
import { IsOAuthError } from './oauth.error.js';
import { OAuthTokenEndpoint, type OAuthTokenRequestHeaders } from './oauth.token.endpoint.js';
import type { OAuthClient, OAuthClientKind, OAuthErrorCode, TokenResponse } from './oauth.types.js';
import { buildProtectedResourceMetadata, type ProtectedResourceMetadata } from './protected.resource.metadata.js';
import { describeRedirect } from './redirect.uri.js';

/**
 * What the consent page needs, or what to do instead of showing it.
 *
 * - `context`: show consent for `requestId`. Everything about the client was
 *   supplied by the client itself (bar `clientKind`), so present it as a claim,
 *   not a fact: the redirect host is what the user should check.
 * - `redirect`: send the browser to `redirectUrl`; it carries the error, `state`, and `iss`.
 * - `refuse`: show the error. Never redirect.
 */
export type AuthorizationContextResult =
  | {
      kind: 'context';
      requestId: string;
      clientId: string;
      clientKind: OAuthClientKind;
      clientName?: string;
      clientUri?: string;
      logoUri?: string;
      /** Where the user will be sent back to, with its port. */
      redirectHost: string;
      /** Every registered redirect is on the user's own machine. Expected for a CLI; say so. */
      loopbackOnly: boolean;
      scope: string[];
      resource: string;
    }
  | { kind: 'redirect'; redirectUrl: string }
  | { kind: 'refuse'; error: OAuthErrorCode; description: string };

/**
 * An OAuth 2.1 authorization server for MCP clients, as one object for the
 * consumer's routes to call. The package owns no HTTP: each method answers a
 * structured result or throws an {@link OAuthError} for the route to render.
 *
 * | Route (the consumer's)                          | Method                                       |
 * | ----------------------------------------------- | -------------------------------------------- |
 * | `/.well-known/oauth-authorization-server`       | {@link metadata}                             |
 * | `/.well-known/oauth-protected-resource/<path>`  | {@link resourceMetadata}                     |
 * | consent page, on load (user signed in)          | {@link describeAuthorizationRequest}         |
 * | consent page, Allow / Deny                      | {@link approve} / {@link deny}               |
 * | registration (JSON, answers 201)                | {@link register}                             |
 * | token (form or JSON, `Cache-Control: no-store`) | {@link token}                                |
 *
 * Register it scoped: it reaches the session service, which is.
 */
@Injectable()
export class OAuthAuthorizationServer {
  constructor(
    private readonly options: OAuthAuthorizationServerOptions,
    private readonly clients: OAuthClientResolver,
    private readonly requests: AuthorizationRequestStore,
    private readonly codes: AuthorizationCodeService,
    private readonly tokens: OAuthTokenEndpoint,
    /** Optional: without it, or without a registration endpoint, registration is off. */
    private readonly registration?: DynamicClientRegistrationService,
    private readonly audit: AuditRecorder = new AuditRecorder(),
  ) {}

  /** Whether Dynamic Client Registration is on. */
  get registrationEnabled(): boolean {
    return this.options.registrationEndpoint !== undefined && this.registration !== undefined;
  }

  /** The RFC 8414 authorization server metadata document. */
  metadata(): AuthorizationServerMetadata {
    return buildAuthorizationServerMetadata({
      issuer: this.options.issuer,
      authorizationEndpoint: this.options.authorizationEndpoint,
      tokenEndpoint: this.options.tokenEndpoint,
      ...(this.registrationEnabled && this.options.registrationEndpoint !== undefined
        ? { registrationEndpoint: this.options.registrationEndpoint }
        : {}),
      scopesSupported: this.options.scopesSupported,
      clientIdMetadataDocumentSupported: this.clients.supportsMetadataDocuments,
    });
  }

  /** The RFC 9728 metadata document for one of the server's resources, or `undefined` for anything else. */
  resourceMetadata(resource: string): ProtectedResourceMetadata | undefined {
    if (!this.options.resources.includes(resource)) return undefined;
    return buildProtectedResourceMetadata({
      resource,
      authorizationServers: [this.options.issuer],
      scopesSupported: this.options.scopesSupported,
    });
  }

  /**
   * Validate an authorization request for the signed-in `subject` and stash it
   * for their decision.
   *
   * @param query - The authorization request's query parameters.
   * @param subject - The signed-in user who will decide. Only they can approve or deny it.
   */
  async describeAuthorizationRequest(query: AuthorizationRequestQuery, subject: string): Promise<AuthorizationContextResult> {
    const clientId = query['client_id'];
    if (typeof clientId !== 'string' || clientId.length === 0) {
      return { kind: 'refuse', error: 'invalid_request', description: 'client_id is missing or repeated' };
    }

    let client: OAuthClient;
    try {
      client = await this.clients.resolve(clientId);
    } catch (error) {
      if (IsOAuthError(error)) return { kind: 'refuse', error: error.code, description: error.description };
      throw error;
    }

    const parsed = parseAuthorizationRequest(query, client, { resources: this.options.resources, scopesSupported: this.options.scopesSupported });
    switch (parsed.kind) {
      case 'refuse':
        return parsed;
      case 'redirect':
        return {
          kind: 'redirect',
          redirectUrl: buildAuthorizationRedirect(parsed.redirectUri, {
            error: parsed.error,
            error_description: parsed.description,
            ...(parsed.state === undefined ? {} : { state: parsed.state }),
            iss: this.options.issuer,
          }),
        };
      case 'valid': {
        const { request } = parsed;
        const requestId = await this.requests.stash(request, subject);
        const { host, loopbackOnly } = describeRedirect(request.redirectUri, client.redirectUris);
        return {
          kind: 'context',
          requestId,
          clientId: client.clientId,
          clientKind: client.kind,
          ...(client.clientName === undefined ? {} : { clientName: client.clientName }),
          ...(client.clientUri === undefined ? {} : { clientUri: client.clientUri }),
          ...(client.logoUri === undefined ? {} : { logoUri: client.logoUri }),
          redirectHost: host,
          loopbackOnly,
          scope: request.scope,
          resource: request.resource,
        };
      }
    }
  }

  /**
   * The user allowed the request: issue a code and answer where to send them.
   *
   * @param consent - The consenting user's subject, and the claims and factors
   *   of the session they consented from. The client's session is minted from them.
   * @throws HTTP 404 when `requestId` is unknown, expired, already decided, or not the subject's.
   */
  async approve(requestId: string, consent: AuthorizationConsent): Promise<{ redirectUrl: string }> {
    const request = await this.requests.take(requestId, consent.subject);
    if (!request) throw httpError(404).withDetails({ requestId: 'not found or expired' });

    const code = await this.codes.issue(request, consent);

    await this.audit.record({
      type: 'oauth.authorization.approved',
      category: 'privilege',
      outcome: 'success',
      actorId: consent.subject,
      data: { clientId: request.clientId, resource: request.resource, scope: request.scope },
    });

    return {
      redirectUrl: buildAuthorizationRedirect(request.redirectUri, {
        code,
        ...(request.state === undefined ? {} : { state: request.state }),
        iss: this.options.issuer,
      }),
    };
  }

  /**
   * The user denied the request: answer where to send them, with `access_denied`.
   *
   * @throws HTTP 404 when `requestId` is unknown, expired, already decided, or not the subject's.
   */
  async deny(requestId: string, subject: string): Promise<{ redirectUrl: string }> {
    const request = await this.requests.take(requestId, subject);
    if (!request) throw httpError(404).withDetails({ requestId: 'not found or expired' });

    await this.audit.record({
      type: 'oauth.authorization.denied',
      category: 'privilege',
      outcome: 'success',
      actorId: subject,
      data: { clientId: request.clientId, resource: request.resource },
    });

    return {
      redirectUrl: buildAuthorizationRedirect(request.redirectUri, {
        error: 'access_denied',
        error_description: 'the user denied the request',
        ...(request.state === undefined ? {} : { state: request.state }),
        iss: this.options.issuer,
      }),
    };
  }

  /**
   * Dynamic Client Registration. Answer 201 with `response`.
   *
   * @throws HTTP 404 when registration is off.
   * @throws OAuthError `invalid_redirect_uri` or `invalid_client_metadata`.
   */
  async register(body: unknown): Promise<{ client: OAuthClient; response: DynamicClientRegistrationResponse }> {
    if (!this.registrationEnabled || !this.registration) throw httpError(404);
    return await this.registration.register(body);
  }

  /** The token endpoint. See {@link OAuthTokenEndpoint.exchange}. */
  async token(body: Record<string, unknown>, headers: OAuthTokenRequestHeaders = {}): Promise<TokenResponse> {
    return await this.tokens.exchange(body, headers);
  }
}

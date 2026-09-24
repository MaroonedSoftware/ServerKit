import { vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { DateTime, Duration } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { AuthenticationSessionService, AuthenticationSessionServiceOptions } from '../../src/authentication.session.service.js';
import { JwtProvider } from '../../src/providers/jwt.provider.js';
import type { AuthenticationSessionFactor } from '../../src/types.js';
import { AuthorizationCodeService, AuthorizationCodeServiceOptions } from '../../src/oauth/authorization.code.service.js';
import { AuthorizationRequestStore, AuthorizationRequestStoreOptions } from '../../src/oauth/authorization.request.store.js';
import type { ClientIdMetadataDocumentResolver } from '../../src/oauth/client.id.metadata.document.resolver.js';
import { DynamicClientRegistrationService } from '../../src/oauth/dynamic.client.registration.service.js';
import { OAuthAuthorizationServer } from '../../src/oauth/oauth.authorization.server.js';
import { OAuthAuthorizationServerOptions } from '../../src/oauth/oauth.authorization.server.options.js';
import { OAuthClientOptions } from '../../src/oauth/oauth.client.options.js';
import { OAuthClientResolver } from '../../src/oauth/oauth.client.resolver.js';
import { OAuthGrantRepository, type OAuthGrant, type OAuthGrantInput } from '../../src/oauth/oauth.grant.repository.js';
import { OAuthTokenEndpoint } from '../../src/oauth/oauth.token.endpoint.js';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { AuditRecorder } from '../../src/audit/audit.recorder.js';
import type { AuditSink } from '../../src/audit/audit.sink.js';
import type { AuthenticationAuditEvent } from '../../src/audit/audit.event.js';
import { OAuthClientRepository } from '../../src/oauth/oauth.client.repository.js';
import type { OAuthClient } from '../../src/oauth/oauth.types.js';

/** A Map-backed cache with real set-if-absent semantics. */
export const makeCache = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    add: vi.fn(async (key: string, value: string) => (store.has(key) ? false : (store.set(key, value), true))),
    update: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    delete: vi.fn(async (key: string) => (store.delete(key) ? key : null)),
  } as unknown as CacheProvider & { store: Map<string, string> };
};

/** A Map-backed client repository. */
export class FakeClientRepository extends OAuthClientRepository {
  readonly clients = new Map<string, OAuthClient>();
  readonly touches: { clientId: string; at: DateTime; extendTo?: DateTime }[] = [];

  async findByClientId(clientId: string) {
    return this.clients.get(clientId);
  }

  async create(client: OAuthClient) {
    this.clients.set(client.clientId, client);
    return client;
  }

  async touchLastUsed(clientId: string, at: DateTime, extendTo?: DateTime) {
    this.touches.push({ clientId, at, ...(extendTo === undefined ? {} : { extendTo }) });
  }

  async deleteExpired(before: DateTime) {
    let count = 0;
    for (const [id, client] of this.clients) {
      if (client.expiresAt !== undefined && client.expiresAt < before) {
        this.clients.delete(id);
        count += 1;
      }
    }
    return count;
  }
}

/** An audit recorder that keeps every event. */
export const makeCapturingRecorder = () => {
  const events: AuthenticationAuditEvent[] = [];
  const recorder = new AuditRecorder({ record: (event: AuthenticationAuditEvent) => void events.push(event) } as unknown as AuditSink);
  return { events, recorder };
};

/** A Map-backed grant repository, one grant per (client, subject, resource). */
export class FakeGrantRepository extends OAuthGrantRepository {
  readonly grants = new Map<string, OAuthGrant>();
  readonly uses: { id: string; at: DateTime }[] = [];
  private next = 0;

  async upsert(input: OAuthGrantInput) {
    const existing = [...this.grants.values()].find(
      grant => grant.clientId === input.clientId && grant.subject === input.subject && grant.resource === input.resource,
    );
    const grant: OAuthGrant = existing
      ? { ...existing, scope: input.scope, revokedAt: undefined }
      : { id: `grant-${++this.next}`, ...input, createdAt: DateTime.utc() };
    this.grants.set(grant.id, grant);
    return grant;
  }

  async find(id: string) {
    return this.grants.get(id);
  }

  async recordUse(id: string, at: DateTime) {
    this.uses.push({ id, at });
  }

  revoke(id: string) {
    const grant = this.grants.get(id);
    if (grant) this.grants.set(id, { ...grant, revokedAt: DateTime.utc() });
  }
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export const ISSUER = 'https://station.example.com';
export const RESOURCE = 'https://station.example.com/api/mcp';
export const CONSOLE_AUDIENCE = 'console';

// RFC 7636 Appendix B.
export const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

export const CONSENT_FACTOR: AuthenticationSessionFactor = {
  method: 'password',
  methodId: 'pw-1',
  kind: 'knowledge',
  issuedAt: DateTime.fromSeconds(1_700_000_000, { zone: 'utc' }),
  authenticatedAt: DateTime.fromSeconds(1_700_000_500, { zone: 'utc' }),
};

/**
 * The whole authorization server over in-memory stores and a real JwtProvider,
 * so audiences are genuinely signed and verified.
 */
export const makeAuthorizationServerHarness = (
  overrides: {
    grants?: OAuthGrantRepository;
    registration?: boolean;
    metadataDocuments?: ClientIdMetadataDocumentResolver;
    scopesSupported?: readonly string[];
  } = {},
) => {
  const cache = makeCache();
  const { events, recorder } = makeCapturingRecorder();
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
  const sessions = new AuthenticationSessionService(
    new AuthenticationSessionServiceOptions(ISSUER, CONSOLE_AUDIENCE, Duration.fromObject({ hours: 1 }), Duration.fromObject({ days: 30 })),
    cache,
    new JwtProvider(logger, privateKey),
    recorder,
  );
  const repository = new FakeClientRepository();
  const clientOptions = new OAuthClientOptions();
  const clients = new OAuthClientResolver(repository, clientOptions, overrides.metadataDocuments);
  const requests = new AuthorizationRequestStore(cache, new AuthorizationRequestStoreOptions());
  const codes = new AuthorizationCodeService(cache, new AuthorizationCodeServiceOptions());
  const registration = overrides.registration ?? true;
  const options = new OAuthAuthorizationServerOptions(
    ISSUER,
    `${ISSUER}/oauth/authorize`,
    `${ISSUER}/api/auth/oauth/token`,
    [RESOURCE],
    overrides.scopesSupported ?? ['mcp'],
    registration ? `${ISSUER}/api/auth/oauth/register` : undefined,
  );
  const tokens = new OAuthTokenEndpoint(sessions, clients, codes, options, overrides.grants, recorder);
  const server = new OAuthAuthorizationServer(
    options,
    clients,
    requests,
    codes,
    tokens,
    registration ? new DynamicClientRegistrationService(repository, clientOptions, recorder) : undefined,
    recorder,
  );
  return { server, tokens, sessions, codes, repository, cache, events, options };
};

/** A stored public client with one https and one loopback redirect. */
export const PUBLIC_CLIENT: OAuthClient = {
  clientId: 'dyn_claude',
  kind: 'dynamic',
  clientName: 'Claude',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'],
  tokenEndpointAuthMethod: 'none',
  expiresAt: DateTime.utc().plus({ days: 90 }),
};

/** A complete, valid authorization request query for {@link PUBLIC_CLIENT}. */
export const authorizeQuery = (overrides: Record<string, string | undefined> = {}) => ({
  client_id: PUBLIC_CLIENT.clientId,
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  response_type: 'code',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'client-state',
  resource: RESOURCE,
  scope: 'mcp',
  ...overrides,
});

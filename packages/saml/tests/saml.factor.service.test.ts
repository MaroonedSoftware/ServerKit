import { inflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { AuditRecorder, type AuditSink, type AuthenticationAuditEvent } from '@maroonedsoftware/authentication';
import type { CacheProvider } from '@maroonedsoftware/cache';
import { HttpError } from '@maroonedsoftware/errors';
import type { PolicyResult, PolicyService } from '@maroonedsoftware/policies';
import { SamlProviderRegistry, SamlProviderRegistryConfig, type SamlProviderConfig } from '../src/saml.provider.js';
import { SamlActorEmailLookup, SamlFactorService, SamlFactorServiceOptions, type SamlAuthorizationResult } from '../src/saml.factor.service.js';
import { SamlFactorRepository, type SamlFactor, type SamlFactorValue } from '../src/saml.factor.repository.js';
import {
  ACS_URL,
  ATTACKER,
  IDP_CURRENT,
  IDP_ENTITY_ID,
  IDP_NEXT,
  SP_ENTITY_ID,
  buildResponse,
  type ResponseOptions,
} from './saml.response.builder.js';

/** An in-memory cache that honours TTLs and `add`'s only-if-absent contract. */
const makeCache = () => {
  const store = new Map<string, { value: string; expiresAt: DateTime }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= DateTime.utc()) store.delete(key);
    return store.get(key);
  };
  const cache: CacheProvider = {
    get: async key => live(key)?.value ?? null,
    set: async (key, value, ttl) => {
      store.set(key, { value, expiresAt: DateTime.utc().plus(ttl) });
    },
    add: async (key, value, options) => {
      if (live(key)) return false;
      store.set(key, { value, expiresAt: DateTime.utc().plus(options?.ttl ?? Duration.fromObject({ hours: 1 })) });
      return true;
    },
    update: async (key, value) => {
      const entry = live(key);
      if (entry) store.set(key, { ...entry, value });
    },
    delete: async key => {
      const value = live(key)?.value ?? null;
      store.delete(key);
      return value;
    },
  };
  return { cache, store };
};

const makeRepo = () => {
  const factors: SamlFactor[] = [];
  const repo = {
    createFactor: vi.fn(async (actorId: string, value: SamlFactorValue) => {
      const factor: SamlFactor = { id: `factor-${factors.length + 1}`, actorId, active: true, ...value };
      factors.push(factor);
      return factor;
    }),
    findFactor: vi.fn(async ({ provider, subject }: { provider: string; subject: string }) =>
      factors.find(factor => factor.provider === provider && factor.subject === subject),
    ),
    lookupFactor: vi.fn(async () => undefined),
    getFactor: vi.fn(),
    listFactors: vi.fn(async () => factors),
    updateEmail: vi.fn(async () => undefined),
    deleteFactor: vi.fn(async () => undefined),
  };
  return { repo: repo as unknown as SamlFactorRepository & typeof repo, factors };
};

const PROVIDER: SamlProviderConfig = {
  name: 'acme',
  spEntityId: SP_ENTITY_ID,
  acsUrl: new URL(ACS_URL),
  idpEntityId: IDP_ENTITY_ID,
  idpSsoUrl: new URL('https://idp.example.test/sso'),
  idpSigningCertificates: [IDP_CURRENT.cert],
};

describe('SamlFactorService', () => {
  let cache: ReturnType<typeof makeCache>;
  let repo: ReturnType<typeof makeRepo>;
  let findActorByEmail: ReturnType<typeof vi.fn<(email: string) => Promise<string | undefined>>>;
  let policyResult: PolicyResult;
  let events: AuthenticationAuditEvent[];
  let provider: SamlProviderConfig;

  const makeService = () => {
    const sink: AuditSink = { record: async event => void events.push(event) };
    const policyService = { check: vi.fn(async () => policyResult), assert: vi.fn() } as unknown as PolicyService;
    return new SamlFactorService(
      new SamlFactorServiceOptions(),
      new SamlProviderRegistry(new SamlProviderRegistryConfig([provider])),
      repo.repo,
      { findActorByEmail } as SamlActorEmailLookup,
      cache.cache,
      policyService,
      new AuditRecorder(sink),
    );
  };

  /** Begin a flow, answer it with a response built from `options`, and complete it. */
  const signIn = async (options: ResponseOptions = {}, begin: Partial<Parameters<SamlFactorService['beginAuthorization']>[0]> = {}) => {
    const service = makeService();
    const { requestId } = await service.beginAuthorization({ provider: 'acme', intent: 'sign-in', ...begin });
    const SAMLResponse = buildResponse({ inResponseTo: requestId, ...options });
    return {
      service,
      requestId,
      SAMLResponse,
      result: await service.completeAuthorization({ params: { SAMLResponse }, expectedRequestId: requestId }),
    };
  };

  /** The HTTP error a sign-in fails with. */
  const refusal = async (options: ResponseOptions = {}, begin: Partial<Parameters<SamlFactorService['beginAuthorization']>[0]> = {}) => {
    const error = await signIn(options, begin).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  };

  const failureReasons = () =>
    events.filter(event => event.type === 'saml.authorization.failed').map(event => (event.data as { reason: string }).reason);

  beforeEach(() => {
    cache = makeCache();
    repo = makeRepo();
    findActorByEmail = vi.fn(async () => undefined);
    policyResult = { allowed: true };
    events = [];
    provider = { ...PROVIDER };
  });

  describe('beginAuthorization', () => {
    const decodeRequest = (url: URL) => inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64')).toString('utf8');

    it('redirects to the IdP with an AuthnRequest for the provider', async () => {
      const { url, requestId, expiresAt } = await makeService().beginAuthorization({ provider: 'acme', intent: 'sign-in' });

      expect(url.origin + url.pathname).toBe('https://idp.example.test/sso');
      const request = decodeRequest(url);
      expect(request).toContain(`ID="${requestId}"`);
      expect(request).toContain(`AssertionConsumerServiceURL="${ACS_URL}"`);
      expect(request).toContain(`>${SP_ENTITY_ID}</saml:Issuer>`);
      expect(request).toContain('Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"');
      expect(request).not.toContain('ForceAuthn');
      expect(request).not.toContain('RequestedAuthnContext');
      expect(expiresAt > DateTime.utc()).toBe(true);
      expect(events.map(event => event.type)).toEqual(['saml.authorization.begun']);
    });

    it('forces re-authentication for a step-up and requests the accepted contexts', async () => {
      provider = { ...PROVIDER, acceptedAuthnContexts: ['http://schemas.microsoft.com/claims/multipleauthn'] };
      const { url } = await makeService().beginAuthorization({ provider: 'acme', intent: 'step-up', actorId: 'actor-1' });

      const request = decodeRequest(url);
      expect(request).toContain('ForceAuthn="true"');
      expect(request).toContain('Comparison="exact"');
      expect(request).toContain('>http://schemas.microsoft.com/claims/multipleauthn</saml:AuthnContextClassRef>');
    });

    it('refuses link and step-up without an actor, and an unknown provider', async () => {
      const service = makeService();
      await expect(service.beginAuthorization({ provider: 'acme', intent: 'link' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.beginAuthorization({ provider: 'acme', intent: 'step-up' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.beginAuthorization({ provider: 'other', intent: 'sign-in' })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('completeAuthorization', () => {
    it('accepts a response to the expected request', async () => {
      const service = makeService();
      const { requestId } = await service.beginAuthorization({ provider: 'acme', intent: 'sign-in' });
      const result = await service.completeAuthorization({
        params: { SAMLResponse: buildResponse({ inResponseTo: requestId }) },
        expectedRequestId: requestId,
      });
      expect(result.kind).toBe('new-user');
    });

    it('builds the profile from a valid assertion and stages a new user', async () => {
      const authnInstant = DateTime.utc().minus({ minutes: 2 }).startOf('second');
      const { result } = await signIn({ authnInstant, authnContextClassRef: 'http://schemas.microsoft.com/claims/multipleauthn' });

      expect(result.kind).toBe('new-user');
      expect(result.profile).toMatchObject({
        provider: 'acme',
        subject: '00u1ada',
        nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
        email: 'ada@acme.test',
        name: 'Ada Lovelace',
        authnContextClassRef: 'http://schemas.microsoft.com/claims/multipleauthn',
        sessionIndex: '_session1',
        issuer: IDP_ENTITY_ID,
        attributes: { email: 'ada@acme.test', displayName: 'Ada Lovelace' },
      });
      expect(result.profile.authnInstant?.equals(authnInstant)).toBe(true);
      expect(events.map(event => event.type)).toEqual(['saml.authorization.begun', 'saml.new_user']);
    });

    it('reads Entra ID claim names, an email NameID, and a configured attribute', async () => {
      const entra = await signIn({
        attributes: {
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'grace@acme.test',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Grace',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': 'Hopper',
        },
      });
      expect(entra.result.profile).toMatchObject({ email: 'grace@acme.test', name: 'Grace Hopper' });

      const nameId = await signIn({
        nameId: 'linus@acme.test',
        nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        attributes: {},
      });
      expect(nameId.result.profile.email).toBe('linus@acme.test');

      provider = { ...PROVIDER, attributeNames: { email: 'workEmail' } };
      const configured = await signIn({ attributes: { email: 'personal@example.test', workEmail: 'work@acme.test' } });
      expect(configured.result.profile.email).toBe('work@acme.test');
    });

    it('accepts a signature from any listed certificate, for rotation', async () => {
      provider = { ...PROVIDER, idpSigningCertificates: [IDP_CURRENT.cert, IDP_NEXT.cert] };
      expect((await signIn({ signWith: IDP_NEXT })).result.kind).toBe('new-user');
      expect((await signIn({ signWith: IDP_CURRENT })).result.kind).toBe('new-user');
    });

    it('accepts a response signed as well as its assertion', async () => {
      expect((await signIn({ signResponseWith: IDP_CURRENT })).result.kind).toBe('new-user');
    });

    it('signs in an existing factor and refreshes its email', async () => {
      await repo.repo.createFactor('actor-1', { provider: 'acme', subject: '00u1ada', email: 'old@acme.test' });

      const { result } = await signIn();

      expect(result).toMatchObject({ kind: 'signed-in', intent: 'sign-in', actorId: 'actor-1', factorId: 'factor-1' });
      expect(repo.repo.updateEmail).toHaveBeenCalledWith('factor-1', 'ada@acme.test');
    });

    it('records the redirect the flow began with', async () => {
      const { result } = await signIn({}, { redirectAfter: '/jobs' });
      expect(result.redirectAfter).toBe('/jobs');
    });

    describe('refuses', () => {
      it('a signature from a certificate the provider does not list', async () => {
        const error = await refusal({ signWith: ATTACKER });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'signature invalid' });
        expect(failureReasons()).toEqual(['assertion_invalid']);
      });

      it('an unsigned assertion, even inside a signed response', async () => {
        expect((await refusal({ signWith: undefined })).details).toEqual({ assertion: 'signature invalid' });
        expect((await refusal({ signWith: undefined, signResponseWith: IDP_CURRENT })).details).toEqual({ assertion: 'signature invalid' });
      });

      it('an assertion altered after signing', async () => {
        const error = await refusal({ mutate: xml => xml.replace('>00u1ada<', '>00u1admin<') });
        expect(error.details).toEqual({ assertion: 'signature invalid' });
      });

      it('a second, unsigned assertion wrapped around a signed one', async () => {
        const error = await refusal({
          mutate: xml => {
            const signed = /<saml:Assertion[\s\S]*<\/saml:Assertion>/.exec(xml)?.[0] ?? '';
            const forged = signed
              .replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, '')
              .replace(/ID="[^"]+"/, 'ID="_forged"')
              .replace('>00u1ada<', '>00u1admin<');
            return xml.replace(signed, forged + signed);
          },
        });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'signature invalid' });
      });

      it('SHA-1 signatures', async () => {
        const error = await refusal({ sha1: true });
        expect(error.details).toEqual({ assertion: 'weak signature algorithm' });
      });

      it('an assertion for another audience', async () => {
        const error = await refusal({ audience: 'https://other.example.test/saml' });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'audience mismatch' });
      });

      it('another recipient or destination', async () => {
        expect((await refusal({ recipient: 'https://evil.example.test/acs' })).details).toEqual({ assertion: 'recipient mismatch' });
        expect((await refusal({ destination: 'https://evil.example.test/acs' })).details).toEqual({ assertion: 'destination mismatch' });
      });

      it('another issuer', async () => {
        expect((await refusal({ issuer: 'https://evil.example.test/idp', responseIssuer: IDP_ENTITY_ID })).details).toEqual({
          assertion: 'issuer mismatch',
        });
        expect((await refusal({ responseIssuer: 'https://evil.example.test/idp' })).details).toEqual({ assertion: 'issuer mismatch' });
      });

      it('an expired assertion, beyond the clock skew', async () => {
        const now = DateTime.utc().minus({ minutes: 10 });
        const error = await refusal({ now, notOnOrAfter: DateTime.utc().minus({ seconds: 90 }) });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'outside validity window' });
      });

      it('an assertion not yet valid, beyond the clock skew', async () => {
        const error = await refusal({ notBefore: DateTime.utc().plus({ minutes: 5 }) });
        expect(error.details).toEqual({ assertion: 'outside validity window' });
      });

      it('a response submitted twice', async () => {
        const { service, SAMLResponse, requestId } = await signIn();
        const error = await service
          .completeAuthorization({ params: { SAMLResponse }, expectedRequestId: requestId })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({ statusCode: 404, details: { InResponseTo: 'not found or expired' } });
        expect(failureReasons()).toEqual(['unsolicited']);
      });

      it('an assertion ID already accepted, even answering a new request', async () => {
        await signIn({ assertionId: '_reused' });
        const error = await refusal({ assertionId: '_reused' });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'already used' });
        expect(failureReasons()).toEqual(['assertion_replayed']);
      });

      it('an unsolicited (IdP-initiated) response', async () => {
        const service = makeService();
        const error = await service
          .completeAuthorization({ params: { SAMLResponse: buildResponse() }, expectedRequestId: '_request' })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({ statusCode: 400, details: { SAMLResponse: 'unsolicited response' } });
        expect(failureReasons()).toEqual(['unsolicited']);
      });

      it('an IdP-initiated assertion rewrapped in a response to another request', async () => {
        // The response's InResponseTo is unsigned; the signed confirmation does not answer the request.
        const error = await refusal({ subjectConfirmations: [{ inResponseTo: undefined }] });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'does not answer the request' });
        expect(failureReasons()).toEqual(['unsolicited']);
      });

      it('an expired confirmation for the ACS, beside a current one for another recipient', async () => {
        const error = await refusal({
          subjectConfirmations: [{ recipient: 'https://other.example.test/acs' }, { notOnOrAfter: DateTime.utc().minus({ minutes: 5 }) }],
        });
        expect(error.statusCode).toBe(401);
        expect(error.details).toEqual({ assertion: 'outside validity window' });
      });

      it('a response to a request other than the expected one, leaving that request answerable', async () => {
        const service = makeService();
        const { requestId: attackerRequest } = await service.beginAuthorization({ provider: 'acme', intent: 'sign-in' });
        const { requestId: ownRequest } = await service.beginAuthorization({ provider: 'acme', intent: 'sign-in' });
        const SAMLResponse = buildResponse({ inResponseTo: attackerRequest });
        const error = await service
          .completeAuthorization({ params: { SAMLResponse }, expectedRequestId: ownRequest })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({ statusCode: 400, details: { InResponseTo: 'not the expected request' } });
        expect(failureReasons()).toEqual(['unsolicited']);
        await expect(service.completeAuthorization({ params: { SAMLResponse }, expectedRequestId: attackerRequest })).resolves.toMatchObject({
          kind: 'new-user',
        });
      });

      it('an empty expectedRequestId, as from a missing cookie', async () => {
        const service = makeService();
        const { requestId } = await service.beginAuthorization({ provider: 'acme', intent: 'sign-in' });
        const error = await service
          .completeAuthorization({ params: { SAMLResponse: buildResponse({ inResponseTo: requestId }) }, expectedRequestId: '' })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({ statusCode: 400, details: { InResponseTo: 'not the expected request' } });
      });

      it('a response to a request this service never issued', async () => {
        const service = makeService();
        const error = await service
          .completeAuthorization({ params: { SAMLResponse: buildResponse({ inResponseTo: '_forged' }) }, expectedRequestId: '_forged' })
          .catch((caught: unknown) => caught);
        expect(error).toMatchObject({ statusCode: 404 });
      });

      it('a missing or malformed SAMLResponse', async () => {
        const service = makeService();
        await expect(service.completeAuthorization({ params: {}, expectedRequestId: '_request' })).rejects.toMatchObject({
          statusCode: 400,
          details: { SAMLResponse: 'missing' },
        });
        await expect(
          service.completeAuthorization({ params: { SAMLResponse: Buffer.from('<html/>').toString('base64') }, expectedRequestId: '_request' }),
        ).rejects.toMatchObject({
          statusCode: 400,
          details: { SAMLResponse: 'not a SAML response' },
        });
        const doctype = Buffer.from('<!DOCTYPE x [<!ENTITY a "a">]><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"/>').toString(
          'base64',
        );
        await expect(service.completeAuthorization({ params: { SAMLResponse: doctype }, expectedRequestId: '_request' })).rejects.toMatchObject({
          statusCode: 400,
        });
      });

      it('an authentication context the provider does not accept', async () => {
        provider = { ...PROVIDER, acceptedAuthnContexts: ['http://schemas.microsoft.com/claims/multipleauthn'] };
        const error = await refusal();
        expect(error.details).toEqual({ assertion: 'authentication context not accepted' });
      });

      it('an IdP error status', async () => {
        const error = await refusal({ status: 'urn:oasis:names:tc:SAML:2.0:status:Requester' });
        expect(error.statusCode).toBe(400);
        expect(error.details?.status).toMatch(/Requester/);
        expect(failureReasons()).toEqual(['provider_error']);
      });

      it('a profile the policy denies', async () => {
        policyResult = { allowed: false, reason: 'domain_not_verified' };
        const error = await refusal();
        expect(error.statusCode).toBe(403);
        expect(failureReasons()).toEqual(['policy_denied']);
      });
    });

    it('accepts an assertion expired within the clock skew', async () => {
      const { result } = await signIn({ now: DateTime.utc().minus({ minutes: 5 }), notOnOrAfter: DateTime.utc().minus({ seconds: 30 }) });
      expect(result.kind).toBe('new-user');
    });

    describe('email trust', () => {
      it('never auto-links without a trustEmail hook, and reports the conflict', async () => {
        findActorByEmail.mockResolvedValue('actor-9');
        const { result } = await signIn();

        expect(result).toMatchObject({ kind: 'new-user', emailConflict: { actorId: 'actor-9', reason: 'unverified-email' } });
        expect(repo.repo.createFactor).not.toHaveBeenCalled();
        expect(events.find(event => event.type === 'saml.link.rejected')?.data).toMatchObject({ reason: 'unverified_email', emailTrust: 'provider' });
      });

      it('auto-links when the provider vouches for the address', async () => {
        findActorByEmail.mockResolvedValue('actor-9');
        const trustEmail = vi.fn(async () => true);
        provider = { ...PROVIDER, trustEmail };

        const { result } = await signIn();

        expect(result).toMatchObject({ kind: 'linked', intent: 'sign-in', actorId: 'actor-9' });
        expect(trustEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@acme.test' }));
        expect(events.find(event => event.type === 'saml.linked.auto')?.data).toMatchObject({ email: 'ada@acme.test', emailTrust: 'provider' });
      });

      it('does not auto-link when the provider declines', async () => {
        findActorByEmail.mockResolvedValue('actor-9');
        provider = { ...PROVIDER, trustEmail: () => false };
        expect((await signIn()).result.kind).toBe('new-user');
      });
    });

    describe('link', () => {
      it('attaches the identity to the signed-in actor', async () => {
        const { result } = await signIn({}, { intent: 'link', actorId: 'actor-1' });
        expect(result).toMatchObject({ kind: 'linked', intent: 'link', actorId: 'actor-1' });
      });

      it('refuses an identity linked to another actor', async () => {
        await repo.repo.createFactor('actor-2', { provider: 'acme', subject: '00u1ada' });
        const error = await refusal({}, { intent: 'link', actorId: 'actor-1' });
        expect(error.statusCode).toBe(409);
      });
    });

    describe('step-up', () => {
      it('answers stepped-up for a factor of the actor, with a fresh AuthnInstant', async () => {
        await repo.repo.createFactor('actor-1', { provider: 'acme', subject: '00u1ada' });
        const { result } = await signIn({}, { intent: 'step-up', actorId: 'actor-1' });
        expect(result).toMatchObject({ kind: 'stepped-up', actorId: 'actor-1', factorId: 'factor-1' });
      });

      it('refuses an AuthnInstant from before the request', async () => {
        await repo.repo.createFactor('actor-1', { provider: 'acme', subject: '00u1ada' });
        const error = await refusal({ authnInstant: DateTime.utc().minus({ hours: 1 }) }, { intent: 'step-up', actorId: 'actor-1' });
        expect(error.details).toEqual({ assertion: 'authentication not fresh' });
      });

      it('refuses an identity that is not a factor of the actor', async () => {
        await repo.repo.createFactor('actor-2', { provider: 'acme', subject: '00u1ada' });
        const error = await refusal({}, { intent: 'step-up', actorId: 'actor-1' });
        expect(error.statusCode).toBe(403);
        expect(events.map(event => event.type)).toContain('saml.step_up.rejected');
      });
    });
  });

  describe('createFactorFromAuthorization', () => {
    it('attaches a staged identity once', async () => {
      const { service, result } = await signIn();
      const { authorizationId } = result as Extract<SamlAuthorizationResult, { kind: 'new-user' }>;

      expect(await service.hasPendingAuthorization(authorizationId)).toBe(true);
      const factor = await service.createFactorFromAuthorization('actor-5', authorizationId);
      expect(factor).toMatchObject({ actorId: 'actor-5', provider: 'acme', subject: '00u1ada', email: 'ada@acme.test' });
      await expect(service.createFactorFromAuthorization('actor-5', authorizationId)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('authenticated exchange', () => {
    it('redeems a stash once', async () => {
      const service = makeService();
      const exchangeId = await service.stashAuthenticatedExchange({ actorId: 'actor-1', factorId: 'factor-1', isNewUser: true });

      expect(await service.redeemAuthenticatedExchange(exchangeId)).toEqual({ actorId: 'actor-1', factorId: 'factor-1', isNewUser: true });
      expect(await service.redeemAuthenticatedExchange(exchangeId)).toBeUndefined();
    });
  });
});

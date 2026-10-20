import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import {
  SAML,
  SamlStatusError,
  ValidateInResponseTo,
  type CacheProvider as NodeSamlCacheProvider,
  type Profile as NodeSamlProfile,
} from '@node-saml/node-saml';
import { AuditRecorder, type FederatedEmailTrust, type FederatedFailureReason } from '@maroonedsoftware/authentication';
import { CacheProvider } from '@maroonedsoftware/cache';
import { httpError } from '@maroonedsoftware/errors';
import { PolicyService } from '@maroonedsoftware/policies';
import { DEFAULT_SAML_NAME_ID_FORMAT, SamlProviderRegistry, type SamlProviderConfig } from './saml.provider.js';
import { parseSamlCertificate } from './saml.certificate.js';
import { SamlFactorRepository, type SamlFactor } from './saml.factor.repository.js';
import { SAML_PROFILE_ALLOWED_POLICY } from './saml.profile.allowed.policy.js';
import { isSha1Algorithm, readSamlResponse, readVerifiedAssertion } from './saml.response.reader.js';

/**
 * Normalized profile built from a validated SAML assertion, shaped like the OIDC factor's
 * `OidcProfile`. Every attribute the IdP sent is kept on `attributes` for app-specific rules.
 */
export type SamlProfile = {
  /** Provider name that issued the profile (e.g. `"acme.okta"`). */
  provider: string;
  /** The assertion's `NameID`: stable per (provider, end-user). */
  subject: string;
  /** The NameID's `Format`, when the IdP sent one. */
  nameIdFormat?: string;
  /** Email address, from an attribute or an `emailAddress` NameID. See {@link SamlProfileAttributeNames}. */
  email?: string;
  /** Display name. See {@link SamlProfileAttributeNames}. */
  name?: string;
  /**
   * `AuthnContextClassRef` from the `AuthnStatement`: how the IdP authenticated the user
   * (e.g. `urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport`, or Microsoft's
   * `http://schemas.microsoft.com/claims/multipleauthn` after MFA).
   */
  authnContextClassRef?: string;
  /** `AuthnInstant`: when the user last actively authenticated at the IdP, in UTC. */
  authnInstant?: DateTime;
  /** `SessionIndex` of the IdP session, needed later for single logout. */
  sessionIndex?: string;
  /** The assertion's `Issuer`, always the provider's `idpEntityId`. */
  issuer: string;
  /** Every attribute in the assertion's `AttributeStatement`, by name. Multi-valued attributes are arrays. */
  attributes: Record<string, unknown>;
};

/**
 * Why a flow is being run.
 *
 * - `sign-in`: resolve the identity to an actor, auto-linking or staging a new user.
 * - `link`: attach the identity to the signed-in `actorId`.
 * - `step-up`: re-authenticate the signed-in `actorId` at the IdP (`ForceAuthn`) and return the
 *   fresh profile. Nothing is linked or created.
 */
export type SamlAuthorizationIntent = 'sign-in' | 'link' | 'step-up';

/**
 * Result of a successful {@link SamlFactorService.completeAuthorization}. Same variants and
 * meanings as the OIDC factor's `OidcAuthorizationResult`:
 *
 * - `signed-in`: `(provider, subject)` already mapped to an actor.
 * - `linked`: a factor was created during this call, by `intent: 'link'` or by a trusted email
 *   match (see {@link SamlProviderConfig.trustEmail}).
 * - `new-user`: no actor was found. Create one, then call
 *   {@link SamlFactorService.createFactorFromAuthorization} with `authorizationId`. `emailConflict`
 *   is set when an actor holds the address but the provider did not vouch for it.
 * - `stepped-up`: only for `intent: 'step-up'`; the identity is a factor of the stepping-up actor.
 */
export type SamlAuthorizationResult =
  | { kind: 'signed-in'; intent: 'sign-in' | 'link'; actorId: string; factorId: string; profile: SamlProfile; redirectAfter?: string }
  | { kind: 'linked'; intent: 'sign-in' | 'link'; actorId: string; factorId: string; profile: SamlProfile; redirectAfter?: string }
  | {
      kind: 'new-user';
      intent: 'sign-in' | 'link';
      authorizationId: string;
      profile: SamlProfile;
      emailConflict?: { actorId: string; reason: 'unverified-email' };
      redirectAfter?: string;
    }
  | { kind: 'stepped-up'; intent: 'step-up'; actorId: string; factorId: string; profile: SamlProfile; redirectAfter?: string };

/**
 * The HTTP-POST binding's form fields, as posted to the ACS. Pass the parsed form body through;
 * extra fields are ignored.
 */
export type SamlCallbackParams = {
  /** Base64 `samlp:Response`. */
  SAMLResponse?: string;
  /** Echoed back by the IdP. Not used: the response is bound to its request by `InResponseTo`. */
  RelayState?: string;
  [key: string]: string | undefined;
};

/** Bare facts a caller needs to mint a session after a SAML completion. Same shape as the OIDC exchange. */
export interface SamlAuthenticatedExchange {
  /** The actor the completed authorization resolved to. */
  actorId: string;
  /** The SAML factor satisfied by the completed authorization. */
  factorId: string;
  /** `true` when the actor was created as part of this exchange (typical for `kind: 'new-user'`). */
  isNewUser?: boolean;
}

/**
 * Implemented by the consuming app to find the account an email address belongs to, for the
 * auto-link flow. The OIDC factor's `OidcActorEmailLookup` has the same shape, so one class can be
 * registered under both tokens.
 *
 * Return `undefined` for no match or for ambiguity: the service then stages a `new-user`.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface SamlActorEmailLookup {
  findActorByEmail(email: string): Promise<string | undefined>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class SamlActorEmailLookup implements SamlActorEmailLookup {}

/**
 * Configuration options for {@link SamlFactorService}.
 */
@Injectable()
export class SamlFactorServiceOptions {
  constructor(
    /** How long an issued AuthnRequest can be answered. A response to an older request is refused as unsolicited. */
    public readonly requestExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
    /** Clock skew tolerated on `NotBefore`, `NotOnOrAfter`, and the `AuthnInstant` of a forced re-authentication. */
    public readonly clockSkew: Duration = Duration.fromDurationLike({ seconds: 60 }),
    /** How long a pending `new-user` authorization survives before the caller must complete it. */
    public readonly pendingAuthorizationExpiration: Duration = Duration.fromDurationLike({ minutes: 30 }),
    /** How long a stashed post-completion exchange survives. Short by design: it is redeemed in the same round trip. */
    public readonly authenticatedExchangeExpiration: Duration = Duration.fromDurationLike({ minutes: 2 }),
  ) {}
}

type StoredAuthnRequest = {
  requestId: string;
  provider: string;
  intent: SamlAuthorizationIntent;
  actorId?: string;
  redirectAfter?: string;
  forceAuthn: boolean;
  issuedAt: number;
  expiresAt: number;
};

type StoredPendingAuthorization = {
  authorizationId: string;
  provider: string;
  subject: string;
  email?: string;
  expiresAt: number;
};

type StoredAuthenticatedExchange = SamlAuthenticatedExchange & { exchangeId: string; expiresAt: number };

/** A refused response: what the client is told, and what the audit trail records. */
class SamlRefusal {
  constructor(
    readonly status: 400 | 401 | 404,
    readonly reason: FederatedFailureReason,
    readonly details: Record<string, string>,
    readonly internal?: Record<string, unknown>,
    readonly cause?: unknown,
  ) {}
}

const EMAIL_ATTRIBUTES = ['email', 'mail', 'urn:oid:0.9.2342.19200300.100.1.3', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
const NAME_ATTRIBUTES = ['name', 'displayName', 'urn:oid:2.16.840.1.113730.3.1.241', 'http://schemas.microsoft.com/identity/claims/displayname'];
const GIVEN_NAME_ATTRIBUTES = ['givenName', 'firstName', 'urn:oid:2.5.4.42', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'];
const SURNAME_ATTRIBUTES = ['sn', 'surname', 'lastName', 'urn:oid:2.5.4.4', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'];
const EMAIL_NAME_ID_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

/**
 * SP-initiated SAML 2.0 sign-in and account linking, on `@node-saml/node-saml`, with the same
 * two-step shape and results as the OIDC factor's `OidcFactorService`.
 *
 * **Sign in:**
 * 1. {@link beginAuthorization} with `intent: 'sign-in'` → redirect the browser to `url`
 *    (HTTP-Redirect binding AuthnRequest).
 * 2. On the ACS route, pass the posted form to {@link completeAuthorization}:
 *    `signed-in` / `linked` issue a session, `new-user` goes to sign-up and then
 *    {@link createFactorFromAuthorization}.
 *
 * **Link** an additional provider: `intent: 'link'` with the current `actorId` → `linked`.
 *
 * **Step up**: `intent: 'step-up'` with the current `actorId` sends `ForceAuthn="true"` →
 * `stepped-up`, whose `profile.authnInstant` falls within the round trip and whose
 * `profile.authnContextClassRef` says how the user re-authenticated.
 *
 * Every response is checked before anything is looked up, and none of the checks can be turned off:
 * - it answers an AuthnRequest this service issued (`InResponseTo`, single use, held in the
 *   cache for {@link SamlFactorServiceOptions.requestExpiration}); IdP-initiated responses are refused;
 * - the assertion is signed by one of the provider's `idpSigningCertificates` (never a `KeyInfo`
 *   certificate), with no SHA-1 signature or digest, and is the only assertion in the response;
 * - the bearer `SubjectConfirmationData` for `acsUrl` carries that same `InResponseTo` inside the
 *   signed assertion, and its `NotOnOrAfter` holds;
 * - `Destination` and the bearer `Recipient` equal `acsUrl`; the assertion `Issuer` (and the
 *   response's, when present) equals `idpEntityId`; the `Audience` equals `spEntityId`;
 * - `NotBefore` / `NotOnOrAfter` hold within {@link SamlFactorServiceOptions.clockSkew};
 * - `AuthnContextClassRef` is one of `acceptedAuthnContexts`, when the provider lists any;
 * - the assertion `ID` has not been accepted before (kept in the cache until the assertion expires).
 */
@Injectable()
export class SamlFactorService {
  constructor(
    private readonly options: SamlFactorServiceOptions,
    private readonly registry: SamlProviderRegistry,
    private readonly repo: SamlFactorRepository,
    private readonly emailLookup: SamlActorEmailLookup,
    private readonly cache: CacheProvider,
    private readonly policyService: PolicyService,
    /** Records federated sign-in and account-linking outcomes. Defaulted, so audit is opt-in. */
    private readonly audit: AuditRecorder = new AuditRecorder(),
  ) {}

  private getRequestKey(requestId: string) {
    return `saml_authn_request_${requestId}`;
  }

  private getAuthorizationKey(authorizationId: string) {
    return `saml_authorization_${authorizationId}`;
  }

  private getAuthenticatedExchangeKey(exchangeId: string) {
    return `saml_exchange_${exchangeId}`;
  }

  /** Assertion ids are only unique per issuer, so the key covers both. */
  private getAssertionKey(issuer: string, assertionId: string) {
    return `saml_assertion_${crypto.createHash('sha256').update(`${issuer}\n${assertionId}`).digest('base64url')}`;
  }

  /**
   * Build an AuthnRequest for `provider` and the HTTP-Redirect binding URL that carries it, and
   * remember the request so its response can be matched by `InResponseTo`.
   *
   * The request names the provider's `acsUrl`, asks for its `nameIdFormat`, and, when the
   * provider lists `acceptedAuthnContexts`, requests exactly those classes. `forceAuthn` (always
   * on for `step-up`) asks the IdP to re-authenticate the user even inside an existing IdP session.
   * The request is not signed.
   *
   * @throws HTTP 404 when `provider` is not listed by the source.
   * @throws HTTP 400 when `intent` is `link` or `step-up` without `actorId`.
   */
  async beginAuthorization(args: {
    provider: string;
    intent: SamlAuthorizationIntent;
    actorId?: string;
    redirectAfter?: string;
    forceAuthn?: boolean;
  }): Promise<{ url: URL; requestId: string; expiresAt: DateTime }> {
    if ((args.intent === 'link' || args.intent === 'step-up') && !args.actorId) {
      throw httpError(400).withDetails({ actorId: `required when intent is ${args.intent}` });
    }

    const config = await this.registry.getConfig(args.provider);
    const requestId = `_${crypto.randomBytes(20).toString('hex')}`;
    const forceAuthn = args.intent === 'step-up' || args.forceAuthn === true;

    const url = new URL(await this.createSaml(config, { requestId, forceAuthn }).getAuthorizeUrlAsync('', undefined, {}));

    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.requestExpiration);
    const stored: StoredAuthnRequest = {
      requestId,
      provider: args.provider,
      intent: args.intent,
      ...(args.actorId === undefined ? {} : { actorId: args.actorId }),
      ...(args.redirectAfter === undefined ? {} : { redirectAfter: args.redirectAfter }),
      forceAuthn,
      issuedAt: issuedAt.toUnixInteger(),
      expiresAt: expiresAt.toUnixInteger(),
    };
    await this.cache.set(this.getRequestKey(requestId), JSON.stringify(stored), this.options.requestExpiration);

    await this.audit.record({ type: 'saml.authorization.begun', category: 'login', outcome: 'success', data: { provider: args.provider } });

    return { url, requestId, expiresAt };
  }

  /**
   * Validate a `SAMLResponse` posted to the ACS and resolve it to a factor (or a pending
   * authorization handle for a new user). See the class documentation for every check.
   *
   * The request the response answers is consumed before validation, so a response can be
   * submitted once whatever the outcome.
   *
   * @throws HTTP 400 when `SAMLResponse` is missing or not a SAML response, when it answers no
   *   request (`details.SAMLResponse: 'unsolicited response'`), or when the IdP reported an error
   *   status (`details.status`).
   * @throws HTTP 401 when the assertion fails validation; `details.assertion` names the check.
   * @throws HTTP 403 when the `'auth.factor.saml.profile.allowed'` policy denies the profile, or when
   *   a `step-up` identity is not a factor of the stepping-up actor.
   * @throws HTTP 404 when `InResponseTo` names a request that was never issued, has expired, or was
   *   already answered.
   * @throws HTTP 409 when a `link` intent's `(provider, subject)` already belongs to another actor.
   */
  async completeAuthorization(args: { params: SamlCallbackParams }): Promise<SamlAuthorizationResult> {
    let validated: { stored: StoredAuthnRequest; config: SamlProviderConfig; profile: SamlProfile };
    try {
      validated = await this.validateResponse(args.params.SAMLResponse);
    } catch (error) {
      if (error instanceof SamlRefusal) {
        await this.auditAuthorizationFailed(error.reason, typeof error.internal?.provider === 'string' ? error.internal.provider : undefined);
        const refusal = httpError(error.status).withDetails(error.details);
        if (error.internal) refusal.withInternalDetails(error.internal);
        if (error.cause instanceof Error) refusal.withCause(error.cause);
        throw refusal;
      }
      throw error;
    }
    const { stored, config, profile } = validated;
    const { subject } = profile;

    const policyResult = await this.policyService.check(SAML_PROFILE_ALLOWED_POLICY, { profile });
    if (!policyResult.allowed) {
      await this.auditAuthorizationFailed('policy_denied', stored.provider, subject);
      throw httpError(403)
        .withDetails({ profile: 'not allowed' })
        .withInternalDetails({ reason: policyResult.reason, details: policyResult.details });
    }

    const existing = await this.repo.findFactor({ provider: stored.provider, subject });

    // Step-up re-authenticates a known factor of the signed-in actor and changes nothing.
    if (stored.intent === 'step-up') {
      if (!stored.actorId || !existing || existing.actorId !== stored.actorId) {
        await this.audit.record({
          type: 'saml.step_up.rejected',
          category: 'login',
          outcome: 'failure',
          ...(stored.actorId === undefined ? {} : { actorId: stored.actorId }),
          data: { provider: stored.provider, subject, reason: 'not_linked' },
        });
        throw httpError(403).withDetails({ provider: 'not linked to this account' });
      }
      await this.audit.record({
        type: 'saml.stepped_up',
        category: 'login',
        outcome: 'success',
        actorId: existing.actorId,
        data: { provider: stored.provider, subject, factorId: existing.id },
      });
      return {
        kind: 'stepped-up',
        intent: 'step-up',
        actorId: existing.actorId,
        factorId: existing.id,
        profile,
        redirectAfter: stored.redirectAfter,
      };
    }

    // 1. Existing factor for (provider, subject) → signed-in
    if (existing) {
      // A link whose identity already belongs to someone else must not sign the caller in as them.
      if (stored.intent === 'link' && existing.actorId !== stored.actorId) {
        await this.audit.record({
          type: 'saml.link.rejected',
          category: 'privilege',
          outcome: 'failure',
          ...(stored.actorId === undefined ? {} : { actorId: stored.actorId }),
          data: { provider: stored.provider, subject, reason: 'subject_taken' },
        });
        throw httpError(409).withDetails({ provider: 'already linked to another account' });
      }
      if (profile.email && profile.email !== existing.email) {
        await this.repo.updateEmail(existing.id, profile.email);
      }
      await this.audit.record({
        type: 'saml.signed_in',
        category: 'login',
        outcome: 'success',
        actorId: existing.actorId,
        data: { provider: stored.provider, subject, factorId: existing.id },
      });
      return {
        kind: 'signed-in',
        intent: stored.intent,
        actorId: existing.actorId,
        factorId: existing.id,
        profile,
        redirectAfter: stored.redirectAfter,
      };
    }

    // 2. Explicit link to a known actor → create the factor on that actor
    if (stored.intent === 'link') {
      if (!stored.actorId) {
        // beginAuthorization refuses a link without an actor, so this is a corrupt request record.
        await this.auditAuthorizationFailed('state_invalid', stored.provider, subject);
        throw httpError(400).withDetails({ InResponseTo: 'link intent without an actor' });
      }
      const factor = await this.createFactor(stored.actorId, { provider: stored.provider, subject, email: profile.email });
      await this.audit.record({
        type: 'saml.linked.explicit',
        category: 'privilege',
        outcome: 'success',
        actorId: factor.actorId,
        data: { provider: stored.provider, subject, actorId: factor.actorId },
      });
      return { kind: 'linked', intent: stored.intent, actorId: factor.actorId, factorId: factor.id, profile, redirectAfter: stored.redirectAfter };
    }

    // SAML has no `email_verified`: only the provider's `trustEmail` hook can vouch for an address.
    const emailTrust: FederatedEmailTrust = 'provider';
    const emailTrusted = profile.email && config.trustEmail ? (await config.trustEmail(profile)) === true : false;
    const matchedActorId = profile.email ? await this.emailLookup.findActorByEmail(profile.email) : undefined;

    // 3. Sign-in with a new (provider, subject) whose trusted email matches an account → auto-link.
    if (matchedActorId && emailTrusted) {
      const factor = await this.createFactor(matchedActorId, { provider: stored.provider, subject, email: profile.email });
      // The takeover-adjacent path, recorded with provider, subject and email for review.
      await this.audit.record({
        type: 'saml.linked.auto',
        category: 'privilege',
        outcome: 'success',
        actorId: factor.actorId,
        data: { provider: stored.provider, subject, ...(profile.email === undefined ? {} : { email: profile.email }), emailTrust },
      });
      return { kind: 'linked', intent: stored.intent, actorId: factor.actorId, factorId: factor.id, profile, redirectAfter: stored.redirectAfter };
    }

    // 4. Email matches an account but is not trusted: surface the conflict.
    let emailConflict: { actorId: string; reason: 'unverified-email' } | undefined;
    if (matchedActorId) {
      emailConflict = { actorId: matchedActorId, reason: 'unverified-email' };
      await this.audit.record({
        type: 'saml.link.rejected',
        category: 'privilege',
        outcome: 'failure',
        actorId: matchedActorId,
        data: { provider: stored.provider, subject, reason: 'unverified_email', emailTrust },
      });
    }

    // 5. Genuine new user: cache the identity for the caller to attach to a new actor.
    const authorizationId = await this.cachePendingAuthorization({
      provider: stored.provider,
      subject,
      ...(profile.email === undefined ? {} : { email: profile.email }),
    });
    await this.audit.record({ type: 'saml.new_user', category: 'login', outcome: 'success', data: { provider: stored.provider, subject } });

    return {
      kind: 'new-user',
      intent: stored.intent,
      authorizationId,
      profile,
      ...(emailConflict === undefined ? {} : { emailConflict }),
      redirectAfter: stored.redirectAfter,
    };
  }

  /**
   * Complete the `new-user` branch by attaching the cached identity to a freshly created actor.
   *
   * @throws HTTP 404 when `authorizationId` has expired or does not exist.
   */
  async createFactorFromAuthorization(actorId: string, authorizationId: string): Promise<SamlFactor> {
    const raw = await this.cache.get(this.getAuthorizationKey(authorizationId));
    if (!raw) {
      throw httpError(404).withDetails({ authorizationId: 'not found or expired' });
    }
    await this.cache.delete(this.getAuthorizationKey(authorizationId));
    const pending = JSON.parse(raw) as StoredPendingAuthorization;

    const factor = await this.createFactor(actorId, { provider: pending.provider, subject: pending.subject, email: pending.email });
    await this.audit.record({
      type: 'saml.factor.created',
      category: 'credential',
      outcome: 'success',
      actorId,
      data: { provider: factor.provider, subject: factor.subject, factorId: factor.id },
    });
    return factor;
  }

  /** `true` when the pending authorization is still cached and unconsumed. */
  async hasPendingAuthorization(authorizationId: string): Promise<boolean> {
    return (await this.cache.get(this.getAuthorizationKey(authorizationId))) !== null;
  }

  /**
   * Stash the result of a completed SAML sign-in behind a one-time id, so the caller can pick
   * the flow back up from a follow-up route (an MFA challenge, or the SPA redeeming it).
   * Single-use with a short TTL, like the OIDC factor's exchange.
   *
   * @returns A one-time `exchangeId` (32-byte base64url) for {@link redeemAuthenticatedExchange}.
   */
  async stashAuthenticatedExchange(input: SamlAuthenticatedExchange): Promise<string> {
    const exchangeId = crypto.randomBytes(32).toString('base64url');
    const stored: StoredAuthenticatedExchange = {
      exchangeId,
      actorId: input.actorId,
      factorId: input.factorId,
      ...(input.isNewUser === undefined ? {} : { isNewUser: input.isNewUser }),
      expiresAt: DateTime.utc().plus(this.options.authenticatedExchangeExpiration).toUnixInteger(),
    };
    await this.cache.set(this.getAuthenticatedExchangeKey(exchangeId), JSON.stringify(stored), this.options.authenticatedExchangeExpiration);
    return exchangeId;
  }

  /**
   * Redeem a stash created by {@link stashAuthenticatedExchange}. Single-use: the entry is
   * deleted on a successful read. Returns `undefined` when `exchangeId` has expired or does not exist.
   */
  async redeemAuthenticatedExchange(exchangeId: string): Promise<SamlAuthenticatedExchange | undefined> {
    const raw = await this.cache.get(this.getAuthenticatedExchangeKey(exchangeId));
    if (!raw) {
      return undefined;
    }
    await this.cache.delete(this.getAuthenticatedExchangeKey(exchangeId));
    const stored = JSON.parse(raw) as StoredAuthenticatedExchange;
    return { actorId: stored.actorId, factorId: stored.factorId, ...(stored.isNewUser === undefined ? {} : { isNewUser: stored.isNewUser }) };
  }

  /** Retrieve a SAML factor by id, scoped to the owning actor. */
  async getFactor(actorId: string, factorId: string) {
    return await this.repo.getFactor(actorId, factorId);
  }

  /** List SAML factors for an actor. Pass `active` to filter by activation state. */
  async listFactors(actorId: string, active?: boolean) {
    return await this.repo.listFactors(actorId, active);
  }

  /** Find a factor by its provider-side identity. Global, not per-actor. */
  async findFactor(provider: string, subject: string) {
    return await this.repo.findFactor({ provider, subject });
  }

  /** Permanently remove a SAML factor. */
  async deleteFactor(actorId: string, factorId: string) {
    await this.repo.deleteFactor(actorId, factorId);
    await this.audit.record({ type: 'saml.factor.deleted', category: 'privilege', outcome: 'success', actorId, data: { factorId } });
  }

  /** Every check on a response, in order. Throws a {@link SamlRefusal} on the first that fails. */
  private async validateResponse(encoded: string | undefined) {
    const response = encoded ? readSamlResponse(encoded) : undefined;
    if (!encoded || !response) {
      throw new SamlRefusal(400, 'assertion_invalid', { SAMLResponse: encoded ? 'not a SAML response' : 'missing' });
    }
    if (!response.inResponseTo) {
      // IdP-initiated: nothing binds it to a browser that asked to sign in.
      throw new SamlRefusal(400, 'unsolicited', { SAMLResponse: 'unsolicited response' });
    }

    const raw = await this.cache.get(this.getRequestKey(response.inResponseTo));
    if (!raw) {
      throw new SamlRefusal(404, 'unsolicited', { InResponseTo: 'not found or expired' });
    }
    await this.cache.delete(this.getRequestKey(response.inResponseTo));
    const stored = JSON.parse(raw) as StoredAuthnRequest;
    const provider = stored.provider;
    const config = await this.registry.getConfig(provider);

    const invalid = (assertion: string, internal: Record<string, unknown> = {}, cause?: unknown) =>
      new SamlRefusal(401, 'assertion_invalid', { assertion }, { provider, ...internal }, cause);

    const weak = response.algorithms.filter(isSha1Algorithm);
    if (weak.length > 0) {
      throw invalid('weak signature algorithm', { algorithms: weak });
    }
    if (response.destination !== config.acsUrl.href) {
      throw invalid('destination mismatch', { destination: response.destination });
    }
    if (response.issuer !== undefined && response.issuer !== config.idpEntityId) {
      throw invalid('issuer mismatch', { issuer: response.issuer });
    }

    let samlProfile: NodeSamlProfile | null;
    try {
      ({ profile: samlProfile } = await this.createSaml(config, {
        requestId: stored.requestId,
        forceAuthn: stored.forceAuthn,
      }).validatePostResponseAsync({
        SAMLResponse: encoded,
      }));
    } catch (error) {
      if (error instanceof SamlStatusError) {
        throw new SamlRefusal(400, 'provider_error', { status: error.message }, { provider }, error);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw invalid(describeNodeSamlError(message), { reason: message }, error);
    }
    if (!samlProfile) {
      // A NoPassive status: the IdP could not sign the user in without interaction.
      throw new SamlRefusal(400, 'provider_error', { status: 'no assertion' }, { provider });
    }

    const assertion = readVerifiedAssertion(samlProfile.getAssertionXml?.() ?? '');
    if (assertion.issuer !== config.idpEntityId) {
      throw invalid('issuer mismatch', { issuer: assertion.issuer });
    }
    const confirmation = assertion.bearerConfirmations.find(candidate => candidate.recipient === config.acsUrl.href);
    if (!confirmation) {
      throw invalid('recipient mismatch', { recipients: assertion.bearerConfirmations.map(candidate => candidate.recipient) });
    }
    // The response's InResponseTo is outside the signature, so only the signed confirmation's binds
    // the assertion to the request. node-saml accepts a confirmation without one; that is an
    // unsolicited assertion rewrapped in a response to someone else's request.
    if (confirmation.inResponseTo !== stored.requestId) {
      throw new SamlRefusal(
        401,
        'unsolicited',
        { assertion: 'does not answer the request' },
        { provider, subjectInResponseTo: confirmation.inResponseTo },
      );
    }
    if (!confirmation.notOnOrAfter) {
      throw invalid('missing NotOnOrAfter');
    }
    // node-saml times the first confirmation valid in time, whatever its recipient, so time this one too.
    if (confirmation.notOnOrAfter <= DateTime.utc().minus(this.options.clockSkew)) {
      throw invalid('outside validity window', { subjectNotOnOrAfter: confirmation.notOnOrAfter.toISO() });
    }
    if (!assertion.id) {
      throw invalid('missing assertion ID');
    }
    const subject = samlProfile.nameID;
    if (!subject) {
      throw invalid('missing NameID');
    }

    const accepted = config.acceptedAuthnContexts ?? [];
    if (accepted.length > 0 && !(assertion.authnContextClassRef && accepted.includes(assertion.authnContextClassRef))) {
      throw invalid('authentication context not accepted', { authnContextClassRef: assertion.authnContextClassRef });
    }
    if (stored.forceAuthn) {
      const requestedAt = DateTime.fromSeconds(stored.issuedAt, { zone: 'utc' }).minus(this.options.clockSkew);
      if (!assertion.authnInstant || assertion.authnInstant < requestedAt) {
        throw invalid('authentication not fresh', { authnInstant: assertion.authnInstant?.toISO() });
      }
    }

    // Held until the assertion could no longer be accepted anyway: its latest NotOnOrAfter, plus skew.
    const expiresAt = DateTime.max(confirmation.notOnOrAfter, assertion.conditionsNotOnOrAfter ?? confirmation.notOnOrAfter).plus(
      this.options.clockSkew,
    );
    const ttl = DateTime.max(expiresAt, DateTime.utc().plus({ seconds: 1 })).diffNow();
    if (!(await this.cache.add(this.getAssertionKey(config.idpEntityId, assertion.id), stored.requestId, { ttl }))) {
      throw new SamlRefusal(401, 'assertion_replayed', { assertion: 'already used' }, { provider, assertionId: assertion.id });
    }

    const attributes = isRecord(samlProfile.attributes) ? samlProfile.attributes : {};
    const nameIdFormat = samlProfile.nameIDFormat || undefined;
    const email =
      firstValue(attributes, config.attributeNames?.email, EMAIL_ATTRIBUTES) ?? (nameIdFormat === EMAIL_NAME_ID_FORMAT ? subject : undefined);
    const name = firstValue(attributes, config.attributeNames?.name, NAME_ATTRIBUTES) ?? joinedName(attributes);

    const profile: SamlProfile = {
      provider,
      subject,
      ...(nameIdFormat === undefined ? {} : { nameIdFormat }),
      ...(email === undefined ? {} : { email }),
      ...(name === undefined ? {} : { name }),
      ...(assertion.authnContextClassRef === undefined ? {} : { authnContextClassRef: assertion.authnContextClassRef }),
      ...(assertion.authnInstant === undefined ? {} : { authnInstant: assertion.authnInstant }),
      ...(assertion.sessionIndex === undefined ? {} : { sessionIndex: assertion.sessionIndex }),
      issuer: assertion.issuer,
      attributes,
    };
    return { stored, config, profile };
  }

  /** A node-saml instance for one provider and one request id. Cheap: it holds options only. */
  private createSaml(config: SamlProviderConfig, request: { requestId: string; forceAuthn: boolean }): SAML {
    if (config.idpSigningCertificates.length === 0) {
      throw httpError(500).withInternalDetails({ provider: config.name, idpSigningCertificates: 'empty' });
    }
    const accepted = [...(config.acceptedAuthnContexts ?? [])];
    return new SAML({
      issuer: config.spEntityId,
      callbackUrl: config.acsUrl.href,
      entryPoint: config.idpSsoUrl.href,
      idpIssuer: config.idpEntityId,
      audience: config.spEntityId,
      idpCert: config.idpSigningCertificates.map(certificate => parseSamlCertificate(certificate).pem),
      identifierFormat: config.nameIdFormat ?? DEFAULT_SAML_NAME_ID_FORMAT,
      authnContext: accepted,
      disableRequestedAuthnContext: accepted.length === 0,
      racComparison: 'exact',
      forceAuthn: request.forceAuthn,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: this.options.requestExpiration.toMillis(),
      acceptedClockSkewMs: this.options.clockSkew.toMillis(),
      cacheProvider: new SamlRequestIdCache(this.cache, this.options.requestExpiration),
      generateUniqueId: () => request.requestId,
      ...(config.spDecryption ? { decryptionPvk: config.spDecryption.privateKey } : {}),
    });
  }

  private async createFactor(actorId: string, value: { provider: string; subject: string; email: string | undefined }): Promise<SamlFactor> {
    return this.repo.createFactor(actorId, {
      provider: value.provider,
      subject: value.subject,
      ...(value.email === undefined ? {} : { email: value.email }),
    });
  }

  private async cachePendingAuthorization(args: Omit<StoredPendingAuthorization, 'authorizationId' | 'expiresAt'>): Promise<string> {
    const authorizationId = crypto.randomBytes(32).toString('base64url');
    const expiresAt = DateTime.utc().plus(this.options.pendingAuthorizationExpiration).toUnixInteger();
    const stored: StoredPendingAuthorization = { ...args, authorizationId, expiresAt };
    await this.cache.set(this.getAuthorizationKey(authorizationId), JSON.stringify(stored), this.options.pendingAuthorizationExpiration);
    return authorizationId;
  }

  /** Record a refused authorization. Never carries the response itself. */
  private async auditAuthorizationFailed(reason: FederatedFailureReason, provider = 'unknown', subject?: string) {
    await this.audit.record({
      type: 'saml.authorization.failed',
      category: 'login',
      outcome: 'failure',
      data: { provider, reason, ...(subject === undefined ? {} : { subject }) },
    });
  }
}

/**
 * node-saml's `InResponseTo` store on `@maroonedsoftware/cache`. node-saml saves each issued
 * request id with its issue instant, checks it on the response, and removes it once answered.
 */
class SamlRequestIdCache implements NodeSamlCacheProvider {
  constructor(
    private readonly cache: CacheProvider,
    private readonly ttl: Duration,
  ) {}

  private key(requestId: string) {
    return `saml_request_id_${requestId}`;
  }

  async saveAsync(requestId: string, value: string) {
    await this.cache.set(this.key(requestId), value, this.ttl);
    return { value, createdAt: DateTime.utc().toMillis() };
  }

  async getAsync(requestId: string) {
    return await this.cache.get(this.key(requestId));
  }

  async removeAsync(requestId: string | null) {
    return requestId ? await this.cache.delete(this.key(requestId)) : null;
  }
}

/** A client-safe name for the node-saml check that failed. The full message goes to internal details. */
function describeNodeSamlError(message: string): string {
  if (/signature/i.test(message)) return 'signature invalid';
  if (/audience/i.test(message)) return 'audience mismatch';
  if (/expired|not yet valid|subject confirmation/i.test(message)) return 'outside validity window';
  if (/InResponseTo/i.test(message)) return 'does not answer the request';
  if (/assertion/i.test(message)) return 'missing or malformed assertion';
  return 'invalid';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first non-empty string value among `preferred` and then `names`. Multi-valued attributes yield their first string. */
function firstValue(attributes: Record<string, unknown>, preferred: string | undefined, names: readonly string[]): string | undefined {
  for (const name of preferred === undefined ? names : [preferred, ...names]) {
    const raw = attributes[name];
    const value = (Array.isArray(raw) ? raw.find(entry => typeof entry === 'string') : raw) as unknown;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function joinedName(attributes: Record<string, unknown>): string | undefined {
  const parts = [firstValue(attributes, undefined, GIVEN_NAME_ATTRIBUTES), firstValue(attributes, undefined, SURNAME_ATTRIBUTES)].filter(
    (part): part is string => part !== undefined,
  );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

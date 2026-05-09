import { Injectable } from 'injectkit';
import {
  AssertionResult,
  AttestationResult,
  ExpectedAssertionResult,
  ExpectedAttestationResult,
  Fido2Lib,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialRequestOptions,
} from 'fido2-lib';
import { FidoFactor, FidoFactorRepository } from './fido.factor.repository.js';
import { DateTime, Duration } from 'luxon';
import crypto from 'node:crypto';
import { CacheProvider } from '@maroonedsoftware/cache';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';

/**
 * Configuration options for {@link FidoFactorService}.
 */
export class FidoFactorServiceOptions {
  constructor(
    /** How long a pending registration or authorization challenge remains valid. Also forwarded to the authenticator as the WebAuthn `timeout` hint. */
    public readonly timeout: Duration = Duration.fromDurationLike({ minutes: 5 }),
    /** Effective relying party id — the host the credential will be bound to. */
    public readonly rpId: string = 'localhost',
    /** Human-readable name of the relying party, shown in the authenticator UI. */
    public readonly rpName: string = 'Localhost',
    /** Full origin (scheme + host + optional port) of the relying party. */
    public readonly rpOrigin: string = 'http://localhost',
    /** Optional icon URL for the relying party. */
    public readonly rpIcon?: string,
  ) {}
}

/**
 * Per-call WebAuthn relying party overrides for an authorization (sign-in) challenge.
 *
 * `rpId` and `rpOrigin` must match what the browser sees — `rpId` is the host
 * (e.g. `example.com`) and `rpOrigin` is the scheme + host (e.g. `https://example.com`).
 * A mismatch causes the assertion to be rejected by the authenticator.
 *
 * Both fields are optional: when omitted, the corresponding default from
 * {@link FidoFactorServiceOptions} is used. Supply them per-call to serve
 * multiple hosts from a single service instance.
 */
export type AuthorizeFidoFactorOptions = {
  /** Effective relying party id — the host the credential is bound to. Falls back to `FidoFactorServiceOptions.rpId`. */
  rpId?: string;
  /** Full origin (scheme + host + optional port) of the relying party. Falls back to `FidoFactorServiceOptions.rpOrigin`. */
  rpOrigin?: string;
};

/**
 * Per-call WebAuthn relying party overrides + user context for a registration challenge.
 *
 * The relying party fields all fall back to the corresponding
 * {@link FidoFactorServiceOptions} defaults when omitted; `userName` and
 * `userDisplayName` are required because they identify the human being
 * registered, not the application.
 */
export type RegisterFidoFactorOptions = {
  /** A human-readable label for the factor. */
  label?: string;
  /** Effective relying party id — the host the credential will be bound to. Falls back to `FidoFactorServiceOptions.rpId`. */
  rpId?: string;
  /** Human-readable name of the relying party, shown in the authenticator UI. Falls back to `FidoFactorServiceOptions.rpName`. */
  rpName?: string;
  /** Full origin (scheme + host + optional port) of the relying party. Falls back to `FidoFactorServiceOptions.rpOrigin`. */
  rpOrigin?: string;
  /** Optional icon URL for the relying party. Falls back to `FidoFactorServiceOptions.rpIcon`. */
  rpIcon?: string;
  /** Account-level identifier for the user (e.g. email or username). Shown on the authenticator. */
  userName: string;
  /** Friendly display name for the user. Shown on the authenticator. */
  userDisplayName: string;
};

/**
 * Common shape of a `PublicKeyCredential` after the client serializes the
 * `id` and `rawId` fields to base64 strings for transport.
 */
export type PublicKeyCredential = {
  id: string;
  type: 'public-key';
  rawId: string;
  authenticatorAttachment?: 'cross-platform' | 'platform';
};

/**
 * Subset of the WebAuthn client extension results the service round-trips.
 */
export type SimpleClientExtensionResults = {
  appid?: boolean;
  appidExclude?: boolean;
  credProps?: {
    rk: boolean;
  };
};

/**
 * Transports the authenticator advertises (WebAuthn `transports`).
 */
export type AuthenticatorTransport = 'hybrid' | 'ble' | 'internal' | 'nfc' | 'usb';

/**
 * Serialized form of `AuthenticatorAttestationResponse` — produced by the
 * browser at registration; all binary fields are base64-encoded for transport.
 */
export type AuthenticatorAttestationResponse = {
  clientDataJSON: string;
  attestationObject: string;
  transports?: AuthenticatorTransport[];
};

/**
 * The credential the client posts back to complete registration.
 */
export type PublicKeyCredentialWithAttestation = PublicKeyCredential & {
  clientExtensionResults: SimpleClientExtensionResults;
  response: AuthenticatorAttestationResponse;
};

/**
 * Allow-list entry describing a credential the user already has.
 */
export type PublicKeyCredentialDescriptor = {
  type: 'public-key';
  id: string;
  transports?: AuthenticatorTransport[];
};

/**
 * Serialized form of `AuthenticatorAssertionResponse` — produced by the
 * browser at sign-in; all binary fields are base64-encoded for transport.
 */
export type AuthenticatorAssertionResponse = {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string;
};

/**
 * The credential the client posts back to complete an authorization challenge.
 */
export type PublicKeyCredentialWithAssertion = PublicKeyCredential & {
  clientExtensionResults: SimpleClientExtensionResults;
  response: AuthenticatorAssertionResponse;
};

type FidoPayload = {
  id: string;
  actorId: string;
  expiresAt: number;
  issuedAt: number;
};

type ChallengePayload = FidoPayload & {
  factorId: string;
  assertionOptions: PublicKeyCredentialRequestOptions;
  assertionExpectations: Omit<ExpectedAssertionResult, 'allowCredentials'> & { allowCredentials?: PublicKeyCredentialDescriptor[] };
};

type RegistrationPayload = FidoPayload & {
  label?: string;
  attestationOptions: PublicKeyCredentialCreationOptions;
  attestationExpectations: ExpectedAttestationResult;
};

type PayloadOptions =
  | {
      method: 'attestation';
      options: RegisterFidoFactorOptions;
      label?: string;
    }
  | {
      method: 'assertion';
      options: AuthorizeFidoFactorOptions;
      factors: FidoFactor[];
      label?: string;
    };

/**
 * Manages the lifecycle of FIDO2/WebAuthn authentication factors.
 *
 * Wraps `fido2-lib` and persists per-actor credentials via
 * {@link FidoFactorRepository}. The relying party identifiers (`rpId`,
 * `rpOrigin`, `rpName`, `rpIcon`) come from {@link FidoFactorServiceOptions}
 * by default but can be overridden per-call, so a single service instance
 * can serve a single primary host out of the box and still front multiple
 * hosts when the caller supplies overrides.
 *
 * **Registration flow:**
 * 1. Call {@link registerFidoFactor} → returns a `registrationId`, the
 *    `attestationOptions` to pass to `navigator.credentials.create`, and an
 *    `alreadyRegistered` flag for idempotency.
 * 2. The browser returns a `PublicKeyCredentialWithAttestation`. Send it to
 *    {@link createFidoFactorFromRegistration} along with the `registrationId`
 *    to verify the attestation and persist the new factor; returns the new
 *    {@link FidoFactor}.
 *
 * **Authorization (sign-in) flow:**
 * 1. Call {@link createFidoAuthorizationChallenge} with the actor and an
 *    optional `factorId` (to scope the challenge to one factor) → returns a
 *    `challengeId`, the `assertionOptions` to pass to
 *    `navigator.credentials.get`, and an `alreadyIssued` flag for idempotency.
 * 2. The browser returns a `PublicKeyCredentialWithAssertion`. Send it to
 *    {@link verifyFidoAuthorizationChallenge} along with the `challengeId` to
 *    verify the signature and bump the counter; returns the verified
 *    {@link FidoFactor}.
 *
 * Both registration and challenge are idempotent: a second call for the same
 * actor (or the same `actor+factorId` pair) returns the cached payload with
 * `alreadyRegistered`/`alreadyIssued: true` so the caller can skip duplicate
 * client work.
 *
 * Challenges are cached for {@link FidoFactorServiceOptions.timeout} so the
 * server can verify the response without holding state in memory.
 */
@Injectable()
export class FidoFactorService {
  private readonly fido2: Fido2Lib;

  constructor(
    private readonly options: FidoFactorServiceOptions,
    private readonly fidoFactorRepository: FidoFactorRepository,
    private readonly cache: CacheProvider,
  ) {
    this.fido2 = new Fido2Lib({
      // rpId: 'example.com',
      // rpName: 'Example',
      challengeSize: 128,
      cryptoParams: [
        -8, // Ed25519
        -7, //ES256
        -257, // RS256
      ],
      authenticatorAttachment: 'cross-platform',
      authenticatorUserVerification: 'preferred',
      attestation: 'none',
      timeout: this.options.timeout.toMillis(),
    });
  }
  private getChallengeKey(key: string) {
    return `fido_factor_challenge_${key}`;
  }

  private getRegistrationKey(key: string) {
    return `fido_factor_registration_${key}`;
  }

  private async lookupRegistration(registrationId: string) {
    const response = await this.cache.get(this.getRegistrationKey(registrationId));
    return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
  }

  private async lookupRegistrationByValue(actorId: string) {
    const registrationId = await this.cache.get(this.getRegistrationKey(actorId));
    return registrationId ? await this.lookupRegistration(registrationId) : undefined;
  }

  private async cacheRegistration(actorId: string, payload: RegistrationPayload, expiration: Duration) {
    const registrationId = payload.id ?? crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getRegistrationKey(actorId), registrationId, expiration);

    return registrationId;
  }

  private async lookupChallenge(challengeId: string) {
    const response = await this.cache.get(this.getChallengeKey(challengeId));
    return response ? (JSON.parse(response) as ChallengePayload) : undefined;
  }

  private async lookupChallengeByActorAndFactor(actorId: string, factorId: string) {
    const challengeId = await this.cache.get(this.getChallengeKey(`${actorId}_${factorId}`));
    return challengeId ? await this.lookupChallenge(challengeId) : undefined;
  }

  private async cacheChallenge(payload: ChallengePayload, expiration: Duration) {
    const challengeId = crypto.randomBytes(32).toString('base64url');
    payload.id = challengeId;
    await this.cache.set(this.getChallengeKey(challengeId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getChallengeKey(`${payload.actorId}_${payload.factorId}`), challengeId, expiration);
    return challengeId;
  }

  private async createAttestation(actorId: string, options: RegisterFidoFactorOptions) {
    const attestationOptions = await this.fido2.attestationOptions();
    const encodedId = new TextEncoder().encode(actorId);
    attestationOptions.rp.id = options.rpId ?? this.options.rpId;
    attestationOptions.rp.name = options.rpName ?? this.options.rpName;
    attestationOptions.rp.icon = options.rpIcon ?? this.options.rpIcon;
    attestationOptions.user.id = encodedId.buffer.slice(encodedId.byteOffset, encodedId.byteLength + encodedId.byteOffset) as ArrayBuffer;
    attestationOptions.user.name = options.userName;
    attestationOptions.user.displayName = options.userDisplayName;

    const challenge = crypto.randomBytes(128);

    attestationOptions.challenge = challenge.buffer.slice(challenge.byteOffset, challenge.byteLength + challenge.byteOffset) as ArrayBuffer;

    const attestationExpectations: ExpectedAttestationResult = {
      challenge: challenge.toString('base64'),
      rpId: attestationOptions.rp.id,
      origin: options.rpOrigin ?? this.options.rpOrigin,
      factor: 'either',
    };

    return { attestationOptions, attestationExpectations };
  }

  private async createAssertion(actorId: string, options: AuthorizeFidoFactorOptions, factors: FidoFactor[]) {
    const assertionOptions = await this.fido2.assertionOptions();

    assertionOptions.rpId = options.rpId ?? this.options.rpId;

    const challenge = crypto.randomBytes(128);

    assertionOptions.challenge = challenge.buffer.slice(challenge.byteOffset, challenge.byteLength + challenge.byteOffset) as ArrayBuffer;

    const allowCredentials: PublicKeyCredentialDescriptor[] = factors.map(x => ({
      id: x.publicKeyId,
      type: 'public-key',
    }));

    const assertionExpectations: Omit<ExpectedAssertionResult, 'allowCredentials'> & { allowCredentials?: PublicKeyCredentialDescriptor[] } = {
      challenge: challenge.toString('base64'),
      rpId: assertionOptions.rpId,
      origin: options.rpOrigin ?? this.options.rpOrigin,
      factor: 'either',
      publicKey: '',
      prevCounter: 0,
      userHandle: Buffer.from(actorId).toString('base64'),
      allowCredentials,
    };

    return { assertionOptions, assertionExpectations };
  }

  private async createPayload<T extends FidoPayload>(actorId: string, options: PayloadOptions, registrationId?: string) {
    const result =
      options.method === 'attestation'
        ? await this.createAttestation(actorId, options.options)
        : await this.createAssertion(actorId, options.options, options.factors);

    const issuedAt = DateTime.utc();
    const expiresAt = issuedAt.plus(this.options.timeout);

    const payload = {
      id: registrationId,
      actorId,
      label: options.label,
      expiresAt: expiresAt.toUnixInteger(),
      issuedAt: issuedAt.toUnixInteger(),
      ...result,
    } as unknown as T;

    return { payload, expiresAt, issuedAt, expiration: this.options.timeout };
  }

  /**
   * Initiate FIDO factor registration by generating an attestation challenge
   * and caching the expected attestation result for verification.
   *
   * Pass `attestationOptions` (or the spread `user`/`challenge`/`attestation`
   * fields) to `navigator.credentials.create({ publicKey: ... })` after
   * decoding the base64-encoded `challenge` and `user.id` to `ArrayBuffer`s.
   * Complete registration with {@link createFidoFactorFromRegistration},
   * passing the returned `registrationId` back in.
   *
   * Idempotent: if a pending registration is already cached for this actor —
   * or for the supplied `registrationId` — the existing payload is returned
   * with `alreadyRegistered: true`, so callers can avoid double-prompting the
   * authenticator.
   *
   * @param actorId        - The actor that will own the new factor.
   * @param options        - User metadata plus optional per-call relying party
   *   overrides. `userName` and `userDisplayName` are required; `rpId` /
   *   `rpName` / `rpOrigin` / `rpIcon` each fall back to the matching
   *   {@link FidoFactorServiceOptions} default.
   * @param registrationId - Optional caller-supplied id. When set, the method
   *   first checks for a cached registration under this id before falling back
   *   to the actor-keyed lookup; on a cache miss it is used as the id of the
   *   freshly cached registration.
   * @returns `{ registrationId, attestationOptions, user, challenge, attestation, expiresAt, issuedAt, alreadyRegistered }`.
   */
  async registerFidoFactor(actorId: string, options: RegisterFidoFactorOptions, registrationId?: string) {
    const existingRegistration = registrationId ? await this.lookupRegistration(registrationId) : await this.lookupRegistrationByValue(actorId);
    if (existingRegistration) {
      // The cached attestationOptions.user.id was an ArrayBuffer that JSON
      // stringification flattened into `{}`; rebuild the base64 id from the
      // payload's actorId, matching what the fresh-registration path returns.
      const userIdBase64 = Buffer.from(new TextEncoder().encode(existingRegistration.actorId)).toString('base64');
      return {
        registrationId: existingRegistration.id,
        attestationOptions: existingRegistration.attestationOptions,
        user: {
          ...existingRegistration.attestationOptions.user,
          id: userIdBase64,
        },
        challenge: existingRegistration.attestationExpectations.challenge,
        attestation: existingRegistration.attestationOptions.attestation ?? 'none',
        expiresAt: DateTime.fromSeconds(existingRegistration.expiresAt),
        issuedAt: DateTime.fromSeconds(existingRegistration.issuedAt),
        alreadyRegistered: true,
      };
    }

    const { payload, expiresAt, issuedAt } = await this.createPayload<RegistrationPayload>(
      actorId,
      { method: 'attestation', options, label: options.label },
      registrationId,
    );

    registrationId = await this.cacheRegistration(actorId, payload, this.options.timeout);

    return {
      registrationId,
      attestationOptions: payload.attestationOptions,
      user: { ...payload.attestationOptions.user, id: Buffer.from(payload.attestationOptions.user.id).toString('base64') },
      challenge: payload.attestationExpectations.challenge,
      attestation: payload.attestationOptions.attestation ?? 'none',
      expiresAt,
      issuedAt,
      alreadyRegistered: false,
    };
  }

  /**
   * Complete FIDO factor registration by verifying the authenticator's
   * attestation against the cached challenge and persisting the new factor.
   *
   * On success the cached registration entries (under both the registration id
   * and the actor) are deleted so the challenge cannot be replayed.
   *
   * @param actorId        - The actor to attach the factor to.
   * @param registrationId - The registration reference returned by {@link registerFidoFactor}.
   * @param credential     - The `PublicKeyCredential` returned by the browser, with
   *   `id`/`rawId` and the attestation response fields base64-encoded.
   * @returns The newly created {@link FidoFactor}.
   * @throws HTTP 404 when the registration has expired or does not exist.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_credentials"`)
   *   when attestation verification fails. The original error is attached as the cause.
   */
  async createFidoFactorFromRegistration(actorId: string, registrationId: string, credential: PublicKeyCredentialWithAttestation) {
    const payload = await this.lookupRegistration(registrationId);
    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    const id = Uint8Array.from(Buffer.from(credential.id, 'base64')).buffer;
    const rawId = Uint8Array.from(Buffer.from(credential.rawId, 'base64')).buffer;
    const attestationResult: AttestationResult = { ...credential, id, rawId };

    try {
      const result = await this.fido2.attestationResult(attestationResult, payload.attestationExpectations);

      const factor = await this.fidoFactorRepository.createFactor(actorId, {
        publicKey: result.authnrData.get('credentialPublicKeyPem'),
        publicKeyId: credential.id,
        counter: result.authnrData.get('counter'),
        label: payload.label,
      });

      await this.cache.delete(this.getRegistrationKey(registrationId));
      await this.cache.delete(this.getRegistrationKey(actorId));

      return factor;
    } catch (ex) {
      throw unauthorizedError('Bearer error="invalid_credentials"')
        .withCause(ex as Error)
        .withInternalDetails({ attestationResult, expectedAttestationResult: payload.attestationExpectations });
    }
  }

  /**
   * Initiate a FIDO authorization (sign-in) challenge for an actor.
   *
   * Pass `assertionOptions` (or the spread `challenge`/`allowCredentials`
   * fields) to `navigator.credentials.get({ publicKey: ... })` after decoding
   * the base64 `challenge` and each `allowCredentials[].id` to `ArrayBuffer`s.
   * Complete with {@link verifyFidoAuthorizationChallenge}, passing the
   * returned `challengeId` back in.
   *
   * Two flavors:
   * - `factorId` provided → narrows `allowCredentials` to that single factor;
   *   the verifier additionally enforces that the credential the browser
   *   returned belongs to that factor.
   * - `factorId` omitted → `allowCredentials` includes all of the actor's
   *   active factors; any of them is acceptable at verify time.
   *
   * Idempotent per `(actorId, factorId)` pair (or `(actorId, 'any')` when
   * `factorId` is omitted): a second call with the same scope returns the
   * cached payload with `alreadyIssued: true`.
   *
   * @param actorId  - The actor attempting to authenticate.
   * @param factorId - Optional row id of a specific factor to challenge. When
   *   omitted, all active factors are eligible.
   * @param options  - Optional per-call relying party overrides. Each field
   *   falls back to the matching {@link FidoFactorServiceOptions} default
   *   when omitted.
   * @returns `{ challengeId, assertionOptions, challenge, allowCredentials, expiresAt, issuedAt, alreadyIssued }`.
   * @throws HTTP 404 with `factorId: 'not found'` when `factorId` is supplied
   *   but does not match a factor for this actor.
   * @throws HTTP 404 with `actorId: 'no factors found'` when `factorId` is
   *   omitted and the actor has no active factors.
   */
  async createFidoAuthorizationChallenge(actorId: string, factorId: string | undefined, options: AuthorizeFidoFactorOptions = {}) {
    let factors: FidoFactor[];

    if (factorId) {
      const factor = await this.fidoFactorRepository.getFactor(actorId, factorId);
      if (!factor) {
        throw httpError(404).withDetails({ factorId: 'not found' });
      }
      factors = [factor];
    } else {
      factorId = 'any';
      factors = await this.fidoFactorRepository.listFactors(actorId, true);
      if (factors.length === 0) {
        throw httpError(404).withDetails({ actorId: 'no factors found' });
      }
    }

    const existingChallenge = await this.lookupChallengeByActorAndFactor(actorId, factorId);
    if (existingChallenge) {
      return {
        challengeId: existingChallenge.id,
        assertionOptions: existingChallenge.assertionOptions,
        challenge: existingChallenge.assertionExpectations.challenge,
        allowCredentials: existingChallenge.assertionExpectations.allowCredentials,
        expiresAt: DateTime.fromSeconds(existingChallenge.expiresAt),
        issuedAt: DateTime.fromSeconds(existingChallenge.issuedAt),
        alreadyIssued: true,
      };
    }

    const { payload, expiresAt, issuedAt } = await this.createPayload<ChallengePayload>(actorId, { method: 'assertion', options, factors });

    payload.factorId = factorId;

    const challengeId = await this.cacheChallenge(payload, this.options.timeout);

    return {
      challengeId,
      assertionOptions: payload.assertionOptions,
      challenge: payload.assertionExpectations.challenge,
      allowCredentials: payload.assertionExpectations.allowCredentials,
      expiresAt,
      issuedAt,
      alreadyIssued: false,
    };
  }

  /**
   * Complete a FIDO authorization challenge.
   *
   * Loads the cached assertion expectations, resolves the factor by the
   * credential id reported by the browser, verifies the assertion via
   * `fido2-lib`, and persists the updated signature counter on success. The
   * cached challenge entries (under both the challenge id and the
   * actor+factor pair) are deleted on success so the challenge cannot be
   * replayed.
   *
   * @param challengeId - The challenge reference returned by {@link createFidoAuthorizationChallenge}.
   * @param credential  - The `PublicKeyCredential` returned by the browser, with
   *   `id`/`rawId` and the assertion response fields base64-encoded.
   * @returns The verified {@link FidoFactor}.
   * @throws HTTP 404 when the challenge has expired or does not exist.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_factor"`) when
   *   the credential id is unknown for this actor, the matching factor is
   *   inactive, or the credential does not belong to the factor that was
   *   scoped at issue time.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_credentials"`)
   *   when signature verification fails. The original `fido2-lib` error is
   *   attached as the cause.
   */
  async verifyFidoAuthorizationChallenge(challengeId: string, credential: PublicKeyCredentialWithAssertion) {
    const payload = await this.lookupChallenge(challengeId);
    if (!payload) {
      throw httpError(404).withDetails({ challengeId: 'not found' });
    }

    const factor = await this.fidoFactorRepository.lookupFactor(payload.actorId, credential.id);
    if (!factor || !factor.active) {
      throw unauthorizedError('Bearer error="invalid_factor"');
    }

    if (payload.factorId !== 'any' && factor.id !== payload.factorId) {
      throw unauthorizedError('Bearer error="invalid_factor"');
    }

    const expectedAssertionResult = payload.assertionExpectations as ExpectedAssertionResult;

    expectedAssertionResult.publicKey = factor.publicKey;
    expectedAssertionResult.prevCounter = factor.counter;

    const id = Uint8Array.from(Buffer.from(credential.id, 'base64')).buffer;
    const rawId = Uint8Array.from(Buffer.from(credential.rawId, 'base64')).buffer;
    const authenticatorData = Uint8Array.from(Buffer.from(credential.response.authenticatorData, 'base64')).buffer;

    const assertionResult: AssertionResult = { response: { ...credential.response, authenticatorData }, id, rawId };

    try {
      const result = await this.fido2.assertionResult(assertionResult, expectedAssertionResult);
      await this.fidoFactorRepository.updateFactorCounter(payload.actorId, factor.id, result.authnrData.get('counter'));
      await this.cache.delete(this.getChallengeKey(challengeId));
      await this.cache.delete(this.getChallengeKey(`${payload.actorId}_${payload.factorId}`));
      return factor;
    } catch (ex) {
      throw unauthorizedError('Bearer error="invalid_credentials"')
        .withCause(ex as Error)
        .withInternalDetails({ assertionResult, expectedAssertionResult });
    }
  }

  /**
   * Check whether an authorization challenge is still pending (i.e. cached and not yet expired).
   *
   * @param challengeId - The challenge reference returned by {@link createFidoAuthorizationChallenge}.
   * @returns `true` if the challenge exists and has not expired, `false` otherwise.
   */
  async hasPendingChallenge(challengeId: string) {
    return (await this.lookupChallenge(challengeId)) !== undefined;
  }

  /**
   * Check whether a registration is still pending (i.e. cached and not yet expired).
   *
   * @param registrationId - The registration reference returned by {@link registerFidoFactor}.
   * @returns `true` if the registration exists and has not expired, `false` otherwise.
   */
  async hasPendingRegistration(registrationId: string) {
    return (await this.lookupRegistration(registrationId)) !== undefined;
  }
}

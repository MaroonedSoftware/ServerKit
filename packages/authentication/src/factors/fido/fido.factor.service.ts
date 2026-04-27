import { Injectable } from 'injectkit';
import { AssertionResult, AttestationResult, ExpectedAssertionResult, ExpectedAttestationResult, Fido2Lib } from 'fido2-lib';
import { FidoFactorRepository } from './fido.factor.repository.js';
import { Duration } from 'luxon';
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
  ) {}
}

/**
 * Per-call WebAuthn relying party context for an authorization (sign-in) challenge.
 *
 * `rpId` and `rpOrigin` must match what the browser sees — `rpId` is the host
 * (e.g. `example.com`) and `rpOrigin` is the scheme + host (e.g. `https://example.com`).
 * A mismatch causes the assertion to be rejected by the authenticator.
 */
export type AuthorizeFidoFactorOptions = {
  /** Effective relying party id — the host the credential is bound to. */
  rpId: string;
  /** Full origin (scheme + host + optional port) of the relying party. */
  rpOrigin: string;
};

/**
 * Per-call WebAuthn relying party + user context for a registration challenge.
 */
export type RegisterFidoFactorOptions = {
  /** Effective relying party id — the host the credential will be bound to. */
  rpId: string;
  /** Human-readable name of the relying party, shown in the authenticator UI. */
  rpName: string;
  /** Full origin (scheme + host + optional port) of the relying party. */
  rpOrigin: string;
  /** Optional icon URL for the relying party. */
  rpIcon?: string;
  /** Account-level identifier for the user (e.g. email or username). Shown on the authenticator. */
  userName: string;
  /** Friendly display name for the user. Shown on the authenticator. */
  userDisplayName: string;
};

/**
 * The attestation challenge returned to the client.
 *
 * Pass this to `navigator.credentials.create({ publicKey: ... })` after
 * decoding the base64-encoded `challenge` and `user.id` to `ArrayBuffer`s.
 */
export type FidoAttestation = {
  /** Relying party metadata to display on the authenticator. */
  rp: {
    name: string;
    id: string;
    icon?: string;
  };
  /** User metadata to bind the new credential to. `id` is base64-encoded. */
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  /** Random server-generated challenge (base64). The authenticator signs this. */
  challenge: string;
  /** Acceptable algorithms for the credential, in preference order. */
  pubKeyCredParams: {
    type: 'public-key';
    alg: number;
  }[];
  /** WebAuthn `timeout` hint (milliseconds). */
  timeout?: number;
  /** Attestation conveyance preference. */
  attestation: 'direct' | 'indirect' | 'none';
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

/**
 * Manages the lifecycle of FIDO2/WebAuthn authentication factors.
 *
 * Wraps `fido2-lib` and persists per-actor credentials via
 * {@link FidoFactorRepository}. The relying party identifiers (`rpId`,
 * `rpOrigin`, `rpName`) are supplied per-call rather than configured
 * statically, so the same service can serve multiple hosts.
 *
 * **Registration flow:**
 * 1. Call {@link registerFidoFactor} with the actor and relying party context →
 *    returns a {@link FidoAttestation} to pass to `navigator.credentials.create`.
 * 2. The browser returns a `PublicKeyCredentialWithAttestation`. Send it to
 *    {@link createFidoFactorFromRegistration} to verify the attestation and
 *    persist the new factor; returns the new factor id.
 *
 * **Authorization (sign-in) flow:**
 * 1. Call {@link createFidoAuthorizationChallenge} → returns assertion options
 *    (including `allowCredentials` populated from the actor's active factors)
 *    to pass to `navigator.credentials.get`.
 * 2. The browser returns a `PublicKeyCredentialWithAssertion`. Send it to
 *    {@link verifyFidoAuthorizationChallenge} to verify the signature and
 *    bump the counter; returns `{ actorId, factorId }`.
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

  private getRegistrationKey(key: string) {
    return `fido_factor_registration_${key}`;
  }

  private getAuthorizationKey(key: string) {
    return `fido_factor_authorization_${key}`;
  }

  /**
   * Initiate FIDO factor registration by generating an attestation challenge
   * and caching the expected attestation result for verification.
   *
   * Pass the returned object to `navigator.credentials.create({ publicKey: ... })`
   * after decoding the base64-encoded `challenge` and `user.id` to `ArrayBuffer`s.
   * Complete registration with {@link createFidoFactorFromRegistration}.
   *
   * @param actorId - The actor that will own the new factor.
   * @param options - Per-call relying party and user metadata.
   * @returns A {@link FidoAttestation} ready to forward to the browser.
   */
  async registerFidoFactor(actorId: string, options: RegisterFidoFactorOptions): Promise<FidoAttestation> {
    const attestationOptions = await this.fido2.attestationOptions();
    const encodedId = new TextEncoder().encode(actorId);
    attestationOptions.rp.id = options.rpId;
    attestationOptions.rp.name = options.rpName;
    attestationOptions.rp.icon = options.rpIcon;
    attestationOptions.user.id = encodedId.buffer.slice(encodedId.byteOffset, encodedId.byteLength + encodedId.byteOffset) as ArrayBuffer;
    attestationOptions.user.name = options.userName;
    attestationOptions.user.displayName = options.userDisplayName;

    const challenge = crypto.randomBytes(128);

    attestationOptions.challenge = challenge.buffer.slice(challenge.byteOffset, challenge.byteLength + challenge.byteOffset) as ArrayBuffer;

    const userId = Buffer.from(attestationOptions.user.id).toString('base64');

    const attestationExpectations: ExpectedAttestationResult = {
      challenge: challenge.toString('base64'),
      rpId: attestationOptions.rp.id,
      origin: options.rpOrigin,
      factor: 'either',
    };

    await this.cache.set(this.getRegistrationKey(actorId), JSON.stringify(attestationExpectations), this.options.timeout);

    return {
      ...attestationOptions,
      user: { ...attestationOptions.user, id: userId },
      challenge: challenge.toString('base64'),
      attestation: attestationOptions.attestation ?? 'none',
    };
  }

  /**
   * Complete FIDO factor registration by verifying the authenticator's
   * attestation against the cached challenge and persisting the new factor.
   *
   * On success the cached registration challenge is deleted so it cannot be replayed.
   *
   * @param actorId    - The actor the registration was started for.
   * @param credential - The `PublicKeyCredential` returned by the browser, with
   *   `id`/`rawId` and the attestation response fields base64-encoded.
   * @returns The id of the newly created {@link FidoFactor}.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_registration"`)
   *   when no pending registration is cached for this actor (expired or never started).
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_credentials"`)
   *   when attestation verification fails. The original error is attached as the cause.
   */
  async createFidoFactorFromRegistration(actorId: string, credential: PublicKeyCredentialWithAttestation) {
    const cacheAttestationExpectations = await this.cache.get(this.getRegistrationKey(actorId));
    if (!cacheAttestationExpectations) {
      throw unauthorizedError('Bearer error="invalid_registration"');
    }

    const expectedAttestationResult = JSON.parse(cacheAttestationExpectations) as ExpectedAttestationResult;

    const id = Uint8Array.from(Buffer.from(credential.id, 'base64')).buffer;
    const rawId = Uint8Array.from(Buffer.from(credential.rawId, 'base64')).buffer;
    const attestationResult: AttestationResult = { ...credential, id, rawId };

    try {
      const result = await this.fido2.attestationResult(attestationResult, expectedAttestationResult);

      const factor = await this.fidoFactorRepository.createFactor(
        actorId,
        result.authnrData.get('credentialPublicKeyPem'),
        credential.id,
        result.authnrData.get('counter'),
        true,
      );

      await this.cache.delete(this.getRegistrationKey(actorId));

      return factor.id;
    } catch (ex) {
      throw unauthorizedError('Bearer error="invalid_credentials"')
        .withCause(ex as Error)
        .withInternalDetails({ attestationResult, expectedAttestationResult });
    }
  }

  /**
   * Initiate a FIDO authorization (sign-in) challenge for an actor.
   *
   * Looks up the actor's active factors and emits assertion options with an
   * `allowCredentials` list, so the browser only prompts for credentials the
   * user actually has. Pass the returned object to
   * `navigator.credentials.get({ publicKey: ... })` after decoding the
   * `challenge` and each `allowCredentials[].id` to `ArrayBuffer`s.
   * Complete with {@link verifyFidoAuthorizationChallenge}.
   *
   * @param actorId - The actor attempting to authenticate.
   * @param options - Per-call relying party context (`rpId`, `rpOrigin`).
   * @returns Assertion options including `challenge` (base64) and
   *   `allowCredentials` populated from the actor's active factors.
   * @throws HTTP 404 when the actor has no active FIDO factors.
   */
  async createFidoAuthorizationChallenge(actorId: string, options: AuthorizeFidoFactorOptions) {
    const factors = await this.fidoFactorRepository.listFactors(actorId, true);
    if (factors.length === 0) {
      throw httpError(404).withDetails({ actorId: 'no factors found' });
    }

    const assertionOptions = await this.fido2.assertionOptions();

    assertionOptions.rpId = options.rpId;

    const challenge = crypto.randomBytes(128);

    assertionOptions.challenge = challenge.buffer.slice(challenge.byteOffset, challenge.byteLength + challenge.byteOffset) as ArrayBuffer;

    const allowCredentials: PublicKeyCredentialDescriptor[] = factors.map(x => ({
      id: x.publicKeyId,
      type: 'public-key',
    }));

    const assertionExpectations: Omit<ExpectedAssertionResult, 'allowCredentials'> & { allowCredentials?: PublicKeyCredentialDescriptor[] } = {
      challenge: challenge.toString('base64'),
      rpId: assertionOptions.rpId,
      origin: options.rpOrigin,
      factor: 'either',
      publicKey: '',
      prevCounter: 0,
      userHandle: Buffer.from(actorId).toString('base64'),
      allowCredentials,
    };

    await this.cache.set(this.getAuthorizationKey(actorId), JSON.stringify(assertionExpectations), this.options.timeout);

    return { ...assertionOptions, challenge: challenge.toString('base64'), allowCredentials };
  }

  /**
   * Complete a FIDO authorization challenge.
   *
   * Loads the cached assertion expectations, looks up the credential the user
   * picked, verifies the assertion via `fido2-lib`, and persists the updated
   * signature counter on success. The cached challenge is deleted on success
   * so it cannot be replayed.
   *
   * @param actorId    - The actor that started the challenge.
   * @param credential - The `PublicKeyCredential` returned by the browser, with
   *   `id`/`rawId` and the assertion response fields base64-encoded.
   * @returns `{ actorId, factorId }` identifying the actor and the credential used.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_credentials"`)
   *   when no challenge is cached (expired or never started), the credential
   *   id is unknown for this actor, or signature verification fails.
   */
  async verifyFidoAuthorizationChallenge(actorId: string, credential: PublicKeyCredentialWithAssertion) {
    const cacheAssertionExpectations = await this.cache.get(this.getAuthorizationKey(actorId));
    if (!cacheAssertionExpectations) {
      throw unauthorizedError('Bearer error="invalid_credentials"');
    }

    const expectedAssertionResult = JSON.parse(cacheAssertionExpectations) as ExpectedAssertionResult;

    const factor = await this.fidoFactorRepository.getFactor(actorId, credential.id);
    if (!factor) {
      throw unauthorizedError('Bearer error="invalid_credentials"');
    }

    expectedAssertionResult.publicKey = factor.publicKey;
    expectedAssertionResult.prevCounter = factor.counter;

    const id = Uint8Array.from(Buffer.from(credential.id, 'base64')).buffer;
    const rawId = Uint8Array.from(Buffer.from(credential.rawId, 'base64')).buffer;
    const authenticatorData = Uint8Array.from(Buffer.from(credential.response.authenticatorData, 'base64')).buffer;

    const assertionResult: AssertionResult = { response: { ...credential.response, authenticatorData }, id, rawId };

    try {
      const result = await this.fido2.assertionResult(assertionResult, expectedAssertionResult);
      await this.fidoFactorRepository.updateFactorCounter(actorId, factor.id, result.authnrData.get('counter'));
      await this.cache.delete(this.getAuthorizationKey(actorId));
      return { actorId, factorId: factor.id };
    } catch (ex) {
      throw unauthorizedError('Bearer error="invalid_credentials"')
        .withCause(ex as Error)
        .withInternalDetails({ assertionResult, expectedAssertionResult });
    }
  }
}

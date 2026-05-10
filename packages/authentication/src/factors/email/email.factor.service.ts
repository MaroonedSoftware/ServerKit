import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { OtpProvider } from '../../providers/otp.provider.js';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EmailFactorRepository } from './email.factor.repository.js';
import { PolicyService } from '@maroonedsoftware/policies';

type EmailPayload = {
  id: string;
  verificationMethod: 'code' | 'magiclink';
  secret?: string;
  code: string;
  expiresAt: number;
  issuedAt: number;
};

type IssuePayload = EmailPayload & {
  actorId: string;
  factorId: string;
};

type RegistrationPayload = EmailPayload & {
  value: string;
};

/**
 * Configuration options for {@link EmailFactorService}.
 */
@Injectable()
export class EmailFactorServiceOptions {
  constructor(
    /** How long an OTP code-based registration or verification challenge remains valid. */
    public readonly otpExpiration: Duration = Duration.fromDurationLike({ minutes: 10 }),
    /** How long a magic link token remains valid. */
    public readonly magiclinkExpiration: Duration = Duration.fromDurationLike({ minutes: 30 }),
    /** Length of the generated OTP code, in digits. Defaults to 6. Ignored for the `magiclink` method. */
    public readonly tokenLength: number = 6,
  ) {}
}

/**
 * Manages the lifecycle of email-based authentication factors, supporting both
 * OTP code and magic link verification flows.
 *
 * **Registration flow** (`code`):
 * 1. Call {@link registerEmailFactor} → receive a `registrationId` and a TOTP `code` to email to the user.
 * 2. Call {@link createEmailFactorFromRegistration} with the code the user submits → persists the factor.
 *
 * **Registration flow** (`magiclink`):
 * 1. Call {@link registerEmailFactor} → receive a `registrationId` and a one-time `code` token to embed in a link.
 * 2. Call {@link createEmailFactorFromRegistration} with the token from the link → persists the factor.
 *
 * **Verification flow** (signing in with an existing factor):
 * 1. Call {@link issueEmailChallenge} → receive a `verificationId` and a `code`/token to send.
 * 2. Call {@link verifyEmailChallenge} → returns the verified {@link EmailFactor} on success.
 */
@Injectable()
export class EmailFactorService {
  constructor(
    private readonly options: EmailFactorServiceOptions,
    private readonly emailFactorRepository: EmailFactorRepository,
    private readonly otpProvider: OtpProvider,
    private readonly cache: CacheProvider,
    private readonly policyService: PolicyService,
  ) {}

  private getChallengeKey(key: string) {
    return `email_factor_challenge_${key}`;
  }

  private getRegistrationKey(key: string) {
    return `email_factor_registration_${key}`;
  }

  private async lookupRegistration(registrationId: string) {
    const response = await this.cache.get(this.getRegistrationKey(registrationId));
    return response ? (JSON.parse(response) as RegistrationPayload) : undefined;
  }

  private async lookupRegistrationByValue(value: string) {
    const registrationId = await this.cache.get(this.getRegistrationKey(value));
    return registrationId ? await this.lookupRegistration(registrationId) : undefined;
  }

  private async cacheRegistration(value: string, payload: RegistrationPayload, expiration: Duration) {
    const registrationId = payload.id ?? crypto.randomBytes(32).toString('base64url');

    payload.id = registrationId;

    await this.cache.set(this.getRegistrationKey(registrationId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getRegistrationKey(value), registrationId, expiration);

    return registrationId;
  }

  private async lookupChallenge(challengeId: string) {
    const response = await this.cache.get(this.getChallengeKey(challengeId));
    return response ? (JSON.parse(response) as IssuePayload) : undefined;
  }

  private async lookupChallengeByActorAndFactor(actorId: string, factorId: string) {
    const challengeId = await this.cache.get(this.getChallengeKey(`${actorId}_${factorId}`));
    return challengeId ? await this.lookupChallenge(challengeId) : undefined;
  }

  private async cacheChallenge(payload: IssuePayload, expiration: Duration) {
    const challengeId = crypto.randomBytes(32).toString('base64url');
    payload.id = challengeId;
    await this.cache.set(this.getChallengeKey(challengeId), JSON.stringify(payload), expiration);
    await this.cache.set(this.getChallengeKey(`${payload.actorId}_${payload.factorId}`), challengeId, expiration);
    return challengeId;
  }

  private createCode(expiration: Duration) {
    const secret = this.otpProvider.createSecret();
    const issuedAt = DateTime.utc();
    const code = this.otpProvider.generate(secret, {
      type: 'totp',
      periodSeconds: expiration.as('seconds'),
      tokenLength: this.options.tokenLength,
      timestamp: issuedAt,
    });

    return {
      code,
      secret,
      expiresAt: issuedAt.plus(expiration),
      issuedAt,
      expiration,
    };
  }

  private createToken(expiration: Duration) {
    const code = crypto.randomBytes(32).toString('base64url');
    const issuedAt = DateTime.utc();

    return {
      code,
      secret: '',
      expiresAt: issuedAt.plus(expiration),
      issuedAt,
      expiration,
    };
  }

  private createPayload<T extends EmailPayload>(verificationMethod: 'code' | 'magiclink', registrationId?: string) {
    const payload = { verificationMethod, id: registrationId } as T;

    const result = verificationMethod === 'code' ? this.createCode(this.options.otpExpiration) : this.createToken(this.options.magiclinkExpiration);

    const expiresAt = result.expiresAt;
    const issuedAt = result.issuedAt;

    payload.secret = result.secret;
    payload.code = result.code;
    payload.expiresAt = expiresAt.toUnixInteger();
    payload.issuedAt = issuedAt.toUnixInteger();

    return { payload, expiresAt, issuedAt, expiration: result.expiration };
  }

  private verifyPayload(payload: EmailPayload, code: string) {
    if (payload.verificationMethod === 'code') {
      if (
        !this.otpProvider.validate(
          code,
          payload.secret ?? '',
          { type: 'totp', periodSeconds: payload.expiresAt - payload.issuedAt, tokenLength: this.options.tokenLength },
          1,
        )
      ) {
        throw httpError(400).withDetails({ code: 'invalid code' });
      }
    } else if (payload.verificationMethod === 'magiclink' && payload.code !== code) {
      throw httpError(400).withDetails({ code: 'invalid magiclink' });
    }
  }

  private async ensureEmailAllowed(value: string) {
    const policyResult = await this.policyService.check('email.allowed', { value });

    if (!policyResult.allowed) {
      const msg =
        policyResult.reason === 'deny_list'
          ? 'email is not allowed'
          : policyResult.reason === 'invalid_format'
            ? 'invalid email format'
            : policyResult.reason;
      throw httpError(400).withDetails({ value: msg }).withInternalDetails({ value: policyResult.details?.value });
    }

    const domain = value.split('@')[1]!;

    const isInviteOnly = await this.emailFactorRepository.isDomainInviteOnly(domain);
    if (isInviteOnly) {
      throw httpError(403).withDetails({ email: 'Must be invited to register' });
    }

    const existingFactor = await this.emailFactorRepository.lookupFactor(value);
    if (existingFactor) {
      throw httpError(409).withDetails({ method: 'already registered' });
    }
  }

  /**
   * Initiate email factor registration by generating a verification code or magic link token
   * and caching a short-lived registration payload.
   *
   * The caller is responsible for sending the `code` to the user (e.g. via email).
   * Complete registration by calling {@link createEmailFactorFromRegistration}.
   *
   * Idempotent: if a pending registration is already cached for this email, the
   * existing `registrationId` and `code` are returned and `alreadyRegistered` is
   * set to `true`. Use this flag to throttle "we just emailed you" UX without
   * re-sending the code, or to suppress duplicate notifications.
   *
   * Callers can also supply their own `registrationId` to make the lookup
   * deterministic — useful when the id is allocated upstream (e.g. as part of
   * a longer onboarding state machine).
   *
   * @param value              - The email address to register.
   * @param verificationMethod - `"code"` for a TOTP-style numeric code; `"magiclink"` for a random token.
   * @param registrationId     - Optional caller-supplied id. When set, the method
   *   first checks for a cached registration under this id before falling back to
   *   the email-keyed lookup; on a cache miss it is also used as the id of the
   *   freshly cached registration.
   * @returns `{ registrationId, code, expiresAt, issuedAt, alreadyRegistered }` —
   *   the registration reference, the code/token to send, when the registration
   *   expires, when it was originally issued (useful for "we sent the email N
   *   seconds ago" UX), and whether this call hit a previously-cached pending
   *   registration.
   * @throws HTTP 400 when the email format is invalid or the domain is on the deny list.
   * @throws HTTP 403 when the email's domain is invite-only (per `isDomainInviteOnly`).
   * @throws HTTP 409 when an active factor already exists for the email
   *   (only checked on a fresh registration; cache-hit paths return early).
   */
  async registerEmailFactor(value: string, verificationMethod: 'code' | 'magiclink', registrationId?: string) {
    value = value.trim().toLowerCase();

    const existingRegistration = registrationId ? await this.lookupRegistration(registrationId) : await this.lookupRegistrationByValue(value);
    if (existingRegistration) {
      return {
        registrationId: existingRegistration.id,
        code: existingRegistration.code,
        expiresAt: DateTime.fromSeconds(existingRegistration.expiresAt),
        issuedAt: DateTime.fromSeconds(existingRegistration.issuedAt),
        alreadyRegistered: true,
      };
    }

    await this.ensureEmailAllowed(value);

    const { payload, expiresAt, issuedAt, expiration } = this.createPayload<RegistrationPayload>(verificationMethod, registrationId);

    payload.value = value;

    registrationId = await this.cacheRegistration(value, payload, expiration);

    return { registrationId, code: payload.code, expiresAt, issuedAt, alreadyRegistered: false };
  }

  /**
   * Complete email factor registration by verifying the code/token and persisting the factor.
   *
   * On success the cached registration entries (under both the registration id
   * and the email value) are deleted so the code/token cannot be replayed.
   *
   * @param actorId        - The actor to attach the factor to.
   * @param registrationId - The registration reference returned by {@link registerEmailFactor}.
   * @param code           - The code or magic link token submitted by the user.
   * @returns The newly persisted {@link EmailFactor}.
   * @throws HTTP 404 when the registration has expired or does not exist.
   * @throws HTTP 400 when the code/token is invalid.
   */
  async createEmailFactorFromRegistration(actorId: string, registrationId: string, code: string) {
    const payload = await this.lookupRegistration(registrationId);

    if (!payload) {
      throw httpError(404).withDetails({ registrationId: 'not found' });
    }

    this.verifyPayload(payload, code);

    const factor = await this.emailFactorRepository.createFactor(actorId, payload.value);

    await this.cache.delete(this.getRegistrationKey(registrationId));
    await this.cache.delete(this.getRegistrationKey(payload.value));

    return factor;
  }

  /**
   * Initiate an email challenge for an existing, active factor.
   *
   * Generates a code or magic link token and caches a short-lived challenge payload.
   * The caller is responsible for sending the `code` to the `email` address returned.
   * Complete challenge by calling {@link verifyEmailChallenge}.
   *
   * Idempotent: if a pending challenge is already cached for this
   * actor+factor pair, the existing `challengeId` and `code` are returned
   * and `alreadyIssued` is set to `true`. Use this flag to suppress duplicate
   * "we just emailed you" notifications.
   *
   * @param actorId            - The actor that owns the factor.
   * @param factorId           - The id of the email factor to verify against.
   * @param issueMethod - `"code"` or `"magiclink"`.
   * @returns `{ email, challengeId, code, expiresAt, issuedAt, alreadyIssued }` —
   *   the verified email address, challenge reference, code/token to send,
   *   when the challenge expires and was originally issued (both as Luxon
   *   `DateTime`s), and whether this call hit a previously-cached pending
   *   challenge.
   * @throws HTTP 404 when the factor does not exist or is not active.
   */
  async issueEmailChallenge(actorId: string, factorId: string, issueMethod: 'code' | 'magiclink') {
    const factor = await this.emailFactorRepository.getFactor(actorId, factorId);
    if (!factor || !factor.active) {
      throw httpError(404).withDetails({ factorId: 'not found' });
    }
    const email = factor.value;

    const existingChallenge = await this.lookupChallengeByActorAndFactor(actorId, factorId);
    if (existingChallenge) {
      return {
        email,
        challengeId: existingChallenge.id,
        code: existingChallenge.code,
        expiresAt: DateTime.fromSeconds(existingChallenge.expiresAt),
        issuedAt: DateTime.fromSeconds(existingChallenge.issuedAt),
        alreadyIssued: true,
      };
    }

    const { payload, expiresAt, issuedAt, expiration } = this.createPayload<IssuePayload>(issueMethod);

    payload.actorId = actorId;
    payload.factorId = factorId;

    const challengeId = await this.cacheChallenge(payload, expiration);

    return { email, challengeId, code: payload.code, expiresAt, issuedAt, alreadyIssued: false };
  }

  /**
   * Complete an email challenge.
   *
   * On success the cached challenge entries (under both the challenge id
   * and the actor+factor pair) are deleted so the code/token cannot be replayed.
   *
   * The factor is re-loaded and re-checked for `active = true` before the code
   * is verified, so a factor deactivated between {@link issueEmailChallenge}
   * and this call cannot be used to authenticate.
   *
   * @param challengeId - The challenge reference returned by {@link issueEmailChallenge}.
   * @param code           - The code or magic link token submitted by the user.
   * @returns The verified {@link EmailFactor}.
   * @throws HTTP 404 when the challenge has expired or does not exist.
   * @throws HTTP 401 (`WWW-Authenticate: Bearer error="invalid_factor"`) when
   *   the factor has been deleted or deactivated since the challenge was issued.
   * @throws HTTP 400 when the code/token is invalid.
   */
  async verifyEmailChallenge(challengeId: string, code: string) {
    const payload = await this.lookupChallenge(challengeId);
    if (!payload) {
      throw httpError(404).withDetails({ challengeId: 'not found' });
    }

    const factor = await this.emailFactorRepository.getFactor(payload.actorId, payload.factorId);
    if (!factor || !factor.active) {
      throw unauthorizedError('Bearer error="invalid_factor"');
    }

    this.verifyPayload(payload, code);

    await this.cache.delete(this.getChallengeKey(challengeId));
    await this.cache.delete(this.getChallengeKey(`${payload.actorId}_${payload.factorId}`));

    return factor;
  }

  /**
   * Check whether a challenge is still pending (i.e. cached and not yet expired).
   *
   * Useful for UI flows that want to skip re-issuing a code when the user has merely
   * navigated away and come back to the verification screen.
   *
   * @param challengeId - The challenge reference returned by {@link issueEmailChallenge}.
   * @returns `true` if the challenge exists and has not expired, `false` otherwise.
   */
  async hasPendingChallenge(challengeId: string) {
    return (await this.lookupChallenge(challengeId)) !== undefined;
  }

  /**
   * Check whether a registration is still pending (i.e. cached and not yet expired).
   *
   * @param registrationId - The registration reference returned by {@link registerEmailFactor}.
   * @returns `true` if the registration exists and has not expired, `false` otherwise.
   */
  async hasPendingRegistration(registrationId: string) {
    return (await this.lookupRegistration(registrationId)) !== undefined;
  }

  /**
   * Build a minimal HTML page that redirects the browser to `redirectUrl` from a
   * client-side script tag, paired with a freshly generated CSP nonce.
   *
   * Intended for the magic link flow: after the server verifies the link, return
   * this HTML to the user's browser so the redirect happens after page load (which
   * sidesteps email pre-fetchers that follow `Location` headers and would otherwise
   * burn the one-time token before the human ever clicks).
   *
   * The caller is responsible for serving the returned `nonce` in a
   * `Content-Security-Policy: script-src 'nonce-<nonce>'` response header so the
   * inline script is allowed to execute.
   *
   * @param redirectUrl - The destination to navigate to. Must use the `http:` or
   *   `https:` scheme — other schemes (e.g. `javascript:`, `file:`, `data:`) are
   *   rejected to avoid script-injection / open-redirect abuse.
   * @returns `{ html, nonce }` — the HTML body to send and the base64 nonce that
   *   must be echoed in the CSP header.
   * @throws HTTP 400 when `redirectUrl` is not an `http:` or `https:` URL.
   */
  getRedirectHtml(redirectUrl: URL) {
    if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
      throw httpError(400).withInternalDetails({ redirectUrl: 'must be a valid http or https URL' });
    }
    const nonce = crypto.randomBytes(16).toString('base64');
    const html = `<!DOCTYPE html><html><head lang="en"><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /></head><body><script nonce="${nonce}" type="text/javascript">window.onload = async function() {window.location.href = "${redirectUrl}";}</script></body></html>`;
    return { html, nonce };
  }

  /**
   * Persist an email factor directly, bypassing the registration/verification flow.
   *
   * Suitable for trusted callers (e.g. invite acceptance, admin tooling) where the
   * email has already been verified out-of-band. Normalises `value` and runs the
   * `email.allowed` policy plus the invite-only domain check, but skips OTP/magic-link
   * verification.
   *
   * @throws HTTP 400 when the email fails policy validation.
   * @throws HTTP 403 when the email's domain is invite-only.
   * @throws HTTP 409 when an email factor for `value` already exists.
   */
  async createFactor(actorId: string, value: string) {
    value = value.trim().toLowerCase();

    await this.ensureEmailAllowed(value);

    return this.emailFactorRepository.createFactor(actorId, value);
  }

  /** Check whether registration is gated by an invite for the given domain. Domain is normalized (trimmed and lowercased). */
  async isDomainInviteOnly(domain: string) {
    domain = domain.trim().toLowerCase();
    return await this.emailFactorRepository.isDomainInviteOnly(domain);
  }

  /** Retrieve an email factor by id, scoped to the owning actor. */
  async getFactor(actorId: string, factorId: string) {
    return await this.emailFactorRepository.getFactor(actorId, factorId);
  }

  /** List email factors for an actor. Pass `active` to filter by activation state. */
  async listFactors(actorId: string, active?: boolean) {
    return await this.emailFactorRepository.listFactors(actorId, active);
  }

  /** Look up an email factor by email address. Value is normalized before lookup. Returns `undefined` when no match exists. */
  async lookupFactor(value: string) {
    value = value.trim().toLowerCase();
    return await this.emailFactorRepository.lookupFactor(value);
  }

  /** Permanently remove an email factor. */
  async deleteFactor(actorId: string, factorId: string) {
    return await this.emailFactorRepository.deleteFactor(actorId, factorId);
  }
}

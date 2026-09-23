import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';
import type { AuthorizationRequest } from './oauth.types.js';

/** Settings for {@link AuthorizationRequestStore}. */
@Injectable()
export class AuthorizationRequestStoreOptions {
  constructor(
    /** How long a validated request waits for the user's decision. */
    public readonly ttl: Duration = Duration.fromObject({ minutes: 10 }),
  ) {}
}

type StashedRequest = { request: AuthorizationRequest; subject: string };

/**
 * Holds a validated authorization request while the user decides, bound to the
 * user who will decide.
 *
 * The consent screen shows what the server validated and then approves or
 * denies it by id, so the user consents to exactly that request and not to
 * whatever a second submission might carry. A request is taken once.
 */
@Injectable()
export class AuthorizationRequestStore {
  constructor(
    private readonly cache: CacheProvider,
    private readonly options: AuthorizationRequestStoreOptions,
  ) {}

  /** Stash a validated request for `subject`, answering the id to decide it by. */
  async stash(request: AuthorizationRequest, subject: string): Promise<string> {
    const id = crypto.randomBytes(32).toString('base64url');
    const stashed: StashedRequest = { request, subject };
    await this.cache.set(this.key(id), JSON.stringify(stashed), this.options.ttl);
    return id;
  }

  /**
   * Take a stashed request, once.
   *
   * Answers `undefined` when the id is unknown or expired, when it was stashed
   * for another subject (which leaves it in place, so a stranger cannot cancel
   * someone's pending consent), or when a concurrent call took it first.
   */
  async take(id: string, subject: string): Promise<AuthorizationRequest | undefined> {
    const raw = await this.cache.get(this.key(id));
    if (raw === null) return undefined;

    const stashed = JSON.parse(raw) as StashedRequest;
    if (stashed.subject !== subject) return undefined;

    // The delete is the arbiter: only the caller whose delete removed the entry wins.
    const deleted = await this.cache.delete(this.key(id));
    if (deleted === null) return undefined;

    return stashed.request;
  }

  private key(id: string) {
    return `oauth_authz_${id}`;
  }
}

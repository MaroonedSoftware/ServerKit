import { Injectable } from 'injectkit';
import { Factor, FactorRepository } from '../factor.repository.js';

/** PBKDF2-derived password hash and its associated salt, both base64-encoded. */
export type PasswordValue = {
  /** The PBKDF2-derived password hash, base64-encoded. */
  hash: string;
  /** The PBKDF2-derived password salt, base64-encoded. */
  salt: string;
  needsReset?: boolean;
};

/** A persisted password authentication factor for an actor. */
export type PasswordFactor = Factor &
  PasswordValue & {
    /** The PBKDF2-derived password hash and its associated salt, both base64-encoded. */
    value: PasswordValue;
    /** When true the actor must change their password before authenticating. */
    needsReset: boolean;
  };

/** Repository interface for persisting and retrieving password factors. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PasswordFactorRepository extends FactorRepository<PasswordFactor, PasswordValue> {
  /** Returns the most recent `limit` historical password hashes for the actor, used to enforce password reuse policy. */
  listPreviousPasswords(actorId: string, limit: number): Promise<PasswordValue[]>;
  /** Replaces the actor's current password factor value. */
  updateFactor(actorId: string, value: PasswordValue): Promise<PasswordFactor>;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class PasswordFactorRepository implements PasswordFactorRepository {}

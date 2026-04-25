/** PBKDF2-derived password hash and its associated salt, both base64-encoded. */
export type PasswordValue = {
  hash: string;
  salt: string;
};

/** A persisted password authentication factor for an actor. */
export interface PasswordFactor {
  id: string;
  /** Whether this factor is currently enabled for authentication. */
  active: boolean;
  value: PasswordValue;
  /** When true the actor must change their password before authenticating. */
  needsReset: boolean;
}

/** Repository interface for persisting and retrieving password factors. */
export interface PasswordFactorRepository {
  /** Creates a new password factor for the given actor. */
  createFactor(subject: string, value: PasswordValue, needsReset: boolean): Promise<PasswordFactor>;
  /** Returns the most recent `limit` historical password hashes for the actor, used to enforce password reuse policy. */
  listPreviousPasswords(actorId: string, limit: number): Promise<PasswordValue[]>;
  /** Replaces the actor's current password factor value. */
  updateFactor(actorId: string, value: PasswordValue, needsReset: boolean): Promise<PasswordFactor>;
  /** Returns the active password factor for the actor, or null if none exists. */
  getFactor(actorId: string): Promise<PasswordFactor>;
  /** Permanently removes the actor's password factor. */
  deleteFactor(actorId: string): Promise<void>;
}

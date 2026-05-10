export interface Factor {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
}

export interface FactorRepository<TFactor extends Factor, CreateValue = string, LookupValue = string> {
  /** Persist a new factor for an actor. */
  createFactor(actorId: string, value: CreateValue): Promise<TFactor>;
  /** List factors for an actor. Pass `active` to filter by activation state. */
  listFactors(actorId: string, active?: boolean): Promise<TFactor[]>;
  /** Look up a factor scoped to one actor — "does this actor have this value?". Returns `undefined` when no match exists. */
  lookupFactor(actorId: string, value: LookupValue): Promise<TFactor | undefined>;
  /**
   * Find a factor globally by its lookup value, irrespective of owning actor —
   * "who has this value?". Only meaningful when the lookup value is globally
   * unique (e.g. email address, OIDC `sub`, FIDO credential id). Repos whose
   * lookup value isn't globally unique should leave this unimplemented.
   */
  findFactor?(value: LookupValue): Promise<TFactor | undefined>;
  /** Retrieve a factor by id, scoped to the owning actor. */
  getFactor(actorId: string, factorId: string): Promise<TFactor>;
  /** Permanently remove a factor. */
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

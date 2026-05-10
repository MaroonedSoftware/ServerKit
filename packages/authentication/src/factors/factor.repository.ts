export interface Factor {
  /** Unique identifier for this factor record. */
  id: string;
  /** The actor this factor belongs to. */
  actorId: string;
  /** Whether this factor is currently active and may be used for authentication. */
  active: boolean;
}

export interface FactorRepository<TFactor extends Factor, CreateValue = string, LookupValue = string> {
  createFactor(actorId: string, value: CreateValue): Promise<TFactor>;
  listFactors(actorId: string, active?: boolean): Promise<TFactor[]>;
  lookupFactor(actorId: string, value: LookupValue): Promise<TFactor | undefined>;
  getFactor(actorId: string, factorId: string): Promise<TFactor>;
  deleteFactor(actorId: string, factorId: string): Promise<void>;
}

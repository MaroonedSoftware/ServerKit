import { Injectable } from 'injectkit';

export type PasswordValue = {
  hash: string;
  salt: string;
};

export interface PasswordFactor {
  id: string;
  active: boolean;
  value: PasswordValue;
  needsReset: boolean;
}

@Injectable()
export abstract class PasswordFactorRepository {
  abstract createFactor(subject: string, value: PasswordValue, needsReset: boolean): Promise<PasswordFactor>;
  abstract listPreviousPasswords(actorId: string, limit: number): Promise<PasswordValue[]>;
  abstract updateFactor(actorId: string, value: PasswordValue, needsReset: boolean): Promise<PasswordFactor>;
  abstract getFactor(actorId: string): Promise<PasswordFactor>;
  abstract deleteFactor(actorId: string): Promise<void>;
}

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { Injectable } from 'injectkit';
import { PasswordHashProvider, PasswordHashResult } from './password.hash.provider.js';

/**
 * Argon2id parameters following the OWASP Password Storage Cheat Sheet (2024):
 * m=19 MiB, t=2, p=1, 32-byte output.
 *
 * Argon2id is the `@node-rs/argon2` library default, so we omit `algorithm`
 * here rather than importing the `const enum` (it cannot be re-exported under
 * `isolatedModules`).
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
export const ARGON2ID_DEFAULTS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/**
 * Argon2id {@link PasswordHashProvider}. Stores a self-describing PHC string
 * (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`) in the `hash` column and leaves
 * `salt` empty — the PHC string embeds its own salt and parameters, so the
 * separate column is unused. Verification ignores the supplied `salt` argument.
 */
@Injectable()
export class Argon2idPasswordHashProvider extends PasswordHashProvider {
  async hash(password: string): Promise<PasswordHashResult> {
    const phc = await argon2Hash(password, ARGON2ID_DEFAULTS);
    return { hash: phc, salt: '' };
  }

  async verify(password: string, hash: string, _salt: string): Promise<boolean> {
    try {
      return await argon2Verify(hash, password);
    } catch {
      return false;
    }
  }
}

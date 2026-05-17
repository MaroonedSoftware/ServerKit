import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { ARGON2ID_DEFAULTS } from '@maroonedsoftware/encryption';
import { Injectable } from 'injectkit';
import { PasswordHashProvider, PasswordHashResult } from './password.hash.provider.js';

/**
 * Re-export of the shared Argon2id parameters from `@maroonedsoftware/encryption`
 * so existing imports of `ARGON2ID_DEFAULTS` from this package keep working and
 * password hashing / key derivation can't drift apart.
 *
 * Argon2id is the `@node-rs/argon2` library default, so we omit `algorithm` here
 * rather than importing the `const enum` (which cannot be re-exported under
 * `isolatedModules`).
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
export { ARGON2ID_DEFAULTS };

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

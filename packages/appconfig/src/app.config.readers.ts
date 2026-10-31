import { AppConfig } from './app.config.js';
import { getByPath } from './helpers.js';

const ABSENT = new Set(['', 'null', 'undefined']);

/**
 * The value at `key`: the flat key if there is one, otherwise a dotted path into a group. Flat first,
 * because an environment-backed config can hold a key with a dot in it.
 */
const read = (config: AppConfig, key: string): unknown => {
  const root = config.toObject();
  return Object.hasOwn(root, key) ? root[key] : getByPath(root, key);
};

/**
 * Reads an optional value as a string, normalising "not configured" to `undefined`.
 *
 * An empty string, `null`, and the literal strings `"null"` and `"undefined"` all count as absent: a
 * key present but blank means it has not been configured, and those literals are what an unset
 * variable turns into on its way through a shell or a template. A number or boolean comes back as
 * its string form. An object is a group rather than a value, so it is absent too.
 *
 * @param config - The configuration to read.
 * @param key - A flat key, or a dotted path such as `database.host`.
 * @returns The value, or `undefined` when it is not configured.
 *
 * @example
 * ```typescript
 * const issuer = optionalConfigString(config, 'OIDC_ISSUER');
 * ```
 */
export function optionalConfigString(config: AppConfig, key: string): string | undefined {
  const value = read(config, key);
  if (value === null || typeof value === 'object') return undefined;
  const text = String(value);
  return ABSENT.has(text) ? undefined : text;
}

/**
 * Reads a required value, failing with an error that names the key when it is not configured. Call
 * it where the value is needed, so an unconfigured dependency is caught at the point of use and not
 * later as a plausible-but-wrong value.
 *
 * @param config - The configuration to read.
 * @param key - A flat key, or a dotted path.
 * @returns The value.
 * @throws {Error} If the value is not configured.
 */
export function requireConfigString(config: AppConfig, key: string): string {
  const value = optionalConfigString(config, key);
  if (value === undefined) {
    throw new Error(`Missing required configuration: ${key}`);
  }
  return value;
}

/**
 * Reads a numeric value. An absent or unparseable value falls back when a fallback is given and
 * throws when it is not, so a mistyped port without one is caught at boot and does not become `NaN`.
 *
 * @param config - The configuration to read.
 * @param key - A flat key, or a dotted path.
 * @param fallback - The value to use instead of throwing.
 * @returns The number.
 * @throws {Error} If the value is absent or unparseable and there is no fallback.
 */
export function configNumber(config: AppConfig, key: string, fallback?: number): number {
  const raw = optionalConfigString(config, key);
  const parsed = raw === undefined ? NaN : Number(raw);
  if (Number.isFinite(parsed)) return parsed;
  if (fallback !== undefined) return fallback;
  throw new Error(`Invalid configuration: ${key} must be a number (got ${raw ?? 'nothing'})`);
}

/**
 * Reads a boolean value. `true` and `1` enable it, anything else present disables it, so `KEY=false`
 * means what it says, and an absent key is `fallback`.
 *
 * @param config - The configuration to read.
 * @param key - A flat key, or a dotted path.
 * @param fallback - The value when the key is absent.
 * @returns The flag.
 */
export function configBoolean(config: AppConfig, key: string, fallback = false): boolean {
  const raw = optionalConfigString(config, key);
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

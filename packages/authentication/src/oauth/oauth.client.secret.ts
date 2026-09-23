import crypto from 'node:crypto';

/**
 * Digest a client secret for storage and comparison: SHA-256, hex.
 *
 * A generated secret is 32 random bytes, so a fast digest is enough; a
 * memory-hard hash would buy nothing and cost a denial-of-service vector on the
 * token endpoint (the reasoning `hashApiKeyToken` follows too).
 */
export const hashOAuthClientSecret = (secret: string): string => crypto.createHash('sha256').update(secret, 'utf8').digest('hex');

/**
 * Generate a secret for a pre-registered confidential client. Show `secret` to
 * the operator once and store only `secretHash` on the {@link OAuthClient}.
 */
export const createOAuthClientSecret = (): { secret: string; secretHash: string } => {
  const secret = crypto.randomBytes(32).toString('base64url');
  return { secret, secretHash: hashOAuthClientSecret(secret) };
};

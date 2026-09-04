import { timingSafeEqual } from 'node:crypto';
import { McpError } from './mcp.error.js';
import type { McpConfig } from './mcp.config.js';

/**
 * Reason codes attached to {@link McpError.internalDetails} when bearer
 * verification fails. Lets callers log structured reasons without pattern-matching
 * on error messages.
 */
export type McpAuthFailureReason = 'missing_token' | 'invalid_token';

/**
 * The authenticated subject resolved from an inbound MCP request, surfaced on
 * {@link import('./mcp.request.context.js').McpRequestContext.auth} so handlers
 * can authorize per-tool.
 *
 * The scaffold's static-token verifier only fills `token`. A real OAuth resource
 * server would populate `subject`/`scopes` from validated JWT claims — extend
 * this shape (and {@link verifyMcpBearer}) when you wire that.
 */
export interface McpAuthInfo {
  /** The raw bearer token presented on the request. */
  token: string;
  /** Subject/principal the token identifies, once resolved (unset by the scaffold). */
  subject?: string;
  /** Granted scopes, once resolved (unset by the scaffold). */
  scopes?: string[];
}

/** HTTP header carrying the bearer token, per the MCP authorization spec. */
export const MCP_AUTHORIZATION_HEADER = 'Authorization';

/**
 * Configuration the bearer verifier / {@link import('./mcp.auth.policy.js').McpAuthPolicy}
 * reads. A structural subset of {@link McpConfig}, so an `McpConfig` value
 * satisfies it directly — e.g. `requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY })`
 * with the MCP config stored under that `AppConfig` key.
 */
export type McpAuthOptions = Pick<McpConfig, 'bearerToken'>;

/**
 * Whether a configured shared token is present but blank.
 *
 * The two falsy states mean opposite things and must not be collapsed.
 * `undefined` is "no token configured", which the bundled
 * {@link import('./mcp.auth.policy.js').McpAuthPolicy} treats as an
 * intentionally open development endpoint. A blank string is "a token was
 * configured and it is empty", which is a misconfiguration — a blank
 * environment variable, usually — and must fail closed instead of silently
 * opening the endpoint the operator believed they had locked.
 *
 * Whitespace counts as blank: `MCP_BEARER_TOKEN=" "` is the same accident as
 * `MCP_BEARER_TOKEN=`.
 *
 * @param bearerToken - The configured {@link McpConfig.bearerToken}.
 * @returns `true` when a token was configured and is blank.
 */
export const isBlankBearerToken = (bearerToken: string | undefined): bearerToken is string =>
  bearerToken !== undefined && bearerToken.trim().length === 0;

/** Extracts the token from an `Authorization: Bearer <token>` header value. */
const extractBearer = (authorization: string | undefined): string | undefined => {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
};

/** Inputs to {@link verifyMcpBearer}. Taken verbatim from the request. */
export type VerifyMcpBearerInput = {
  /** Value of the `Authorization` request header (or `undefined` if absent). */
  authorization: string | undefined;
  /** The shared token to compare against ({@link McpConfig.bearerToken}). */
  expectedToken: string;
};

/**
 * Verifies an MCP request's bearer token against a configured shared token.
 *
 * **Scaffold-grade**: a constant-time comparison against a single static token.
 * This is the seam to replace with real OAuth 2.0 resource-server validation
 * (verify a JWT access token's signature, `aud`, `exp`, and scopes against your
 * authorization server) — keep the same `(request) → McpAuthInfo | throw` shape
 * so the policy and request-context wiring stay unchanged.
 *
 * Pure: no request/context coupling. The caller extracts the header and passes
 * it in.
 *
 * @returns The resolved {@link McpAuthInfo} on success.
 * @throws {@link McpError} on any failure. For an authentication failure the
 *   error's `internalDetails.reason` is one of {@link McpAuthFailureReason};
 *   map those to HTTP 401 at the route boundary. A blank `expectedToken` throws
 *   with `internalDetails.kind === 'misconfiguration'` instead, since no
 *   credential can satisfy it and the fault is the server's, not the caller's.
 */
export const verifyMcpBearer = (input: VerifyMcpBearerInput): McpAuthInfo => {
  if (isBlankBearerToken(input.expectedToken)) {
    throw new McpError('MCP bearer token is configured but blank').withInternalDetails({ kind: 'misconfiguration', field: 'bearerToken' });
  }

  const token = extractBearer(input.authorization);
  if (!token) {
    throw new McpError('MCP request missing bearer token').withInternalDetails({
      reason: 'missing_token' satisfies McpAuthFailureReason,
    });
  }

  const provided = Buffer.from(token);
  const expected = Buffer.from(input.expectedToken);
  // Length guard covers an empty/mismatched token without tripping timingSafeEqual's
  // equal-length requirement.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new McpError('MCP bearer token is invalid').withInternalDetails({
      reason: 'invalid_token' satisfies McpAuthFailureReason,
    });
  }

  return { token };
};

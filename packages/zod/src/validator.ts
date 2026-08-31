import { z, type ZodError, type ZodType } from 'zod';
import { httpError, type HttpStatusCodes } from '@maroonedsoftware/errors';

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return `Expected ${issue.expected}`;
    case 'too_big': {
      const bound = issue.inclusive === false ? `less than ${issue.maximum}` : `at most ${issue.maximum}`;
      return `Must be ${bound}`;
    }
    case 'too_small': {
      const bound = issue.inclusive === false ? `greater than ${issue.minimum}` : `at least ${issue.minimum}`;
      return `Must be ${bound}`;
    }
    case 'invalid_format':
      return `Invalid ${issue.format}`;
    case 'not_multiple_of':
      return `Must be a multiple of ${issue.divisor}`;
    case 'custom':
      return issue.message || 'Invalid value';
    default:
      // Some issue codes carry no `message`; fall back to a stable string so the
      // Record<string, string | string[]> contract is never violated with `undefined`.
      return issue.message ?? 'Invalid value';
  }
}

function addDetail(details: Record<string, string | string[]>, key: string, message: string) {
  const existing = details[key];
  if (existing === undefined) {
    details[key] = message;
  } else if (Array.isArray(existing)) {
    if (!existing.includes(message)) existing.push(message);
  } else if (existing !== message) {
    details[key] = [existing, message];
  }
}

function processIssue(issue: z.core.$ZodIssue, basePath: PropertyKey[], details: Record<string, string | string[]>) {
  const fullPath = [...basePath, ...issue.path];

  if (issue.code === 'unrecognized_keys') {
    issue.keys.forEach(k => {
      details[k] = 'Unrecognized key';
    });
    return;
  }

  if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
    issue.issues.forEach(nested => processIssue(nested, fullPath, details));
    return;
  }

  if (issue.code === 'invalid_union') {
    const key = fullPath.join('.') || '_root';
    if (issue.errors.length === 0) {
      addDetail(details, key, issue.message);
      return;
    }
    issue.errors.forEach(branchIssues => {
      branchIssues.forEach(nested => processIssue(nested, fullPath, details));
    });
    return;
  }

  const key = fullPath.join('.') || '_root';

  if (issue.code === 'invalid_value') {
    addDetail(details, key, `Expected one of '${issue.values.join(', ')}'`);
    return;
  }

  addDetail(details, key, describeIssue(issue));
}

function formatZodErrors(error: ZodError) {
  const details: Record<string, string | string[]> = {};

  for (const issue of error.issues) {
    processIssue(issue, [], details);
  }

  return details;
}

/**
 * Parses and validates `data` against a Zod schema, returning the typed result on success.
 *
 * On failure, throws an `HttpError` — `400` by default, or `statusCode` when supplied — carrying a
 * map of field paths to human-readable error messages. Field paths use dot notation
 * (e.g. `"user.email"`). Root-level errors are keyed as `"_root"`. When a field has multiple
 * violations the value is a string array.
 *
 * Where that map lands depends on the status: a 4xx puts it on `details`, which `errorMiddleware`
 * renders into the response body, while a 5xx puts it on `internalDetails`, which is logged but
 * never sent to a client. A server-side failure should not tell the caller which of its own fields
 * the server disagreed with, so a 5xx response body carries no `details` at all.
 *
 * Special cases:
 * - Unrecognized keys (from `z.strictObject`) are each reported as `"Unrecognized key"`.
 * - Enum violations produce a message listing the allowed values.
 *
 * @param data - The unknown input to validate.
 * @param schema - The Zod schema to validate against.
 * @param statusCode - Status for the thrown `HttpError`. Defaults to `400`; pass e.g. `422` when
 * the payload is syntactically fine but semantically rejected. A value `>= 500` also diverts the
 * field map from `details` to `internalDetails`.
 * @returns The parsed and transformed output inferred from the schema.
 * @throws {HttpError} `statusCode` (default `400`), with the field map on `details` below `500`
 * and on `internalDetails` at `500` and above.
 *
 * @example
 * ```typescript
 * const body = await parseAndValidate(ctx.request.body, z.object({
 *   email: z.string().email(),
 *   age: z.number().min(0),
 * }));
 * // body is typed as { email: string; age: number }
 * ```
 */
export const parseAndValidate = async <T extends ZodType>(data: unknown, schema: T, statusCode: HttpStatusCodes = 400): Promise<z.infer<T>> => {
  const parsed = await schema.safeParseAsync(data);

  if (!parsed.success) {
    const details = formatZodErrors(parsed.error);
    if (statusCode >= 500) {
      throw httpError(statusCode).withInternalDetails(details);
    } else {
      throw httpError(statusCode).withDetails(details);
    }
  }

  return parsed.data;
};

/**
 * Parses and validates every element of `data` against a Zod schema, returning the typed array
 * on success. `schema` describes a single *element*, not the array.
 *
 * Behaves like {@link parseAndValidate} on an array schema: `data` that is not an array fails with
 * a `"_root"` detail rather than throwing, and a failing element reports every violation across
 * every element in one error. Detail keys are prefixed with the element index, so a bad `email`
 * on the third entry is keyed `"2.email"`.
 *
 * @param data - The unknown input to validate. Must be an array to pass.
 * @param schema - The Zod schema each element is validated against.
 * @param statusCode - Status for the thrown `HttpError`. Defaults to `400`. Applies to a
 * non-array input as well as to element-level failures, and a value `>= 500` diverts the field map
 * to `internalDetails` exactly as in {@link parseAndValidate}.
 * @returns The parsed and transformed elements, in input order.
 * @throws {HttpError} `statusCode` (default `400`), with the index-prefixed field map on `details`
 * below `500` and on `internalDetails` at `500` and above.
 *
 * @example
 * ```typescript
 * const users = await parseAndValidateArray(ctx.request.body, z.object({
 *   email: z.string().email(),
 *   age: z.number().min(0),
 * }));
 * // users is typed as { email: string; age: number }[]
 * // a bad second entry throws 400 with details { '1.email': 'Invalid email' }
 * ```
 */
export const parseAndValidateArray = async <T extends ZodType>(data: unknown, schema: T, statusCode: HttpStatusCodes = 400): Promise<z.infer<T>[]> =>
  parseAndValidate(data, z.array(schema), statusCode);

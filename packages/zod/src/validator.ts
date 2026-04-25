import { z, type ZodError, type ZodIssue, type ZodType } from 'zod';
import { httpError } from '@maroonedsoftware/errors';

function describeIssue(issue: ZodIssue): string {
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
      return issue.message;
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

function processIssue(issue: ZodIssue, basePath: PropertyKey[], details: Record<string, string | string[]>) {
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
      addDetail(details, key, 'Matched multiple variants ambiguously');
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
 * On failure, throws an `HttpError` with status `400` whose `details` map field paths to
 * human-readable error messages. Field paths use dot notation (e.g. `"user.email"`). Root-level
 * errors are keyed as `"_root"`. When a field has multiple violations the value is a string array.
 *
 * Special cases:
 * - Unrecognized keys (from `z.strictObject`) are each reported as `"Unrecognized key"`.
 * - Enum violations produce a message listing the allowed values.
 *
 * @param data - The unknown input to validate.
 * @param schema - The Zod schema to validate against.
 * @returns The parsed and transformed output inferred from the schema.
 * @throws {HttpError} 400 with field-level `details` when validation fails.
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
export const parseAndValidate = async <T extends ZodType>(data: unknown, schema: T): Promise<z.infer<T>> => {
  const parsed = await schema.safeParseAsync(data);

  if (!parsed.success) {
    throw httpError(400).withDetails(formatZodErrors(parsed.error));
  }

  return parsed.data;
};

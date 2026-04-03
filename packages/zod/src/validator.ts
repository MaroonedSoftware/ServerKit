import { z, type ZodError, type ZodType } from 'zod';
import { httpError } from '@maroonedsoftware/errors';

function formatZodErrors(error: ZodError) {
    const details: Record<string, string | string[]> = {};

    for (const issue of error.issues) {
        const path = issue.path.join('.');
        const key = path || '_root';

        if (issue.code === 'unrecognized_keys') {
            issue.keys.forEach(key => {
                details[key] = 'Unrecognized key';
            });
            continue;
        } else if (issue.code === 'invalid_value') {
            details[key] = `Expected one of '${issue.values.join(', ')}'`;
            continue;
        }

        if (!details[key]) {
            details[key] = issue.message;
        } else {
            details[key] = [details[key] as string, issue.message];
        }
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

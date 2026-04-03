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

export const parseAndValidate = async <T extends ZodType>(data: unknown, schema: T): Promise<z.infer<T>> => {
    const parsed = await schema.safeParseAsync(data);

    if (!parsed.success) {
        throw httpError(400).withDetails(formatZodErrors(parsed.error));
    }

    return parsed.data;
};

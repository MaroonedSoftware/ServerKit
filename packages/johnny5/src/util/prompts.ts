import * as clack from '@clack/prompts';

/** Re-export of the `@clack/prompts` namespace under a stable name. */
export const prompts = clack;

/** Thrown by `unwrap` when the user cancels a clack prompt (e.g. Ctrl+C). */
export class PromptCancelledError extends Error {
    constructor() {
        super('prompt cancelled');
        this.name = 'PromptCancelledError';
    }
}

/**
 * Unwrap a clack prompt result, throwing `PromptCancelledError` when the user
 * cancelled. Lets command handlers use try/catch instead of branching on
 * `isCancel` at every prompt.
 */
export const unwrap = <T>(value: T | symbol): T => {
    if (clack.isCancel(value)) throw new PromptCancelledError();
    return value as T;
};

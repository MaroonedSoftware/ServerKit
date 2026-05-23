import type { CliContext } from '../types.js';
import { PromptCancelledError, prompts, unwrap } from './prompts.js';

/** Options controlling a `wizard` session's framing and exit behavior. */
export interface WizardOptions {
    /** Title shown via `clack.intro` at the start of the session. */
    title: string;
    /** Outro printed when the body resolves successfully. Defaults to `'done'`. */
    successOutro?: string;
    /** Outro printed when the user cancels a prompt or `w.cancel()` is called. Defaults to `'aborted'`. */
    cancelOutro?: string;
    /** Exit code returned on cancel. Defaults to `1`. */
    cancelExitCode?: number;
}

/**
 * Session passed to the body of a `wizard` call. Prompt methods internally
 * `unwrap` cancellation, so the body can be written linearly without
 * `isCancel` checks at every step.
 */
export interface WizardSession {
    readonly ctx: CliContext;
    confirm: (options: Parameters<typeof prompts.confirm>[0]) => Promise<boolean>;
    text: (options: Parameters<typeof prompts.text>[0]) => Promise<string>;
    password: (options: Parameters<typeof prompts.password>[0]) => Promise<string>;
    select: <T>(options: Parameters<typeof prompts.select<T>>[0]) => Promise<T>;
    multiselect: <T>(options: Parameters<typeof prompts.multiselect<T>>[0]) => Promise<T[]>;
    /** Pass-through to `clack.log.*` (success/info/warn/error/step/message). */
    log: typeof prompts.log;
    /** Pass-through to `clack.spinner()` for long-running steps inside the session. */
    spinner: typeof prompts.spinner;
    /** Override the outro printed on success; takes effect when the body resolves. */
    outro: (message: string) => void;
    /** Cancel the wizard from inside the body. Throws `PromptCancelledError`. */
    cancel: () => never;
}

/**
 * Run a guided multi-step flow with uniform intro/outro framing and cancel
 * handling. The `body` receives a `WizardSession` whose prompt methods throw
 * `PromptCancelledError` on cancellation; `wizard` catches that and prints
 * the cancel outro, returning the configured exit code.
 *
 * The body's resolved value (or `0` when it returns `void`) is returned as
 * the exit code on success. Any other thrown error propagates unchanged.
 */
export const wizard = async (
    ctx: CliContext,
    options: WizardOptions,
    body: (w: WizardSession) => Promise<number | void>,
): Promise<number> => {
    const successOutro = options.successOutro ?? 'done';
    const cancelOutro = options.cancelOutro ?? 'aborted';
    const cancelExitCode = options.cancelExitCode ?? 1;

    let dynamicOutro: string | undefined;

    const session: WizardSession = {
        ctx,
        confirm: async opts => unwrap(await prompts.confirm(opts)),
        text: async opts => unwrap(await prompts.text(opts)),
        password: async opts => unwrap(await prompts.password(opts)),
        select: async opts => unwrap(await prompts.select(opts)),
        multiselect: async opts => unwrap(await prompts.multiselect(opts)),
        log: prompts.log,
        spinner: prompts.spinner,
        outro: message => {
            dynamicOutro = message;
        },
        cancel: () => {
            throw new PromptCancelledError();
        },
    };

    prompts.intro(options.title);

    try {
        const result = await body(session);
        prompts.outro(dynamicOutro ?? successOutro);
        return typeof result === 'number' ? result : 0;
    } catch (err) {
        if (err instanceof PromptCancelledError) {
            prompts.outro(cancelOutro);
            return cancelExitCode;
        }
        throw err;
    }
};

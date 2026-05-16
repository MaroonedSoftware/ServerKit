/** Minimal logger interface that every command and check receives via `CliContext`. */
export interface CliLogger {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
    success: (msg: string) => void;
}

const colour = (code: number, text: string): string => `\x1b[${code}m${text}\x1b[0m`;

/** Options accepted by `createDefaultLogger`. */
export interface CreateLoggerOptions {
    /** When true, `debug` writes to stdout; otherwise it's a no-op. */
    verbose?: boolean;
}

/**
 * Build the default ANSI-coloured console logger used when a consumer doesn't
 * supply their own. `debug` output is gated on `verbose`.
 */
export const createDefaultLogger = (options: CreateLoggerOptions = {}): CliLogger => ({
    info: msg => console.log(msg),
    warn: msg => console.warn(colour(33, `! ${msg}`)),
    error: msg => console.error(colour(31, `✗ ${msg}`)),
    success: msg => console.log(colour(32, `✓ ${msg}`)),
    debug: msg => {
        if (options.verbose) console.log(colour(90, `· ${msg}`));
    },
});

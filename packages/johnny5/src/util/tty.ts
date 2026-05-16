/**
 * Best-effort guess at whether the CLI is talking to a human. Returns false in
 * CI (`CI=true` / `CI=1`), when `JOHNNY5_NON_INTERACTIVE=1`, or when either of
 * stdout/stdin isn't a TTY.
 */
export const isInteractive = (): boolean => {
    if (process.env['CI'] === 'true' || process.env['CI'] === '1') return false;
    if (process.env['JOHNNY5_NON_INTERACTIVE'] === '1') return false;
    return Boolean(process.stdout.isTTY && process.stdin.isTTY);
};

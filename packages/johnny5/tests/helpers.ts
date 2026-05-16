import { vi } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { CliContext, CliLogger, Shell } from '../src/index.js';

export interface MockLogger extends CliLogger {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
}

export const createMockLogger = (): MockLogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
});

export interface ContextOverrides {
    cwd?: string;
    repoRoot?: string;
    logger?: CliLogger;
    shell?: Partial<Shell>;
    config?: AppConfig;
    isInteractive?: () => boolean;
    env?: NodeJS.ProcessEnv;
}

export const createMockShell = (overrides: Partial<Shell> = {}): Shell => ({
    run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }) as never),
    runStreaming: vi.fn(async () => 0),
    ...overrides,
});

export const createMockContext = (overrides: ContextOverrides = {}): CliContext => ({
    paths: { cwd: overrides.cwd ?? '/tmp', repoRoot: overrides.repoRoot ?? '/tmp' },
    logger: overrides.logger ?? createMockLogger(),
    shell: createMockShell(overrides.shell ?? {}),
    config: overrides.config ?? new AppConfig({}),
    isInteractive: overrides.isInteractive ?? (() => false),
    env: overrides.env ?? {},
});

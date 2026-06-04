import { vi } from 'vitest';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { CliContext, CliLogger, Daemons, DaemonStatus, Shell } from '../src/index.js';

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
    daemons?: Partial<Daemons>;
    config?: AppConfig;
    isInteractive?: () => boolean;
    env?: NodeJS.ProcessEnv;
}

export const createMockShell = (overrides: Partial<Shell> = {}): Shell => ({
    run: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }) as never),
    runStreaming: vi.fn(async () => 0),
    runDetached: vi.fn(() => ({ pid: 1234 })),
    ...overrides,
});

const noStatus: DaemonStatus = {
    name: '',
    pid: 0,
    running: false,
    logFile: '',
    pidFile: '',
    command: '',
    args: [],
    cwd: '/tmp',
    startedAt: DateTime.fromMillis(0),
};

export const createMockDaemons = (overrides: Partial<Daemons> = {}): Daemons => ({
    start: vi.fn(() => noStatus),
    stop: vi.fn(() => false),
    status: vi.fn(() => undefined),
    list: vi.fn(() => []),
    logFile: vi.fn((name: string) => `/tmp/${name}.log`),
    pidFile: vi.fn((name: string) => `/tmp/${name}.pid`),
    ...overrides,
});

export const createMockContext = (overrides: ContextOverrides = {}): CliContext => ({
    paths: { cwd: overrides.cwd ?? '/tmp', repoRoot: overrides.repoRoot ?? '/tmp' },
    logger: overrides.logger ?? createMockLogger(),
    shell: createMockShell(overrides.shell ?? {}),
    daemons: createMockDaemons(overrides.daemons ?? {}),
    config: overrides.config ?? new AppConfig({}),
    isInteractive: overrides.isInteractive ?? (() => false),
    env: overrides.env ?? {},
});

import { vi, type Mock } from 'vitest';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { CliContext, CliLogger, Daemons, DaemonStatus, Shell } from '../src/index.js';

/**
 * `CliLogger` with every method replaced by a mock that keeps the real
 * signature, so it stays assignable to `CliLogger` while exposing `.mock`.
 */
export type MockLogger = { [K in keyof CliLogger]: Mock<CliLogger[K]> };

export const createMockLogger = (): MockLogger => ({
  info: vi.fn<CliLogger['info']>(),
  warn: vi.fn<CliLogger['warn']>(),
  error: vi.fn<CliLogger['error']>(),
  debug: vi.fn<CliLogger['debug']>(),
  success: vi.fn<CliLogger['success']>(),
});

/**
 * Types a stubbed `Shell.run` so a test can return just the fields it asserts
 * on instead of restating execa's full result shape.
 *
 * @param impl - Returns the subset of the execa result the test needs.
 * @returns A mock assignable to `Shell['run']` that still exposes `.mock`.
 */
export const mockShellRun = (impl: (command: string, args: string[]) => Promise<unknown>): Mock<Shell['run']> =>
  vi.fn(impl) as unknown as Mock<Shell['run']>;

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
  run: mockShellRun(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  runStreaming: vi.fn<Shell['runStreaming']>(async () => 0),
  runDetached: vi.fn<Shell['runDetached']>(() => ({ pid: 1234 })),
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

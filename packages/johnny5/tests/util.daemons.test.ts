import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDaemons } from '../src/util/daemons.js';
import { projectSlug, type JohnnyPaths } from '../src/util/paths.js';
import { createMockLogger, createMockShell } from './helpers.js';

const slugFor = (root: string) => projectSlug(root);

describe('createDaemons', () => {
    let projectRoot: string;
    let stateRoot: string;
    let paths: JohnnyPaths;

    beforeEach(() => {
        projectRoot = mkdtempSync(resolve(tmpdir(), 'johnny5-daemons-'));
        stateRoot = mkdtempSync(resolve(tmpdir(), 'johnny5-state-'));
        paths = {
            log: resolve(stateRoot, 'log'),
            runtime: resolve(stateRoot, 'runtime'),
            cache: resolve(stateRoot, 'cache'),
        };
    });

    afterEach(() => {
        rmSync(stateRoot, { recursive: true, force: true });
        rmSync(projectRoot, { recursive: true, force: true });
    });

    const slugRuntimeDir = (): string => resolve(paths.runtime, slugFor(projectRoot));

    it('start writes a pid file and returns a running status', () => {
        const shell = createMockShell({ runDetached: vi.fn(() => ({ pid: 42, logFile: '/tmp/x.log' })) });
        const daemons = createDaemons(projectRoot, shell, createMockLogger(), paths);

        const status = daemons.start({ name: 'storybook', command: 'node', args: ['-e', 'process.exit(0)'] });

        expect(status.pid).toBe(42);
        expect(status.name).toBe('storybook');
        expect(existsSync(status.pidFile)).toBe(true);
        const record = JSON.parse(readFileSync(status.pidFile, 'utf-8'));
        expect(record.pid).toBe(42);
        expect(record.command).toBe('node');
        expect(record.args).toEqual(['-e', 'process.exit(0)']);
    });

    it('start is idempotent when the existing daemon is alive (reuse)', () => {
        const runDetached = vi.fn(() => ({ pid: process.pid }));
        const shell = createMockShell({ runDetached });
        const daemons = createDaemons(projectRoot, shell, createMockLogger(), paths);

        const first = daemons.start({ name: 'foo', command: 'node', args: [] });
        const second = daemons.start({ name: 'foo', command: 'node', args: [] });

        expect(first.pid).toBe(process.pid);
        expect(second.pid).toBe(process.pid);
        expect(runDetached).toHaveBeenCalledTimes(1);
    });

    it('start throws when onExisting=error and the daemon is alive', () => {
        const shell = createMockShell({ runDetached: vi.fn(() => ({ pid: process.pid })) });
        const daemons = createDaemons(projectRoot, shell, createMockLogger(), paths);
        daemons.start({ name: 'foo', command: 'node', args: [] });
        expect(() => daemons.start({ name: 'foo', command: 'node', args: [], onExisting: 'error' })).toThrow(/already running/);
    });

    it('start clears a stale pid file and respawns', () => {
        const daemons = createDaemons(projectRoot, createMockShell(), createMockLogger(), paths);
        // Plant a pid file pointing at a definitely-dead pid.
        const pidPath = daemons.pidFile('ghost');
        mkdirSync(slugRuntimeDir(), { recursive: true });
        writeFileSync(pidPath, JSON.stringify({ pid: 999999999, command: 'x', args: [], cwd: '/', startedAt: new Date().toISOString() }), {
            flag: 'w',
        });
        // mkdir is handled by start(); ensure pre-existing dir is fine.
        const runDetached = vi.fn(() => ({ pid: 7 }));
        const shellWithSpawn = createMockShell({ runDetached });
        const daemons2 = createDaemons(projectRoot, shellWithSpawn, createMockLogger(), paths);
        const status = daemons2.start({ name: 'ghost', command: 'node', args: [] });
        expect(status.pid).toBe(7);
        expect(runDetached).toHaveBeenCalledTimes(1);
    });

    it('status returns undefined when no pid file exists', () => {
        const daemons = createDaemons(projectRoot, createMockShell(), createMockLogger(), paths);
        expect(daemons.status('missing')).toBeUndefined();
    });

    it('list returns every recorded daemon', () => {
        const shell = createMockShell({ runDetached: vi.fn(() => ({ pid: process.pid })) });
        const daemons = createDaemons(projectRoot, shell, createMockLogger(), paths);
        daemons.start({ name: 'a', command: 'node', args: [] });
        daemons.start({ name: 'b', command: 'node', args: [] });
        const names = daemons.list().map(d => d.name).sort();
        expect(names).toEqual(['a', 'b']);
    });

    it('stop removes the pid file and returns false when the process was already dead', () => {
        const daemons = createDaemons(projectRoot, createMockShell(), createMockLogger(), paths);
        mkdirSync(slugRuntimeDir(), { recursive: true });
        writeFileSync(daemons.pidFile('dead'), JSON.stringify({ pid: 999999999, command: 'x', args: [], cwd: '/', startedAt: new Date().toISOString() }));
        const stopped = daemons.stop('dead');
        expect(stopped).toBe(false);
        expect(existsSync(daemons.pidFile('dead'))).toBe(false);
    });

    it('stop returns false when no pid file exists', () => {
        const daemons = createDaemons(projectRoot, createMockShell(), createMockLogger(), paths);
        expect(daemons.stop('nothing')).toBe(false);
    });

    it('rejects daemon names with disallowed characters', () => {
        const daemons = createDaemons(projectRoot, createMockShell(), createMockLogger(), paths);
        expect(() => daemons.pidFile('bad name')).toThrow(/Invalid daemon name/);
        expect(() => daemons.logFile('bad/name')).toThrow(/Invalid daemon name/);
    });

    it('scopes paths to the project slug', () => {
        const daemons = createDaemons(projectRoot, createMockShell(), createMockLogger(), paths);
        const slug = slugFor(projectRoot);
        expect(daemons.pidFile('x')).toContain(slug);
        expect(daemons.logFile('x')).toContain(slug);
    });
});

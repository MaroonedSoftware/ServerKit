import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dockerServicesUp } from '../src/integrations/docker/index.js';
import { createMockContext } from './helpers.js';

describe('dockerServicesUp', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'johnny5-docker-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('skips when the compose file is missing and skipIfMissing is true (default)', async () => {
        const ctx = createMockContext({ repoRoot: dir });
        const result = await dockerServicesUp().run(ctx);
        expect(result.ok).toBe(true);
        expect(result.message).toContain('skipping');
    });

    it('fails when compose file is missing and skipIfMissing is false', async () => {
        const ctx = createMockContext({ repoRoot: dir });
        const result = await dockerServicesUp({ skipIfMissing: false }).run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('is missing');
    });

    it('parses NDJSON output and reports all services running', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const run = vi.fn(async () => ({ stdout: '{"Service":"db","State":"running"}\n{"Service":"redis","State":"running"}\n' }) as never);
        const ctx = createMockContext({ repoRoot: dir, shell: { run } });
        const result = await dockerServicesUp().run(ctx);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('2 service(s) running');
    });

    it('parses JSON array output', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const run = vi.fn(async () => ({ stdout: '[{"Service":"db","State":"running"}]' }) as never);
        const ctx = createMockContext({ repoRoot: dir, shell: { run } });
        const result = await dockerServicesUp().run(ctx);
        expect(result.ok).toBe(true);
    });

    it('flags services that are not in the running state', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const run = vi.fn(async () =>
            ({ stdout: '{"Service":"db","State":"running"}\n{"Service":"web","State":"exited"}\n' }) as never,
        );
        const ctx = createMockContext({ repoRoot: dir, shell: { run } });
        const result = await dockerServicesUp().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('not running: web');
    });

    it('fails with a fixHint when no services are running', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const run = vi.fn(async () => ({ stdout: '' }) as never);
        const ctx = createMockContext({ repoRoot: dir, shell: { run } });
        const result = await dockerServicesUp().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('no compose services running');
    });

    it('reports a shell failure with the error message', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const run = vi.fn(async () => {
            throw new Error('docker not found');
        });
        const ctx = createMockContext({ repoRoot: dir, shell: { run: run as never } });
        const result = await dockerServicesUp().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('docker not found');
        expect(result.fixHint).toContain('Ensure Docker is installed');
    });

    it('only attaches autoFix when autoStart is enabled', () => {
        expect(dockerServicesUp().autoFix).toBeUndefined();
        expect(dockerServicesUp({ autoStart: true }).autoFix).toBeTypeOf('function');
    });

    it('autoFix runs `docker compose up -d` and reports the exit code', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const runStreaming = vi.fn(async () => 0);
        const ctx = createMockContext({ repoRoot: dir, shell: { runStreaming } });
        const check = dockerServicesUp({ autoStart: true });
        const result = await check.autoFix!(ctx);
        expect(runStreaming).toHaveBeenCalledWith('docker', ['compose', 'up', '-d'], { cwd: dir });
        expect(result.ok).toBe(true);
    });

    it('autoFix reports failure when compose up exits non-zero', async () => {
        await writeFile(path.join(dir, 'docker-compose.yml'), 'services:\n');
        const runStreaming = vi.fn(async () => 2);
        const ctx = createMockContext({ repoRoot: dir, shell: { runStreaming } });
        const check = dockerServicesUp({ autoStart: true });
        const result = await check.autoFix!(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('exited 2');
    });

    it('honours an absolute composeFile path', async () => {
        const absolute = path.join(dir, 'custom.yml');
        await writeFile(absolute, 'services:\n');
        const run = vi.fn(async () => ({ stdout: '[]' }) as never);
        const ctx = createMockContext({ repoRoot: '/nope', shell: { run } });
        const result = await dockerServicesUp({ composeFile: absolute }).run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('no compose services running');
    });
});

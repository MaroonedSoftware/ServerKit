import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envFile, portsFree } from '../src/integrations/filesystem/index.js';
import { createMockContext } from './helpers.js';

describe('envFile', () => {
    let dir: string;
    const originalEnv = { ...process.env };

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'johnny5-envfile-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
        for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    });

    it('passes when the file exists and no required vars are listed', async () => {
        await writeFile(path.join(dir, '.env'), 'X=1');
        const result = await envFile({ path: '.env' }).run(createMockContext({ repoRoot: dir }));
        expect(result.ok).toBe(true);
    });

    it('fails when the file is missing', async () => {
        const result = await envFile({ path: '.env' }).run(createMockContext({ repoRoot: dir }));
        expect(result.ok).toBe(false);
        expect(result.message).toContain('is missing');
        expect(result.fixHint).toContain('Create .env');
    });

    it('fails when required vars are not set after loading', async () => {
        await writeFile(path.join(dir, '.env'), 'PRESENT=1');
        process.env['PRESENT'] = '1';
        const result = await envFile({ path: '.env', required: ['PRESENT', 'MISSING_VAR'] }).run(createMockContext({ repoRoot: dir }));
        expect(result.ok).toBe(false);
        expect(result.message).toContain('missing: MISSING_VAR');
    });

    it('passes when all required vars are set', async () => {
        await writeFile(path.join(dir, '.env'), 'A=1');
        process.env['A'] = '1';
        const result = await envFile({ path: '.env', required: ['A'] }).run(createMockContext({ repoRoot: dir }));
        expect(result.ok).toBe(true);
        expect(result.message).toBe('present');
    });

    it('treats absolute paths as-is rather than resolving against repoRoot', async () => {
        const absolute = path.join(dir, 'custom.env');
        await writeFile(absolute, 'A=1');
        const result = await envFile({ path: absolute }).run(createMockContext({ repoRoot: '/nonexistent' }));
        expect(result.ok).toBe(true);
    });
});

const findFreePort = async (): Promise<number> =>
    new Promise(resolve => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            server.close(() => resolve(port));
        });
    });

const occupyPort = (port: number): Promise<net.Server> =>
    new Promise(resolve => {
        const server = net.createServer();
        server.listen(port, '127.0.0.1', () => resolve(server));
    });

describe('portsFree', () => {
    it('passes when none of the listed ports are in use', async () => {
        const free = await findFreePort();
        const result = await portsFree({ ports: [free] }).run(createMockContext());
        expect(result.ok).toBe(true);
    });

    it('fails and labels occupied ports', async () => {
        const port = await findFreePort();
        const server = await occupyPort(port);
        try {
            const result = await portsFree({ ports: [{ port, label: 'api' }] }).run(createMockContext());
            expect(result.ok).toBe(false);
            expect(result.message).toContain(`api:${port}`);
            expect(result.fixHint).toContain(`lsof -i :${port}`);
        } finally {
            await new Promise(resolve => server.close(() => resolve(undefined)));
        }
    });

    it('falls back to using the port number as the label when none is supplied', async () => {
        const port = await findFreePort();
        const server = await occupyPort(port);
        try {
            const result = await portsFree({ ports: [port] }).run(createMockContext());
            expect(result.ok).toBe(false);
            expect(result.message).toContain(`${port}:${port}`);
        } finally {
            await new Promise(resolve => server.close(() => resolve(undefined)));
        }
    });
});

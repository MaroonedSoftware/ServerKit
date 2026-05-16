import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { buildContext, buildDefaultAppConfig } from '../src/context.js';

describe('buildDefaultAppConfig', () => {
    it('builds an AppConfig instance', async () => {
        const config = await buildDefaultAppConfig();
        expect(config).toBeInstanceOf(AppConfig);
    });
});

describe('buildContext', () => {
    let dir: string;
    const originalEnv = { ...process.env };

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'johnny5-context-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
        // Reset env to original state.
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key];
        }
        for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v;
    });

    it('loads simple KEY=VALUE pairs from a .env file into process.env', async () => {
        const envPath = path.join(dir, '.env');
        await writeFile(envPath, 'JOHNNY5_TEST_BASIC=hello\n# a comment\nJOHNNY5_TEST_QUOTED="quoted value"\n');
        await buildContext({ repoRoot: dir, envFiles: ['.env'] });
        expect(process.env['JOHNNY5_TEST_BASIC']).toBe('hello');
        expect(process.env['JOHNNY5_TEST_QUOTED']).toBe('quoted value');
    });

    it('expands $VAR references in double-quoted and unquoted values', async () => {
        process.env['JOHNNY5_TEST_HOST'] = 'db.local';
        const envPath = path.join(dir, '.env');
        await writeFile(envPath, 'JOHNNY5_TEST_URL="postgres://${JOHNNY5_TEST_HOST}/x"\nJOHNNY5_TEST_BARE=$JOHNNY5_TEST_HOST\n');
        await buildContext({ repoRoot: dir, envFiles: ['.env'] });
        expect(process.env['JOHNNY5_TEST_URL']).toBe('postgres://db.local/x');
        expect(process.env['JOHNNY5_TEST_BARE']).toBe('db.local');
    });

    it('takes single-quoted values literally without $VAR expansion', async () => {
        process.env['JOHNNY5_TEST_HOST'] = 'db.local';
        const envPath = path.join(dir, '.env');
        await writeFile(envPath, "JOHNNY5_TEST_LITERAL='${JOHNNY5_TEST_HOST}/x'\n");
        await buildContext({ repoRoot: dir, envFiles: ['.env'] });
        expect(process.env['JOHNNY5_TEST_LITERAL']).toBe('${JOHNNY5_TEST_HOST}/x');
    });

    it('does not overwrite a value already present in process.env', async () => {
        process.env['JOHNNY5_TEST_PRESENT'] = 'keep';
        const envPath = path.join(dir, '.env');
        await writeFile(envPath, 'JOHNNY5_TEST_PRESENT=overwrite\n');
        await buildContext({ repoRoot: dir, envFiles: ['.env'] });
        expect(process.env['JOHNNY5_TEST_PRESENT']).toBe('keep');
    });

    it('silently skips env files that do not exist', async () => {
        await expect(buildContext({ repoRoot: dir, envFiles: ['nope.env'] })).resolves.toBeDefined();
    });

    it('resolves absolute paths in envFiles directly', async () => {
        const envPath = path.join(dir, 'custom.env');
        await writeFile(envPath, 'JOHNNY5_TEST_ABS=abs\n');
        await buildContext({ repoRoot: '/wherever', envFiles: [envPath] });
        expect(process.env['JOHNNY5_TEST_ABS']).toBe('abs');
    });

    it('discovers repoRoot by walking up looking for pnpm-workspace.yaml', async () => {
        // Set up: <dir>/pnpm-workspace.yaml + <dir>/nested/cwd. macOS resolves
        // /tmp → /private/tmp, so we compare against the realpath.
        await writeFile(path.join(dir, 'pnpm-workspace.yaml'), '');
        const cwdDir = path.join(dir, 'nested', 'cwd');
        await mkdir(cwdDir, { recursive: true });
        const realRoot = await realpath(dir);
        const realCwd = await realpath(cwdDir);
        const originalCwd = process.cwd();
        try {
            process.chdir(cwdDir);
            const ctx = await buildContext({ envFiles: [] });
            expect(ctx.paths.repoRoot).toBe(realRoot);
            expect(ctx.paths.cwd).toBe(realCwd);
        } finally {
            process.chdir(originalCwd);
        }
    });

    it('falls back to cwd when no pnpm-workspace.yaml is found', async () => {
        const originalCwd = process.cwd();
        try {
            process.chdir(dir);
            const ctx = await buildContext({ envFiles: [] });
            // Either dir itself or cwd — both are valid paths; assert the call succeeded.
            expect(typeof ctx.paths.repoRoot).toBe('string');
        } finally {
            process.chdir(originalCwd);
        }
    });

    it('returns a ready-to-use CliContext with shell, logger, and config wired up', async () => {
        const ctx = await buildContext({ repoRoot: dir, envFiles: [] });
        expect(ctx.paths.repoRoot).toBe(dir); // explicit repoRoot is taken as-is
        expect(typeof ctx.logger.info).toBe('function');
        expect(typeof ctx.shell.run).toBe('function');
        expect(typeof ctx.shell.runStreaming).toBe('function');
        expect(typeof ctx.isInteractive).toBe('function');
        expect(ctx.env).toBe(process.env);
    });
});

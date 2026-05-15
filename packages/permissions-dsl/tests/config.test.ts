import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findConfig, loadConfig } from '../src/config.js';

let workDir: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'pdsl-cfg-'));
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

describe('config', () => {
    it('loads a valid config and resolves relative paths against the config dir', async () => {
        const cfgPath = join(workDir, 'permissions.config.json');
        await writeFile(
            cfgPath,
            JSON.stringify({
                patterns: ['perms/*.perm'],
                output: { namespace: 'src/gen/{filename}.ts', model: 'src/gen/index.ts' },
            }),
        );
        const { config } = await loadConfig(cfgPath);
        expect(config.rootDir).toBe(workDir);
        expect(config.output.baseDir).toBe(workDir);
        expect(config.patterns).toEqual(['perms/*.perm']);
        expect(config.prettier).toBe(false);
    });

    it('rejects configs missing required fields', async () => {
        const cfgPath = join(workDir, 'permissions.config.json');
        await writeFile(cfgPath, JSON.stringify({ patterns: ['*.perm'] }));
        await expect(loadConfig(cfgPath)).rejects.toThrow(/output\.namespace/);
    });

    it('rejects output.namespace without {filename} placeholder', async () => {
        const cfgPath = join(workDir, 'permissions.config.json');
        await writeFile(
            cfgPath,
            JSON.stringify({
                patterns: ['*.perm'],
                output: { namespace: 'src/gen/perms.ts', model: 'src/gen/index.ts' },
            }),
        );
        await expect(loadConfig(cfgPath)).rejects.toThrow(/\{filename\}/);
    });

    it('findConfig walks up from cwd', async () => {
        const cfgPath = join(workDir, 'permissions.config.json');
        await writeFile(cfgPath, '{}');
        const nested = join(workDir, 'a', 'b', 'c');
        await import('node:fs/promises').then(fs => fs.mkdir(nested, { recursive: true }));
        expect(findConfig(nested)).toBe(cfgPath);
    });
});

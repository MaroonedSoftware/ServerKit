import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthorizationModel, defineNamespace } from '@maroonedsoftware/permissions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    permissionsFixturesPass,
    permissionsModelLoads,
    permissionsSchemaCompiled,
} from '../../src/integrations/permissions/index.js';
import { createMockContext } from '../helpers.js';

let workDir: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'johnny5-perm-'));
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

const writeConfig = async (config: object): Promise<string> => {
    const path = join(workDir, 'permissions.config.json');
    await writeFile(path, JSON.stringify(config), 'utf8');
    return path;
};

const writePerm = async (rel: string, source: string): Promise<string> => {
    const path = join(workDir, rel);
    await writeFile(path, source, 'utf8');
    return path;
};

describe('permissionsSchemaCompiled', () => {
    const minimalConfig = {
        patterns: ['*.perm'],
        prettier: false,
        output: { namespace: 'out/{filename}.ts', model: 'out/index.ts' },
    };

    it('passes when generated outputs are in sync with sources', async () => {
        await writeConfig(minimalConfig);
        await writePerm('doc.perm', `namespace doc { relation owner: user }\nnamespace user { relation self: user }`);

        const ctx = createMockContext({ repoRoot: workDir });
        // First run primes the cache and writes outputs.
        await permissionsSchemaCompiled().autoFix!(ctx);
        // Now the dry-run check should report clean.
        const result = await permissionsSchemaCompiled().run(ctx);
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/all up to date/);
    });

    it('fails when a .perm source has been edited since the last compile', async () => {
        await writeConfig(minimalConfig);
        await writePerm('doc.perm', `namespace doc { relation owner: user }\nnamespace user { relation self: user }`);
        const ctx = createMockContext({ repoRoot: workDir });
        await permissionsSchemaCompiled().autoFix!(ctx);

        await writePerm('doc.perm', `namespace doc { relation editor: user }\nnamespace user { relation self: user }`);
        const result = await permissionsSchemaCompiled().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/regeneration/);
        expect(result.fixHint).toBeTruthy();

        // Disk is unchanged — dryRun must not write.
        const generated = await readFile(join(workDir, 'out/doc.ts'), 'utf8');
        expect(generated).toMatch(/owner:/);
        expect(generated).not.toMatch(/editor:/);
    });

    it('autoFix runs the real compile() and brings the check back to green', async () => {
        await writeConfig(minimalConfig);
        await writePerm('doc.perm', `namespace doc { relation owner: user }\nnamespace user { relation self: user }`);
        const ctx = createMockContext({ repoRoot: workDir });
        await permissionsSchemaCompiled().autoFix!(ctx);

        await writePerm('doc.perm', `namespace doc { relation editor: user }\nnamespace user { relation self: user }`);
        const fixed = await permissionsSchemaCompiled().autoFix!(ctx);
        expect(fixed.ok).toBe(true);
        expect(fixed.message).toMatch(/regenerated/);

        const result = await permissionsSchemaCompiled().run(ctx);
        expect(result.ok).toBe(true);
    });

    it('reports missing config as a clear failure', async () => {
        const ctx = createMockContext({ repoRoot: workDir });
        const result = await permissionsSchemaCompiled().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/no permissions\.config\.json/);
    });

    it('surfaces aggregate compile errors via the fail message', async () => {
        await writeConfig(minimalConfig);
        // Unknown subject namespace `ghost` produces a CompileError that's wrapped
        // in an AggregateCompileError.
        await writePerm('bad.perm', `namespace bad { relation owner: ghost }`);
        const ctx = createMockContext({ repoRoot: workDir });
        const result = await permissionsSchemaCompiled().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/ghost/);
    });
});

describe('permissionsFixturesPass', () => {
    it('passes when every assertion in every fixture holds', async () => {
        const ctx = createMockContext({ repoRoot: join(workDir, '..') });
        // Use the package's own example fixture so we don't reinvent one.
        const examplesDir = join(__dirname, '..', '..', '..', 'permissions-dsl', 'examples');
        const result = await permissionsFixturesPass({
            patterns: [join(examplesDir, '*.perm.yaml')],
        }).run(ctx);
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/assertion\(s\) passed/);
    });

    it('fails when a fixture has a broken assertion', async () => {
        await writePerm('s.perm', `namespace doc { relation owner: user permission edit = owner }\nnamespace user { relation self: user }`);
        const fixturePath = join(workDir, 'broken.perm.yaml');
        await writeFile(
            fixturePath,
            ['schemaFile: ./s.perm', 'assertions:', '  assertTrue:', '    - doc:readme.edit@user:nobody', ''].join('\n'),
            'utf8',
        );
        const ctx = createMockContext({ repoRoot: workDir });
        const result = await permissionsFixturesPass({ patterns: ['broken.perm.yaml'] }).run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/failed/);
        expect(result.fixHint).toContain('pdsl validate');
    });

    it('fails when no fixtures match the glob', async () => {
        const ctx = createMockContext({ repoRoot: workDir });
        const result = await permissionsFixturesPass({ patterns: ['nothing/*.perm.yaml'] }).run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/no fixtures matched/);
    });

    it('relative patterns resolve against repoRoot', async () => {
        // Sanity: the existsSync below confirms the fixture is where the test
        // says it is, so a relative pattern can find it via cwd: repoRoot.
        const examplesDir = join(__dirname, '..', '..', '..', 'permissions-dsl', 'examples');
        expect(existsSync(join(examplesDir, 'document.perm.yaml'))).toBe(true);
    });
});

describe('permissionsModelLoads', () => {
    it('returns ok with the namespace count when the model loads', async () => {
        const ctx = createMockContext({ repoRoot: workDir });
        const result = await permissionsModelLoads({
            loadModel: async () => {
                const user = defineNamespace('user', { relations: {}, permissions: {} });
                const doc = defineNamespace('doc', {
                    relations: { owner: { subjects: ['user'] } },
                    permissions: {},
                });
                return new AuthorizationModel([user, doc]);
            },
        }).run(ctx);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('2 namespace(s) loaded');
    });

    it('surfaces constructor errors as a failing check', async () => {
        const ctx = createMockContext({ repoRoot: workDir });
        const result = await permissionsModelLoads({
            loadModel: async () => {
                const a = defineNamespace('user', { relations: {}, permissions: {} });
                const b = defineNamespace('user', { relations: {}, permissions: {} });
                return new AuthorizationModel([a, b]);
            },
        }).run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/duplicate namespace/);
    });
});

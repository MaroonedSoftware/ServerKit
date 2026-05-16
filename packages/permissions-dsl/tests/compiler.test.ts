import { existsSync } from 'node:fs';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler.js';
import { AggregateCompileError, CompileError } from '../src/diagnostics.js';

let workDir: string;

beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'pdsl-'));
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

const writeFixture = async (rel: string, content: string): Promise<string> => {
    const path = join(workDir, rel);
    await writeFile(path, content, 'utf8');
    return path;
};

describe('compile', () => {
    it('compiles a multi-file directory of .perm sources', async () => {
        await writeFixture(
            'doc.perm',
            `namespace doc {
  relation owner: user
  relation parent: folder
  permission edit = owner
  permission view = edit | parent->view
}`,
        );
        await writeFixture('folder.perm', `namespace folder { relation viewer: user permission view = viewer }`);
        await writeFixture('user.perm', `namespace user { relation self: user }`);

        const result = await compile({
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: {
                baseDir: workDir,
                namespace: 'out/{filename}.ts',
                model: 'out/index.ts',
            },
        });

        expect(result.namespaces.sort()).toEqual(['doc', 'folder', 'user']);
        expect(result.outputs).toHaveLength(4); // 3 ns + index

        const docOut = await readFile(join(workDir, 'out/doc.ts'), 'utf8');
        expect(docOut).toContain(`export const doc = defineNamespace('doc',`);
        expect(docOut).toContain(`tupleToUserset('parent', 'view')`);

        const indexOut = await readFile(join(workDir, 'out/index.ts'), 'utf8');
        expect(indexOut).toContain(`new AuthorizationModel(`);
        expect(indexOut).toContain(`import { doc } from './doc.js';`);
    });

    it('detects duplicate namespaces across files', async () => {
        await writeFixture('a.perm', `namespace doc { relation x: user }\nnamespace user { relation self: user }`);
        await writeFixture('b.perm', `namespace doc { relation y: user }`);

        const err = await compile({
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: {
                baseDir: workDir,
                namespace: 'out/{filename}.ts',
                model: 'out/index.ts',
            },
        }).then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(AggregateCompileError);
        expect((err as AggregateCompileError).errors[0]).toBeInstanceOf(CompileError);
    });

    it('errors when no files match the pattern', async () => {
        await expect(
            compile({
                rootDir: workDir,
                patterns: ['nope/*.perm'],
                prettier: false,
                output: {
                    baseDir: workDir,
                    namespace: 'out/{filename}.ts',
                    model: 'out/index.ts',
                },
            }),
        ).rejects.toThrow(/no files matched/);
    });

    it('serves unchanged files from cache on a second run', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user permission edit = owner }`);
        await writeFixture('user.perm', `namespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;

        const first = await compile(cfg);
        expect(first.cached).toHaveLength(0);
        expect(first.outputs.length).toBeGreaterThan(0);

        const second = await compile(cfg);
        expect(second.cached.sort()).toEqual(['doc', 'user']);
        expect(second.outputs).toHaveLength(0);
    });

    it('rebuilds only the file that changed', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user permission edit = owner }`);
        await writeFixture('user.perm', `namespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;

        await compile(cfg);
        // Touch doc.perm with a meaningful change.
        await writeFixture('doc.perm', `namespace doc { relation owner: user permission view = owner }`);
        const second = await compile(cfg);
        expect(second.cached).toEqual(['user']);
        expect(second.outputs.some(p => p.endsWith('doc.ts'))).toBe(true);
        expect(second.outputs.some(p => p.endsWith('user.ts'))).toBe(false);
    });

    it('deletes orphaned outputs when a namespace is removed', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user permission edit = owner }`);
        await writeFixture('user.perm', `namespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;
        await compile(cfg);
        expect(existsSync(join(workDir, 'out/doc.ts'))).toBe(true);

        // Drop doc.perm entirely.
        await rm(join(workDir, 'doc.perm'));
        const second = await compile(cfg);
        expect(second.orphaned.some(p => p.endsWith('doc.ts'))).toBe(true);
        expect(existsSync(join(workDir, 'out/doc.ts'))).toBe(false);
        expect(existsSync(join(workDir, 'out/user.ts'))).toBe(true);
    });

    it('aggregates errors from multiple files', async () => {
        // Two files, each with an unresolvable subject namespace. Both errors should surface together.
        await writeFixture('a.perm', `namespace a { relation owner: ghost1 }`);
        await writeFixture('b.perm', `namespace b { relation owner: ghost2 }`);
        const err = await compile({
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        }).then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(AggregateCompileError);
        expect((err as AggregateCompileError).errors.length).toBeGreaterThanOrEqual(2);
    });

    it('invalidates the cache when permissionsImport changes', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user }\nnamespace user { relation self: user }`);
        await compile({
            rootDir: workDir,
            patterns: ['doc.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        });
        // Same sources, different permissionsImport — should produce a full rebuild.
        const second = await compile({
            rootDir: workDir,
            patterns: ['doc.perm'],
            prettier: false,
            permissionsImport: '#perms',
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        });
        expect(second.cached).toHaveLength(0);
        const out = await readFile(join(workDir, 'out/doc.ts'), 'utf8');
        expect(out).toContain(`from '#perms'`);
    });

    it('does not touch output files when nothing changed', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user }\nnamespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['doc.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;
        await compile(cfg);
        const before = await stat(join(workDir, 'out/doc.ts'));
        await new Promise(r => setTimeout(r, 10));
        await compile(cfg);
        const after = await stat(join(workDir, 'out/doc.ts'));
        expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    it('dryRun reports pending writes without touching disk', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user permission edit = owner }`);
        await writeFixture('user.perm', `namespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;

        // Warm up: real compile populates the cache and writes outputs.
        await compile(cfg);
        const docOut = join(workDir, 'out/doc.ts');
        const before = await stat(docOut);

        // Edit the source so a recompile would regenerate doc.ts.
        await writeFixture('doc.perm', `namespace doc { relation owner: user permission view = owner }`);
        await new Promise(r => setTimeout(r, 10));

        const dry = await compile(cfg, { dryRun: true });
        expect(dry.outputs.some(p => p.endsWith('doc.ts'))).toBe(true);

        // Disk is untouched: doc.ts mtime and contents reflect the pre-edit state.
        const after = await stat(docOut);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        const doc = await readFile(docOut, 'utf8');
        expect(doc).toMatch(/\bedit:/);
        expect(doc).not.toMatch(/\bview:/);
    });

    it('dryRun lists orphans without deleting them', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user }`);
        await writeFixture('user.perm', `namespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;
        await compile(cfg);
        expect(existsSync(join(workDir, 'out/doc.ts'))).toBe(true);

        // Drop doc.perm but only ask for a dry-run.
        await rm(join(workDir, 'doc.perm'));
        const dry = await compile(cfg, { dryRun: true });
        expect(dry.orphaned.some(p => p.endsWith('doc.ts'))).toBe(true);
        // doc.ts is still on disk because dryRun skips the rm.
        expect(existsSync(join(workDir, 'out/doc.ts'))).toBe(true);
    });

    it('dryRun reports clean state as zero outputs and zero orphans', async () => {
        await writeFixture('doc.perm', `namespace doc { relation owner: user }\nnamespace user { relation self: user }`);
        const cfg = {
            rootDir: workDir,
            patterns: ['*.perm'],
            prettier: false,
            output: { baseDir: workDir, namespace: 'out/{filename}.ts', model: 'out/index.ts' },
        } as const;
        await compile(cfg);
        const dry = await compile(cfg, { dryRun: true });
        expect(dry.outputs).toEqual([]);
        expect(dry.orphaned).toEqual([]);
        expect(dry.cached.sort()).toEqual(['doc', 'user']);
    });

    it('uses the configured permissionsImport for generated code', async () => {
        await writeFixture('a.perm', `namespace doc { relation x: user }\nnamespace user { relation self: user }`);
        await compile({
            rootDir: workDir,
            patterns: ['a.perm'],
            prettier: false,
            permissionsImport: '#permissions',
            output: {
                baseDir: workDir,
                namespace: 'out/{filename}.ts',
                model: 'out/index.ts',
            },
        });
        const out = await readFile(join(workDir, 'out/doc.ts'), 'utf8');
        expect(out).toContain(`from '#permissions'`);
    });
});

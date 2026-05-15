import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compile } from '../src/compiler.js';
import { CompileError } from '../src/diagnostics.js';

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

        await expect(
            compile({
                rootDir: workDir,
                patterns: ['*.perm'],
                prettier: false,
                output: {
                    baseDir: workDir,
                    namespace: 'out/{filename}.ts',
                    model: 'out/index.ts',
                },
            }),
        ).rejects.toBeInstanceOf(CompileError);
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

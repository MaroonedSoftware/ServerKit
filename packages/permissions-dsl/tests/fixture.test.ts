import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFixture, parseRelationships, stringifyFixture } from '../src/fixture.js';

const SCHEMA = `
namespace user {}
namespace folder {
  relation viewer: user, user.*
}
namespace doc {
  relation parent: folder
  relation owner: user
  relation editor: user
  relation banned: user
  permission edit = owner | editor
  permission view = edit | parent->viewer
  permission allowed = view - banned
}
`;

describe('parseRelationships', () => {
    it('parses one tuple per line and skips comments/blanks', () => {
        const rels = parseRelationships(`
# leading comment
doc:d1.owner@user:alice

# blank line above
doc:d1.parent@folder:f1
`);
        expect(rels).toHaveLength(2);
        expect(rels[0]!.tuple.subject).toMatchObject({ id: 'alice' });
        expect(rels[0]!.line).toBe(3);
        expect(rels[1]!.line).toBe(6);
    });

    it('throws with the offending line number on malformed input', () => {
        expect(() => parseRelationships('doc:d1.owner@user:alice\nnot-a-tuple')).toThrow(/line 2/);
    });
});

describe('loadFixture', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'pdsl-fixture-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('loads a fixture with schemaFile and pre-populates the repository', async () => {
        await writeFile(path.join(dir, 'schema.perm'), SCHEMA);
        await writeFile(
            path.join(dir, 'doc.perm.yaml'),
            `schemaFile: ./schema.perm
relationships: |-
  doc:d1.owner@user:alice
  doc:d1.parent@folder:f1
assertions:
  assertTrue:
    - doc:d1.edit@user:alice
  assertFalse:
    - doc:d1.edit@user:bob
`,
        );
        const fixture = await loadFixture(path.join(dir, 'doc.perm.yaml'));
        expect(fixture.relationships).toHaveLength(2);
        expect(fixture.repository.all()).toHaveLength(2);
        expect(fixture.model.get('doc')).toBeDefined();
        expect(fixture.file.assertions.assertTrue).toEqual(['doc:d1.edit@user:alice']);
    });

    it('loads a fixture with inline schema', async () => {
        await writeFile(
            path.join(dir, 'inline.perm.yaml'),
            `schema: |\n${SCHEMA.split('\n').map(l => '  ' + l).join('\n')}\nrelationships: ""\nassertions: { assertTrue: [], assertFalse: [] }`,
        );
        const fixture = await loadFixture(path.join(dir, 'inline.perm.yaml'));
        expect(fixture.model.get('doc')).toBeDefined();
    });

    it('rejects a fixture missing both schema and schemaFile', async () => {
        await writeFile(path.join(dir, 'bad.perm.yaml'), `relationships: ""`);
        await expect(loadFixture(path.join(dir, 'bad.perm.yaml'))).rejects.toThrow();
    });

    it('builds a source map pointing at the YAML line of each assertion', async () => {
        await writeFile(path.join(dir, 'schema.perm'), SCHEMA);
        await writeFile(
            path.join(dir, 'sm.perm.yaml'),
            `schemaFile: ./schema.perm
relationships: |-
  doc:d1.owner@user:alice
assertions:
  assertTrue:
    - doc:d1.edit@user:alice
  assertFalse:
    - doc:d1.edit@user:bob
`,
        );
        const fixture = await loadFixture(path.join(dir, 'sm.perm.yaml'));
        expect(fixture.sourceMap.assertTrue[0]).toBeGreaterThan(0);
        expect(fixture.sourceMap.assertFalse[0]).toBeGreaterThan(fixture.sourceMap.assertTrue[0]!);
    });
});

describe('stringifyFixture', () => {
    it('serializes back to YAML with the relationships heredoc', () => {
        const out = stringifyFixture(
            {
                schemaFile: './schema.perm',
                relationships: '',
                assertions: { assertTrue: ['doc:d1.view@user:alice'], assertFalse: [] },
                validation: {},
            },
            [],
        );
        expect(out).toContain('schemaFile: ./schema.perm');
        expect(out).toContain('assertTrue:');
    });
});

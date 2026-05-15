import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from '../src/fixture.js';
import { explainRelationship, formatReport, runFixture } from '../src/validate.js';

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

const writeFixture = async (dir: string, body: string): Promise<string> => {
    await writeFile(path.join(dir, 'schema.perm'), SCHEMA);
    const p = path.join(dir, 'doc.perm.yaml');
    await writeFile(p, `schemaFile: ./schema.perm\n${body}`);
    return p;
};

describe('runFixture', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'pdsl-validate-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('passes assertTrue and assertFalse when the model agrees', async () => {
        const p = await writeFixture(
            dir,
            `relationships: |-
  doc:d1.owner@user:alice
  doc:d1.parent@folder:f1
  folder:f1.viewer@user:bob
assertions:
  assertTrue:
    - doc:d1.edit@user:alice
    - doc:d1.view@user:bob
  assertFalse:
    - doc:d1.edit@user:bob
`,
        );
        const report = await runFixture(await loadFixture(p));
        expect(report.summary).toEqual({ passed: 3, failed: 0 });
        expect(report.results.every(r => r.pass)).toBe(true);
    });

    it('fails an assertTrue when the model denies, with a useful message', async () => {
        const p = await writeFixture(
            dir,
            `relationships: ""
assertions:
  assertTrue:
    - doc:d1.edit@user:alice
  assertFalse: []
`,
        );
        const report = await runFixture(await loadFixture(p));
        expect(report.summary).toEqual({ passed: 0, failed: 1 });
        expect(report.results[0]!.message).toMatch(/expected ALLOWED, got DENIED/);
        expect(report.results[0]!.line).toBeGreaterThan(0);
    });

    it('reports parse errors on malformed assertion strings', async () => {
        const p = await writeFixture(
            dir,
            `relationships: ""
assertions:
  assertTrue:
    - garbage
  assertFalse: []
`,
        );
        const report = await runFixture(await loadFixture(p));
        expect(report.summary.failed).toBe(1);
        expect(report.results[0]!.message).toMatch(/malformed/);
    });

    it('runs validation entries and reports unreachable subjects', async () => {
        const p = await writeFixture(
            dir,
            `relationships: |-
  doc:d1.owner@user:alice
assertions: { assertTrue: [], assertFalse: [] }
validation:
  doc:d1.edit:
    - "[user:alice] is <doc:d1.owner>"
    - "[user:bob] is <doc:d1.owner>"
`,
        );
        const report = await runFixture(await loadFixture(p));
        const v = report.results.find(r => r.kind === 'validation')!;
        expect(v.pass).toBe(false);
        expect(v.message).toMatch(/user:bob/);
    });
});

describe('formatReport', () => {
    it('renders a TAP-like summary', async () => {
        let dir = await mkdtemp(path.join(tmpdir(), 'pdsl-format-'));
        const p = await writeFixture(dir, `relationships: ""\nassertions: { assertTrue: [], assertFalse: [] }`);
        const report = await runFixture(await loadFixture(p));
        const out = formatReport(report);
        expect(out).toMatch(/^# /);
        expect(out).toContain('0 passed, 0 failed');
        await rm(dir, { recursive: true, force: true });
    });
});

describe('explainRelationship', () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'pdsl-explain-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('returns the same allowed value as check and a non-trivial trace', async () => {
        const p = await writeFixture(
            dir,
            `relationships: |-
  doc:d1.parent@folder:f1
  folder:f1.viewer@user:bob
assertions: { assertTrue: [], assertFalse: [] }
`,
        );
        const fixture = await loadFixture(p);
        const { allowed, trace } = await explainRelationship(fixture, 'doc:d1.view@user:bob');
        expect(allowed).toBe(true);
        expect(trace.kind).toBe('union');
    });
});

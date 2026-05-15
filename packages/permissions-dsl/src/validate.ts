import {
    check,
    explain,
    formatSubject,
    parseTuple,
    type AuthorizationModel,
    type CheckTrace,
    type InMemoryTupleRepository,
    type RelationTuple,
    type SubjectRef,
} from '@maroonedsoftware/permissions';
import type { LoadedFixture } from './fixture.js';

/**
 * Single assertion outcome inside a {@link FixtureReport}. `line` is the
 * 1-indexed line in the fixture YAML (or `0` if it couldn't be located),
 * useful for editor diagnostics.
 */
export interface AssertionResult {
    kind: 'assertTrue' | 'assertFalse' | 'validation';
    line: number;
    /** Original relationship string as authored. */
    text: string;
    /** Whether the assertion passed. */
    pass: boolean;
    /** Human-readable explanation when `pass: false`. */
    message?: string;
}

/** Summary of running every assertion in a fixture. */
export interface FixtureReport {
    filename: string;
    schemaFilename: string;
    results: AssertionResult[];
    summary: { passed: number; failed: number };
}

/**
 * Run every assertion declared in a {@link LoadedFixture} and return a
 * structured report. Suitable for both CLI output and editor diagnostics —
 * each result carries the YAML line number of its origin.
 */
export const runFixture = async (fixture: LoadedFixture): Promise<FixtureReport> => {
    const results: AssertionResult[] = [];
    const { file, model, repository, sourceMap } = fixture;

    for (let i = 0; i < file.assertions.assertTrue.length; i++) {
        results.push(await runAssertion('assertTrue', file.assertions.assertTrue[i]!, sourceMap.assertTrue[i] ?? 0, true, model, repository));
    }
    for (let i = 0; i < file.assertions.assertFalse.length; i++) {
        results.push(await runAssertion('assertFalse', file.assertions.assertFalse[i]!, sourceMap.assertFalse[i] ?? 0, false, model, repository));
    }
    for (const [key, expectedPaths] of Object.entries(file.validation) as Array<[string, string[]]>) {
        results.push(await runValidationGroup(key, expectedPaths, sourceMap.validation[key] ?? 0, model, repository));
    }

    const summary = results.reduce(
        (acc, r) => {
            if (r.pass) acc.passed++;
            else acc.failed++;
            return acc;
        },
        { passed: 0, failed: 0 },
    );

    return { filename: fixture.filename, schemaFilename: fixture.schemaFilename, results, summary };
};

const runAssertion = async (
    kind: 'assertTrue' | 'assertFalse',
    text: string,
    line: number,
    expected: boolean,
    model: AuthorizationModel,
    repository: InMemoryTupleRepository,
): Promise<AssertionResult> => {
    let tuple: RelationTuple;
    try {
        tuple = parseTuple(text);
    } catch (err) {
        return { kind, line, text, pass: false, message: err instanceof Error ? err.message : String(err) };
    }
    try {
        const allowed = await check(model, repository, tuple.object, tuple.relation, tuple.subject);
        if (allowed === expected) return { kind, line, text, pass: true };
        return {
            kind,
            line,
            text,
            pass: false,
            message: `expected ${expected ? 'ALLOWED' : 'DENIED'}, got ${allowed ? 'ALLOWED' : 'DENIED'}`,
        };
    } catch (err) {
        return { kind, line, text, pass: false, message: err instanceof Error ? err.message : String(err) };
    }
};

// "[user:alice] is <doc:readme.owner>" — validation line shape.
const validationLineRe = /^\[([^\]]+)]\s+is\s+<([^>]+)>$/;

const runValidationGroup = async (
    key: string,
    expectedPaths: string[],
    line: number,
    model: AuthorizationModel,
    repository: InMemoryTupleRepository,
): Promise<AssertionResult> => {
    const colon = key.indexOf(':');
    if (colon === -1) {
        return { kind: 'validation', line, text: key, pass: false, message: `validation key must be "<namespace>:<id>.<permission>"` };
    }
    const namespace = key.slice(0, colon);
    const rest = key.slice(colon + 1);
    const dot = rest.indexOf('.');
    if (dot === -1) {
        return { kind: 'validation', line, text: key, pass: false, message: `validation key must be "<namespace>:<id>.<permission>"` };
    }
    const object = { namespace, id: rest.slice(0, dot) };
    const perm = rest.slice(dot + 1);

    const messages: string[] = [];
    for (const declared of expectedPaths) {
        const m = declared.match(validationLineRe);
        if (!m) {
            messages.push(`malformed path "${declared}" — expected "[subject] is <object.relation>"`);
            continue;
        }
        let subject: SubjectRef;
        try {
            subject = parseSubjectShorthand(m[1]!);
        } catch (err) {
            messages.push(`"${declared}" — ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
        try {
            const allowed = await check(model, repository, object, perm, subject);
            if (!allowed) messages.push(`"${declared}" — ${formatSubject(subject)} is not allowed on ${key}`);
        } catch (err) {
            messages.push(`"${declared}" — ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return {
        kind: 'validation',
        line,
        text: key,
        pass: messages.length === 0,
        message: messages.length === 0 ? undefined : messages.join('; '),
    };
};

const parseSubjectShorthand = (s: string): SubjectRef => {
    // A bracketed validation subject uses the same form as the right side of
    // a tuple's `@`. Reuse `parseTuple` so the same parser governs both.
    return parseTuple(`placeholder:p.viewer@${s}`).subject;
};

/**
 * Render a {@link FixtureReport} as TAP-like text suitable for CLI output.
 */
export const formatReport = (report: FixtureReport): string => {
    const lines: string[] = [`# ${report.filename} → ${report.schemaFilename}`];
    for (const r of report.results) {
        const head = `${r.pass ? 'ok' : 'not ok'}  [${r.kind}] ${r.text}${r.line ? ` (line ${r.line})` : ''}`;
        lines.push(head);
        if (!r.pass && r.message) lines.push(`  ${r.message}`);
    }
    lines.push(`# ${report.summary.passed} passed, ${report.summary.failed} failed`);
    return lines.join('\n');
};

/**
 * Convenience: run `explain` on a relationship string in the context of a
 * loaded fixture. Wraps {@link explain} so CLI code stays terse.
 */
export const explainRelationship = async (
    fixture: LoadedFixture,
    relationship: string,
): Promise<{ allowed: boolean; trace: CheckTrace }> => {
    const tuple = parseTuple(relationship);
    const result = await explain(fixture.model, fixture.repository, tuple.object, tuple.relation, tuple.subject);
    return { allowed: result.allowed, trace: result.trace };
};

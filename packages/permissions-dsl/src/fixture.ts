import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
    AuthorizationModel,
    InMemoryTupleRepository,
    parseTuple,
    type RelationTuple,
    stringifyTuple,
} from '@maroonedsoftware/permissions';
import * as YAML from 'yaml';
import { z } from 'zod';
import { lower } from './lower.js';
import { parse } from './parser.js';

/**
 * On-disk fixture file format. Inspired by SpiceDB's validation YAML:
 *
 * ```yaml
 * schemaFile: ./schema.perm
 * relationships: |-
 *   doc:readme.owner@user:alice
 *   doc:readme.parent@folder:engineering
 * assertions:
 *   assertTrue:  ["doc:readme.edit@user:alice"]
 *   assertFalse: ["doc:readme.edit@user:bob"]
 * validation:
 *   doc:readme.view:
 *     - "[user:alice] is <doc:readme.owner>"
 * ```
 *
 * `schema` (inline `.perm` source) may be used in place of `schemaFile`.
 * Everything else is optional.
 */
export const FixtureSchema = z
    .object({
        schemaFile: z.string().optional(),
        schema: z.string().optional(),
        relationships: z.string().default(''),
        assertions: z
            .object({
                assertTrue: z.array(z.string()).default([]),
                assertFalse: z.array(z.string()).default([]),
            })
            .default({ assertTrue: [], assertFalse: [] }),
        validation: z.record(z.string(), z.array(z.string())).default({}),
    })
    .refine(v => v.schemaFile !== undefined || v.schema !== undefined, {
        message: 'fixture must declare either `schemaFile` or `schema`',
    });
export type FixtureFile = z.infer<typeof FixtureSchema>;

/**
 * 1-indexed line number of a value inside the source YAML. Used to render
 * editor diagnostics (`fixture.yaml:12:1 FAIL ...`) and gutter icons.
 */
export interface FixtureSourceMap {
    assertTrue: Record<number, number>; // index → line
    assertFalse: Record<number, number>; // index → line
    validation: Record<string, number>; // permission key → line
}

export interface LoadedFixture {
    /** Path the fixture was loaded from (for diagnostics). */
    filename: string;
    /** Raw fixture content parsed and validated. */
    file: FixtureFile;
    /** Resolved `.perm` source. */
    schemaSource: string;
    /** Resolved `.perm` filename (for diagnostics). */
    schemaFilename: string;
    /** Compiled authorization model. */
    model: AuthorizationModel;
    /** Pre-loaded in-memory tuple repository with `relationships:` applied. */
    repository: InMemoryTupleRepository;
    /** Parsed relationships, in declaration order. */
    relationships: RelationTuple[];
    /** Line numbers for each assertion, for diagnostics. */
    sourceMap: FixtureSourceMap;
}

/**
 * Parse a fixture's `relationships:` heredoc. Blank lines and `#`-prefixed
 * lines are skipped so users can comment their fixtures. Returns the parsed
 * tuples plus their 1-indexed line numbers *within the heredoc*.
 */
export const parseRelationships = (text: string): Array<{ tuple: RelationTuple; line: number }> => {
    const out: Array<{ tuple: RelationTuple; line: number }> = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] ?? '';
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        try {
            out.push({ tuple: parseTuple(trimmed), line: i + 1 });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`relationships line ${i + 1}: ${msg}`, { cause: err });
        }
    }
    return out;
};

const buildSourceMap = (raw: string, file: FixtureFile): FixtureSourceMap => {
    // Best-effort: scan the YAML source for each assertion string and record
    // its line. Quoting and the heredoc indent strip make a full AST walk
    // unreliable across yaml versions, so we settle for substring search.
    const lines = raw.split('\n');
    const findLine = (needle: string, after = 0): number => {
        const escaped = needle.replace(/['"]/g, '');
        for (let i = after; i < lines.length; i++) {
            if (lines[i]?.includes(escaped)) return i + 1;
        }
        return 0;
    };
    const map: FixtureSourceMap = { assertTrue: {}, assertFalse: {}, validation: {} };
    let cursor = 0;
    file.assertions.assertTrue.forEach((s, i) => {
        const line = findLine(s, cursor);
        map.assertTrue[i] = line;
        if (line) cursor = line;
    });
    cursor = 0;
    file.assertions.assertFalse.forEach((s, i) => {
        const line = findLine(s, cursor);
        map.assertFalse[i] = line;
        if (line) cursor = line;
    });
    Object.keys(file.validation).forEach(k => {
        map.validation[k] = findLine(k);
    });
    return map;
};

/**
 * Load and compile a fixture file. Reads the YAML, validates its shape,
 * resolves the schema (inline or via `schemaFile`), compiles it via the
 * existing parse/lower pipeline, and pre-populates an
 * {@link InMemoryTupleRepository} from the `relationships:` heredoc.
 *
 * Throws plain `Error`s with `<filename>:<line>` prefixes on malformed
 * input; the schema compile path throws `ParseError`/`CompileError` from
 * `@maroonedsoftware/permissions-dsl` with their own caret-annotated
 * diagnostics, so callers can render those without extra glue.
 */
export const loadFixture = async (filename: string): Promise<LoadedFixture> => {
    const raw = await readFile(filename, 'utf8');
    let parsed: unknown;
    try {
        parsed = YAML.parse(raw);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${filename}: invalid YAML: ${msg}`, { cause: err });
    }
    const file = FixtureSchema.parse(parsed);

    let schemaSource: string;
    let schemaFilename: string;
    if (file.schemaFile) {
        schemaFilename = path.resolve(path.dirname(filename), file.schemaFile);
        schemaSource = await readFile(schemaFilename, 'utf8');
    } else {
        schemaFilename = `${filename}#schema`;
        schemaSource = file.schema!;
    }

    const ast = parse({ source: schemaSource, filename: schemaFilename });
    const { model } = lower(ast, { source: schemaSource, filename: schemaFilename });

    const rels = parseRelationships(file.relationships);
    const repository = new InMemoryTupleRepository(rels.map(r => r.tuple));

    return {
        filename,
        file,
        schemaSource,
        schemaFilename,
        model,
        repository,
        relationships: rels.map(r => r.tuple),
        sourceMap: buildSourceMap(raw, file),
    };
};

/**
 * Serialize a fixture back to YAML. Used by the VSCode playground when the
 * user clicks "Save as fixture".
 */
export const stringifyFixture = (file: FixtureFile, relationships: RelationTuple[]): string => {
    const doc: FixtureFile = {
        ...file,
        relationships: relationships.map(stringifyTuple).join('\n'),
    };
    return YAML.stringify(doc);
};

import type { CheckTrace, RelationTuple, SubjectRef } from '@maroonedsoftware/permissions';

/**
 * Message types exchanged between the extension client, the LSP server, and
 * the playground webview. Keep this file dependency-free at runtime — it is
 * imported by all three layers.
 */

/** Custom LSP request method names. Namespaced under `serverkit/`. */
export const PlaygroundMethods = {
    Check: 'serverkit/playground/check',
    Explain: 'serverkit/playground/explain',
    LoadSchema: 'serverkit/playground/loadSchema',
    LoadFixture: 'serverkit/playground/loadFixture',
    SaveFixture: 'serverkit/playground/saveFixture',
    DiscoverChecks: 'serverkit/playground/discoverChecks',
} as const;

/** Single `check()` call site discovered in the user's codebase. */
export interface DiscoveredCheck {
    /** Absolute filesystem path of the file containing the call. */
    file: string;
    /** 1-indexed line number where the call begins. */
    line: number;
    /** Permission/relation name passed to `check()` — the 4th positional arg, when it's a string literal. */
    permission?: string;
    /** Object namespace, when statically determinable from the 3rd arg (e.g. `{ namespace: 'doc', id: ... }`). */
    namespace?: string;
    /** The matched source line, trimmed to fit a single UI row. */
    snippet: string;
}

export interface DiscoverChecksResponse {
    sites: DiscoveredCheck[];
    /** Set when the scan couldn't run (e.g. workspace root unknown). */
    error?: string;
}

/** Request to read a `.perm.yaml` fixture from disk and extract its tuples + first assertion. */
export interface LoadFixtureRequest {
    path: string;
}

/** Response from {@link PlaygroundMethods.LoadFixture}. */
export interface LoadFixtureResponse {
    /** Raw `relationships:` heredoc (one tuple per line). */
    relationships?: string;
    /** First entry from `assertions.assertTrue`, if any — used to prime the check input. */
    check?: string;
    error?: string;
}

/** Request to write the playground's current state as a `.perm.yaml` fixture. */
export interface SaveFixtureRequest {
    /** Destination path. */
    path: string;
    /** Filesystem path to the `.perm` schema this fixture targets. Stored relative to `path`. */
    schemaPath: string;
    relationships: string;
    /** Optional check string to seed `assertions.assertTrue`. */
    check?: string;
}

export interface SaveFixtureResponse {
    error?: string;
}

/**
 * One relation entry inside a {@link SchemaSummary} namespace. The `subjects`
 * field carries the raw `SubjectType` strings declared in the `.perm` source
 * (e.g. `'user'`, `'user.*'`, `'org.admin'`) so the playground UI can scope
 * subject pickers to what the schema actually allows.
 */
export interface SchemaRelation {
    name: string;
    subjects: string[];
}

/**
 * One namespace in the schema. `local` distinguishes namespaces declared in
 * the active `.perm` document (rendered in the side panel) from sibling
 * namespaces pulled from other workspace files (which still show up in the
 * builder dropdowns so cross-file references resolve).
 */
export interface SchemaNamespace {
    name: string;
    relations: SchemaRelation[];
    permissions: string[];
    local: boolean;
}

export interface SchemaSummary {
    namespaces: SchemaNamespace[];
    /** When the schema fails to compile, populated; otherwise undefined. */
    error?: { message: string; line?: number; column?: number };
}

/** Input to {@link PlaygroundMethods.Check} and {@link PlaygroundMethods.Explain}. */
export interface CheckRequest {
    /** `.perm` source as currently authored. */
    schema: string;
    /** Schema's filename (or a synthetic name) used in error messages. */
    schemaFilename?: string;
    /** Relationship lines — one tuple per line. Blank/`#`-prefixed lines skipped. */
    relationships: string;
    /** Check input in canonical string form: `<namespace>:<id>.<permission>@<subject>`. */
    relationship: string;
}

/** Response from {@link PlaygroundMethods.Check} — verdict plus echoed parse results for UI display. */
export interface CheckResponse {
    /** Final ALLOWED / DENIED result. */
    allowed: boolean;
    /** When the schema or relationships can't be parsed, populated. */
    error?: string;
    /** Parsed tuples that were loaded into the in-memory repository. */
    loadedRelationships?: RelationTuple[];
    /** The parsed check tuple, for the UI to render. */
    parsedCheck?: { object: { namespace: string; id: string }; relation: string; subject: SubjectRef };
}

/**
 * Response from {@link PlaygroundMethods.Explain} — same shape as
 * {@link CheckResponse} but with the hierarchical `CheckTrace` attached.
 */
export interface ExplainResponse extends CheckResponse {
    trace?: CheckTrace;
}

/**
 * Webview ↔ extension client messages. Both directions use this discriminated
 * union; `kind` names the message.
 */
export type PlaygroundMessage =
    | { kind: 'ready' }
    | { kind: 'schemaUpdated'; schema: string; schemaFilename: string }
    | { kind: 'requestCheck'; relationships: string; relationship: string; explain: boolean }
    | { kind: 'checkResult'; response: ExplainResponse }
    | { kind: 'requestLoadFixture' }
    | { kind: 'requestSaveFixture'; relationships: string; check?: string }
    | { kind: 'fixtureLoaded'; relationships: string; check?: string }
    | { kind: 'fixtureSaved'; path: string }
    | { kind: 'fixtureError'; message: string }
    | { kind: 'requestDiscoverChecks' }
    | { kind: 'discoveredChecks'; response: DiscoverChecksResponse };

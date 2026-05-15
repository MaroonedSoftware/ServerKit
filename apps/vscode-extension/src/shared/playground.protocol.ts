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
} as const;

export interface SchemaSummary {
    namespaces: Array<{
        name: string;
        relations: string[];
        permissions: string[];
    }>;
    /** When the schema fails to compile, populated; otherwise undefined. */
    error?: { message: string; line?: number; column?: number };
}

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
    | { kind: 'checkResult'; response: ExplainResponse };

import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    createConnection,
    DiagnosticSeverity,
    DocumentSymbol,
    FileChangeType,
    ProposedFeatures,
    SymbolKind,
    TextDocumentSyncKind,
    TextDocuments,
    type Diagnostic,
    type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    CompileError,
    parse,
    validateFile,
    yamlParse,
    yamlStringify,
    type FileNode,
    type MemberNode,
    type NamespaceNode,
} from '@maroonedsoftware/permissions-dsl';
import { WorkspaceIndex } from './workspace.index.js';
import {
    check,
    explain,
    InMemoryTupleRepository,
    parseTuple,
    type RelationTuple,
} from '@maroonedsoftware/permissions';
import { spanToRange } from '../shared/offset.js';
import {
    PlaygroundMethods,
    type CheckRequest,
    type CheckResponse,
    type DiscoverChecksResponse,
    type DiscoveredCheck,
    type ExplainResponse,
    type LoadFixtureRequest,
    type LoadFixtureResponse,
    type SaveFixtureRequest,
    type SaveFixtureResponse,
    type SchemaSummary,
} from '../shared/playground.protocol.js';
import { readFile, writeFile, glob } from 'node:fs/promises';
import { relative as pathRelative, dirname as pathDirname, join as pathJoin, sep as pathSep } from 'node:path';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const workspaceIndex = new WorkspaceIndex();
let initialScan: Promise<void> = Promise.resolve();
let workspaceFolders: string[] = [];

const uriToFilename = (uri: string): string => {
    try {
        return fileURLToPath(uri);
    } catch {
        return uri;
    }
};

const validate = async (doc: TextDocument): Promise<void> => {
    await initialScan;
    const text = doc.getText();
    const filename = uriToFilename(doc.uri);
    const diagnostics: Diagnostic[] = [];
    let err: CompileError | undefined;
    try {
        const result = validateFile({ source: text, filename, siblings: workspaceIndex.siblings(doc.uri) });
        err = result.error;
    } catch (parseErr) {
        if (parseErr instanceof CompileError) err = parseErr;
        else throw parseErr;
    }
    if (err) {
        // Span coordinates are offsets into the source passed to `lower()` — which is
        // the local document. If the span lands past the end of the local text it
        // belongs to a sibling namespace's node; let that file's own validation
        // surface the diagnostic instead.
        if (err.span.start <= text.length && err.span.end <= text.length) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: spanToRange(text, err.span),
                message: err.message.replace(/^.*?error:\s*/m, '').split('\n')[0] ?? err.message,
                source: 'pdsl',
            });
        }
    }
    void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
};

const revalidateAll = (): void => {
    for (const doc of documents.all()) {
        void validate(doc);
    }
};

const parseSilently = (text: string, filename: string): FileNode | undefined => {
    try {
        return parse({ source: text, filename });
    } catch {
        return undefined;
    }
};

const memberSymbol = (text: string, member: MemberNode): DocumentSymbol => ({
    name: member.name,
    detail: member.kind === 'relation' ? 'relation' : 'permission',
    kind: member.kind === 'relation' ? SymbolKind.Field : SymbolKind.Function,
    range: spanToRange(text, member.loc),
    selectionRange: spanToRange(text, member.nameLoc),
});

const namespaceSymbol = (text: string, ns: NamespaceNode): DocumentSymbol => ({
    name: ns.name,
    detail: 'namespace',
    kind: SymbolKind.Namespace,
    range: spanToRange(text, ns.loc),
    selectionRange: spanToRange(text, ns.nameLoc),
    children: ns.members.map(m => memberSymbol(text, m)),
});

connection.onInitialize((params): InitializeResult => {
    const folderPaths: string[] = [];
    if (params.workspaceFolders) {
        for (const f of params.workspaceFolders) folderPaths.push(uriToFilename(f.uri));
    } else if (params.rootUri) {
        folderPaths.push(uriToFilename(params.rootUri));
    } else if (params.rootPath) {
        folderPaths.push(params.rootPath);
    }
    workspaceFolders = folderPaths;
    initialScan = workspaceIndex.initialScan(folderPaths).then(() => revalidateAll());

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            documentSymbolProvider: true,
            workspace: { workspaceFolders: { supported: true } },
        },
    };
});

documents.onDidChangeContent(change => {
    workspaceIndex.updateFromText(change.document.uri, change.document.getText());
    void validate(change.document);
});
documents.onDidOpen(change => {
    workspaceIndex.updateFromText(change.document.uri, change.document.getText());
    void validate(change.document);
});
documents.onDidClose(change => {
    void connection.sendDiagnostics({ uri: change.document.uri, diagnostics: [] });
});

connection.onDidChangeWatchedFiles(async params => {
    for (const change of params.changes) {
        if (change.type === FileChangeType.Deleted) {
            workspaceIndex.remove(change.uri);
        } else {
            // Created or Changed. If the file is open in the editor, the
            // document-sync path already has fresher content — skip the disk read.
            if (!documents.get(change.uri)) {
                await workspaceIndex.updateFromDisk(change.uri);
            }
        }
    }
    revalidateAll();
});

connection.onDocumentSymbol(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const text = doc.getText();
    const file = parseSilently(text, uriToFilename(doc.uri));
    if (!file) return [];
    return file.namespaces.map(ns => namespaceSymbol(text, ns));
});

// Convert a filesystem path coming from the playground client into the URI key
// `WorkspaceIndex` stores entries under, so sibling lookup hits.
const filenameToUri = (filename: string): string => {
    try {
        return pathToFileURL(filename).href;
    } catch {
        return filename;
    }
};

// Validate the active document with workspace siblings merged in, so
// cross-file references (e.g. `relation parent: org` where `org` lives in
// another `.perm` file) resolve. Without the merge, the playground reports
// false "unknown namespace" errors for any multi-file schema.
const validateWithSiblings = (schema: string, filename: string): { file: FileNode; lowered?: ReturnType<typeof validateFile>['lowered']; error?: CompileError; localNames: Set<string> } => {
    const siblings = workspaceIndex.siblings(filenameToUri(filename));
    const result = validateFile({ source: schema, filename, siblings });
    return {
        file: result.file,
        lowered: result.lowered,
        error: result.error,
        localNames: new Set(result.file.namespaces.map(n => n.name)),
    };
};

const buildSchemaSummary = (schema: string, filename: string): SchemaSummary => {
    try {
        const { lowered, error, localNames } = validateWithSiblings(schema, filename);
        if (error) {
            return {
                namespaces: [],
                error: { message: error.message.replace(/^.*?error:\s*/m, '').split('\n')[0] ?? error.message },
            };
        }
        // Return every visible namespace (local + sibling). The playground
        // side-panel filters to `local` for display; the builder dropdowns
        // use the full set so cross-file subjects (e.g. `user` declared in
        // user.perm) are pickable.
        return {
            namespaces: lowered!.namespaces.map(ns => ({
                name: ns.name,
                relations: Object.entries(ns.relations).map(([name, def]) => ({ name, subjects: def.subjects })),
                permissions: Object.keys(ns.permissions),
                local: localNames.has(ns.name),
            })),
        };
    } catch (err) {
        if (err instanceof CompileError) {
            return {
                namespaces: [],
                error: { message: err.message.replace(/^.*?error:\s*/m, '').split('\n')[0] ?? err.message },
            };
        }
        return { namespaces: [], error: { message: err instanceof Error ? err.message : String(err) } };
    }
};

const loadRequest = (req: CheckRequest): { repo: InMemoryTupleRepository; tuples: RelationTuple[]; checkTuple: RelationTuple; model: NonNullable<ReturnType<typeof validateFile>['lowered']>['model'] } => {
    const schemaFilename = req.schemaFilename ?? '<playground>';
    const { lowered, error } = validateWithSiblings(req.schema, schemaFilename);
    if (error) throw error;

    const tuples: RelationTuple[] = [];
    const lines = req.relationships.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        try {
            tuples.push(parseTuple(trimmed));
        } catch (err) {
            throw new Error(`relationships line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }
    const repo = new InMemoryTupleRepository(tuples);
    const checkTuple = parseTuple(req.relationship);
    return { repo, tuples, checkTuple, model: lowered!.model };
};

connection.onRequest(PlaygroundMethods.LoadSchema, async (params: { schema: string; schemaFilename?: string }): Promise<SchemaSummary> => {
    await initialScan;
    return buildSchemaSummary(params.schema, params.schemaFilename ?? '<playground>');
});

connection.onRequest(PlaygroundMethods.Check, async (params: CheckRequest): Promise<CheckResponse> => {
    await initialScan;
    try {
        const { repo, tuples, checkTuple, model } = loadRequest(params);
        const allowed = await check(model, repo, checkTuple.object, checkTuple.relation, checkTuple.subject);
        return {
            allowed,
            loadedRelationships: tuples,
            parsedCheck: { object: checkTuple.object, relation: checkTuple.relation, subject: checkTuple.subject },
        };
    } catch (err) {
        return { allowed: false, error: err instanceof Error ? err.message : String(err) };
    }
});

connection.onRequest(PlaygroundMethods.Explain, async (params: CheckRequest): Promise<ExplainResponse> => {
    await initialScan;
    try {
        const { repo, tuples, checkTuple, model } = loadRequest(params);
        const result = await explain(model, repo, checkTuple.object, checkTuple.relation, checkTuple.subject);
        return {
            allowed: result.allowed,
            trace: result.trace,
            loadedRelationships: tuples,
            parsedCheck: { object: checkTuple.object, relation: checkTuple.relation, subject: checkTuple.subject },
        };
    } catch (err) {
        return { allowed: false, error: err instanceof Error ? err.message : String(err) };
    }
});

// Read a `.perm.yaml` fixture and extract the relationships heredoc plus the
// first `assertTrue` assertion. Intentionally lighter than the
// `permissions-dsl` `loadFixture` helper — we don't need to compile the
// schema here, the playground already has the active document's schema.
connection.onRequest(PlaygroundMethods.LoadFixture, async (params: LoadFixtureRequest): Promise<LoadFixtureResponse> => {
    try {
        const raw = await readFile(params.path, 'utf8');
        const parsed = yamlParse(raw) as { relationships?: string; assertions?: { assertTrue?: string[] } } | null;
        if (!parsed || typeof parsed !== 'object') return { error: 'fixture is empty or not a YAML mapping' };
        return {
            relationships: parsed.relationships ?? '',
            check: parsed.assertions?.assertTrue?.[0],
        };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
});

// Write the playground's current relationships and check input to a
// `.perm.yaml` fixture. The schema path is stored relative to the fixture
// location so the file stays portable inside the repo.
connection.onRequest(PlaygroundMethods.SaveFixture, async (params: SaveFixtureRequest): Promise<SaveFixtureResponse> => {
    try {
        const schemaFile = pathRelative(pathDirname(params.path), params.schemaPath) || './schema.perm';
        const doc: Record<string, unknown> = {
            schemaFile: schemaFile.startsWith('.') ? schemaFile : `./${schemaFile}`,
            relationships: params.relationships,
            assertions: {
                assertTrue: params.check ? [params.check] : [],
                assertFalse: [],
            },
        };
        await writeFile(params.path, yamlStringify(doc), 'utf8');
        return {};
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
});

// File must import `check` from `@maroonedsoftware/permissions` for us to
// trust that any `check(` call in it belongs to the permissions library and
// not some other identically-named helper. Cheap pre-filter that cuts noise
// without requiring a full TS parse.
const importsCheckRe = /import\s*\{[^}]*\bcheck\b[^}]*\}\s*from\s*['"]@maroonedsoftware\/permissions['"]/;

// Match `check(...)` and capture the four positional argument expressions.
// Greedy enough to handle multi-line calls; permissive enough to tolerate
// trailing whitespace, comments, and TS generics on the call name. Argument
// boundaries use `,` at the top level of the call — nested objects/calls
// would confuse a naive split, so we balance braces/parens by hand inside
// `splitArgs` rather than baking it into the regex.
const checkCallRe = /\bcheck\s*\(/g;

const splitArgs = (source: string, startIdx: number): { args: string[]; endIdx: number } | undefined => {
    let depth = 1;
    let inString: '"' | "'" | '`' | undefined;
    let escaped = false;
    let argStart = startIdx;
    const args: string[] = [];
    for (let i = startIdx; i < source.length; i++) {
        const c = source[i]!;
        if (escaped) {
            escaped = false;
            continue;
        }
        if (inString) {
            if (c === '\\') escaped = true;
            else if (c === inString) inString = undefined;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            inString = c;
            continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) {
                args.push(source.slice(argStart, i).trim());
                return { args, endIdx: i };
            }
        } else if (c === ',' && depth === 1) {
            args.push(source.slice(argStart, i).trim());
            argStart = i + 1;
        }
    }
    return undefined;
};

const lineNumberAt = (source: string, offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
        if (source.charCodeAt(i) === 10) line++;
    }
    return line;
};

const lineTextAt = (source: string, offset: number): string => {
    let start = offset;
    while (start > 0 && source.charCodeAt(start - 1) !== 10) start--;
    let end = offset;
    while (end < source.length && source.charCodeAt(end) !== 10) end++;
    return source.slice(start, end).trim().slice(0, 200);
};

// Pull a string literal from an expression like `'doc'`, `"doc"`, or
// `\`doc\`` (no interpolation). Returns undefined for anything dynamic.
const literalString = (expr: string): string | undefined => {
    const m = expr.match(/^(['"`])([^'"`$]+)\1$/);
    return m?.[2];
};

// Try to read `{ namespace: 'doc', id: ... }`-style object literals and pull
// out the static namespace value, if any.
const namespaceFromObjectExpr = (expr: string): string | undefined => {
    const m = expr.match(/namespace\s*:\s*['"`]([^'"`]+)['"`]/);
    return m?.[1];
};

const scanFileForChecks = async (file: string): Promise<DiscoveredCheck[]> => {
    let source: string;
    try {
        source = await readFile(file, 'utf8');
    } catch {
        return [];
    }
    if (!importsCheckRe.test(source)) return [];

    const out: DiscoveredCheck[] = [];
    checkCallRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = checkCallRe.exec(source)) !== null) {
        const callStart = match.index;
        const argsStart = match.index + match[0].length;
        const split = splitArgs(source, argsStart);
        if (!split) continue;
        // We expect `check(model, repo, object, relationOrPermission, subject, sink?)`.
        if (split.args.length < 4) continue;
        const permission = literalString(split.args[3] ?? '');
        const namespace = namespaceFromObjectExpr(split.args[2] ?? '');
        out.push({
            file,
            line: lineNumberAt(source, callStart),
            permission,
            namespace,
            snippet: lineTextAt(source, callStart),
        });
    }
    return out;
};

const SKIP_PARTS = new Set(['node_modules', 'dist', 'build', 'out', '.git', '.turbo', 'coverage']);

const scanWorkspaceForChecks = async (): Promise<DiscoveredCheck[]> => {
    const out: DiscoveredCheck[] = [];
    for (const folder of workspaceFolders) {
        for await (const match of glob('**/*.{ts,tsx,mts,cts}', { cwd: folder })) {
            // Skip vendored / generated paths.
            if (match.split(pathSep).some(p => SKIP_PARTS.has(p))) continue;
            const full = pathJoin(folder, match);
            const sites = await scanFileForChecks(full);
            out.push(...sites);
        }
    }
    return out;
};

connection.onRequest(PlaygroundMethods.DiscoverChecks, async (): Promise<DiscoverChecksResponse> => {
    if (workspaceFolders.length === 0) {
        return { sites: [], error: 'no workspace folder known to the language server' };
    }
    try {
        const sites = await scanWorkspaceForChecks();
        return { sites };
    } catch (err) {
        return { sites: [], error: err instanceof Error ? err.message : String(err) };
    }
});

documents.listen(connection);
connection.listen();
